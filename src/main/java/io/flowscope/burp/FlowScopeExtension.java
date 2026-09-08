package io.flowscope.burp;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.core.ToolType;
import burp.api.montoya.http.handler.HttpHandler;
import burp.api.montoya.http.handler.HttpRequestToBeSent;
import burp.api.montoya.http.handler.HttpResponseReceived;
import burp.api.montoya.http.handler.RequestToBeSentAction;
import burp.api.montoya.http.handler.ResponseReceivedAction;
import burp.api.montoya.http.HttpService;
import burp.api.montoya.http.RedirectionMode;
import burp.api.montoya.http.RequestOptions;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.proxy.ProxyHttpRequestResponse;
import burp.api.montoya.proxy.http.InterceptedRequest;
import burp.api.montoya.proxy.http.InterceptedResponse;
import burp.api.montoya.proxy.http.ProxyRequestHandler;
import burp.api.montoya.proxy.http.ProxyRequestReceivedAction;
import burp.api.montoya.proxy.http.ProxyRequestToBeSentAction;
import burp.api.montoya.proxy.http.ProxyResponseHandler;
import burp.api.montoya.proxy.http.ProxyResponseReceivedAction;
import burp.api.montoya.proxy.http.ProxyResponseToBeSentAction;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.ActiveTrafficGuard;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Masking;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RecordMerge;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.SampleProject;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.ToolKind;
import io.flowscope.core.RunPhase;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.HarParser;
import io.flowscope.core.StoredPayload;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.integration.LocalZapApiKey;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.ZapClient;
import io.flowscope.integration.ZapCampaign;
import io.flowscope.integration.ZapAccountVault;
import io.flowscope.integration.SessionBroker;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.explorer.CodexAppServerProvider;
import io.flowscope.explorer.ExplorerAccountVault;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.explorer.ExplorerTransport;
import io.flowscope.ui.FlowScopeControlTab;
import io.flowscope.web.FlowScopeWebServer;

import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.nio.file.Path;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.time.Instant;

/**
 * FlowScope Burp 확장 진입점 (Montoya). 프록시 트래픽을 포트별 소스로 수집하고
 * Burp 제어판에서 localhost Web 분석 작업면을 연다 (F-01/F-08/F-20).
 *
 * 소스 구분(F-01): 리스너 포트 → 소스. 기본 8080=사람, 8081=스캐너.
 * Montoya 는 리스너를 코드로 생성하지 못하므로(D-023 리스크) 포트는 Burp Proxy 설정에서
 * 사용자가 구성해야 한다. 미매핑 포트는 제외한다.
 */
public final class FlowScopeExtension implements BurpExtension {

    /**
     * 리스너 포트 → 소스 매핑 (F-01: 사용자가 수정 가능해야 함).
     * 기본값은 8080=사람 / 8081=스캐너이며, 확장 로드 전에 시스템 속성으로 덮어쓸 수 있다:
     *   -Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
     * 매핑에 없는 포트는 버리지 않고 '미상'으로 수집한다.
     */
    private record PortProfile(Source source, SourceDetail detail) {}
    private static final Map<Integer, PortProfile> PORT_SOURCE = loadPortMapping();

    private static Map<Integer, PortProfile> loadPortMapping() {
        Map<Integer, PortProfile> m = new LinkedHashMap<>();
        String cfg = System.getProperty("flowscope.ports",
                "8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer");
        for (String pair : cfg.split(",")) {
            String[] kv = pair.trim().split(":");
            if (kv.length < 2 || kv.length > 3) continue;
            try {
                Source s = switch (kv[1].trim().toLowerCase(Locale.ROOT)) {
                    case "human" -> Source.HUMAN;
                    case "scanner" -> Source.SCANNER;
                    case "llm" -> Source.LLM;
                    default -> null;
                };
                SourceDetail detail = kv.length == 3 ? parseDetail(kv[2], s) : defaultDetail(s);
                if (s != null) m.put(Integer.parseInt(kv[0].trim()), new PortProfile(s, detail));
            } catch (IllegalArgumentException ignored) {
                // 잘못된 항목은 건너뛴다 (로드 시 로그로 알림)
            }
        }
        return m;
    }

    private static SourceDetail parseDetail(String value, Source source) {
        SourceDetail detail = SourceDetail.valueOf(value.trim().toUpperCase(Locale.ROOT));
        return detail.belongsTo(source) ? detail : defaultDetail(source);
    }

