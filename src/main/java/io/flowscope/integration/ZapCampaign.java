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
        ScopePolicy scope();
        ZapClient zap();
        default int scannerProxyPort() { return 8081; }
        default void scannerCapability(String runId, String capability) { }
        default void clearScannerCapability(String runId) { }
        default long scannerCapabilityRejections(String runId) { return 0; }
        RunContextRegistry contexts();
        boolean approve(String action, String target);
        default SessionBroker sessions() { return null; }
    }

    public enum ZapDefinitionType { OPENAPI, GRAPHQL, POSTMAN, SOAP }
    public record ZapDefinition(ZapDefinitionType type, String url, String endpoint) {}

    private static final int MAX_ZAP_ALERT_SNAPSHOT = 20_000;
    private static final int MAX_ZAP_LANES = 20;
    private static final int MAX_ZAP_PROGRESS_EVENTS = 120;
    private static final Set<String> SAFE_ZAP_ADDONS = Set.of(
            "spider", "client", "spiderAjax", "pscan", "pscanrules", "selenium", "openapi", "websocket",
            "network", "replacer");
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
    private volatile List<ZapLaneRuntime> zapLaneRuntime = List.of();
    private volatile List<ZapProgressEvent> zapProgressEvents = List.of();
    private final AtomicBoolean zapCancelRequested = new AtomicBoolean();
    private volatile Future<?> zapWorkflowFuture;
    private volatile String ownedTraditionalScanId = "";
    private volatile String ownedClientScanId = "";
    private volatile boolean ownedAjaxRunning;
    private volatile String zapCapabilityRunId = "";
    private volatile String zapCapabilityRule = "";

    private record ZapBaselineRun(String runId, String target, String status, String stage,
                                  String scanId, String warning, long capturedRecords,
                                  int definitionCount, int alertCount, String error) {}
    private record ZapLaneResult(String accountId, String accountLabel, String status, String stage,
                                 long capturedRecords, long traditionalCaptures, long renderedCaptures,
                                 int definitionImports, int alertCount, boolean alertSnapshotComplete,
                                 boolean passiveComplete, int passiveRemaining, boolean ajaxExecuted,
                                 String warning, String error) {}
    private record ZapLaneRuntime(long queuedAt, long startedAt, long endedAt, long stageStartedAt,
                                  long lastHeartbeatAt, long lastProgressAt, long stageTimeoutMillis,
                                  long capturedAtStart, long traditionalAtStart, long renderedAtStart,
                                  long lastCaptured, int passiveRemaining, String passiveTask,
                                  String heartbeatStatus) {}
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
    public JsonNode cancelDeterministicZapBaseline() {
        ZapBaselineRun current = zapBaseline;
        if (current == null || !"RUNNING".equals(current.status())) return zapBaselineStatus();
        zapCancelRequested.set(true);
        Future<?> future = zapWorkflowFuture;
        if (future != null) future.cancel(true);
        RuntimeException cleanupFailure = stopAndAwaitOwnedCrawlers();
        state.contexts().abort(Source.SCANNER, current.runId());
        RuntimeException capabilityFailure = removeScannerCapability(current.runId());
        if (capabilityFailure != null) {
            cleanupFailure = mergeFailure(cleanupFailure, "scanner capability cleanup failed", capabilityFailure);
        }
        String warning = cleanupFailure == null ? "" : "취소 중 ZAP 정리 실패: " + cleanupFailure.getMessage();
        zapBaseline = new ZapBaselineRun(current.runId(), current.target(), "CANCELLED", "CANCELLED",
                "", warning, capturedForRun(current.runId()), current.definitionCount(),
                zapBaselineAlerts.size(), "");
        recordZapProgress("전체", "CANCELLED", cleanupFailure == null ? "DONE" : "ERROR",
                cleanupFailure == null ? "사용자 요청으로 ZAP 캠페인 취소·정리 완료" : warning);
        return zapBaselineStatus();
    }
    public void resetWorkflow() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        if (zapBaseline == null || !"RUNNING".equals(zapBaseline.status())) {
            zapBaseline = null;
            zapBaselineAlerts = json.createArrayNode();
            zapBaselineLanes = List.of();
            zapLaneRuntime = List.of();
            zapProgressEvents = List.of();
        }
    }

    @Override public void close() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        zapLaneRuntime = List.of();
        zapWorkflow.shutdownNow();
        zapHeartbeat.shutdownNow();
    }

    synchronized JsonNode startZapBaseline(JsonNode args) {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) {
            throw new IllegalStateException("ZAP baseline is already running: " + zapBaseline.runId());
        }
        String target = required(args, "target");
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
        List<ZapDefinition> definitions = validatedZapDefinitions(args.path("definitions"));
        verifySafeZapEnvironment(definitions);
        if (!definitions.isEmpty() && !state.approve("ZAP API 정의가 만든 요청 전송", target)) {
            throw new IllegalStateException("API definition import requires explicit Burp approval");
        }
        List<ZapLane> lanes = new ArrayList<>();
        if (includeAnonymous) lanes.add(new ZapLane(null, "비로그인"));
        for (String accountId : requestedAccounts) {
            String validated = validatedAccountForTarget(accountId, target);
            SessionBroker.SessionView session = state.sessions().viewForAccount(validated).orElseThrow();
            lanes.add(new ZapLane(validated, session.accountLabel()));
        }
        if (lanes.isEmpty()) throw new IllegalArgumentException("select anonymous or at least one active account");
        if (lanes.size() > MAX_ZAP_LANES) {
            throw new IllegalArgumentException("a ZAP campaign supports at most " + MAX_ZAP_LANES + " identities");
        }
        String runId = validatedRunId(args.path("run_id").asText("zap-baseline-" + System.currentTimeMillis()));
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, lanes.get(0).accountId()));
        try {
            installScannerCapability(target, runId);
            zapBaselineAlerts = json.createArrayNode();
            zapProgressEvents = List.of();
            long queuedAt = System.currentTimeMillis();
            zapBaselineLanes = lanes.stream().map(lane -> new ZapLaneResult(lane.accountId(), lane.accountLabel(),
                    "PENDING", "PENDING", 0, 0, 0, 0, 0,
                    false, false, -1, false, "", "")).toList();
            zapLaneRuntime = lanes.stream().map(lane -> new ZapLaneRuntime(queuedAt, 0, 0, 0,
                    0, queuedAt, 0, 0, 0, 0, 0,
                    -1, "", "대기 중")).toList();
            zapBaseline = new ZapBaselineRun(runId, target, "RUNNING", "INITIALIZING",
                    "", "", 0, definitions.size(), 0, "");
            zapCancelRequested.set(false);
            ownedTraditionalScanId = "";
            ownedClientScanId = "";
            ownedAjaxRunning = false;
            recordZapProgress("전체", "INITIALIZING", "INFO",
                    lanes.size() + "개 신원 격리 검사 대기열 생성");
            zapWorkflowFuture = zapWorkflow.submit(() -> runZapCampaignSafely(runId, target, lanes, definitions));
        } catch (RuntimeException error) {
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

    private void runZapCampaignSafely(String runId, String target, List<ZapLane> lanes,
                                      List<ZapDefinition> definitions) {
        try {
            runZapCampaign(runId, target, lanes, definitions);
        } catch (Throwable error) {
            RuntimeException cleanup = stopAndAwaitOwnedCrawlers();
            state.contexts().abort(Source.SCANNER, runId);
            if (zapCancelRequested.get()) return;
            String detail = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (cleanup != null) detail = appendWarning(detail, "cleanup: " + cleanup.getMessage());
            zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    capturedForRun(runId), definitions.size(), zapBaselineAlerts.size(), detail);
            recordZapProgress("전체", "FAILED", "ERROR", "ZAP 캠페인 내부 오류 · " + detail);
        } finally {
            RuntimeException capabilityFailure = removeScannerCapability(runId);
            if (capabilityFailure != null && zapBaseline != null && runId.equals(zapBaseline.runId())
                    && !"CANCELLED".equals(zapBaseline.status())) {
                state.contexts().abort(Source.SCANNER, runId);
                zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                        capturedForRun(runId), definitions.size(), zapBaselineAlerts.size(),
                        "ZAP scanner capability cleanup failed: " + capabilityFailure.getMessage());
                recordZapProgress("전체", "FAILED", "ERROR", "ZAP 식별 capability 정리 실패");
            }
            ownedTraditionalScanId = "";
            ownedClientScanId = "";
            ownedAjaxRunning = false;
            zapWorkflowFuture = null;
        }
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
                "X-FlowScope-Scanner-Capability", capability), "install its scanner provenance capability");
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
            state.contexts().abort(Source.SCANNER, runId);
            zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    captured, definitions.size(), collectedAlerts.size(), campaignError);
            recordZapProgress("전체", "FAILED", "ERROR", "ZAP 캠페인 실패");
        } else {
            try {
                state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_PASSIVE_SCAN, null);
                LaneCompletionPolicy.complete(state.contexts(), Source.SCANNER, runId, state.completionSnapshot());
            } catch (RuntimeException error) {
                state.contexts().abort(Source.SCANNER, runId);
                zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                        captured, definitions.size(), collectedAlerts.size(), error.getMessage());
                recordZapProgress("전체", "FAILED", "ERROR", "완료 조건 검증 실패");
                return;
            }
            String warning = zapBaselineLanes.stream().map(ZapLaneResult::warning)
                    .filter(value -> value != null && !value.isBlank()).distinct()
                    .collect(java.util.stream.Collectors.joining("; "));
            String status = warning.isBlank() ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";
            zapBaseline = new ZapBaselineRun(runId, target, status, "ALERTS_READY", "", warning,
                    captured, definitions.size(), collectedAlerts.size(), "");
            recordZapProgress("전체", "ALERTS_READY",
                    warning.isBlank() ? "DONE" : "WARN",
                    "캠페인 종료 · 수집 " + captured + "건 · Alert " + collectedAlerts.size() + "건");
        }
    }

    private void blockRemainingZapLanes(List<ZapLane> lanes, int fromIndex) {
        for (int blocked = fromIndex; blocked < lanes.size(); blocked++) {
            ZapLane pending = lanes.get(blocked);
            replaceZapLane(blocked, new ZapLaneResult(pending.accountId(), pending.accountLabel(),
                    "NOT_RUN", "BLOCKED_BY_ISOLATION", 0, 0, 0, 0, 0,
                    false, false, -1, false, "",
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
        boolean ajaxExecuted = false;
        long capturedBefore = capturedForRun(runId);
        long traditionalBefore = capturedForRun(runId, SourceDetail.ZAP_SPIDER);
        long renderedBefore = capturedForRenderedStages(runId);
        try {
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "SESSION_SETUP", 0, 0, 0, 0, 0,
                    false, false, -1, false, "", ""));
            updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · SESSION_SETUP", "", "", "");
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_SPIDER, lane.accountId());
            String contextName = "flowscope-" + runId + "-" + index;
            JsonNode context;
            ScheduledFuture<?> setupHeartbeat = startZapWorkerHeartbeat(runId, index, "SESSION_SETUP",
                    "격리 세션 설정 · ZAP API 응답 대기");
            try {
                JsonNode reset = parseZap(state.zap().newSession(contextName));
                if (!"OK".equalsIgnoreCase(reset.path("Result").asText())) {
                    throw new IllegalStateException("ZAP did not create an isolated session");
                }
                recordZapHeartbeat(runId, index, "격리 세션 생성 응답 수신");
                context = parseZap(state.zap().newContext(contextName));
                if (context.path("contextId").asText().isBlank()) {
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
                state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_API_IMPORT, lane.accountId());
                replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                        "API_DEFINITION_IMPORT", 0, 0, 0, 0, 0,
                        false, false, -1, false, "", ""));
                updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · API_DEFINITION_IMPORT", "", warning, "");
                ScheduledFuture<?> importHeartbeat = startZapWorkerHeartbeat(runId, index,
                        "API_DEFINITION_IMPORT",
                        "API 정의 가져오기 · ZAP API 응답 대기");
                try {
                    for (int definitionIndex = 0; definitionIndex < definitions.size(); definitionIndex++) {
                        ZapDefinition definition = definitions.get(definitionIndex);
                        recordZapHeartbeat(runId, index, "API 정의 " + (definitionIndex + 1) + "/"
                                + definitions.size() + " · " + definition.type() + " 응답 대기");
                        try {
                            importZapDefinition(definition, target, context.path("contextId").asText());
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
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_SPIDER, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "TRADITIONAL_SPIDER", 0, 0, 0, definitionImports, 0,
                    false, false, -1, false, warning, ""));
            JsonNode traditional = parseZap(state.zap().spider(target));
            String scanId = traditional.path("scan").asText();
            if (scanId.isBlank()) throw new IllegalStateException("ZAP Traditional Spider did not return a scan id");
            ownedTraditionalScanId = scanId;
            ensureScannerCapabilityIntact(runId);
            updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · TRADITIONAL_SPIDER", scanId, warning, "");
            try {
                waitForZap(() -> state.zap().spiderStatus(scanId), 15 * 60_000L,
                        "Traditional Spider", runId, index);
                releaseTraditionalSpider(scanId);
            } catch (RuntimeException failure) {
                if (claimTraditionalSpider(scanId)) {
                    try { stopOwnedSpider(scanId, false); }
                    catch (RuntimeException cleanup) {
                        ZapIsolationException isolation = new ZapIsolationException(
                                "Traditional Spider did not reach a terminal state: " + cleanup.getMessage());
                        isolation.addSuppressed(failure);
                        throw isolation;
                    }
                }
                throw failure;
            }
            ensureZapNotCancelled();
            long traditionalCaptured = capturedForRun(runId, SourceDetail.ZAP_SPIDER) - traditionalBefore;

            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_CLIENT_SPIDER, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "CLIENT_SPIDER", traditionalCaptured, traditionalCaptured, 0,
                    definitionImports, 0, false, false, -1, false, warning, ""));
            long clientBefore = capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER);
            RuntimeException clientFailure = null;
            String clientId = "";
            boolean clientFinished = false;
            try {
                JsonNode client = parseZap(state.zap().clientSpider(target, contextName));
                clientId = client.path("scan").asText();
                if (clientId.isBlank()) throw new IllegalStateException("Client Spider did not return a scan id");
                ownedClientScanId = clientId;
                updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · CLIENT_SPIDER", clientId, warning, "");
                String finalClientId = clientId;
                waitForZap(() -> state.zap().clientSpiderStatus(finalClientId), 20 * 60_000L,
                        "Client Spider", runId, index);
                clientFinished = true;
                releaseClientSpider(clientId);
            } catch (RuntimeException clientError) {
                clientFailure = clientError;
            } finally {
                if (!clientFinished && !clientId.isBlank() && claimClientSpider(clientId)) {
                    try { stopOwnedSpider(clientId, true); }
                    catch (RuntimeException cleanupError) {
                        throw new ZapIsolationException("Client Spider cleanup failed: " + cleanupError.getMessage());
                    }
                }
            }
            ensureScannerCapabilityIntact(runId);
            ensureZapNotCancelled();
            long clientCaptured = capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER) - clientBefore;
            if (clientFailure != null) {
                warning = appendWarning(warning, "Client Spider unavailable: " + clientFailure.getMessage());
            } else if (clientCaptured == 0) {
                warning = appendWarning(warning, "Client Spider completed without captured rendered traffic");
            }

            ajaxExecuted = true;
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_AJAX_SPIDER, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "AJAX_SUPPLEMENT", traditionalCaptured + clientCaptured,
                    traditionalCaptured, clientCaptured, definitionImports, 0,
                    false, false, -1, true, warning, ""));
            long ajaxBefore = capturedForRun(runId, SourceDetail.ZAP_AJAX_SPIDER);
            RuntimeException ajaxFailure = null;
            boolean ajaxStarted = false;
            boolean ajaxFinished = false;
            try {
                JsonNode ajax = parseZap(state.zap().ajaxSpider(target, contextName));
                if (!"OK".equalsIgnoreCase(ajax.path("Result").asText())) {
                    throw new IllegalStateException("ZAP AJAX Spider did not start");
                }
                ajaxStarted = true;
                ownedAjaxRunning = true;
                updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · AJAX_SUPPLEMENT", "", warning, "");
                waitForZap(() -> state.zap().ajaxSpiderStatus(), 20 * 60_000L,
                        "AJAX Spider", runId, index);
                ajaxFinished = true;
                releaseAjaxSpider();
            } catch (RuntimeException ajaxError) {
                ajaxFailure = ajaxError;
            } finally {
                if (ajaxStarted && !ajaxFinished && claimAjaxSpider()) {
                    try { stopOwnedAjax(); }
                    catch (RuntimeException cleanupError) {
                        throw new ZapIsolationException("AJAX Spider cleanup failed: " + cleanupError.getMessage());
                    }
                }
            }
            ensureScannerCapabilityIntact(runId);
            ensureZapNotCancelled();
            long ajaxCaptured = capturedForRun(runId, SourceDetail.ZAP_AJAX_SPIDER) - ajaxBefore;
            if (ajaxFailure != null) {
                warning = appendWarning(warning, "AJAX Spider unavailable: " + ajaxFailure.getMessage());
            } else if (ajaxCaptured == 0) {
                warning = appendWarning(warning, "AJAX Spider completed without captured rendered traffic");
            }

            long renderedCaptured = capturedForRenderedStages(runId) - renderedBefore;
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_PASSIVE_SCAN, lane.accountId());
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "PASSIVE_SCAN_QUEUE", traditionalCaptured + renderedCaptured,
                    traditionalCaptured, renderedCaptured, definitionImports, 0,
                    false, false, -1, ajaxExecuted, warning, ""));
            updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · PASSIVE_SCAN_QUEUE", "", warning, "");
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
                throw new IllegalStateException("scanner workflow completed without captured in-scope traffic");
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
            String laneStatus = warning.isBlank() ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), laneStatus,
                    "ALERTS_READY", captured, traditionalCaptured, renderedCaptured,
                    definitionImports, alertCount, alertSnapshotComplete,
                    passiveComplete, passiveRemaining, ajaxExecuted, warning, ""));
        } catch (RuntimeException error) {
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "FAILED", "FAILED",
                    Math.max(0, capturedForRun(runId) - capturedBefore),
                    Math.max(0, capturedForRun(runId, SourceDetail.ZAP_SPIDER) - traditionalBefore),
                    Math.max(0, capturedForRenderedStages(runId) - renderedBefore), definitionImports,
                    alertCount, alertSnapshotComplete, passiveComplete, passiveRemaining,
                    ajaxExecuted, warning, message));
            throw error;
        }
    }

    private long capturedForRun(String runId) {
        return state.capturedCount(Source.SCANNER, runId, null);
    }

    private long capturedForRun(String runId, SourceDetail detail) {
        return state.capturedCount(Source.SCANNER, runId, detail);
    }

    private long capturedForRenderedStages(String runId) {
        return capturedForRun(runId, SourceDetail.ZAP_CLIENT_SPIDER)
                + capturedForRun(runId, SourceDetail.ZAP_AJAX_SPIDER);
    }

    private void verifySafeZapEnvironment(List<ZapDefinition> definitions) {
        JsonNode version = parseZap(state.zap().version());
        if (version.path("version").asText().isBlank()) {
            throw new IllegalStateException("ZAP version API did not return a version");
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

    private void stopOwnedSpider(String scanId, boolean clientSpider) {
        boolean interrupted = Thread.interrupted();
        try {
            requireZapOk(clientSpider ? state.zap().stopClientSpider(scanId) : state.zap().stopSpider(scanId),
                    "stop its unfinished " + (clientSpider ? "Client Spider" : "Traditional Spider"));
            awaitZapTerminal(clientSpider ? () -> state.zap().clientSpiderStatus(scanId)
                            : () -> state.zap().spiderStatus(scanId),
                    clientSpider ? "Client Spider" : "Traditional Spider");
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private void stopOwnedAjax() {
        boolean interrupted = Thread.interrupted();
        try {
            requireZapOk(state.zap().stopAjaxSpider(), "stop its unfinished AJAX Spider");
            awaitZapTerminal(() -> state.zap().ajaxSpiderStatus(), "AJAX Spider");
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private RuntimeException stopAndAwaitOwnedCrawlers() {
        RuntimeException failure = null;
        String traditional;
        String client;
        boolean ajax;
        synchronized (this) {
            traditional = ownedTraditionalScanId;
            client = ownedClientScanId;
            ajax = ownedAjaxRunning;
            ownedTraditionalScanId = "";
            ownedClientScanId = "";
            ownedAjaxRunning = false;
        }
        if (!traditional.isBlank()) {
            try { stopOwnedSpider(traditional, false); }
            catch (RuntimeException error) { failure = mergeFailure(failure, "Traditional Spider cleanup failed", error); }
        }
        if (!client.isBlank()) {
            try { stopOwnedSpider(client, true); }
            catch (RuntimeException error) { failure = mergeFailure(failure, "Client Spider cleanup failed", error); }
        }
        if (ajax) {
            try { stopOwnedAjax(); }
            catch (RuntimeException error) { failure = mergeFailure(failure, "AJAX Spider cleanup failed", error); }
        }
        return failure;
    }

    private synchronized boolean claimTraditionalSpider(String scanId) {
        if (!scanId.equals(ownedTraditionalScanId)) return false;
        ownedTraditionalScanId = "";
        return true;
    }

    private synchronized void releaseTraditionalSpider(String scanId) {
        if (scanId.equals(ownedTraditionalScanId)) ownedTraditionalScanId = "";
    }

    private synchronized boolean claimClientSpider(String scanId) {
        if (!scanId.equals(ownedClientScanId)) return false;
        ownedClientScanId = "";
        return true;
    }

    private synchronized void releaseClientSpider(String scanId) {
        if (scanId.equals(ownedClientScanId)) ownedClientScanId = "";
    }

    private synchronized boolean claimAjaxSpider() {
        if (!ownedAjaxRunning) return false;
        ownedAjaxRunning = false;
        return true;
    }

    private synchronized void releaseAjaxSpider() { ownedAjaxRunning = false; }

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
        List<ZapLaneResult> copy = new ArrayList<>(zapBaselineLanes);
        ZapLaneResult previous = copy.get(index);
        copy.set(index, value);
        zapBaselineLanes = List.copyOf(copy);
        if (index >= zapLaneRuntime.size()) return;
        long now = System.currentTimeMillis();
        List<ZapLaneRuntime> runtime = new ArrayList<>(zapLaneRuntime);
        ZapLaneRuntime current = runtime.get(index);
        boolean started = !"PENDING".equals(value.status());
        boolean terminal = Set.of("COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "NOT_RUN")
                .contains(value.status());
        boolean stageChanged = !java.util.Objects.equals(previous.stage(), value.stage());
        long startedAt = current.startedAt() == 0 && started ? now : current.startedAt();
        long endedAt = current.endedAt() == 0 && terminal ? now : current.endedAt();
        long captured = capturedForRun(zapBaseline == null ? "" : zapBaseline.runId());
        long lastProgressAt = captured != current.lastCaptured() ? now : current.lastProgressAt();
        long runTraditional = zapBaseline == null ? 0
                : capturedForRun(zapBaseline.runId(), SourceDetail.ZAP_SPIDER);
        long runRendered = zapBaseline == null ? 0 : capturedForRenderedStages(zapBaseline.runId());
        runtime.set(index, new ZapLaneRuntime(current.queuedAt(), startedAt, endedAt,
                stageChanged ? now : current.stageStartedAt(),
                stageChanged ? now : current.lastHeartbeatAt(), lastProgressAt,
                stageChanged ? zapStageTimeoutMillis(value.stage()) : current.stageTimeoutMillis(),
                current.startedAt() == 0 && started ? captured : current.capturedAtStart(),
                current.startedAt() == 0 && started ? runTraditional : current.traditionalAtStart(),
                current.startedAt() == 0 && started ? runRendered : current.renderedAtStart(),
                captured, stageChanged ? value.passiveRemaining() : current.passiveRemaining(),
                stageChanged ? "" : current.passiveTask(),
                stageChanged ? "단계 시작" : current.heartbeatStatus()));
        zapLaneRuntime = List.copyOf(runtime);
        if (stageChanged || !java.util.Objects.equals(previous.status(), value.status())) {
            String level = switch (value.status()) {
                case "FAILED", "NOT_RUN" -> "ERROR";
                case "COMPLETED_WITH_WARNINGS" -> "WARN";
                case "COMPLETED" -> "DONE";
                default -> "INFO";
            };
            String message = switch (value.status()) {
                case "FAILED" -> zapStageLabel(value.stage()) + " 실패"
                        + (value.error().isBlank() ? "" : " · " + value.error());
                case "NOT_RUN" -> "이전 신원 격리 실패로 실행하지 않음";
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
                + (url.isBlank() ? "" : " · " + io.flowscope.core.Masking.maskSecrets(url));
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
                current.stageTimeoutMillis(), current.capturedAtStart(), current.traditionalAtStart(),
                current.renderedAtStart(), captured, current.passiveRemaining(), current.passiveTask(), status));
        zapLaneRuntime = List.copyOf(runtime);
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
                current.stageTimeoutMillis(), current.capturedAtStart(), current.traditionalAtStart(),
                current.renderedAtStart(), captured, remaining, task,
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
                Masking.maskSecrets(message)));
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
            case "TRADITIONAL_SPIDER" -> "Traditional Spider";
            case "CLIENT_SPIDER" -> "Client Spider";
            case "AJAX_SUPPLEMENT" -> "AJAX Spider 보완";
            case "PASSIVE_SCAN_QUEUE" -> "Passive Scan";
            case "ALERTS_READY" -> "Alert 집계";
            case "FAILED" -> "현재 단계";
            default -> stage == null || stage.isBlank() ? "검사" : stage;
        };
    }

    private long zapStageTimeoutMillis(String stage) {
        return switch (stage == null ? "" : stage) {
            case "SESSION_SETUP" -> 60_000L;
            case "API_DEFINITION_IMPORT" -> Math.max(1, zapBaseline == null
                    ? 1 : zapBaseline.definitionCount()) * 2 * 60_000L;
            case "TRADITIONAL_SPIDER" -> 15 * 60_000L;
            case "CLIENT_SPIDER", "AJAX_SUPPLEMENT" -> 20 * 60_000L;
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

    private void updateZapBaseline(String runId, String status, String stage, String scanId,
                                   String warning, String error) {
        ZapBaselineRun previous = zapBaseline;
        long captured = capturedForRun(runId);
        int alerts = previous == null ? 0 : previous.alertCount();
        zapBaseline = new ZapBaselineRun(runId, previous == null ? "" : previous.target(), status, stage,
                scanId, warning, captured, previous == null ? 0 : previous.definitionCount(), alerts, error);
    }

    private ObjectNode zapBaselineNode(ZapBaselineRun value) {
        ObjectNode out = json.createObjectNode();
        long now = System.currentTimeMillis();
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
        out.put("stage_elapsed_seconds", activeRuntime == null ? 0
                : elapsedSeconds(activeRuntime.stageStartedAt(), now));
        out.put("stage_timeout_seconds", activeRuntime == null ? 0
                : activeRuntime.stageTimeoutMillis() / 1_000L);
        out.put("last_heartbeat_age_seconds", activeRuntime == null
                ? -1 : ageSeconds(activeRuntime.lastHeartbeatAt(), now));
        out.put("last_progress_age_seconds", activeRuntime == null
                ? -1 : ageSeconds(activeRuntime.lastProgressAt(), now));
        out.put("heartbeat_status", activeRuntime == null ? "" : activeRuntime.heartbeatStatus());
        out.put("activity_state", zapActivityState(value.status(), activeStage, activeRuntime, now));
        ArrayNode lanes = out.putArray("lanes");
        int runningIndex = -1;
        for (int index = 0; index < zapBaselineLanes.size(); index++) {
            if ("RUNNING".equals(zapBaselineLanes.get(index).status())) { runningIndex = index; break; }
        }
        for (int index = 0; index < zapBaselineLanes.size(); index++) {
            ZapLaneResult lane = zapBaselineLanes.get(index);
            ZapLaneRuntime timing = index < runtime.size() ? runtime.get(index) : null;
            ObjectNode node = lanes.addObject();
            if (lane.accountId() == null) node.putNull("account_id"); else node.put("account_id", lane.accountId());
            node.put("account_label", lane.accountLabel());
            node.put("status", lane.status());
            node.put("stage", lane.stage());
            long laneCaptured = lane.capturedRecords();
            long traditionalCaptured = lane.traditionalCaptures();
            long renderedCaptured = lane.renderedCaptures();
            if (timing != null && "RUNNING".equals(lane.status())) {
                laneCaptured = Math.max(laneCaptured, timing.lastCaptured() - timing.capturedAtStart());
                traditionalCaptured = Math.max(traditionalCaptured,
                        capturedForRun(value.runId(), SourceDetail.ZAP_SPIDER) - timing.traditionalAtStart());
                renderedCaptured = Math.max(renderedCaptured,
                        capturedForRenderedStages(value.runId()) - timing.renderedAtStart());
            }
            node.put("captured_records", Math.max(0, laneCaptured));
            node.put("traditional_captures", Math.max(0, traditionalCaptured));
            node.put("rendered_captures", Math.max(0, renderedCaptured));
            node.put("definition_imports", lane.definitionImports());
            node.put("alert_count", lane.alertCount());
            node.put("alert_snapshot_complete", lane.alertSnapshotComplete());
            node.put("passive_complete", lane.passiveComplete());
            node.put("passive_remaining", timing != null && "RUNNING".equals(lane.status())
                    ? timing.passiveRemaining() : lane.passiveRemaining());
            node.put("passive_task", timing != null && "RUNNING".equals(lane.status())
                    ? timing.passiveTask() : "");
            node.put("ajax_executed", lane.ajaxExecuted());
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
        if ("SESSION_SETUP".equals(stage) || "API_DEFINITION_IMPORT".equals(stage)) {
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
                if (child != null && child.isTextual()) object.put(field, Masking.maskHeaders(child.asText()));
                else maskTextValuesInPlace(child);
            }
        } else if (value instanceof ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                JsonNode child = array.get(i);
                if (child.isTextual()) array.set(i,
                        com.fasterxml.jackson.databind.node.TextNode.valueOf(Masking.maskHeaders(child.asText())));
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

    private String validatedAccount(String accountId) {
        if (accountId == null || accountId.isBlank()) return null;
        SessionBroker sessions = state.sessions();
        if (sessions == null) throw new IllegalStateException("session broker is unavailable");
        SessionBroker.SessionView session = sessions.viewForAccount(accountId)
                .orElseThrow(() -> new IllegalArgumentException("no captured session for account: " + accountId));
        if (session.status() != SessionBroker.Status.ACTIVE) {
            throw new IllegalStateException("account session is not active: " + accountId
                    + " (" + session.status() + ")");
        }
        return accountId;
    }

    private String validatedAccountForTarget(String accountId, String target) {
        String value = validatedAccount(accountId);
        if (value == null) return null;
        SessionBroker.SessionView session = state.sessions().viewForAccount(value).orElseThrow();
        URI expected = URI.create(session.service());
        URI actual = URI.create(target);
        int actualPort = actual.getPort() >= 0 ? actual.getPort()
                : "https".equalsIgnoreCase(actual.getScheme()) ? 443 : 80;
        if (actual.getHost() == null || !expected.getScheme().equalsIgnoreCase(actual.getScheme())
                || !expected.getHost().equalsIgnoreCase(actual.getHost()) || expected.getPort() != actualPort) {
            throw new IllegalArgumentException("account session and target services differ: " + value);
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
