package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.*;

import java.net.URI;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** 전송 계층과 독립된 ZAP 캠페인. 호스트가 한 인스턴스의 실행·취소·종료를 소유한다. */
public final class ZapCampaign implements AutoCloseable {
    public interface State {
        Pipeline.Result snapshot();
        default Pipeline.Result completionSnapshot() { return snapshot(); }
        default long capturedCount(Source source, String runId, SourceDetail detail) {
            return snapshot().records.stream()
                    .filter(record -> record.source == source && runId.equals(record.runId))
                    .filter(record -> detail == null || record.sourceDetail == detail)
                    .count();
        }
        default List<RequestRecord> authenticationEvidence(String runId, String accountId) {
            return snapshot().records.stream()
                    .filter(record -> record.source == Source.SCANNER
                            && record.sourceDetail == SourceDetail.ZAP_AUTHENTICATION)
                    .filter(record -> runId.equals(record.runId)
                            && accountId.equals(record.laneAccountId))
                    .toList();
        }
        ScopePolicy scope();
        ZapClient zap();
        default int scannerProxyPort() { return 8081; }
        /**
         * Burp SCANNER proxy listener가 실제로 열려 있는지. ZAP은 host.docker.internal:port로 Burp를 거쳐야만 FlowScope가
         * 수집하므로, 닫혀 있으면 캠페인은 몇 분 뒤 "0건"으로만 끝난다(PR #10 D-094 사전 점검의 복원). 기본값은 true이며
         * 실제 확장만 loopback 연결로 검사한다.
         */
        default boolean scannerListenerOpen() { return true; }
        default void scannerCapability(String runId, String capability) { }
        default void clearScannerCapability(String runId) { }
        default long scannerCapabilityRejections(String runId) { return 0; }
        default void scannerDirectAuthentication(String runId, boolean enabled) { }
        default boolean promoteAuthenticatedSession(String accountId, long evidenceRuntimeId) { return false; }
        RunContextRegistry contexts();
        boolean approve(String action, String target);
        default ZapAccountVault zapAccounts() { return null; }
    }

    public enum ZapDefinitionType { OPENAPI, GRAPHQL, POSTMAN, SOAP }
    public record ZapDefinition(ZapDefinitionType type, String url, String endpoint) {}

