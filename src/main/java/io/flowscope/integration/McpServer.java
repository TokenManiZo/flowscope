package io.flowscope.integration;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.*;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Localhost 전용 MCP Streamable HTTP(JSON-RPC) 서버. 모델 제공자 토큰을 취급하지 않는다. */
public final class McpServer implements AutoCloseable {
    private static final Set<String> EXPLORER_VISIBLE_TOOLS = Set.of(
            "flowscope_get_status", "flowscope_list_sessions", "flowscope_target_read",
            "flowscope_target_request", "flowscope_list_route_candidates", "flowscope_list_evidence",
            "flowscope_get_evidence", "flowscope_browser_navigate", "flowscope_browser_snapshot",
            "flowscope_browser_interact", "flowscope_browser_close", "flowscope_end_run");
    private static final Set<String> SAFE_DISCOVERY_METHODS = Set.of("GET", "HEAD", "OPTIONS", "UNKNOWN");
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
        void updateScope(String value);
        ZapClient zap();
        default int scannerProxyPort() { return 8081; }
        default void scannerCapability(String runId, String capability) { }
        default void clearScannerCapability(String runId) { }
        default long scannerCapabilityRejections(String runId) { return 0; }
        RunContextRegistry contexts();
        AnalysisConfig config();
        default List<RouteCandidate> routeCandidates() { return List.of(); }
        boolean approve(String action, String target);
        default SessionBroker sessions() { return null; }
        default TargetResult targetRequest(TargetRequest request) {
            throw new UnsupportedOperationException("controlled target executor is unavailable");
        }
        default ControlledBrowserExplorer.Snapshot browserNavigate(String runId, String target, String accountId)
                throws Exception {
            throw new UnsupportedOperationException("controlled browser is unavailable");
        }
        default ControlledBrowserExplorer.Snapshot browserSnapshot(String runId) throws Exception {
            throw new UnsupportedOperationException("controlled browser is unavailable");
        }
        default ControlledBrowserExplorer.Snapshot browserInteract(String runId, String action,
                                                                    String selector, String value) throws Exception {
            throw new UnsupportedOperationException("controlled browser is unavailable");
        }
        default void browserClose(String runId) { }
        default boolean browserAvailable() { return ControlledBrowserExplorer.locateBrowser().isPresent(); }
        default void assessmentsChanged(List<Assessment> values) {}
        default void validationsChanged(List<ValidationDecision> values) {}
    }

    public record Assessment(String id, String type, String verdict, String title, String reason,
                             List<String> evidenceIds, Instant createdAt) {
        public Assessment {
            id = boundedAssessmentText(id, "assessment id", 128);
            type = boundedAssessmentText(type, "assessment type", 64);
            if (!Set.of("LIKELY", "INCONCLUSIVE", "REJECTED").contains(verdict)) {
                throw new IllegalArgumentException("invalid assessment verdict");
            }
            title = boundedAssessmentText(Masking.maskSecrets(title), "assessment title", 256);
            reason = boundedAssessmentText(Masking.maskSecrets(reason), "assessment reason", 4_096);
            if (evidenceIds == null || evidenceIds.isEmpty() || evidenceIds.size() > 200) {
                throw new IllegalArgumentException("assessment evidence_ids must contain 1 to 200 values");
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String evidenceId : evidenceIds) {
                normalized.add(boundedAssessmentText(evidenceId, "assessment evidence id", 256));
            }
            evidenceIds = List.copyOf(normalized);
            if (createdAt == null) throw new IllegalArgumentException("assessment createdAt is required");
        }
    }
    public record TargetRequest(String method, String target, Map<String, String> headers,
                                String body, String accountId) {}
    public record TargetResult(String evidenceId, int status, String location,
                               String response, String responseBody) {}
    public enum ZapDefinitionType { OPENAPI, GRAPHQL, POSTMAN, SOAP }
    public record ZapDefinition(ZapDefinitionType type, String url, String endpoint) {}

    private static final int MAX_BODY = 1024 * 1024;
    private static final int MAX_ZAP_ALERT_SNAPSHOT = 20_000;
    private static final int MAX_ZAP_LANES = 20;
    private static final int MAX_ZAP_PROGRESS_EVENTS = 120;
    private static final int MAX_ASSESSMENTS = 1_000;
    private static final long MAX_ASSESSMENT_RETAINED_BYTES = 4L * 1024 * 1024;
    private static final Set<String> SAFE_ZAP_ADDONS = Set.of(
            "spider", "client", "spiderAjax", "pscan", "pscanrules", "selenium", "openapi", "websocket",
            "network", "replacer");
    private static final String LATEST_PROTOCOL = "2025-11-25";
    private static final Set<String> SUPPORTED_PROTOCOLS = Set.of(
            LATEST_PROTOCOL, "2025-06-18", "2025-03-26");
    private final ObjectMapper json = new ObjectMapper();
    private final State state;
    private final String token;
    private final LoopbackHttpServer server;
    private final List<Assessment> assessments = new ArrayList<>();
    private final List<ValidationDecision> validations = new ArrayList<>();
    private volatile Pipeline.Result lockedSnapshot;
    private volatile List<RouteCandidate> lockedRouteCandidates = List.of();
    private volatile String lockId = "";
    private final Map<String, ExplorerProgress> explorerProgress = new ConcurrentHashMap<>();
    private final Map<String, List<RouteCandidate>> browserDiscoveredRoutes = new ConcurrentHashMap<>();
    private final Set<String> explorerBrowserUsed = ConcurrentHashMap.newKeySet();
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
    private record ExplorerProgress(boolean independentListed, boolean assistedListed) {
        ExplorerProgress markIndependent() { return new ExplorerProgress(true, assistedListed); }
        ExplorerProgress markAssisted() { return new ExplorerProgress(independentListed, true); }
    }

    public McpServer(State state, int port, String configuredToken) throws IOException {
        this.state = state;
        this.token = configuredToken == null || configuredToken.isBlank() ? randomToken() : configuredToken;
        this.server = new LoopbackHttpServer(port, this::handle);
    }

    public void start() { server.start(); }
    public int port() { return server.port(); }
    public String token() { return token; }
    public List<Assessment> assessments() { return snapshotAssessments(); }
    public List<ValidationDecision> validations() { return snapshotValidations(); }
    public boolean datasetLocked() { return lockedSnapshot != null; }
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
    public void clearAssessments() {
        synchronized (assessments) { assessments.clear(); }
        state.assessmentsChanged(List.of());
    }
    public void replaceAssessments(List<Assessment> values) {
        List<Assessment> replacement = values == null ? List.of() : List.copyOf(values);
        validateAssessmentSet(replacement);
        synchronized (assessments) {
            assessments.clear();
            assessments.addAll(replacement);
        }
        state.assessmentsChanged(snapshotAssessments());
    }
    public void clearValidations() {
        synchronized (validations) { validations.clear(); }
        state.validationsChanged(List.of());
    }
    public void resetWorkflow() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        lockedSnapshot = null;
        lockedRouteCandidates = List.of();
        lockId = "";
        explorerProgress.clear();
        browserDiscoveredRoutes.clear();
        explorerBrowserUsed.clear();
        if (zapBaseline == null || !"RUNNING".equals(zapBaseline.status())) {
            zapBaseline = null;
            zapBaselineAlerts = json.createArrayNode();
            zapBaselineLanes = List.of();
            zapLaneRuntime = List.of();
            zapProgressEvents = List.of();
        }
    }
    public void replaceValidations(List<ValidationDecision> values) {
        List<ValidationDecision> accepted = new ArrayList<>();
        for (ValidationDecision value : values == null ? List.<ValidationDecision>of() : values.stream().limit(1_000).toList()) {
            try {
                String runId = validateEvidenceBundle(value.candidateId(), value.verdict(),
                        value.originalEvidenceIds(), value.validationEvidenceIds(), value.controlEvidenceIds());
                if (runId.equals(value.runId())) accepted.add(value);
            } catch (RuntimeException ignored) {
                // 프로젝트에서 복원한 판정도 현재 Evidence로 동일한 서버 검증을 다시 통과해야 한다.
            }
        }
        synchronized (validations) {
            validations.clear();
            validations.addAll(accepted);
        }
        state.validationsChanged(snapshotValidations());
    }
    @Override public void close() {
        if (zapBaseline != null && "RUNNING".equals(zapBaseline.status())) cancelDeterministicZapBaseline();
        browserDiscoveredRoutes.clear();
        explorerBrowserUsed.clear();
        zapLaneRuntime = List.of();
        zapWorkflow.shutdownNow();
        zapHeartbeat.shutdownNow();
        server.close();
    }

    private LoopbackHttpServer.Response handle(LoopbackHttpServer.Request httpRequest) throws IOException {
        try {
            if (!httpRequest.remoteAddress().isLoopbackAddress()) {
                return response(httpRequest, 403, error(null, -32001, "localhost only"));
            }
            if (!validHost(httpRequest.header("Host"))) {
                return response(httpRequest, 403, error(null, -32002, "invalid Host"));
            }
            if (!httpRequest.path().equals("/mcp")) {
                return response(httpRequest, 404, error(null, -32601, "endpoint not found"));
            }
            String origin = httpRequest.header("Origin");
            if (origin != null && !origin.matches("(?i)^https?://(localhost|127\\.0\\.0\\.1|\\[::1])(?::\\d+)?$")) {
                return response(httpRequest, 403, error(null, -32002, "invalid Origin"));
            }
            if (!httpRequest.method().equalsIgnoreCase("POST")) {
                LoopbackHttpServer.Response value = response(httpRequest, 405, error(null, -32600, "POST required"));
                return new LoopbackHttpServer.Response(value.status(),
                        Map.of("Content-Type", "application/json; charset=utf-8", "Allow", "POST",
                                "MCP-Protocol-Version", negotiate(httpRequest.header("MCP-Protocol-Version"))), value.body());
            }
            String authorization = httpRequest.header("Authorization");
            byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
            byte[] provided = authorization == null ? new byte[0] : authorization.getBytes(StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(expected, provided)) {
                return response(httpRequest, 401, error(null, -32000, "invalid bearer token"));
            }
            byte[] bytes = httpRequest.body();
            if (bytes.length > MAX_BODY) {
                return response(httpRequest, 413, error(null, -32600, "request too large"));
            }
            JsonNode request;
            try {
                request = json.readTree(bytes);
            } catch (JsonProcessingException e) {
                return response(httpRequest, 400, error(null, -32700, "parse error"));
            }
            if (request == null || !request.isObject()
                    || !"2.0".equals(request.path("jsonrpc").asText())
                    || !request.path("method").isTextual()
                    || request.path("method").asText().isBlank()) {
                return response(httpRequest, 400,
                        error(request == null ? null : request.get("id"), -32600, "invalid request"));
            }
            JsonNode id = request.get("id");
            String method = request.path("method").asText();
            if (id == null && method.startsWith("notifications/")) {
                return new LoopbackHttpServer.Response(202, Map.of(), new byte[0]);
            }
            ObjectNode body = switch (method) {
                case "initialize" -> success(id, initialize(request.path("params")));
                case "ping" -> success(id, json.createObjectNode());
                case "tools/list" -> success(id, toolsList());
                case "tools/call" -> success(id, callTool(request.path("params")));
                default -> error(id, -32601, "method not found: " + method);
            };
            return response(httpRequest, 200, body);
        } catch (Exception e) {
            return response(httpRequest, 500,
                    error(null, -32603, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    private boolean validHost(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            URI uri = URI.create("http://" + value.trim());
            String host = uri.getHost();
            return host != null
                    && (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("::1"))
                    && uri.getPort() == server.port();
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private ObjectNode initialize(JsonNode params) {
        ObjectNode result = json.createObjectNode();
        String requested = params.path("protocolVersion").asText(LATEST_PROTOCOL);
        result.put("protocolVersion", negotiate(requested));
        result.putObject("capabilities").putObject("tools").put("listChanged", false);
        result.putObject("serverInfo").put("name", "flowscope").put("version", "1.2.0-beta.42");
        result.put("instructions", "Authorized exact-scope assessment only. Use FlowScope MCP state and controlled "
                + "flowscope_target_read/flowscope_target_request responses; do not use web search, Wayback, external API documentation, "
                + "source repositories, direct curl, or provider-controlled browser networking. If needed, set only the exact target supplied "
                + "by the operator before any run; never infer or broaden scope. Explorer may use only FlowScope's "
                + "isolated browser for rendered discovery and must replay relevant requests through the controlled executor for Evidence. "
                + "The system-owned ZAP baseline, not the "
                + "LLM, chooses scanner stages. Begin and end every LLM run. Explorer first exhausts its independent safe "
                + "route frontier, then may consume provenance-free cross-lane route hints. After all three lanes finish, "
                + "lock the dataset before Judge synthesis. CONFIRMED or "
                + "REJECTED is accepted only through FlowScope-controlled reproduction and control Evidence; otherwise "
                + "use INCONCLUSIVE.");
        return result;
    }

    private ObjectNode toolsList() {
        ArrayNode tools = json.createArrayNode();
        tools.add(tool("flowscope_get_status", "Get active scope, workflow stage, and only the counts visible at the current isolation stage.", schema(), true, false));
        tools.add(tool("flowscope_set_scope", "Replace the allowlist with user-authorized exact HTTP(S) scope entries before active runs.",
                scopeSchema(), false, false));
        tools.add(tool("flowscope_lock_dataset", "Lock completed HUMAN, SCANNER, and independent LLM lanes before Judge access.",
                schema(), false, false));
        tools.add(tool("flowscope_list_candidates", "List evidence-grounded BOLA/BFLA and coverage-gap candidates.", paginationSchema(), true, false));
        tools.add(tool("flowscope_list_route_candidates", "List the Explorer INDEPENDENT route frontier, then provenance-free ASSISTED cross-lane hints after the independent safe frontier is exhausted; locked Judge datasets return the frozen inventory.", routeCandidateSchema(), true, false));
        tools.add(tool("flowscope_get_evidence", "Read one masked request/response by evidence_id.",
                evidenceSchema(), true, false));
        tools.add(tool("flowscope_list_evidence", "List captured Evidence metadata with run/source/phase filters.",
                evidenceListSchema(), true, false));
        tools.add(tool("flowscope_list_sessions", "List safe test-account session status; never returns cookies or tokens.",
                schema(), true, false));
        tools.add(tool("flowscope_target_read", "Send one exact-scope GET, HEAD, or OPTIONS request through FlowScope's controlled executor. No external web access.",
                targetReadSchema(), false, false));
        tools.add(tool("flowscope_target_request", "Send one operator-approved exact-scope POST, PUT, PATCH, or DELETE request through FlowScope's controlled executor.",
                targetWriteSchema(), false, true));
        tools.add(tool("flowscope_browser_navigate", "Open or navigate FlowScope's isolated installed-Chrome Explorer. Exact scope and broker session are enforced; returned browser observations are discovery hints and must be replayed with flowscope_target_read/request to become Evidence.",
                browserNavigateSchema(), false, false));
        tools.add(tool("flowscope_browser_snapshot", "Read a bounded, secret-masked DOM and network summary from the active isolated Explorer browser.",
                schema(), true, false));
        tools.add(tool("flowscope_browser_interact", "Click or fill one selector in the active exact-scope Explorer browser. Password/file inputs are blocked, resulting state-changing HTTP requests require separate concrete-request Burp approval, and browser output remains discovery-only.",
                browserInteractSchema(), false, true));
        tools.add(tool("flowscope_browser_close", "Close the isolated Explorer browser and delete its temporary profile.",
                schema(), false, false));
        tools.add(tool("flowscope_submit_assessment", "Submit a non-confirming LLM assessment tied to existing evidence IDs.",
                assessmentSchema(), false, false));
        tools.add(tool("flowscope_list_assessments", "List LLM assessments submitted during this Burp session.", paginationSchema(), true, false));
        tools.add(tool("flowscope_submit_validation", "Submit a final verdict backed by captured LLM validation and control Evidence.",
                validationSchema(), false, false));
        tools.add(tool("flowscope_list_validations", "List server-validated final verdict bundles.", paginationSchema(), true, false));
        tools.add(tool("flowscope_begin_llm_run", "Begin an isolated Explorer, Judge probe, or validation run for FlowScope-controlled target traffic.",
                llmRunSchema(), false, false));
        tools.add(tool("flowscope_end_run", "End the active LLM or scanner run context.", endRunSchema(), false, false));
        tools.add(tool("flowscope_zap_status", "Check local ZAP connectivity or scan progress.", zapStatusSchema(), true, false));
        tools.add(tool("flowscope_zap_environment", "Read the local ZAP version and installed add-ons before a scanner pass.", schema(), true, false));
        tools.add(tool("flowscope_zap_baseline", "Run the deterministic isolated scanner campaign for anonymous and selected account IDs: optional explicit API definitions, Traditional Spider, Client Spider, AJAX Spider, passive queue, then native alerts.", zapBaselineSchema(), false, false));
        tools.add(tool("flowscope_zap_baseline_status", "Read deterministic scanner-lane progress and captured-output counts.", schema(), true, false));
        tools.add(tool("flowscope_zap_baseline_cancel", "Cancel the active scanner campaign and wait for FlowScope-owned ZAP crawlers to stop.", schema(), false, false));
        tools.add(tool("flowscope_zap_passive_status", "Read ZAP passive-scan queue and current tasks.", schema(), true, false));
        tools.add(tool("flowscope_zap_alerts", "Read paginated native ZAP alerts after the three-lane dataset is locked.", zapAlertsSchema(), true, false));
        tools.add(tool("flowscope_zap_spider", "Start a scoped ZAP spider; resulting HTTP remains source=SCANNER.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_client_spider", "Start the recommended strict-scope ZAP Client Spider for browser-rendered routes.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_ajax_spider", "Start a scoped ZAP AJAX spider for browser-rendered routes; resulting HTTP remains source=SCANNER.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_active_scan", "Start a scoped ZAP Active Scan after explicit Burp approval.", targetSchema(true), false, true));
        RunContextRegistry.Context activeLlm = state.contexts().current(Source.LLM);
        if (activeLlm != null && activeLlm.phase() == RunPhase.EXPLORATION
                && activeLlm.detail() == SourceDetail.LLM_EXPLORER) {
            ArrayNode visible = json.createArrayNode();
            tools.forEach(candidate -> {
                if (EXPLORER_VISIBLE_TOOLS.contains(candidate.path("name").asText())) visible.add(candidate);
            });
            return json.createObjectNode().set("tools", visible);
        }
        return json.createObjectNode().set("tools", tools);
    }

    private ObjectNode callTool(JsonNode params) {
        String name = params.path("name").asText();
        JsonNode args = params.path("arguments");
        try {
            JsonNode data = switch (name) {
                case "flowscope_get_status" -> status();
                case "flowscope_set_scope" -> setScope(args);
                case "flowscope_lock_dataset" -> lockDataset();
                case "flowscope_list_candidates" -> candidates(args);
                case "flowscope_list_route_candidates" -> routeCandidates(args);
                case "flowscope_get_evidence" -> evidence(args.path("evidence_id").asText());
                case "flowscope_list_evidence" -> listEvidence(args);
                case "flowscope_list_sessions" -> listSessions();
                case "flowscope_target_read" -> targetRequest(args, true);
                case "flowscope_target_request" -> targetRequest(args, false);
                case "flowscope_browser_navigate" -> browserNavigate(args);
                case "flowscope_browser_snapshot" -> browserSnapshot();
                case "flowscope_browser_interact" -> browserInteract(args);
                case "flowscope_browser_close" -> browserClose();
                case "flowscope_submit_assessment" -> submitAssessment(args);
                case "flowscope_list_assessments" -> assessmentPage(args);
                case "flowscope_submit_validation" -> submitValidation(args);
                case "flowscope_list_validations" -> validationPage(args);
                case "flowscope_begin_llm_run" -> beginLlmRun(args);
                case "flowscope_end_run" -> endRun(args);
                case "flowscope_zap_status" -> zapStatus(args);
                case "flowscope_zap_environment" -> zapEnvironment();
                case "flowscope_zap_baseline" -> startZapBaseline(args);
                case "flowscope_zap_baseline_status" -> zapBaselineStatus();
                case "flowscope_zap_baseline_cancel" -> cancelDeterministicZapBaseline();
                case "flowscope_zap_passive_status" -> zapPassiveStatus();
                case "flowscope_zap_alerts" -> zapAlerts(args);
                case "flowscope_zap_spider" -> startZap(args, false);
                case "flowscope_zap_client_spider" -> startZapClient(args);
                case "flowscope_zap_ajax_spider" -> startZapAjax(args);
                case "flowscope_zap_active_scan" -> startZap(args, true);
                default -> throw new IllegalArgumentException("unknown tool: " + name);
            };
            return toolResult(data, false);
        } catch (Exception e) {
            ObjectNode error = json.createObjectNode().put("error", e.getMessage());
            return toolResult(error, true);
        }
    }

    private JsonNode status() {
        Pipeline.Result snapshot = lockedSnapshot == null ? state.snapshot() : lockedSnapshot;
        ObjectNode out = json.createObjectNode();
        RunContextRegistry.Context llm = state.contexts().current(Source.LLM);
        boolean independentView = lockedSnapshot == null && llm != null && llm.phase() == RunPhase.EXPLORATION;
        boolean lockedView = lockedSnapshot != null;
        List<RequestRecord> visibleRecords = independentView
                ? snapshot.records.stream().filter(record -> record.source == Source.LLM
                && llm.runId().equals(record.runId))
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY)).toList()
                : snapshot.records;
        List<RequestRecord> visibleCoverage = independentView
                ? snapshot.coverageRecords.stream().filter(record -> record.source == Source.LLM
                && llm.runId().equals(record.runId))
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY)).toList()
                : snapshot.coverageRecords;
        out.put("independent_explorer_view", independentView);
        out.put("workflow_stage", lockedSnapshot == null ? "COLLECTING" : "LOCKED");
        if (!lockId.isBlank()) out.put("lock_id", lockId);
        ObjectNode sourceCounts = out.putObject("source_counts");
        if (independentView) {
            sourceCounts.put(Source.LLM.name(), visibleRecords.size());
        } else if (lockedView) {
            for (Source source : Source.values()) {
                sourceCounts.put(source.name(), snapshot.records.stream().filter(r -> r.source == source).count());
            }
        }
        ObjectNode coverageSourceCounts = out.putObject("coverage_source_counts");
        if (independentView) {
            coverageSourceCounts.put(Source.LLM.name(), visibleCoverage.size());
        } else if (lockedView) {
            for (Source source : Source.values()) {
                coverageSourceCounts.put(source.name(), visibleCoverage.stream()
                        .filter(record -> record.source == source).count());
            }
        }
        if (independentView || lockedView) {
            out.put("captured_records", visibleRecords.size());
            out.put("coverage_records", visibleCoverage.size());
            out.put("excluded_records", visibleRecords.stream().filter(record -> record.trafficClassification.disposition()
                    == TrafficClassification.Disposition.EXCLUDE).count());
            out.put("review_records", visibleRecords.stream().filter(record -> record.trafficClassification.disposition()
                    == TrafficClassification.Disposition.REVIEW).count());
            List<RouteCandidate> visibleRoutes = independentView
                    ? explorerRoutes(snapshot, llm)
                    : lockedRouteCandidates;
            out.put("route_candidates", visibleRoutes.size());
        }
        out.putPOJO("scope", state.scope().entries());
        if (lockedView) {
            Pipeline.Result visible = analysisSnapshot();
            out.put("coverage_cells", visible.analysis.cells().size());
            out.put("gaps", visible.analysis.gaps().size());
            out.put("rule_findings", visible.analysis.findings().size());
            out.put("llm_assessments", snapshotAssessments().size());
            out.put("final_validations", snapshotValidations().size());
            out.putPOJO("completed_lanes", state.contexts().completedExplorations().stream()
                    .map(Enum::name).sorted().toList());
            ObjectNode completedRuns = out.putObject("completed_runs");
            state.contexts().completedRuns().entrySet().stream()
                    .sorted(java.util.Map.Entry.comparingByKey())
                    .forEach(entry -> {
                        RunContextRegistry.CompletedRun run = entry.getValue();
                        completedRuns.putObject(entry.getKey().name())
                                .put("run_id", run.runId())
                                .put("response_count", run.responseCount())
                                .put("coverage_count", run.coverageCount());
                    });
        }
        out.put("llm_target_proxy", "http://127.0.0.1:8082");
        out.put("llm_target_proxy_trust", ExecutionTrust.UNVERIFIED_RUNTIME.name());
        out.put("controlled_browser_available", state.browserAvailable());
        out.put("controlled_browser_evidence_policy", "DISCOVERY_THEN_REPLAY");
        out.put("scanner_target_proxy", "http://127.0.0.1:8081");
        ObjectNode activeRuns = out.putObject("active_runs");
        List<Source> visibleRunSources = lockedView ? List.of(Source.HUMAN, Source.SCANNER, Source.LLM)
                : List.of(Source.LLM);
        for (Source source : visibleRunSources) {
            RunContextRegistry.Context context = state.contexts().current(source);
            if (context != null) activeRuns.put(source.name(), context.runId());
        }
        return out;
    }

    private JsonNode lockDataset() {
        if (lockedSnapshot != null) throw new IllegalStateException("dataset is already locked");
        if (state.contexts().hasActiveRuns()) throw new IllegalStateException("end all active runs before locking");
        Map<Source, RunContextRegistry.CompletedRun> completed = state.contexts().completedRuns();
        if (!completed.keySet().containsAll(Set.of(Source.HUMAN, Source.SCANNER, Source.LLM))) {
            throw new IllegalStateException("HUMAN, SCANNER, and independent LLM exploration must all complete before lock");
        }
        Pipeline.Result snapshot = state.snapshot();
        List<String> emptyLanes = java.util.stream.Stream.of(Source.HUMAN, Source.SCANNER, Source.LLM)
                .filter(source -> !LaneCompletionPolicy.lockEligible(completed.get(source), snapshot))
                .map(Enum::name).toList();
        if (!emptyLanes.isEmpty()) {
            throw new IllegalStateException("completed lanes need trusted coverage Evidence from their exact completed run: "
                    + emptyLanes);
        }
        List<RequestRecord> selected = snapshot.records.stream().filter(record -> {
            RunContextRegistry.CompletedRun run = completed.get(record.source);
            return run != null && run.evidenceIds().contains(record.evidenceId)
                    && run.runId().equals(record.runId) && record.phase == RunPhase.EXPLORATION
                    && SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.DATASET_LOCK);
        }).toList();
        lockedSnapshot = Pipeline.runIsolated(selected, state.config());
        Set<String> selectedEvidence = lockedSnapshot.records.stream().map(record -> record.evidenceId)
                .collect(java.util.stream.Collectors.toSet());
        lockedRouteCandidates = state.routeCandidates().stream()
                .filter(candidate -> candidate.provenance().stream()
                        .anyMatch(item -> selectedEvidence.contains(item.evidenceId())))
                .toList();
        lockId = "lock-" + System.currentTimeMillis();
        return json.createObjectNode().put("lock_id", lockId).put("records", lockedSnapshot.records.size())
                .put("findings", lockedSnapshot.analysis.findings().size())
                .put("gaps", lockedSnapshot.analysis.gaps().size())
                .put("route_candidates", lockedRouteCandidates.size());
    }

    private JsonNode setScope(JsonNode args) {
        if (lockedSnapshot != null) throw new IllegalStateException("scope cannot change after dataset lock");
        if (state.contexts().current(Source.SCANNER) != null || state.contexts().current(Source.LLM) != null) {
            throw new IllegalStateException("scope cannot change during an active SCANNER or LLM run");
        }
        String value = required(args, "scope");
        ScopePolicy parsed = ScopePolicy.parse(value);
        if (parsed.isEmpty()) throw new IllegalArgumentException("scope must contain at least one exact HTTP(S) entry");
        state.updateScope(value);
        return json.createObjectNode().putPOJO("scope", state.scope().entries());
    }

    private JsonNode beginLlmRun(JsonNode args) {
        String phaseName = required(args, "phase").toUpperCase();
        SourceDetail detail;
        RunPhase phase;
        switch (phaseName) {
            case "EXPLORATION" -> { detail = SourceDetail.LLM_EXPLORER; phase = RunPhase.EXPLORATION; }
            case "COACH_PROBE" -> { requireLocked(); detail = SourceDetail.LLM_COACH_PROBE; phase = RunPhase.COACH_PROBE; }
            case "VALIDATION" -> { requireLocked(); detail = SourceDetail.LLM_VALIDATION; phase = RunPhase.VALIDATION; }
            default -> throw new IllegalArgumentException("phase must be EXPLORATION, COACH_PROBE, or VALIDATION");
        }
        String toolName = args.path("tool").asText("OTHER").toUpperCase();
        ToolKind tool = switch (toolName) {
            case "CODEX" -> ToolKind.CODEX;
            case "CLAUDE" -> ToolKind.CLAUDE;
            case "OTHER" -> ToolKind.OTHER;
            default -> throw new IllegalArgumentException("tool must be CODEX, CLAUDE, or OTHER");
        };
        String runId = validatedRunId(args.path("run_id").asText(
                "llm-" + phaseName.toLowerCase() + "-" + System.currentTimeMillis()));
        if (phase == RunPhase.EXPLORATION && lockedSnapshot != null) {
            throw new IllegalStateException("independent exploration cannot start after dataset lock");
        }
        String accountId = args.path("account_id").asText();
        if (!accountId.isBlank()) {
            SessionBroker sessions = state.sessions();
            if (sessions == null) throw new IllegalStateException("session broker is unavailable");
            SessionBroker.SessionView session = sessions.viewForAccount(accountId)
                    .orElseThrow(() -> new IllegalArgumentException("no captured session for account: " + accountId));
            if (session.status() != SessionBroker.Status.ACTIVE) {
                throw new IllegalStateException("account session is not active: " + accountId
                        + " (" + session.status() + ")");
            }
        }
        state.contexts().activate(Source.LLM,
                new RunContextRegistry.Context(detail, Orchestrator.LLM, tool, phase, runId,
                        accountId.isBlank() ? null : accountId));
        return json.createObjectNode().put("run_id", runId).put("source", Source.LLM.name())
                .put("source_detail", detail.name()).put("proxy", "http://127.0.0.1:8082")
                .put("proxy_trust", ExecutionTrust.UNVERIFIED_RUNTIME.name())
                .put("completion_requires_controlled_tools", phase == RunPhase.EXPLORATION);
    }

    private JsonNode endRun(JsonNode args) {
        String sourceName = required(args, "source").toUpperCase();
        String runId = required(args, "run_id");
        Source source = switch (sourceName) {
            case "LLM" -> Source.LLM;
            case "SCANNER" -> Source.SCANNER;
            default -> throw new IllegalArgumentException("source must be LLM or SCANNER");
        };
        RunContextRegistry.Context active = state.contexts().current(source);
        if (active == null || !runId.equals(active.runId())) {
            throw new IllegalArgumentException("run_id does not match the active " + source.name() + " run");
        }
        List<String> coverageLimitations = List.of();
        if (active.phase() == RunPhase.EXPLORATION) {
            if (source == Source.LLM && active.detail() == SourceDetail.LLM_EXPLORER) {
                coverageLimitations = assertExplorerHarnessComplete(active);
            }
            LaneCompletionPolicy.complete(state.contexts(), source, runId, state.completionSnapshot());
            explorerProgress.remove(runId);
            browserDiscoveredRoutes.remove(runId);
            explorerBrowserUsed.remove(runId);
            if (source == Source.LLM) state.browserClose(runId);
        } else if (!state.contexts().abort(source, runId)) {
            throw new IllegalStateException("run lease disappeared before completion");
        }
        ObjectNode out = json.createObjectNode().put("ended", source.name()).put("run_id", runId);
        out.set("coverage_limitations", json.valueToTree(coverageLimitations));
        out.put("completion_quality", coverageLimitations.isEmpty() ? "FRONTIERS_REVIEWED" : "PARTIAL_WITH_LIMITATIONS");
        return out;
    }

    private List<String> assertExplorerHarnessComplete(RunContextRegistry.Context explorer) {
        LaneCompletionPolicy.Decision evidence = LaneCompletionPolicy.evaluate(Source.LLM, explorer.runId(),
                state.completionSnapshot());
        if (!evidence.eligible()) throw new IllegalStateException(evidence.reason());
        ExplorerProgress progress = explorerProgress.getOrDefault(explorer.runId(),
                new ExplorerProgress(false, false));
        if (!progress.independentListed()) {
            throw new IllegalStateException("Explorer must list the INDEPENDENT route frontier before completion");
        }
        if (!progress.assistedListed()) {
            throw new IllegalStateException("Explorer must exhaust INDEPENDENT routes and review ASSISTED hints before completion");
        }
        Pipeline.Result snapshot = state.completionSnapshot();
        List<RouteCandidate> independentRoutes = explorerRoutes(snapshot, explorer);
        List<RouteCandidate> assistedRoutes = assistedExplorerRoutes(snapshot, explorer);
        List<RouteCandidate> independentRemaining = actionableRoutes(independentRoutes, snapshot, explorer);
        List<RouteCandidate> assistedRemaining = actionableRoutes(assistedRoutes, snapshot, explorer);
        int remaining = pendingConcreteCount(independentRemaining, snapshot, explorer)
                + pendingConcreteCount(assistedRemaining, snapshot, explorer);
        if (remaining > 0) {
            throw new IllegalStateException("Explorer safe concrete frontier changed and still has " + remaining
                    + " route(s); re-list and request them before completion");
        }
        List<String> limitations = new ArrayList<>();
        if (renderedDiscoveryRecommended(snapshot, explorer)
                && !explorerBrowserUsed.contains(explorer.runId())) {
            limitations.add(state.browserAvailable()
                    ? "RENDERED_DISCOVERY_NOT_USED"
                    : "SUPPORTED_BROWSER_UNAVAILABLE");
        }
        boolean unresolvedTemplate = java.util.stream.Stream.concat(independentRoutes.stream(),
                        assistedRoutes.stream())
                .anyMatch(candidate -> candidate.concretePaths().isEmpty()
                        && candidate.pathTemplate().contains("{"));
        if (unresolvedTemplate) limitations.add("DYNAMIC_TEMPLATE_WITHOUT_OBSERVED_VALUE");
        return List.copyOf(limitations);
    }

    public boolean hasExplorationResponse(Source source, String runId) {
        return LaneCompletionPolicy.evaluate(source, runId, state.completionSnapshot()).eligible();
    }

    private JsonNode candidates(JsonNode args) {
        requireLocked();
        Pipeline.Result snapshot = analysisSnapshot();
        ObjectNode out = json.createObjectNode();
        out.set("findings", json.valueToTree(page(snapshot.analysis.findings(), args)));
        out.set("gaps", json.valueToTree(page(snapshot.analysis.gaps(), args)));
        out.put("total_findings", snapshot.analysis.findings().size());
        out.put("total_gaps", snapshot.analysis.gaps().size());
        return out;
    }

    private JsonNode routeCandidates(JsonNode args) {
        RunContextRegistry.Context explorer = independentExplorer();
        List<RouteCandidate> visible;
        Pipeline.Result explorerSnapshot = null;
        boolean assisted = false;
        if (explorer != null) {
            String view = args.path("view").asText("INDEPENDENT").toUpperCase(java.util.Locale.ROOT);
            if (!Set.of("INDEPENDENT", "ASSISTED").contains(view)) {
                throw new IllegalArgumentException("view must be INDEPENDENT or ASSISTED");
            }
            Pipeline.Result snapshot = state.snapshot();
            explorerSnapshot = snapshot;
            explorerProgress.keySet().removeIf(runId -> !runId.equals(explorer.runId()));
            ExplorerProgress progress = explorerProgress.getOrDefault(explorer.runId(),
                    new ExplorerProgress(false, false));
            if ("ASSISTED".equals(view)) {
                if (!progress.independentListed()) {
                    throw new IllegalStateException("list and exhaust the INDEPENDENT frontier before ASSISTED hints");
                }
                List<RouteCandidate> remaining = actionableRoutes(explorerRoutes(snapshot, explorer), snapshot, explorer);
                if (!remaining.isEmpty()) {
                    throw new IllegalStateException("independent safe frontier still has " + remaining.size()
                            + " concrete route(s); request them before ASSISTED hints");
                }
                if (!LaneCompletionPolicy.evaluate(Source.LLM, explorer.runId(), state.completionSnapshot()).eligible()) {
                    throw new IllegalStateException("capture at least one controlled Explorer response before ASSISTED hints");
                }
                visible = assistedExplorerRoutes(snapshot, explorer);
                assisted = true;
                explorerProgress.put(explorer.runId(), progress.markAssisted());
            } else {
                visible = explorerRoutes(snapshot, explorer);
                explorerProgress.put(explorer.runId(), progress.markIndependent());
            }
        } else {
            requireLocked();
            visible = lockedRouteCandidates;
        }
        int offset = Math.max(0, args.path("offset").asInt(0));
        int limit = Math.max(1, Math.min(200, args.path("limit").asInt(100)));
        int end = Math.min(visible.size(), offset + limit);
        ObjectNode out = json.createObjectNode();
        out.put("total", visible.size());
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("has_more", end < visible.size());
        out.put("view", assisted ? "ASSISTED" : explorer == null ? "LOCKED" : "INDEPENDENT");
        if (explorer != null) {
            List<RouteCandidate> actionable = actionableRoutes(visible, explorerSnapshot, explorer);
            out.put("remaining_safe_concrete", pendingConcreteCount(actionable, explorerSnapshot, explorer));
            out.put("provenance_redacted", assisted);
            addExplorerGuidance(out, explorer, explorerSnapshot, visible, assisted);
        }
        ArrayNode routes = out.putArray("routes");
        if (offset < visible.size()) for (RouteCandidate candidate : visible.subList(offset, end)) {
            ObjectNode route = routes.addObject();
            route.put("service", candidate.service());
            route.put("method", candidate.method());
            route.put("path_template", candidate.pathTemplate());
            route.set("concrete_paths", json.valueToTree(candidate.concretePaths()));
            route.put("concrete_paths_truncated", candidate.concretePathsTruncated());
            if (explorer != null) {
                route.set("pending_concrete_paths", json.valueToTree(
                        pendingConcretePaths(candidate, explorerSnapshot, explorer)));
                route.set("review_dimensions", json.valueToTree(reviewDimensions(candidate)));
            }
            route.put("observed", candidate.observed());
            route.put("applicability", candidate.applicability().name());
            route.put("review_reason", candidate.reviewReason());
            route.put("evidence_backed", candidate.provenance().stream().anyMatch(item ->
                    item.type() != RouteCandidate.ProvenanceType.BROWSER_RUNTIME));
            route.set("priority_reasons", json.valueToTree(RouteCandidateExtractor.priorityReasons(candidate)));
            ArrayNode provenance = route.putArray("provenance");
            for (RouteCandidate.Provenance item : assisted ? List.<RouteCandidate.Provenance>of()
                    : candidate.provenance()) {
                ObjectNode entry = provenance.addObject();
                entry.put("type", item.type().name());
                entry.put("evidence_id", item.evidenceId());
                entry.put("evidence_backed", item.type() != RouteCandidate.ProvenanceType.BROWSER_RUNTIME);
                entry.put("source", item.source().name());
                entry.put("run_id", item.runId());
                entry.put("adapter", item.adapter());
                entry.put("applicability", item.applicability().name());
                entry.put("reason", item.reason());
            }
            if (assisted) route.put("hint_origin", "BLIND_CROSS_LANE");
        }
        return out;
    }

    private JsonNode evidence(String evidenceId) {
        if (evidenceId == null || evidenceId.isBlank()) throw new IllegalArgumentException("evidence_id is required");
        RequestRecord record = state.snapshot().records.stream().filter(r -> evidenceId.equals(r.evidenceId))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("unknown evidence_id"));
        assertEvidenceVisible(record);
        ObjectNode out = json.createObjectNode();
        out.put("evidence_id", record.evidenceId);
        out.put("source", record.source.name());
        out.put("source_detail", record.sourceDetail.name());
        out.put("orchestrator", record.orchestrator.name());
        out.put("tool", record.tool.name());
        out.put("phase", record.phase.name());
        out.put("execution_trust", record.executionTrust.name());
        out.put("run_id", record.runId);
        out.put("auth_state", record.authState.name());
        out.put("traffic_class", record.trafficClassification.trafficClass().name());
        out.put("traffic_disposition", record.trafficClassification.disposition().name());
        out.put("coverage_eligible", record.trafficClassification.coverageEligible());
        out.set("classification_reasons", json.valueToTree(record.trafficClassification.reasons()));
        out.put("identity", record.idn);
        out.put("operation", record.op);
        out.put("resource", record.resource);
        out.put("status", record.status);
        out.put("request", Masking.maskHeaders(record.requestTextForEvidence()));
        String response = record.responseTextForEvidence() != null
                ? record.responseTextForEvidence() : record.responseBodyForAnalysis();
        out.put("response", Masking.maskHeaders(Masking.maskSecrets(response)));
        return out;
    }

    private JsonNode listEvidence(JsonNode args) {
        String runId = args.path("run_id").asText();
        String source = args.path("source").asText();
        String phase = args.path("phase").asText();
        RunContextRegistry.Context active = independentExplorer();
        if (active != null) {
            if ((!runId.isBlank() && !runId.equals(active.runId()))
                    || (!source.isBlank() && !source.equalsIgnoreCase(Source.LLM.name()))) {
                throw new IllegalArgumentException("independent Explorer may read only its own run Evidence");
            }
            runId = active.runId();
            source = Source.LLM.name();
        } else {
            requireLocked();
        }
        String selectedRunId = runId;
        String selectedSource = source;
        List<RequestRecord> matching = state.snapshot().records.stream()
                .filter(record -> selectedRunId.isBlank() || selectedRunId.equals(record.runId))
                .filter(record -> selectedSource.isBlank() || selectedSource.equalsIgnoreCase(record.source.name()))
                .filter(record -> phase.isBlank() || phase.equalsIgnoreCase(record.phase.name()))
                .filter(record -> active == null
                        || SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY))
                .toList();
        int offset = Math.max(0, args.path("offset").asInt(0));
        int limit = Math.max(1, Math.min(200, args.path("limit").asInt(100)));
        int end = Math.min(matching.size(), offset + limit);
        ObjectNode out = json.createObjectNode();
        out.put("total", matching.size());
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("has_more", end < matching.size());
        ArrayNode records = out.putArray("records");
        if (offset < matching.size()) for (RequestRecord record : matching.subList(offset, end)) {
            ObjectNode value = records.addObject();
            value.put("evidence_id", record.evidenceId);
            value.put("source", record.source.name());
            value.put("source_detail", record.sourceDetail.name());
            value.put("phase", record.phase.name());
            value.put("execution_trust", record.executionTrust.name());
            value.put("run_id", record.runId);
            value.put("identity", record.idn);
            value.put("operation", record.op);
            if (record.resource == null) value.putNull("resource"); else value.put("resource", record.resource);
            value.put("status", record.status);
            value.put("timestamp", record.timestamp);
            value.put("has_response", record.hasResponse);
            value.put("auth_state", record.authState.name());
            value.put("traffic_class", record.trafficClassification.trafficClass().name());
            value.put("traffic_disposition", record.trafficClassification.disposition().name());
            value.put("coverage_eligible", record.trafficClassification.coverageEligible());
            value.set("classification_reasons", json.valueToTree(record.trafficClassification.reasons()));
            value.put("path_template_status", record.pathTemplateStatus.name());
            value.set("path_template_reasons", json.valueToTree(record.pathTemplateReasons));
        }
        return out;
    }

    private JsonNode targetRequest(JsonNode args, boolean safeRead) {
        RunContextRegistry.Context context = state.contexts().current(Source.LLM);
        if (context == null) throw new IllegalStateException("begin an LLM run before target requests");
        String method = required(args, "method").toUpperCase(java.util.Locale.ROOT);
        Set<String> allowedMethods = safeRead ? Set.of("GET", "HEAD", "OPTIONS")
                : Set.of("POST", "PUT", "PATCH", "DELETE");
        if (!allowedMethods.contains(method)) throw new IllegalArgumentException(safeRead
                ? "flowscope_target_read allows only GET, HEAD, or OPTIONS"
                : "flowscope_target_request allows only POST, PUT, PATCH, or DELETE");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        if (!safeRead && (!args.path("confirmed").asBoolean(false)
                || !state.approve("LLM state-changing request", target))) {
            throw new IllegalArgumentException("state-changing request approval denied");
        }
        Map<String, String> headers = new java.util.LinkedHashMap<>();
        JsonNode suppliedHeaders = args.path("headers");
        if (suppliedHeaders.isObject()) suppliedHeaders.properties().forEach(entry -> {
            String name = entry.getKey();
            String value = entry.getValue().asText();
            if (!name.matches("[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}") || value.length() > 2_000
                    || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0
                    || Set.of("authorization", "cookie", "proxy-authorization", "host", "content-length", "connection")
                    .contains(name.toLowerCase(java.util.Locale.ROOT))) {
                throw new IllegalArgumentException("unsafe or broker-owned request header: " + name);
            }
            headers.put(name, value);
        });
        String body = args.path("body").isMissingNode() || args.path("body").isNull()
                ? null : args.path("body").asText();
        if (body != null && body.length() > 64 * 1024) throw new IllegalArgumentException("request body exceeds 64 KiB");
        String accountId = args.path("account_id").asText();
        if (context.phase() == RunPhase.EXPLORATION && context.detail() == SourceDetail.LLM_EXPLORER) {
            if (!accountId.isBlank() && !java.util.Objects.equals(accountId, context.accountId())) {
                throw new IllegalArgumentException("Explorer account is fixed by the active run");
            }
            accountId = context.accountId();
        } else if (accountId.isBlank()) {
            accountId = context.accountId();
        }
        accountId = validatedAccountForTarget(accountId, target);
        TargetResult result = state.targetRequest(new TargetRequest(method, target, Map.copyOf(headers), body,
                accountId == null || accountId.isBlank() ? null : accountId));
        ObjectNode out = json.createObjectNode();
        out.put("evidence_id", result.evidenceId());
        out.put("status", result.status());
        if (result.location() == null) out.putNull("location"); else out.put("location", result.location());
        out.put("response", Masking.maskHeaders(Masking.maskSecrets(result.response())));
        out.put("response_body", Masking.maskSecrets(result.responseBody()));
        out.put("execution_trust", ExecutionTrust.CONTROLLED.name());
        return out;
    }

    private JsonNode browserNavigate(JsonNode args) throws Exception {
        RunContextRegistry.Context context = requireExplorerContext();
        String target = required(args, "target");
        if (!state.scope().allows(target)) {
            throw new IllegalArgumentException("browser target is outside configured exact scope");
        }
        String accountId = context.accountId();
        accountId = validatedAccountForTarget(accountId, target);
        return browserNode(state.browserNavigate(context.runId(), target, accountId));
    }

    private JsonNode browserSnapshot() throws Exception {
        RunContextRegistry.Context context = requireExplorerContext();
        return browserNode(state.browserSnapshot(context.runId()));
    }

    private JsonNode browserInteract(JsonNode args) throws Exception {
        RunContextRegistry.Context context = requireExplorerContext();
        String action = required(args, "action").toUpperCase(java.util.Locale.ROOT);
        String selector = required(args, "selector");
        if (!args.path("confirmed").asBoolean(false)) {
            throw new IllegalArgumentException("browser interaction requires confirmed=true");
        }
        String value = args.path("value").isMissingNode() || args.path("value").isNull()
                ? null : args.path("value").asText();
        return browserNode(state.browserInteract(context.runId(), action, selector, value));
    }

    private JsonNode browserClose() {
        RunContextRegistry.Context context = requireExplorerContext();
        state.browserClose(context.runId());
        return json.createObjectNode().put("closed", true).put("run_id", context.runId());
    }

    private RunContextRegistry.Context requireExplorerContext() {
        RunContextRegistry.Context context = state.contexts().current(Source.LLM);
        if (context == null || context.phase() != RunPhase.EXPLORATION
                || context.detail() != SourceDetail.LLM_EXPLORER) {
            throw new IllegalStateException("an LLM Explorer run must be active");
        }
        return context;
    }

    private ObjectNode browserNode(ControlledBrowserExplorer.Snapshot snapshot) {
        if (snapshot != null && snapshot.runId() != null && !snapshot.runId().isBlank()) {
            explorerBrowserUsed.add(snapshot.runId());
        }
        registerBrowserRoutes(snapshot);
        ObjectNode out = json.valueToTree(snapshot);
        out.put("evidence_status", "DISCOVERY_ONLY");
        out.put("evidence_instruction", "Replay relevant exact-scope requests with flowscope_target_read/request");
        return out;
    }

    private void registerBrowserRoutes(ControlledBrowserExplorer.Snapshot snapshot) {
        if (snapshot == null || snapshot.runId() == null || snapshot.runId().isBlank()) return;
        List<RouteCandidate> discovered = new ArrayList<>();
        for (ControlledBrowserExplorer.Route route : snapshot.network()) {
            try {
                URI uri = URI.create(route.url());
                if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null) continue;
                int port = uri.getPort() >= 0 ? uri.getPort()
                        : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
                String service = uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://"
                        + uri.getHost().toLowerCase(java.util.Locale.ROOT) + ":" + port;
                String path = uri.getRawPath();
                if (path == null || path.isBlank()) path = "/";
                if (uri.getRawQuery() != null && !uri.getRawQuery().isBlank()) {
                    path += "?" + uri.getRawQuery();
                }
                String method = route.method() == null || route.method().isBlank()
                        ? "UNKNOWN" : route.method().toUpperCase(java.util.Locale.ROOT);
                String material = snapshot.runId() + "\n" + method + "\n" + service + "\n" + path;
                String artifactId = "browser-discovery-" + shortDigest(material);
                RouteCandidate.Provenance provenance = new RouteCandidate.Provenance(
                        RouteCandidate.ProvenanceType.BROWSER_RUNTIME, artifactId, Source.LLM,
                        snapshot.runId(), "CHROME_CDP", RouteCandidate.Applicability.APPLICABLE,
                        "브라우저 런타임에서 관측; controlled HTTP 재현 전에는 Evidence가 아님");
                discovered.add(new RouteCandidate(service, method, path, false, List.of(provenance),
                        RouteCandidate.Applicability.APPLICABLE,
                        "브라우저 런타임 경로 — flowscope_target_read/request 재현 필요"));
            } catch (IllegalArgumentException ignored) {
                // 마스킹 또는 손상된 URL은 실행 frontier에 넣지 않는다.
            }
        }
        browserDiscoveredRoutes.merge(snapshot.runId(), RouteCandidateExtractor.prioritized(discovered),
                (left, right) -> RouteCandidateExtractor.prioritized(
                        java.util.stream.Stream.concat(left.stream(), right.stream()).toList()));
    }

    private static String shortDigest(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest, 0, 12);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private JsonNode listSessions() {
        ArrayNode out = json.createArrayNode();
        SessionBroker broker = state.sessions();
        if (broker == null) return out;
        for (SessionBroker.SessionView session : broker.views()) {
            ObjectNode value = out.addObject();
            value.put("account_id", session.accountId());
            value.put("account_label", session.accountLabel());
            value.put("service", session.service());
            value.put("role", state.config().identityRole(session.accountId()).name());
            value.put("status", session.status().name());
            value.put("capturing", session.capturing());
            value.put("has_authorization", session.hasAuthorization());
            value.put("cookie_count", session.cookieCount());
            if (session.expiresAtHint() == null) value.putNull("expires_at_hint");
            else value.put("expires_at_hint", session.expiresAtHint().toString());
        }
        return out;
    }

    private JsonNode submitAssessment(JsonNode args) {
        requireLocked();
        String verdict = required(args, "verdict").toUpperCase();
        if (!Set.of("LIKELY", "INCONCLUSIVE", "REJECTED").contains(verdict)) {
            throw new IllegalArgumentException("verdict must be LIKELY, INCONCLUSIVE, or REJECTED; LLM cannot CONFIRM");
        }
        List<String> ids = new ArrayList<>();
        args.path("evidence_ids").forEach(node -> ids.add(node.asText()));
        if (ids.isEmpty()) throw new IllegalArgumentException("evidence_ids is required");
        Set<String> existing = new LinkedHashSet<>();
        state.snapshot().records.forEach(r -> existing.add(r.evidenceId));
        if (!existing.containsAll(ids)) throw new IllegalArgumentException("one or more evidence_ids do not exist");
        Assessment assessment = new Assessment("assessment-" + System.nanoTime(), required(args, "type"), verdict,
                required(args, "title"), required(args, "reason"), List.copyOf(ids), Instant.now());
        List<Assessment> updated;
        synchronized (assessments) {
            if (assessments.size() >= MAX_ASSESSMENTS) throw new IllegalStateException("assessment limit reached");
            if (assessmentRetainedBytes(assessments) + assessmentRetainedBytes(assessment)
                    > MAX_ASSESSMENT_RETAINED_BYTES) {
                throw new IllegalStateException("assessment retained-byte limit reached");
            }
            assessments.add(assessment);
            updated = List.copyOf(assessments);
        }
        state.assessmentsChanged(updated);
        return assessmentNode(assessment);
    }

    private JsonNode submitValidation(JsonNode args) {
        requireLocked();
        String candidateId = required(args, "candidate_id");
        ValidationDecision.FinalVerdict verdict;
        try { verdict = ValidationDecision.FinalVerdict.valueOf(required(args, "verdict").toUpperCase()); }
        catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("verdict must be CONFIRMED, INCONCLUSIVE, or REJECTED");
        }
        List<String> originals = evidenceIds(args, "original_evidence_ids");
        List<String> probes = evidenceIds(args, "validation_evidence_ids");
        List<String> controls = evidenceIds(args, "control_evidence_ids");
        String runId = validateEvidenceBundle(candidateId, verdict, originals, probes, controls);
        ValidationDecision decision = new ValidationDecision(candidateId, verdict,
                required(args, "reason"), originals, probes, controls, runId, Instant.now());
        synchronized (validations) {
            validations.removeIf(value -> value.candidateId().equals(candidateId));
            if (validations.size() >= 1_000) throw new IllegalStateException("validation limit reached");
            validations.add(decision);
        }
        state.validationsChanged(snapshotValidations());
        return validationNode(decision);
    }

    private String validateEvidenceBundle(String candidateId, ValidationDecision.FinalVerdict verdict,
                                          List<String> originals, List<String> probes, List<String> controls) {
        Pipeline.Result candidateSnapshot = analysisSnapshot();
        AuthorizationAnalysis.Finding candidate = candidateSnapshot.analysis.findings().stream()
                .filter(finding -> finding.id().equals(candidateId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown or no-longer-suspicious candidate_id"));
        if (originals.isEmpty()) throw new IllegalArgumentException("original_evidence_ids is required");
        Map<String, RequestRecord> byId = new java.util.LinkedHashMap<>();
        state.snapshot().records.forEach(record -> byId.put(record.evidenceId, record));
        List<String> allIds = new ArrayList<>();
        allIds.addAll(originals); allIds.addAll(probes); allIds.addAll(controls);
        if (new LinkedHashSet<>(allIds).size() != allIds.size()) {
            throw new IllegalArgumentException("Evidence IDs must be unique and disjoint across bundle sections");
        }
        if (!byId.keySet().containsAll(allIds)) throw new IllegalArgumentException("one or more evidence_ids do not exist");
        if (!candidate.evidenceIds().containsAll(originals)) {
            throw new IllegalArgumentException("original Evidence does not belong to the current candidate");
        }
        if (originals.stream().map(byId::get).noneMatch(record -> record.phase != RunPhase.VALIDATION)) {
            throw new IllegalArgumentException("original Evidence must include a pre-validation observation");
        }
        if (originals.stream().map(byId::get).anyMatch(record -> !sameCell(record, candidate.cell()))) {
            throw new IllegalArgumentException("original Evidence does not match candidate identity/operation/resource");
        }

        String runId = "";
        if (!probes.isEmpty() || !controls.isEmpty()) {
            List<RequestRecord> captured = new ArrayList<>();
            probes.stream().map(byId::get).forEach(captured::add);
            controls.stream().map(byId::get).forEach(captured::add);
            if (captured.stream().anyMatch(record -> record.source != Source.LLM
                    || record.sourceDetail != SourceDetail.LLM_VALIDATION
                    || record.phase != RunPhase.VALIDATION || !record.hasResponse
                    || record.runId == null || record.runId.isBlank() || "default".equals(record.runId))) {
                throw new IllegalArgumentException("validation/control Evidence must be captured LLM VALIDATION traffic with responses");
            }
            Set<String> runIds = new LinkedHashSet<>();
            captured.forEach(record -> runIds.add(record.runId));
            if (runIds.size() != 1) throw new IllegalArgumentException("validation/control Evidence must belong to one run_id");
            runId = runIds.iterator().next();
        }

        if (verdict != ValidationDecision.FinalVerdict.INCONCLUSIVE) {
            List<RequestRecord> decisive = new ArrayList<>();
            probes.stream().map(byId::get).forEach(decisive::add);
            controls.stream().map(byId::get).forEach(decisive::add);
            if (decisive.stream().anyMatch(record -> !SourceTrustPolicy.allows(
                    record, SourceTrustPolicy.Use.DECISIVE_VERDICT))) {
                throw new IllegalArgumentException("decisive verdict requires FlowScope-controlled target requests");
            }
            validateDecisiveBundle(candidate, verdict, probes.stream().map(byId::get).toList(),
                    controls.stream().map(byId::get).toList());
        }
        return runId;
    }

    private void validateDecisiveBundle(AuthorizationAnalysis.Finding candidate,
                                        ValidationDecision.FinalVerdict submitted,
                                        List<RequestRecord> probes, List<RequestRecord> controls) {
        if (!"GET".equals(operationMethod(candidate.cell().operation()))) {
            throw new IllegalArgumentException("beta final validation is limited to safe GET operations; use INCONCLUSIVE");
        }
        if (probes.size() < 2 || controls.isEmpty()) {
            throw new IllegalArgumentException("decisive verdict requires at least two reproductions and one control");
        }
        if (probes.stream().anyMatch(record -> !sameCell(record, candidate.cell()))) {
            throw new IllegalArgumentException("validation Evidence does not match candidate identity/operation/resource");
        }
        Pipeline.Result snapshot = analysisSnapshot();
        AuthorizationAnalysis.OwnerInfo owner = candidate.cell().resource() == null ? null
                : snapshot.analysis.owners().get(candidate.cell().resource());
        if (candidate.type() == AuthorizationAnalysis.FindingType.BOLA
                && (owner == null || !owner.confirmed() || owner.identity() == null)) {
            throw new IllegalArgumentException("BOLA decisive verdict requires a confirmed owner");
        }
        for (RequestRecord control : controls) {
            if (!java.util.Objects.equals(control.op, candidate.cell().operation())
                    || !java.util.Objects.equals(control.resource, candidate.cell().resource())) {
                throw new IllegalArgumentException("control Evidence must target the same operation/resource");
            }
            if (candidate.type() == AuthorizationAnalysis.FindingType.BOLA) {
                if (!owner.identity().equals(control.idn)) {
                    throw new IllegalArgumentException("BOLA control must use the confirmed owner identity");
                }
                if (!ResponseEvidence.successful(control)
                        || !ResponseEvidence.showsObject(control.responseBodyForAnalysis(),
                        control.resource, owner.identity())) {
                    throw new IllegalArgumentException("BOLA control must successfully return the owned object");
                }
            } else {
                AccessRole required = state.config().endpointRequirement(candidate.cell().operation());
                if (!state.config().identityRole(control.idn).isKnownAndAtLeast(required)
                        || !ResponseEvidence.successful(control)) {
                    throw new IllegalArgumentException("BFLA control must use an authorized identity and succeed");
                }
            }
        }
        ValidationDecision.FinalVerdict requested = probes.stream().allMatch(ResponseEvidence::denied)
                ? ValidationDecision.FinalVerdict.REJECTED : ValidationDecision.FinalVerdict.CONFIRMED;
        if (candidate.type() == AuthorizationAnalysis.FindingType.BOLA && requested == ValidationDecision.FinalVerdict.CONFIRMED
                && probes.stream().anyMatch(record -> !ResponseEvidence.successful(record)
                || !ResponseEvidence.showsObject(record.responseBodyForAnalysis(),
                record.resource, owner.identity()))) {
            throw new IllegalArgumentException("BOLA reproductions must successfully return the foreign object");
        }
        if (candidate.type() == AuthorizationAnalysis.FindingType.BFLA && requested == ValidationDecision.FinalVerdict.CONFIRMED
                && probes.stream().anyMatch(record -> !ResponseEvidence.successful(record))) {
            throw new IllegalArgumentException("BFLA reproductions must all succeed");
        }
        if (requested == ValidationDecision.FinalVerdict.REJECTED
                && probes.stream().anyMatch(record -> !ResponseEvidence.denied(record))) {
            throw new IllegalArgumentException("REJECTED reproductions must all be explicit denials");
        }
        if (submitted != requested) {
            throw new IllegalArgumentException("submitted verdict conflicts with captured validation responses");
        }
    }

    private static boolean sameCell(RequestRecord record, AuthorizationAnalysis.CellKey cell) {
        return record != null && java.util.Objects.equals(record.idn, cell.identity())
                && java.util.Objects.equals(record.op, cell.operation())
                && java.util.Objects.equals(record.resource, cell.resource());
    }

    private static String operationMethod(String operation) {
        if (operation == null) return "";
        String value = operation;
        if (value.startsWith("http://") || value.startsWith("https://")) {
            int separator = value.indexOf(' ');
            value = separator < 0 ? value : value.substring(separator + 1);
        }
        int separator = value.indexOf(' ');
        return (separator < 0 ? value : value.substring(0, separator)).toUpperCase(java.util.Locale.ROOT);
    }

    private static List<String> evidenceIds(JsonNode args, String field) {
        JsonNode values = args.path(field);
        if (!values.isArray()) return List.of();
        List<String> result = new ArrayList<>();
        for (JsonNode value : values) {
            if (!value.isTextual() || value.asText().isBlank()) {
                throw new IllegalArgumentException(field + " must contain non-empty strings");
            }
            result.add(value.asText());
        }
        return List.copyOf(result);
    }

    private JsonNode zapStatus(JsonNode args) {
        rejectIndependentExplorer("ZAP state");
        String scanType = args.path("scan_type").asText();
        String scanId = args.path("scan_id").asText();
        String raw;
        if (scanType.equalsIgnoreCase("ajax")) raw = state.zap().ajaxSpiderStatus();
        else if (scanId.isBlank()) raw = state.zap().version();
        else if (scanType.equalsIgnoreCase("spider")) raw = state.zap().spiderStatus(scanId);
        else if (scanType.equalsIgnoreCase("client")) raw = state.zap().clientSpiderStatus(scanId);
        else if (scanType.equalsIgnoreCase("active")) raw = state.zap().activeScanStatus(scanId);
        else throw new IllegalArgumentException("scan_type must be spider, client, ajax, or active");
        JsonNode result = parseZap(raw);
        RunContextRegistry.Context context = state.contexts().current(Source.SCANNER);
        boolean matchingContext = context != null && switch (scanType.toLowerCase()) {
            case "ajax" -> context.detail() == SourceDetail.ZAP_AJAX_SPIDER;
            case "spider" -> context.detail() == SourceDetail.ZAP_SPIDER;
            case "client" -> context.detail() == SourceDetail.ZAP_CLIENT_SPIDER;
            case "active" -> context.detail() == SourceDetail.ZAP_ACTIVE_SCAN;
            default -> false;
        };
        if (matchingContext && scanType.equalsIgnoreCase("ajax") && result instanceof ObjectNode object) {
            long captured = state.snapshot().records.stream()
                    .filter(record -> record.source == Source.SCANNER && context.runId().equals(record.runId))
                    .count();
            object.put("run_id", context.runId());
            object.put("captured_records", captured);
            if ("stopped".equalsIgnoreCase(result.path("status").asText()) && captured == 0) {
                object.put("warning_code", "NO_SCANNER_TRAFFIC_CAPTURED");
                object.put("warning", "AJAX Spider stopped without captured in-scope traffic; check ZAP Selenium "
                        + "browser/driver compatibility and proxy routing");
            }
        }
        String status = findStatus(result);
        if (matchingContext && ("100".equals(status) || "stopped".equalsIgnoreCase(status)
                || "finished".equalsIgnoreCase(status) || "complete".equalsIgnoreCase(status))) {
            try {
                LaneCompletionPolicy.complete(state.contexts(), Source.SCANNER, context.runId(),
                        state.completionSnapshot());
            } catch (RuntimeException error) {
                state.contexts().abort(Source.SCANNER, context.runId());
                if (result instanceof ObjectNode object && !object.has("warning_code")) {
                    object.put("warning_code", "SCANNER_RUN_NOT_COMPLETABLE");
                    object.put("warning", error.getMessage());
                }
            }
        }
        return result;
    }

    private JsonNode zapEnvironment() {
        rejectIndependentExplorer("ZAP environment");
        ObjectNode out = json.createObjectNode();
        out.set("version", parseZap(state.zap().version()));
        out.set("installed_addons", parseZap(state.zap().installedAddons()));
        return out;
    }

    private synchronized JsonNode startZapBaseline(JsonNode args) {
        rejectIndependentExplorer("ZAP baseline");
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
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
        requireZapOk(state.zap().addRequestHeaderRule(description, ZapClient.exactSubtreeRegex(target),
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

    private JsonNode zapBaselineStatus() {
        rejectIndependentExplorer("ZAP baseline state");
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

    private JsonNode zapPassiveStatus() {
        rejectIndependentExplorer("ZAP passive state");
        ObjectNode out = json.createObjectNode();
        out.set("queue", parseZap(state.zap().passiveRecordsToScan()));
        out.set("tasks", parseZap(state.zap().passiveTasks()));
        return out;
    }

    private JsonNode zapAlerts(JsonNode args) {
        requireLocked();
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        int start = Math.max(0, args.path("start").asInt(0));
        int count = Math.max(1, Math.min(500, args.path("count").asInt(100)));
        ZapBaselineRun baseline = zapBaseline;
        ArrayNode stored = zapBaselineAlerts;
        if (baseline != null && ("COMPLETED".equals(baseline.status())
                || "COMPLETED_WITH_WARNINGS".equals(baseline.status())) && target.equals(baseline.target())
                && stored != null) {
            ObjectNode out = json.createObjectNode();
            ArrayNode page = out.putArray("alerts");
            int end = Math.min(stored.size(), start + count);
            if (start < stored.size()) for (int i = start; i < end; i++) page.add(stored.get(i).deepCopy());
            out.put("source", "BASELINE_SNAPSHOT");
            out.put("returned", page.size());
            out.put("has_more", end < stored.size());
            out.put("snapshot_limit", MAX_ZAP_ALERT_SNAPSHOT);
            return out;
        }
        return maskTextValues(parseZap(state.zap().alerts(target, start, count)));
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

    private JsonNode startZap(JsonNode args, boolean active) {
        rejectIndependentExplorer("ZAP execution");
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        verifySafeZapEnvironment(List.of());
        if (active && (!args.path("confirmed").asBoolean(false) || !state.approve("ZAP Active Scan", target))) {
            throw new IllegalArgumentException("active scan approval denied");
        }
        String runId = validatedRunId(args.path("run_id").asText(
                (active ? "zap-active-" : "zap-spider-") + System.currentTimeMillis()));
        String accountId = validatedAccountForTarget(args.path("account_id").asText(), target);
        SourceDetail detail = active ? SourceDetail.ZAP_ACTIVE_SCAN : SourceDetail.ZAP_SPIDER;
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(detail, Orchestrator.LLM,
                ToolKind.ZAP, RunPhase.EXPLORATION, runId, accountId));
        try {
            configureExactZapContext(target, runId);
            JsonNode response = parseZap(active ? state.zap().activeScan(target) : state.zap().spider(target));
            if (response.path("scan").asText().isBlank()) {
                throw new IllegalStateException("ZAP did not return a scan id");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().abort(Source.SCANNER, runId);
            throw error;
        }
    }

    private JsonNode startZapAjax(JsonNode args) {
        rejectIndependentExplorer("ZAP execution");
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        verifySafeZapEnvironment(List.of());
        String runId = validatedRunId(args.path("run_id").asText("zap-ajax-" + System.currentTimeMillis()));
        String accountId = validatedAccountForTarget(args.path("account_id").asText(), target);
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_AJAX_SPIDER,
                Orchestrator.LLM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, accountId));
        try {
            String contextName = configureExactZapContext(target, runId);
            JsonNode response = parseZap(state.zap().ajaxSpider(target, contextName));
            if (!"OK".equalsIgnoreCase(response.path("Result").asText())) {
                throw new IllegalStateException("ZAP AJAX Spider did not start");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().abort(Source.SCANNER, runId);
            throw error;
        }
    }

    private JsonNode startZapClient(JsonNode args) {
        rejectIndependentExplorer("ZAP execution");
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        verifySafeZapEnvironment(List.of());
        String runId = validatedRunId(args.path("run_id").asText("zap-client-" + System.currentTimeMillis()));
        String accountId = validatedAccountForTarget(args.path("account_id").asText(), target);
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_CLIENT_SPIDER,
                Orchestrator.LLM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, accountId));
        try {
            String contextName = configureExactZapContext(target, runId);
            JsonNode response = parseZap(state.zap().clientSpider(target, contextName));
            if (response.path("scan").asText().isBlank()) {
                throw new IllegalStateException("ZAP Client Spider did not return a scan id");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().abort(Source.SCANNER, runId);
            throw error;
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

    private List<Assessment> snapshotAssessments() {
        synchronized (assessments) { return List.copyOf(assessments); }
    }

    private ArrayNode assessmentPage(JsonNode args) {
        requireLocked();
        ArrayNode out = json.createArrayNode();
        for (Assessment value : page(snapshotAssessments(), args)) out.add(assessmentNode(value));
        return out;
    }

    private ObjectNode assessmentNode(Assessment value) {
        ObjectNode out = json.createObjectNode();
        out.put("id", value.id());
        out.put("type", value.type());
        out.put("verdict", value.verdict());
        out.put("title", value.title());
        out.put("reason", value.reason());
        out.set("evidence_ids", json.valueToTree(value.evidenceIds()));
        out.put("created_at", value.createdAt().toString());
        return out;
    }

    private List<ValidationDecision> snapshotValidations() {
        synchronized (validations) { return List.copyOf(validations); }
    }

    private ArrayNode validationPage(JsonNode args) {
        requireLocked();
        ArrayNode out = json.createArrayNode();
        for (ValidationDecision value : page(snapshotValidations(), args)) out.add(validationNode(value));
        return out;
    }

    private ObjectNode validationNode(ValidationDecision value) {
        ObjectNode out = json.createObjectNode();
        out.put("candidate_id", value.candidateId());
        out.put("verdict", value.verdict().name());
        out.put("reason", value.reason());
        out.set("original_evidence_ids", json.valueToTree(value.originalEvidenceIds()));
        out.set("validation_evidence_ids", json.valueToTree(value.validationEvidenceIds()));
        out.set("control_evidence_ids", json.valueToTree(value.controlEvidenceIds()));
        out.put("run_id", value.runId());
        out.put("decided_at", value.decidedAt().toString());
        return out;
    }

    private ObjectNode toolResult(JsonNode data, boolean isError) {
        ObjectNode result = json.createObjectNode();
        result.put("isError", isError);
        result.set("structuredContent", data);
        result.putArray("content").addObject().put("type", "text").put("text", data.toString());
        return result;
    }

    private ObjectNode tool(String name, String description, ObjectNode schema,
                            boolean readOnly, boolean destructive) {
        ObjectNode value = json.createObjectNode().put("name", name).put("description", description);
        value.set("inputSchema", schema);
        value.putObject("annotations").put("readOnlyHint", readOnly)
                .put("destructiveHint", destructive).put("openWorldHint", false);
        return value;
    }

    private ObjectNode schema() {
        return json.createObjectNode().put("type", "object").set("properties", json.createObjectNode());
    }

    private ObjectNode paginationSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("offset").put("type", "integer").put("minimum", 0);
        properties.putObject("limit").put("type", "integer").put("minimum", 1).put("maximum", 200);
        return schema;
    }

    private ObjectNode scopeSchema() {
        ObjectNode schema = schema();
        ((ObjectNode) schema.get("properties")).putObject("scope").put("type", "string");
        schema.putArray("required").add("scope");
        return schema;
    }

    private ObjectNode targetSchema(boolean confirmed) {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("target").put("type", "string");
        properties.putObject("run_id").put("type", "string");
        properties.putObject("account_id").put("type", "string");
        if (confirmed) properties.putObject("confirmed").put("type", "boolean");
        schema.putArray("required").add("target");
        return schema;
    }

    private ObjectNode zapBaselineSchema() {
        ObjectNode schema = targetSchema(false);
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("include_anonymous").put("type", "boolean");
        properties.putObject("account_ids").put("type", "array")
                .putObject("items").put("type", "string");
        ObjectNode definition = properties.putObject("definitions").put("type", "array")
                .put("maxItems", 20).putObject("items").put("type", "object");
        ObjectNode definitionProperties = definition.putObject("properties");
        definitionProperties.putObject("type").put("type", "string").putArray("enum")
                .add("OPENAPI").add("GRAPHQL").add("POSTMAN").add("SOAP");
        definitionProperties.putObject("url").put("type", "string");
        definitionProperties.putObject("endpoint").put("type", "string");
        definition.putArray("required").add("type");
        return schema;
    }

    private ObjectNode evidenceSchema() {
        ObjectNode schema = schema();
        ((ObjectNode) schema.get("properties")).putObject("evidence_id").put("type", "string");
        schema.putArray("required").add("evidence_id");
        return schema;
    }

    private ObjectNode evidenceListSchema() {
        ObjectNode schema = paginationSchema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("run_id").put("type", "string");
        properties.putObject("source").put("type", "string")
                .putArray("enum").add("HUMAN").add("SCANNER").add("LLM").add("UNKNOWN");
        properties.putObject("phase").put("type", "string")
                .putArray("enum").add("BASELINE").add("IMPORT").add("EXPLORATION")
                .add("COACH_PROBE").add("VALIDATION").add("UNKNOWN");
        return schema;
    }

    private ObjectNode routeCandidateSchema() {
        ObjectNode schema = paginationSchema();
        ((ObjectNode) schema.get("properties")).putObject("view").put("type", "string")
                .putArray("enum").add("INDEPENDENT").add("ASSISTED");
        return schema;
    }

    private ObjectNode targetReadSchema() {
        ObjectNode schema = targetRequestSchema(List.of("GET", "HEAD", "OPTIONS"), false);
        ((ObjectNode) schema.get("properties")).remove("body");
        return schema;
    }

    private ObjectNode targetWriteSchema() {
        return targetRequestSchema(List.of("POST", "PUT", "PATCH", "DELETE"), true);
    }

    private ObjectNode browserNavigateSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("target").put("type", "string");
        schema.putArray("required").add("target");
        return schema;
    }

    private ObjectNode browserInteractSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("action").put("type", "string").putArray("enum").add("CLICK").add("FILL");
        properties.putObject("selector").put("type", "string").put("maxLength", 500);
        properties.putObject("value").put("type", "string").put("maxLength", 2_000);
        properties.putObject("confirmed").put("type", "boolean");
        schema.putArray("required").add("action").add("selector").add("confirmed");
        return schema;
    }

    private ObjectNode targetRequestSchema(List<String> methods, boolean confirmed) {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        ObjectNode method = properties.putObject("method").put("type", "string");
        ArrayNode methodValues = method.putArray("enum");
        methods.forEach(methodValues::add);
        properties.putObject("target").put("type", "string");
        properties.putObject("account_id").put("type", "string");
        properties.putObject("headers").put("type", "object")
                .putObject("additionalProperties").put("type", "string");
        properties.putObject("body").put("type", "string").put("maxLength", 65_536);
        if (confirmed) properties.putObject("confirmed").put("type", "boolean");
        schema.putArray("required").add("method").add("target");
        return schema;
    }

    private ObjectNode zapStatusSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("scan_type").put("type", "string");
        properties.putObject("scan_id").put("type", "string");
        return schema;
    }

    private ObjectNode zapAlertsSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("target").put("type", "string");
        properties.putObject("start").put("type", "integer").put("minimum", 0);
        properties.putObject("count").put("type", "integer").put("minimum", 1).put("maximum", 500);
        schema.putArray("required").add("target");
        return schema;
    }

    private ObjectNode assessmentSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("type").put("type", "string").put("maxLength", 64);
        properties.putObject("verdict").put("type", "string")
                .putArray("enum").add("LIKELY").add("INCONCLUSIVE").add("REJECTED");
        properties.putObject("title").put("type", "string").put("maxLength", 256);
        properties.putObject("reason").put("type", "string").put("maxLength", 4_096);
        ObjectNode evidence = properties.putObject("evidence_ids").put("type", "array")
                .put("minItems", 1).put("maxItems", 200);
        evidence.putObject("items").put("type", "string").put("maxLength", 256);
        ArrayNode required = schema.putArray("required");
        List.of("type", "verdict", "title", "reason", "evidence_ids").forEach(required::add);
        return schema;
    }

    public static void validateAssessmentSet(List<Assessment> values) {
        if (values == null || values.size() > MAX_ASSESSMENTS) {
            throw new IllegalArgumentException("assessment limit exceeded");
        }
        if (assessmentRetainedBytes(values) > MAX_ASSESSMENT_RETAINED_BYTES) {
            throw new IllegalArgumentException("assessment retained-byte limit exceeded");
        }
    }

    private static long assessmentRetainedBytes(List<Assessment> values) {
        long total = 0;
        for (Assessment value : values) total += assessmentRetainedBytes(value);
        return total;
    }

    private static long assessmentRetainedBytes(Assessment value) {
        long total = utf8Bytes(value.id()) + utf8Bytes(value.type()) + utf8Bytes(value.verdict())
                + utf8Bytes(value.title()) + utf8Bytes(value.reason()) + 32;
        for (String evidenceId : value.evidenceIds()) total += utf8Bytes(evidenceId) + 8;
        return total;
    }

    private static int utf8Bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String boundedAssessmentText(String value, String field, int maxChars) {
        if (value == null || value.isBlank() || value.length() > maxChars) {
            throw new IllegalArgumentException(field + " is required and must be at most " + maxChars + " characters");
        }
        return value;
    }

    private ObjectNode validationSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("candidate_id").put("type", "string");
        properties.putObject("verdict").put("type", "string")
                .putArray("enum").add("CONFIRMED").add("INCONCLUSIVE").add("REJECTED");
        properties.putObject("reason").put("type", "string");
        for (String field : List.of("original_evidence_ids", "validation_evidence_ids", "control_evidence_ids")) {
            properties.putObject(field).put("type", "array").putObject("items").put("type", "string");
        }
        ArrayNode required = schema.putArray("required");
        List.of("candidate_id", "verdict", "reason", "original_evidence_ids",
                "validation_evidence_ids", "control_evidence_ids").forEach(required::add);
        return schema;
    }

    private ObjectNode llmRunSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("phase").put("type", "string")
                .putArray("enum").add("EXPLORATION").add("COACH_PROBE").add("VALIDATION");
        properties.putObject("tool").put("type", "string")
                .putArray("enum").add("CODEX").add("CLAUDE").add("OTHER");
        properties.putObject("run_id").put("type", "string");
        properties.putObject("account_id").put("type", "string");
        schema.putArray("required").add("phase");
        return schema;
    }

    private ObjectNode endRunSchema() {
        ObjectNode schema = schema();
        ((ObjectNode) schema.get("properties")).putObject("source").put("type", "string")
                .putArray("enum").add("LLM").add("SCANNER");
        ((ObjectNode) schema.get("properties")).putObject("run_id").put("type", "string");
        schema.putArray("required").add("source").add("run_id");
        return schema;
    }

    private String required(JsonNode args, String field) {
        String value = args.path(field).asText();
        if (value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value;
    }

    private Pipeline.Result analysisSnapshot() {
        if (lockedSnapshot != null) return lockedSnapshot;
        Pipeline.Result current = state.snapshot();
        if (current.records.stream().noneMatch(record -> record.phase == RunPhase.COACH_PROBE
                || record.phase == RunPhase.VALIDATION)) return current;
        List<RequestRecord> preJudge = current.records.stream()
                .filter(record -> record.phase != RunPhase.COACH_PROBE && record.phase != RunPhase.VALIDATION)
                .toList();
        return Pipeline.runIsolated(new ArrayList<>(preJudge), state.config());
    }

    private void requireLocked() {
        if (lockedSnapshot == null) {
            throw new IllegalStateException("dataset must be locked after HUMAN, SCANNER, and independent LLM passes");
        }
    }

    private void rejectIndependentExplorer(String capability) {
        if (independentExplorer() != null) {
            throw new IllegalStateException("independent Explorer cannot access " + capability);
        }
    }

    private RunContextRegistry.Context independentExplorer() {
        if (lockedSnapshot != null) return null;
        RunContextRegistry.Context context = state.contexts().current(Source.LLM);
        return context != null && context.phase() == RunPhase.EXPLORATION ? context : null;
    }

    private void assertEvidenceVisible(RequestRecord record) {
        RunContextRegistry.Context explorer = independentExplorer();
        if (explorer != null && (record.source != Source.LLM || !explorer.runId().equals(record.runId))) {
            throw new IllegalArgumentException("independent Explorer may read only its own run Evidence");
        }
        if (explorer != null
                && !SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY)) {
            throw new IllegalArgumentException("independent Explorer may read only FlowScope-controlled Evidence");
        }
        if (explorer == null) requireLocked();
    }

    private List<RouteCandidate> explorerRoutes(Pipeline.Result snapshot, RunContextRegistry.Context explorer) {
        Set<String> controlledEvidence = snapshot.records.stream()
                .filter(record -> record.source == Source.LLM && explorer.runId().equals(record.runId))
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY))
                .map(record -> record.evidenceId).collect(java.util.stream.Collectors.toSet());
        List<RouteCandidate> evidenceBacked = RouteCandidateViews.forRun(
                        state.routeCandidates(), Source.LLM, explorer.runId()).stream()
                .filter(candidate -> candidate.provenance().stream()
                        .anyMatch(item -> controlledEvidence.contains(item.evidenceId())))
                .toList();
        return RouteCandidateExtractor.prioritized(java.util.stream.Stream.concat(evidenceBacked.stream(),
                browserDiscoveredRoutes.getOrDefault(explorer.runId(), List.of()).stream()).toList());
    }

    private List<RouteCandidate> assistedExplorerRoutes(Pipeline.Result snapshot,
                                                        RunContextRegistry.Context explorer) {
        List<RouteCandidate> blindHints = new ArrayList<>();
        List<RequestRecord> ownVisited = explorerVisits(snapshot, explorer);
        for (RouteCandidate candidate : state.routeCandidates()) {
            boolean hasCrossLane = candidate.provenance().stream()
                    .filter(item -> item.source() == Source.HUMAN || item.source() == Source.SCANNER
                            || item.source() == Source.UNKNOWN)
                    .findAny().isPresent();
            if (!hasCrossLane || (!candidate.concretePaths().isEmpty()
                    && pendingConcretePaths(candidate, ownVisited).isEmpty())) continue;
            RouteCandidate.Provenance blind = new RouteCandidate.Provenance(
                    RouteCandidate.ProvenanceType.LEGACY_UNMAPPED, "blind-assisted", Source.UNKNOWN,
                    "blind-assisted", "blind-assisted", RouteCandidate.Applicability.REVIEW,
                    "cross-lane provenance redacted");
            blindHints.add(new RouteCandidate(candidate.service(), candidate.method(), candidate.pathTemplate(),
                    candidate.concretePaths(), candidate.concretePathsTruncated(), false,
                    List.of(blind), RouteCandidate.Applicability.REVIEW,
                    "다른 수집 레인에서 발견된 exact-scope 경로 힌트"));
        }
        return RouteCandidateExtractor.prioritized(blindHints);
    }

    private List<RouteCandidate> actionableRoutes(List<RouteCandidate> candidates, Pipeline.Result snapshot,
                                                  RunContextRegistry.Context explorer) {
        List<RequestRecord> ownVisited = explorerVisits(snapshot, explorer);
        return candidates.stream()
                .filter(candidate -> SAFE_DISCOVERY_METHODS.contains(candidate.method()))
                .filter(candidate -> !pendingConcretePaths(candidate, ownVisited).isEmpty())
                .toList();
    }

    private int pendingConcreteCount(List<RouteCandidate> candidates, Pipeline.Result snapshot,
                                     RunContextRegistry.Context explorer) {
        List<RequestRecord> ownVisited = explorerVisits(snapshot, explorer);
        return candidates.stream().mapToInt(candidate -> pendingConcretePaths(candidate, ownVisited).size()).sum();
    }

    private List<String> pendingConcretePaths(RouteCandidate candidate, Pipeline.Result snapshot,
                                              RunContextRegistry.Context explorer) {
        return pendingConcretePaths(candidate, explorerVisits(snapshot, explorer));
    }

    private List<String> pendingConcretePaths(RouteCandidate candidate, List<RequestRecord> ownVisited) {
        return candidate.concretePaths().stream()
                .filter(path -> !routeVisited(candidate.service(), candidate.method(), path, ownVisited))
                .toList();
    }

    private List<RequestRecord> explorerVisits(Pipeline.Result snapshot,
                                               RunContextRegistry.Context explorer) {
        return snapshot.records.stream()
                .filter(record -> record.source == Source.LLM && explorer.runId().equals(record.runId))
                .filter(record -> record.hasResponse)
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.EXPLORER_VISIBILITY))
                .toList();
    }

    private boolean routeVisited(String service, String method, String concretePath,
                                 List<RequestRecord> ownVisited) {
        return ownVisited.stream().anyMatch(record -> record.service.equals(service)
                && recordPathWithQuery(record).equals(concretePath)
                && (method.equals("UNKNOWN") || record.method.equals(method)));
    }

    private static String recordPathWithQuery(RequestRecord record) {
        return record.query == null || record.query.isBlank() ? record.path : record.path + "?" + record.query;
    }

    private void addExplorerGuidance(ObjectNode out, RunContextRegistry.Context explorer,
                                     Pipeline.Result snapshot, List<RouteCandidate> visible,
                                     boolean assisted) {
        List<RouteCandidate> actionable = actionableRoutes(visible, snapshot, explorer);
        int pending = pendingConcreteCount(actionable, snapshot, explorer);
        long unresolvedTemplates = visible.stream().filter(candidate -> candidate.concretePaths().isEmpty()
                && candidate.pathTemplate().contains("{")).count();
        long stateChanging = visible.stream().filter(candidate -> Set.of("POST", "PUT", "PATCH", "DELETE")
                .contains(candidate.method())).count();
        boolean browserUsed = explorerBrowserUsed.contains(explorer.runId());
        boolean browserAvailable = state.browserAvailable();
        boolean renderRecommended = renderedDiscoveryRecommended(snapshot, explorer) && !browserUsed;
        String nextAction;
        if (pending > 0) {
            nextAction = assisted ? "REQUEST_ASSISTED_SAFE_FRONTIER" : "REQUEST_INDEPENDENT_SAFE_FRONTIER";
        } else if (!assisted && renderRecommended) {
            nextAction = browserAvailable
                    ? "BROWSER_DISCOVERY_RECOMMENDED" : "BROWSER_UNAVAILABLE_CONTINUE_PARTIAL";
        } else if (!assisted) {
            nextAction = "REVIEW_ASSISTED_FRONTIER";
        } else if (unresolvedTemplates > 0 || stateChanging > 0) {
            nextAction = "REVIEW_BLOCKED_DYNAMIC_OR_STATE_CHANGING_ROUTES";
        } else {
            nextAction = "READY_TO_END";
        }
        ObjectNode guidance = out.putObject("explorer_guidance");
        guidance.put("next_action", nextAction);
        guidance.put("http_executor_is_evidence_channel", true);
        guidance.put("browser_is_discovery_only", true);
        guidance.put("browser_available", browserAvailable);
        guidance.put("browser_used", browserUsed);
        guidance.put("rendered_discovery_recommended", renderRecommended);
        guidance.put("unresolved_dynamic_templates", unresolvedTemplates);
        guidance.put("state_changing_routes_requiring_approval", stateChanging);
        guidance.put("pending_safe_concrete_requests", pending);
    }

    private boolean renderedDiscoveryRecommended(Pipeline.Result snapshot,
                                                  RunContextRegistry.Context explorer) {
        return explorerVisits(snapshot, explorer).stream().anyMatch(record -> {
            String media = record.responseContentType == null ? ""
                    : record.responseContentType.toLowerCase(java.util.Locale.ROOT);
            if (!media.contains("html")) return false;
            String body = record.responseBodyForAnalysis();
            if (body == null) return false;
            String lower = body.toLowerCase(java.util.Locale.ROOT);
            return lower.contains("<script") || lower.contains("type=\"module\"")
                    || lower.contains("type='module'");
        });
    }

    private static List<String> reviewDimensions(RouteCandidate candidate) {
        List<String> dimensions = new ArrayList<>();
        if (candidate.pathTemplate().contains("{") || candidate.concretePaths().stream()
                .anyMatch(path -> !path.equals(candidate.pathTemplate()))) {
            dimensions.add("OBJECT_AUTHORIZATION");
        }
        if (Set.of("POST", "PUT", "PATCH", "DELETE").contains(candidate.method())) {
            dimensions.add("FUNCTION_AUTHORIZATION");
            dimensions.add("WORKFLOW_STATE");
        }
        if (candidate.method().equals("UNKNOWN")) dimensions.add("METHOD_DISCOVERY");
        if (dimensions.isEmpty()) dimensions.add("ENDPOINT_DISCOVERY");
        return List.copyOf(dimensions);
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

    private ObjectNode success(JsonNode id, JsonNode result) {
        ObjectNode response = json.createObjectNode().put("jsonrpc", "2.0");
        if (id != null) response.set("id", id);
        return response.set("result", result);
    }

    private ObjectNode error(JsonNode id, int code, String message) {
        ObjectNode response = json.createObjectNode().put("jsonrpc", "2.0");
        if (id == null) response.putNull("id"); else response.set("id", id);
        response.putObject("error").put("code", code).put("message", message == null ? "error" : message);
        return response;
    }

    private LoopbackHttpServer.Response response(LoopbackHttpServer.Request request,
                                                  int status, JsonNode body) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        String initialized = body.at("/result/protocolVersion").asText(null);
        return new LoopbackHttpServer.Response(status,
                Map.of("Content-Type", "application/json; charset=utf-8",
                        "MCP-Protocol-Version", initialized != null
                                ? initialized : negotiate(request.header("MCP-Protocol-Version"))), bytes);
    }

    private static String randomToken() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String negotiate(String requested) {
        return requested != null && SUPPORTED_PROTOCOLS.contains(requested) ? requested : LATEST_PROTOCOL;
    }

    private static <T> List<T> page(List<T> values, JsonNode args) {
        int offset = Math.max(0, args.path("offset").asInt(0));
        int limit = Math.max(1, Math.min(200, args.path("limit").asInt(100)));
        if (offset >= values.size()) return List.of();
        return values.subList(offset, Math.min(values.size(), offset + limit));
    }
}
