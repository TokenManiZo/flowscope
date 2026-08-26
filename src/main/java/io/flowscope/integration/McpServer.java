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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Localhost 전용 MCP Streamable HTTP(JSON-RPC) 서버. 모델 제공자 토큰을 취급하지 않는다. */
public final class McpServer implements AutoCloseable {
    public interface State {
        Pipeline.Result snapshot();
        ScopePolicy scope();
        void updateScope(String value);
        ZapClient zap();
        RunContextRegistry contexts();
        AnalysisConfig config();
        boolean approve(String action, String target);
        default SessionBroker sessions() { return null; }
        default TargetResult targetRequest(TargetRequest request) {
            throw new UnsupportedOperationException("controlled target executor is unavailable");
        }
        default void assessmentsChanged(List<Assessment> values) {}
        default void validationsChanged(List<ValidationDecision> values) {}
    }

    public record Assessment(String id, String type, String verdict, String title, String reason,
                             List<String> evidenceIds, Instant createdAt) {}
    public record TargetRequest(String method, String target, Map<String, String> headers,
                                String body, String accountId) {}
    public record TargetResult(String evidenceId, int status, String location,
                               String response, String responseBody) {}

    private static final int MAX_BODY = 1024 * 1024;
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
    private volatile String lockId = "";
    private final ExecutorService zapWorkflow = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "flowscope-zap-baseline");
        thread.setDaemon(true);
        return thread;
    });
    private volatile ZapBaselineRun zapBaseline;
    private volatile ArrayNode zapBaselineAlerts = json.createArrayNode();
    private volatile List<ZapLaneResult> zapBaselineLanes = List.of();

    private record ZapBaselineRun(String runId, String target, String status, String stage,
                                  String scanId, String warning, long capturedRecords,
                                  int alertCount, String error) {}
    private record ZapLaneResult(String accountId, String accountLabel, String status, String stage,
                                 long capturedRecords, int alertCount, String warning, String error) {}
    private record ZapLane(String accountId, String accountLabel) {}

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
    public JsonNode startDeterministicZapBaseline(String target, String accountId) {
        return startDeterministicZapCampaign(target,
                accountId == null || accountId.isBlank() ? List.of() : List.of(accountId),
                accountId == null || accountId.isBlank());
    }
    public JsonNode startDeterministicZapCampaign(String target, List<String> accountIds,
                                                  boolean includeAnonymous) {
        ObjectNode args = json.createObjectNode().put("target", target);
        args.put("include_anonymous", includeAnonymous);
        ArrayNode accounts = args.putArray("account_ids");
        if (accountIds != null) accountIds.stream().filter(value -> value != null && !value.isBlank())
                .distinct().forEach(accounts::add);
        return startZapBaseline(args);
    }
    public JsonNode deterministicZapBaselineStatus() { return zapBaselineStatus(); }
    public void clearAssessments() {
        synchronized (assessments) { assessments.clear(); }
        state.assessmentsChanged(List.of());
    }
    public void replaceAssessments(List<Assessment> values) {
        synchronized (assessments) {
            assessments.clear();
            assessments.addAll(values == null ? List.of() : values.stream().limit(1_000).toList());
        }
        state.assessmentsChanged(snapshotAssessments());
    }
    public void clearValidations() {
        synchronized (validations) { validations.clear(); }
        state.validationsChanged(List.of());
    }
    public void resetWorkflow() {
        lockedSnapshot = null;
        lockId = "";
        if (zapBaseline == null || !"RUNNING".equals(zapBaseline.status())) {
            zapBaseline = null;
            zapBaselineAlerts = json.createArrayNode();
            zapBaselineLanes = List.of();
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
        zapWorkflow.shutdownNow();
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
        result.putObject("serverInfo").put("name", "flowscope").put("version", "1.2.0-beta.3");
        result.put("instructions", "Closed-world authorized assessment only. Use FlowScope MCP state and controlled "
                + "flowscope_target_request responses; do not use web search, Wayback, external API documentation, "
                + "source repositories, direct curl, or browser networking. If needed, set only the exact target supplied "
                + "by the operator before any run; never infer or broaden scope. The system-owned ZAP baseline, not the "
                + "LLM, chooses scanner stages. Begin and end every LLM run. Explorer is server-isolated from HUMAN and "
                + "SCANNER state. After all three lanes finish, lock the dataset before Judge synthesis. CONFIRMED or "
                + "REJECTED is accepted only through FlowScope-controlled reproduction and control Evidence; otherwise "
                + "use INCONCLUSIVE.");
        return result;
    }

    private ObjectNode toolsList() {
        ArrayNode tools = json.createArrayNode();
        tools.add(tool("flowscope_get_status", "Get source counts, active scope, coverage and finding counts.", schema(), true, false));
        tools.add(tool("flowscope_set_scope", "Replace the allowlist with user-authorized exact HTTP(S) scope entries before active runs.",
                scopeSchema(), false, false));
        tools.add(tool("flowscope_lock_dataset", "Lock completed HUMAN, SCANNER, and independent LLM lanes before Judge access.",
                schema(), false, false));
        tools.add(tool("flowscope_list_candidates", "List evidence-grounded BOLA/BFLA and coverage-gap candidates.", paginationSchema(), true, false));
        tools.add(tool("flowscope_get_evidence", "Read one masked request/response by evidence_id.",
                evidenceSchema(), true, false));
        tools.add(tool("flowscope_list_evidence", "List captured Evidence metadata with run/source/phase filters.",
                evidenceListSchema(), true, false));
        tools.add(tool("flowscope_list_sessions", "List safe test-account session status; never returns cookies or tokens.",
                schema(), true, false));
        tools.add(tool("flowscope_target_request", "Send one exact-scope target request through FlowScope's controlled executor. No external web access.",
                targetRequestSchema(), false, true));
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
        tools.add(tool("flowscope_zap_baseline", "Run the deterministic isolated scanner campaign for anonymous and selected account IDs: Traditional Spider, Client Spider (AJAX fallback), passive queue, then native alerts.", zapBaselineSchema(), false, false));
        tools.add(tool("flowscope_zap_baseline_status", "Read deterministic scanner-lane progress and captured-output counts.", schema(), true, false));
        tools.add(tool("flowscope_zap_passive_status", "Read ZAP passive-scan queue and current tasks.", schema(), true, false));
        tools.add(tool("flowscope_zap_alerts", "Read paginated native ZAP alerts after the three-lane dataset is locked.", zapAlertsSchema(), true, false));
        tools.add(tool("flowscope_zap_spider", "Start a scoped ZAP spider; resulting HTTP remains source=SCANNER.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_client_spider", "Start the recommended strict-scope ZAP Client Spider for browser-rendered routes.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_ajax_spider", "Start a scoped ZAP AJAX spider for browser-rendered routes; resulting HTTP remains source=SCANNER.", targetSchema(false), false, false));
        tools.add(tool("flowscope_zap_active_scan", "Start a scoped ZAP Active Scan after explicit Burp approval.", targetSchema(true), false, true));
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
                case "flowscope_get_evidence" -> evidence(args.path("evidence_id").asText());
                case "flowscope_list_evidence" -> listEvidence(args);
                case "flowscope_list_sessions" -> listSessions();
                case "flowscope_target_request" -> targetRequest(args);
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
        Pipeline.Result snapshot = state.snapshot();
        ObjectNode out = json.createObjectNode();
        RunContextRegistry.Context llm = state.contexts().current(Source.LLM);
        boolean independentView = lockedSnapshot == null && llm != null && llm.phase() == RunPhase.EXPLORATION;
        List<RequestRecord> visibleRecords = independentView
                ? snapshot.records.stream().filter(record -> record.source == Source.LLM
                && llm.runId().equals(record.runId)).toList()
                : snapshot.records;
        List<RequestRecord> visibleCoverage = independentView
                ? snapshot.coverageRecords.stream().filter(record -> record.source == Source.LLM
                && llm.runId().equals(record.runId)).toList()
                : snapshot.coverageRecords;
        out.put("independent_explorer_view", independentView);
        out.put("workflow_stage", lockedSnapshot == null ? "COLLECTING" : "LOCKED");
        if (!lockId.isBlank()) out.put("lock_id", lockId);
        ObjectNode sourceCounts = out.putObject("source_counts");
        if (independentView) {
            sourceCounts.put(Source.LLM.name(), visibleRecords.size());
        } else {
            for (Source source : Source.values()) {
                sourceCounts.put(source.name(), snapshot.records.stream().filter(r -> r.source == source).count());
            }
        }
        ObjectNode coverageSourceCounts = out.putObject("coverage_source_counts");
        if (independentView) {
            coverageSourceCounts.put(Source.LLM.name(), visibleCoverage.size());
        } else {
            for (Source source : Source.values()) {
                coverageSourceCounts.put(source.name(), visibleCoverage.stream()
                        .filter(record -> record.source == source).count());
            }
        }
        out.put("captured_records", visibleRecords.size());
        out.put("coverage_records", visibleCoverage.size());
        out.put("excluded_records", visibleRecords.stream().filter(record -> record.trafficClassification.disposition()
                == TrafficClassification.Disposition.EXCLUDE).count());
        out.put("review_records", visibleRecords.stream().filter(record -> record.trafficClassification.disposition()
                == TrafficClassification.Disposition.REVIEW).count());
        out.putPOJO("scope", state.scope().entries());
        if (!independentView) {
            Pipeline.Result visible = analysisSnapshot();
            out.put("coverage_cells", visible.analysis.cells().size());
            out.put("gaps", visible.analysis.gaps().size());
            out.put("rule_findings", visible.analysis.findings().size());
            out.put("llm_assessments", snapshotAssessments().size());
            out.put("final_validations", snapshotValidations().size());
            out.putPOJO("completed_lanes", state.contexts().completedExplorations().stream()
                    .map(Enum::name).sorted().toList());
        }
        out.put("llm_target_proxy", "http://127.0.0.1:8082");
        out.put("scanner_target_proxy", "http://127.0.0.1:8081");
        ObjectNode activeRuns = out.putObject("active_runs");
        for (Source source : List.of(Source.HUMAN, Source.SCANNER, Source.LLM)) {
            RunContextRegistry.Context context = state.contexts().current(source);
            if (context != null) activeRuns.put(source.name(), context.runId());
        }
        return out;
    }

    private JsonNode lockDataset() {
        if (lockedSnapshot != null) throw new IllegalStateException("dataset is already locked");
        if (state.contexts().hasActiveRuns()) throw new IllegalStateException("end all active runs before locking");
        Set<Source> completed = state.contexts().completedExplorations();
        if (!completed.containsAll(Set.of(Source.HUMAN, Source.SCANNER, Source.LLM))) {
            throw new IllegalStateException("HUMAN, SCANNER, and independent LLM exploration must all complete before lock");
        }
        Pipeline.Result snapshot = state.snapshot();
        List<String> emptyLanes = java.util.stream.Stream.of(Source.HUMAN, Source.SCANNER, Source.LLM)
                .filter(source -> snapshot.coverageRecords.stream().noneMatch(record -> record.source == source
                        && record.phase == RunPhase.EXPLORATION && record.hasResponse
                        && record.runId != null && !record.runId.isBlank() && !"default".equals(record.runId)))
                .map(Enum::name).toList();
        if (!emptyLanes.isEmpty()) {
            throw new IllegalStateException("completed lanes need captured exploration responses before lock: " + emptyLanes);
        }
        lockedSnapshot = snapshot;
        lockId = "lock-" + System.currentTimeMillis();
        return json.createObjectNode().put("lock_id", lockId).put("records", lockedSnapshot.records.size())
                .put("findings", lockedSnapshot.analysis.findings().size())
                .put("gaps", lockedSnapshot.analysis.gaps().size());
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
                .put("source_detail", detail.name()).put("proxy", "http://127.0.0.1:8082");
    }

    private JsonNode endRun(JsonNode args) {
        String sourceName = required(args, "source").toUpperCase();
        String runId = required(args, "run_id");
        Source source = switch (sourceName) {
            case "LLM" -> Source.LLM;
            case "SCANNER" -> Source.SCANNER;
            default -> throw new IllegalArgumentException("source must be LLM or SCANNER");
        };
        if (!state.contexts().clear(source, runId)) {
            throw new IllegalArgumentException("run_id does not match the active " + source.name() + " run");
        }
        return json.createObjectNode().put("ended", source.name()).put("run_id", runId);
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
        out.put("request", Masking.maskHeaders(record.reqText));
        String response = record.respText != null ? record.respText : record.body;
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
        }
        return out;
    }

    private JsonNode targetRequest(JsonNode args) {
        RunContextRegistry.Context context = state.contexts().current(Source.LLM);
        if (context == null) throw new IllegalStateException("begin an LLM run before target requests");
        String method = required(args, "method").toUpperCase(java.util.Locale.ROOT);
        if (!Set.of("GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE").contains(method)) {
            throw new IllegalArgumentException("unsupported HTTP method");
        }
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        if (!Set.of("GET", "HEAD", "OPTIONS").contains(method)
                && (!args.path("confirmed").asBoolean(false) || !state.approve("LLM state-changing request", target))) {
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
        if (accountId.isBlank()) accountId = context.accountId();
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
            if (assessments.size() >= 1_000) throw new IllegalStateException("assessment limit reached");
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
            if (decisive.stream().anyMatch(record -> record.executionTrust != ExecutionTrust.CONTROLLED)) {
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
                        || !ResponseEvidence.showsObject(control.body, control.resource, owner.identity())) {
                    throw new IllegalArgumentException("BOLA control must successfully return the owned object");
                }
            } else {
                AccessRole required = state.config().endpointRequirement(candidate.cell().operation());
                if (state.config().identityRole(control.idn).isBelow(required) || !ResponseEvidence.successful(control)) {
                    throw new IllegalArgumentException("BFLA control must use an authorized identity and succeed");
                }
            }
        }
        ValidationDecision.FinalVerdict requested = probes.stream().allMatch(ResponseEvidence::denied)
                ? ValidationDecision.FinalVerdict.REJECTED : ValidationDecision.FinalVerdict.CONFIRMED;
        if (candidate.type() == AuthorizationAnalysis.FindingType.BOLA && requested == ValidationDecision.FinalVerdict.CONFIRMED
                && probes.stream().anyMatch(record -> !ResponseEvidence.successful(record)
                || !ResponseEvidence.showsObject(record.body, record.resource, owner.identity()))) {
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
            state.contexts().clear(Source.SCANNER, context.runId());
        }
        return result;
    }

    private JsonNode zapEnvironment() {
        ObjectNode out = json.createObjectNode();
        out.set("version", parseZap(state.zap().version()));
        out.set("installed_addons", parseZap(state.zap().installedAddons()));
        return out;
    }

    private synchronized JsonNode startZapBaseline(JsonNode args) {
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
        List<ZapLane> lanes = new ArrayList<>();
        if (includeAnonymous) lanes.add(new ZapLane(null, "비로그인"));
        for (String accountId : requestedAccounts) {
            String validated = validatedAccountForTarget(accountId, target);
            SessionBroker.SessionView session = state.sessions().viewForAccount(validated).orElseThrow();
            lanes.add(new ZapLane(validated, session.accountLabel()));
        }
        if (lanes.isEmpty()) throw new IllegalArgumentException("select anonymous or at least one active account");
        String runId = validatedRunId(args.path("run_id").asText("zap-baseline-" + System.currentTimeMillis()));
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, lanes.get(0).accountId()));
        zapBaselineAlerts = json.createArrayNode();
        zapBaselineLanes = lanes.stream().map(lane -> new ZapLaneResult(lane.accountId(), lane.accountLabel(),
                "PENDING", "PENDING", 0, 0, "", "")).toList();
        zapBaseline = new ZapBaselineRun(runId, target, "RUNNING", "TRADITIONAL_SPIDER",
                "", "", 0, 0, "");
        zapWorkflow.submit(() -> runZapCampaign(runId, target, lanes));
        return zapBaselineNode(zapBaseline);
    }

    private JsonNode zapBaselineStatus() {
        ZapBaselineRun value = zapBaseline;
        return value == null ? json.createObjectNode().put("status", "NOT_STARTED") : zapBaselineNode(value);
    }

    private void runZapCampaign(String runId, String target, List<ZapLane> lanes) {
        ArrayNode collectedAlerts = json.createArrayNode();
        boolean failed = false;
        String campaignError = "";
        for (int index = 0; index < lanes.size(); index++) {
            ZapLane lane = lanes.get(index);
            try {
                runZapLane(runId, target, lane, index, collectedAlerts);
            } catch (RuntimeException error) {
                failed = true;
                String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                if (campaignError.isBlank()) campaignError = lane.accountLabel() + ": " + message;
            }
        }
        long captured = capturedForRun(runId);
        zapBaselineAlerts = collectedAlerts;
        if (failed) {
            state.contexts().abort(Source.SCANNER, runId);
            zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    captured, collectedAlerts.size(), campaignError);
        } else if (!state.contexts().clear(Source.SCANNER, runId)) {
            zapBaseline = new ZapBaselineRun(runId, target, "FAILED", "FAILED", "", "",
                    captured, collectedAlerts.size(), "scanner run lease disappeared before completion");
        } else {
            zapBaseline = new ZapBaselineRun(runId, target, "COMPLETED", "ALERTS_READY", "", "",
                    captured, collectedAlerts.size(), "");
        }
    }

    private void runZapLane(String runId, String target, ZapLane lane, int index, ArrayNode collectedAlerts) {
        String warning = "";
        long capturedBefore = capturedForRun(runId);
        try {
            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_SPIDER, lane.accountId());
            JsonNode reset = parseZap(state.zap().newSession("flowscope-" + runId + "-" + index));
            if (!"OK".equalsIgnoreCase(reset.path("Result").asText())) {
                throw new IllegalStateException("ZAP did not create an isolated session");
            }
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "RUNNING",
                    "TRADITIONAL_SPIDER", 0, 0, "", ""));
            JsonNode traditional = parseZap(state.zap().spider(target));
            String scanId = traditional.path("scan").asText();
            if (scanId.isBlank()) throw new IllegalStateException("ZAP Traditional Spider did not return a scan id");
            updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · TRADITIONAL_SPIDER", scanId, warning, "");
            waitForZap(() -> state.zap().spiderStatus(scanId), 15 * 60_000L, "Traditional Spider");

            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_CLIENT_SPIDER, lane.accountId());
            try {
                JsonNode client = parseZap(state.zap().clientSpider(target));
                String clientId = client.path("scan").asText();
                if (clientId.isBlank()) throw new IllegalStateException("Client Spider did not return a scan id");
                updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · CLIENT_SPIDER", clientId, warning, "");
                waitForZap(() -> state.zap().clientSpiderStatus(clientId), 20 * 60_000L, "Client Spider");
            } catch (RuntimeException clientError) {
                warning = "Client Spider unavailable; AJAX Spider fallback used: " + clientError.getMessage();
                state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_AJAX_SPIDER, lane.accountId());
                JsonNode ajax = parseZap(state.zap().ajaxSpider(target));
                if (!"OK".equalsIgnoreCase(ajax.path("Result").asText())) {
                    throw new IllegalStateException("ZAP AJAX Spider fallback did not start");
                }
                updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · AJAX_SPIDER_FALLBACK", "", warning, "");
                waitForZap(() -> state.zap().ajaxSpiderStatus(), 20 * 60_000L, "AJAX Spider");
            }

            state.contexts().transition(Source.SCANNER, runId, SourceDetail.ZAP_PASSIVE_SCAN, lane.accountId());
            updateZapBaseline(runId, "RUNNING", lane.accountLabel() + " · PASSIVE_SCAN_QUEUE", "", warning, "");
            waitForPassive(5 * 60_000L);
            long captured = capturedForRun(runId) - capturedBefore;
            if (captured == 0) throw new IllegalStateException("scanner workflow completed without captured in-scope traffic");
            JsonNode alerts = maskTextValues(parseZap(state.zap().alerts(target, 0, 500)));
            int alertCount = alerts.path("alerts").isArray() ? alerts.path("alerts").size() : 0;
            if (alerts.path("alerts").isArray()) {
                for (JsonNode alert : alerts.path("alerts")) {
                    ObjectNode copy = alert.isObject() ? (ObjectNode) alert.deepCopy() : json.createObjectNode().set("alert", alert);
                    copy.put("flowscope_account_id", lane.accountId() == null ? "anonymous" : lane.accountId());
                    copy.put("flowscope_run_id", runId);
                    collectedAlerts.add(copy);
                }
            }
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "COMPLETED",
                    "ALERTS_READY", captured, alertCount, warning, ""));
        } catch (RuntimeException error) {
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            replaceZapLane(index, new ZapLaneResult(lane.accountId(), lane.accountLabel(), "FAILED", "FAILED",
                    Math.max(0, capturedForRun(runId) - capturedBefore), 0, warning, message));
            throw error;
        }
    }

    private long capturedForRun(String runId) {
        return state.snapshot().records.stream()
                .filter(record -> record.source == Source.SCANNER && runId.equals(record.runId)).count();
    }

    private synchronized void replaceZapLane(int index, ZapLaneResult value) {
        List<ZapLaneResult> copy = new ArrayList<>(zapBaselineLanes);
        copy.set(index, value);
        zapBaselineLanes = List.copyOf(copy);
    }

    @FunctionalInterface private interface ZapStatusCall { String get(); }

    private void waitForZap(ZapStatusCall call, long timeoutMillis, String label) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            JsonNode status = parseZap(call.get());
            String value = findStatus(status).toLowerCase(java.util.Locale.ROOT);
            if (value.equals("100") || value.equals("stopped") || value.equals("finished")
                    || value.equals("complete") || value.equals("completed")) return;
            if (value.equals("failed") || value.equals("error")) throw new IllegalStateException(label + " failed");
            sleepZapPoll();
        }
        throw new IllegalStateException(label + " timed out");
    }

    private void waitForPassive(long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            JsonNode queue = parseZap(state.zap().passiveRecordsToScan());
            if (queue.path("recordsToScan").asInt(-1) == 0) return;
            sleepZapPoll();
        }
        throw new IllegalStateException("ZAP passive scan queue timed out");
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

    private static void sleepZapPoll() {
        try { Thread.sleep(Math.max(100L, Long.getLong("flowscope.zap.poll.ms", 1_000L))); }
        catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("ZAP baseline interrupted", error);
        }
    }

    private void updateZapBaseline(String runId, String status, String stage, String scanId,
                                   String warning, String error) {
        ZapBaselineRun previous = zapBaseline;
        long captured = state.snapshot().records.stream()
                .filter(record -> record.source == Source.SCANNER && runId.equals(record.runId)).count();
        int alerts = previous == null ? 0 : previous.alertCount();
        zapBaseline = new ZapBaselineRun(runId, previous == null ? "" : previous.target(), status, stage,
                scanId, warning, captured, alerts, error);
    }

    private ObjectNode zapBaselineNode(ZapBaselineRun value) {
        ObjectNode out = json.createObjectNode();
        out.put("run_id", value.runId());
        out.put("target", value.target());
        out.put("status", value.status());
        out.put("stage", value.stage());
        out.put("scan_id", value.scanId());
        out.put("warning", value.warning());
        out.put("captured_records", value.capturedRecords());
        out.put("alert_count", value.alertCount());
        out.put("error", value.error());
        ArrayNode lanes = out.putArray("lanes");
        for (ZapLaneResult lane : zapBaselineLanes) {
            ObjectNode node = lanes.addObject();
            if (lane.accountId() == null) node.putNull("account_id"); else node.put("account_id", lane.accountId());
            node.put("account_label", lane.accountLabel());
            node.put("status", lane.status());
            node.put("stage", lane.stage());
            node.put("captured_records", lane.capturedRecords());
            node.put("alert_count", lane.alertCount());
            node.put("warning", lane.warning());
            node.put("error", lane.error());
        }
        return out;
    }

    private JsonNode zapPassiveStatus() {
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
        if (baseline != null && "COMPLETED".equals(baseline.status()) && target.equals(baseline.target())
                && stored != null) {
            ObjectNode out = json.createObjectNode();
            ArrayNode page = out.putArray("alerts");
            int end = Math.min(stored.size(), start + count);
            if (start < stored.size()) for (int i = start; i < end; i++) page.add(stored.get(i).deepCopy());
            out.put("source", "BASELINE_SNAPSHOT");
            out.put("returned", page.size());
            out.put("has_more", end < stored.size());
            out.put("snapshot_limit", 500);
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
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
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
            JsonNode response = parseZap(active ? state.zap().activeScan(target) : state.zap().spider(target));
            if (response.path("scan").asText().isBlank()) {
                throw new IllegalStateException("ZAP did not return a scan id");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().clear(Source.SCANNER, runId);
            throw error;
        }
    }

    private JsonNode startZapAjax(JsonNode args) {
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        String runId = validatedRunId(args.path("run_id").asText("zap-ajax-" + System.currentTimeMillis()));
        String accountId = validatedAccountForTarget(args.path("account_id").asText(), target);
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_AJAX_SPIDER,
                Orchestrator.LLM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, accountId));
        try {
            JsonNode response = parseZap(state.zap().ajaxSpider(target));
            if (!"OK".equalsIgnoreCase(response.path("Result").asText())) {
                throw new IllegalStateException("ZAP AJAX Spider did not start");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().clear(Source.SCANNER, runId);
            throw error;
        }
    }

    private JsonNode startZapClient(JsonNode args) {
        if (lockedSnapshot != null) throw new IllegalStateException("scanner runs must finish before dataset lock");
        String target = required(args, "target");
        if (!state.scope().allows(target)) throw new IllegalArgumentException("target is outside configured scope");
        String runId = validatedRunId(args.path("run_id").asText("zap-client-" + System.currentTimeMillis()));
        String accountId = validatedAccountForTarget(args.path("account_id").asText(), target);
        state.contexts().activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_CLIENT_SPIDER,
                Orchestrator.LLM, ToolKind.ZAP, RunPhase.EXPLORATION, runId, accountId));
        try {
            JsonNode response = parseZap(state.zap().clientSpider(target));
            if (response.path("scan").asText().isBlank()) {
                throw new IllegalStateException("ZAP Client Spider did not return a scan id");
            }
            if (response instanceof ObjectNode object) object.put("run_id", runId);
            return response;
        } catch (RuntimeException error) {
            state.contexts().clear(Source.SCANNER, runId);
            throw error;
        }
    }

    private JsonNode parseZap(String raw) {
        try { return json.readTree(raw); }
        catch (Exception e) { return json.createObjectNode().put("raw", raw); }
    }

    private List<Assessment> snapshotAssessments() {
        synchronized (assessments) { return List.copyOf(assessments); }
    }

    private ArrayNode assessmentPage(JsonNode args) {
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

    private ObjectNode targetRequestSchema() {
        ObjectNode schema = schema();
        ObjectNode properties = (ObjectNode) schema.get("properties");
        properties.putObject("method").put("type", "string");
        properties.putObject("target").put("type", "string");
        properties.putObject("account_id").put("type", "string");
        properties.putObject("headers").put("type", "object")
                .putObject("additionalProperties").put("type", "string");
        properties.putObject("body").put("type", "string").put("maxLength", 65_536);
        properties.putObject("confirmed").put("type", "boolean");
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
        for (String value : List.of("type", "verdict", "title", "reason")) properties.putObject(value).put("type", "string");
        properties.putObject("evidence_ids").put("type", "array").putObject("items").put("type", "string");
        ArrayNode required = schema.putArray("required");
        List.of("type", "verdict", "title", "reason", "evidence_ids").forEach(required::add);
        return schema;
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
        return Pipeline.run(new ArrayList<>(preJudge), state.config());
    }

    private void requireLocked() {
        if (lockedSnapshot == null) {
            throw new IllegalStateException("dataset must be locked after HUMAN, SCANNER, and independent LLM passes");
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
        if (explorer == null) requireLocked();
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