    private static final int MAX_ZAP_ALERT_SNAPSHOT = 20_000;
    private static final int MAX_ZAP_LANES = 20;
    private static final int MAX_ZAP_PROGRESS_EVENTS = 120;
    // ZAP 2.17 HttpSender: Spider=3, auth=5, import/manual=6, Authentication Helper=14,
    // auth poll=15, Client Spider=18.
    private static final List<Integer> CAPABILITY_INITIATORS = List.of(3, 5, 6, 14, 15, 18);
    // 일반 Spider: 원문(HTML·헤더·robots·sitemap·JS 문자열)에서 주소를 뽑아 GET으로 따라간다. Client Spider와 찾는 범위가 달라
    // 함께 돌린다(ZAP 권고). 쓰기 요청을 만들지 않도록 POST 폼 제출은 끄고, 로그인 세션을 끊거나 지우는 경로는 제외한다.
    private static final int SPIDER_MAX_DEPTH = 5;
    private static final int SPIDER_MAX_DURATION_MINUTES = 10;
    public static final String SPIDER_EXCLUDE_REGEX = "(?i)^[^?#]*(log-?out|sign-?out|log-?off|delete|destroy).*$";
    // Client Spider는 Client Map에 새로 추가된 요소만 클릭한다(ZAP client add-on ClientMap.addComponentToNode).
    // headless ZAP은 새 세션에서도 Map을 비우지 않고(GUI 패널만 비움), 로그인 단계도 /dashboard 같은 화면을 먼저 열어
    // 메뉴·버튼을 Map에 등록한다. 그래서 Client Spider 직전에 비운다(실측: crAPI 클릭 0건, Shop·Community 미진입).
    // 공개 API가 없어 start-zap.sh가 등록한 스크립트로 비우고, 요청 번호를 돌려받아 이번 요청의 성공만 인정한다.
    static final String CLIENT_MAP_RESET_SCRIPT = "flowscope-clear-client-map";
    static final String CLIENT_MAP_RESET_REQUEST = "flowscope.clientMap.request";
    static final String CLIENT_MAP_RESET_DONE = "flowscope.clientMap.cleared";
    // 비운 Map에 시작 주소와 번들의 클라이언트 라우트를 미방문 노드로 넣는다. Client Spider는 시작할 때 Map의 미방문 주소를
    // 모두 탐색 작업으로 추가한다(ClientSpider.getUnvisitedUrls). 클릭으로 닿지 못하는 SPA 화면을 직접 연다(Katana -jc 방식).
    static final String CLIENT_MAP_SEEDS = "flowscope.clientMap.seeds";
    // 시작 주소로 주지 않는 화면: 로그인·로그아웃과 계정 정보를 바꾸는 화면. Client Spider는 연 화면의 폼을 제출하므로
    // 일부러 열어 주면 점검 계정의 이메일·비밀번호가 바뀌어 다음 로그인이 깨질 수 있다.
    static final String ROUTE_SEED_EXCLUDE_REGEX =
            "(?i).*(log-?(in|out|off)|sign-?(in|up|out)|register|password|unlock|change-|delete|destroy|remove).*";
    private static final java.util.regex.Pattern ROUTE_SEED_EXCLUDE = java.util.regex.Pattern.compile(ROUTE_SEED_EXCLUDE_REGEX);
    private static final int MAX_ROUTE_SEEDS = 600;
    private static final long CLIENT_SPIDER_TIMEOUT_MILLIS = 20 * 60_000L;
    // 후속 패스는 직전 패스가 수집한 응답에서 새로 생긴 상세 주소만 연다. 상세 화면에서 또 다른 ID가 나오면 다음 패스가
    // 그것을 연다(깊이). 끝없이 늘지 않도록 패스 수와 패스마다 시간 상한을 둔다.
    private static final int MAX_FOLLOW_UP_PASSES = 3;
    private static final long FOLLOW_UP_CLIENT_SPIDER_MILLIS = 10 * 60_000L;
    private static final long CLIENT_MAP_RESET_CONFIRM_MILLIS = 5_000L;
    private static final Set<String> SAFE_ZAP_ADDONS = Set.of(
            "client", "spider", "pscan", "pscanrules", "selenium", "openapi", "websocket",
            "network", "replacer", "authhelper");
    private final ObjectMapper json = new ObjectMapper();
    private final State state;
    private final ExecutorService zapWorkflow = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "flowscope-zap-baseline");
        thread.setDaemon(true);
        return thread;
    });
    private final ScheduledExecutorService zapHeartbeat = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "flowscope-zap-heartbeat");
        thread.setDaemon(true);
        return thread;
    });
    private volatile ZapBaselineRun zapBaseline;
    private volatile ArrayNode zapBaselineAlerts = json.createArrayNode();
    private volatile List<ZapLaneResult> zapBaselineLanes = List.of();
    private volatile List<ZapAuthenticationResult> zapAuthentication = List.of();
    private volatile List<ZapLaneRuntime> zapLaneRuntime = List.of();
    private volatile List<ZapProgressEvent> zapProgressEvents = List.of();
    private final AtomicBoolean zapCancelRequested = new AtomicBoolean();
    private volatile Future<?> zapWorkflowFuture;
    private volatile boolean zapWorkflowActive;
    private ZapBaselineRun pendingZapResult;
    private volatile long zapCleanupStartedAt;
    private volatile String ownedClientScanId = "";
    private volatile String ownedSpiderScanId = "";
    private volatile String zapCapabilityRunId = "";
    private volatile String zapCapabilityRule = "";

    private record ZapBaselineRun(String runId, String target, String status, String stage,
                                  String scanId, String warning, long capturedRecords,
                                  int definitionCount, int alertCount, String error) {}
    private record ZapLaneResult(String accountId, String accountLabel, String status, String stage,
                                 long capturedRecords, long clientCaptures, int definitionImports,
                                 int alertCount, boolean alertSnapshotComplete,
                                 boolean passiveComplete, int passiveRemaining,
                                 String warning, String error) {}
    private record ZapLaneRuntime(long queuedAt, long startedAt, long endedAt, long stageStartedAt,
                                  long lastHeartbeatAt, long lastProgressAt, long stageTimeoutMillis,
                                  long capturedAtStart, long clientAtStart,
                                  long lastCaptured, int passiveRemaining, String passiveTask,
                                  String heartbeatStatus) {}
    private record ZapAuthenticationResult(String state, String browser, String message) {}
    private record ZapLane(String accountId, String accountLabel) {}
    private record ZapAlertCollection(int count, boolean truncated) {}
    private record PassiveDrainResult(boolean complete, int remaining, String task) {}
    private record ZapProgressEvent(long at, String accountLabel, String stage,
                                    String level, String message) {}
    private static final class ZapIsolationException extends IllegalStateException {
        ZapIsolationException(String message) { super(message); }
    }

    public ZapCampaign(State state) {
        this.state = java.util.Objects.requireNonNull(state);
    }

    public JsonNode startDeterministicZapBaseline(String target, String accountId) {
        return startDeterministicZapCampaign(target,
                accountId == null || accountId.isBlank() ? List.of() : List.of(accountId),
                accountId == null || accountId.isBlank());
    }
    public JsonNode startDeterministicZapCampaign(String target, List<String> accountIds,
                                                  boolean includeAnonymous) {
        return startDeterministicZapCampaign(target, accountIds, includeAnonymous, List.of());
    }
    public JsonNode startDeterministicZapCampaign(String target, List<String> accountIds,
                                                  boolean includeAnonymous,
                                                  List<ZapDefinition> definitions) {
        ObjectNode args = json.createObjectNode().put("target", target);
        args.put("include_anonymous", includeAnonymous);
        ArrayNode accounts = args.putArray("account_ids");
        if (accountIds != null) accountIds.stream().filter(value -> value != null && !value.isBlank())
                .distinct().forEach(accounts::add);
        ArrayNode definitionNodes = args.putArray("definitions");
        if (definitions != null) definitions.forEach(definition -> {
            if (definition == null || definition.type() == null) return;
            ObjectNode node = definitionNodes.addObject().put("type", definition.type().name());
            if (definition.url() != null) node.put("url", definition.url());
            if (definition.endpoint() != null) node.put("endpoint", definition.endpoint());
        });
        return startZapBaseline(args);
    }
    public JsonNode deterministicZapBaselineStatus() { return zapBaselineStatus(); }
    public JsonNode startAuthenticationOnly(String accountId) {
        ZapAccountVault.View account = state.zapAccounts().view(accountId);
        ObjectNode args = json.createObjectNode().put("target", account.service())
                .put("include_anonymous", false).put("authentication_only", true);
        args.putArray("account_ids").add(account.id());
        return startZapBaseline(args);
    }
    public synchronized JsonNode cancelDeterministicZapBaseline() {
        ZapBaselineRun current = zapBaseline;
        if (current == null || !"RUNNING".equals(current.status()) || pendingZapResult != null) return zapBaselineStatus();
        zapCancelRequested.set(true);
        deferZapResult(new ZapBaselineRun(current.runId(), current.target(), "CANCELLED", "CANCELLED",
                "", "", capturedForRun(current.runId()), current.definitionCount(), zapBaselineAlerts.size(), ""));
        Future<?> future = zapWorkflowFuture;
        if (future != null) future.cancel(true);
        RuntimeException cleanupFailure = stopAndAwaitOwnedCrawlers();
        state.scannerDirectAuthentication(current.runId(), false);
        RuntimeException capabilityFailure = removeScannerCapability(current.runId());
        if (capabilityFailure != null) {
            cleanupFailure = mergeFailure(cleanupFailure, "scanner capability cleanup failed", capabilityFailure);
        }
        String warning = cleanupFailure == null ? "" : "취소 중 ZAP 정리 실패: " + cleanupFailure.getMessage();
        pendingZapResult = new ZapBaselineRun(current.runId(), current.target(), "CANCELLED", "CANCELLED",
                "", warning, capturedForRun(current.runId()), current.definitionCount(),
                zapBaselineAlerts.size(), "");
        return zapBaselineStatus();
    }
    public void resetWorkflow() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        if (zapBaseline == null || !"RUNNING".equals(zapBaseline.status())) {
            zapBaseline = null;
            zapBaselineAlerts = json.createArrayNode();
            zapBaselineLanes = List.of();
            zapAuthentication = List.of();
            zapLaneRuntime = List.of();
            zapProgressEvents = List.of();
        }
    }

    @Override public void close() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        // A cancelled FutureTask removed from the queue will never execute its run/finally hook.
        for (Runnable queued : zapWorkflow.shutdownNow()) {
            if (queued instanceof Future<?> task) finishZapWorkflowTask(task);
        }
        try { zapWorkflow.awaitTermination(10, TimeUnit.SECONDS); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        zapLaneRuntime = List.of();
        zapHeartbeat.shutdownNow();
    }

    synchronized JsonNode startZapBaseline(JsonNode args) {
        rejectIndependentExplorer("ZAP baseline");
        if (zapWorkflowActive) {
            throw new IllegalStateException("ZAP campaign cleanup is still running");
        }
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) {
            throw new IllegalStateException("ZAP baseline is already running: " + zapBaseline.runId());
        }
        String target = withRootPath(required(args, "target"));
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        LinkedHashSet<String> requestedAccounts = new LinkedHashSet<>();
        if (args.path("account_ids").isArray()) {
            args.path("account_ids").forEach(value -> {
                if (!value.asText().isBlank()) requestedAccounts.add(value.asText());
            });
        }
        String legacyAccount = args.path("account_id").asText();
        if (!legacyAccount.isBlank()) requestedAccounts.add(legacyAccount);
        boolean includeAnonymous = args.has("include_anonymous")
                ? args.path("include_anonymous").asBoolean(false) : requestedAccounts.isEmpty();
        boolean authenticationOnly = args.path("authentication_only").asBoolean(false);
        List<ZapDefinition> definitions = validatedZapDefinitions(args.path("definitions"));
        if (authenticationOnly && (includeAnonymous || requestedAccounts.size() != 1 || !definitions.isEmpty())) {
            throw new IllegalArgumentException("세션 갱신은 로그인 계정 하나만 선택해야 합니다.");
        }
        verifySafeZapEnvironment(definitions);
        if (!state.scannerListenerOpen()) {
            int port = state.scannerProxyPort();
            throw new IllegalStateException("Burp SCANNER proxy listener 127.0.0.1:" + port
                    + " is closed: add a Burp Proxy listener on port " + port
                    + " bound to all interfaces so Docker ZAP can reach host.docker.internal:" + port);
        }
        if (!definitions.isEmpty() && !state.approve("ZAP API 정의가 만든 요청 전송", target)) {
            throw new IllegalStateException("API definition import requires explicit Burp approval");
        }
        List<ZapLane> lanes = new ArrayList<>();
        if (includeAnonymous) lanes.add(new ZapLane(null, "비로그인"));
        for (String accountId : requestedAccounts) {
            String validated = validatedAccountForTarget(accountId, target);
            ZapAccountVault.View account = state.zapAccounts().view(validated);
            lanes.add(new ZapLane(validated, account.label()));
        }
        if (lanes.isEmpty()) throw new IllegalArgumentException("select anonymous or at least one active account");
        if (lanes.size() > MAX_ZAP_LANES) {
            throw new IllegalArgumentException("a ZAP campaign supports at most " + MAX_ZAP_LANES + " identities");
        }
        String runId = validatedRunId(args.path("run_id").asText("zap-baseline-" + System.currentTimeMillis()));
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_CLIENT_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, null));
        try {
            installScannerCapability(target, runId);
            zapBaselineAlerts = json.createArrayNode();
            zapProgressEvents = List.of();
            long queuedAt = System.currentTimeMillis();
            zapBaselineLanes = lanes.stream().map(lane -> new ZapLaneResult(lane.accountId(), lane.accountLabel(),
                    "PENDING", "PENDING", 0, 0, 0, 0,
                    false, false, -1, "", "")).toList();
            zapAuthentication = lanes.stream().map(lane -> lane.accountId() == null
                    ? new ZapAuthenticationResult("NOT_APPLICABLE", "", "비로그인 lane")
                    : new ZapAuthenticationResult("PENDING", ZapClient.CLIENT_BROWSER, "ZAP 로그인 대기")).toList();
            zapLaneRuntime = lanes.stream().map(lane -> new ZapLaneRuntime(queuedAt, 0, 0, 0,
                    0, queuedAt, 0, 0, 0, 0,
                    -1, "", "대기 중")).toList();
            zapBaseline = new ZapBaselineRun(runId, target, "RUNNING", "INITIALIZING",
                    "", "", 0, definitions.size(), 0, "");
            zapCancelRequested.set(false);
            pendingZapResult = null;
            zapCleanupStartedAt = 0;
            ownedClientScanId = "";
            ownedSpiderScanId = "";
            recordZapProgress("전체", "INITIALIZING", "INFO", authenticationOnly
                    ? "독립 로그인 세션 갱신 대기열 생성"
                    : lanes.size() + "개 신원 격리 검사 대기열 생성");
            zapWorkflowActive = true;
            FutureTask<Void> task = new FutureTask<>(() -> {
                if (authenticationOnly) runAuthenticationOnlySafely(runId, target, lanes.getFirst());
                else runZapCampaignSafely(runId, target, lanes, definitions);
                return null;
            }) {
                @Override public void run() {
                    try { super.run(); }
                    finally { finishZapWorkflowTask(this); }
                }
            };
            zapWorkflowFuture = task;
            zapWorkflow.execute(task);
        } catch (RuntimeException error) {
            zapWorkflowActive = false;
            RuntimeException capabilityFailure = removeScannerCapability(runId);
            state.contexts().abort(Source.SCANNER, runId);
            String detail = error instanceof RejectedExecutionException
                    ? "ZAP workflow executor is unavailable"
                    : (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            if (capabilityFailure != null) {
                detail = appendWarning(detail, "scanner capability cleanup: " + capabilityFailure.getMessage());
            }
            zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "", 0,
                    definitions.size(), 0, detail);
            throw error;
        }
        return zapBaselineNode(zapBaseline);
    }

    private void runAuthenticationOnlySafely(String runId, String target, ZapLane lane) {
        String contextName = "flowscope-session-" + runId;
        String contextId = "";
        boolean contextCreated = false;
        ZapBrowserAuthenticator.Identity identity = null;
        try {
            state.scannerDirectAuthentication(runId, true);
            replaceZapLane(0, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "AUTHENTICATION", 0, 0, 0, 0, false, false, -1, "", ""));
            replaceZapAuthentication(0, new ZapAuthenticationResult(
                    "AUTHENTICATING", ZapClient.CLIENT_BROWSER, "ZAP 브라우저 로그인 실행 중"));
            state.contexts().transition(Source.SCANNER, runId,
                    SourceDetail.ZAP_AUTHENTICATION, lane.accountId());
            state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.AUTHENTICATING,
                    "ZAP 브라우저 로그인 실행 중");

            requireZapOk(state.zap().newTemporarySession(), "create an isolated session");
            JsonNode context = parseZap(state.zap().newContext(contextName));
            contextCreated = true;
            contextId = context.path("contextId").asText();
            if (contextId.isBlank()) throw new IllegalStateException("ZAP did not create an isolated target context");
            requireZapOk(state.zap().includeInContext(contextName, ZapClient.exactSubtreeRegex(target)),
                    "include the exact target subtree in context");
            requireZapOk(state.zap().setContextInScope(contextName), "mark the target context in scope");

            String finalContextId = contextId;
            identity = state.zapAccounts().withSecret(lane.accountId(), secret ->
                    new ZapBrowserAuthenticator(state.zap(), json, state.scope()::allows,
                            () -> state.authenticationEvidence(runId, lane.accountId())).authenticate(
                            runId, target, 0, finalContextId, contextName, secret));
            if (!state.promoteAuthenticatedSession(lane.accountId(), identity.verifiedEvidenceRuntimeId())) {
                throw new IllegalStateException("인증은 확인됐지만 독립 계정 세션으로 연결하지 못했습니다.");
            }
            state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.VERIFIED_BY_ZAP,
                    "ZAP 인증 Evidence를 독립 계정 세션으로 연결했습니다.");
            replaceZapAuthentication(0, new ZapAuthenticationResult(
                    "VERIFIED_BY_ZAP", identity.browser(), "독립 계정 세션 갱신 완료"));
            RuntimeException cleanup = cleanupZapIdentity(identity, contextName, contextCreated);
            identity = null;
            contextCreated = false;
            if (cleanup != null) throw new ZapIsolationException(cleanup.getMessage());
            long authenticationRecords = state.capturedCount(Source.SCANNER, runId,
                    SourceDetail.ZAP_AUTHENTICATION);
            replaceZapLane(0, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "COMPLETED",
                    "SESSION_READY", authenticationRecords, 0, 0, 0,
                    true, true, 0, "", ""));
            deferZapResult(new ZapBaselineRun(runId, target, "COMPLETED", "SESSION_READY",
                    "", "", authenticationRecords, 0, 0, ""));
        } catch (Throwable error) {
            RuntimeException cleanup = cleanupZapIdentity(identity, contextName, contextCreated);
            String detail = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (cleanup != null) detail = appendWarning(detail, "cleanup: " + cleanup.getMessage());
            state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.FAILED, detail);
            replaceZapAuthentication(0, new ZapAuthenticationResult(
                    "FAILED", ZapClient.CLIENT_BROWSER, detail));
            long authenticationRecords = state.capturedCount(Source.SCANNER, runId,
                    SourceDetail.ZAP_AUTHENTICATION);
            replaceZapLane(0, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "FAILED", "FAILED",
                    authenticationRecords, 0, 0, 0, false, false, -1, "", detail));
            deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED",
                    "", "", authenticationRecords, 0, 0, detail));
        } finally {
            state.scannerDirectAuthentication(runId, false);
            RuntimeException capabilityFailure = removeScannerCapability(runId);
            if (capabilityFailure != null) {
                deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                        state.capturedCount(Source.SCANNER, runId, SourceDetail.ZAP_AUTHENTICATION), 0, 0,
                        "ZAP scanner capability cleanup failed: " + capabilityFailure.getMessage()));
            }
            state.contexts().abort(Source.SCANNER, runId);
        }
    }

    private void runZapCampaignSafely(String runId, String target, List<ZapLane> lanes,
                                      List<ZapDefinition> definitions) {
        try {
            runZapCampaign(runId, target, lanes, definitions);
        } catch (Throwable error) {
            RuntimeException cleanup = stopAndAwaitOwnedCrawlers();
            if (zapCancelRequested.get()) return;
            String detail = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (cleanup != null) detail = appendWarning(detail, "cleanup: " + cleanup.getMessage());
            deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    capturedForRun(runId), definitions.size(), zapBaselineAlerts.size(), detail));
        } finally {
            state.scannerDirectAuthentication(runId, false);
            RuntimeException capabilityFailure = removeScannerCapability(runId);
            if (capabilityFailure != null && zapBaseline != null && runId.equals(zapBaseline.runId())
                    && !zapCancelRequested.get()) {
                deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                        capturedForRun(runId), definitions.size(), zapBaselineAlerts.size(),
                        "ZAP scanner capability cleanup failed: " + capabilityFailure.getMessage()));
            }
            ownedClientScanId = "";
            ownedSpiderScanId = "";
            if (pendingZapResult != null && pendingZapResult.status().startsWith("COMPLETED")) {
                try {
                    state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_PASSIVE_SCAN, null);
                    LaneCompletionPolicy.complete(state.contexts(), Source.SCANNER, runId, state.completionSnapshot());
                } catch (RuntimeException error) {
                    deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                            capturedForRun(runId), definitions.size(), zapBaselineAlerts.size(), error.getMessage()));
                }
            }
        }
    }

    private synchronized void finishZapWorkflowTask(Future<?> task) {
        if (zapWorkflowFuture == task) {
            if (pendingZapResult != null) {
                ZapBaselineRun result = pendingZapResult;
                if (!result.status().startsWith("COMPLETED")) state.contexts().abort(Source.SCANNER, result.runId());
                if ("CANCELLED".equals(result.status())) finishCancelledLanes(result.runId());
                pendingZapResult = null;
                recordZapProgress("전체", result.stage(), "FAILED".equals(result.status()) ? "ERROR"
                                : result.warning().isBlank() ? "DONE" : "WARN",
                        "ZAP 캠페인 정리 종료 · " + result.status()
                                + (result.warning().isBlank() ? "" : " · " + result.warning()));
                // A caller that observes terminal can acquire the start monitor immediately.
                zapWorkflowFuture = null;
                zapWorkflowActive = false;
                zapBaseline = result;
            } else {
                zapWorkflowFuture = null;
                zapWorkflowActive = false;
            }
        }
    }

    private void finishCancelledLanes(String runId) {
        for (int index = 0; index < zapBaselineLanes.size(); index++) {
            ZapLaneResult lane = zapBaselineLanes.get(index);
            if (!Set.of("PENDING", "RUNNING").contains(lane.status())) continue;
            boolean pending = "PENDING".equals(lane.status());
            ZapLaneRuntime timing = index < zapLaneRuntime.size() ? zapLaneRuntime.get(index) : null;
            long captured = pending || timing == null ? lane.capturedRecords()
                    : Math.max(lane.capturedRecords(), capturedForRun(runId) - timing.capturedAtStart());
            long client = pending || timing == null ? lane.clientCaptures()
                    : Math.max(lane.clientCaptures(), capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER) - timing.clientAtStart());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(),
                    pending ? "NOT_RUN" : "CANCELLED", "CANCELLED", captured, client,
                    lane.definitionImports(), lane.alertCount(), lane.alertSnapshotComplete(), lane.passiveComplete(),
                    lane.passiveRemaining(), lane.warning(), lane.error()));
        }
    }

    private synchronized void deferZapResult(ZapBaselineRun result) {
        if (pendingZapResult != null && "CANCELLED".equals(pendingZapResult.status())) return;
        if (pendingZapResult == null) zapCleanupStartedAt = System.currentTimeMillis();
        pendingZapResult = result;
        zapBaseline = new ZapBaselineRun(result.runId(), result.target(), "RUNNING", "CLEANUP",
                "", result.warning(), result.capturedRecords(), result.definitionCount(),
                result.alertCount(), result.error());
        recordZapProgress("전체", "CLEANUP", "INFO", "ZAP 캠페인 종료 처리 · 임시 상태 정리 중");
    }

    private void installScannerCapability(String target, String runId) {
        String staleRunId;
        synchronized (this) { staleRunId = zapCapabilityRunId; }
        if (!staleRunId.isBlank()) {
            RuntimeException staleCleanup = removeScannerCapability(staleRunId);
            if (staleCleanup != null) {
                throw new IllegalStateException("previous ZAP scanner capability cleanup is still failing",
                        staleCleanup);
            }
        }
        String capability = randomToken();
        String description = "flowscope-capability-" + runId + "-" + Long.toUnsignedString(System.nanoTime(), 36);
        // 8081은 스캐너 레인의 모든 in-scope 요청에 capability를 요구한다. target 하위에만 헤더를 붙이면
        // 다중 항목 scope에서 브라우저 크롤러가 형제 항목을 부를 때 헤더 없이 도착해 캠페인이 격리 오류로 끝난다.
        List<String> capabilityCoverage = new ArrayList<>(state.scope().entries());
        if (!capabilityCoverage.contains(target)) capabilityCoverage.add(target);
        requireZapOk(state.zap().addRequestHeaderRule(description, ZapClient.exactSubtreeRegex(capabilityCoverage),
                "X-FlowScope-Scanner-Capability", capability, CAPABILITY_INITIATORS),
                "install its scanner provenance capability");
        synchronized (this) {
            zapCapabilityRunId = runId;
            zapCapabilityRule = description;
        }
        state.scannerCapability(runId, capability);
    }

    private synchronized RuntimeException removeScannerCapability(String runId) {
        String rule;
        synchronized (this) {
            if (!runId.equals(zapCapabilityRunId)) return null;
            rule = zapCapabilityRule;
        }
        state.clearScannerCapability(runId);
        try {
            requireZapOk(state.zap().removeReplacerRule(rule), "remove its scanner provenance capability");
            synchronized (this) {
                if (runId.equals(zapCapabilityRunId) && rule.equals(zapCapabilityRule)) {
                    zapCapabilityRunId = "";
                    zapCapabilityRule = "";
                }
            }
            return null;
        } catch (RuntimeException error) {
            return error;
        }
    }

    JsonNode zapBaselineStatus() {
        ZapBaselineRun value = zapBaseline;
        return value == null ? json.createObjectNode().put("status", "NOT_STARTED") : zapBaselineNode(value);
    }

    private void runZapCampaign(String runId, String target, List<ZapLane> lanes,
                                List<ZapDefinition> definitions) {
        ArrayNode collectedAlerts = json.createArrayNode();
        boolean failed = false;
        String campaignError = "";
        for (int index = 0; index < lanes.size(); index++) {
            ensureZapNotCancelled();
            ZapLane lane = lanes.get(index);
            try {
                runZapLane(runId, target, lane, index, definitions, collectedAlerts);
            } catch (RuntimeException error) {
                failed = true;
                String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                if (campaignError.isBlank()) campaignError = lane.accountLabel() + ": " + message;
                boolean isolationBlocked = error instanceof ZapIsolationException;
                if (!isolationBlocked) {
                    try {
                        isolationBlocked = !resetPassiveQueueForNextIdentity(runId, index);
                    } catch (RuntimeException cleanupError) {
                        isolationBlocked = true;
                        String cleanupMessage = cleanupError.getMessage() == null
                                ? cleanupError.getClass().getSimpleName() : cleanupError.getMessage();
                        campaignError = appendWarning(campaignError,
                                lane.accountLabel() + " cleanup: " + cleanupMessage);
                    }
                }
                if (isolationBlocked) {
                    if (index + 1 < lanes.size()) blockRemainingZapLanes(lanes, index + 1);
                    break;
                }
            }
        }
        ensureZapNotCancelled();
        long captured = capturedForRun(runId);
        zapBaselineAlerts = collectedAlerts;
        if (failed) {
            deferZapResult(new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    captured, definitions.size(), collectedAlerts.size(), campaignError));
        } else {
            String warning = zapBaselineLanes.stream().map(ZapLaneResult::warning)
                    .filter(value -> value != null && !value.isBlank()).distinct()
                    .collect(java.util.stream.Collectors.joining("; "));
            String status = warning.isBlank() ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";
            deferZapResult(new ZapBaselineRun(runId, target, status, "ALERTS_READY", "", warning,
                    captured, definitions.size(), collectedAlerts.size(), ""));
        }
    }

    private void blockRemainingZapLanes(List<ZapLane> lanes, int fromIndex) {
        for (int blocked = fromIndex; blocked < lanes.size(); blocked++) {
            ZapLane pending = lanes.get(blocked);
            replaceZapLane(blocked, new ZapLaneResult(pending.accountId(), pending.accountLabel(),
                    "NOT_RUN", "BLOCKED_BY_ISOLATION", 0, 0, 0, 0,
                    false, false, -1, "",
                    "이전 신원의 ZAP background 작업을 격리 종료하지 못해 시작하지 않음"));
        }
    }

    private void runZapLane(String runId, String target, ZapLane lane, int index,
                            List<ZapDefinition> definitions, ArrayNode collectedAlerts) {
        String warning = "";
        int definitionImports = 0;
        boolean passiveComplete = false;
        int passiveRemaining = -1;
        boolean alertSnapshotComplete = false;
        int alertCount = 0;
        long capturedBefore = capturedForRun(runId);
        long clientBefore = capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER);
        ZapBrowserAuthenticator.Identity identity = null;
        String contextName = "flowscope-" + runId + "-" + index;
        String contextId = "";
        boolean contextCreated = false;
        boolean directAuthentication = lane.accountId() != null;
        boolean authenticationVerified = false;
        try {
            state.scannerDirectAuthentication(runId, directAuthentication);
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "SESSION_SETUP", 0, 0, 0, 0,
                    false, false, -1, "", ""));
            updateZapBaseline(runId, "RUNNING", "SESSION_SETUP", "", "", "");
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_CLIENT_SPIDER, null);
            JsonNode context;
            ScheduledFuture<?> setupHeartbeat = startZapWorkerHeartbeat(runId, index, "SESSION_SETUP",
                    "격리 세션 설정 · ZAP API 응답 대기");
            try {
                JsonNode reset = parseZap(state.zap().newTemporarySession());
                if (!"OK".equalsIgnoreCase(reset.path("Result").asText())) {
                    throw new IllegalStateException("ZAP did not create an isolated session");
                }
                recordZapHeartbeat(runId, index, "격리 세션 생성 응답 수신");
                context = parseZap(state.zap().newContext(contextName));
                contextCreated = true;
                contextId = context.path("contextId").asText();
                if (contextId.isBlank()) {
                    throw new IllegalStateException("ZAP did not create an isolated target context");
                }
                recordZapHeartbeat(runId, index, "exact-scope Context 설정 중");
                requireZapOk(state.zap().includeInContext(contextName, ZapClient.exactSubtreeRegex(target)),
                        "include the exact target subtree in context");
                requireZapOk(state.zap().setContextInScope(contextName), "mark the target context in scope");
                requireZapOk(state.zap().enablePassiveScan(), "enable passive scanning");
                requireZapOk(state.zap().enableAllPassiveScanners(), "enable all passive scan rules");
                requireZapOk(state.zap().restrictPassiveScanToScope(), "restrict passive scanning to scope");
                verifyPassiveScannersEnabled();
                ensureScannerCapabilityIntact(runId);
                recordZapHeartbeat(runId, index, "격리 세션·Context 설정 완료");
            } finally {
                setupHeartbeat.cancel(false);
            }
            if (!definitions.isEmpty()) {
                state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_API_IMPORT, null);
                replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                        "API_DEFINITION_IMPORT", 0, 0, 0, 0,
                        false, false, -1, "", ""));
                updateZapBaseline(runId, "RUNNING", "API_DEFINITION_IMPORT", "", warning, "");
                ScheduledFuture<?> importHeartbeat = startZapWorkerHeartbeat(runId, index,
                        "API_DEFINITION_IMPORT",
                        "API 정의 가져오기 · ZAP API 응답 대기");
                try {
                    for (int definitionIndex = 0; definitionIndex < definitions.size(); definitionIndex++) {
                        ZapDefinition definition = definitions.get(definitionIndex);
                        recordZapHeartbeat(runId, index, "API 정의 " + (definitionIndex + 1) + "/"
                                + definitions.size() + " · " + definition.type() + " 응답 대기");
                        try {
                            importZapDefinition(definition, target, contextId);
                            ensureScannerCapabilityIntact(runId);
                            definitionImports++;
                            recordZapHeartbeat(runId, index, "API 정의 " + (definitionIndex + 1) + "/"
                                    + definitions.size() + " 응답 수신");
                        } catch (RuntimeException importError) {
                            ensureScannerCapabilityIntact(runId);
                            warning = appendWarning(warning, definition.type() + " definition import failed: "
                                    + importError.getMessage());
                        }
                    }
                } finally {
                    importHeartbeat.cancel(false);
                }
            }
            if (directAuthentication) {
                state.contexts().transition(Source.SCANNER, runId,
                        SourceDetail.ZAP_AUTHENTICATION, lane.accountId());
                replaceZapAuthentication(index, new ZapAuthenticationResult(
                        "AUTHENTICATING", ZapClient.CLIENT_BROWSER, "ZAP 브라우저 로그인 실행 중"));
                replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                        "AUTHENTICATION", 0, 0, definitionImports, 0,
                        false, false, -1, warning, ""));
                updateZapBaseline(runId, "RUNNING", "AUTHENTICATION", "", warning, "");
                recordZapProgress(lane.accountLabel(), "AUTHENTICATION", "INFO",
                        "ZAP Browser Based Authentication · Chrome Headless 시작");
                state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.AUTHENTICATING,
                        "ZAP 브라우저 로그인 실행 중");
                String finalContextId = contextId;
                ScheduledFuture<?> authenticationHeartbeat = startZapWorkerHeartbeat(runId, index,
                        "AUTHENTICATION", "ZAP 브라우저 로그인 · 인증 결과 대기");
                try {
                    identity = state.zapAccounts().withSecret(lane.accountId(), secret ->
                            new ZapBrowserAuthenticator(state.zap(), json, state.scope()::allows,
                                    () -> state.authenticationEvidence(runId, lane.accountId())).authenticate(
                                    runId, target, index, finalContextId, contextName, secret));
                    recordZapHeartbeat(runId, index, "ZAP 브라우저 로그인 · 인증 성공 응답 수신");
                } finally {
                    authenticationHeartbeat.cancel(false);
                }
                state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.VERIFIED_BY_ZAP,
                        "ZAP 인증 성공과 재사용 가능한 인증 Evidence를 확인했습니다.");
                boolean sessionPromoted = state.promoteAuthenticatedSession(
                        lane.accountId(), identity.verifiedEvidenceRuntimeId());
                if (!sessionPromoted) {
                    throw new IllegalStateException("로그인은 확인됐지만 독립 계정 세션으로 연결하지 못했습니다. "
                            + "ANON으로 대체하지 않고 이 로그인 lane을 중단합니다.");
                }
                authenticationVerified = true;
                replaceZapAuthentication(index, new ZapAuthenticationResult(
                        "VERIFIED_BY_ZAP", identity.browser(),
                        "ZAP 인증 Evidence를 독립 계정 세션으로 연결했습니다."));
                recordZapProgress(lane.accountLabel(), "AUTHENTICATION", "DONE",
                        "ZAP 인증 응답 Evidence 확인 · 계정 크롤링 시작");
            }
            SeedResult firstSeeds = routeSeeds(target, warning);
            warning = resetClientMap(runId, target, lane, firstSeeds.warning(), firstSeeds.urls(), "");
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_CLIENT_SPIDER, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "CLIENT_SPIDER", 0, 0, definitionImports, 0,
                    false, false, -1, warning, ""));
            runClientSpiderPass(runId, target, index, contextName, identity, warning, CLIENT_SPIDER_TIMEOUT_MILLIS);
            ensureScannerCapabilityIntact(runId);
            ensureZapNotCancelled();
            long clientCaptured = capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER) - clientBefore;
            if (clientCaptured == 0) {
                throw zeroCaptureFailure("Client Spider", target);
            }
            warning = runFollowUpClientSpider(runId, target, lane, index, contextName, identity,
                    firstSeeds.urls(), warning);
            clientCaptured = capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER) - clientBefore;
            warning = runTraditionalSpider(runId, target, lane, index, contextName, identity,
                    definitionImports, clientCaptured, warning);
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_PASSIVE_SCAN, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "PASSIVE_SCAN_QUEUE", clientCaptured, clientCaptured, definitionImports, 0,
                    false, false, -1, warning, ""));
            updateZapBaseline(runId, "RUNNING", "PASSIVE_SCAN_QUEUE", "", warning, "");
            PassiveDrainResult passive = waitForPassive(runId, index);
            passiveComplete = passive.complete();
            passiveRemaining = passive.remaining();
            if (!passiveComplete) {
                warning = appendWarning(warning, "Passive Scan 부분 완료: 미처리 " + passiveRemaining
                        + "건" + (passive.task().isBlank() ? "" : " · " + passive.task()));
            }
            long captured = capturedForRun(runId) - capturedBefore;
            if (captured == 0) {
                ensureScannerCapabilityIntact(runId);
                throw zeroCaptureFailure("scanner workflow", target);
            }
            ZapAlertCollection alerts = new ZapAlertCollection(0, false);
            try {
                alerts = collectZapAlerts(target, lane, runId, collectedAlerts);
                alertCount = alerts.count();
                alertSnapshotComplete = passiveComplete && !alerts.truncated();
                recordZapProgress(lane.accountLabel(), "ALERTS_READY",
                        alertSnapshotComplete ? "DONE" : "WARN",
                        "Alert " + alertCount + "건 집계"
                                + (alertSnapshotComplete ? " 완료" : " · 현재 스냅샷"));
                if (alerts.truncated()) {
                    warning = appendWarning(warning, "ZAP Alert detail snapshot reached the "
                            + MAX_ZAP_ALERT_SNAPSHOT + " item memory bound");
                }
            } catch (RuntimeException alertError) {
                warning = appendWarning(warning, "ZAP Alert snapshot incomplete: " + alertError.getMessage());
            }
            if (!passiveComplete && !resetPassiveQueueForNextIdentity(runId, index)) {
                throw new ZapIsolationException("ZAP Passive Scan background 작업을 격리 종료하지 못했습니다; "
                        + "다음 신원은 시작하지 않았습니다");
            }
            if (!passiveComplete) {
                warning = appendWarning(warning,
                        "다음 신원과 섞이지 않도록 미처리 Passive queue를 정리함");
            }
            RuntimeException identityCleanup = cleanupZapIdentity(identity, contextName, contextCreated);
            identity = null;
            contextCreated = false;
            if (identityCleanup != null) {
                throw new ZapIsolationException("ZAP 로그인 사용자·Context 정리 실패: "
                        + identityCleanup.getMessage());
            }
            String laneStatus = warning.isBlank() ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), laneStatus,
                    "ALERTS_READY", captured, clientCaptured, definitionImports, alertCount,
                    alertSnapshotComplete, passiveComplete, passiveRemaining, warning, ""));
        } catch (RuntimeException error) {
            boolean interrupted = Thread.interrupted();
            RuntimeException identityCleanup = cleanupZapIdentity(identity, contextName, contextCreated);
            contextCreated = false;
            if (interrupted) Thread.currentThread().interrupt();
            if (identityCleanup != null) {
                ZapIsolationException isolation = new ZapIsolationException(
                        "ZAP 로그인 사용자·Context 정리 실패: " + identityCleanup.getMessage());
                isolation.addSuppressed(error);
                error = isolation;
            }
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (directAuthentication && !authenticationVerified) {
                state.zapAccounts().status(lane.accountId(), ZapAccountVault.AuthStatus.FAILED, message);
                replaceZapAuthentication(index, new ZapAuthenticationResult(
                        "FAILED", ZapClient.CLIENT_BROWSER, message));
            }
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "FAILED", "FAILED",
                    Math.max(0, capturedForRun(runId) - capturedBefore),
                    Math.max(0, capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER) - clientBefore),
                    definitionImports, alertCount, alertSnapshotComplete, passiveComplete,
                    passiveRemaining, warning, message));
            throw error;
        } finally {
            state.scannerDirectAuthentication(runId, false);
        }
    }

    private RuntimeException cleanupZapIdentity(ZapBrowserAuthenticator.Identity identity,
                                                String contextName, boolean contextCreated) {
        RuntimeException failure = null;
        if (identity != null) {
            try {
                requireZapOk(state.zap().removeUser(identity.contextId(), identity.userId()),
                        "remove its temporary authenticated user");
            } catch (RuntimeException error) {
                failure = error;
            }
        }
        if (contextCreated) {
            try {
                requireZapOk(state.zap().removeContext(contextName), "remove its temporary context");
            } catch (RuntimeException error) {
                failure = mergeFailure(failure, "temporary ZAP context cleanup failed", error);
            }
        }
        return failure;
    }

    private long capturedForRun(String runId) {
        return Math.max(0, state.capturedCount(Source.SCANNER, runId, null)
                - state.capturedCount(Source.SCANNER, runId, SourceDetail.ZAP_AUTHENTICATION));
    }

    private long capturedForRun(String runId, SourceDetail detail) {
        return state.capturedCount(Source.SCANNER, runId, detail);
    }

    /** 127.0.0.1:port로 TCP 연결이 되면 true. Burp Proxy listener 존재 여부만 보며 요청은 보내지 않는다. */
    public static boolean loopbackListenerOpen(int port, java.time.Duration timeout) {
        try (java.net.Socket socket = new java.net.Socket()) {
            socket.connect(new java.net.InetSocketAddress("127.0.0.1", port), (int) Math.max(1, timeout.toMillis()));
            return true;
        } catch (java.io.IOException error) {
            return false;
        }
    }

    /**
     * 0건 실패의 원인을 둘로 가른다. ZAP이 대상에 대해 메시지를 기록했는데 Burp에 도착한 것이 없으면 listener/upstream 문제,
     * ZAP 자체가 아무것도 내지 않았으면 crawler·대상 도달·로그인 문제다. ZAP view를 못 읽으면 원래 문구를 유지한다.
     */
    private IllegalStateException zeroCaptureFailure(String phase, String target) {
        long zapMessages = -1;
        try {
            zapMessages = parseZap(state.zap().numberOfMessages(target)).path("numberOfMessages").asLong(-1);
        } catch (RuntimeException ignored) {
            // view unavailable: fall through to the generic message
        }
        int port = state.scannerProxyPort();
        if (zapMessages > 0) {
            return new IllegalStateException(phase + " completed without captured in-scope traffic: ZAP recorded "
                    + zapMessages + " message(s) for " + target + " but none reached Burp SCANNER 127.0.0.1:" + port
                    + " (check the Burp Proxy listener on " + port + " and ZAP's upstream proxy)");
        }
        if (zapMessages == 0) {
            return new IllegalStateException(phase + " completed without captured in-scope traffic: ZAP recorded no"
                    + " messages for " + target + " (crawler produced nothing: target unreachable, blocked, or login failed)");
        }
        return new IllegalStateException(phase + " completed without captured in-scope traffic");
    }

    private void verifySafeZapEnvironment(List<ZapDefinition> definitions) {
        JsonNode version = parseZap(state.zap().version());
        if (version.path("version").asText().isBlank()) {
            throw new IllegalStateException("ZAP version API did not return a version");
        }
        String home = parseZap(state.zap().zapHomePath()).path("zapHomePath").asText();
        if (!home.startsWith("/run/flowscope-zap/")) {
            throw new IllegalStateException("ZAP campaigns require the FlowScope Docker Chromium runtime");
        }
        JsonNode installed = parseZap(state.zap().installedAddons()).path("installedAddons");
        Set<String> ids = new LinkedHashSet<>();
        if (installed.isArray()) installed.forEach(addon -> ids.add(addon.path("id").asText()));
        Set<String> missing = new LinkedHashSet<>(SAFE_ZAP_ADDONS);
        for (ZapDefinition definition : definitions) {
            missing.add(switch (definition.type()) {
                case OPENAPI -> "openapi";
                case GRAPHQL -> "graphql";
                case POSTMAN -> "postman";
                case SOAP -> "soap";
            });
        }
        missing.removeAll(ids);
        if (!missing.isEmpty()) {
            throw new IllegalStateException("missing required safe ZAP add-on(s): " + String.join(", ", missing));
        }
        JsonNode proxyEnabled = parseZap(state.zap().httpProxyEnabled());
        if (!"true".equalsIgnoreCase(proxyEnabled.path("isHttpProxyEnabled").asText())) {
            throw new IllegalStateException("ZAP outgoing HTTP proxy must be enabled for FlowScope capture");
        }
        JsonNode proxy = parseZap(state.zap().httpProxy()).path("getHttpProxy");
        String host = proxy.path("host").asText().toLowerCase(java.util.Locale.ROOT);
        int port = proxy.path("port").asInt(-1);
        int expectedPort = state.scannerProxyPort();
        if (!(host.equals("127.0.0.1") || host.equals("localhost") || host.equals("::1")
                || host.equals("host.docker.internal")) || port != expectedPort) {
            throw new IllegalStateException("ZAP outgoing HTTP proxy must point to FlowScope 127.0.0.1:"
                    + expectedPort + " (Docker: host.docker.internal:" + expectedPort + ")");
        }
    }

    private List<ZapDefinition> validatedZapDefinitions(JsonNode definitions) {
        if (definitions == null || definitions.isMissingNode() || definitions.isNull()) return List.of();
        if (!definitions.isArray()) throw new IllegalArgumentException("definitions must be an array");
        if (definitions.size() > 20) throw new IllegalArgumentException("at most 20 API definitions are allowed");
        LinkedHashSet<ZapDefinition> accepted = new LinkedHashSet<>();
        for (JsonNode node : definitions) {
            ZapDefinitionType type;
            try { type = ZapDefinitionType.valueOf(node.path("type").asText().trim().toUpperCase()); }
            catch (RuntimeException error) {
                throw new IllegalArgumentException("definition type must be OPENAPI, GRAPHQL, POSTMAN, or SOAP");
            }
            String url = node.path("url").asText().trim();
            String endpoint = node.path("endpoint").asText().trim();
            if (type == ZapDefinitionType.GRAPHQL) {
                if (endpoint.isBlank()) throw new IllegalArgumentException("GRAPHQL definition requires endpoint");
                requireDefinitionInScope(endpoint, "GraphQL endpoint");
                if (!url.isBlank()) requireDefinitionInScope(url, "GraphQL schema URL");
            } else {
                if (url.isBlank()) throw new IllegalArgumentException(type + " definition requires URL");
                requireDefinitionInScope(url, type + " definition URL");
                endpoint = "";
            }
            accepted.add(new ZapDefinition(type, url, endpoint));
        }
        return List.copyOf(accepted);
    }

    private void requireDefinitionInScope(String value, String label) {
        try { URI.create(value); }
        catch (RuntimeException error) { throw new IllegalArgumentException(label + " is not a valid URL"); }
        if (!state.scope().allows(value)) throw new IllegalArgumentException(label + " is outside configured scope");
    }

    private void importZapDefinition(ZapDefinition definition, String target, String contextId) {
        String raw = switch (definition.type()) {
            case OPENAPI -> state.zap().importOpenApi(definition.url(), target, contextId, 1_000);
            case GRAPHQL -> state.zap().importGraphQl(definition.endpoint(), definition.url(), 1_000);
            case POSTMAN -> state.zap().importPostman(definition.url(), 1_000);
            case SOAP -> state.zap().importSoap(definition.url(), 1_000);
        };
        JsonNode result = parseZap(raw);
        if (result.hasNonNull("code") || "FAIL".equalsIgnoreCase(result.path("Result").asText())) {
            throw new IllegalStateException(result.path("message").asText("ZAP rejected the definition"));
        }
    }

    private void requireZapOk(String raw, String action) {
        JsonNode result = parseZap(raw);
        if (!"OK".equalsIgnoreCase(result.path("Result").asText())) {
            throw new IllegalStateException("ZAP failed to " + action);
        }
    }

    private void verifyPassiveScannersEnabled() {
        JsonNode scanners = parseZap(state.zap().passiveScanners()).path("scanners");
        if (!scanners.isArray() || scanners.isEmpty()) {
            throw new IllegalStateException("ZAP passive scanner API returned no rules");
        }
        List<String> disabled = new ArrayList<>();
        for (JsonNode scanner : scanners) {
            if (!"true".equalsIgnoreCase(scanner.path("enabled").asText())) {
                disabled.add(scanner.path("id").asText("unknown"));
                if (disabled.size() >= 10) break;
            }
        }
        if (!disabled.isEmpty()) {
            throw new IllegalStateException("ZAP passive rule(s) remained disabled: "
                    + String.join(", ", disabled));
        }
    }

    private ZapAlertCollection collectZapAlerts(String target, ZapLane lane, String runId,
                                                 ArrayNode collectedAlerts) {
        int reported = parseZap(state.zap().numberOfAlerts(target)).path("numberOfAlerts").asInt(-1);
        if (reported < 0) throw new IllegalStateException("ZAP alert count response was invalid");
        int laneCount = 0;
        int start = 0;
        int capacity = Math.max(0, MAX_ZAP_ALERT_SNAPSHOT - collectedAlerts.size());
        while (laneCount < capacity && start < reported) {
            JsonNode page = maskTextValues(parseZap(state.zap().alerts(target, start, 500))).path("alerts");
            if (!page.isArray()) throw new IllegalStateException("ZAP alert page response was invalid");
            if (page.isEmpty()) break;
            for (JsonNode alert : page) {
                ObjectNode copy = alert.isObject() ? (ObjectNode) alert.deepCopy()
                        : json.createObjectNode().set("alert", alert);
                copy.put("flowscope_account_id", lane.accountId() == null ? "anonymous" : lane.accountId());
                copy.put("flowscope_run_id", runId);
                collectedAlerts.add(copy);
                laneCount++;
                if (laneCount >= capacity) break;
            }
            start += page.size();
            if (page.size() < 500 || laneCount >= capacity) break;
        }
        return new ZapAlertCollection(laneCount, reported > laneCount || collectedAlerts.size() >= MAX_ZAP_ALERT_SNAPSHOT);
    }

    private static String appendWarning(String current, String value) {
        if (value == null || value.isBlank()) return current == null ? "" : current;
        return current == null || current.isBlank() ? value : current + "; " + value;
    }

    private static RuntimeException mergeFailure(RuntimeException current, String label, RuntimeException cleanup) {
        String detail = cleanup.getMessage() == null ? cleanup.getClass().getSimpleName() : cleanup.getMessage();
        if (current == null) return new IllegalStateException(label + ": " + detail, cleanup);
        current.addSuppressed(cleanup);
        return new IllegalStateException(current.getMessage() + "; " + label + ": " + detail, current);
    }

    private void stopOwnedClientSpider(String scanId) {
        boolean interrupted = Thread.interrupted();
        try {
            requireZapOk(state.zap().stopClientSpider(scanId), "stop its unfinished Client Spider");
            awaitZapTerminal(() -> state.zap().clientSpiderStatus(scanId), "Client Spider");
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private RuntimeException stopAndAwaitOwnedCrawlers() {
        RuntimeException failure = null;
        String client;
        String spider;
        synchronized (this) {
            client = ownedClientScanId;
            ownedClientScanId = "";
            spider = ownedSpiderScanId;
            ownedSpiderScanId = "";
        }
        if (!client.isBlank()) {
            try { stopOwnedClientSpider(client); }
            catch (RuntimeException error) { failure = mergeFailure(failure, "Client Spider cleanup failed", error); }
        }
        if (!spider.isBlank()) {
            try { stopOwnedSpider(spider); }
            catch (RuntimeException error) { failure = mergeFailure(failure, "Spider cleanup failed", error); }
        }
        return failure;
    }

    /**
     * 로그인 검증 뒤, Client Spider 직전에 ZAP Client Map을 비운다. 로그인 세션(쿠키·토큰)은 Map과 별개라 유지된다.
     * 비우지 못해도 Client Spider는 돌릴 수 있으므로 레인을 실패시키지 않고 경고로 남긴다. 취소는 그대로 올린다.
     */
    /**
     * 경로 없는 origin(`http://host`)에 루트 `/`를 붙인다. 같은 자원이지만 Client Spider는 시작 주소가 `/`로 끝날 때만
     * Map의 미방문 주소를 작업으로 넣는다(ClientSpider.getUnvisitedUrls). 경로가 있는 주소는 그대로 둔다.
     */
    public static String withRootPath(String target) {
        try {
            URI uri = URI.create(target);
            if (uri.getScheme() != null && uri.getRawAuthority() != null
                    && (uri.getRawPath() == null || uri.getRawPath().isEmpty())) {
                return uri.getScheme() + "://" + uri.getRawAuthority() + "/"
                        + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            }
        } catch (RuntimeException ignored) {
            // 잘못된 주소는 아래 scope 검사가 거른다.
        }
        return target;
    }

    private record SeedResult(List<String> urls, String warning) {}

    /** 지금까지 수집한 기록에서 Client Spider 시작 주소를 만든다. 실패해도 Map 비우기는 진행하도록 경고로만 남긴다. */
    private SeedResult routeSeeds(String target, String warning) {
        try {
            return new SeedResult(ClientRouteSeeds.from(state.snapshot().records, state.scope(), target,
                    ROUTE_SEED_EXCLUDE, MAX_ROUTE_SEEDS), warning);
        } catch (RuntimeException error) {
            return new SeedResult(List.of(), appendWarning(warning, "클라이언트 라우트 추출 실패: " + error.getMessage()));
        }
    }

    /**
     * ZAP Client Map은 쿼리를 값이 아니라 매개변수 이름으로만 노드화한다(ClientUtils.paramsToNodeName). 그래서
     * `post?post_id=A`와 `post?post_id=B`가 한 노드로 합쳐져 첫 객체만 열린다(crAPI 실측: 글 8개 중 1개).
     * 쿼리가 있는 주소마다 서로 다른 fragment를 붙여 별도 노드로 만든다. fragment는 서버로 보내지 않으므로(RFC 3986 §3.5)
     * 서버가 받는 요청은 바뀌지 않는다(실측: 글·주문 상세 API가 같은 경로로 호출됨).
     */
    public static List<String> distinctClientMapUrls(List<String> urls) {
        List<String> distinct = new ArrayList<>(urls.size());
        int index = 0;
        for (String url : urls) {
            boolean query = url.indexOf('?') >= 0 && url.indexOf('#') < 0;
            distinct.add(query ? url + "#flowscope-" + (++index) : url);
        }
        return distinct;
    }

    private String resetClientMap(String runId, String target, ZapLane lane, String warning,
                                  List<String> routes, String phase) {
        String request = runId + "-" + System.nanoTime();
        try {
            List<String> nodes = new ArrayList<>();
            nodes.add(target);
            nodes.addAll(distinctClientMapUrls(routes));
            requireZapOk(state.zap().setScriptGlobalVar(CLIENT_MAP_SEEDS, String.join("\n", nodes)),
                    "pass the Client Spider start URLs");
            requireZapOk(state.zap().setScriptGlobalVar(CLIENT_MAP_RESET_REQUEST, request),
                    "request a Client Map reset");
            requireZapOk(state.zap().runStandAloneScript(CLIENT_MAP_RESET_SCRIPT), "run the Client Map reset script");
            long deadline = System.currentTimeMillis() + CLIENT_MAP_RESET_CONFIRM_MILLIS;
            String done;
            while (!(done = parseZap(state.zap().scriptGlobalVar(CLIENT_MAP_RESET_DONE)).path("globalVar").asText())
                    .equals(request) && !done.startsWith(request + ":")) {
                ensureZapNotCancelled();
                if (System.currentTimeMillis() >= deadline) {
                    throw new IllegalStateException("reset script did not confirm this request");
                }
                Thread.sleep(100);
            }
            // 스크립트는 "요청번호:등록한 노드 수"를 돌려준다. 요청번호만 오면 라우트를 모르는 이전 start-zap.sh다.
            if (!done.equals(request + ":" + nodes.size())) {
                warning = appendWarning(warning, "클라이언트 라우트 시작 주소 미등록(ZAP을 새 start-zap.sh로 다시 시작해야 함)");
            }
            recordZapProgress(lane.accountLabel(), "CLIENT_SPIDER", "INFO",
                    phase + "Client Map 초기화 · 클라이언트 라우트 " + routes.size() + "개를 시작 주소로 등록");
            return warning;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("ZAP baseline cancelled");
        } catch (RuntimeException error) {
            ensureZapNotCancelled();
            return appendWarning(warning, "Client Map 초기화 생략(이미 본 화면의 메뉴·버튼을 다시 누르지 않을 수 있음): "
                    + error.getMessage());
        }
    }

    /** Client Spider 한 번을 시작·대기·정리한다. 끝나지 않은 채 빠져나가면 소유한 scan을 멈춘다. */
    private void runClientSpiderPass(String runId, String target, int index, String contextName,
                                     ZapBrowserAuthenticator.Identity identity, String warning, long timeoutMillis) {
        String clientId = "";
        boolean clientFinished = false;
        try {
            synchronized (this) {
                // Cancellation must retain the accepted scan ID before it interrupts the worker.
                ensureZapNotCancelled();
                JsonNode client = parseZap(identity == null
                        ? state.zap().clientSpider(target, contextName)
                        : state.zap().clientSpider(target, contextName, identity.userName(), identity.browser()));
                clientId = client.path("scan").asText();
                if (clientId.isBlank()) throw new IllegalStateException("Client Spider did not return a scan id");
                ownedClientScanId = clientId;
            }
            updateZapBaseline(runId, "RUNNING", "CLIENT_SPIDER", clientId, warning, "");
            String finalClientId = clientId;
            waitForZap(() -> state.zap().clientSpiderStatus(finalClientId), timeoutMillis,
                    "Client Spider", runId, index);
            clientFinished = true;
            releaseClientSpider(clientId);
        } finally {
            if (!clientFinished && !clientId.isBlank() && claimClientSpider(clientId)) {
                try { stopOwnedClientSpider(clientId); }
                catch (RuntimeException cleanupError) {
                    throw new ZapIsolationException("Client Spider cleanup failed: " + cleanupError.getMessage());
                }
            }
        }
    }

    /**
     * 상세 화면 ID는 목록 응답(`posts/recent` 등)에 있는데, 그 응답은 Client Spider가 돌면서 처음 수집된다. 상세 화면이
     * 다시 다른 객체의 ID를 보여 줄 수도 있다. 그래서 패스가 끝날 때마다 시작 주소를 다시 계산하고, 아직 넣지 않은 주소가
     * 있으면 그것만 넣어 다시 돈다(Black Widow의 상태 간 데이터 의존성 추적). 최대 MAX_FOLLOW_UP_PASSES번까지다.
     * 후속 패스 실패·시간 초과는 앞선 결과를 지우지 않고 진행 기록·경고로 남긴다.
     */
    private String runFollowUpClientSpider(String runId, String target, ZapLane lane, int index, String contextName,
                                           ZapBrowserAuthenticator.Identity identity, List<String> firstSeeds,
                                           String warning) {
        Set<String> seen = new java.util.HashSet<>(firstSeeds);
        for (int pass = 1; pass <= MAX_FOLLOW_UP_PASSES; pass++) {
            ensureZapNotCancelled();
            SeedResult again = routeSeeds(target, warning);
            warning = again.warning();
            List<String> fresh = again.urls().stream().filter(url -> !seen.contains(url)).toList();
            if (fresh.isEmpty()) {
                recordZapProgress(lane.accountLabel(), "CLIENT_SPIDER", "INFO",
                        pass == 1 ? "후속 패스 생략 · 새 상세 시작 주소 없음"
                                : "후속 패스 종료 · " + (pass - 1) + "회 뒤 새 상세 시작 주소 없음");
                return warning;
            }
            seen.addAll(fresh);
            warning = resetClientMap(runId, target, lane, warning, fresh, "후속 패스 " + pass + " · ");
            try {
                runClientSpiderPass(runId, target, index, contextName, identity, warning, FOLLOW_UP_CLIENT_SPIDER_MILLIS);
            } catch (ZapIsolationException error) {
                throw error;
            } catch (RuntimeException error) {
                ensureZapNotCancelled();
                ensureScannerCapabilityIntact(runId);
                String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                if (!message.endsWith("timed out")) return appendWarning(warning, "후속 Client Spider 생략: " + message);
                recordZapProgress(lane.accountLabel(), "CLIENT_SPIDER", "WARN", "후속 패스 " + pass + " 시간 상한 "
                        + FOLLOW_UP_CLIENT_SPIDER_MILLIS / 60_000 + "분 도달 · 수집분은 유지");
            }
        }
        recordZapProgress(lane.accountLabel(), "CLIENT_SPIDER", "INFO",
                "후속 패스 상한 " + MAX_FOLLOW_UP_PASSES + "회 도달");
        return warning;
    }

    /**
     * Client Spider 다음 단계로 같은 Context와 신원으로 일반 Spider를 돌린다. 로그인 레인은 ZAP 사용자로(scanAsUser) 돌린다.
     * 일반 Spider는 보조 탐색이라 실패하거나 0건이어도 레인을 실패시키지 않고 경고로 남긴다. 단 취소, capability 위반,
     * 정리 실패는 그대로 올려 격리를 지킨다.
     */
    private String runTraditionalSpider(String runId, String target, ZapLane lane, int index, String contextName,
                                        ZapBrowserAuthenticator.Identity identity, int definitionImports,
                                        long clientCaptured, String warning) {
        long spiderBefore = capturedForRun(runId, SourceDetail.ZAP_SPIDER);
        state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_SPIDER, lane.accountId());
        replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                "SPIDER", clientCaptured, clientCaptured, definitionImports, 0,
                false, false, -1, warning, ""));
        updateZapBaseline(runId, "RUNNING", "SPIDER", "", warning, "");
        String spiderId = "";
        boolean spiderFinished = false;
        try {
            requireZapOk(state.zap().setSpiderOption("MaxDepth", SPIDER_MAX_DEPTH), "set Spider max depth");
            requireZapOk(state.zap().setSpiderOption("MaxDuration", SPIDER_MAX_DURATION_MINUTES), "set Spider max duration");
            requireZapOk(state.zap().setSpiderOption("PostForm", false), "disable Spider POST form submission");
            requireZapOk(state.zap().setSpiderOption("ProcessForm", true), "enable Spider GET form processing");
            requireZapOk(state.zap().setSpiderOption("ParseRobotsTxt", true), "enable Spider robots.txt parsing");
            requireZapOk(state.zap().setSpiderOption("ParseSitemapXml", true), "enable Spider sitemap.xml parsing");
            requireZapOk(state.zap().clearSpiderExclusions(), "clear Spider exclusions");
            requireZapOk(state.zap().excludeFromSpider(SPIDER_EXCLUDE_REGEX), "exclude session-ending Spider paths");
            synchronized (this) {
                ensureZapNotCancelled();
                JsonNode started = parseZap(identity == null
                        ? state.zap().spider(target, contextName)
                        : state.zap().spiderAsUser(target, identity.contextId(), identity.userId()));
                spiderId = started.path(identity == null ? "scan" : "scanAsUser").asText();
                if (spiderId.isBlank()) throw new IllegalStateException("Spider did not return a scan id");
                ownedSpiderScanId = spiderId;
            }
            updateZapBaseline(runId, "RUNNING", "SPIDER", spiderId, warning, "");
            String finalSpiderId = spiderId;
            waitForZap(() -> state.zap().spiderStatus(finalSpiderId), (SPIDER_MAX_DURATION_MINUTES + 2) * 60_000L,
                    "Spider", runId, index);
            spiderFinished = true;
            releaseSpider(spiderId);
        } catch (ZapIsolationException error) {
            throw error;
        } catch (RuntimeException error) {
            ensureZapNotCancelled();
            ensureScannerCapabilityIntact(runId);
            return appendWarning(warning, "일반 Spider 생략: " + error.getMessage());
        } finally {
            if (!spiderFinished && !spiderId.isBlank() && claimSpider(spiderId)) {
                try { stopOwnedSpider(spiderId); }
                catch (RuntimeException cleanupError) {
                    throw new ZapIsolationException("Spider cleanup failed: " + cleanupError.getMessage());
                }
            }
        }
        ensureScannerCapabilityIntact(runId);
        ensureZapNotCancelled();
        // 0건은 실패가 아니다(Client Spider가 이미 다 찾았거나 원문에 새 주소가 없음). 진행 기록에만 남긴다.
        recordZapProgress(lane.accountLabel(), "SPIDER", "DONE",
                "일반 Spider 기록 " + (capturedForRun(runId, SourceDetail.ZAP_SPIDER) - spiderBefore) + "건");
        return warning;
    }

    private void stopOwnedSpider(String scanId) {
        boolean interrupted = Thread.interrupted();
        try {
            requireZapOk(state.zap().stopSpider(scanId), "stop its unfinished Spider");
            awaitZapTerminal(() -> state.zap().spiderStatus(scanId), "Spider");
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private synchronized boolean claimSpider(String scanId) {
        if (!scanId.equals(ownedSpiderScanId)) return false;
        ownedSpiderScanId = "";
        return true;
    }

    private synchronized void releaseSpider(String scanId) {
        if (scanId.equals(ownedSpiderScanId)) ownedSpiderScanId = "";
    }

    private synchronized boolean claimClientSpider(String scanId) {
        if (!scanId.equals(ownedClientScanId)) return false;
        ownedClientScanId = "";
        return true;
    }

    private synchronized void releaseClientSpider(String scanId) {
        if (scanId.equals(ownedClientScanId)) ownedClientScanId = "";
    }

    private void awaitZapTerminal(ZapStatusCall call, String label) {
        long deadline = System.currentTimeMillis() + passiveCleanupTimeoutMillis();
        RuntimeException last = null;
        while (System.currentTimeMillis() < deadline) {
            try {
                String value = requiredZapStatus(call.get(), label).toLowerCase(java.util.Locale.ROOT);
                if (zapTerminal(value)) return;
                last = null;
            } catch (RuntimeException error) {
                last = error;
            }
            sleepZapPoll(false);
        }
        throw new IllegalStateException(label + " stop was not confirmed"
                + (last == null ? "" : ": " + last.getMessage()), last);
    }

    private synchronized void replaceZapLane(int index, ZapLaneResult value) {
        if (zapCancelRequested.get() && !"CANCELLED".equals(value.stage())) return;
        List<ZapLaneResult> copy = new ArrayList<>(zapBaselineLanes);
        ZapLaneResult previous = copy.get(index);
        copy.set(index, value);
        zapBaselineLanes = List.copyOf(copy);
        if (index >= zapLaneRuntime.size()) return;
        long now = System.currentTimeMillis();
        List<ZapLaneRuntime> runtime = new ArrayList<>(zapLaneRuntime);
        ZapLaneRuntime current = runtime.get(index);
        boolean started = !Set.of("PENDING", "NOT_RUN").contains(value.status());
        boolean terminal = Set.of("COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "NOT_RUN", "CANCELLED")
                .contains(value.status());
        boolean stageChanged = !java.util.Objects.equals(previous.stage(), value.stage());
        long startedAt = current.startedAt() == 0 && started ? now : current.startedAt();
        long endedAt = current.endedAt() == 0 && terminal ? now : current.endedAt();
        long captured = capturedForRun(zapBaseline == null ? "" : zapBaseline.runId());
        long lastProgressAt = captured != current.lastCaptured() ? now : current.lastProgressAt();
        long runClient = zapBaseline == null ? 0
                : capturedForRun(zapBaseline.runId(), SourceDetail.ZAP_CLIENT_SPIDER);
        runtime.set(index, new ZapLaneRuntime(current.queuedAt(), startedAt, endedAt,
                stageChanged ? now : current.stageStartedAt(),
                stageChanged ? now : current.lastHeartbeatAt(), lastProgressAt,
                stageChanged ? zapStageTimeoutMillis(value.stage()) : current.stageTimeoutMillis(),
                current.startedAt() == 0 && started ? captured : current.capturedAtStart(),
                current.startedAt() == 0 && started ? runClient : current.clientAtStart(),
                captured, stageChanged ? value.passiveRemaining() : current.passiveRemaining(),
                stageChanged ? "" : current.passiveTask(),
                stageChanged ? "단계 시작" : current.heartbeatStatus()));
        zapLaneRuntime = List.copyOf(runtime);
        if (stageChanged || !java.util.Objects.equals(previous.status(), value.status())) {
            String level = switch (value.status()) {
                case "FAILED", "NOT_RUN" -> "ERROR";
                case "COMPLETED_WITH_WARNINGS" -> "WARN";
                case "COMPLETED", "CANCELLED" -> "DONE";
                default -> "INFO";
            };
            String message = switch (value.status()) {
                case "FAILED" -> zapStageLabel(value.stage()) + " 실패"
                        + (value.error().isBlank() ? "" : " · " + value.error());
                case "NOT_RUN" -> "CANCELLED".equals(value.stage()) ? "사용자 취소로 실행하지 않음" : "이전 신원 격리 실패로 실행하지 않음";
                case "CANCELLED" -> "사용자 요청으로 신원 검사 취소";
                case "COMPLETED", "COMPLETED_WITH_WARNINGS" -> "신원 검사 종료 · 수집 "
                        + value.capturedRecords() + "건 · Alert " + value.alertCount() + "건";
                default -> zapStageLabel(value.stage()) + " 시작";
            };
            recordZapProgress(value.accountLabel(), value.stage(), level, message);
        }
    }

    @FunctionalInterface private interface ZapStatusCall { String get(); }

    private void waitForZap(ZapStatusCall call, long timeoutMillis, String label,
                            String runId, int laneIndex) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        int consecutiveErrors = 0;
        while (System.currentTimeMillis() < deadline) {
            ensureZapNotCancelled();
            ensureScannerCapabilityIntact(runId);
            String value;
            try {
                value = requiredZapStatus(call.get(), label).toLowerCase(java.util.Locale.ROOT);
                consecutiveErrors = 0;
            } catch (RuntimeException error) {
                if (++consecutiveErrors >= 3) throw error;
                recordZapHeartbeat(runId, laneIndex, "일시적 ZAP 상태 조회 실패 " + consecutiveErrors + "/3");
                sleepZapPoll();
                continue;
            }
            recordZapHeartbeat(runId, laneIndex, value.isBlank() ? "응답 수신" : value);
            ensureScannerCapabilityIntact(runId);
            if (zapTerminal(value)) return;
            if (value.equals("failed") || value.equals("error")) throw new IllegalStateException(label + " failed");
            sleepZapPoll();
        }
        ensureZapNotCancelled();
        ensureScannerCapabilityIntact(runId);
        String finalValue = requiredZapStatus(call.get(), label).toLowerCase(java.util.Locale.ROOT);
        recordZapHeartbeat(runId, laneIndex, finalValue);
        if (zapTerminal(finalValue)) return;
        throw new IllegalStateException(label + " timed out");
    }

    private String requiredZapStatus(String raw, String label) {
        JsonNode status = parseZap(raw);
        String value = findStatus(status);
        if (value.isBlank()) {
            String code = status.path("code").asText();
            String message = status.path("message").asText();
            throw new IllegalStateException(label + " returned no status"
                    + (code.isBlank() && message.isBlank() ? "" : ": " + code + " " + message));
        }
        return value;
    }

    private static boolean zapTerminal(String value) {
        return value.equals("100") || value.equals("stopped") || value.equals("finished")
                || value.equals("complete") || value.equals("completed");
    }

    private PassiveDrainResult waitForPassive(String runId, int laneIndex) {
        long now = System.currentTimeMillis();
        long deadline = now + passiveAbsoluteTimeoutMillis();
        long lastProgressAt = now;
        int previous = Integer.MAX_VALUE;
        int remaining = -1;
        String task = "";
        int consecutiveErrors = 0;
        while ((now = System.currentTimeMillis()) < deadline) {
            ensureZapNotCancelled();
            ensureScannerCapabilityIntact(runId);
            try {
                JsonNode queue = parseZap(state.zap().passiveRecordsToScan());
                remaining = queue.path("recordsToScan").asInt(-1);
                if (remaining < 0) throw new IllegalStateException("ZAP passive queue returned no record count");
                JsonNode tasks = parseZap(state.zap().passiveTasks());
                task = passiveTaskSummary(tasks);
                consecutiveErrors = 0;
            } catch (RuntimeException error) {
                if (++consecutiveErrors >= 3) throw error;
                recordZapHeartbeat(runId, laneIndex,
                        "일시적 Passive 상태 조회 실패 " + consecutiveErrors + "/3");
                sleepZapPoll();
                continue;
            }
            boolean progressed = remaining < previous;
            if (progressed) lastProgressAt = now;
            previous = remaining;
            recordZapPassiveHeartbeat(runId, laneIndex, remaining, task);
            ensureScannerCapabilityIntact(runId);
            if (remaining == 0 && task.isBlank()) return new PassiveDrainResult(true, 0, "");
            if (remaining > 0 && now - lastProgressAt >= passiveStallTimeoutMillis()) {
                return new PassiveDrainResult(false, remaining, task);
            }
            sleepZapPoll();
        }
        return new PassiveDrainResult(false, Math.max(0, remaining), task);
    }

    private boolean resetPassiveQueueForNextIdentity(String runId, int laneIndex) {
        String accountLabel = zapAccountLabel(laneIndex);
        recordZapProgress(accountLabel, "ISOLATION_CLEANUP", "WARN",
                "다음 신원 전환 전 Passive queue 정리 시작");
        requireZapOk(state.zap().clearPassiveQueue(), "clear the abandoned passive scan queue");
        long deadline = System.currentTimeMillis() + passiveCleanupTimeoutMillis();
        int consecutiveErrors = 0;
        while (System.currentTimeMillis() < deadline) {
            int remaining;
            String task;
            try {
                remaining = parseZap(state.zap().passiveRecordsToScan()).path("recordsToScan").asInt(-1);
                if (remaining < 0) throw new IllegalStateException("ZAP passive queue returned no record count");
                task = passiveTaskSummary(parseZap(state.zap().passiveTasks()));
                consecutiveErrors = 0;
            } catch (RuntimeException error) {
                if (++consecutiveErrors >= 3) throw error;
                recordZapHeartbeat(runId, laneIndex,
                        "일시적 Passive 격리 상태 조회 실패 " + consecutiveErrors + "/3");
                sleepZapPoll(false);
                continue;
            }
            recordZapPassiveHeartbeat(runId, laneIndex, remaining, task);
            if (remaining == 0 && task.isBlank()) {
                recordZapProgress(accountLabel, "ISOLATION_CLEANUP", "DONE",
                        "Passive queue와 실행 작업 격리 정리 완료");
                return true;
            }
            sleepZapPoll();
        }
        recordZapProgress(accountLabel, "ISOLATION_CLEANUP", "ERROR",
                "Passive background 작업이 제한시간 안에 종료되지 않음");
        return false;
    }

    private static String passiveTaskSummary(JsonNode raw) {
        JsonNode tasks = raw.path("currentTasks");
        if (!tasks.isArray() || tasks.isEmpty()) return "";
        JsonNode task = tasks.get(0);
        String rule = firstText(task, "name", "rule", "scannerName", "pluginId");
        String url = firstText(task, "url", "uri", "message");
        String summary = (rule.isBlank() ? "Passive rule 실행 중" : rule)
                + (url.isBlank() ? "" : " · " + url);
        return summary.length() <= 320 ? summary : summary.substring(0, 317) + "...";
    }

    private static String firstText(JsonNode node, String... fields) {
        for (String field : fields) {
            String value = node.path(field).asText();
            if (!value.isBlank()) return value;
        }
        return "";
    }

    private static long passiveAbsoluteTimeoutMillis() {
        return Math.max(100L, Long.getLong("flowscope.zap.passive.absolute.ms", 30 * 60_000L));
    }

    private static long passiveStallTimeoutMillis() {
        return Math.max(100L, Long.getLong("flowscope.zap.passive.stall.ms", 10 * 60_000L));
    }

    private static long passiveCleanupTimeoutMillis() {
        return Math.max(100L, Long.getLong("flowscope.zap.passive.cleanup.ms", 2 * 60_000L));
    }

    private synchronized void recordZapHeartbeat(String runId, int laneIndex, String status) {
        if (zapBaseline == null || !zapBaseline.runId().equals(runId)
                || laneIndex < 0 || laneIndex >= zapLaneRuntime.size()) return;
        long now = System.currentTimeMillis();
        long captured = capturedForRun(runId);
        List<ZapLaneRuntime> runtime = new ArrayList<>(zapLaneRuntime);
        ZapLaneRuntime current = runtime.get(laneIndex);
        boolean progressed = captured != current.lastCaptured()
                || !java.util.Objects.equals(status, current.heartbeatStatus());
        runtime.set(laneIndex, new ZapLaneRuntime(current.queuedAt(), current.startedAt(), current.endedAt(),
                current.stageStartedAt(), now, progressed ? now : current.lastProgressAt(),
                current.stageTimeoutMillis(), current.capturedAtStart(), current.clientAtStart(),
                captured, current.passiveRemaining(), current.passiveTask(), status));
        zapLaneRuntime = List.copyOf(runtime);
    }

    private synchronized void replaceZapAuthentication(int index, ZapAuthenticationResult value) {
        List<ZapAuthenticationResult> copy = new ArrayList<>(zapAuthentication);
        copy.set(index, value);
        zapAuthentication = List.copyOf(copy);
    }

    private ScheduledFuture<?> startZapWorkerHeartbeat(String runId, int laneIndex,
                                                        String expectedStage, String status) {
        recordZapHeartbeatIfStage(runId, laneIndex, expectedStage, status);
        long interval = Math.max(100L, Long.getLong("flowscope.zap.workerHeartbeat.ms", 5_000L));
        return zapHeartbeat.scheduleAtFixedRate(
                () -> recordZapHeartbeatIfStage(runId, laneIndex, expectedStage, status),
                interval, interval, TimeUnit.MILLISECONDS);
    }

    private synchronized void recordZapHeartbeatIfStage(String runId, int laneIndex,
                                                         String expectedStage, String status) {
        if (laneIndex < 0 || laneIndex >= zapBaselineLanes.size()
                || !expectedStage.equals(zapBaselineLanes.get(laneIndex).stage())) return;
        recordZapHeartbeat(runId, laneIndex, status);
    }

    private void ensureScannerCapabilityIntact(String runId) {
        long rejected = state.scannerCapabilityRejections(runId);
        if (rejected > 0) {
            throw new ZapIsolationException("ZAP 요청 " + rejected
                    + "건이 run capability 없이 Burp 8081에 도착해 차단됐습니다; "
                    + "ZAP Replacer와 outgoing proxy 전달 경로를 확인하세요");
        }
    }

    private synchronized void recordZapPassiveHeartbeat(String runId, int laneIndex, int remaining, String task) {
        if (zapBaseline == null || !zapBaseline.runId().equals(runId)
                || laneIndex < 0 || laneIndex >= zapLaneRuntime.size()) return;
        long now = System.currentTimeMillis();
        long captured = capturedForRun(runId);
        List<ZapLaneRuntime> runtime = new ArrayList<>(zapLaneRuntime);
        ZapLaneRuntime current = runtime.get(laneIndex);
        boolean progressed = captured != current.lastCaptured()
                || (remaining >= 0 && (current.passiveRemaining() < 0 || remaining < current.passiveRemaining()));
        runtime.set(laneIndex, new ZapLaneRuntime(current.queuedAt(), current.startedAt(), current.endedAt(),
                current.stageStartedAt(), now, progressed ? now : current.lastProgressAt(),
                current.stageTimeoutMillis(), current.capturedAtStart(), current.clientAtStart(),
                captured, remaining, task,
                remaining < 0 ? "passive 응답 수신" : "passive queue " + remaining));
        zapLaneRuntime = List.copyOf(runtime);
        if (progressed && remaining >= 0) {
            recordZapProgress(zapAccountLabel(laneIndex), "PASSIVE_SCAN_QUEUE", "INFO",
                    remaining == 0 ? "Passive queue 처리 완료" : "Passive queue " + remaining + "건 남음");
        }
    }

    private synchronized void recordZapProgress(String accountLabel, String stage,
                                                String level, String message) {
        List<ZapProgressEvent> copy = new ArrayList<>(zapProgressEvents);
        copy.add(new ZapProgressEvent(System.currentTimeMillis(), accountLabel, stage, level,
                message));
        if (copy.size() > MAX_ZAP_PROGRESS_EVENTS) {
            copy = new ArrayList<>(copy.subList(copy.size() - MAX_ZAP_PROGRESS_EVENTS, copy.size()));
        }
        zapProgressEvents = List.copyOf(copy);
    }

    private String zapAccountLabel(int laneIndex) {
        return laneIndex >= 0 && laneIndex < zapBaselineLanes.size()
                ? zapBaselineLanes.get(laneIndex).accountLabel() : "전체";
    }

    private static String zapStageLabel(String stage) {
        return switch (stage == null ? "" : stage) {
            case "API_DEFINITION_IMPORT" -> "API 정의 가져오기";
            case "SESSION_SETUP" -> "격리 세션 설정";
            case "AUTHENTICATION" -> "ZAP 브라우저 로그인";
            case "CLIENT_SPIDER" -> "Client Spider";
            case "SPIDER" -> "일반 Spider";
            case "PASSIVE_SCAN_QUEUE" -> "Passive Scan";
            case "ALERTS_READY" -> "Alert 집계";
            case "FAILED" -> "현재 단계";
            default -> stage == null || stage.isBlank() ? "검사" : stage;
        };
    }

    private long zapStageTimeoutMillis(String stage) {
        return switch (stage == null ? "" : stage) {
            case "SESSION_SETUP" -> 60_000L;
            case "AUTHENTICATION" -> 2 * 60_000L;
            case "API_DEFINITION_IMPORT" -> Math.max(1, zapBaseline == null
                    ? 1 : zapBaseline.definitionCount()) * 2 * 60_000L;
            case "CLIENT_SPIDER" -> 20 * 60_000L;
            case "SPIDER" -> (SPIDER_MAX_DURATION_MINUTES + 2) * 60_000L;
            case "PASSIVE_SCAN_QUEUE" -> passiveAbsoluteTimeoutMillis();
            default -> 0L;
        };
    }

    private static String findStatus(JsonNode node) {
        JsonNode status = node.path("status");
        if (status.isValueNode()) return status.asText();
        if (status.isObject()) {
            for (String field : List.of("state", "status", "progress")) {
                JsonNode value = status.path(field);
                if (value.isValueNode()) return value.asText();
            }
        }
        return "";
    }

    private void sleepZapPoll() { sleepZapPoll(true); }

    private void sleepZapPoll(boolean observeCancellation) {
        if (observeCancellation) ensureZapNotCancelled();
        try { Thread.sleep(Math.max(100L, Long.getLong("flowscope.zap.poll.ms", 1_000L))); }
        catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("ZAP baseline interrupted", error);
        }
        if (observeCancellation) ensureZapNotCancelled();
    }

    private void ensureZapNotCancelled() {
        if (zapCancelRequested.get() || Thread.currentThread().isInterrupted()) {
            throw new IllegalStateException("ZAP baseline cancelled");
        }
    }

    private synchronized void updateZapBaseline(String runId, String status, String stage, String scanId,
                                                String warning, String error) {
        ZapBaselineRun previous = zapBaseline;
        if (zapCancelRequested.get() || pendingZapResult != null) return;
        long captured = capturedForRun(runId);
        int alerts = previous == null ? 0 : previous.alertCount();
        zapBaseline = new ZapBaselineRun(runId, previous == null ? "" : previous.target(), status, stage,
                scanId, warning, captured, previous == null ? 0 : previous.definitionCount(), alerts, error);
    }

    private ObjectNode zapBaselineNode(ZapBaselineRun value) {
        ObjectNode out = json.createObjectNode();
        long now = System.currentTimeMillis();
        boolean cleaning = "CLEANUP".equals(value.stage());
        List<ZapLaneRuntime> runtime = zapLaneRuntime;
        long campaignStartedAt = runtime.stream().mapToLong(ZapLaneRuntime::queuedAt).min().orElse(now);
        ZapLaneRuntime activeRuntime = null;
        String activeStage = "";
        for (int index = 0; index < zapBaselineLanes.size() && index < runtime.size(); index++) {
            if ("RUNNING".equals(zapBaselineLanes.get(index).status())) {
                activeRuntime = runtime.get(index);
                activeStage = zapBaselineLanes.get(index).stage();
                break;
            }
        }
        out.put("run_id", value.runId());
        out.put("target", value.target());
        out.put("status", value.status());
        out.put("stage", value.stage());
        out.put("scan_id", value.scanId());
        out.put("warning", value.warning());
        long liveCaptured = activeRuntime == null ? value.capturedRecords()
                : Math.max(value.capturedRecords(), activeRuntime.lastCaptured());
        out.put("captured_records", liveCaptured);
        out.put("definition_count", value.definitionCount());
        out.put("alert_count", value.alertCount());
        out.put("capability_rejected_requests", state.scannerCapabilityRejections(value.runId()));
        out.put("alert_snapshot_complete", !zapBaselineLanes.isEmpty()
                && zapBaselineLanes.stream().allMatch(ZapLaneResult::alertSnapshotComplete));
        out.put("passive_complete", !zapBaselineLanes.isEmpty()
                && zapBaselineLanes.stream().allMatch(ZapLaneResult::passiveComplete));
        out.put("error", value.error());
        out.put("campaign_started_at", campaignStartedAt);
        out.put("elapsed_seconds", elapsedSeconds(campaignStartedAt,
                "RUNNING".equals(value.status()) ? now : latestLaneEnd(runtime, now)));
        out.put("stage_elapsed_seconds", cleaning ? elapsedSeconds(zapCleanupStartedAt, now) : activeRuntime == null ? 0
                : elapsedSeconds(activeRuntime.stageStartedAt(), now));
        out.put("stage_timeout_seconds", cleaning || activeRuntime == null ? 0
                : activeRuntime.stageTimeoutMillis() / 1_000L);
        out.put("last_heartbeat_age_seconds", activeRuntime == null
                ? -1 : ageSeconds(activeRuntime.lastHeartbeatAt(), now));
        out.put("last_progress_age_seconds", activeRuntime == null
                ? -1 : ageSeconds(activeRuntime.lastProgressAt(), now));
        out.put("heartbeat_status", cleaning ? "ZAP 임시 상태 정리 중"
                : activeRuntime == null ? "" : activeRuntime.heartbeatStatus());
        out.put("activity_state", cleaning ? "CLEANING_UP" : zapActivityState(value.status(), activeStage, activeRuntime, now));
        ArrayNode lanes = out.putArray("lanes");
        int runningIndex = -1;
        for (int index = 0; index < zapBaselineLanes.size(); index++) {
            if ("RUNNING".equals(zapBaselineLanes.get(index).status())) { runningIndex = index; break; }
        }
        for (int index = 0; index < zapBaselineLanes.size(); index++) {
            ZapLaneResult lane = zapBaselineLanes.get(index);
            ZapLaneRuntime timing = index < runtime.size() ? runtime.get(index) : null;
            ZapAuthenticationResult authentication = index < zapAuthentication.size()
                    ? zapAuthentication.get(index)
                    : new ZapAuthenticationResult("UNKNOWN", "", "인증 상태 없음");
            ObjectNode node = lanes.addObject();
            if (lane.accountId() == null) node.putNull("account_id"); else node.put("account_id", lane.accountId());
            node.put("account_label", lane.accountLabel());
            node.put("status", lane.status());
            node.put("stage", lane.stage());
            node.put("authentication_state", authentication.state());
            node.put("authentication_browser", authentication.browser());
            node.put("authentication_message", authentication.message());
            long laneCaptured = lane.capturedRecords();
            long clientCaptured = lane.clientCaptures();
            if (timing != null && "RUNNING".equals(lane.status())) {
                laneCaptured = Math.max(laneCaptured, timing.lastCaptured() - timing.capturedAtStart());
                clientCaptured = Math.max(clientCaptured,
                        capturedForRun(value.runId(), SourceDetail.ZAP_CLIENT_SPIDER) - timing.clientAtStart());
            }
            node.put("captured_records", Math.max(0, laneCaptured));
            node.put("client_captures", Math.max(0, clientCaptured));
            node.put("definition_imports", lane.definitionImports());
            node.put("alert_count", lane.alertCount());
            node.put("alert_snapshot_complete", lane.alertSnapshotComplete());
            node.put("passive_complete", lane.passiveComplete());
            node.put("passive_remaining", timing != null && "RUNNING".equals(lane.status())
                    ? timing.passiveRemaining() : lane.passiveRemaining());
            node.put("passive_task", timing != null && "RUNNING".equals(lane.status())
                    ? timing.passiveTask() : "");
            node.put("warning", lane.warning());
            node.put("error", lane.error());
            if (timing != null) {
                long end = timing.endedAt() > 0 ? timing.endedAt() : now;
                long start = timing.startedAt() > 0 ? timing.startedAt() : timing.queuedAt();
                node.put("queued_at", timing.queuedAt());
                node.put("started_at", timing.startedAt());
                node.put("elapsed_seconds", elapsedSeconds(start, end));
                node.put("stage_elapsed_seconds", timing.stageStartedAt() == 0 ? 0
                        : elapsedSeconds(timing.stageStartedAt(), end));
                node.put("stage_timeout_seconds", timing.stageTimeoutMillis() / 1_000L);
                node.put("last_heartbeat_age_seconds", ageSeconds(timing.lastHeartbeatAt(), now));
                node.put("last_progress_age_seconds", ageSeconds(timing.lastProgressAt(), now));
                node.put("heartbeat_status", timing.heartbeatStatus());
            }
            node.put("queue_position", index + 1);
            node.put("queue_total", zapBaselineLanes.size());
            node.put("wait_reason", "PENDING".equals(lane.status())
                    ? waitingReason(index, runningIndex) : "");
        }
        ArrayNode events = out.putArray("events");
        for (ZapProgressEvent event : zapProgressEvents) {
            events.addObject()
                    .put("at", event.at())
                    .put("account_label", event.accountLabel())
                    .put("stage", event.stage())
                    .put("level", event.level())
                    .put("message", event.message());
        }
        return out;
    }

    private String waitingReason(int laneIndex, int runningIndex) {
        if (runningIndex >= 0 && runningIndex < zapBaselineLanes.size()) {
            return zapBaselineLanes.get(runningIndex).accountLabel() + " lane 완료 후 시작";
        }
        if (laneIndex > 0) return zapBaselineLanes.get(laneIndex - 1).accountLabel() + " lane 완료 후 시작";
        return "실행 worker 배정 대기";
    }

    private static long latestLaneEnd(List<ZapLaneRuntime> runtime, long fallback) {
        return runtime.stream().mapToLong(ZapLaneRuntime::endedAt).filter(value -> value > 0)
                .max().orElse(fallback);
    }

    private static long elapsedSeconds(long start, long end) {
        if (start <= 0 || end < start) return 0;
        return (end - start) / 1_000L;
    }

    private static long ageSeconds(long timestamp, long now) {
        return timestamp <= 0 ? -1 : Math.max(0, (now - timestamp) / 1_000L);
    }

    private static String zapActivityState(String status, String stage, ZapLaneRuntime runtime, long now) {
        if (!"RUNNING".equals(status)) return status;
        if (runtime == null) return "STARTING";
        if (ageSeconds(runtime.lastHeartbeatAt(), now) > 10) return "NO_HEARTBEAT";
        if (runtime.stageTimeoutMillis() > 0
                && now - runtime.stageStartedAt() > runtime.stageTimeoutMillis()) return "DEADLINE_EXCEEDED";
        if ("SESSION_SETUP".equals(stage) || "API_DEFINITION_IMPORT".equals(stage)
                || "AUTHENTICATION".equals(stage)) {
            return "WAITING_FOR_ZAP_RESPONSE";
        }
        if (ageSeconds(runtime.lastProgressAt(), now) > 30) return "RESPONDING_NO_NEW_TRAFFIC";
        return "RESPONDING";
    }

    private JsonNode maskTextValues(JsonNode value) {
        JsonNode copy = value.deepCopy();
        maskTextValuesInPlace(copy);
        return copy;
    }

    private void maskTextValuesInPlace(JsonNode value) {
        if (value instanceof ObjectNode object) {
            List<String> fields = new ArrayList<>();
            object.fieldNames().forEachRemaining(fields::add);
            for (String field : fields) {
                JsonNode child = object.get(field);
                if (child != null && child.isTextual()) object.put(field, child.asText());
                else maskTextValuesInPlace(child);
            }
        } else if (value instanceof ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                JsonNode child = array.get(i);
                if (child.isTextual()) array.set(i,
                        com.fasterxml.jackson.databind.node.TextNode.valueOf(child.asText()));
                else maskTextValuesInPlace(child);
            }
        }
    }

    private String configureExactZapContext(String target, String runId) {
        String contextName = "flowscope-" + runId + "-" + Long.toUnsignedString(System.nanoTime(), 36);
        JsonNode context = parseZap(state.zap().newContext(contextName));
        if (context.path("contextId").asText().isBlank()) {
            throw new IllegalStateException("ZAP did not create an exact-scope context");
        }
        requireZapOk(state.zap().includeInContext(contextName, ZapClient.exactSubtreeRegex(target)),
                "include the exact target subtree in context");
        requireZapOk(state.zap().setContextInScope(contextName), "mark the exact target context in scope");
        return contextName;
    }

    private JsonNode parseZap(String raw) {
        try { return json.readTree(raw); }
        catch (Exception e) { return json.createObjectNode().put("raw", raw); }
    }

    private String required(JsonNode args, String field) {
        String value = args.path(field).asText();
        if (value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value;
    }

    private void rejectIndependentExplorer(String capability) {
        RunContextRegistry.Context context = state.contexts().current(Source.LLM);
        if (context != null && context.phase() == RunPhase.EXPLORATION) {
            throw new IllegalStateException("independent Explorer cannot access " + capability);
        }
    }

    private String validatedAccount(String accountId) {
        if (accountId == null || accountId.isBlank()) return null;
        ZapAccountVault accounts = state.zapAccounts();
        if (accounts == null) throw new IllegalStateException("ZAP account vault is unavailable");
        accounts.view(accountId);
        return accountId;
    }

    private String validatedAccountForTarget(String accountId, String target) {
        String value = validatedAccount(accountId);
        if (value == null) return null;
        ZapAccountVault.View account = state.zapAccounts().view(value);
        URI expected = URI.create(account.service());
        URI actual = URI.create(target);
        int actualPort = actual.getPort() >= 0 ? actual.getPort()
                : "https".equalsIgnoreCase(actual.getScheme()) ? 443 : 80;
        if (actual.getHost() == null || !expected.getScheme().equalsIgnoreCase(actual.getScheme())
                || !expected.getHost().equalsIgnoreCase(actual.getHost()) || expected.getPort() != actualPort) {
            throw new IllegalArgumentException("ZAP account and target services differ: " + value);
        }
        return value;
    }


    private static String validatedRunId(String value) {
        String runId = value == null ? "" : value.trim();
        if (!runId.matches("[A-Za-z0-9._:-]{1,120}")) {
            throw new IllegalArgumentException("run_id must use 1-120 ASCII letters, digits, dot, underscore, colon, or hyphen");
        }
        return runId;
    }

    private static String randomToken() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

}
