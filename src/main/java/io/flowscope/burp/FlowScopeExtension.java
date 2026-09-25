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
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.proxy.ProxyHttpRequestResponse;
import burp.api.montoya.proxy.http.InterceptedRequest;
import burp.api.montoya.proxy.http.InterceptedResponse;
import burp.api.montoya.proxy.http.ProxyRequestHandler;
import burp.api.montoya.proxy.http.ProxyRequestReceivedAction;
import burp.api.montoya.proxy.http.ProxyRequestToBeSentAction;
import burp.api.montoya.proxy.http.ProxyResponseHandler;
import burp.api.montoya.proxy.http.ProxyResponseReceivedAction;
import burp.api.montoya.proxy.http.ProxyResponseToBeSentAction;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.ActiveTrafficGuard;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AccountVerificationRule;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.VerificationOutcome;
import io.flowscope.core.AuthorizationMatrix;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
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
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.integration.ZapClient;
import io.flowscope.integration.ZapCampaign;
import io.flowscope.integration.ZapAccountVault;
import io.flowscope.integration.SessionBroker;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import io.flowscope.integration.LiveCrossIdentityReplayCoordinator;
import io.flowscope.explorer.CodexAppServerProvider;
import io.flowscope.explorer.ExplorerAccountVault;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.explorer.ExplorerTransport;
import io.flowscope.ui.FlowScopeControlTab;
import io.flowscope.web.FlowScopeWebServer;