    private static SourceDetail defaultDetail(Source source) {
        if (source == null) return SourceDetail.UNKNOWN;
        return switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.OTHER_SCANNER;
            case LLM -> SourceDetail.LLM_EXPLORER;
            case UNKNOWN -> SourceDetail.UNKNOWN;
        };
    }

    /**
     * Run context는 run/phase/account를 제공하지만, 사람이 실제로 사용한 Burp 도구까지
     * 브라우저로 바꾸면 안 된다. Repeater·Intruder·Target 관측은 해당 도구 provenance를 유지한다.
     */
    static SourceDetail effectiveDetail(Source source, SourceDetail observed,
                                        RunContextRegistry.Context context) {
        if (context == null) return observed == null ? SourceDetail.UNKNOWN : observed;
        if (source == Source.HUMAN && isHumanBurpDetail(observed)) return observed;
        return context.detail();
    }

    static ToolKind effectiveTool(Source source, SourceDetail observed,
                                  RunContextRegistry.Context context) {
        if (source == Source.HUMAN && isHumanBurpDetail(observed)) return ToolKind.BURP;
        if (context != null) return context.tool();
        if (source == null) return ToolKind.UNKNOWN;
        return switch (source) {
            case HUMAN -> observed == SourceDetail.BROWSER ? ToolKind.BROWSER
                    : isHumanBurpDetail(observed) ? ToolKind.BURP : ToolKind.UNKNOWN;
            case SCANNER -> ToolKind.ZAP;
            case LLM -> ToolKind.OTHER;
            case UNKNOWN -> ToolKind.UNKNOWN;
        };
    }

    private static boolean isHumanBurpDetail(SourceDetail detail) {
        return detail == SourceDetail.BURP_REPEATER
                || detail == SourceDetail.BURP_INTRUDER
                || detail == SourceDetail.MANUAL_HTTP;
    }

    private static final Pattern PORT = Pattern.compile(":(\\d+)$");

    /** 저장 본문 상한 — 메모리 폭증 방지. */
    private static final int MAX_BODY = 8192;
    /** 마스킹된 텍스트 원문 압축 보존 상한. 초과·바이너리는 크기와 해시만 보존한다. */
    private static final int MAX_PAYLOAD_BYTES = Integer.getInteger(
            "flowscope.payload.maxBytes", 1024 * 1024);
    /** 상한 초과 메시지는 분석/UI에 필요한 앞부분만 복사한다. */
    private static final int CAPTURE_PREVIEW_BYTES = 64 * 1024;
    /** digest 중복 제거 후 메모리에 유지할 압축 전문 총량. */
    private static final long MAX_COMPRESSED_PAYLOAD_BYTES = Math.max(0L, Long.getLong(
            "flowscope.payload.memoryBytes", 48L * 1024 * 1024));
    /** 웹 요청 실험실 원문은 프로젝트가 아니라 현재 Burp 프로세스의 제한된 메모리에만 둔다. */
    private static final int RAW_REQUEST_LIMIT_BYTES = Integer.getInteger(
            "flowscope.requestLab.requestBytes", 1024 * 1024);
    private static final int RAW_RESPONSE_LIMIT_BYTES = Integer.getInteger(
            "flowscope.requestLab.responseBytes", 4 * 1024 * 1024);
    private static final long RAW_EXCHANGE_MEMORY_BYTES = Math.max(0L, Long.getLong(
            "flowscope.requestLab.memoryBytes", 32L * 1024 * 1024));

    /** 메모리 상한 — 실제 프록시 트래픽에서 무제한 누적을 막는다. */
    private static final int MAX_RECORDS = 20_000;
    /** 갱신 병합 지연: 이 시간 안의 연속 관측은 한 번만 재구성한다. */
    private static final long REBUILD_DELAY_MS = 400;
    /** 전체 snapshot 재작성 비용을 제한하도록 연속 변경을 30초 checkpoint로 합친다. */
    private static final long DATABASE_SAVE_DELAY_MS = 30_000;

    private final List<RequestRecord> records = new ArrayList<>();
    private final AnalysisConfig analysisConfig = new AnalysisConfig();
    private final RunContextRegistry runContexts = new RunContextRegistry();
    private final SessionBroker sessionBroker = new SessionBroker();
    private final ZapAccountVault zapAccounts = new ZapAccountVault();
    private final TransientExchangeVault rawExchanges = new TransientExchangeVault(
            RAW_REQUEST_LIMIT_BYTES, RAW_RESPONSE_LIMIT_BYTES, RAW_EXCHANGE_MEMORY_BYTES);
    private final ProjectStore projectStore = new ProjectStore();
    private final SqliteProjectStore sqliteProjectStore = new SqliteProjectStore(projectStore);
    private volatile Pipeline.Result latest = Pipeline.runIsolated(List.of(), analysisConfig);
    private volatile List<RouteCandidate> routeCandidates = List.of();
    private final List<RouteCandidateExtractor.Seed> siteMapSeeds = new ArrayList<>();
    private final List<RouteCandidate> restoredRouteCandidates = new ArrayList<>();
    private volatile ScopePolicy scope = ScopePolicy.parse("");
    private volatile String scopeText = "";
    private final AtomicLong revision = new AtomicLong();
    private final AtomicLong databaseSavedRevision = new AtomicLong(-1);
    private final AtomicLong droppedRecords = new AtomicLong();
    private final AtomicLong compressedPayloadBytes = new AtomicLong();
    private FlowScopeControlTab controlTab;
    private FlowScopeWebServer webServer;
    private volatile List<LegacyAssessment> archivedAssessments = List.of();
    private volatile List<ValidationDecision> archivedValidations = List.of();
    private final io.flowscope.integration.RunExecutionLedger executionLedger = new io.flowscope.integration.RunExecutionLedger();
    private volatile String scannerCapabilityRunId = "";
    private volatile String scannerCapability = "";
    private volatile String scannerCapabilityRejectionRunId = "";
    private final AtomicLong scannerCapabilityRejections = new AtomicLong();
    private volatile String scannerDirectAuthenticationRunId = "";
    private ZapClient zapClient;
    private volatile ZapCampaign zapCampaign;
    private ExplorerAccountVault explorerAccounts;
    private ExplorerCoordinator explorer;
    private final ScheduledExecutorService worker =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "flowscope-rebuild");
                t.setDaemon(true);
                return t;
            });
    private final AtomicBoolean rebuildPending = new AtomicBoolean(false);
    private final AtomicBoolean databaseSavePending = new AtomicBoolean(false);
    private final AnalysisPublicationGate analysisPublication = new AnalysisPublicationGate();
    private volatile Path activeProjectDatabase;
    private boolean capacityWarned;
    private MontoyaApi api;
    private final ThreadLocal<Boolean> controlledRequest = ThreadLocal.withInitial(() -> false);
    private final InFlightRequestTracker proxyObservations =
            new InFlightRequestTracker(MAX_IN_FLIGHT_REQUEST_OBSERVATIONS, IN_FLIGHT_CONTEXT_TTL_MS);
    private final InFlightRequestTracker toolObservations =
            new InFlightRequestTracker(MAX_IN_FLIGHT_REQUEST_OBSERVATIONS, IN_FLIGHT_CONTEXT_TTL_MS);
    private final AtomicLong datasetEpoch = new AtomicLong();
    private final Map<String, StoredPayload> payloadPool = new ConcurrentHashMap<>();

    private static final int MAX_IN_FLIGHT_REQUEST_OBSERVATIONS = 20_000;
    private static final long IN_FLIGHT_CONTEXT_TTL_MS = 10 * 60_000L;

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("FlowScope");
        configureInitialScope();
        explorerAccounts = new ExplorerAccountVault();
        explorer = new ExplorerCoordinator(explorerAccounts, this::executeExplorerRequest,
                new CodexAppServerProvider(), runContexts, value -> scope.allows(value),
                () -> { rebuildImmediately(); return latest; }, api.logging()::logToOutput);
        try {
            startWebUi();
        } catch (Exception e) {
            api.logging().logToError("FlowScope Web UI 시작 실패", e);
            return;
        }
        // Burp 탭은 로컬 Web 작업면을 여는 최소 제어판이다.
        try {
            SwingUtilities.invokeAndWait(() -> {
                FlowScopeControlTab.Actions actions = new FlowScopeControlTab.Actions() {
                    @Override public void clearTraffic() { clearRecords(); }
                    @Override public void saveProject(File file) { saveProjectFile(file); }
                    @Override public void loadProject(File file) { loadProjectFile(file); }
                    @Override public void importProxyHistory() { importProxyHistory(); }
                    @Override public void loadSample() { loadSampleProject(); }
                    @Override public void updateScope(String value) { updateScopeFromUi(value); }
                };
                controlTab = new FlowScopeControlTab(actions, webServer.url(), portMappingSummary());
                controlTab.setScopeText(scopeText);
                controlTab.render(latest);
                api.userInterface().registerSuiteTab("FlowScope", controlTab);
            });
        } catch (Exception e) {
            api.logging().logToError("FlowScope UI 초기화 실패", e);
            if (webServer != null) webServer.close();
            return;
        }
        api.proxy().registerRequestHandler(new ProxyScopeHandler());
        api.proxy().registerResponseHandler(new ProxyHandler());
        // Repeater/Scanner/다른 확장의 트래픽도 수집 (프록시 리스너를 지나지 않는 경우 대비)
        api.http().registerHttpHandler(new ToolHandler());
        api.extension().registerUnloadingHandler(this::shutdown);
        startZapIntegration();
        api.logging().logToOutput("FlowScope loaded. 포트 매핑: " + PORT_SOURCE
                + " (미매핑 포트는 '미상'으로 수집). 변경: "
                + "-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer");
    }

    /** Scanner/LLM 전용 listener의 모든 송신과 redirect 후속 요청을 exact scope에서 강제 차단한다. */
    private final class ProxyScopeHandler implements ProxyRequestHandler {
        @Override
        public ProxyRequestReceivedAction handleRequestReceived(InterceptedRequest request) {
            PortProfile profile = profileOf(request.listenerInterface());
            if (!allowed(request, profile)) return ProxyRequestReceivedAction.drop();
            try {
                RunContextRegistry.Context context = runContexts.current(profile.source());
                String captureHandle = profile.source() == Source.HUMAN
                        ? sessionBroker.activeCaptureForService(serviceOf(request)).orElse(null) : null;
                String captureAccountId = captureHandle == null ? null
                        : sessionBroker.accountForHandle(captureHandle).orElse(null);
                HttpRequest prepared = prepareSession(request, profile, captureHandle, context);
                rememberObservation(proxyObservations, request.messageId(), context, captureAccountId, "프록시");
                return ProxyRequestReceivedAction.continueWith(prepared);
            } catch (RuntimeException error) {
                api.logging().logToOutput("FlowScope 세션 주입 차단: " + error.getMessage());
                return ProxyRequestReceivedAction.drop();
            }
        }

        @Override
        public ProxyRequestToBeSentAction handleRequestToBeSent(InterceptedRequest request) {
            return allowed(request, profileOf(request.listenerInterface()))
                    ? ProxyRequestToBeSentAction.continueWith(request)
                    : ProxyRequestToBeSentAction.drop();
        }

        private boolean allowed(InterceptedRequest request, PortProfile profile) {
            boolean allowed = ActiveTrafficGuard.allows(profile.source(), scope, request.url());
            if (!allowed) {
                api.logging().logToOutput("FlowScope exact-scope 차단: " + profile.source() + " " + request.url());
            }
            return allowed;
        }

        private HttpRequest prepareSession(InterceptedRequest request, PortProfile profile,
                                           String humanCaptureHandle, RunContextRegistry.Context context) {
            URI target = URI.create(request.url());
            if (profile.source() == Source.HUMAN) {
                if (humanCaptureHandle != null) sessionBroker.observeRequest(humanCaptureHandle, target,
                        headersOf(request.headers()), java.time.Instant.now());
                return request;
            }
            if (context == null) return request;
            HttpRequest prepared = request;
            if (profile.source() == Source.SCANNER && context.orchestrator() == Orchestrator.SYSTEM) {
                String expected = context.runId().equals(scannerCapabilityRunId) ? scannerCapability : "";
                String supplied = request.headerValue("X-FlowScope-Scanner-Capability");
                if (!scannerCampaignRequestAllowed(context, scannerCapabilityRunId, expected, supplied)) {
                    scannerCapabilityRejections.incrementAndGet();
                    throw new IllegalStateException("ZAP campaign provenance capability is missing or invalid");
                }
                prepared = prepared.withRemovedHeader("X-FlowScope-Scanner-Capability");
                // Browser Based Authentication이 만드는 Cookie/Authorization은 ZAP 사용자 세션의 일부다.
                // 이 lane에서는 SessionBroker로 교체하지 않고 ZAP이 만든 값을 그대로 대상에 전달한다.
                if (scannerUsesDirectAuthentication(context, scannerDirectAuthenticationRunId)) {
                    return prepared.withRemovedHeader("Proxy-Authorization");
                }
            }
            for (String header : SessionBroker.managedHeaderNames()) {
                if (profile.source() == Source.SCANNER && context.accountId() == null
                        && !header.equalsIgnoreCase("Authorization")
                        && !header.equalsIgnoreCase("Proxy-Authorization")) continue;
                prepared = prepared.withRemovedHeader(header);
            }
            Map<String, String> sessionHeaders = context.accountId() == null ? Map.of()
                    : sessionBroker.headersForAccount(context.accountId(), target, scope, java.time.Instant.now());
            for (Map.Entry<String, String> header : sessionHeaders.entrySet()) {
                prepared = prepared.withUpdatedHeader(header.getKey(), header.getValue());
            }
            return prepared;
        }
    }

    static boolean scannerCampaignRequestAllowed(RunContextRegistry.Context context, String capabilityRunId,
                                                  String expected, String supplied) {
        if (context == null || context.orchestrator() != Orchestrator.SYSTEM) return true;
        if (!context.runId().equals(capabilityRunId) || expected == null || expected.isBlank()) return false;
        return java.security.MessageDigest.isEqual(
                expected.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                (supplied == null ? "" : supplied).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    static boolean scannerUsesDirectAuthentication(RunContextRegistry.Context context, String directRunId) {
        return context != null && context.orchestrator() == Orchestrator.SYSTEM
                && directRunId != null && !directRunId.isBlank() && context.runId().equals(directRunId);
    }

    /** 프록시 트래픽: 리스너 포트로 소스를 구분한다 (F-01). */
    private final class ProxyHandler implements ProxyResponseHandler {
        @Override
        public ProxyResponseReceivedAction handleResponseReceived(InterceptedResponse response) {
            try {
                PortProfile profile = profileOf(response.listenerInterface());
                InFlightRequestTracker.Observation observation = proxyObservations.remove(response.messageId());
                if (observation == null) {
                    api.logging().logToOutput("FlowScope: 요청 시점 프록시 문맥이 없는 응답 제외 — messageId="
                            + response.messageId());
                    return ProxyResponseReceivedAction.continueWith(response);
                }
                if (staleObservation(observation)) return ProxyResponseReceivedAction.continueWith(response);
                boolean captured = capture(response.initiatingRequest(), response, profile, observation);
                if (captured) {
                    observeSessionResponse(profile, response.initiatingRequest(), response.statusCode(),
                            response.headerValue("Location"), boundedResponseBody(response), response.headers(), observation);
                }
            } catch (Exception e) {
                api.logging().logToError("FlowScope capture 실패", e);
            }
            return ProxyResponseReceivedAction.continueWith(response);
        }

        @Override
        public ProxyResponseToBeSentAction handleResponseToBeSent(InterceptedResponse response) {
            return ProxyResponseToBeSentAction.continueWith(response);
        }
    }

    /**
     * 프록시를 지나지 않는 Burp 도구(Repeater/Scanner/Intruder/다른 확장) 트래픽도 수집한다.
     * Proxy 트래픽은 ProxyHandler 가 이미 처리하므로 여기서는 제외해 중복을 막는다.
     */
    private final class ToolHandler implements HttpHandler {
        @Override
        public RequestToBeSentAction handleHttpRequestToBeSent(HttpRequestToBeSent req) {
            ToolType tool = req.toolSource().toolType();
            if (tool != ToolType.PROXY && !controlledRequest.get()) {
                Source source = sourceOfTool(tool);
                RunContextRegistry.Context context = toolRunContext(detailOfTool(tool), runContexts.current(source));
                String captureHandle = source == Source.HUMAN
                        ? sessionBroker.activeCaptureForService(serviceOf(req)).orElse(null) : null;
                String captureAccountId = captureHandle == null ? null
                        : sessionBroker.accountForHandle(captureHandle).orElse(null);
                rememberObservation(toolObservations, req.messageId(), context, captureAccountId, "Burp 도구");
            }
            return RequestToBeSentAction.continueWith(req);
        }

        @Override
        public ResponseReceivedAction handleHttpResponseReceived(HttpResponseReceived response) {
            try {
                ToolType tool = response.toolSource().toolType();
                if (tool != ToolType.PROXY && !controlledRequest.get()) {   // 프록시/통제 실행은 별도 담당
                    Source source = sourceOfTool(tool);
                    InFlightRequestTracker.Observation observation = toolObservations.remove(response.messageId());
                    if (observation == null) {
                        api.logging().logToOutput("FlowScope: 요청 시점 Burp 도구 문맥이 없는 응답 제외 — messageId="
                                + response.messageId());
                        return ResponseReceivedAction.continueWith(response);
                    }
                    if (staleObservation(observation)) return ResponseReceivedAction.continueWith(response);
                    PortProfile profile = new PortProfile(source, detailOfTool(tool));
                    boolean captured = capture(response.initiatingRequest(), response, profile, observation);
                    if (captured) {
                        observeSessionResponse(profile, response.initiatingRequest(), response.statusCode(),
                                response.headerValue("Location"), boundedResponseBody(response), response.headers(), observation);
                    }
                }
            } catch (Exception e) {
                api.logging().logToError("FlowScope tool capture 실패", e);
            }
            return ResponseReceivedAction.continueWith(response);
        }
    }

    /** Burp 도구 → 소스. 스캐너는 자동 점검, 나머지 수동 조작은 사람으로 본다. */
    private static Source sourceOfTool(ToolType tool) {
        return switch (tool) {
            case SCANNER -> Source.SCANNER;
            case REPEATER, INTRUDER, TARGET -> Source.HUMAN;
            default -> Source.UNKNOWN;
        };
    }

    private static SourceDetail detailOfTool(ToolType tool) {
        return switch (tool) {
            case SCANNER -> SourceDetail.OTHER_SCANNER;
            case REPEATER -> SourceDetail.BURP_REPEATER;
            case INTRUDER -> SourceDetail.BURP_INTRUDER;
            case TARGET -> SourceDetail.MANUAL_HTTP;
            default -> SourceDetail.UNKNOWN;
        };
    }

    /** Burp 내장 Scanner는 ZAP 소유 실행이 아니므로 활성 ZAP campaign 문맥을 상속하지 않는다. */
    static RunContextRegistry.Context toolRunContext(SourceDetail detail, RunContextRegistry.Context current) {
        return detail == SourceDetail.OTHER_SCANNER ? null : current;
    }

    private boolean capture(HttpRequest req, HttpResponse response, PortProfile profile,
                            InFlightRequestTracker.Observation observation) {
        if (!ActiveTrafficGuard.allowsCapture(scope, req.url()) || staleObservation(observation)) return false;
        synchronized (records) {
            if (records.size() >= MAX_RECORDS) {
                recordDroppedAtCapacity();
                return false;
            }
        }
        RequestRecord rec = recordFrom(req, response, profile, System.currentTimeMillis(), true, null, observation);

        // 프록시 콜백은 즉시 반환한다: 여기서 정규화/그래프 재구성을 하면 트래픽마다 O(N) → 누적 O(N²).
        synchronized (records) {
            // 초기화/프로젝트 교체가 record 변환 도중 일어났다면 이전 데이터셋의 늦은 응답을 버린다.
            if (staleObservation(observation)) return false;
            if (records.size() >= MAX_RECORDS) {
                recordDroppedAtCapacity();
                return false;
            }
            records.add(rec);
            retainRawExchange(rec, req, response);
        }
        scheduleRebuild();
        return true;
    }

    /** records lock 안에서만 호출한다. 상한 뒤 payload 생성 비용과 pool 오염도 피한다. */
    private void recordDroppedAtCapacity() {
        if (!capacityWarned) {
            api.logging().logToOutput("FlowScope: 레코드 상한 " + MAX_RECORDS + " 도달 — 이후 관측은 버립니다.");
            capacityWarned = true;
        }
        droppedRecords.incrementAndGet();
        revision.incrementAndGet();
    }

    private RequestRecord recordFrom(HttpRequest req, HttpResponse response, PortProfile profile,
                                     long timestamp, boolean applyRunContext, String runId,
                                     InFlightRequestTracker.Observation observation) {
        return recordFrom(req, response, profile, timestamp, applyRunContext, runId, observation, null);
    }

    private RequestRecord recordFrom(HttpRequest req, HttpResponse response, PortProfile profile,
                                     long timestamp, boolean applyRunContext, String runId,
                                     InFlightRequestTracker.Observation observation,
                                     String forcedAccountId) {
        int status = response.statusCode();
        String location = response.headerValue("Location");
        String responseContentType = response.headerValue("Content-Type");
        BoundedHttpCapture.Result capturedRequest = BoundedHttpCapture.capture(req.toByteArray(), req.bodyOffset(),
                req.headerValue("Content-Type"), MAX_PAYLOAD_BYTES, CAPTURE_PREVIEW_BYTES);
        BoundedHttpCapture.Result capturedResponse = BoundedHttpCapture.capture(response.toByteArray(),
                response.bodyOffset(), responseContentType,
                BoundedHttpCapture.retainedLimitFor(responseContentType, MAX_PAYLOAD_BYTES),
                BoundedHttpCapture.previewLimitFor(responseContentType, CAPTURE_PREVIEW_BYTES));
        HttpMessageTextCodec.Decoded decodedRequest = capturedRequest.decoded();
        HttpMessageTextCodec.Decoded decodedResponse = capturedResponse.decoded();
        String requestText = decodedRequest.text();
        String responseText = decodedResponse.text();
        String requestBody = decodedRequest.editable() ? bodyText(requestText, req.bodyOffset()) : null;
        String responseBody = decodedResponse.editable() ? bodyText(responseText, response.bodyOffset()) : null;
        String service = serviceOf(req);
        RunContextRegistry.Context context = !applyRunContext ? null : observation == null
                ? runContexts.current(profile.source()) : observation.context();
        String humanCaptureAccountId = profile.source() != Source.HUMAN ? null : observation == null
                ? sessionBroker.activeCaptureForService(service).flatMap(sessionBroker::accountForHandle).orElse(null)
                : observation.humanCaptureAccountId();
        String detectedAccountId = sessionBroker.accountForRequest(URI.create(req.url()), headersOf(req.headers()),
                java.time.Instant.now()).orElse(null);
        String accountId = forcedAccountId != null ? forcedAccountId
                : resolveObservedAccount(profile.source(), context == null ? null : context.accountId(),
                humanCaptureAccountId, detectedAccountId);
        String fp = captureFingerprint(profile.source(), context, accountId,
                req.headerValue("Authorization"), req.headerValue("Cookie"));
        RequestRecord rec = new RequestRecord(
                profile.source(), service, req.method(), req.pathWithoutQuery(), status, fp);
        rec.sourceDetail = profile.detail();
        rec.orchestrator = profile.source() == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        rec.tool = effectiveTool(profile.source(), profile.detail(), null);
        rec.phase = capturePhase(profile.source(), profile.detail(), humanCaptureAccountId != null);
        rec.executionTrust = switch (profile.source()) {
            case HUMAN -> io.flowscope.core.ExecutionTrust.OBSERVED;
            case SCANNER -> context == null
                    ? io.flowscope.core.ExecutionTrust.UNVERIFIED_RUNTIME
                    : io.flowscope.core.ExecutionTrust.CONTROLLED;
            case LLM -> io.flowscope.core.ExecutionTrust.UNVERIFIED_RUNTIME;
            case UNKNOWN -> io.flowscope.core.ExecutionTrust.UNKNOWN;
        };
        rec.runId = runId == null
                ? "live-" + profile.source().name().toLowerCase(Locale.ROOT) : runId;
        if (context != null) {
            rec.sourceDetail = effectiveDetail(profile.source(), profile.detail(), context);
            rec.orchestrator = context.orchestrator();
            rec.tool = effectiveTool(profile.source(), profile.detail(), context);
            rec.phase = rec.sourceDetail == SourceDetail.ZAP_AUTHENTICATION
                    ? RunPhase.SESSION_SETUP : context.phase();
            rec.runId = context.runId();
            rec.laneAccountId = context.accountId();
        }
        boolean directZapAccount = profile.source() == Source.SCANNER
                && scannerUsesDirectAuthentication(context, scannerDirectAuthenticationRunId);
        if (accountId != null && !"anon".equals(fp) && !directZapAccount) {
            try { analysisConfig.bindSession(rec.service, fp, accountId); }
            catch (AnalysisConfig.SessionBindingConflictException error) {
                sessionBroker.markCredentialConflict(accountId);
                api.logging().logToError("FlowScope 중복 인증 세션 차단: " + error.getMessage());
            }
            catch (RuntimeException error) { api.logging().logToError("FlowScope 세션 신원 연결 실패", error); }
        }
        // 명세가 입력으로 요구하는 데이터 (F-06 쿼리·본문 / F-09 ID·시각 / F-18·22 원요청).
        // 저장 전 반드시 마스킹 (F-05 원문 토큰 저장 금지, F-22 인증정보 가림).
        String maskedRequest = capturedRequest.maskedText();
        String maskedResponse = capturedResponse.maskedText();
        rec.requestPayload = internPayload(capturedRequest.payload());
        rec.responsePayload = internPayload(capturedResponse.payload());
        rec.query = Masking.truncate(Masking.maskBody(emptyToNull(req.query()),
                "application/x-www-form-urlencoded"), MAX_BODY);
        rec.reqBody = Masking.truncate(Masking.maskBody(requestBody, req.headerValue("Content-Type")), MAX_BODY);
        rec.reqText = Masking.truncate(maskedRequest, MAX_BODY);
        rec.requestContentType = emptyToNull(req.headerValue("Content-Type"));
        rec.responseContentType = emptyToNull(responseContentType);
        rec.secFetchDest = emptyToNull(req.headerValue("Sec-Fetch-Dest"));
        rec.secFetchMode = emptyToNull(req.headerValue("Sec-Fetch-Mode"));
        rec.accessControlRequestMethod = emptyToNull(req.headerValue("Access-Control-Request-Method"));
        rec.timestamp = timestamp;
        rec.body = Masking.truncate(Masking.maskBody(responseBody, responseContentType), MAX_BODY);
        rec.respText = Masking.truncate(maskedResponse, MAX_BODY);
        rec.location = Masking.truncate(Masking.maskSecrets(location), MAX_BODY);
        // 이 메서드는 응답 수신 콜백에서만 호출된다. 204/빈 본문도 실제 응답이다.
        rec.hasResponse = true;
        return rec;
    }

    /** 재구성을 워커 스레드에서 수행하고, 대기 중 갱신은 하나로 합친다(EDT·콜백 부하 방지). */
    private void scheduleRebuild() {
        analysisPublication.invalidate();
        if (!rebuildPending.compareAndSet(false, true)) return;  // 이미 예약됨 → 합치기
        worker.schedule(() -> {
            rebuildPending.set(false);
            try {
                long analysisEpoch = analysisPublication.current();
                List<RequestRecord> snapshot;
                synchronized (records) { snapshot = new ArrayList<>(records); }
                Pipeline.Result result = Pipeline.runIsolated(snapshot, analysisConfig);
                publishAnalysis(analysisEpoch, result);
            } catch (Exception e) {
                api.logging().logToError("FlowScope 그래프 갱신 실패", e);
            }
        }, REBUILD_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    private static String emptyToNull(String s) { return (s == null || s.isBlank()) ? null : s; }

    private StoredPayload internPayload(StoredPayload payload) {
        if (payload == null) return null;
        synchronized (payloadPool) {
            String key = payload.digest() + ":" + payload.retention().name();
            StoredPayload existing = payloadPool.get(key);
            if (existing != null) return existing;
            if (payload.retained()
                    && compressedPayloadBytes.get() + payload.compressedBytes() > MAX_COMPRESSED_PAYLOAD_BYTES) {
                StoredPayload metadata = payload.metadataOnly(StoredPayload.Retention.CAPACITY_METADATA_ONLY);
                return payloadPool.computeIfAbsent(
                        metadata.digest() + ":" + metadata.retention().name(), ignored -> metadata);
            }
            payloadPool.put(key, payload);
            compressedPayloadBytes.addAndGet(payload.compressedBytes());
            return payload;
        }
    }

    private void resetPayloadPool() {
        synchronized (payloadPool) {
            payloadPool.clear();
            compressedPayloadBytes.set(0);
        }
    }

    private static Map<String, String> headersOf(List<HttpHeader> headers) {
        Map<String, String> values = new LinkedHashMap<>();
        if (headers != null) headers.forEach(header -> values.put(header.name(), header.value()));
        return values;
    }

    static String resolveObservedAccount(Source source, String contextAccountId,
                                         String humanCaptureAccountId, String detectedAccountId) {
        if (source == Source.HUMAN) {
            if (humanCaptureAccountId != null) return humanCaptureAccountId;
            if (contextAccountId != null) {
                return contextAccountId.equals(detectedAccountId) ? contextAccountId : null;
            }
        }
        return contextAccountId != null ? contextAccountId : detectedAccountId;
    }

    static String captureFingerprint(Source source, RunContextRegistry.Context context, String accountId,
                                     String authorization, String cookie) {
        boolean explicitAnonymousHumanPass = source == Source.HUMAN && context != null && accountId == null
                && emptyToNull(authorization) == null && emptyToNull(cookie) == null;
        boolean isolatedAnonymousScanner = source == Source.SCANNER && context != null
                && context.orchestrator() == Orchestrator.SYSTEM && context.accountId() == null;
        return explicitAnonymousHumanPass || isolatedAnonymousScanner
                ? "anon" : Fingerprints.of(authorization, cookie);
    }

    private void rememberObservation(InFlightRequestTracker tracker, int messageId,
                                     RunContextRegistry.Context context, String humanCaptureAccountId,
                                     String channel) {
        long now = System.currentTimeMillis();
        if (!tracker.remember(messageId, context, humanCaptureAccountId, datasetEpoch.get(), now)) {
            api.logging().logToOutput("FlowScope: in-flight " + channel
                    + " 문맥 상한 도달 — 잘못된 run 귀속을 막기 위해 해당 응답은 수집에서 제외됩니다.");
        }
    }

    private boolean staleObservation(InFlightRequestTracker.Observation observation) {
        return observation != null && !observation.belongsTo(datasetEpoch.get());
    }

    private void observeSessionResponse(PortProfile profile, HttpRequest request, int status,
                                        String location, String body, List<HttpHeader> headers,
                                        InFlightRequestTracker.Observation observation) {
        try {
            String service = serviceOf(request);
            String handle = null;
            RunContextRegistry.Context context = observation == null ? runContexts.current(profile.source())
                    : observation.context();
            if (profile.source() == Source.HUMAN) {
                String captureAccountId = observation == null
                        ? sessionBroker.activeCaptureForService(service).flatMap(sessionBroker::accountForHandle).orElse(null)
                        : observation.humanCaptureAccountId();
                String detectedAccountId = sessionBroker.accountForRequest(URI.create(request.url()),
                        headersOf(request.headers()), java.time.Instant.now()).orElse(null);
                String accountId = resolveObservedAccount(Source.HUMAN,
                        context == null ? null : context.accountId(), captureAccountId, detectedAccountId);
                if (accountId != null) handle = sessionBroker.handleForAccount(accountId);
            } else if (context != null && context.accountId() != null
                    && !scannerUsesDirectAuthentication(context, scannerDirectAuthenticationRunId)) {
                handle = sessionBroker.handleForAccount(context.accountId());
            }
            if (handle == null) return;
            List<String> setCookies = headers == null ? List.of() : headers.stream()
                    .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                    .map(HttpHeader::value).toList();
            sessionBroker.observeResponse(handle, URI.create(request.url()), status, location, body,
                    setCookies, java.time.Instant.now());
        } catch (RuntimeException error) {
            api.logging().logToError("FlowScope 세션 응답 갱신 실패", error);
        }
    }

    /** scheme://host:port — 서로 다른 타깃이 합쳐지지 않게 보존한다. */
    private static String serviceOf(HttpRequest req) {
        try {
            var svc = req.httpService();
            if (svc == null) return "unknown-service";
            return (svc.secure() ? "https" : "http") + "://" + svc.host() + ":" + svc.port();
        } catch (Exception e) {
            return "unknown-service";
        }
    }

    /** 리스너 포트 → 소스. 매핑이 없으면 UNKNOWN(미상)으로 보존한다 (F-01/F-03). */
    private static PortProfile profileOf(String listenerInterface) {
        if (listenerInterface == null) return new PortProfile(Source.UNKNOWN, SourceDetail.UNKNOWN);
        Matcher m = PORT.matcher(listenerInterface.trim());
        if (!m.find()) return new PortProfile(Source.UNKNOWN, SourceDetail.UNKNOWN);
        return PORT_SOURCE.getOrDefault(Integer.parseInt(m.group(1)),
                new PortProfile(Source.UNKNOWN, SourceDetail.UNKNOWN));
    }

    private static PortProfile profileOf(int listenerPort) {
        return PORT_SOURCE.getOrDefault(listenerPort,
                new PortProfile(Source.UNKNOWN, SourceDetail.UNKNOWN));
    }

    private static String portMappingSummary() {
        return PORT_SOURCE.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + entry.getValue().source().name()
                        + "/" + entry.getValue().detail().name())
                .collect(java.util.stream.Collectors.joining(", "));
    }

    private static int configuredScannerProxyPort() {
        return PORT_SOURCE.entrySet().stream()
                .filter(entry -> entry.getValue().source() == Source.SCANNER)
                .map(Map.Entry::getKey).sorted().findFirst().orElse(8081);
    }

    private static RunPhase phaseOf(SourceDetail detail) {
        return switch (detail) {
            case ZAP_AUTHENTICATION -> RunPhase.SESSION_SETUP;
            case LLM_EXPLORER, ZAP_SPIDER, ZAP_API_IMPORT, ZAP_AJAX_SPIDER, ZAP_CLIENT_SPIDER,
                    ZAP_PASSIVE_SCAN, ZAP_ACTIVE_SCAN,
                    OTHER_SCANNER -> RunPhase.EXPLORATION;
            case LLM_COACH_PROBE -> RunPhase.COACH_PROBE;
            case LLM_VALIDATION -> RunPhase.VALIDATION;
            case XML_IMPORT, HAR_IMPORT -> RunPhase.IMPORT;
            default -> RunPhase.BASELINE;
        };
    }

    static RunPhase capturePhase(Source source, SourceDetail detail, boolean humanSessionCapture) {
        return source == Source.HUMAN && humanSessionCapture ? RunPhase.SESSION_SETUP : phaseOf(detail);
    }

    private void importProxyHistory() {
        worker.execute(() -> {
            try {
                List<ProxyHttpRequestResponse> history = api.proxy().history();
                List<RequestRecord> incoming = new ArrayList<>(history.size());
                int withoutResponse = 0;
                for (ProxyHttpRequestResponse item : history) {
                    if (!item.hasResponse() || item.response() == null) {
                        withoutResponse++;
                        continue;
                    }
                    HttpRequest request = item.finalRequest() == null ? item.request() : item.finalRequest();
                    if (request == null) continue;
                    var response = item.response();
                    long timestamp = item.time() == null ? 0L : item.time().toInstant().toEpochMilli();
                    PortProfile profile = profileOf(item.listenerPort());
                    String runId = "proxy-history-" + profile.source().name().toLowerCase(Locale.ROOT);
                    incoming.add(recordFrom(request, response, profile, timestamp, false, runId, null));
                }

                List<RouteCandidateExtractor.Seed> importedSiteMapSeeds = new ArrayList<>();
                for (var item : api.siteMap().requestResponses()) {
                    if (item == null || item.hasResponse() || item.request() == null) continue;
                    String url = item.request().url();
                    if (!scope.allows(url)) continue;
                    String method = item.request().method();
                    importedSiteMapSeeds.add(new RouteCandidateExtractor.Seed(url, method,
                            RouteCandidate.ProvenanceType.BURP_UNREQUESTED,
                            "sitemap:" + shortDigest(url + "\0" + method)));
                }

                List<RequestRecord> added;
                int duplicateCount;
                synchronized (records) {
                    int room = Math.max(0, MAX_RECORDS - records.size());
                    List<RequestRecord> missing = RecordMerge.missing(records, incoming, incoming.size());
                    added = missing.subList(0, Math.min(room, missing.size()));
                    duplicateCount = incoming.size() - missing.size();
                    droppedRecords.addAndGet(missing.size() - added.size());
                    records.addAll(added);
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                synchronized (siteMapSeeds) {
                    siteMapSeeds.clear();
                    siteMapSeeds.addAll(importedSiteMapSeeds);
                }
                rebuildRouteCandidates(latest.records);
                String message = "Proxy history " + history.size() + "건 중 " + added.size()
                        + "건 가져옴 · 기존 중복 " + duplicateCount + "건 · 저장 상한 유실 "
                        + droppedRecords.get() + "건 · 응답 없음 "
                        + withoutResponse + "건 · Site Map 미응답 후보 " + importedSiteMapSeeds.size() + "건";
                api.logging().logToOutput("FlowScope " + message);
                if (!added.isEmpty() || !importedSiteMapSeeds.isEmpty()) scheduleRebuild();
                SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(controlTab, message,
                        "FlowScope", JOptionPane.INFORMATION_MESSAGE));
            } catch (Exception e) {
                projectError("Proxy history 가져오기 실패", e);
            }
        });
    }

    private void loadSampleProject() {
        worker.execute(() -> {
            try {
                long analysisEpoch = analysisPublication.invalidate();
                clearRunContexts();
                sessionBroker.close();
                resetExplorerSecrets();
                synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
                synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
                SampleProject.Data sample = SampleProject.create();
                JavascriptCallSiteAnalyzer.clearCache();
                analysisConfig.replaceWith(sample.config());
                List<RequestRecord> loaded = new ArrayList<>(sample.records());
                resetPayloadPool();
                loaded.forEach(record -> {
                    record.requestPayload = internPayload(record.requestPayload);
                    record.responsePayload = internPayload(record.responsePayload);
                });
                Pipeline.Result result = Pipeline.runIsolated(loaded, analysisConfig);
                synchronized (records) {
                    datasetEpoch.incrementAndGet();
                    records.clear();
                    records.addAll(loaded);
                    capacityWarned = false;
                }
                rawExchanges.clear();
                droppedRecords.set(0);
                publishAnalysis(analysisEpoch, result);
                archivedAssessments = List.of();
                archivedValidations = List.of();
                resetIntegrationWorkflow();
                resetZapSecrets();
                activeProjectDatabase = null;
                databaseSavedRevision.set(-1);
                api.logging().logToOutput("FlowScope 샘플 프로젝트 열기: " + loaded.size()
                        + "건 · 실제 네트워크 요청 없음");
            } catch (Exception e) {
                projectError("샘플 프로젝트 열기 실패", e);
            }
        });
    }

    private void clearRecords() {
        long analysisEpoch = analysisPublication.invalidate();
        clearRunContexts();
        synchronized (records) {
            datasetEpoch.incrementAndGet();
            records.clear();
            capacityWarned = false;
        }
        rawExchanges.clear();
        droppedRecords.set(0);
        resetPayloadPool();
        synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
        synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
        routeCandidates = List.of();
        JavascriptCallSiteAnalyzer.clearCache();
        analysisConfig.clearReviews();
        Pipeline.Result empty = Pipeline.runIsolated(List.of(), analysisConfig);
        archivedAssessments = List.of();
        archivedValidations = List.of();
        resetIntegrationWorkflow();
        resetZapSecrets();
        resetExplorerSecrets();
        publishAnalysis(analysisEpoch, empty);
        api.logging().logToOutput("FlowScope 수집 데이터가 삭제되었습니다.");
    }

    private void saveProjectFile(File file) {
        worker.execute(() -> {
            try {
                List<RequestRecord> snapshot;
                synchronized (records) { snapshot = new ArrayList<>(records); }
                List<LegacyAssessment> assessments = archivedAssessments;
                List<ValidationDecision> validations = archivedValidations;
                boolean database = sqliteProject(file.toPath());
                Path path = file.toPath().toAbsolutePath().normalize();
                if (database) {
                    sqliteProjectStore.save(path, snapshot, analysisConfig, assessments, validations,
                            runContexts.completedRuns(), routeCandidates,
                            executionLedger.attempts());
                } else {
                    projectStore.save(path, snapshot, analysisConfig, assessments, validations,
                            runContexts.completedRuns(), routeCandidates,
                            executionLedger.attempts());
                }
                if (database) {
                    activeProjectDatabase = path;
                    databaseSavedRevision.set(revision.get());
                }
                api.logging().logToOutput("FlowScope 프로젝트 저장: " + file);
            } catch (Exception e) {
                projectError("프로젝트 저장 실패", e);
            }
        });
    }

    private void loadProjectFile(File file) {
        worker.execute(() -> {
            try {
                long analysisEpoch = analysisPublication.invalidate();
                clearRunContexts();
                sessionBroker.close();
                resetExplorerSecrets();
                synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
                synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
                Path path = file.toPath().toAbsolutePath().normalize();
                boolean database = sqliteProject(path);
                ProjectStore.ProjectData data = database
                        ? sqliteProjectStore.load(path) : projectStore.load(path);
                analysisConfig.replaceWith(data.config());
                JavascriptCallSiteAnalyzer.clearCache();
                List<RequestRecord> loaded = new ArrayList<>(data.records());
                resetPayloadPool();
                loaded.forEach(record -> {
                    record.requestPayload = internPayload(record.requestPayload);
                    record.responsePayload = internPayload(record.responsePayload);
                });
                Pipeline.Result result = Pipeline.runIsolated(loaded, analysisConfig);
                synchronized (restoredRouteCandidates) {
                    restoredRouteCandidates.addAll(data.routeCandidates().stream()
                            .filter(candidate -> !candidate.observed()).toList());
                }
                // 과거 LLM 기록은 현재 판정에 재사용하지 않고 그대로 보존한다.
                synchronized (records) {
                    datasetEpoch.incrementAndGet();
                    records.clear();
                    records.addAll(loaded);
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                rawExchanges.clear();
                droppedRecords.set(0);
                publishAnalysis(analysisEpoch, result);
                resetIntegrationWorkflow();
                resetZapSecrets();
                archivedAssessments = data.assessments();
                archivedValidations = data.validations();
                executionLedger.replace(data.runAttempts());
                runContexts.restoreCompletedRuns(data.completedRuns());
                activeProjectDatabase = database ? path : null;
                databaseSavedRevision.set(database ? revision.get() : -1);
                api.logging().logToOutput("FlowScope 프로젝트 열기: " + result.records.size() + "건 — " + file);
            } catch (Exception e) {
                projectError("프로젝트 열기 실패", e);
            }
        });
    }

    private void projectError(String title, Exception error) {
        api.logging().logToError(title, error);
        SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(controlTab,
                title + ": " + error.getMessage(), "FlowScope", JOptionPane.ERROR_MESSAGE));
    }

    private static boolean sqliteProject(java.nio.file.Path path) throws java.io.IOException {
        if (java.nio.file.Files.isRegularFile(path)) {
            try (var input = java.nio.file.Files.newInputStream(path)) {
                byte[] header = input.readNBytes(16);
                if (java.util.Arrays.equals(header,
                        "SQLite format 3\000".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1))) return true;
            }
        }
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return name.endsWith(".flowscope.db") || name.endsWith(".db");
    }

    /** DB를 한 번 저장하거나 열면 이후 변경은 같은 파일에 checkpoint 자동 저장한다. */
    private void scheduleDatabaseSave() {
        if (activeProjectDatabase == null || databaseSavedRevision.get() == revision.get()) return;
        if (!databaseSavePending.compareAndSet(false, true)) return;
        worker.schedule(() -> {
            long savingRevision = revision.get();
            try {
                saveActiveDatabase();
                databaseSavedRevision.set(savingRevision);
            } catch (Exception error) {
                api.logging().logToError("FlowScope 로컬 DB 자동 저장 실패", error);
            } finally {
                databaseSavePending.set(false);
                if (activeProjectDatabase != null && databaseSavedRevision.get() != revision.get()) {
                    scheduleDatabaseSave();
                }
            }
        }, DATABASE_SAVE_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    private void saveActiveDatabase() throws IOException {
        Path database = activeProjectDatabase;
        if (database == null) return;
        List<RequestRecord> snapshot;
        synchronized (records) { snapshot = new ArrayList<>(records); }
        List<LegacyAssessment> assessments = archivedAssessments;
        List<ValidationDecision> validations = archivedValidations;
        sqliteProjectStore.save(database, snapshot, analysisConfig, assessments, validations,
                runContexts.completedRuns(), routeCandidates,
                executionLedger.attempts());
    }

    private void configureInitialScope() {
        String configured = System.getProperty("flowscope.scope", "");
        try {
            scope = ScopePolicy.parse(configured);
            scopeText = configured;
        } catch (IllegalArgumentException e) {
            scope = ScopePolicy.parse("");
            scopeText = "";
            api.logging().logToError("FlowScope scope 설정이 잘못되어 빈 범위로 시작합니다: " + e.getMessage());
        }
    }

    private void updateScopeFromUi(String value) {
        try {
            applyScope(value);
        } catch (IllegalArgumentException | IllegalStateException e) {
            SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(controlTab, e.getMessage(),
                    "FlowScope 범위 오류", JOptionPane.ERROR_MESSAGE));
        }
    }

    private void applyScope(String value) {
        if (scopeMutationBlocked(runContexts)) {
            throw new IllegalStateException("활성 실행이 있습니다. "
                    + "실행을 종료한 뒤 범위를 변경하세요.");
        }
        ScopePolicy parsed = ScopePolicy.parse(value);
        scope = parsed;
        scopeText = value == null ? "" : value;
        synchronized (siteMapSeeds) { siteMapSeeds.removeIf(seed -> !parsed.allows(seed.url())); }
        synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
        rebuildRouteCandidates(latest.records);
        if (controlTab != null) SwingUtilities.invokeLater(() -> controlTab.setScopeText(scopeText));
        api.logging().logToOutput("FlowScope 허용 범위 갱신: " + parsed.entries());
    }

    static boolean scopeMutationBlocked(RunContextRegistry contexts) {
        return contexts.hasActiveRuns();
    }

    static long capturedCount(List<RequestRecord> values, Source source, String runId, SourceDetail detail) {
        return values.stream()
                .filter(record -> record.source == source && runId.equals(record.runId))
                .filter(record -> detail == null || record.sourceDetail == detail)
                .count();
    }

    private void startWebUi() throws Exception {
        int port = Integer.getInteger("flowscope.web.port", 17777);
        webServer = new FlowScopeWebServer(new FlowScopeWebServer.State() {
            @Override public Pipeline.Result snapshot() { return latest; }
            @Override public Pipeline.Result completionSnapshot() { rebuildImmediately(); return latest; }
            @Override public long revision() { return revision.get(); }
            @Override public AnalysisConfig config() { return analysisConfig; }
            @Override public List<LegacyAssessment> assessments() {
                return archivedAssessments;
            }
            @Override public List<ValidationDecision> validations() {
                return archivedValidations;
            }
            @Override public RunContextRegistry contexts() { return runContexts; }
            @Override public SessionBroker sessions() { return sessionBroker; }
            @Override public List<ZapAccountVault.View> zapAccounts() { return zapAccounts.views(); }
            @Override public ZapAccountVault.View saveZapAccount(ZapAccountVault.Input input) {
                ZapAccountVault.View saved = zapAccounts.save(input);
                io.flowscope.core.AccessRole role = io.flowscope.core.AccessRole.valueOf(saved.role());
                analysisConfig.upsertAccount(new io.flowscope.core.AccountProfile(
                        saved.id(), saved.label(), saved.service(), role));
                scheduleRebuild();
                return saved;
            }
            @Override public void removeZapAccount(String id) {
                zapAccounts.remove(id);
                analysisConfig.removeAccount(id);
                scheduleRebuild();
            }
            @Override public List<String> scopeEntries() { return scope.entries(); }
            @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
            @Override public List<io.flowscope.integration.RunExecutionLedger.Summary> executionSummaries() {
                return executionLedger.summaries();
            }
            @Override public long droppedRecords() { return droppedRecords.get(); }
            @Override public com.fasterxml.jackson.databind.JsonNode startScanner(String target,
                                                                                   List<String> accountIds,
                                                                                   boolean includeAnonymous,
                                                                                   List<ZapCampaign.ZapDefinition> definitions) {
                if (zapCampaign == null) throw new IllegalStateException("ZAP 캠페인이 아직 준비되지 않았습니다.");
                return zapCampaign.startDeterministicZapCampaign(target, accountIds, includeAnonymous, definitions);
            }
            @Override public com.fasterxml.jackson.databind.JsonNode scannerStatus() {
                return zapCampaign == null
                        ? new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("status", "NOT_STARTED")
                        : zapCampaign.deterministicZapBaselineStatus();
            }
            @Override public com.fasterxml.jackson.databind.JsonNode cancelScanner() {
                if (zapCampaign == null) throw new IllegalStateException("ZAP 캠페인이 아직 준비되지 않았습니다.");
                return zapCampaign.cancelDeterministicZapBaseline();
            }
            @Override public com.fasterxml.jackson.databind.node.ObjectNode zapStatus() { return zapConnectionStatus(); }
            @Override public ExplorerCoordinator.Snapshot explorerStatus() { return explorer.current(); }
            @Override public List<ExplorerAccountVault.View> explorerAccounts() { return explorer.accounts(); }
            @Override public ExplorerAccountVault.View saveExplorerAccount(ExplorerAccountVault.Input input) {
                ExplorerAccountVault.View saved = explorer.saveAccount(input);
                URI login = URI.create(saved.loginUrl());
                io.flowscope.core.AccessRole role;
                try { role = io.flowscope.core.AccessRole.valueOf(saved.role().toUpperCase(Locale.ROOT)); }
                catch (RuntimeException ignored) { role = io.flowscope.core.AccessRole.UNKNOWN; }
                analysisConfig.upsertAccount(new io.flowscope.core.AccountProfile(
                        saved.id(), saved.label(), login.getScheme() + "://" + login.getAuthority(), role));
                scheduleRebuild();
                return saved;
            }
            @Override public void removeExplorerAccount(String id) {
                explorer.removeAccount(id);
                analysisConfig.removeAccount(id);
                scheduleRebuild();
            }
            @Override public ExplorerCoordinator.Snapshot startExplorer(ExplorerCoordinator.StartRequest request) {
                return explorer.start(request);
            }
            @Override public ExplorerCoordinator.Snapshot steerExplorer(String message) {
                return explorer.steer(message);
            }
            @Override public ExplorerCoordinator.Snapshot cancelExplorer() { return explorer.cancel(); }
            @Override public ExplorerCoordinator.Snapshot clearExplorer() { return explorer.clear(); }
            @Override public ExplorerCoordinator.Snapshot recheckExplorerProvider() {
                return explorer.recheckProvider();
            }
            @Override public void rebuild() { scheduleRebuild(); }
            @Override public void clearTraffic() { clearRecords(); }
            @Override public void loadSample() { loadSampleProject(); }
            @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
                BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
                BurpXmlParser.retainInScope(parsed, scope);
                parsed.records.forEach(record -> {
                    record.requestPayload = internPayload(record.requestPayload);
                    record.responsePayload = internPayload(record.responsePayload);
                });
                synchronized (records) {
                    int room = Math.max(0, MAX_RECORDS - records.size());
                    records.addAll(parsed.records.subList(0, Math.min(room, parsed.records.size())));
                    droppedRecords.addAndGet(Math.max(0, parsed.records.size() - room));
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                scheduleRebuild();
                api.logging().logToOutput("FlowScope Web XML 가져오기: " + parsed.records.size()
                        + "건 · 건너뜀 " + parsed.skipped.size() + "건");
                return parsed;
            }
            @Override public BurpXmlParser.ParseResult importHar(byte[] har) throws Exception {
                BurpXmlParser.ParseResult parsed = HarParser.parseDetailed(har);
                BurpXmlParser.retainInScope(parsed, scope);
                parsed.records.forEach(record -> {
                    record.requestPayload = internPayload(record.requestPayload);
                    record.responsePayload = internPayload(record.responsePayload);
                });
                int parsedCount = parsed.records.size();
                int duplicateCount;
                synchronized (records) {
                    int room = Math.max(0, MAX_RECORDS - records.size());
                    List<RequestRecord> missing = RecordMerge.missing(records, parsed.records, parsed.records.size());
                    duplicateCount = parsed.records.size() - missing.size();
                    List<RequestRecord> added = missing.subList(0, Math.min(room, missing.size()));
                    records.addAll(added);
                    droppedRecords.addAndGet(Math.max(0, missing.size() - room));
                    parsed.records.clear();
                    parsed.records.addAll(added);
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                scheduleRebuild();
                api.logging().logToOutput("FlowScope ZAP HAR 가져오기: " + parsed.records.size()
                        + "/" + parsedCount + "건 추가 · 기존 중복 " + duplicateCount
                        + "건 · 건너뜀 " + parsed.skipped.size() + "건");
                return parsed;
            }
            @Override public RequestRecord openInRepeater(String evidenceId) {
                RequestRecord record = evidenceRecord(evidenceId);
                TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElse(null);
                boolean rawRequest = raw != null && raw.requestRetained();
                byte[] request = rawRequest ? raw.request()
                        : HttpMessageTextCodec.encodeEditedRequest(record.requestTextForEvidence());
                openDraftInRepeater(record, request, rawRequest);
                return record;
            }
            @Override public FlowScopeWebServer.RequestLabDraft requestLabDraft(String evidenceId) {
                RequestRecord record = evidenceRecord(evidenceId);
                TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElse(null);
                boolean rawRequest = raw != null && raw.requestRetained();
                boolean rawResponse = raw != null && raw.responseRetained();
                HttpMessageTextCodec.Decoded decodedRequest = rawRequest ? decodeRequest(raw, record.requestContentType)
                        : new HttpMessageTextCodec.Decoded(record.requestTextForEvidence(), false, null,
                        "마스킹된 저장 전문입니다.");
                HttpMessageTextCodec.Decoded decodedResponse = rawResponse ? decodeResponse(raw, record.responseContentType)
                        : new HttpMessageTextCodec.Decoded(record.responseTextForEvidence(), false, null,
                        "마스킹된 저장 전문입니다.");
                String request = decodedRequest.text();
                String response = decodedResponse.text();
                String message = raw == null
                        ? "이 Evidence의 메모리 원문이 없습니다(가져오기·메모리 상한/eviction 가능). 마스킹된 전문을 표시합니다."
                        : !rawRequest
                        ? "요청 원문이 메모리 상한을 초과해 보존되지 않았습니다. 마스킹된 전문을 표시합니다."
                        : !rawResponse
                        ? "응답 원문이 메모리 상한을 초과해 보존되지 않았습니다. 마스킹된 전문을 표시합니다."
                        : "원문은 현재 Burp 프로세스 메모리에서만 불러왔으며 저장·내보내기하지 않습니다.";
                if (rawRequest && !decodedRequest.editable()) message += " " + decodedRequest.note();
                String observedIdentity = analysisConfig.boundAccount(record.service, record.fp)
                        .map(io.flowscope.core.AccountProfile::label).orElse(record.idn == null ? "미확정" : record.idn);
                String reusableSession = analysisConfig.boundAccount(record.service, record.fp)
                        .flatMap(account -> sessionBroker.viewForAccount(account.id()))
                        .filter(view -> view.status() == SessionBroker.Status.ACTIVE)
                        .map(view -> view.accountLabel() + " · ACTIVE").orElse("없음");
                return new FlowScopeWebServer.RequestLabDraft(record.evidenceId, record.service,
                        request, response, rawRequest, rawResponse, decodedRequest.editable(),
                        decodedRequest.charset(), decodedResponse.charset(), observedIdentity, reusableSession, message);
            }
            @Override public FlowScopeWebServer.RequestLabResult sendRequestLab(
                    String evidenceId, String request, FlowScopeWebServer.CredentialMode credentialMode,
                    String accountId) {
                return executeHumanRequestLab(evidenceId, request, credentialMode, accountId);
            }
        }, port);
        webServer.start();
        api.logging().logToOutput("FlowScope Web UI ready: " + webServer.url());
    }

    /**
     * 저장된 마스킹 Request를 자동 전송하지 않고 Repeater 초안으로만 연다.
     * 인증정보를 재삽입하고 전송하는 최종 행위는 사용자가 Burp에서 수행한다.
     */
    private RequestRecord evidenceRecord(String evidenceId) {
        if (evidenceId == null || evidenceId.isBlank()) {
            throw new IllegalArgumentException("Evidence ID가 필요합니다.");
        }
        return latest.records.stream().filter(value -> value.evidenceId.equals(evidenceId))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("존재하지 않는 Evidence ID입니다."));
    }

    private void openDraftInRepeater(RequestRecord record, byte[] requestBytes, boolean raw) {
        if (requestBytes == null || requestBytes.length == 0) {
            throw new IllegalArgumentException("저장된 Request 전문이 없습니다.");
        }
        URI service = URI.create(record.service);
        if (service.getHost() == null) throw new IllegalArgumentException("대상 서비스를 확정할 수 없습니다.");
        boolean secure = "https".equalsIgnoreCase(service.getScheme());
        int port = service.getPort() >= 0 ? service.getPort() : secure ? 443 : 80;
        HttpService httpService = HttpService.httpService(service.getHost(), port, secure);
        HttpRequest draft = HttpRequest.httpRequest(httpService,
                burp.api.montoya.core.ByteArray.byteArray(requestBytes));
        api.repeater().sendToRepeater(draft, "FlowScope " + record.evidenceId);
        api.logging().logToOutput("FlowScope Repeater 초안 생성: " + record.evidenceId
                + (raw ? " (메모리 원문, 미전송)" : " (마스킹 전문, 미전송)"));
    }

    private com.fasterxml.jackson.databind.node.ObjectNode zapConnectionStatus() {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.node.ObjectNode body = mapper.createObjectNode();
        if (zapClient == null) {
            return body.put("connected", false).put("state", "STARTING")
                    .put("message", "FlowScope의 ZAP 제어면을 준비하는 중입니다.");
        }
        body.put("endpoint", zapClient.endpoint());
        body.put("apiKeyConfigured", zapClient.apiKeyConfigured());
        if (!zapClient.apiKeyConfigured()) {
            return body.put("connected", false).put("state", "KEY_MISSING")
                    .put("message", "FlowScope용 ZAP API key가 없습니다. key helper로 준비한 뒤 확장을 다시 로드하세요.");
        }
        try {
            com.fasterxml.jackson.databind.JsonNode response = mapper.readTree(zapClient.probeVersion());
            String version = response.path("version").asText("");
            String home = mapper.readTree(zapClient.zapHomePath()).path("zapHomePath").asText("");
            boolean managedRuntime = home.startsWith("/run/flowscope-zap/");
            body.put("managedRuntime", managedRuntime);
            if (!managedRuntime) {
                return body.put("connected", false).put("state", "WRONG_RUNTIME")
                        .put("version", version)
                        .put("message", "FlowScope Docker Chromium ZAP이 아닙니다. bundle의 zap-up helper를 실행하세요.");
            }
            body.put("connected", true).put("state", "CONNECTED").put("version", version)
                    .put("message", version.isBlank() ? "FlowScope Docker Chromium ZAP에 연결됐습니다."
                            : "FlowScope Docker Chromium ZAP " + version + "에 연결됐습니다.");
        } catch (Exception error) {
            String detail = error.getMessage() == null ? "" : error.getMessage();
            boolean auth = detail.contains("HTTP 401") || detail.contains("HTTP 403");
            body.put("connected", false).put("state", auth ? "AUTH_FAILED" : "UNREACHABLE")
                    .put("message", auth
                            ? "ZAP API는 응답했지만 API key가 일치하지 않습니다. FlowScope와 ZAP 설정을 맞춘 뒤 확장을 다시 로드하세요."
                            : "127.0.0.1의 FlowScope Docker ZAP에 연결할 수 없습니다. bundle의 zap-up helper를 실행하세요.");
        }
        return body;
    }

    private void startZapIntegration() {
        try {
            String zapKey = LocalZapApiKey.resolve(System.getProperty("flowscope.zap.key", ""),
                    System.getenv().getOrDefault("FLOWSCOPE_ZAP_API_KEY", ""),
                    System.getProperty("flowscope.zap.keyFile", ""),
                    Path.of(System.getProperty("user.home"), ".flowscope", "zap-api-key"));
            zapClient = new ZapClient(System.getProperty("flowscope.zap.url", "http://127.0.0.1:8089"),
                    zapKey);
            zapCampaign = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return latest; }
                @Override public Pipeline.Result completionSnapshot() { rebuildImmediately(); return latest; }
                @Override public long capturedCount(Source source, String runId, SourceDetail detail) {
                    synchronized (records) { return FlowScopeExtension.capturedCount(records, source, runId, detail); }
                }
                @Override public ScopePolicy scope() { return scope; }
                @Override public ZapClient zap() { return zapClient; }
                @Override public int scannerProxyPort() { return configuredScannerProxyPort(); }
                @Override public void scannerCapability(String runId, String capability) {
                    scannerCapabilityRunId = runId;
                    scannerCapability = capability;
                    scannerCapabilityRejectionRunId = runId;
                    scannerCapabilityRejections.set(0);
                }
                @Override public void clearScannerCapability(String runId) {
                    if (runId.equals(scannerCapabilityRunId)) {
                        scannerCapability = "";
                        scannerCapabilityRunId = "";
                    }
                }
                @Override public long scannerCapabilityRejections(String runId) {
                    return runId.equals(scannerCapabilityRejectionRunId) ? scannerCapabilityRejections.get() : 0;
                }
                @Override public void scannerDirectAuthentication(String runId, boolean enabled) {
                    if (enabled) scannerDirectAuthenticationRunId = runId;
                    else if (runId.equals(scannerDirectAuthenticationRunId)) {
                        scannerDirectAuthenticationRunId = "";
                    }
                }
                @Override public RunContextRegistry contexts() { return runContexts; }
                @Override public ZapAccountVault zapAccounts() { return zapAccounts; }
                @Override public boolean approve(String action, String target) {
                    return approveInBurp(action, target);
                }
            });
        } catch (Exception error) {
            api.logging().logToError("FlowScope ZAP 초기화 실패", error);
        }
    }

    private void resetIntegrationWorkflow() {
        if (zapCampaign != null) zapCampaign.resetWorkflow();
        executionLedger.clear();
    }

    private void resetExplorerSecrets() {
        if (explorer == null) return;
        try { explorer.cancel(); } catch (RuntimeException ignored) { }
        explorer.accounts().forEach(account -> analysisConfig.removeAccount(account.id()));
        explorer.clearAccounts();
        try { explorer.clear(); } catch (RuntimeException ignored) { }
    }

    private void resetZapSecrets() {
        zapAccounts.clear();
    }

    private boolean approveInBurp(String action, String target) {
        AtomicBoolean approved = new AtomicBoolean(false);
        Runnable prompt = () -> approved.set(JOptionPane.showConfirmDialog(controlTab,
                action + "을 실행할까요?\n\n대상: " + target
                        + "\n\n이 동작은 대상 상태를 변경하거나 부하를 줄 수 있습니다.",
                "FlowScope 명시적 승인", JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE)
                == JOptionPane.YES_OPTION);
        try {
            if (SwingUtilities.isEventDispatchThread()) prompt.run();
            else SwingUtilities.invokeAndWait(prompt);
            return approved.get();
        } catch (Exception e) {
            api.logging().logToError("FlowScope 승인 대화상자 실패", e);
            return false;
        }
    }

    private void shutdown() {
        if (webServer != null) webServer.close();
        if (explorer != null) explorer.close();
        if (zapCampaign != null) zapCampaign.close();
        zapAccounts.close();
        if (activeProjectDatabase != null && databaseSavedRevision.get() != revision.get()) {
            try {
                java.util.concurrent.Future<?> save = worker.submit(() -> {
                    try { saveActiveDatabase(); }
                    catch (IOException error) { throw new java.io.UncheckedIOException(error); }
                });
                save.get(10, TimeUnit.SECONDS);
            } catch (Exception error) {
                api.logging().logToError("FlowScope 종료 전 로컬 DB 저장 실패", error);
            }
        }
        worker.shutdownNow();
        proxyObservations.clear();
        toolObservations.clear();
        sessionBroker.close();
        rawExchanges.clear();
        clearRunContexts();
    }

    private void clearRunContexts() {
        runContexts.reset();
    }

    private FlowScopeWebServer.RequestLabResult executeHumanRequestLab(
            String evidenceId, String requestText, FlowScopeWebServer.CredentialMode credentialMode,
            String accountId) {
        RequestRecord seed = evidenceRecord(evidenceId);
        if (requestText == null || requestText.isBlank()) {
            throw new IllegalArgumentException("전송할 HTTP 요청 전문이 필요합니다.");
        }
        URI service = URI.create(seed.service);
        if (service.getHost() == null) throw new IllegalArgumentException("원본 대상 서비스를 확정할 수 없습니다.");
        boolean secure = "https".equalsIgnoreCase(service.getScheme());
        int port = service.getPort() >= 0 ? service.getPort() : secure ? 443 : 80;
        HttpService httpService = HttpService.httpService(service.getHost(), port, secure);
        TransientExchangeVault.Exchange rawSeed = rawExchanges.get(seed).orElse(null);
        HttpMessageTextCodec.Decoded decodedSeed = rawSeed != null && rawSeed.requestRetained()
                ? decodeRequest(rawSeed, seed.requestContentType) : null;
        boolean originalBytesUsed = decodedSeed != null && requestText.equals(decodedSeed.text());
        byte[] encodedRequestBytes = originalBytesUsed
                ? rawSeed.request() : HttpMessageTextCodec.encodeEditedRequest(requestText);
        if (encodedRequestBytes.length > RAW_REQUEST_LIMIT_BYTES) {
            throw new IllegalArgumentException("편집 요청은 " + RAW_REQUEST_LIMIT_BYTES + "바이트 이하만 허용됩니다.");
        }
        HttpRequest request = HttpRequest.httpRequest(httpService,
                burp.api.montoya.core.ByteArray.byteArray(encodedRequestBytes));
        if (!scope.allows(request.url())) {
            throw new IllegalArgumentException("편집 요청 경로가 현재 exact scope 밖입니다.");
        }

        if (credentialMode != FlowScopeWebServer.CredentialMode.ORIGINAL) {
            for (String header : SessionBroker.managedHeaderNames()) {
                request = request.withRemovedHeader(header);
            }
        }
        if (credentialMode == FlowScopeWebServer.CredentialMode.ACCOUNT) {
            if (accountId == null || accountId.isBlank()) {
                throw new IllegalArgumentException("등록 계정을 선택하세요.");
            }
            Map<String, String> sessionHeaders = sessionBroker.headersForAccount(
                    accountId, URI.create(request.url()), scope, java.time.Instant.now());
            for (Map.Entry<String, String> header : sessionHeaders.entrySet()) {
                request = request.withUpdatedHeader(header.getKey(), header.getValue());
            }
        }
        if (!originalBytesUsed && request.hasHeader("Content-Length")) {
            String actualLength = String.valueOf(request.body().length());
            if (!actualLength.equals(request.headerValue("Content-Length"))) {
                request = request.withUpdatedHeader("Content-Length", actualLength);
            }
        }

        var options = RequestOptions.requestOptions().withRedirectionMode(RedirectionMode.NEVER)
                .withUpstreamTLSVerification().withResponseTimeout(30_000);
        burp.api.montoya.http.message.HttpRequestResponse exchange;
        long started = System.nanoTime();
        controlledRequest.set(true);
        try { exchange = api.http().sendRequest(request, options); }
        finally { controlledRequest.remove(); }
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        if (exchange == null || !exchange.hasResponse() || exchange.response() == null) {
            throw new IllegalStateException("대상에서 HTTP 응답을 받지 못했습니다.");
        }

        var response = exchange.response();
        int responseBytes = response.toByteArray().length();
        String responseText = responseBytes <= RAW_RESPONSE_LIMIT_BYTES
                ? HttpMessageTextCodec.decode(response.toByteArray().getBytes(), response.bodyOffset(),
                response.headerValue("Content-Type")).text() : null;
        RequestRecord record = recordFrom(exchange.request(), response,
                new PortProfile(Source.HUMAN, SourceDetail.MANUAL_HTTP),
                System.currentTimeMillis(), false, "human-request-lab-" + System.currentTimeMillis(), null);
        record.phase = RunPhase.VALIDATION;
        record.executionTrust = io.flowscope.core.ExecutionTrust.CONTROLLED;
        record.orchestrator = Orchestrator.HUMAN;
        record.tool = ToolKind.BURP;
        if (credentialMode == FlowScopeWebServer.CredentialMode.ACCOUNT && !"anon".equals(record.fp)) {
            analysisConfig.bindSession(record.service, record.fp, accountId);
            List<String> setCookies = response.headers().stream()
                    .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                    .map(HttpHeader::value).toList();
            sessionBroker.observeResponse(sessionBroker.handleForAccount(accountId), URI.create(request.url()),
                    response.statusCode(), response.headerValue("Location"), boundedResponseBody(response), setCookies,
                    java.time.Instant.now());
        }
        synchronized (records) {
            if (records.size() >= MAX_RECORDS) throw new IllegalStateException("레코드 상한에 도달했습니다.");
            records.add(record);
            retainRawExchange(record, exchange.request(), response);
        }
        rebuildImmediately();
        int requestBytes = exchange.request().toByteArray().length();
        String displayResponse = responseBytes <= RAW_RESPONSE_LIMIT_BYTES ? responseText
                : "응답이 " + responseBytes + "바이트로 웹 표시 상한을 초과했습니다. Evidence에는 마스킹 요약만 보존했습니다.";
        return new FlowScopeWebServer.RequestLabResult(record.evidenceId, record.status, displayResponse,
                durationMs, requestBytes, responseBytes);
    }

    private ExplorerTransport.Response executeExplorerRequest(ExplorerTransport.Request input) throws Exception {
        URI target;
        try { target = URI.create(input.url()); }
        catch (RuntimeException error) { throw new IllegalArgumentException("Explorer 대상 URL이 올바르지 않습니다."); }
        if (!scope.allows(input.url())) throw new IllegalArgumentException("Explorer 요청이 exact scope 밖입니다.");
        boolean secure = "https".equalsIgnoreCase(target.getScheme());
        int port = target.getPort() >= 0 ? target.getPort() : secure ? 443 : 80;
        String host = target.getHost();
        if (host == null) throw new IllegalArgumentException("Explorer 대상 host를 확인할 수 없습니다.");
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        HttpService service = HttpService.httpService(host, port, secure);
        String path = target.getRawPath() == null || target.getRawPath().isBlank() ? "/" : target.getRawPath();
        if (target.getRawQuery() != null) path += "?" + target.getRawQuery();
        String authority = target.getRawAuthority();
        StringBuilder raw = new StringBuilder(input.method()).append(' ').append(path).append(" HTTP/1.1\r\n")
                .append("Host: ").append(authority).append("\r\n");
        boolean hasAccept = false;
        boolean hasConnection = false;
        for (Map.Entry<String, String> header : input.headers().entrySet()) {
            if (!safeHeader(header.getKey(), header.getValue())) {
                throw new IllegalArgumentException("Explorer HTTP 헤더가 올바르지 않습니다.");
            }
            if (header.getKey().equalsIgnoreCase("Host") || header.getKey().equalsIgnoreCase("Content-Length")) continue;
            hasAccept |= header.getKey().equalsIgnoreCase("Accept");
            hasConnection |= header.getKey().equalsIgnoreCase("Connection");
            raw.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
        }
        if (!hasAccept) raw.append("Accept: */*\r\n");
        if (!hasConnection) raw.append("Connection: close\r\n");
        if (input.body().length > 0) raw.append("Content-Length: ").append(input.body().length).append("\r\n");
        raw.append("\r\n");
        byte[] prefix = raw.toString().getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        byte[] bytes = java.util.Arrays.copyOf(prefix, prefix.length + input.body().length);
        System.arraycopy(input.body(), 0, bytes, prefix.length, input.body().length);
        HttpRequest request = HttpRequest.httpRequest(service, burp.api.montoya.core.ByteArray.byteArray(bytes));
        RequestOptions options = RequestOptions.requestOptions().withRedirectionMode(RedirectionMode.NEVER)
                .withUpstreamTLSVerification().withResponseTimeout(30_000);
        long startedAt = System.nanoTime();
        Instant attemptedAt = Instant.now();
        try {
            controlledRequest.set(true);
            burp.api.montoya.http.message.HttpRequestResponse exchange = api.http().sendRequest(request, options);
            long duration = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
            if (exchange == null || !exchange.hasResponse() || exchange.response() == null) {
                if (!input.sessionSetup()) {
                    executionLedger.record(Source.LLM, input.runId(), emptyToNull(input.accountId()), input.method(),
                            input.url(), RunExecutionLedger.Outcome.NO_RESPONSE, 0, null, attemptedAt, duration);
                }
                throw new IllegalStateException("대상에서 HTTP 응답을 받지 못했습니다.");
            }
            HttpResponse response = exchange.response();
            Map<String, List<String>> responseHeaders = new LinkedHashMap<>();
            for (HttpHeader header : response.headers()) {
                responseHeaders.computeIfAbsent(header.name(), ignored -> new ArrayList<>()).add(header.value());
            }
            burp.api.montoya.core.ByteArray responseBody = response.body();
            int explorerBodyLimit = 4 * 1024 * 1024;
            int copiedBody = Math.min(responseBody.length(), explorerBodyLimit);
            byte[] responseBodyBytes = copiedBody == responseBody.length()
                    ? responseBody.getBytes() : responseBody.subArray(0, copiedBody).getBytes();
            String decoded = HttpMessageTextCodec.decode(responseBodyBytes, 0,
                    response.headerValue("Content-Type")).text();
            // Login requests may use target-specific password field names and token response shapes.
            // They are consumed only by the in-memory vault and never become records, payloads, ledger
            // entries, snapshots, or project data.
            if (input.sessionSetup()) {
                return new ExplorerTransport.Response(response.statusCode(), exchange.request().url(),
                        response.headerValue("Location"), response.headerValue("Content-Type"), responseHeaders,
                        decoded, copiedBody < responseBody.length(), "", duration, Instant.now());
            }
            RequestRecord record = recordFrom(exchange.request(), response,
                    new PortProfile(Source.LLM, SourceDetail.LLM_EXPLORER), System.currentTimeMillis(),
                    false, input.runId(), null, emptyToNull(input.accountId()));
            record.sourceDetail = SourceDetail.LLM_EXPLORER;
            record.orchestrator = Orchestrator.LLM;
            record.tool = ToolKind.CODEX;
            record.phase = RunPhase.EXPLORATION;
            record.executionTrust = io.flowscope.core.ExecutionTrust.CONTROLLED;
            record.runId = input.runId();
            record.laneAccountId = emptyToNull(input.accountId());
            synchronized (records) {
                if (records.size() >= MAX_RECORDS) throw new IllegalStateException("레코드 상한에 도달했습니다.");
                records.add(record);
            }
            rebuildImmediately();
            RequestRecord published = latest.records.stream().filter(value -> value.runtimeId() == record.runtimeId())
                    .findFirst().orElseThrow(() -> new IllegalStateException("Explorer Evidence 게시에 실패했습니다."));
            executionLedger.record(Source.LLM, input.runId(), emptyToNull(input.accountId()), input.method(),
                    input.url(), RunExecutionLedger.Outcome.HTTP_RESPONSE, response.statusCode(),
                    published.evidenceId, attemptedAt, duration);
            return new ExplorerTransport.Response(response.statusCode(), exchange.request().url(),
                    response.headerValue("Location"), response.headerValue("Content-Type"), responseHeaders,
                    decoded, copiedBody < responseBody.length(), published.evidenceId, duration, Instant.now());
        } catch (Exception error) {
            long duration = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
            if (!input.sessionSetup() && (executionLedger.summarize(Source.LLM, input.runId()).attempted() == 0
                    || executionLedger.attempts().stream().noneMatch(value -> value.runId().equals(input.runId())
                    && value.attemptedAt().equals(attemptedAt)))) {
                executionLedger.record(Source.LLM, input.runId(), emptyToNull(input.accountId()), input.method(),
                        input.url(), executionOutcome(error), 0, null, attemptedAt, duration);
            }
            throw error;
        } finally {
            controlledRequest.remove();
        }
    }

    private static boolean safeHeader(String name, String value) {
        return name != null && !name.isBlank() && name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
                && value != null && value.indexOf('\r') < 0 && value.indexOf('\n') < 0;
    }

    private static RunExecutionLedger.Outcome executionOutcome(Exception error) {
        String text = (error.getClass().getName() + " " + error.getMessage()).toLowerCase(Locale.ROOT);
        if (text.contains("ssl") || text.contains("certificate") || text.contains("tls")) return RunExecutionLedger.Outcome.TLS_FAILURE;
        if (text.contains("unknownhost") || text.contains("dns")) return RunExecutionLedger.Outcome.DNS_FAILURE;
        if (text.contains("timeout") || text.contains("timed out")) return RunExecutionLedger.Outcome.TIMEOUT;
        if (text.contains("connect")) return RunExecutionLedger.Outcome.CONNECTION_FAILURE;
        return RunExecutionLedger.Outcome.OTHER_FAILURE;
    }

    private void retainRawExchange(RequestRecord record, HttpRequest request, HttpResponse response) {
        burp.api.montoya.core.ByteArray requestMessage = request.toByteArray();
        burp.api.montoya.core.ByteArray responseMessage = response.toByteArray();
        int requestBytes = requestMessage.length();
        int responseBytes = responseMessage.length();
        rawExchanges.put(record,
                requestBytes <= RAW_REQUEST_LIMIT_BYTES ? requestMessage.getBytes() : null,
                request.bodyOffset(), requestBytes,
                responseBytes <= RAW_RESPONSE_LIMIT_BYTES ? responseMessage.getBytes() : null,
                response.bodyOffset(), responseBytes);
    }

    private static String boundedResponseBody(HttpResponse response) {
        burp.api.montoya.core.ByteArray body = response.body();
        int copied = Math.min(body.length(), CAPTURE_PREVIEW_BYTES);
        byte[] bytes = copied == body.length() ? body.getBytes() : body.subArray(0, copied).getBytes();
        return HttpMessageTextCodec.decode(bytes, 0, response.headerValue("Content-Type")).text();
    }

    private static HttpMessageTextCodec.Decoded decodeRequest(TransientExchangeVault.Exchange exchange,
                                                               String contentType) {
        return HttpMessageTextCodec.decode(exchange.request(), exchange.requestBodyOffset(), contentType);
    }

    private static HttpMessageTextCodec.Decoded decodeResponse(TransientExchangeVault.Exchange exchange,
                                                                String contentType) {
        return HttpMessageTextCodec.decode(exchange.response(), exchange.responseBodyOffset(), contentType);
    }

    private static String bodyText(String message, int bodyOffset) {
        if (message == null || message.isEmpty()) return null;
        int crlf = message.indexOf("\r\n\r\n");
        if (crlf >= 0) return message.substring(crlf + 4);
        int lf = message.indexOf("\n\n");
        if (lf >= 0) return message.substring(lf + 2);
        return bodyOffset >= 0 && bodyOffset <= message.length() ? message.substring(bodyOffset) : null;
    }

    private void rebuildImmediately() {
        long analysisEpoch = analysisPublication.invalidate();
        List<RequestRecord> snapshot;
        synchronized (records) { snapshot = new ArrayList<>(records); }
        Pipeline.Result result = Pipeline.runIsolated(snapshot, analysisConfig);
        publishAnalysis(analysisEpoch, result);
    }

    private boolean publishAnalysis(long analysisEpoch, Pipeline.Result result) {
        List<RouteCandidate> candidates = routeCandidatesFor(result.records);
        boolean published = analysisPublication.publishIfCurrent(analysisEpoch, () -> {
            latest = result;
            routeCandidates = candidates;
            revision.incrementAndGet();
        });
        if (published) {
            if (controlTab != null) controlTab.render(result);
            scheduleDatabaseSave();
        }
        return published;
    }

    private void rebuildRouteCandidates(List<RequestRecord> sourceRecords) {
        routeCandidates = routeCandidatesFor(sourceRecords);
    }

    private List<RouteCandidate> routeCandidatesFor(List<RequestRecord> sourceRecords) {
        List<RouteCandidateExtractor.Seed> seeds;
        synchronized (siteMapSeeds) { seeds = List.copyOf(siteMapSeeds); }
        List<RouteCandidate> extracted = RouteCandidateExtractor.extract(sourceRecords, scope, seeds);
        List<RouteCandidate> restored;
        synchronized (restoredRouteCandidates) { restored = List.copyOf(restoredRouteCandidates); }
        List<RouteCandidate> combined = new ArrayList<>(restored);
        combined.addAll(extracted);
        return RouteCandidateExtractor.prioritized(combined);
    }

    private static String shortDigest(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest, 0, 8);
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }
}
