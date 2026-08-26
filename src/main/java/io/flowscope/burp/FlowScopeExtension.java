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
import io.flowscope.core.AuthorizationAnalysis;
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
import io.flowscope.integration.McpServer;
import io.flowscope.integration.LocalMcpToken;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.ZapClient;
import io.flowscope.integration.SessionBroker;
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
import java.net.URI;

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

    private static final Pattern PORT = Pattern.compile(":(\\d+)$");

    /** 저장 본문 상한 — 메모리 폭증 방지. */
    private static final int MAX_BODY = 8192;

    /** 메모리 상한 — 실제 프록시 트래픽에서 무제한 누적을 막는다. */
    private static final int MAX_RECORDS = 20_000;
    /** 갱신 병합 지연: 이 시간 안의 연속 관측은 한 번만 재구성한다. */
    private static final long REBUILD_DELAY_MS = 400;

    private final List<RequestRecord> records = new ArrayList<>();
    private final AnalysisConfig analysisConfig = new AnalysisConfig();
    private final RunContextRegistry runContexts = new RunContextRegistry();
    private final SessionBroker sessionBroker = new SessionBroker();
    private final ProjectStore projectStore = new ProjectStore();
    private volatile Pipeline.Result latest = Pipeline.run(List.of(), analysisConfig);
    private volatile List<RouteCandidate> routeCandidates = List.of();
    private final List<RouteCandidateExtractor.Seed> siteMapSeeds = new ArrayList<>();
    private final List<RouteCandidate> restoredRouteCandidates = new ArrayList<>();
    private volatile ScopePolicy scope = ScopePolicy.parse("");
    private volatile String scopeText = "";
    private final AtomicLong revision = new AtomicLong();
    private FlowScopeControlTab controlTab;
    private FlowScopeWebServer webServer;
    private McpServer mcpServer;
    private ZapClient zapClient;
    private final ScheduledExecutorService worker =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "flowscope-rebuild");
                t.setDaemon(true);
                return t;
            });
    private final AtomicBoolean rebuildPending = new AtomicBoolean(false);
    private boolean capacityWarned;
    private MontoyaApi api;
    private final ThreadLocal<Boolean> controlledRequest = ThreadLocal.withInitial(() -> false);
    private final Map<Integer, ProxyObservation> proxyObservations = new ConcurrentHashMap<>();

    /** 요청 시점의 run/account 문맥. ZAP lane 전환 뒤 늦게 도착한 응답도 원래 신원에 귀속한다. */
    private record ProxyObservation(RunContextRegistry.Context context, String humanCaptureAccountId,
                                    long startedAt) {}
    private static final int MAX_IN_FLIGHT_PROXY_OBSERVATIONS = 20_000;
    private static final long IN_FLIGHT_CONTEXT_TTL_MS = 10 * 60_000L;

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("FlowScope");
        configureInitialScope();
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
        startMcp();
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
                rememberProxyObservation(request.messageId(), context, captureAccountId);
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

    /** 프록시 트래픽: 리스너 포트로 소스를 구분한다 (F-01). */
    private final class ProxyHandler implements ProxyResponseHandler {
        @Override
        public ProxyResponseReceivedAction handleResponseReceived(InterceptedResponse response) {
            try {
                PortProfile profile = profileOf(response.listenerInterface());
                ProxyObservation observation = proxyObservations.remove(response.messageId());
                capture(response.initiatingRequest(), response.statusCode(), profile,
                        response.bodyToString(), response.toString(), response.headerValue("Location"),
                        response.headerValue("Content-Type"), observation);
                observeSessionResponse(profile, response.initiatingRequest(), response.statusCode(),
                        response.headerValue("Location"), response.bodyToString(), response.headers(), observation);
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
            return RequestToBeSentAction.continueWith(req);
        }

        @Override
        public ResponseReceivedAction handleHttpResponseReceived(HttpResponseReceived response) {
            try {
                ToolType tool = response.toolSource().toolType();
                if (tool != ToolType.PROXY && !controlledRequest.get()) {   // 프록시/통제 실행은 별도 담당
                    Source source = sourceOfTool(tool);
                    capture(response.initiatingRequest(), response.statusCode(),
                            new PortProfile(source, detailOfTool(tool)), response.bodyToString(),
                            response.toString(), response.headerValue("Location"),
                            response.headerValue("Content-Type"));
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

    private void capture(HttpRequest req, int status, PortProfile profile,
                         String respBody, String respText, String location, String responseContentType) {
        capture(req, status, profile, respBody, respText, location, responseContentType, null);
    }

    private void capture(HttpRequest req, int status, PortProfile profile,
                         String respBody, String respText, String location, String responseContentType,
                         ProxyObservation observation) {
        if (!ActiveTrafficGuard.allowsCapture(scope, req.url())) return;
        RequestRecord rec = recordFrom(req, status, profile, respBody, respText, location, responseContentType,
                System.currentTimeMillis(), true, null, observation);

        // 프록시 콜백은 즉시 반환한다: 여기서 정규화/그래프 재구성을 하면 트래픽마다 O(N) → 누적 O(N²).
        synchronized (records) {
            if (records.size() >= MAX_RECORDS) {
                if (!capacityWarned) {
                    api.logging().logToOutput("FlowScope: 레코드 상한 " + MAX_RECORDS + " 도달 — 이후 관측은 버립니다.");
                    capacityWarned = true;
                }
                return;
            }
            records.add(rec);
        }
        scheduleRebuild();
    }

    private RequestRecord recordFrom(HttpRequest req, int status, PortProfile profile,
                                     String respBody, String respText, String location, String responseContentType,
                                     long timestamp, boolean applyRunContext, String runId,
                                     ProxyObservation observation) {
        String service = serviceOf(req);
        RunContextRegistry.Context context = !applyRunContext ? null : observation == null
                ? runContexts.current(profile.source()) : observation.context();
        String humanCaptureAccountId = profile.source() != Source.HUMAN ? null : observation == null
                ? sessionBroker.activeCaptureForService(service).flatMap(sessionBroker::accountForHandle).orElse(null)
                : observation.humanCaptureAccountId();
        String detectedAccountId = sessionBroker.accountForRequest(URI.create(req.url()), headersOf(req.headers()),
                java.time.Instant.now()).orElse(null);
        String accountId = resolveObservedAccount(profile.source(), context == null ? null : context.accountId(),
                humanCaptureAccountId, detectedAccountId);
        String fp = captureFingerprint(profile.source(), context, accountId,
                req.headerValue("Authorization"), req.headerValue("Cookie"));
        RequestRecord rec = new RequestRecord(
                profile.source(), service, req.method(), req.pathWithoutQuery(), status, fp);
        rec.sourceDetail = profile.detail();
        rec.orchestrator = profile.source() == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        rec.tool = profile.source() == Source.SCANNER ? ToolKind.ZAP
                : profile.source() == Source.LLM ? ToolKind.OTHER
                : profile.source() == Source.HUMAN ? ToolKind.BROWSER : ToolKind.UNKNOWN;
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
            rec.sourceDetail = context.detail();
            rec.orchestrator = context.orchestrator();
            rec.tool = context.tool();
            rec.phase = context.phase();
            rec.runId = context.runId();
        }
        if (accountId != null && !"anon".equals(fp)) {
            try { analysisConfig.bindSession(rec.service, fp, accountId); }
            catch (RuntimeException error) { api.logging().logToError("FlowScope 세션 신원 연결 실패", error); }
        }
        // 명세가 입력으로 요구하는 데이터 (F-06 쿼리·본문 / F-09 ID·시각 / F-18·22 원요청).
        // 저장 전 반드시 마스킹 (F-05 원문 토큰 저장 금지, F-22 인증정보 가림).
        rec.query = Masking.truncate(Masking.maskBody(emptyToNull(req.query()),
                "application/x-www-form-urlencoded"), MAX_BODY);
        rec.reqBody = Masking.truncate(Masking.maskBody(req.bodyToString(), req.headerValue("Content-Type")), MAX_BODY);
        rec.reqText = Masking.truncate(Masking.maskHeaders(req.toString()), MAX_BODY);
        rec.requestContentType = emptyToNull(req.headerValue("Content-Type"));
        rec.responseContentType = emptyToNull(responseContentType);
        rec.secFetchDest = emptyToNull(req.headerValue("Sec-Fetch-Dest"));
        rec.secFetchMode = emptyToNull(req.headerValue("Sec-Fetch-Mode"));
        rec.accessControlRequestMethod = emptyToNull(req.headerValue("Access-Control-Request-Method"));
        rec.timestamp = timestamp;
        rec.body = Masking.truncate(Masking.maskBody(respBody, responseContentType), MAX_BODY);
        rec.respText = Masking.truncate(Masking.maskHeaders(respText), MAX_BODY);
        rec.location = Masking.truncate(Masking.maskSecrets(location), MAX_BODY);
        // 이 메서드는 응답 수신 콜백에서만 호출된다. 204/빈 본문도 실제 응답이다.
        rec.hasResponse = true;
        return rec;
    }

    /** 재구성을 워커 스레드에서 수행하고, 대기 중 갱신은 하나로 합친다(EDT·콜백 부하 방지). */
    private void scheduleRebuild() {
        if (!rebuildPending.compareAndSet(false, true)) return;  // 이미 예약됨 → 합치기
        worker.schedule(() -> {
            rebuildPending.set(false);
            try {
                List<RequestRecord> snapshot;
                synchronized (records) { snapshot = new ArrayList<>(records); }
                Pipeline.Result result = Pipeline.run(snapshot, analysisConfig);
                latest = result;
                rebuildRouteCandidates(result.records);
                revision.incrementAndGet();
                if (controlTab != null) controlTab.render(result);
            } catch (Exception e) {
                api.logging().logToError("FlowScope 그래프 갱신 실패", e);
            }
        }, REBUILD_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    private static String emptyToNull(String s) { return (s == null || s.isBlank()) ? null : s; }

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

    private void rememberProxyObservation(int messageId, RunContextRegistry.Context context,
                                          String humanCaptureAccountId) {
        long now = System.currentTimeMillis();
        if (proxyObservations.size() >= MAX_IN_FLIGHT_PROXY_OBSERVATIONS) {
            proxyObservations.entrySet().removeIf(entry ->
                    now - entry.getValue().startedAt() > IN_FLIGHT_CONTEXT_TTL_MS);
        }
        if (proxyObservations.size() >= MAX_IN_FLIGHT_PROXY_OBSERVATIONS) {
            api.logging().logToOutput("FlowScope: in-flight 프록시 문맥 상한 도달 — 해당 요청은 응답 시 현재 문맥으로 처리합니다.");
            return;
        }
        proxyObservations.put(messageId, new ProxyObservation(context, humanCaptureAccountId, now));
    }

    private void observeSessionResponse(PortProfile profile, HttpRequest request, int status,
                                        String location, String body, List<HttpHeader> headers,
                                        ProxyObservation observation) {
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
            } else if (context != null && context.accountId() != null) {
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

    private static RunPhase phaseOf(SourceDetail detail) {
        return switch (detail) {
            case LLM_EXPLORER, ZAP_SPIDER, ZAP_AJAX_SPIDER, ZAP_CLIENT_SPIDER, ZAP_PASSIVE_SCAN, ZAP_ACTIVE_SCAN,
                    OTHER_SCANNER -> RunPhase.EXPLORATION;
            case LLM_COACH_PROBE -> RunPhase.COACH_PROBE;
            case LLM_VALIDATION -> RunPhase.VALIDATION;
            case XML_IMPORT -> RunPhase.IMPORT;
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
                    incoming.add(recordFrom(request, response.statusCode(), profile,
                            response.bodyToString(), response.toString(), response.headerValue("Location"),
                            response.headerValue("Content-Type"), timestamp, false, runId, null));
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
                synchronized (records) {
                    int room = Math.max(0, MAX_RECORDS - records.size());
                    added = RecordMerge.missing(records, incoming, room);
                    records.addAll(added);
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                synchronized (siteMapSeeds) {
                    siteMapSeeds.clear();
                    siteMapSeeds.addAll(importedSiteMapSeeds);
                }
                rebuildRouteCandidates(latest.records);
                int duplicateCount = incoming.size() - added.size();
                String message = "Proxy history " + history.size() + "건 중 " + added.size()
                        + "건 가져옴 · 기존 관측/상한 " + duplicateCount + "건 건너뜀 · 응답 없음 "
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
                clearRunContexts();
                sessionBroker.close();
                synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
                synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
                SampleProject.Data sample = SampleProject.create();
                analysisConfig.replaceWith(sample.config());
                List<RequestRecord> loaded = new ArrayList<>(sample.records());
                Pipeline.Result result = Pipeline.run(loaded, analysisConfig);
                synchronized (records) {
                    records.clear();
                    records.addAll(loaded);
                    capacityWarned = false;
                }
                latest = result;
                rebuildRouteCandidates(result.records);
                revision.incrementAndGet();
                if (mcpServer != null) mcpServer.clearAssessments();
                if (mcpServer != null) mcpServer.clearValidations();
                if (mcpServer != null) mcpServer.resetWorkflow();
                if (controlTab != null) controlTab.render(result);
                api.logging().logToOutput("FlowScope 샘플 프로젝트 열기: " + loaded.size()
                        + "건 · 실제 네트워크 요청 없음");
            } catch (Exception e) {
                projectError("샘플 프로젝트 열기 실패", e);
            }
        });
    }

    private void clearRecords() {
        clearRunContexts();
        synchronized (records) {
            records.clear();
            capacityWarned = false;
        }
        synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
        synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
        routeCandidates = List.of();
        analysisConfig.clearReviews();
        latest = Pipeline.run(List.of(), analysisConfig);
        revision.incrementAndGet();
        if (mcpServer != null) mcpServer.clearAssessments();
        if (mcpServer != null) mcpServer.clearValidations();
        if (mcpServer != null) mcpServer.resetWorkflow();
        if (controlTab != null) controlTab.render(latest);
        api.logging().logToOutput("FlowScope 수집 데이터가 삭제되었습니다.");
    }

    private void saveProjectFile(File file) {
        worker.execute(() -> {
            try {
                List<RequestRecord> snapshot;
                synchronized (records) { snapshot = new ArrayList<>(records); }
                List<McpServer.Assessment> assessments = mcpServer == null ? List.of() : mcpServer.assessments();
                List<ValidationDecision> validations = mcpServer == null ? List.of() : mcpServer.validations();
                projectStore.save(file.toPath(), snapshot, analysisConfig, assessments, validations,
                        runContexts.completedExplorations(), routeCandidates);
                api.logging().logToOutput("FlowScope 프로젝트 저장: " + file);
            } catch (Exception e) {
                projectError("프로젝트 저장 실패", e);
            }
        });
    }

    private void loadProjectFile(File file) {
        worker.execute(() -> {
            try {
                clearRunContexts();
                sessionBroker.close();
                synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
                synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
                ProjectStore.ProjectData data = projectStore.load(file.toPath());
                analysisConfig.replaceWith(data.config());
                List<RequestRecord> loaded = new ArrayList<>(data.records());
                Pipeline.Result result = Pipeline.run(loaded, analysisConfig);
                synchronized (restoredRouteCandidates) {
                    restoredRouteCandidates.addAll(data.routeCandidates().stream()
                            .filter(candidate -> !candidate.observed()).toList());
                }
                Set<String> evidenceIds = result.records.stream().map(r -> r.evidenceId)
                        .collect(java.util.stream.Collectors.toSet());
                List<McpServer.Assessment> assessments = data.assessments().stream()
                        .filter(a -> evidenceIds.containsAll(a.evidenceIds())).toList();
                Set<String> candidateIds = result.analysis.findings().stream().map(AuthorizationAnalysis.Finding::id)
                        .collect(java.util.stream.Collectors.toSet());
                List<ValidationDecision> validations = data.validations().stream()
                        .filter(value -> candidateIds.contains(value.candidateId()))
                        .filter(value -> evidenceIds.containsAll(value.allEvidenceIds())).toList();
                synchronized (records) {
                    records.clear();
                    records.addAll(loaded);
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                latest = result;
                rebuildRouteCandidates(result.records);
                revision.incrementAndGet();
                if (mcpServer != null) mcpServer.resetWorkflow();
                if (mcpServer != null) mcpServer.replaceAssessments(assessments);
                if (mcpServer != null) mcpServer.replaceValidations(validations);
                runContexts.restoreCompleted(data.completedLanes());
                if (controlTab != null) controlTab.render(result);
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
        } catch (IllegalArgumentException e) {
            SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(controlTab, e.getMessage(),
                    "FlowScope 범위 오류", JOptionPane.ERROR_MESSAGE));
        }
    }

    private void applyScope(String value) {
        ScopePolicy parsed = ScopePolicy.parse(value);
        scope = parsed;
        scopeText = value == null ? "" : value;
        synchronized (siteMapSeeds) { siteMapSeeds.removeIf(seed -> !parsed.allows(seed.url())); }
        synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
        rebuildRouteCandidates(latest.records);
        if (controlTab != null) SwingUtilities.invokeLater(() -> controlTab.setScopeText(scopeText));
        api.logging().logToOutput("FlowScope 허용 범위 갱신: " + parsed.entries());
    }

    private void startWebUi() throws Exception {
        int port = Integer.getInteger("flowscope.web.port", 17777);
        webServer = new FlowScopeWebServer(new FlowScopeWebServer.State() {
            @Override public Pipeline.Result snapshot() { return latest; }
            @Override public long revision() { return revision.get(); }
            @Override public AnalysisConfig config() { return analysisConfig; }
            @Override public List<McpServer.Assessment> assessments() {
                return mcpServer == null ? List.of() : mcpServer.assessments();
            }
            @Override public List<ValidationDecision> validations() {
                return mcpServer == null ? List.of() : mcpServer.validations();
            }
            @Override public RunContextRegistry contexts() { return runContexts; }
            @Override public SessionBroker sessions() { return sessionBroker; }
            @Override public List<String> scopeEntries() { return scope.entries(); }
            @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
            @Override public com.fasterxml.jackson.databind.JsonNode startScanner(String target,
                                                                                   List<String> accountIds,
                                                                                   boolean includeAnonymous) {
                if (mcpServer == null) throw new IllegalStateException("MCP/스캐너 제어면이 아직 준비되지 않았습니다.");
                return mcpServer.startDeterministicZapCampaign(target, accountIds, includeAnonymous);
            }
            @Override public com.fasterxml.jackson.databind.JsonNode scannerStatus() {
                return mcpServer == null
                        ? new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("status", "NOT_STARTED")
                        : mcpServer.deterministicZapBaselineStatus();
            }
            @Override public void rebuild() { scheduleRebuild(); }
            @Override public void clearTraffic() { clearRecords(); }
            @Override public void loadSample() { loadSampleProject(); }
            @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
                BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
                BurpXmlParser.retainInScope(parsed, scope);
                synchronized (records) {
                    int room = Math.max(0, MAX_RECORDS - records.size());
                    records.addAll(parsed.records.subList(0, Math.min(room, parsed.records.size())));
                    capacityWarned = records.size() >= MAX_RECORDS;
                }
                scheduleRebuild();
                api.logging().logToOutput("FlowScope Web XML 가져오기: " + parsed.records.size()
                        + "건 · 건너뜀 " + parsed.skipped.size() + "건");
                return parsed;
            }
            @Override public RequestRecord openInRepeater(String evidenceId) {
                RequestRecord record = latest.records.stream().filter(value -> value.evidenceId.equals(evidenceId))
                        .findFirst().orElseThrow(() -> new IllegalArgumentException("존재하지 않는 Evidence ID입니다."));
                openMaskedDraftInRepeater(record);
                return record;
            }
        }, port);
        webServer.start();
        api.logging().logToOutput("FlowScope Web UI ready: " + webServer.url());
    }

    /**
     * 저장된 마스킹 Request를 자동 전송하지 않고 Repeater 초안으로만 연다.
     * 인증정보를 재삽입하고 전송하는 최종 행위는 사용자가 Burp에서 수행한다.
     */
    private void openMaskedDraftInRepeater(RequestRecord record) {
        if (record == null || record.reqText == null || record.reqText.isBlank()) {
            throw new IllegalArgumentException("저장된 Request 전문이 없습니다.");
        }
        URI service = URI.create(record.service);
        if (service.getHost() == null) throw new IllegalArgumentException("대상 서비스를 확정할 수 없습니다.");
        boolean secure = "https".equalsIgnoreCase(service.getScheme());
        int port = service.getPort() >= 0 ? service.getPort() : secure ? 443 : 80;
        HttpService httpService = HttpService.httpService(service.getHost(), port, secure);
        HttpRequest draft = HttpRequest.httpRequest(httpService, record.reqText);
        api.repeater().sendToRepeater(draft, "FlowScope " + record.evidenceId);
        api.logging().logToOutput("FlowScope Repeater 초안 생성: " + record.evidenceId
                + " (인증정보 마스킹, 미전송)");
    }

    private void startMcp() {
        try {
            zapClient = new ZapClient(System.getProperty("flowscope.zap.url", "http://127.0.0.1:8089"),
                    System.getProperty("flowscope.zap.key", ""));
            int port = Integer.getInteger("flowscope.mcp.port", 8787);
            String configuredToken = System.getProperty("flowscope.mcp.token", "").trim();
            if (configuredToken.isBlank()) configuredToken = System.getenv().getOrDefault("FLOWSCOPE_MCP_TOKEN", "").trim();
            if (configuredToken.isBlank()) {
                String configuredPath = System.getProperty("flowscope.mcp.tokenFile", "").trim();
                Path tokenPath = configuredPath.isBlank()
                        ? Path.of(System.getProperty("user.home"), ".flowscope", "mcp-token")
                        : Path.of(configuredPath);
                configuredToken = LocalMcpToken.readIfPresent(tokenPath);
            }
            mcpServer = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return latest; }
                @Override public ScopePolicy scope() { return scope; }
                @Override public void updateScope(String value) { applyScope(value); }
                @Override public ZapClient zap() { return zapClient; }
                @Override public RunContextRegistry contexts() { return runContexts; }
                @Override public AnalysisConfig config() { return analysisConfig; }
                @Override public SessionBroker sessions() { return sessionBroker; }
                @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                    return executeControlledRequest(request);
                }
                @Override public boolean approve(String action, String target) {
                    return approveInBurp(action, target);
                }
                @Override public void assessmentsChanged(List<McpServer.Assessment> values) {
                    revision.incrementAndGet();
                }
                @Override public void validationsChanged(List<ValidationDecision> values) {
                    revision.incrementAndGet();
                }
            }, port, configuredToken);
            mcpServer.start();
            String connection = "http://127.0.0.1:" + mcpServer.port() + "/mcp · Bearer " + mcpServer.token();
            if (controlTab != null) controlTab.setMcpStatus(connection);
            api.logging().logToOutput("FlowScope MCP ready: http://127.0.0.1:" + mcpServer.port()
                    + "/mcp (Bearer 토큰은 FlowScope 탭에서 확인)");
        } catch (Exception e) {
            api.logging().logToError("FlowScope MCP 시작 실패", e);
            if (controlTab != null) controlTab.setMcpStatus("비활성 — " + e.getMessage());
        }
    }

    private boolean approveInBurp(String action, String target) {
        AtomicBoolean approved = new AtomicBoolean(false);
        Runnable prompt = () -> approved.set(JOptionPane.showConfirmDialog(controlTab,
                action + "을 실행할까요?\n\n대상: " + target
                        + "\n\n활성 스캔은 대상 상태를 변경하거나 부하를 줄 수 있습니다.",
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
        if (mcpServer != null) mcpServer.close();
        worker.shutdownNow();
        proxyObservations.clear();
        sessionBroker.close();
        clearRunContexts();
    }

    private void clearRunContexts() {
        runContexts.reset();
    }

    private McpServer.TargetResult executeControlledRequest(McpServer.TargetRequest input) {
        RunContextRegistry.Context context = runContexts.current(Source.LLM);
        if (context == null) throw new IllegalStateException("LLM run is not active");
        URI target = URI.create(input.target());
        if (!scope.allows(target.toString())) throw new IllegalArgumentException("target is outside configured scope");
        HttpRequest request = HttpRequest.httpRequestFromUrl(target.toString()).withMethod(input.method());
        for (Map.Entry<String, String> header : input.headers().entrySet()) {
            request = request.withUpdatedHeader(header.getKey(), header.getValue());
        }
        Map<String, String> sessionHeaders = Map.of();
        if (input.accountId() != null) {
            sessionHeaders = sessionBroker.headersForAccount(input.accountId(), target, scope, java.time.Instant.now());
            for (Map.Entry<String, String> header : sessionHeaders.entrySet()) {
                request = request.withUpdatedHeader(header.getKey(), header.getValue());
            }
        }
        if (input.body() != null) request = request.withBody(input.body());

        var options = RequestOptions.requestOptions().withRedirectionMode(RedirectionMode.NEVER)
                .withUpstreamTLSVerification().withResponseTimeout(30_000);
        burp.api.montoya.http.message.HttpRequestResponse exchange;
        controlledRequest.set(true);
        try { exchange = api.http().sendRequest(request, options); }
        finally { controlledRequest.remove(); }
        if (exchange == null || !exchange.hasResponse() || exchange.response() == null) {
            throw new IllegalStateException("target did not return an HTTP response");
        }
        var response = exchange.response();
        RequestRecord record = recordFrom(exchange.request(), response.statusCode(),
                new PortProfile(Source.LLM, context.detail()), response.bodyToString(), response.toString(),
                response.headerValue("Location"), response.headerValue("Content-Type"),
                System.currentTimeMillis(), true, context.runId(),
                new ProxyObservation(context, null, System.currentTimeMillis()));
        record.executionTrust = io.flowscope.core.ExecutionTrust.CONTROLLED;
        if (input.accountId() != null && !"anon".equals(record.fp)) {
            analysisConfig.bindSession(record.service, record.fp, input.accountId());
        }
        if (input.accountId() != null) {
            List<String> setCookies = response.headers().stream()
                    .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                    .map(HttpHeader::value).toList();
            sessionBroker.observeResponse(sessionBroker.handleForAccount(input.accountId()), target,
                    response.statusCode(), response.headerValue("Location"), response.bodyToString(), setCookies,
                    java.time.Instant.now());
        }
        synchronized (records) {
            if (records.size() >= MAX_RECORDS) throw new IllegalStateException("record limit reached");
            records.add(record);
        }
        rebuildImmediately();
        return new McpServer.TargetResult(record.evidenceId, record.status, record.location,
                record.respText, record.body);
    }

    private void rebuildImmediately() {
        List<RequestRecord> snapshot;
        synchronized (records) { snapshot = new ArrayList<>(records); }
        Pipeline.Result result = Pipeline.run(snapshot, analysisConfig);
        latest = result;
        rebuildRouteCandidates(result.records);
        revision.incrementAndGet();
        if (controlTab != null) controlTab.render(result);
    }

    private void rebuildRouteCandidates(List<RequestRecord> sourceRecords) {
        List<RouteCandidateExtractor.Seed> seeds;
        synchronized (siteMapSeeds) { seeds = List.copyOf(siteMapSeeds); }
        List<RouteCandidate> extracted = RouteCandidateExtractor.extract(sourceRecords, scope, seeds);
        List<RouteCandidate> restored;
        synchronized (restoredRouteCandidates) { restored = List.copyOf(restoredRouteCandidates); }
        Map<String, RouteCandidate> merged = new LinkedHashMap<>();
        for (RouteCandidate candidate : restored) merged.put(routeCandidateKey(candidate), candidate);
        for (RouteCandidate candidate : extracted) merged.put(routeCandidateKey(candidate), candidate);
        routeCandidates = RouteCandidateExtractor.prioritized(merged.values());
    }

    private static String routeCandidateKey(RouteCandidate candidate) {
        return candidate.service() + "\0" + candidate.method() + "\0" + candidate.pathTemplate();
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