import javax.swing.JMenu;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import java.awt.Component;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
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
    /** 압축률이 높은 대형 문서가 무제한으로 복원되지 않도록 평문 총량도 별도로 제한한다. */
    private static final long MAX_EXPANDED_PAYLOAD_BYTES = Math.max(0L, Long.getLong(
            "flowscope.payload.expandedBytes", 512L * 1024 * 1024));
    /** 웹 요청 실험실 원문은 프로젝트가 아니라 현재 Burp 프로세스의 제한된 메모리에만 둔다. */
    private static final int RAW_REQUEST_LIMIT_BYTES = Integer.getInteger(
            "flowscope.requestLab.requestBytes", 1024 * 1024);
    private static final int RAW_RESPONSE_LIMIT_BYTES = Integer.getInteger(
            "flowscope.requestLab.responseBytes", 4 * 1024 * 1024);
    /** Explorer가 run 전용 artifact 저장소로 넘길 단일 텍스트 응답 상한. */
    private static final int EXPLORER_RESPONSE_BYTES = Integer.getInteger(
            "flowscope.explorer.responseBytes", 64 * 1024 * 1024);
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
    private final ProjectWorkspace projectWorkspace = ProjectWorkspace.defaultWorkspace();
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
    private final AtomicLong expandedPayloadBytes = new AtomicLong();
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
    private final ZapProbeStatus zapProbeStatus = new ZapProbeStatus();
    private ExplorerAccountVault explorerAccounts;
    private ExplorerCoordinator explorer;
    private CrossIdentityReplayOrchestrator crossIdentityReplay;
    private LiveCrossIdentityReplayCoordinator liveCrossIdentityReplay;
    private final Set<Long> pendingLiveReplays = ConcurrentHashMap.newKeySet();
    private final ExecutorService authorizationReplayWorker =
            Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "flowscope-authorization-replay");
                t.setDaemon(true);
                return t;
            });
    private final ScheduledExecutorService worker =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "flowscope-rebuild");
                t.setDaemon(true);
                return t;
            });
    private final AtomicBoolean rebuildPending = new AtomicBoolean(false);
    private final AtomicBoolean databaseSavePending = new AtomicBoolean(false);
    private final AtomicBoolean databaseSaveRunning = new AtomicBoolean(false);
    /** Serializes dataset installation with unload without holding the capture monitor across callbacks. */
    private final Object lifecycleMonitor = new Object();
    /** Set once under the lifecycle and records locks when Burp unloads. */
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);
    private final AnalysisPublicationGate analysisPublication = new AnalysisPublicationGate();
    private volatile Path activeProjectDatabase;
    private volatile ProjectStore.ProjectContext activeProjectContext = ProjectStore.ProjectContext.empty();
    private volatile Instant databaseLastSavedAt;
    private volatile String databaseSaveError = "";
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
        crossIdentityReplay = new CrossIdentityReplayOrchestrator(sessionBroker, () -> scope,
                this::executeCrossIdentityReplay, this::openCrossIdentityReplayDraft,
                java.time.Clock.systemUTC());
        liveCrossIdentityReplay = new LiveCrossIdentityReplayCoordinator(
                crossIdentityReplay::executeContinuousBatch,
                crossIdentityReplay::beginContinuousRun,
                crossIdentityReplay::kill,
                authorizationReplayWorker);
        explorerAccounts = new ExplorerAccountVault();
        explorer = new ExplorerCoordinator(explorerAccounts, this::executeExplorerRequest,
                new CodexAppServerProvider(), runContexts, value -> scope.allows(value),
                () -> { rebuildImmediately(); return latest; }, this::acceptExplorerDiscoveries,
                api.logging()::logToOutput);
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
                    @Override public void startProject(String name, String projectScope) {
                        try { runProjectTask(() -> beginNewProject(name, projectScope)); }
                        catch (RuntimeException error) { projectError("새 진단 시작 실패", error); }
                    }
                    @Override public void saveProject(File file) { saveProjectFile(file); }
                    @Override public void loadProject(File file) { loadProjectFile(file); }
                    @Override public void importProxyHistory() { importProxyHistory(); }
                    @Override public void loadSample() { enqueueSampleProject(); }
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
        registerAccountSessionCaptureMenu();
        api.extension().registerUnloadingHandler(this::shutdown);
        startZapIntegration();
        api.logging().logToOutput("FlowScope loaded. 포트 매핑: " + PORT_SOURCE
                + " (미매핑 포트는 '미상'으로 수집). 변경: "
                + "-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer");
    }

    /**
     * Autorize/AuthMatrix처럼 운영자가 확인한 Burp 요청의 자격을 특정 등록 계정 슬롯에 명시적으로 넣는다.
     * 토큰이나 쿠키에서 계정 신원을 추론하지 않으며 원문 자격은 SessionBroker 밖으로 반환하지 않는다.
     */
    private void registerAccountSessionCaptureMenu() {
        api.userInterface().registerContextMenuItemsProvider(new ContextMenuItemsProvider() {
            @Override public List<Component> provideMenuItems(ContextMenuEvent event) {
                HttpRequestResponse exchange = selectedExchange(event);
                if (exchange == null || !exchange.hasResponse() || exchange.request() == null
                        || exchange.response() == null || !scope.allows(exchange.request().url())) {
                    return List.of();
                }
                String service = serviceOf(exchange.request());
                List<AccountProfile> accounts = analysisConfig.accounts().values().stream()
                        .filter(account -> account.service().equals(service))
                        .sorted(java.util.Comparator.comparing(AccountProfile::label))
                        .toList();
                if (accounts.isEmpty()) return List.of();

                JMenu menu = new JMenu("FlowScope 계정 세션으로 사용");
                for (io.flowscope.core.AccountProfile account : accounts) {
                    JMenuItem item = new JMenuItem(account.label() + " · " + account.role());
                    item.addActionListener(ignored ->
                            captureSelectedAccountSession(account, exchange, promptVerificationIndicator(account)));
                    menu.add(item);
                }
                return List.of(menu);
            }
        });
    }

    private static HttpRequestResponse selectedExchange(ContextMenuEvent event) {
        if (event == null) return null;
        if (event.messageEditorRequestResponse().isPresent()) {
            return event.messageEditorRequestResponse().orElseThrow().requestResponse();
        }
        List<HttpRequestResponse> selected = event.selectedRequestResponses();
        return selected.size() == 1 ? selected.getFirst() : null;
    }

    /**
     * Optional operator-typed login-success indicator. Blank means "no strong rule": the imported
     * session is still OPERATOR_ASSERTED, but later auto-captures cannot reach RULE_MATCHED.
     */
    private String promptVerificationIndicator(AccountProfile account) {
        Object input = JOptionPane.showInputDialog(null,
                account.label() + " 로그인 성공을 나타내는 응답 표식(선택). 예: 사용자명, \"id\":\"...\".\n"
                        + "자격값(쿠키/토큰/비밀번호)은 넣지 마세요. 비우면 이 세션만 확인되고 자동 규칙은 만들지 않습니다.",
                "FlowScope 검증 표식", JOptionPane.PLAIN_MESSAGE);
        return input == null ? null : input.toString();
    }

    private void captureSelectedAccountSession(AccountProfile account,
                                               HttpRequestResponse exchange, String indicator) {
        try {
            HttpRequest request = exchange.request();
            HttpResponse response = exchange.response();
            if (request == null || response == null || !scope.allows(request.url())) {
                throw new IllegalArgumentException("선택한 요청이 현재 exact scope 안에 있지 않습니다.");
            }
            String service = serviceOf(request);
            if (!service.equals(account.service())) {
                throw new IllegalArgumentException("선택한 요청과 등록 계정의 대상 서비스가 다릅니다.");
            }
            String fingerprint = Fingerprints.of(request.headerValue("Authorization"),
                    request.headerValue("Cookie"));
            if ("anon".equals(fingerprint)) {
                throw new IllegalArgumentException("선택한 요청에 Cookie 또는 Authorization이 없습니다.");
            }
            analysisConfig.boundAccount(service, fingerprint).ifPresent(bound -> {
                if (!bound.id().equals(account.id())) {
                    throw new IllegalStateException("이 인증정보는 이미 다른 등록 계정에 연결되어 있습니다: "
                            + bound.label());
                }
            });
            List<String> setCookies = response.headers().stream()
                    .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                    .map(HttpHeader::value).toList();
            // Atomic import across two stores: reserve the binding first (reversible), then commit the
            // session. On session failure roll back only a binding we created; keep any existing same-account
            // binding. The existing-owner conflict was already rejected above, so bindSession does not fall back.
            boolean bindingExisted = analysisConfig.boundAccount(service, fingerprint)
                    .map(bound -> bound.id().equals(account.id())).orElse(false);
            analysisConfig.bindSession(service, fingerprint, account.id());
            try {
                sessionBroker.captureObservedExchange(account, URI.create(request.url()), headersOf(request.headers()),
                        response.statusCode(), response.headerValue("Location"), boundedResponseBody(response),
                        setCookies, java.time.Instant.now());
            } catch (RuntimeException error) {
                if (!bindingExisted) analysisConfig.unbindSession(service, fingerprint);
                throw error;
            }
            // Session + binding committed as OPERATOR_ASSERTED. Store the optional strong verification rule
            // from the operator indicator; a bad indicator is reported but never fails the import or falls back.
            if (indicator != null && !indicator.isBlank()) {
                try {
                    AccountVerificationRule.fromExchange(account.id(), request.method(),
                            URI.create(request.url()), indicator)
                            .ifPresent(analysisConfig::withAccountVerificationRule);
                } catch (IllegalArgumentException invalid) {
                    api.logging().logToError("FlowScope 검증 표식 저장 실패(자격값 형태 등): " + invalid.getMessage());
                }
            }
            revision.incrementAndGet();
            scheduleRebuild();
            JOptionPane.showMessageDialog(null,
                    account.label() + " 계정의 재사용 세션을 메모리에 연결했습니다.",
                    "FlowScope 계정 세션", JOptionPane.INFORMATION_MESSAGE);
        } catch (RuntimeException error) {
            JOptionPane.showMessageDialog(null, error.getMessage(),
                    "FlowScope 계정 세션 연결 실패", JOptionPane.ERROR_MESSAGE);
        }
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
                String requestCaptureAccountId = captureAccountId == null ? null : captureAccountForCredential(
                        captureAccountId, knownCredentialOwner(request));
                boolean captureSuppressed = captureAccountId != null && requestCaptureAccountId == null;
                if (captureSuppressed) captureHandle = null;
                HttpRequest prepared = prepareSession(request, profile, captureHandle, context);
                rememberObservation(proxyObservations, request.messageId(), context, requestCaptureAccountId,
                        captureSuppressed, "프록시");
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
                prepared = prepared.withHeader(header.getKey(), header.getValue());
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
                String requestedCaptureAccountId = captureAccountId;
                if (captureAccountId != null) {
                    captureAccountId = captureAccountForCredential(captureAccountId, knownCredentialOwner(req));
                }
                boolean captureSuppressed = requestedCaptureAccountId != null && captureAccountId == null;
                rememberObservation(toolObservations, req.messageId(), context, captureAccountId,
                        captureSuppressed, "Burp 도구");
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
        if (shuttingDown.get() || !ActiveTrafficGuard.allowsCapture(scope, req.url()) || staleObservation(observation)) return false;
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
            if (shuttingDown.get() || staleObservation(observation)) return false;
            if (records.size() >= MAX_RECORDS) {
                recordDroppedAtCapacity();
                return false;
            }
            records.add(rec);
            retainRawExchange(rec, req, response);
            if (liveCrossIdentityReplay != null
                    && liveCrossIdentityReplay.acceptingCaptures(rec)) {
                pendingLiveReplays.add(rec.runtimeId());
            }
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
            if (profile.source() != Source.HUMAN) rec.laneAccountId = context.accountId();
        }
        if (profile.source() == Source.HUMAN) rec.laneAccountId = accountId;
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
        if (shuttingDown.get()) return;
        analysisPublication.invalidate();
        if (!rebuildPending.compareAndSet(false, true)) return;  // 이미 예약됨 → 합치기
        worker.schedule(() -> {
            rebuildPending.set(false);
            if (shuttingDown.get()) return; // The ordered shutdown flush owns the final rebuild.
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
                    && (compressedPayloadBytes.get() + payload.compressedBytes() > MAX_COMPRESSED_PAYLOAD_BYTES
                    || expandedPayloadBytes.get() + payload.originalBytes() > MAX_EXPANDED_PAYLOAD_BYTES)) {
                StoredPayload metadata = payload.metadataOnly(StoredPayload.Retention.CAPACITY_METADATA_ONLY);
                return payloadPool.computeIfAbsent(
                        metadata.digest() + ":" + metadata.retention().name(), ignored -> metadata);
            }
            payloadPool.put(key, payload);
            compressedPayloadBytes.addAndGet(payload.compressedBytes());
            if (payload.retained()) expandedPayloadBytes.addAndGet(payload.originalBytes());
            return payload;
        }
    }

    private void resetPayloadPool() {
        synchronized (payloadPool) {
            payloadPool.clear();
            compressedPayloadBytes.set(0);
            expandedPayloadBytes.set(0);
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

    static String captureAccountForCredential(String captureAccountId, String knownAccountId) {
        return captureAccountId != null && knownAccountId != null && !captureAccountId.equals(knownAccountId)
                ? null : captureAccountId;
    }

    static String resolveSessionUpdateAccount(Source source, String contextAccountId,
                                               String humanCaptureAccountId, String detectedAccountId,
                                               boolean humanCaptureSuppressed) {
        if (source == Source.HUMAN && humanCaptureSuppressed) return null;
        return resolveObservedAccount(source, contextAccountId, humanCaptureAccountId, detectedAccountId);
    }

    private String knownCredentialOwner(HttpRequest request) {
        URI target = URI.create(request.url());
        String detected = sessionBroker.accountForRequest(target, headersOf(request.headers()),
                java.time.Instant.now()).orElse(null);
        if (detected != null) return detected;
        String fingerprint = Fingerprints.of(request.headerValue("Authorization"), request.headerValue("Cookie"));
        return analysisConfig.boundAccount(serviceOf(request), fingerprint).map(account -> account.id()).orElse(null);
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
                                     boolean humanCaptureSuppressed, String channel) {
        long now = System.currentTimeMillis();
        if (!tracker.remember(messageId, context, humanCaptureAccountId,
                humanCaptureSuppressed, datasetEpoch.get(), now)) {
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
                String accountId = resolveSessionUpdateAccount(Source.HUMAN,
                        context == null ? null : context.accountId(), captureAccountId, detectedAccountId,
                        observation != null && observation.humanCaptureSuppressed());
                if (accountId != null) handle = sessionBroker.handleForAccount(accountId);
            } else if (context != null && context.accountId() != null
                    && !scannerUsesDirectAuthentication(context, scannerDirectAuthenticationRunId)) {
                handle = sessionBroker.handleForAccount(context.accountId());
            }
            if (handle == null) return;
            List<String> setCookies = headers == null ? List.of() : headers.stream()
                    .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                    .map(HttpHeader::value).toList();
            // Evaluate this account's stored verification rule so an auto-capture can reach RULE_MATCHED
            // only on the verification endpoint with the operator's success indicator.
            String ruleAccountId = sessionBroker.accountForHandle(handle).orElse(null);
            VerificationOutcome outcome = ruleAccountId == null ? VerificationOutcome.NO_RULE
                    : analysisConfig.verificationRule(ruleAccountId)
                    .map(rule -> rule.evaluate(request.method(), URI.create(request.url()), body))
                    .orElse(VerificationOutcome.NO_RULE);
            sessionBroker.observeResponse(handle, URI.create(request.url()), status, location, body,
                    setCookies, java.time.Instant.now(), outcome);
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

    private void enqueueSampleProject() {
        worker.execute(() -> {
            try {
                loadSampleProject();
            } catch (Exception e) {
                projectError("샘플 프로젝트 열기 실패", e);
            }
        });
    }

    private void loadSampleProject() throws IOException {
        synchronized (lifecycleMonitor) {
            if (shuttingDown.get()) throw new IllegalStateException("FlowScope 종료 중에는 샘플을 열 수 없습니다.");
            preserveCurrentProject();
            long analysisEpoch = analysisPublication.invalidate();
            clearRunContexts();
            killCrossIdentityReplay();
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
            activeProjectContext = ProjectStore.ProjectContext.empty();
            databaseSavedRevision.set(-1);
            databaseLastSavedAt = null;
            databaseSaveError = "";
            api.logging().logToOutput("FlowScope 샘플 프로젝트 열기: " + loaded.size()
                    + "건 · 실제 네트워크 요청 없음");
        }
    }

    private <T> T runProjectTask(java.util.concurrent.Callable<T> task) {
        java.util.concurrent.Future<T> future = worker.submit(task);
        try {
            return future.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("프로젝트 작업 대기가 중단되었습니다.", error);
        } catch (java.util.concurrent.ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException(cause == null ? "프로젝트 작업에 실패했습니다." : cause.getMessage(), cause);
        }
    }

    /** Persist the current diagnosis before replacing any target-specific in-memory state. */
    private Path preserveCurrentProject() throws IOException {
        if (isSampleDataset()) return activeProjectDatabase;
        if (!hasPersistableProjectState()) return activeProjectDatabase;
        if (activeProjectDatabase != null) {
            saveActiveDatabase();
            markDatabaseSaved(revision.get());
            return activeProjectDatabase;
        }
        String archiveScope = archiveScopeText();
        ProjectWorkspace.Allocation archive = projectWorkspace.allocate(
                activeProjectContext.name(), archiveScope);
        try {
            saveProjectSnapshot(archive.database(), archive.context());
            return archive.database();
        } catch (IOException | RuntimeException error) {
            projectWorkspace.removeEmptyAllocation(archive);
            throw error;
        }
    }

    private boolean hasPersistableProjectState() {
        synchronized (records) {
            if (!records.isEmpty()) return true;
        }
        return !routeCandidates.isEmpty()
                || !analysisConfig.accounts().isEmpty()
                || !analysisConfig.identityRoles().isEmpty()
                || !analysisConfig.endpointRequirements().isEmpty()
                || !analysisConfig.resourceOwners().isEmpty()
                || !analysisConfig.reviews().isEmpty()
                || !analysisConfig.trafficOverrides().isEmpty()
                || !runContexts.completedRuns().isEmpty()
                || !executionLedger.attempts().isEmpty()
                || !archivedAssessments.isEmpty()
                || !archivedValidations.isEmpty();
    }

    private boolean isSampleDataset() {
        synchronized (records) {
            return !records.isEmpty() && records.stream()
                    .allMatch(record -> "https://demo.flowscope.test:443".equals(record.service)
                            && record.runId != null && record.runId.startsWith("demo-"));
        }
    }

    private String archiveScopeText() {
        List<String> entries = new ArrayList<>(scope.entries());
        if (entries.isEmpty()) {
            synchronized (records) {
                records.stream().map(record -> record.service).filter(java.util.Objects::nonNull)
                        .filter(value -> !value.isBlank()).distinct().forEach(entries::add);
            }
        }
        if (entries.isEmpty()) {
            analysisConfig.accounts().values().stream().map(io.flowscope.core.AccountProfile::service)
                    .distinct().forEach(entries::add);
        }
        if (entries.isEmpty()) {
            throw new IllegalStateException("현재 진단을 보존할 scope를 확정할 수 없습니다. "
                    + "현재 범위를 먼저 적용한 뒤 새 진단을 시작하세요.");
        }
        return String.join("\n", entries);
    }

    private ProjectWorkspace.Status beginNewProject(String name, String requestedScope) throws IOException {
        if (scopeMutationBlocked(runContexts)) {
            throw new IllegalStateException("활성 HUMAN·ZAP·LLM 실행을 먼저 종료하거나 취소하세요.");
        }
        ScopePolicy parsed = ScopePolicy.parse(requestedScope);
        if (parsed.isEmpty()) throw new IllegalArgumentException("새 진단에는 exact scope가 한 개 이상 필요합니다.");

        Path preserved = preserveCurrentProject();
        ProjectWorkspace.Allocation next = projectWorkspace.allocate(name, requestedScope);
        try {
            sqliteProjectStore.save(next.database(), List.of(), new AnalysisConfig(), List.of(), List.of(),
                    Map.of(), List.of(), List.of(), next.context());
        } catch (IOException | RuntimeException error) {
            projectWorkspace.removeEmptyAllocation(next);
            throw error;
        }

        activateEmptyProject(parsed, requestedScope, next);
        api.logging().logToOutput("FlowScope 새 진단 시작: " + next.context().name()
                + " · " + next.context().scope() + " · 기존 진단 "
                + (preserved == null ? "없음" : "보존 " + preserved));
        return currentProjectStatus();
    }

    private ProjectWorkspace.Status openWorkspaceProject(String id) throws IOException {
        if (scopeMutationBlocked(runContexts)) {
            throw new IllegalStateException("활성 HUMAN·ZAP·LLM 실행을 먼저 종료하거나 취소하세요.");
        }
        loadProjectPath(projectWorkspace.resolveDatabase(id));
        return currentProjectStatus();
    }

    private ProjectWorkspace.Status resetActiveProjectTraffic() throws IOException {
        if (scopeMutationBlocked(runContexts)) {
            throw new IllegalStateException("활성 HUMAN·ZAP·LLM 실행을 먼저 종료하거나 취소하세요.");
        }
        if (activeProjectDatabase == null) throw new IllegalStateException("초기화할 현재 프로젝트가 없습니다.");

        AnalysisConfig retainedConfig = analysisConfig.snapshotCopy();
        retainedConfig.clearSessionBindings();
        retainedConfig.clearReviews();
        sqliteProjectStore.save(activeProjectDatabase, List.of(), retainedConfig, List.of(), List.of(),
                Map.of(), List.of(), List.of(), activeProjectContext);

        long analysisEpoch = analysisPublication.invalidate();
        clearRunContexts();
        killCrossIdentityReplay();
        sessionBroker.close();
        if (explorer != null) {
            try { explorer.cancel(); } catch (RuntimeException ignored) { }
            try { explorer.clear(); } catch (RuntimeException ignored) { }
        }
        resetIntegrationWorkflow();
        analysisConfig.replaceWith(retainedConfig);
        synchronized (records) {
            datasetEpoch.incrementAndGet();
            records.clear();
            capacityWarned = false;
        }
        rawExchanges.clear();
        proxyObservations.clear();
        toolObservations.clear();
        droppedRecords.set(0);
        resetPayloadPool();
        synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
        synchronized (restoredRouteCandidates) { restoredRouteCandidates.clear(); }
        routeCandidates = List.of();
        JavascriptCallSiteAnalyzer.clearCache();
        archivedAssessments = List.of();
        archivedValidations = List.of();
        scannerCapabilityRunId = "";
        scannerCapability = "";
        scannerCapabilityRejectionRunId = "";
        scannerCapabilityRejections.set(0);
        scannerDirectAuthenticationRunId = "";
        publishAnalysis(analysisEpoch, Pipeline.runIsolated(List.of(), analysisConfig));
        markDatabaseSaved(revision.get());
        api.logging().logToOutput("FlowScope 트래픽 초기화: " + activeProjectContext.name());
        return currentProjectStatus();
    }

    private ProjectWorkspace.Status deleteWorkspaceProject(String id) throws IOException {
        projectWorkspace.delete(id, activeProjectDatabase);
        return currentProjectStatus();
    }

    private void activateEmptyProject(ScopePolicy parsed, String requestedScope,
                                      ProjectWorkspace.Allocation next) {
        long analysisEpoch = analysisPublication.invalidate();
        clearRunContexts();
        killCrossIdentityReplay();
        sessionBroker.close();
        resetExplorerSecrets();
        resetZapSecrets();
        resetIntegrationWorkflow();
        analysisConfig.replaceWith(new AnalysisConfig());
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
        archivedAssessments = List.of();
        archivedValidations = List.of();
        scannerCapabilityRunId = "";
        scannerCapability = "";
        scannerCapabilityRejectionRunId = "";
        scannerCapabilityRejections.set(0);
        scannerDirectAuthenticationRunId = "";
        scope = parsed;
        scopeText = requestedScope == null ? "" : requestedScope.trim();
        activeProjectDatabase = null;
        activeProjectContext = ProjectStore.ProjectContext.empty();
        Pipeline.Result empty = Pipeline.runIsolated(List.of(), analysisConfig);
        publishAnalysis(analysisEpoch, empty);
        activeProjectDatabase = next.database();
        activeProjectContext = next.context();
        markDatabaseSaved(revision.get());
        if (controlTab != null) SwingUtilities.invokeLater(() -> controlTab.setScopeText(scopeText));
    }

    private void saveProjectSnapshot(Path target, ProjectStore.ProjectContext context) throws IOException {
        List<RequestRecord> snapshot;
        synchronized (records) { snapshot = new ArrayList<>(records); }
        sqliteProjectStore.save(target, snapshot, analysisConfig, archivedAssessments, archivedValidations,
                runContexts.completedRuns(), routeCandidates, executionLedger.attempts(), context);
    }

    private ProjectStore.ProjectContext currentProjectContext(String fallbackName) {
        if (activeProjectContext != null && activeProjectContext.present()) return activeProjectContext;
        List<String> entries = scope.entries();
        String name = fallbackName == null ? "" : fallbackName
                .replaceFirst("(?i)\\.(flowscope\\.db|json|db)$", "").trim();
        if (name.isBlank() && !entries.isEmpty()) name = entries.getFirst();
        return new ProjectStore.ProjectContext(name, entries, Instant.now());
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
                ProjectStore.ProjectContext context = currentProjectContext(path.getFileName().toString());
                if (database) {
                    sqliteProjectStore.save(path, snapshot, analysisConfig, assessments, validations,
                            runContexts.completedRuns(), routeCandidates,
                            executionLedger.attempts(), context);
                } else {
                    projectStore.save(path, snapshot, analysisConfig, assessments, validations,
                            runContexts.completedRuns(), routeCandidates,
                            executionLedger.attempts(), context);
                }
                if (database) {
                    activeProjectDatabase = path;
                    activeProjectContext = context;
                    markDatabaseSaved(revision.get());
                }
                api.logging().logToOutput("FlowScope 프로젝트 저장: " + file);
            } catch (Exception e) {
                projectError("프로젝트 저장 실패", e);
            }
        });
    }

    private void loadProjectFile(File file) {
        Runnable load = () -> {
            if (shuttingDown.get()) return;
            try {
                Path path = file.toPath().toAbsolutePath().normalize();
                loadProjectPath(path);
            } catch (Exception e) {
                projectError("프로젝트 열기 실패", e);
            }
        };
        synchronized (records) {
            // An import requested after unload began is neither queued nor installed (PR #11).
            if (!shuttingDown.get()) worker.execute(load);
        }
    }

    private void loadProjectPath(Path requestedPath) throws IOException {
        Path path = requestedPath.toAbsolutePath().normalize();
        boolean database = sqliteProject(path);
        if (database && path.equals(activeProjectDatabase)) {
            preserveCurrentProject();
        }
        ProjectStore.ProjectData data = database ? sqliteProjectStore.load(path) : projectStore.load(path);
        ProjectStore.ProjectContext context = restoredProjectContext(data, path);
        ScopePolicy restoredScope = ScopePolicy.parse(String.join("\n", context.scope()));
        List<RequestRecord> loaded = new ArrayList<>(data.records());
        Pipeline.Result result = Pipeline.runIsolated(loaded, data.config());

        if (!(database && path.equals(activeProjectDatabase))) preserveCurrentProject();
        Path managedPath = path;
        if (!database) {
            if (restoredScope.isEmpty()) {
                throw new IllegalArgumentException("legacy JSON 프로젝트에 복원 가능한 scope가 없습니다.");
            }
            ProjectWorkspace.Allocation migrated = projectWorkspace.allocate(context.name(),
                    String.join("\n", context.scope()));
            context = migrated.context();
            try {
                sqliteProjectStore.save(migrated.database(), loaded, data.config(), data.assessments(),
                        data.validations(), data.completedRuns(), data.routeCandidates(), data.runAttempts(), context);
                managedPath = migrated.database();
            } catch (IOException | RuntimeException error) {
                projectWorkspace.removeEmptyAllocation(migrated);
                throw error;
            }
        }

        if (!applyLoadedProject(data, loaded, result, restoredScope, context, managedPath)) return;
        api.logging().logToOutput("FlowScope 프로젝트 열기: " + result.records.size() + "건 — " + managedPath);
    }

    private ProjectStore.ProjectContext restoredProjectContext(ProjectStore.ProjectData data, Path path) {
        ProjectStore.ProjectContext context = data.context();
        if (context != null && !context.scope().isEmpty()) return context;
        List<String> restoredScope = data.records().stream().map(record -> record.service)
                .filter(java.util.Objects::nonNull).filter(value -> !value.isBlank()).distinct().toList();
        String name = context == null || context.name().isBlank()
                ? path.getFileName().toString().replaceFirst("(?i)\\.(flowscope\\.db|json|db)$", "")
                : context.name();
        Instant createdAt = context == null || !context.present() ? fileTimestamp(path) : context.createdAt();
        return new ProjectStore.ProjectContext(name, restoredScope, createdAt);
    }

    private static Instant fileTimestamp(Path path) {
        try { return java.nio.file.Files.getLastModifiedTime(path).toInstant(); }
        catch (IOException ignored) { return Instant.now(); }
    }

    /** Installs a fully prepared candidate dataset; returns false when unload began first (the candidate is discarded). */
    private boolean applyLoadedProject(ProjectStore.ProjectData data, List<RequestRecord> loaded,
                                       Pipeline.Result result, ScopePolicy restoredScope,
                                       ProjectStore.ProjectContext context, Path database) {
        return runBeforeShutdown(lifecycleMonitor, shuttingDown,
                () -> installLoadedProject(data, loaded, result, restoredScope, context, database));
    }

    private void installLoadedProject(ProjectStore.ProjectData data, List<RequestRecord> loaded,
                                      Pipeline.Result result, ScopePolicy restoredScope,
                                      ProjectStore.ProjectContext context, Path database) {
        long analysisEpoch = analysisPublication.invalidate();
        clearRunContexts();
        killCrossIdentityReplay();
        sessionBroker.close();
        resetExplorerSecrets();
        resetZapSecrets();
        resetIntegrationWorkflow();
        analysisConfig.replaceWith(data.config());
        JavascriptCallSiteAnalyzer.clearCache();
        resetPayloadPool();
        loaded.forEach(record -> {
            record.requestPayload = internPayload(record.requestPayload);
            record.responsePayload = internPayload(record.responsePayload);
        });
        synchronized (siteMapSeeds) { siteMapSeeds.clear(); }
        synchronized (restoredRouteCandidates) {
            restoredRouteCandidates.clear();
            restoredRouteCandidates.addAll(data.routeCandidates().stream()
                    .filter(candidate -> !candidate.observed()
                            || !candidate.declaredParameters().isEmpty()
                            || candidate.provenanceTypes().contains(
                                    RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS))
                    .toList());
        }
        synchronized (records) {
            datasetEpoch.incrementAndGet();
            records.clear();
            records.addAll(loaded);
            capacityWarned = records.size() >= MAX_RECORDS;
        }
        rawExchanges.clear();
        droppedRecords.set(0);
        archivedAssessments = data.assessments();
        archivedValidations = data.validations();
        executionLedger.replace(data.runAttempts());
        scope = restoredScope;
        scopeText = String.join("\n", context.scope());
        activeProjectDatabase = null;
        activeProjectContext = ProjectStore.ProjectContext.empty();
        publishAnalysis(analysisEpoch, result);
        runContexts.restoreCompletedRuns(data.completedRuns());
        activeProjectDatabase = database;
        activeProjectContext = context;
        markDatabaseSaved(revision.get());
        if (controlTab != null) SwingUtilities.invokeLater(() -> controlTab.setScopeText(scopeText));
    }

    /** The dataset install and shutdown flag transition share the same monitor, so exactly one starts first. */
    static boolean runBeforeShutdown(Object monitor, AtomicBoolean shuttingDown, Runnable action) {
        synchronized (monitor) {
            if (shuttingDown.get()) return false;
            action.run();
            return true;
        }
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
        if (shuttingDown.get()) return;
        if (activeProjectDatabase == null || databaseSavedRevision.get() == revision.get()) return;
        if (!databaseSavePending.compareAndSet(false, true)) return;
        worker.schedule(() -> {
            long savingRevision = revision.get();
            databaseSaveRunning.set(true);
            try {
                if (shuttingDown.get()) return; // The shutdown flush performs the final checkpoint.
                saveActiveDatabase();
                markDatabaseSaved(savingRevision);
            } catch (Exception error) {
                markDatabaseSaveFailed(error);
                api.logging().logToError("FlowScope 로컬 DB 자동 저장 실패", error);
            } finally {
                databaseSaveRunning.set(false);
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
                executionLedger.attempts(), currentProjectContext(database.getParent() == null
                        ? database.getFileName().toString() : database.getParent().getFileName().toString()));
    }

    private void markDatabaseSaved(long savedRevision) {
        databaseSavedRevision.set(savedRevision);
        databaseLastSavedAt = Instant.now();
        databaseSaveError = "";
    }

    private void markDatabaseSaveFailed(Throwable error) {
        String message = error == null || error.getMessage() == null
                ? "로컬 프로젝트 DB 저장에 실패했습니다."
                : error.getMessage();
        databaseSaveError = Masking.truncate(Masking.maskSecrets(message), 512);
    }

    private ProjectWorkspace.Status currentProjectStatus() {
        ProjectWorkspace.Status status = projectWorkspace.status(
                activeProjectDatabase, activeProjectContext, sqliteProjectStore);
        if (activeProjectDatabase == null) {
            return status.withPersistence("UNMANAGED", "", "");
        }
        boolean dirty = databaseSavedRevision.get() != revision.get();
        String state = !databaseSaveError.isBlank() && dirty ? "FAILED"
                : databaseSaveRunning.get() ? "SAVING"
                : dirty ? "PENDING" : "SAVED";
        return status.withPersistence(state,
                databaseLastSavedAt == null ? "" : databaseLastSavedAt.toString(),
                "FAILED".equals(state) ? databaseSaveError : "");
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
            runProjectTask(() -> {
                applyScope(value);
                return null;
            });
        } catch (IllegalArgumentException | IllegalStateException e) {
            projectError("범위 적용 실패", e);
        }
    }

    private void applyScope(String value) throws IOException {
        if (scopeMutationBlocked(runContexts)) {
            throw new IllegalStateException("활성 실행이 있습니다. "
                    + "실행을 종료한 뒤 범위를 변경하세요.");
        }
        ScopePolicy parsed = ScopePolicy.parse(value);
        if (activeProjectDatabase != null && !activeProjectContext.scope().equals(parsed.entries())) {
            throw new IllegalStateException("진행 중인 프로젝트의 scope는 바꿀 수 없습니다. "
                    + "새 진단 시작을 사용하면 현재 Evidence를 보존하고 다른 scope로 전환합니다.");
        }
        if (activeProjectDatabase == null && !parsed.isEmpty()) {
            if (isSampleDataset()) {
                ProjectWorkspace.Allocation allocation = projectWorkspace.allocate("", value);
                try {
                    sqliteProjectStore.save(allocation.database(), List.of(), new AnalysisConfig(),
                            List.of(), List.of(), Map.of(), List.of(), List.of(), allocation.context());
                } catch (IOException | RuntimeException error) {
                    projectWorkspace.removeEmptyAllocation(allocation);
                    throw error;
                }
                activateEmptyProject(parsed, value, allocation);
                api.logging().logToOutput("FlowScope 샘플을 닫고 새 진단 시작: "
                        + allocation.context().name() + " · " + allocation.context().scope());
                return;
            }
            if (hasPersistableProjectState() && !scope.entries().equals(parsed.entries())) {
                throw new IllegalStateException("저장되지 않은 기존 진단 데이터와 새 scope를 섞을 수 없습니다. "
                        + "새 진단 시작을 사용해 기존 Evidence를 먼저 보존하세요.");
            }
            ProjectWorkspace.Allocation allocation = projectWorkspace.allocate("", value);
            try {
                saveProjectSnapshot(allocation.database(), allocation.context());
            } catch (IOException | RuntimeException error) {
                projectWorkspace.removeEmptyAllocation(allocation);
                throw error;
            }
            activeProjectDatabase = allocation.database();
            activeProjectContext = allocation.context();
            markDatabaseSaved(revision.get());
        }
        scope = parsed;
        scopeText = value == null ? "" : value.trim();
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
            @Override public long datasetRevision() { return datasetEpoch.get(); }
            @Override public AnalysisConfig config() { return analysisConfig; }
            @Override public List<LegacyAssessment> assessments() {
                return archivedAssessments;
            }
            @Override public List<ValidationDecision> validations() {
                return archivedValidations;
            }
            @Override public RunContextRegistry contexts() { return runContexts; }
            @Override public SessionBroker sessions() { return sessionBroker; }
            @Override public List<FlowScopeWebServer.AccountRequestCandidate> accountRequestCandidates(String accountId) {
                return safeAccountRequestCandidates(accountId);
            }
            @Override public void linkAccountRequestCandidate(String accountId, String evidenceId) {
                linkObservedHumanSession(accountId, evidenceId);
            }
            @Override public List<ZapAccountVault.View> zapAccounts() { return zapAccounts.views(); }
            @Override public ZapAccountVault.View saveZapAccount(ZapAccountVault.Input input) {
                validateRuntimeAccount(input.id(), input.label(), input.service(), input.role());
                ZapAccountVault.View saved = zapAccounts.save(input);
                io.flowscope.core.AccessRole role = io.flowscope.core.AccessRole.valueOf(saved.role());
                if (analysisConfig.account(saved.id()).isEmpty()) {
                    analysisConfig.upsertAccount(new io.flowscope.core.AccountProfile(
                            saved.id(), saved.label(), saved.service(), role));
                }
                scheduleRebuild();
                return saved;
            }
            @Override public void removeZapAccount(String id) {
                zapAccounts.remove(id);
                if (id != null && id.startsWith("zap-")) analysisConfig.removeAccount(id);
                scheduleRebuild();
            }
            @Override public com.fasterxml.jackson.databind.JsonNode refreshAccountSession(String id) {
                if (zapCampaign == null) throw new IllegalStateException("ZAP 로그인이 아직 준비되지 않았습니다.");
                analysisConfig.account(id).orElseThrow(() ->
                        new IllegalArgumentException("등록되지 않은 계정입니다: " + id));
                return zapCampaign.startAuthenticationOnly(id);
            }
            @Override public List<String> scopeEntries() { return scope.entries(); }
            @Override public ProjectWorkspace.Status projectStatus() {
                return currentProjectStatus();
            }
            @Override public ProjectWorkspace.Status startProject(String name, String projectScope) {
                return runProjectTask(() -> beginNewProject(name, projectScope));
            }
            @Override public ProjectWorkspace.Status openProject(String id) {
                return runProjectTask(() -> openWorkspaceProject(id));
            }
            @Override public ProjectWorkspace.Status resetProjectTraffic() {
                return runProjectTask(FlowScopeExtension.this::resetActiveProjectTraffic);
            }
            @Override public ProjectWorkspace.Status deleteProject(String id) {
                return runProjectTask(() -> deleteWorkspaceProject(id));
            }
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
                URI requestedLogin = URI.create(input.loginUrl());
                String requestedService = requestedLogin.getScheme() + "://" + requestedLogin.getAuthority();
                validateRuntimeAccount(input.id(), input.label(), requestedService, input.role());
                ExplorerAccountVault.View saved = explorer.saveAccount(input);
                URI login = URI.create(saved.loginUrl());
                io.flowscope.core.AccessRole role;
                try { role = io.flowscope.core.AccessRole.valueOf(saved.role().toUpperCase(Locale.ROOT)); }
                catch (RuntimeException ignored) { role = io.flowscope.core.AccessRole.UNKNOWN; }
                if (analysisConfig.account(saved.id()).isEmpty()) {
                    analysisConfig.upsertAccount(new io.flowscope.core.AccountProfile(
                            saved.id(), saved.label(), login.getScheme() + "://" + login.getAuthority(), role));
                }
                scheduleRebuild();
                return saved;
            }
            @Override public void removeExplorerAccount(String id) {
                explorer.removeAccount(id);
                if (id != null && id.startsWith("llm-")) analysisConfig.removeAccount(id);
                scheduleRebuild();
            }
            @Override public ExplorerAccountVault.View verifyExplorerAccount(String id) {
                return explorer.authenticateAccount(id);
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
            @Override public void loadSample() {
                runProjectTask(() -> { loadSampleProject(); return null; });
            }
            @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
                BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
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
                api.logging().logToOutput("FlowScope Web XML 가져오기: " + parsed.records.size()
                        + "/" + parsedCount + "건 추가 · 기존 중복 " + duplicateCount
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
            @Override public RequestRecord openInRepeater(String evidenceId, String request,
                                                          FlowScopeWebServer.CredentialMode credentialMode,
                                                          String accountId) {
                RequestRecord record = evidenceRecord(evidenceId);
                openDraftInRepeater(record, prepareHumanRequest(record, request, credentialMode, accountId));
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
                var observedAccount = record.laneAccountId == null
                        ? analysisConfig.boundAccount(record.service, record.fp)
                        : analysisConfig.account(record.laneAccountId);
                String observedIdentity = observedAccount.map(io.flowscope.core.AccountProfile::label)
                        .orElse(record.idn == null ? "미확정" : record.idn);
                var reusable = observedAccount
                        .flatMap(account -> sessionBroker.viewForAccount(account.id()))
                        .filter(view -> view.status() == SessionBroker.Status.ACTIVE);
                String reusableSession = reusable.map(view -> view.accountLabel() + " · ACTIVE").orElse("없음");
                String reusableAccountId = reusable.map(SessionBroker.SessionView::accountId).orElse("");
                return new FlowScopeWebServer.RequestLabDraft(record.evidenceId, record.service,
                        request, response, rawRequest, rawResponse, decodedRequest.editable(),
                        decodedRequest.charset(), decodedResponse.charset(), observedIdentity,
                        reusableSession, reusableAccountId, message);
            }
            @Override public FlowScopeWebServer.RequestLabResult sendRequestLab(
                    String evidenceId, String request, FlowScopeWebServer.CredentialMode credentialMode,
                    String accountId) {
                return executeHumanRequestLab(evidenceId, request, credentialMode, accountId);
            }
            @Override public CrossIdentityReplayOrchestrator.RunResult runAuthorizationReplay(
                    String itemId, boolean armed) {
                return runCrossIdentityReplay(List.of(authorizationReplayRecommendation(itemId)), armed);
            }
            @Override public void killAuthorizationReplay() { killCrossIdentityReplay(); }
            @Override public String draftAuthorizationReplay(String itemId) {
                return draftCrossIdentityReplay(itemId);
            }
            @Override public LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                    List<String> accountIds, boolean anonymous, boolean armed) {
                return startLiveAuthorizationReplay(accountIds, anonymous, List.of(Source.HUMAN), armed);
            }
            @Override public LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                    List<String> accountIds, boolean anonymous, List<Source> basisSources, boolean armed) {
                for (String accountId : accountIds) {
                    analysisConfig.account(accountId).orElseThrow(() ->
                            new IllegalArgumentException("등록되지 않은 대상 계정입니다: " + accountId));
                    SessionBroker.SessionView session = sessionBroker.viewForAccount(accountId).orElseThrow(() ->
                            new IllegalStateException("재사용 가능한 관리 세션이 없습니다: " + accountId));
                    if (session.status() != SessionBroker.Status.ACTIVE || session.credentialConflict()) {
                        throw new IllegalStateException("ACTIVE 관리 세션만 선택할 수 있습니다: " + accountId);
                    }
                }
                return liveCrossIdentityReplay.start(accountIds, anonymous, basisSources, armed);
            }
            @Override public LiveCrossIdentityReplayCoordinator.Snapshot liveAuthorizationReplayStatus() {
                return liveCrossIdentityReplay.snapshot();
            }
            @Override public LiveCrossIdentityReplayCoordinator.Snapshot stopLiveAuthorizationReplay() {
                liveCrossIdentityReplay.stop();
                pendingLiveReplays.clear();
                return liveCrossIdentityReplay.snapshot();
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

    private void openDraftInRepeater(RequestRecord record, HttpRequest draft) {
        api.repeater().sendToRepeater(draft, "FlowScope " + record.evidenceId);
        api.logging().logToOutput("FlowScope Repeater 초안 생성: " + record.evidenceId + " (미전송)");
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
            zapProbeStatus.success();
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
            String state = zapProbeStatus.failure(auth);
            body.put("connected", false).put("state", state)
                    .put("message", auth
                            ? "ZAP API는 응답했지만 API key가 일치하지 않습니다. FlowScope와 ZAP 설정을 맞춘 뒤 확장을 다시 로드하세요."
                            : "RETRYING".equals(state)
                                    ? "FlowScope Docker ZAP 응답을 다시 확인하고 있습니다 ("
                                            + zapProbeStatus.consecutiveFailures() + "/3)."
                                    : "127.0.0.1의 FlowScope Docker ZAP에 3회 연속 연결하지 못했습니다. bundle의 zap-up helper를 실행하세요.");
        }
        return body;
    }

    static final class ZapProbeStatus {
        private static final int UNREACHABLE_THRESHOLD = 3;
        private int consecutiveFailures;

        synchronized void success() {
            consecutiveFailures = 0;
        }

        synchronized String failure(boolean authenticationFailure) {
            if (authenticationFailure) {
                consecutiveFailures = 0;
                return "AUTH_FAILED";
            }
            consecutiveFailures++;
            return consecutiveFailures >= UNREACHABLE_THRESHOLD ? "UNREACHABLE" : "RETRYING";
        }

        synchronized int consecutiveFailures() {
            return consecutiveFailures;
        }
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
                @Override public List<RequestRecord> authenticationEvidence(String runId, String accountId) {
                    synchronized (records) {
                        return records.stream()
                                .filter(record -> record.source == Source.SCANNER
                                        && record.sourceDetail == SourceDetail.ZAP_AUTHENTICATION)
                                .filter(record -> runId.equals(record.runId)
                                        && accountId.equals(record.laneAccountId))
                                .toList();
                    }
                }
                @Override public ScopePolicy scope() { return scope; }
                @Override public ZapClient zap() { return zapClient; }
                @Override public int scannerProxyPort() { return configuredScannerProxyPort(); }
                @Override public boolean scannerListenerOpen() {
                    return ZapCampaign.loopbackListenerOpen(configuredScannerProxyPort(), java.time.Duration.ofSeconds(2));
                }
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
                @Override public boolean promoteAuthenticatedSession(String accountId, long evidenceRuntimeId) {
                    return promoteZapAuthenticatedSession(accountId, evidenceRuntimeId);
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

    private List<FlowScopeWebServer.AccountRequestCandidate> safeAccountRequestCandidates(String accountId) {
        AccountProfile account = analysisConfig.account(accountId).orElseThrow(() ->
                new IllegalArgumentException("존재하지 않는 계정입니다: " + accountId));
        List<RequestRecord> candidates = latest.records.stream()
                .filter(record -> record.source == Source.HUMAN && record.hasResponse)
                .filter(record -> account.service().equals(record.service))
                .filter(record -> record.evidenceId != null && !record.evidenceId.isBlank())
                .sorted(java.util.Comparator.comparingLong((RequestRecord record) -> record.timestamp).reversed())
                .limit(20).toList();
        AccountVerificationRule rule = analysisConfig.verificationRule(accountId).orElse(null);
        List<FlowScopeWebServer.AccountRequestCandidate> result = new ArrayList<>();
        for (RequestRecord record : candidates) {
            TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElse(null);
            boolean retained = raw != null && raw.requestRetained() && raw.responseRetained();
            Map<String, String> headers = raw != null && raw.requestRetained()
                    ? rawHeaders(raw.request(), raw.requestBodyOffset()) : Map.of();
            boolean cookie = !rawHeader(headers, "Cookie").isBlank();
            boolean authorization = !rawHeader(headers, "Authorization").isBlank();
            boolean acceptableStatus = record.status >= 200 && record.status < 500 && record.status != 401;
            boolean eligible = retained && (cookie || authorization) && acceptableStatus;
            String reason = eligible ? "연결 가능"
                    : !retained ? "현재 프로세스에 요청·응답 원문이 남아 있지 않습니다."
                    : !(cookie || authorization) ? "Cookie 또는 Authorization이 관측되지 않았습니다."
                    : "로그인 성공 응답으로 사용할 수 없는 상태 코드입니다.";
            boolean matched = false;
            if (rule != null) {
                try {
                    URI uri = URI.create(record.service + (record.path.startsWith("/") ? record.path : "/" + record.path));
                    matched = rule.evaluate(record.method, uri, record.responseBodyForAnalysis())
                            == VerificationOutcome.MATCHED;
                } catch (RuntimeException ignored) { /* malformed metadata is not eligible proof */ }
            }
            result.add(new FlowScopeWebServer.AccountRequestCandidate(
                    record.evidenceId, record.status, record.method, record.path,
                    record.responseContentType == null ? "" : record.responseContentType,
                    cookie, authorization, matched, eligible, reason));
        }
        return List.copyOf(result);
    }

    private void linkObservedHumanSession(String accountId, String evidenceId) {
        AccountProfile account = analysisConfig.account(accountId).orElseThrow(() ->
                new IllegalArgumentException("존재하지 않는 계정입니다: " + accountId));
        RequestRecord record = evidenceRecord(evidenceId);
        if (record.source != Source.HUMAN || !record.hasResponse || !account.service().equals(record.service)) {
            throw new IllegalArgumentException("같은 대상 서비스의 HUMAN 요청만 계정 세션으로 연결할 수 있습니다.");
        }
        TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElseThrow(() ->
                new IllegalStateException("요청 원문이 메모리 상한 또는 재시작으로 폐기됐습니다."));
        if (!raw.requestRetained() || !raw.responseRetained()) {
            throw new IllegalStateException("요청과 응답 원문이 모두 현재 프로세스에 남아 있어야 합니다.");
        }
        Map<String, String> requestHeaders = rawHeaders(raw.request(), raw.requestBodyOffset());
        String fingerprint = Fingerprints.of(rawHeader(requestHeaders, "Authorization"), rawHeader(requestHeaders, "Cookie"));
        if (Fingerprints.ANONYMOUS.equals(fingerprint)) {
            throw new IllegalArgumentException("Cookie 또는 Authorization이 없는 요청은 계정 세션으로 연결할 수 없습니다.");
        }
        boolean bindingExisted = analysisConfig.boundAccount(account.service(), fingerprint)
                .map(bound -> bound.id().equals(account.id())).orElse(false);
        analysisConfig.bindSession(account.service(), fingerprint, account.id());
        try {
            List<String> setCookies = rawHeaderValues(raw.response(), raw.responseBodyOffset(), "Set-Cookie");
            URI target = URI.create(record.service + (record.path.startsWith("/") ? record.path : "/" + record.path));
            sessionBroker.captureObservedExchange(account, target, requestHeaders, record.status,
                    record.location, record.responseBodyForAnalysis(), setCookies, Instant.now());
        } catch (RuntimeException error) {
            if (!bindingExisted) analysisConfig.unbindSession(account.service(), fingerprint);
            throw error;
        }
        revision.incrementAndGet();
        scheduleRebuild();
    }

    /**
     * Copies the one ZAP response that satisfied the configured login proof into the registered
     * account's independent HUMAN replay slot. Raw headers remain inside the process-memory vault.
     */
    private boolean promoteZapAuthenticatedSession(String accountId, long evidenceRuntimeId) {
        try {
            AccountProfile account = analysisConfig.account(accountId).orElseThrow(() ->
                    new IllegalArgumentException("등록되지 않은 ZAP 계정입니다: " + accountId));
            RequestRecord record;
            synchronized (records) {
                record = records.stream().filter(value -> value.runtimeId() == evidenceRuntimeId)
                        .findFirst().orElseThrow(() ->
                                new IllegalStateException("ZAP 로그인 Evidence 원문을 찾을 수 없습니다."));
            }
            TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElseThrow(() ->
                    new IllegalStateException("ZAP 로그인 Evidence 원문이 메모리 상한으로 폐기됐습니다."));
            if (!raw.requestRetained()) {
                throw new IllegalStateException("ZAP 로그인 요청 원문이 메모리 상한으로 폐기됐습니다.");
            }
            Map<String, String> requestHeaders = rawHeaders(raw.request(), raw.requestBodyOffset());
            List<String> setCookies = raw.responseRetained()
                    ? rawHeaderValues(raw.response(), raw.responseBodyOffset(), "Set-Cookie") : List.of();
            URI target = URI.create(record.service + (record.path.startsWith("/") ? record.path : "/" + record.path));
            sessionBroker.captureObservedExchange(account, target, requestHeaders, record.status,
                    record.location, record.responseBodyForAnalysis(), setCookies, Instant.now());
            String fingerprint = Fingerprints.of(rawHeader(requestHeaders, "Authorization"),
                    rawHeader(requestHeaders, "Cookie"));
            if (!Fingerprints.ANONYMOUS.equals(fingerprint)) {
                analysisConfig.bindSession(account.service(), fingerprint, account.id());
            }
            revision.incrementAndGet();
            scheduleRebuild();
            return true;
        } catch (RuntimeException error) {
            api.logging().logToOutput("FlowScope ZAP 로그인 세션의 계정 슬롯 연결 생략: "
                    + Masking.maskSecrets(error.getMessage() == null ? error.getClass().getSimpleName()
                    : error.getMessage()));
            return false;
        }
    }

    private static Map<String, String> rawHeaders(byte[] message, int bodyOffset) {
        Map<String, String> headers = new LinkedHashMap<>();
        for (String line : rawHeaderLines(message, bodyOffset)) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            headers.put(line.substring(0, colon).trim(), line.substring(colon + 1).trim());
        }
        return headers;
    }

    private static List<String> rawHeaderValues(byte[] message, int bodyOffset, String name) {
        List<String> values = new ArrayList<>();
        for (String line : rawHeaderLines(message, bodyOffset)) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase(name)) {
                values.add(line.substring(colon + 1).trim());
            }
        }
        return List.copyOf(values);
    }

    static String rawHeader(Map<String, String> headers, String name) {
        return headers.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .map(Map.Entry::getValue).filter(java.util.Objects::nonNull).findFirst().orElse("");
    }

    private static List<String> rawHeaderLines(byte[] message, int bodyOffset) {
        if (message == null || message.length == 0) return List.of();
        int length = Math.max(0, Math.min(bodyOffset, message.length));
        String head = new String(message, 0, length, java.nio.charset.StandardCharsets.ISO_8859_1);
        String[] lines = head.split("\\r?\\n");
        return lines.length <= 1 ? List.of() : java.util.Arrays.asList(lines).subList(1, lines.length);
    }

    private void validateRuntimeAccount(String id, String label, String service, String roleValue) {
        if (id == null || id.isBlank()) return;
        analysisConfig.account(id.trim()).ifPresent(existing -> {
            io.flowscope.core.AccessRole role;
            try {
                String normalized = roleValue == null || roleValue.isBlank()
                        ? io.flowscope.core.AccessRole.UNKNOWN.name() : roleValue.trim().toUpperCase(Locale.ROOT);
                role = io.flowscope.core.AccessRole.valueOf(normalized);
            } catch (IllegalArgumentException error) {
                throw new IllegalArgumentException("지원하지 않는 계정 역할입니다.");
            }
            AccountProfile requested = new AccountProfile(existing.id(),
                    label == null || label.isBlank() ? existing.label() : label,
                    service, role);
            if (!existing.service().equals(requested.service()) || existing.role() != requested.role()) {
                throw new IllegalArgumentException("등록 계정과 실행기 로그인 설정의 서비스·역할이 다릅니다: "
                        + existing.label());
            }
        });
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
        synchronized (lifecycleMonitor) {
            synchronized (records) {
                if (!shuttingDown.compareAndSet(false, true)) return;
            }
        }
        if (webServer != null) webServer.close();
        if (explorer != null) explorer.close();
        if (zapCampaign != null) zapCampaign.close();
        zapAccounts.close();
        if (activeProjectDatabase != null) {
            try {
                // PR #11: captures still waiting for the delayed rebuild are analyzed and checkpointed once, in order,
                // on the worker. The store writes a temporary file and moves it atomically, so a timed-out save never
                // leaves a partial database behind.
                java.util.concurrent.Future<?> save = worker.submit(() -> {
                    try {
                        // A capture can append before unload but reach scheduleRebuild after the flag is set.
                        // Rebuild once unconditionally so that handoff gap cannot hide unsaved Evidence.
                        rebuildImmediately();
                        if (databaseSavedRevision.get() != revision.get()) {
                            long savingRevision = revision.get();
                            saveActiveDatabase();
                            markDatabaseSaved(savingRevision);
                        }
                    } catch (IOException error) { throw new java.io.UncheckedIOException(error); }
                });
                save.get(10, TimeUnit.SECONDS);
            } catch (Exception error) {
                if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                api.logging().logToError("FlowScope 종료 전 로컬 DB 저장을 완료하지 못해 기존 저장본을 유지했습니다.", error);
            }
        }
        worker.shutdownNow();
        authorizationReplayWorker.shutdownNow();
        proxyObservations.clear();
        toolObservations.clear();
        killCrossIdentityReplay();
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
        HttpRequest request = prepareHumanRequest(seed, requestText, credentialMode, accountId);

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
        appendControlledToolRecord(record, () -> retainRawExchange(record, exchange.request(), response));
        rebuildImmediately();
        int requestBytes = exchange.request().toByteArray().length();
        String displayResponse = responseBytes <= RAW_RESPONSE_LIMIT_BYTES ? responseText
                : "응답이 " + responseBytes + "바이트로 웹 표시 상한을 초과했습니다. Evidence에는 마스킹 요약만 보존했습니다.";
        return new FlowScopeWebServer.RequestLabResult(record.evidenceId, record.status, displayResponse,
                durationMs, requestBytes, responseBytes);
    }

    /** Backend-only Stage 6a seam. UI arming and recommendation selection are intentionally deferred to Stage 6c. */
    CrossIdentityReplayOrchestrator.RunResult runCrossIdentityReplay(
            List<CrossIdentityReplayOrchestrator.Recommendation> recommendations, boolean armed) {
        if (crossIdentityReplay == null) throw new IllegalStateException("FlowScope가 아직 초기화되지 않았습니다.");
        if (liveCrossIdentityReplay != null
                && liveCrossIdentityReplay.snapshot().state() != LiveCrossIdentityReplayCoordinator.State.STOPPED) {
            throw new IllegalStateException("라이브 교차 재전송을 먼저 중지하세요.");
        }
        return crossIdentityReplay.execute(recommendations, armed);
    }

    private CrossIdentityReplayOrchestrator.Recommendation authorizationReplayRecommendation(String itemId) {
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(latest, analysisConfig, archivedValidations);
        AuthorizationMatrix.TestRecommendation recommendation = null;
        String operation = null;
        String resource = null;
        for (AuthorizationMatrix.FunctionCell cell : matrix.functions()) {
            if (cell.id().equals(itemId)) {
                recommendation = cell.recommendation();
                operation = cell.operation();
                break;
            }
        }
        if (operation == null) {
            for (AuthorizationMatrix.ObjectCell cell : matrix.objects()) {
                if (cell.id().equals(itemId)) {
                    recommendation = cell.recommendation();
                    operation = cell.operation();
                    resource = cell.resource();
                    break;
                }
            }
        }
        if (operation == null || recommendation == null) {
            throw new IllegalArgumentException("현재 재전송 추천이 있는 판정 셀을 선택하세요.");
        }
        String expectedOperation = operation;
        String expectedResource = resource;
        AuthorizationMatrix.TestRecommendation selected = recommendation;
        RequestRecord seed = selected.basisEvidenceIds().stream()
                .map(id -> latest.records.stream().filter(record -> id.equals(record.evidenceId)).findFirst().orElse(null))
                .filter(java.util.Objects::nonNull)
                .filter(record -> expectedOperation.equals(record.op))
                .filter(record -> expectedResource == null || expectedResource.equals(record.resource))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("현재 추천과 일치하는 기준 Evidence를 찾을 수 없습니다."));
        HttpRequest prepared = prepareHumanRequest(seed, replayRequestText(seed),
                FlowScopeWebServer.CredentialMode.ANONYMOUS, null);
        return new CrossIdentityReplayOrchestrator.Recommendation(operation, selected.testIdentity(),
                selected.basisIdentity(), seed.evidenceId, URI.create(prepared.url()));
    }

    /**
     * 어떤 판정 셀이든(추천이 없어도) 대상 신원 자격으로 교차 요청을 Burp Repeater 초안으로 연다(D-169). 추천기가
     * 놓친 조합에서도 사람이 직접 조사할 수 있어야 하므로, 추천 basis가 없으면 같은 대상에서 다른 신원이 관측한
     * 요청을 basis로 합성한다. 자동 전송하지 않으며 대상 신원의 강검증 세션 자격만 주입한다.
     */
    private String draftCrossIdentityReplay(String itemId) {
        CrossIdentityReplayOrchestrator.Recommendation recommendation = crossIdentityDraftRecommendation(itemId);
        Map<String, String> credentialHeaders;
        if (CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY.equals(recommendation.targetIdentity())) {
            if (!scope.allows(recommendation.target().toString())) {
                throw new IllegalArgumentException("대상이 현재 exact scope 밖입니다.");
            }
            credentialHeaders = Map.of();
        } else {
            credentialHeaders = sessionBroker.headersForVerifiedAccount(recommendation.targetIdentity(),
                    recommendation.target(), scope, java.time.Instant.now());
        }
        openCrossIdentityReplayDraftAnyMethod(recommendation, credentialHeaders);
        return "교차 실행 요청을 대상 신원 자격으로 Burp Repeater 초안으로 열었습니다. 자동 전송하지 않았습니다.";
    }

    private CrossIdentityReplayOrchestrator.Recommendation crossIdentityDraftRecommendation(String itemId) {
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(latest, analysisConfig, archivedValidations);
        String operation = null;
        String resource = null;
        String testIdentity = null;
        boolean hasRecommendation = false;
        for (AuthorizationMatrix.FunctionCell cell : matrix.functions()) {
            if (cell.id().equals(itemId)) {
                operation = cell.operation();
                testIdentity = cell.identity();
                hasRecommendation = cell.recommendation() != null;
                break;
            }
        }
        if (operation == null) {
            for (AuthorizationMatrix.ObjectCell cell : matrix.objects()) {
                if (cell.id().equals(itemId)) {
                    operation = cell.operation();
                    resource = cell.resource();
                    testIdentity = cell.identity();
                    hasRecommendation = cell.recommendation() != null;
                    break;
                }
            }
        }
        if (operation == null) throw new IllegalArgumentException("존재하지 않는 판정 셀입니다.");
        if (hasRecommendation) return authorizationReplayRecommendation(itemId);
        String expectedOperation = operation;
        String expectedResource = resource;
        String selfIdentity = testIdentity;
        String basisIdentity = null;
        List<String> basisEvidence = List.of();
        if (expectedResource == null) {
            for (AuthorizationMatrix.FunctionCell cell : matrix.functions()) {
                if (expectedOperation.equals(cell.operation()) && !selfIdentity.equals(cell.identity())
                        && !cell.evidenceIds().isEmpty()) {
                    basisIdentity = cell.identity();
                    basisEvidence = cell.evidenceIds();
                    break;
                }
            }
        } else {
            for (AuthorizationMatrix.ObjectCell cell : matrix.objects()) {
                if (expectedOperation.equals(cell.operation()) && expectedResource.equals(cell.resource())
                        && !selfIdentity.equals(cell.identity()) && !cell.evidenceIds().isEmpty()) {
                    basisIdentity = cell.identity();
                    basisEvidence = cell.evidenceIds();
                    break;
                }
            }
        }
        if (basisIdentity == null) {
            throw new IllegalStateException("같은 대상에서 다른 신원이 관측한 요청이 없어 Burp Repeater 초안을 만들 수 없습니다.");
        }
        RequestRecord seed = basisEvidence.stream()
                .map(id -> latest.records.stream().filter(record -> id.equals(record.evidenceId)).findFirst().orElse(null))
                .filter(java.util.Objects::nonNull)
                .filter(record -> expectedOperation.equals(record.op))
                .filter(record -> expectedResource == null || expectedResource.equals(record.resource))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("기준 Evidence 원문을 찾을 수 없습니다."));
        HttpRequest prepared = prepareHumanRequest(seed, replayRequestText(seed),
                FlowScopeWebServer.CredentialMode.ANONYMOUS, null);
        return new CrossIdentityReplayOrchestrator.Recommendation(operation, testIdentity,
                basisIdentity, seed.evidenceId, URI.create(prepared.url()));
    }

    /** 메서드 제한 없이 교차 신원 요청을 Burp Repeater 초안으로만 연다(운영자가 직접 전송). 자동 전송 없음(D-169). */
    private void openCrossIdentityReplayDraftAnyMethod(CrossIdentityReplayOrchestrator.Recommendation recommendation,
                                                       Map<String, String> credentialHeaders) {
        RequestRecord seed = evidenceRecord(recommendation.basisEvidenceId());
        HttpRequest request = prepareReplayRequest(seed, replayRequestText(seed), credentialHeaders);
        if (!URI.create(request.url()).equals(recommendation.target())) {
            throw new IllegalArgumentException("추천 대상과 기준 Evidence 요청 대상이 일치하지 않습니다.");
        }
        openDraftInRepeater(seed, request);
    }

    void killCrossIdentityReplay() {
        pendingLiveReplays.clear();
        if (liveCrossIdentityReplay != null) liveCrossIdentityReplay.reset();
        if (crossIdentityReplay != null) crossIdentityReplay.kill();
    }

    private CrossIdentityReplayOrchestrator.Exchange executeCrossIdentityReplay(
            CrossIdentityReplayOrchestrator.Recommendation recommendation,
            Map<String, String> credentialHeaders,
            CrossIdentityReplayOrchestrator.ReplayContext context) {
        RequestRecord seed = evidenceRecord(recommendation.basisEvidenceId());
        TransientExchangeVault.Exchange raw = rawExchanges.get(seed).orElse(null);
        if (raw == null || !raw.requestRetained()) {
            throw new IllegalStateException("자동 재전송에는 현재 프로세스의 원문 요청이 필요합니다.");
        }
        HttpRequest request = prepareReplayRequest(seed, decodeRequest(raw, seed.requestContentType).text(),
                credentialHeaders);
        if (!Set.of("GET", "HEAD").contains(request.method().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException("안전 자동 재전송은 GET/HEAD만 허용됩니다.");
        }
        if (!URI.create(request.url()).equals(recommendation.target())) {
            throw new IllegalArgumentException("추천 대상과 기준 Evidence 요청 대상이 일치하지 않습니다.");
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

        HttpResponse response = exchange.response();
        RequestRecord record = recordFrom(exchange.request(), response,
                new PortProfile(Source.SCANNER, SourceDetail.AUTHORIZATION_REPLAY),
                System.currentTimeMillis(), false, context.runId(), null,
                recommendation.targetIdentity());
        context.applyTo(record);
        appendControlledToolRecord(record, () -> retainRawExchange(record, exchange.request(), response));
        rebuildImmediately();
        RequestRecord published = latest.records.stream()
                .filter(value -> value.runtimeId() == record.runtimeId()).findFirst()
                .orElseThrow(() -> new IllegalStateException("재전송 Evidence 게시에 실패했습니다."));
        int requestBytes = exchange.request().toByteArray().length();
        int responseBytes = response.toByteArray().length();
        String responseText = responseBytes <= RAW_RESPONSE_LIMIT_BYTES
                ? HttpMessageTextCodec.decode(response.toByteArray().getBytes(), response.bodyOffset(),
                response.headerValue("Content-Type")).text()
                : "응답이 " + responseBytes + "바이트로 웹 표시 상한을 초과했습니다. Evidence에는 마스킹 요약만 보존했습니다.";
        FlowScopeWebServer.RequestLabResult result = new FlowScopeWebServer.RequestLabResult(
                published.evidenceId, response.statusCode(), responseText, durationMs, requestBytes, responseBytes);
        List<String> setCookies = response.headers().stream()
                .filter(header -> header.name().equalsIgnoreCase("Set-Cookie"))
                .map(HttpHeader::value).toList();
        return new CrossIdentityReplayOrchestrator.Exchange(result, response.headerValue("Location"),
                boundedResponseBody(response), setCookies);
    }

    private void openCrossIdentityReplayDraft(CrossIdentityReplayOrchestrator.Recommendation recommendation,
                                               Map<String, String> credentialHeaders) {
        RequestRecord seed = evidenceRecord(recommendation.basisEvidenceId());
        HttpRequest request = prepareReplayRequest(seed, replayRequestText(seed), credentialHeaders);
        if (!Set.of("POST", "PUT", "PATCH", "DELETE").contains(request.method().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException("파괴적 요청 초안은 POST/PUT/PATCH/DELETE만 지원합니다.");
        }
        if (!URI.create(request.url()).equals(recommendation.target())) {
            throw new IllegalArgumentException("추천 대상과 기준 Evidence 요청 대상이 일치하지 않습니다.");
        }
        openDraftInRepeater(seed, request);
    }

    private String replayRequestText(RequestRecord seed) {
        TransientExchangeVault.Exchange raw = rawExchanges.get(seed).orElse(null);
        return raw != null && raw.requestRetained()
                ? decodeRequest(raw, seed.requestContentType).text()
                : seed.requestTextForEvidence();
    }

    private HttpRequest prepareReplayRequest(RequestRecord seed, String requestText,
                                             Map<String, String> credentialHeaders) {
        HttpRequest request = prepareHumanRequest(seed, requestText,
                FlowScopeWebServer.CredentialMode.ANONYMOUS, null);
        for (Map.Entry<String, String> header : credentialHeaders.entrySet()) {
            request = request.withHeader(header.getKey(), header.getValue());
        }
        return request;
    }

    private HttpRequest prepareHumanRequest(RequestRecord seed, String requestText,
                                            FlowScopeWebServer.CredentialMode credentialMode,
                                            String accountId) {
        if (requestText == null || requestText.isBlank()) {
            throw new IllegalArgumentException("HTTP 요청 전문이 필요합니다.");
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
                request = request.withHeader(header.getKey(), header.getValue());
            }
        }
        if (!originalBytesUsed && request.hasHeader("Content-Length")) {
            String actualLength = String.valueOf(request.body().length());
            if (!actualLength.equals(request.headerValue("Content-Length"))) {
                request = request.withUpdatedHeader("Content-Length", actualLength);
            }
        }
        return request;
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
        boolean hasAcceptEncoding = false;
        for (Map.Entry<String, String> header : input.headers().entrySet()) {
            if (!safeHeader(header.getKey(), header.getValue())) {
                throw new IllegalArgumentException("Explorer HTTP 헤더가 올바르지 않습니다.");
            }
            if (header.getKey().equalsIgnoreCase("Host") || header.getKey().equalsIgnoreCase("Content-Length")) continue;
            hasAccept |= header.getKey().equalsIgnoreCase("Accept");
            hasConnection |= header.getKey().equalsIgnoreCase("Connection");
            hasAcceptEncoding |= header.getKey().equalsIgnoreCase("Accept-Encoding");
            raw.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
        }
        if (!hasAccept) raw.append("Accept: */*\r\n");
        if (!hasConnection) raw.append("Connection: close\r\n");
        // 압축 해제기가 없으므로 identity를 요청한다. 이게 없으면 gzip된 source map·JS가 이진처럼 보여 텍스트 디코드에서 버려진다(D-163).
        if (!hasAcceptEncoding) raw.append("Accept-Encoding: identity\r\n");
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
            int copiedBody = Math.min(responseBody.length(), EXPLORER_RESPONSE_BYTES);
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
            appendControlledToolRecord(record, () -> retainRawExchange(record, exchange.request(), response));
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

    /** Request Lab/Explorer처럼 응답을 기다리는 통제 요청이 unload 뒤 Evidence를 되살리지 않게 한다. */
    void appendControlledToolRecord(RequestRecord record, Runnable retainExchange) {
        synchronized (records) {
            if (shuttingDown.get()) {
                throw new IllegalStateException("FlowScope 종료 중에는 새 Evidence를 기록할 수 없습니다.");
            }
            if (records.size() >= MAX_RECORDS) throw new IllegalStateException("레코드 상한에 도달했습니다.");
            records.add(record);
            retainExchange.run();
            if (liveCrossIdentityReplay != null
                    && liveCrossIdentityReplay.acceptingCaptures(record)) {
                pendingLiveReplays.add(record.runtimeId());
            }
        }
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
            dispatchPendingLiveHumanReplays(result);
        }
        return published;
    }

    private void dispatchPendingLiveHumanReplays(Pipeline.Result result) {
        if (liveCrossIdentityReplay == null || result == null) return;
        for (RequestRecord record : result.records) {
            if (!pendingLiveReplays.remove(record.runtimeId())) continue;
            TransientExchangeVault.Exchange raw = rawExchanges.get(record).orElse(null);
            boolean requestRetained = raw != null && raw.requestRetained();
            URI target = null;
            if (requestRetained) {
                try {
                    HttpRequest prepared = prepareHumanRequest(record, replayRequestText(record),
                            FlowScopeWebServer.CredentialMode.ANONYMOUS, null);
                    target = URI.create(prepared.url());
                } catch (RuntimeException ignored) {
                    // No request is sent; the coordinator records this basis as ineligible.
                }
            }
            liveCrossIdentityReplay.offer(record, target, requestRetained);
        }
    }

    private void rebuildRouteCandidates(List<RequestRecord> sourceRecords) {
        routeCandidates = routeCandidatesFor(sourceRecords);
    }

    private void acceptExplorerDiscoveries(List<RouteCandidate> discoveries) {
        if (discoveries == null || discoveries.isEmpty()) return;
        synchronized (restoredRouteCandidates) {
            restoredRouteCandidates.addAll(discoveries);
        }
        scheduleRebuild();
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
