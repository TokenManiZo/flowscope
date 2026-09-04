package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import io.flowscope.integration.McpServer;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.ControlledBrowserExplorer;
import io.flowscope.integration.SessionBroker;
import io.flowscope.integration.ZapClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;

import static org.junit.jupiter.api.Assertions.*;

final class McpServerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private McpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.close();
    }

    @Test
    void noCacheExplorerGateAcceptsControlledAndRejectsUnverifiedRuntime() throws Exception {
        String controlledRun = "controlled-" + java.util.UUID.randomUUID();
        RequestRecord controlled = observation(Source.LLM, "controlled", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, controlledRun);
        server = new McpServer(state(Pipeline.run(List.of(controlled)), new RunContextRegistry(),
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        assertTrue(server.hasExplorationResponse(Source.LLM, controlledRun));
        server.close();

        String unverifiedRun = "unverified-" + java.util.UUID.randomUUID();
        RequestRecord unverified = observation(Source.LLM, "unverified", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, unverifiedRun);
        unverified.executionTrust = ExecutionTrust.UNVERIFIED_RUNTIME;
        server = new McpServer(state(Pipeline.run(List.of(unverified)), new RunContextRegistry(),
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        assertFalse(server.hasExplorationResponse(Source.LLM, unverifiedRun));
    }

    @Test
    void lockedStatusUsesFrozenRunsAndIgnoresLaterLiveRecords() throws Exception {
        RequestRecord human = laneMarker(Source.HUMAN);
        RequestRecord scanner = laneMarker(Source.SCANNER);
        RequestRecord llm = laneMarker(Source.LLM);
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(List.of(human, scanner, llm)));
        RunContextRegistry contexts = new RunContextRegistry();
        completeAll(contexts, result.get());
        server = new McpServer(state(result, contexts, ScopePolicy.parse("https://api.example.test/v1"),
                new AnalysisConfig()), 0, "test-token");
        server.start();

        assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());
        RequestRecord later = observation(Source.LLM, "later", 200, "{\"ok\":true}",
                SourceDetail.LLM_VALIDATION, RunPhase.VALIDATION, "later-validation");
        result.set(Pipeline.run(List.of(human, scanner, llm, later)));

        JsonNode status = tool("flowscope_get_status", "{}").at("/result/structuredContent");
        assertEquals(1, status.at("/source_counts/LLM").asInt());
        assertEquals("completed-llm", status.at("/completed_runs/LLM/run_id").asText());
    }

    @Test
    void authenticatesNegotiatesAndExposesEvidence() throws Exception {
        RequestRecord record = record();
        RunContextRegistry contexts = new RunContextRegistry();
        Pipeline.Result result = Pipeline.run(List.of(record, laneMarker(Source.HUMAN), laneMarker(Source.SCANNER)));
        completeAll(contexts, result);
        server = new McpServer(state(result, contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        HttpResponse<String> denied = post("wrong", request(1, "ping", "{}"));
        assertEquals(401, denied.statusCode());

        JsonNode initialized = json(post("test-token", request(2, "initialize",
                "{\"protocolVersion\":\"future-version\"}")));
        assertEquals("2025-11-25", initialized.at("/result/protocolVersion").asText());
        assertEquals("1.2.0-beta.44", initialized.at("/result/serverInfo/version").asText());
        assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());

        JsonNode evidence = tool("flowscope_get_evidence",
                "{\"evidence_id\":\"" + record.evidenceId + "\"}");
        assertFalse(evidence.at("/result/isError").asBoolean());
        assertEquals(record.evidenceId,
                evidence.at("/result/structuredContent/evidence_id").asText());
        assertEquals("API", evidence.at("/result/structuredContent/traffic_class").asText());
        assertTrue(evidence.at("/result/structuredContent/coverage_eligible").asBoolean());
        String request = evidence.at("/result/structuredContent/request").asText();
        String response = evidence.at("/result/structuredContent/response").asText();
        assertFalse(request.contains("secret-cookie"));
        assertFalse(request.contains("secret-password"));
        assertFalse(response.contains("secret-session"));
        assertFalse(response.contains("secret-access-token"));
    }

    @Test
    void tracksLlmContextAndRejectsUnsupportedAssessmentAndOutOfScopeScan() throws Exception {
        RequestRecord record = record();
        RunContextRegistry contexts = new RunContextRegistry();
        Pipeline.Result result = Pipeline.run(List.of(record, laneMarker(Source.HUMAN), laneMarker(Source.SCANNER)));
        completeAll(contexts, result);
        server = new McpServer(state(result, contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());

        JsonNode began = tool("flowscope_begin_llm_run",
                "{\"phase\":\"COACH_PROBE\",\"tool\":\"CODEX\",\"run_id\":\"coach-1\"}");
        assertFalse(began.at("/result/isError").asBoolean());
        RunContextRegistry.Context context = contexts.current(Source.LLM);
        assertNotNull(context);
        assertEquals(SourceDetail.LLM_COACH_PROBE, context.detail());
        assertEquals(ToolKind.CODEX, context.tool());

        JsonNode scopeDuringRun = tool("flowscope_set_scope",
                "{\"scope\":\"https://other.example.test/\"}");
        assertTrue(scopeDuringRun.at("/result/isError").asBoolean());
        assertEquals("https://api.example.test:443/v1",
                tool("flowscope_get_status", "{}").at("/result/structuredContent/scope/0").asText());

        JsonNode overlap = tool("flowscope_begin_llm_run",
                "{\"phase\":\"VALIDATION\",\"tool\":\"CODEX\",\"run_id\":\"validation-2\"}");
        assertTrue(overlap.at("/result/isError").asBoolean());
        assertEquals("coach-1", contexts.current(Source.LLM).runId());

        JsonNode assessment = tool("flowscope_submit_assessment", "{"
                + "\"type\":\"BOLA\",\"verdict\":\"CONFIRMED\",\"title\":\"x\","
                + "\"reason\":\"x\",\"evidence_ids\":[\"" + record.evidenceId + "\"]}");
        assertTrue(assessment.at("/result/isError").asBoolean());
        JsonNode oversizedAssessment = tool("flowscope_submit_assessment", "{"
                + "\"type\":\"BOLA\",\"verdict\":\"LIKELY\",\"title\":\"x\","
                + "\"reason\":\"" + "x".repeat(4_097) + "\",\"evidence_ids\":[\""
                + record.evidenceId + "\"]}");
        assertTrue(oversizedAssessment.at("/result/isError").asBoolean());
        JsonNode advisory = tool("flowscope_submit_assessment", "{"
                + "\"type\":\"BOLA\",\"verdict\":\"LIKELY\",\"title\":\"x\","
                + "\"reason\":\"x\",\"evidence_ids\":[\"" + record.evidenceId + "\"]}");
        assertFalse(advisory.at("/result/isError").asBoolean(), advisory.toString());
        assertEquals("LIKELY", advisory.at("/result/structuredContent/verdict").asText());
        assertEquals(1, tool("flowscope_list_assessments", "{}").at("/result/structuredContent").size());

        JsonNode scan = tool("flowscope_zap_active_scan",
                "{\"target\":\"https://outside.example/v1\",\"confirmed\":true}");
        assertTrue(scan.at("/result/isError").asBoolean());
        assertTrue(scan.at("/result/structuredContent/error").asText().contains("dataset lock"));

        JsonNode missingLease = tool("flowscope_end_run", "{\"source\":\"LLM\"}");
        assertTrue(missingLease.at("/result/isError").asBoolean());
        JsonNode wrongLease = tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"wrong\"}");
        assertTrue(wrongLease.at("/result/isError").asBoolean());
        assertNotNull(contexts.current(Source.LLM));
        tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"coach-1\"}");
        assertNull(contexts.current(Source.LLM));

        JsonNode failedSpider = tool("flowscope_zap_spider",
                "{\"target\":\"https://api.example.test/v1\",\"run_id\":\"zap-failed\"}");
        assertTrue(failedSpider.at("/result/isError").asBoolean());
        assertNull(contexts.current(Source.SCANNER), "ZAP 시작 실패가 스캐너 컨텍스트를 남기면 안 됨");

        JsonNode failedAjax = tool("flowscope_zap_ajax_spider",
                "{\"target\":\"https://api.example.test/v1\",\"run_id\":\"zap-ajax-failed\"}");
        assertTrue(failedAjax.at("/result/isError").asBoolean());
        assertNull(contexts.current(Source.SCANNER), "AJAX Spider 시작 실패가 스캐너 컨텍스트를 남기면 안 됨");
    }

    @Test
    void rejectsAssessmentCollectionsBeyondRetainedByteBudget() {
        List<String> evidenceIds = java.util.stream.IntStream.range(0, 200)
                .mapToObj(index -> "evidence-" + index + "-" + "x".repeat(230)).toList();
        List<McpServer.Assessment> values = java.util.stream.IntStream.range(0, 100)
                .mapToObj(index -> new McpServer.Assessment("assessment-" + index, "BOLA", "LIKELY",
                        "candidate", "r".repeat(4_096), evidenceIds, java.time.Instant.EPOCH))
                .toList();

        assertThrows(IllegalArgumentException.class, () -> McpServer.validateAssessmentSet(values));
    }

    @Test
    void reportsHumanRunAndPublishesAjaxSpiderTool() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.HUMAN, new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "human-1"));
        server = new McpServer(state(Pipeline.run(List.of()), contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode status = tool("flowscope_get_status", "{}");
        assertTrue(status.at("/result/structuredContent/active_runs/HUMAN").isMissingNode(),
                "pre-lock MCP view must not reveal another lane's active run");
        JsonNode listed = json(post("test-token", request(4, "tools/list", "{}")));
        assertTrue(listed.at("/result/tools").findValuesAsText("name")
                .contains("flowscope_zap_ajax_spider"));
        assertTrue(listed.at("/result/tools").findValuesAsText("name")
                .contains("flowscope_set_scope"));
        assertTrue(listed.at("/result/tools").findValuesAsText("name")
                .contains("flowscope_lock_dataset"));
        assertTrue(listed.at("/result/tools").findValuesAsText("name")
                .contains("flowscope_list_route_candidates"));
        JsonNode safeRead = findTool(listed.at("/result/tools"), "flowscope_target_read");
        JsonNode approvedWrite = findTool(listed.at("/result/tools"), "flowscope_target_request");
        assertFalse(safeRead.at("/annotations/destructiveHint").asBoolean());
        assertTrue(approvedWrite.at("/annotations/destructiveHint").asBoolean());
    }

    @Test
    void activeExplorerSeesOnlyItsClosedWorldToolSurface() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "llm-tools"));
        server = new McpServer(state(Pipeline.run(List.of()), contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode listed = json(post("test-token", request(4, "tools/list", "{}")));
        List<String> names = listed.at("/result/tools").findValuesAsText("name");

        assertEquals(12, names.size());
        assertTrue(names.contains("flowscope_target_read"));
        assertTrue(names.contains("flowscope_browser_navigate"));
        assertTrue(names.contains("flowscope_browser_snapshot"));
        assertTrue(names.contains("flowscope_browser_interact"));
        assertTrue(names.contains("flowscope_browser_close"));
        assertTrue(names.contains("flowscope_list_route_candidates"));
        assertTrue(names.contains("flowscope_end_run"));
        assertFalse(names.contains("flowscope_set_scope"));
        assertFalse(names.contains("flowscope_lock_dataset"));
        assertFalse(names.contains("flowscope_list_candidates"));
        assertFalse(names.contains("flowscope_zap_baseline"));
        assertFalse(names.contains("flowscope_submit_validation"));
    }

    @Test
    void controlledBrowserIsExplorerOnlyAndReturnsDiscoveryNotEvidence() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "browser-run"));
        AtomicReference<String> target = new AtomicReference<>();
        AtomicReference<String> account = new AtomicReference<>();
        AtomicBoolean closed = new AtomicBoolean();
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
            @Override public ScopePolicy scope() { return ScopePolicy.parse("https://api.example.test/v1"); }
            @Override public void updateScope(String value) { throw new UnsupportedOperationException(); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String value) { return false; }
            @Override public ControlledBrowserExplorer.Snapshot browserNavigate(
                    String runId, String value, String accountId) {
                target.set(value);
                account.set(accountId);
                return browserSnapshotValue(runId, value);
            }
            @Override public ControlledBrowserExplorer.Snapshot browserSnapshot(String runId) {
                return browserSnapshotValue(runId, target.get());
            }
            @Override public void browserClose(String runId) { closed.set(true); }
            @Override public boolean browserAvailable() { return true; }
        }, 0, "test-token");
        server.start();

        JsonNode navigated = tool("flowscope_browser_navigate",
                "{\"target\":\"https://api.example.test/v1/dashboard\"}");
        assertFalse(navigated.at("/result/isError").asBoolean(), navigated.toString());
        assertEquals("https://api.example.test/v1/dashboard", target.get());
        assertNull(account.get());
        assertEquals("DISCOVERY_ONLY", navigated.at("/result/structuredContent/evidence_status").asText());
        assertTrue(navigated.at("/result/structuredContent/evidence_id").isMissingNode());
        assertEquals("https://api.example.test/v1/orders",
                navigated.at("/result/structuredContent/network/0/url").asText());
        JsonNode browserFrontier = tool("flowscope_list_route_candidates",
                "{\"view\":\"INDEPENDENT\"}");
        assertFalse(browserFrontier.at("/result/isError").asBoolean(), browserFrontier.toString());
        assertEquals(1, browserFrontier.at("/result/structuredContent/total").asInt());
        assertEquals("/v1/orders",
                browserFrontier.at("/result/structuredContent/routes/0/path_template").asText());
        assertFalse(browserFrontier.at("/result/structuredContent/routes/0/evidence_backed").asBoolean());
        assertEquals("BROWSER_RUNTIME",
                browserFrontier.at("/result/structuredContent/routes/0/provenance/0/type").asText());

        assertFalse(tool("flowscope_browser_close", "{}").at("/result/isError").asBoolean());
        assertTrue(closed.get());
        assertTrue(tool("flowscope_browser_navigate",
                "{\"target\":\"https://outside.example/\"}").at("/result/isError").asBoolean());
    }

    @Test
    void browserUsageIsRecordedEvenWhenRenderedPageDiscoversNoNetworkRoute() throws Exception {
        String runId = "browser-empty-run";
        RequestRecord entry = observationAt(Source.LLM, "A", 200,
                "<html><script>window.app = true</script></html>",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1");
        entry.responseContentType = "text/html";
        Pipeline.Result result = Pipeline.run(List.of(entry));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return result; }
            @Override public ScopePolicy scope() { return ScopePolicy.parse("https://api.example.test/v1"); }
            @Override public void updateScope(String value) { throw new UnsupportedOperationException(); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String value) { return false; }
            @Override public ControlledBrowserExplorer.Snapshot browserNavigate(
                    String activeRunId, String target, String accountId) {
                return new ControlledBrowserExplorer.Snapshot(activeRunId, target, "Shell", "",
                        List.of(), List.of(), true);
            }
            @Override public boolean browserAvailable() { return true; }
        }, 0, "test-token");
        server.start();

        assertFalse(tool("flowscope_browser_navigate",
                "{\"target\":\"https://api.example.test/v1\"}").at("/result/isError").asBoolean());
        JsonNode frontier = tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}");

        assertTrue(frontier.at("/result/structuredContent/explorer_guidance/browser_used").asBoolean());
        assertFalse(frontier.at("/result/structuredContent/explorer_guidance/rendered_discovery_recommended")
                .asBoolean());
        assertEquals("REVIEW_ASSISTED_FRONTIER",
                frontier.at("/result/structuredContent/explorer_guidance/next_action").asText());
    }

    @Test
    void refusesToLockCompletedButEmptyExplorationLanes() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        completeAll(contexts);
        server = new McpServer(state(Pipeline.run(List.of()), contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode lock = tool("flowscope_lock_dataset", "{}");
        assertTrue(lock.at("/result/isError").asBoolean());
        assertTrue(lock.at("/result/structuredContent/error").asText().contains("trusted coverage Evidence"));
    }

    @Test
    void refusesToCompleteExplorerWithoutCapturedResponseEvidence() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "empty-explorer"));
        server = new McpServer(state(Pipeline.run(List.of()), contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode ended = tool("flowscope_end_run",
                "{\"source\":\"LLM\",\"run_id\":\"empty-explorer\"}");

        assertTrue(ended.at("/result/isError").asBoolean());
        assertTrue(ended.at("/result/structuredContent/error").asText().contains("response Evidence"));
        assertNotNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void explorerCannotReadCrossSourceStateAndJudgeCannotStartBeforeDatasetLock() throws Exception {
        RequestRecord human = observation(Source.HUMAN, "A", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.BROWSER, RunPhase.EXPLORATION, "human-1");
        RequestRecord llm = observation(Source.LLM, "B", 200, "{\"id\":8,\"owner\":\"user-b\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "explore-1");
        RequestRecord scanner = laneMarker(Source.SCANNER);
        scanner.runId = "scanner-1";
        Pipeline.Result result = Pipeline.run(List.of(human, llm, scanner));
        RouteCandidate shared = new RouteCandidate("https://api.example.test:443", "GET", "/v1/shared/{id}", true,
                List.of(
                        routeProvenance(RouteCandidate.ProvenanceType.OBSERVED_REQUEST, human.evidenceId,
                                Source.HUMAN, "human-1", RouteCandidate.Applicability.APPLICABLE, "human observed"),
                        routeProvenance(RouteCandidate.ProvenanceType.OPENAPI, scanner.evidenceId,
                                Source.SCANNER, "scanner-1", RouteCandidate.Applicability.APPLICABLE, "scanner schema"),
                        routeProvenance(RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, llm.evidenceId,
                                Source.LLM, "explore-1", RouteCandidate.Applicability.REVIEW, "llm literal")),
                RouteCandidate.Applicability.APPLICABLE, "human observed");
        RouteCandidate humanOnly = new RouteCandidate("https://api.example.test:443", "POST", "/v1/admin", false,
                List.of(routeProvenance(RouteCandidate.ProvenanceType.OPENAPI, human.evidenceId,
                        Source.HUMAN, "human-1", RouteCandidate.Applicability.APPLICABLE, "human OpenAPI")),
                RouteCandidate.Applicability.APPLICABLE, "human OpenAPI");
        RouteCandidate oldLlmOnly = new RouteCandidate("https://api.example.test:443", "GET", "/v1/old-llm", false,
                List.of(routeProvenance(RouteCandidate.ProvenanceType.HTML_LINK, "old-llm-evidence",
                        Source.LLM, "old-llm-run", RouteCandidate.Applicability.REVIEW, "old LLM")),
                RouteCandidate.Applicability.REVIEW, "old LLM");
        AtomicReference<List<RouteCandidate>> routeCandidates = new AtomicReference<>(
                List.of(shared, humanOnly, oldLlmOnly));
        RunContextRegistry contexts = new RunContextRegistry();
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "human-1", result);
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "scanner-1", result);
        server = new McpServer(state(new AtomicReference<>(result), contexts,
                ScopePolicy.parse("https://api.example.test/v1"), new AnalysisConfig(), routeCandidates),
                0, "test-token");
        server.start();

        JsonNode preRun = tool("flowscope_get_status", "{}");
        assertTrue(preRun.at("/result/structuredContent/source_counts").isEmpty());
        assertTrue(preRun.at("/result/structuredContent/captured_records").isMissingNode());
        assertTrue(preRun.at("/result/structuredContent/active_runs/HUMAN").isMissingNode());

        JsonNode prematureJudge = tool("flowscope_begin_llm_run",
                "{\"phase\":\"COACH_PROBE\",\"tool\":\"CODEX\",\"run_id\":\"judge-early\"}");
        assertTrue(prematureJudge.at("/result/isError").asBoolean());

        JsonNode began = tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"explore-1\"}");
        assertFalse(began.at("/result/isError").asBoolean());
        JsonNode status = tool("flowscope_get_status", "{}");
        assertTrue(status.at("/result/structuredContent/independent_explorer_view").asBoolean());
        assertTrue(status.at("/result/structuredContent/source_counts/HUMAN").isMissingNode());
        assertTrue(status.at("/result/structuredContent/coverage_source_counts/HUMAN").isMissingNode());
        assertEquals(1, status.at("/result/structuredContent/captured_records").asInt());
        assertEquals(1, status.at("/result/structuredContent/coverage_records").asInt());
        assertEquals(1, status.at("/result/structuredContent/route_candidates").asInt());
        JsonNode explorerRoutes = tool("flowscope_list_route_candidates", "{}");
        assertFalse(explorerRoutes.at("/result/isError").asBoolean(), explorerRoutes.toString());
        assertEquals(1, explorerRoutes.at("/result/structuredContent/total").asInt());
        assertEquals("LLM", explorerRoutes.at("/result/structuredContent/routes/0/provenance/0/source").asText());
        assertFalse(explorerRoutes.at("/result/structuredContent/routes/0/observed").asBoolean());
        assertEquals("REVIEW", explorerRoutes.at("/result/structuredContent/routes/0/applicability").asText());
        JsonNode assistedRoutes = tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}");
        assertFalse(assistedRoutes.at("/result/isError").asBoolean(), assistedRoutes.toString());
        assertTrue(assistedRoutes.at("/result/structuredContent/provenance_redacted").asBoolean());
        assertEquals(0, assistedRoutes.at("/result/structuredContent/routes/0/provenance").size());
        assertEquals("BLIND_CROSS_LANE",
                assistedRoutes.at("/result/structuredContent/routes/0/hint_origin").asText());
        assertFalse(assistedRoutes.toString().contains("human-1"));
        assertFalse(assistedRoutes.toString().contains(human.evidenceId));
        assertFalse(assistedRoutes.toString().contains("MULTIPLE_PROVENANCE"));
        assertFalse(assistedRoutes.toString().contains("/v1/old-llm"));
        assertTrue(tool("flowscope_list_candidates", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_list_assessments", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_list_validations", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_zap_baseline_status", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_get_evidence", "{\"evidence_id\":\"" + human.evidenceId + "\"}")
                .at("/result/isError").asBoolean());
        assertFalse(tool("flowscope_get_evidence", "{\"evidence_id\":\"" + llm.evidenceId + "\"}")
                .at("/result/isError").asBoolean());

        JsonNode ended = tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"explore-1\"}");
        assertFalse(ended.at("/result/isError").asBoolean(), ended.toString());
        JsonNode locked = tool("flowscope_lock_dataset", "{}");
        assertFalse(locked.at("/result/isError").asBoolean(), locked.toString());
        assertEquals(3, locked.at("/result/structuredContent/records").asInt());
        assertEquals(2, locked.at("/result/structuredContent/route_candidates").asInt());
        routeCandidates.set(List.of(new RouteCandidate("https://api.example.test:443", "GET", "/v1/late", false,
                List.of(routeProvenance(RouteCandidate.ProvenanceType.HTML_LINK, "late", Source.LLM,
                        "validation-late", RouteCandidate.Applicability.REVIEW, "late")),
                RouteCandidate.Applicability.REVIEW, "late")));
        JsonNode lockedRoutes = tool("flowscope_list_route_candidates", "{}");
        assertEquals(2, lockedRoutes.at("/result/structuredContent/total").asInt(),
                "dataset lock 이후 route candidate도 고정돼야 함");
        assertFalse(tool("flowscope_list_candidates", "{}").at("/result/isError").asBoolean());
        assertFalse(tool("flowscope_begin_llm_run",
                "{\"phase\":\"COACH_PROBE\",\"tool\":\"CODEX\",\"run_id\":\"judge-1\"}")
                .at("/result/isError").asBoolean());
    }

    @Test
    void explorerMustExhaustIndependentThenBlindAssistedSafeFrontiers() throws Exception {
        String runId = "explore-frontier";
        RequestRecord entry = observationAt(Source.LLM, "A", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1");
        RequestRecord human = observation(Source.HUMAN, "A", 200, "{\"ok\":true}",
                SourceDetail.BROWSER, RunPhase.EXPLORATION, "human-frontier");
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(List.of(entry, human)));
        AtomicReference<List<RouteCandidate>> routes = new AtomicReference<>(List.of(
                candidate("GET", "/v1/next", false, entry.evidenceId, Source.LLM, runId,
                        RouteCandidate.ProvenanceType.HTML_LINK),
                candidate("GET", "/v1/admin-info", true, human.evidenceId, Source.HUMAN,
                        "human-frontier", RouteCandidate.ProvenanceType.OBSERVED_REQUEST)));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        server = new McpServer(state(result, contexts, ScopePolicy.parse("https://api.example.test/v1"),
                new AnalysisConfig(), routes), 0, "test-token");
        server.start();

        JsonNode independent = tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}");
        assertEquals(1, independent.at("/result/structuredContent/remaining_safe_concrete").asInt());
        assertTrue(tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}")
                .at("/result/isError").asBoolean());

        RequestRecord ownNext = observationAt(Source.LLM, "A", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1/next");
        result.set(Pipeline.run(List.of(entry, human, ownNext)));
        routes.set(List.of(
                candidate("GET", "/v1/next", true, ownNext.evidenceId, Source.LLM, runId,
                        RouteCandidate.ProvenanceType.OBSERVED_REQUEST),
                candidate("GET", "/v1/admin-info", true, human.evidenceId, Source.HUMAN,
                        "human-frontier", RouteCandidate.ProvenanceType.OBSERVED_REQUEST)));

        JsonNode assisted = tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}");
        assertFalse(assisted.at("/result/isError").asBoolean(), assisted.toString());
        assertEquals(1, assisted.at("/result/structuredContent/remaining_safe_concrete").asInt());
        assertTrue(tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}")
                .at("/result/isError").asBoolean());

        RequestRecord ownAdmin = observationAt(Source.LLM, "A", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1/admin-info");
        result.set(Pipeline.run(List.of(entry, human, ownNext, ownAdmin)));
        routes.set(List.of(
                candidate("GET", "/v1/next", true, ownNext.evidenceId, Source.LLM, runId,
                        RouteCandidate.ProvenanceType.OBSERVED_REQUEST),
                candidate("GET", "/v1/admin-info", true, human.evidenceId, Source.HUMAN,
                        "human-frontier", RouteCandidate.ProvenanceType.OBSERVED_REQUEST),
                candidate("GET", "/v1/admin-info", true, ownAdmin.evidenceId, Source.LLM, runId,
                        RouteCandidate.ProvenanceType.OBSERVED_REQUEST)));
        assertEquals(0, tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}")
                .at("/result/structuredContent/remaining_safe_concrete").asInt());
        JsonNode ended = tool("flowscope_end_run",
                "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}");
        assertFalse(ended.at("/result/isError").asBoolean(), ended.toString());
    }

    @Test
    void explorerReceivesConcreteObjectPathsAndCannotFinishBeforeRequestingThem() throws Exception {
        String runId = "explore-concrete-object";
        RequestRecord entry = observationAt(Source.LLM, "A", 200, "<html><script src='/app.js'></script></html>",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1");
        entry.responseContentType = "text/html";
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(List.of(entry)));
        RouteCandidate.Provenance provenance = routeProvenance(RouteCandidate.ProvenanceType.HTML_LINK,
                entry.evidenceId, Source.LLM, runId, RouteCandidate.Applicability.REVIEW, "object link");
        AtomicReference<List<RouteCandidate>> routes = new AtomicReference<>(List.of(new RouteCandidate(
                "https://api.example.test:443", "UNKNOWN", "/v1/orders/{id}",
                List.of("/v1/orders/42?detail=full"), false, false, List.of(provenance),
                RouteCandidate.Applicability.REVIEW, "discovered object path")));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        server = new McpServer(state(result, contexts, ScopePolicy.parse("https://api.example.test/v1"),
                new AnalysisConfig(), routes), 0, "test-token");
        server.start();

        JsonNode frontier = tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}");
        assertEquals(1, frontier.at("/result/structuredContent/remaining_safe_concrete").asInt());
        assertEquals("/v1/orders/42?detail=full",
                frontier.at("/result/structuredContent/routes/0/pending_concrete_paths/0").asText());
        assertTrue(frontier.at("/result/structuredContent/routes/0/review_dimensions").toString()
                .contains("OBJECT_AUTHORIZATION"));
        assertEquals("REQUEST_INDEPENDENT_SAFE_FRONTIER",
                frontier.at("/result/structuredContent/explorer_guidance/next_action").asText());
        assertTrue(tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}")
                .at("/result/isError").asBoolean());

        RequestRecord visited = observationAt(Source.LLM, "A", 200, "{\"id\":42}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1/orders/42");
        visited.query = "detail=full";
        result.set(Pipeline.run(List.of(entry, visited)));
        routes.set(List.of(new RouteCandidate("https://api.example.test:443", "UNKNOWN", "/v1/orders/{id}",
                List.of("/v1/orders/42?detail=full"), false, true, List.of(provenance),
                RouteCandidate.Applicability.APPLICABLE, "visited object path")));

        JsonNode exhausted = tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}");
        assertEquals(0, exhausted.at("/result/structuredContent/remaining_safe_concrete").asInt());
        assertTrue(List.of("BROWSER_DISCOVERY_RECOMMENDED", "BROWSER_UNAVAILABLE_CONTINUE_PARTIAL")
                .contains(exhausted.at("/result/structuredContent/explorer_guidance/next_action").asText()));

        JsonNode assisted = tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}");
        assertEquals(0, assisted.at("/result/structuredContent/remaining_safe_concrete").asInt());
        JsonNode ended = tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}");
        assertFalse(ended.at("/result/isError").asBoolean(), ended.toString());
        assertEquals("PARTIAL_WITH_LIMITATIONS",
                ended.at("/result/structuredContent/completion_quality").asText());
        assertEquals(1, ended.at("/result/structuredContent/coverage_limitations").size());
        assertTrue(Set.of("RENDERED_DISCOVERY_NOT_USED", "SUPPORTED_BROWSER_UNAVAILABLE").contains(
                ended.at("/result/structuredContent/coverage_limitations/0").asText()));
    }

    @Test
    void explorerCompletionCountsControlledVisitedRoutesEvenWhenTheyAreExcludedFromCoverage() throws Exception {
        String runId = "explore-navigation";
        RequestRecord entry = observationAt(Source.LLM, "A", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1");
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(List.of(entry)));
        AtomicReference<List<RouteCandidate>> routes = new AtomicReference<>(List.of(
                candidate("GET", "/login", false, entry.evidenceId, Source.LLM, runId,
                        RouteCandidate.ProvenanceType.HTML_LINK)));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        server = new McpServer(state(result, contexts, ScopePolicy.parse("https://api.example.test/"),
                new AnalysisConfig(), routes), 0, "test-token");
        server.start();

        assertEquals(1, tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}")
                .at("/result/structuredContent/remaining_safe_concrete").asInt());

        RequestRecord visited = observationAt(Source.LLM, "A", 200, "<html>login</html>",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/login");
        visited.responseContentType = "text/html";
        visited.secFetchDest = "document";
        result.set(Pipeline.run(List.of(entry, visited)));
        assertTrue(result.get().coverageRecords.stream().noneMatch(record -> record.path.equals("/login")),
                "navigation Evidence는 분석 그래프에는 들어가지 않아야 한다");

        JsonNode assisted = tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}");
        assertFalse(assisted.at("/result/isError").asBoolean(), assisted.toString());
        assertEquals(0, assisted.at("/result/structuredContent/remaining_safe_concrete").asInt());
        JsonNode ended = tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}");
        assertFalse(ended.at("/result/isError").asBoolean(), ended.toString());
    }

    @Test
    void replacesExactScopeThroughAuthenticatedMcp() throws Exception {
        server = new McpServer(state(Pipeline.run(List.of()), new RunContextRegistry(),
                ScopePolicy.parse("")), 0, "test-token");
        server.start();

        JsonNode changed = tool("flowscope_set_scope",
                "{\"scope\":\"http://127.0.0.1:8888/\"}");
        assertFalse(changed.at("/result/isError").asBoolean(), changed.toString());
        assertEquals("http://127.0.0.1:8888/",
                changed.at("/result/structuredContent/scope/0").asText());
        assertEquals("http://127.0.0.1:8888/",
                tool("flowscope_get_status", "{}").at("/result/structuredContent/scope/0").asText());

        JsonNode invalid = tool("flowscope_set_scope",
                "{\"scope\":\"http://127.0.0.1:8888/?unsafe=true\"}");
        assertTrue(invalid.at("/result/isError").asBoolean());
        assertEquals("http://127.0.0.1:8888/",
                tool("flowscope_get_status", "{}").at("/result/structuredContent/scope/0").asText());
    }

    @Test
    void controlledTargetRequestEnforcesScopeAndOwnsAuthenticationHeaders() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<McpServer.TargetRequest> captured = new AtomicReference<>();
        AtomicReference<ScopePolicy> scope = new AtomicReference<>(ScopePolicy.parse("https://api.example.test/v1"));
        AnalysisConfig config = new AnalysisConfig();
        AccountProfile account = new AccountProfile("user-a", "USER A", "https://api.example.test", AccessRole.USER);
        config.upsertAccount(account);
        SessionBroker sessions = new SessionBroker();
        String handle = sessions.beginCapture(account, java.time.Instant.now());
        sessions.observeRequest(handle, URI.create("https://api.example.test/login"),
                java.util.Map.of("Authorization", "Bearer raw-user-a"), java.time.Instant.now());
        sessions.observeResponse(handle, URI.create("https://api.example.test/v1/account"), 200,
                null, "{}", List.of(), java.time.Instant.now());
        sessions.endCapture(handle);
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
            @Override public ScopePolicy scope() { return scope.get(); }
            @Override public void updateScope(String value) { scope.set(ScopePolicy.parse(value)); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return config; }
            @Override public SessionBroker sessions() { return sessions; }
            @Override public boolean approve(String action, String target) { return false; }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                captured.set(request);
                return new McpServer.TargetResult("ev-0123456789abcdef", 200, null,
                        "HTTP/1.1 200 OK\r\nSet-Cookie: session=raw-secret\r\n\r\n{\"ok\":true}",
                        "{\"access_token\":\"raw-token\"}");
            }
        }, 0, "test-token");
        server.start();
        assertFalse(tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"explore-1\","
                        + "\"account_id\":\"user-a\"}")
                .at("/result/isError").asBoolean());

        JsonNode accepted = tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"Accept\":\"application/json\"}}");
        assertFalse(accepted.at("/result/isError").asBoolean(), accepted.toString());
        assertEquals("https://api.example.test/v1/orders", captured.get().target());
        assertEquals("user-a", captured.get().accountId());
        assertFalse(accepted.toString().contains("raw-secret"));
        assertFalse(accepted.toString().contains("raw-token"));
        assertEquals("CONTROLLED", accepted.at("/result/structuredContent/execution_trust").asText());

        assertTrue(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://outside.example/v1\"}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"Authorization\":\"Bearer injected\"}}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"X-Test\":\"ok\\r\\nInjected: value\"}}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"account_id\":\"missing\"}").at("/result/isError").asBoolean());
        JsonNode accountOverride = tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"account_id\":\"user-b\"}");
        assertTrue(accountOverride.at("/result/isError").asBoolean());
        assertTrue(accountOverride.at("/result/content/0/text").asText().contains("fixed by the active run"));
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"DELETE\",\"target\":\"https://api.example.test/v1/orders/7\"," +
                        "\"confirmed\":true}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"}")
                .at("/result/isError").asBoolean());
    }

    @Test
    void recordsTransportFailureSeparatelyFromEvidenceAndRejectsAllFailedCompletion() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<ScopePolicy> scope = new AtomicReference<>(ScopePolicy.parse("https://api.example.test/v1"));
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
            @Override public ScopePolicy scope() { return scope.get(); }
            @Override public void updateScope(String value) { scope.set(ScopePolicy.parse(value)); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String target) { return true; }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                throw new McpServer.TargetExecutionException(RunExecutionLedger.Outcome.TLS_FAILURE,
                        "TLS 인증서 검증 때문에 대상 요청이 전송되지 않았습니다.");
            }
        }, 0, "test-token");
        server.start();
        assertFalse(tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"tls-failed\"}")
                .at("/result/isError").asBoolean());

        JsonNode request = tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders?token=secret\"}");
        assertTrue(request.at("/result/isError").asBoolean());
        RunExecutionLedger.Summary summary = server.executionSummary(Source.LLM, "tls-failed");
        assertEquals(RunExecutionLedger.Quality.ALL_FAILED, summary.quality());
        assertEquals(1, summary.failures());
        assertEquals("/v1/orders", server.executionAttempts().getFirst().path());
        assertFalse(server.executionAttempts().getFirst().path().contains("secret"));
        assertTrue(tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"tls-failed\"}")
                .at("/result/content/0/text").asText().contains("none returned an HTTP response"));
    }

    @Test
    void marksRunPartialWhenOneControlledRequestRespondsAndAnotherFails() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong calls = new AtomicLong();
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
            @Override public ScopePolicy scope() { return ScopePolicy.parse("https://api.example.test/v1"); }
            @Override public void updateScope(String value) { }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String target) { return true; }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                if (calls.getAndIncrement() == 0) return new McpServer.TargetResult(
                        "ev-0123456789abcdef", 200, null, "HTTP/1.1 200 OK", "{}");
                throw new McpServer.TargetExecutionException(RunExecutionLedger.Outcome.TIMEOUT,
                        "대상 요청이 제한시간 안에 응답하지 않았습니다.");
            }
        }, 0, "test-token");
        server.start();
        tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"partial\"}");
        assertFalse(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/one\"}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/two\"}")
                .at("/result/isError").asBoolean());

        RunExecutionLedger.Summary summary = server.executionSummary(Source.LLM, "partial");
        assertEquals(RunExecutionLedger.Quality.PARTIAL_FAILURE, summary.quality());
        assertEquals(2, summary.attempted());
        assertEquals(1, summary.responses());
        assertEquals(1, summary.failures());
    }

    @Test
    void completedExplorerReportsPartialControlledRequestFailureAsLimitation() throws Exception {
        String runId = "partial-completion";
        RequestRecord evidence = observationAt(Source.LLM, "A", 200, "{\"ok\":true}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, runId, "/v1/one");
        Pipeline.Result snapshot = Pipeline.run(List.of(evidence));
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong calls = new AtomicLong();
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return snapshot; }
            @Override public ScopePolicy scope() { return ScopePolicy.parse("https://api.example.test/v1"); }
            @Override public void updateScope(String value) { }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String target) { return true; }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                if (calls.getAndIncrement() == 0) return new McpServer.TargetResult(
                        evidence.evidenceId, 200, null, "HTTP/1.1 200 OK", "{}");
                throw new McpServer.TargetExecutionException(RunExecutionLedger.Outcome.CONNECTION_FAILURE,
                        "대상 서버 연결에 실패했습니다.");
            }
        }, 0, "test-token");
        server.start();
        tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"" + runId + "\"}");
        tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/one\"}");
        tool("flowscope_target_read",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/two\"}");
        tool("flowscope_list_route_candidates", "{\"view\":\"INDEPENDENT\"}");
        tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}");

        JsonNode ended = tool("flowscope_end_run",
                "{\"source\":\"LLM\",\"run_id\":\"" + runId + "\"}");
        assertFalse(ended.at("/result/isError").asBoolean(), ended.toString());
        assertEquals("PARTIAL_WITH_LIMITATIONS",
                ended.at("/result/structuredContent/completion_quality").asText());
        assertTrue(ended.at("/result/structuredContent/coverage_limitations").toString()
                .contains("CONTROLLED_REQUEST_FAILURES_PRESENT"));
        assertEquals("PARTIAL_FAILURE",
                ended.at("/result/structuredContent/execution_summary/quality").asText());
    }

    @Test
    void readsAjaxSpiderStatusWithoutAScanIdAndClearsItsLease() throws Exception {
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> {
            byte[] body = "{\"status\":\"stopped\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        zapServer.start();
        try {
            RunContextRegistry contexts = new RunContextRegistry();
            contexts.activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_AJAX_SPIDER,
                    Orchestrator.LLM, ToolKind.ZAP, RunPhase.EXPLORATION, "ajax-1"));
            AtomicReference<ScopePolicy> scope = new AtomicReference<>(ScopePolicy.parse("https://api.example.test/v1"));
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return scope.get(); }
                @Override public void updateScope(String value) { scope.set(ScopePolicy.parse(value)); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String target) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode status = tool("flowscope_zap_status", "{\"scan_type\":\"ajax\"}");
            assertFalse(status.at("/result/isError").asBoolean(), status.toString());
            assertEquals("stopped", status.at("/result/structuredContent/status").asText());
            assertEquals("ajax-1", status.at("/result/structuredContent/run_id").asText());
            assertEquals(0, status.at("/result/structuredContent/captured_records").asInt());
            assertEquals("NO_SCANNER_TRAFFIC_CAPTURED",
                    status.at("/result/structuredContent/warning_code").asText());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void cancellingZapBaselineStopsOwnedCrawlerClearsCapabilityAndAbortsRun() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicBoolean spiderStarted = new AtomicBoolean();
        AtomicBoolean spiderStopped = new AtomicBoolean();
        AtomicReference<String> capabilityRun = new AtomicReference<>("");
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            spiderStarted.set(true);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange,
                spiderStopped.get() ? "{\"status\":\"100\"}" : "{\"status\":\"0\"}"));
        zapServer.createContext("/JSON/spider/action/stop/", exchange -> {
            spiderStopped.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
                @Override public void scannerCapability(String runId, String capability) {
                    capabilityRun.set(runId);
                }
                @Override public void clearScannerCapability(String runId) {
                    capabilityRun.compareAndSet(runId, "");
                }
            }, 0, "test-token");

            JsonNode started = server.startDeterministicZapCampaign(target, List.of(), true);
            assertEquals("RUNNING", started.path("status").asText());
            for (int i = 0; i < 100 && !spiderStarted.get(); i++) Thread.sleep(10);
            assertTrue(spiderStarted.get());

            JsonNode cancelled = server.cancelDeterministicZapBaseline();

            assertEquals("CANCELLED", cancelled.path("status").asText(), cancelled.toString());
            assertTrue(spiderStopped.get());
            assertEquals("", capabilityRun.get());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void zapCampaignFailsFastWhenBurpRejectsMissingRunCapability() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong rejected = new AtomicLong();
        AtomicBoolean clientStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            rejected.incrementAndGet();
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientStarted.set(true);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
                @Override public long scannerCapabilityRejections(String runId) {
                    return rejected.get();
                }
            }, 0, "test-token");

            server.startDeterministicZapCampaign(target, List.of(), true);
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.path("status").asText())) break;
                Thread.sleep(10);
            }

            assertNotNull(status);
            assertEquals("FAILED", status.path("status").asText(), status.toString());
            assertEquals(1, status.path("capability_rejected_requests").asLong());
            assertTrue(status.path("error").asText().contains("run capability"), status.toString());
            assertFalse(clientStarted.get(), "a rejected lane must not advance to the next crawler");
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void zapSessionSetupPublishesWorkerHeartbeatWhileApiResponseIsPending() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicBoolean sessionRequestStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> {
            sessionRequestStarted.set(true);
            try { Thread.sleep(1_400); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> zapReply(exchange,
                "{\"scan\":\"1\"}"));
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"100\"}"));
        zapServer.start();
        String previousHeartbeat = System.getProperty("flowscope.zap.workerHeartbeat.ms");
        try {
            System.setProperty("flowscope.zap.workerHeartbeat.ms", "20");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");

            server.startDeterministicZapCampaign(target, List.of(), true);
            for (int i = 0; i < 100 && !sessionRequestStarted.get(); i++) Thread.sleep(5);
            assertTrue(sessionRequestStarted.get());
            Thread.sleep(1_150);

            JsonNode status = server.deterministicZapBaselineStatus();
            assertEquals("RUNNING", status.path("status").asText(), status.toString());
            assertEquals("SESSION_SETUP", status.at("/lanes/0/stage").asText());
            assertEquals(0, status.path("last_heartbeat_age_seconds").asLong());
            assertTrue(status.path("heartbeat_status").asText().contains("응답 대기"), status.toString());
            assertEquals("WAITING_FOR_ZAP_RESPONSE", status.path("activity_state").asText());
        } finally {
            restoreProperty("flowscope.zap.workerHeartbeat.ms", previousHeartbeat);
            zapServer.stop(0);
        }
    }

    @Test
    void deterministicZapBaselineImportsExplicitDefinitionRunsSpidersWaitsForPassiveAndPublishesAlerts() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        Pipeline.Result initial = Pipeline.run(records.get());
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human", initial);
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm", initial);
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 501);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        AtomicReference<String> definitionQuery = new AtomicReference<>();
        zapServer.createContext("/JSON/openapi/action/importUrl/", exchange -> {
            definitionQuery.set(exchange.getRequestURI().getRawQuery());
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_AJAX_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            zapReply(exchange, query != null && query.contains("start=500")
                    ? zapAlertsPage(500, 1) : zapAlertsPage(0, 500));
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse("http://127.0.0.1:8888/"); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String target) {
                    return action.contains("API 정의");
                }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"http://127.0.0.1:8888/\",\"run_id\":\"zap-baseline-1\","
                            + "\"definitions\":[{\"type\":\"OPENAPI\","
                            + "\"url\":\"http://127.0.0.1:8888/openapi.json\"}]}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED", status.at("/result/structuredContent/status").asText(), status.toString());
            assertEquals("ALERTS_READY", status.at("/result/structuredContent/stage").asText());
            assertEquals(1, status.at("/result/structuredContent/definition_count").asInt());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/definition_imports").asInt());
            assertTrue(definitionQuery.get().contains("contextId="));
            assertEquals(501, status.at("/result/structuredContent/alert_count").asInt());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/traditional_captures").asInt());
            assertEquals(2, status.at("/result/structuredContent/lanes/0/rendered_captures").asInt());
            assertTrue(status.at("/result/structuredContent/lanes/0/ajax_executed").asBoolean());
            assertTrue(ajaxStarted.get(), "broad discovery must run both rendered spiders");
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());
            JsonNode alerts = tool("flowscope_zap_alerts",
                    "{\"target\":\"http://127.0.0.1:8888/\"}");
            assertEquals("BASELINE_SNAPSHOT", alerts.at("/result/structuredContent/source").asText());
            assertEquals(100, alerts.at("/result/structuredContent/returned").asInt());
            assertTrue(alerts.at("/result/structuredContent/has_more").asBoolean());
            assertFalse(alerts.toString().contains("raw-alert-secret"));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void deterministicZapBaselineFallsBackWhenClientCompletesWithoutRenderedTraffic() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        Pipeline.Result initial = Pipeline.run(records.get());
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human", initial);
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm", initial);
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_AJAX_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"rendered warning alert\"}]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"" + target + "\",\"run_id\":\"client-zero-rendered\"}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertTrue(ajaxStarted.get(), status.toString());
            assertEquals("COMPLETED_WITH_WARNINGS", status.at("/result/structuredContent/status").asText(),
                    status.toString());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/rendered_captures").asInt());
            assertTrue(status.at("/result/structuredContent/lanes/0/warning").asText()
                    .contains("completed without captured rendered traffic"));
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());
            JsonNode alerts = tool("flowscope_zap_alerts", "{\"target\":\"" + target + "\"}");
            assertEquals("BASELINE_SNAPSHOT", alerts.at("/result/structuredContent/source").asText());
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void passiveQueueStallPreservesCapturedTrafficAndAlertsAsTransparentPartialCompletion() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean queueCleared = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"stopped\"}"));
        zapServer.removeContext("/JSON/pscan/view/currentTasks/");
        zapServer.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                queueCleared.get() ? "{\"currentTasks\":[]}" : "{\"currentTasks\":[{\"name\":\"Slow rule\","
                        + "\"url\":\"http://127.0.0.1:8888/static/app.js\"}]}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                queueCleared.get() ? "{\"recordsToScan\":\"0\"}" : "{\"recordsToScan\":\"5\"}"));
        zapServer.removeContext("/JSON/pscan/action/clearQueue/");
        zapServer.createContext("/JSON/pscan/action/clearQueue/", exchange -> {
            queueCleared.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"partial alert\"}]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        String previousAbsolute = System.getProperty("flowscope.zap.passive.absolute.ms");
        String previousStall = System.getProperty("flowscope.zap.passive.stall.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            System.setProperty("flowscope.zap.passive.absolute.ms", "500");
            System.setProperty("flowscope.zap.passive.stall.ms", "100");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"" + target + "\",\"run_id\":\"passive-partial\"}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED_WITH_WARNINGS",
                    status.at("/result/structuredContent/status").asText(), status.toString());
            assertEquals(2, status.at("/result/structuredContent/captured_records").asInt());
            assertFalse(status.at("/result/structuredContent/lanes/0/passive_complete").asBoolean());
            assertEquals(5, status.at("/result/structuredContent/lanes/0/passive_remaining").asInt());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/alert_count").asInt());
            assertFalse(status.at("/result/structuredContent/lanes/0/alert_snapshot_complete").asBoolean());
            assertTrue(status.at("/result/structuredContent/lanes/0/warning").asText().contains("미처리 5건"));
            JsonNode events = status.at("/result/structuredContent/events");
            assertTrue(events.isArray());
            assertTrue(events.toString().contains("Passive queue 5건 남음"));
            assertTrue(events.toString().contains("Passive queue와 실행 작업 격리 정리 완료"));
            assertTrue(queueCleared.get());
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            restoreProperty("flowscope.zap.passive.absolute.ms", previousAbsolute);
            restoreProperty("flowscope.zap.passive.stall.ms", previousStall);
            zapServer.stop(0);
        }
    }

    @Test
    void earlyLaneFailureBlocksTheNextIdentityWhenBackgroundCleanupCannotFinish() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicLong spiderStarts = new AtomicLong();
        AnalysisConfig config = new AnalysisConfig();
        SessionBroker sessions = new SessionBroker();
        AccountProfile account = new AccountProfile("user-a", "USER A", target, AccessRole.USER);
        config.upsertAccount(account);
        String handle = sessions.beginCapture(account, java.time.Instant.now());
        sessions.observeRequest(handle, URI.create(target + "login"),
                java.util.Map.of("Authorization", "Bearer user-a"), java.time.Instant.now());
        sessions.observeResponse(handle, URI.create(target + "account"), 200, null, "{}", List.of(),
                java.time.Instant.now());
        sessions.endCapture(handle);

        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            spiderStarts.incrementAndGet();
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        AtomicBoolean spiderStopped = new AtomicBoolean();
        zapServer.createContext("/JSON/spider/view/status/", exchange -> {
            if (spiderStopped.get()) zapReply(exchange, "{\"status\":\"100\"}");
            else {
                byte[] body = "spider status failed".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            }
        });
        zapServer.createContext("/JSON/spider/action/stop/", exchange -> {
            spiderStopped.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"1\"}"));
        zapServer.removeContext("/JSON/pscan/view/currentTasks/");
        zapServer.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                "{\"currentTasks\":[{\"name\":\"Never ends\"}]}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"partial alert\"}]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        String previousAbsolute = System.getProperty("flowscope.zap.passive.absolute.ms");
        String previousStall = System.getProperty("flowscope.zap.passive.stall.ms");
        String previousCleanup = System.getProperty("flowscope.zap.passive.cleanup.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            System.setProperty("flowscope.zap.passive.absolute.ms", "500");
            System.setProperty("flowscope.zap.passive.stall.ms", "100");
            System.setProperty("flowscope.zap.passive.cleanup.ms", "100");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return config; }
                @Override public SessionBroker sessions() { return sessions; }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline", "{\"target\":\"" + target
                    + "\",\"run_id\":\"isolation-stop\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"user-a\"]}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("FAILED", status.at("/result/structuredContent/status").asText(), status.toString());
            assertEquals("NOT_RUN", status.at("/result/structuredContent/lanes/1/status").asText());
            assertEquals("BLOCKED_BY_ISOLATION", status.at("/result/structuredContent/lanes/1/stage").asText());
            assertTrue(status.at("/result/structuredContent/events").toString()
                    .contains("Passive background 작업이 제한시간 안에 종료되지 않음"));
            assertTrue(status.at("/result/structuredContent/events").toString()
                    .contains("이전 신원 격리 실패로 실행하지 않음"));
            assertEquals(1, spiderStarts.get(), "the account lane must not start with dirty passive work");
            assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            restoreProperty("flowscope.zap.passive.absolute.ms", previousAbsolute);
            restoreProperty("flowscope.zap.passive.stall.ms", previousStall);
            restoreProperty("flowscope.zap.passive.cleanup.ms", previousCleanup);
            zapServer.stop(0);
            sessions.close();
        }
    }

    @Test
    void failedClientSpiderIsStoppedBeforeAjaxFallbackStarts() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean clientStopped = new AtomicBoolean();
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        AtomicBoolean ajaxStartedAfterClientStop = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> {
            if (clientStopped.get()) zapReply(exchange, "{\"status\":{\"state\":\"COMPLETED\"}}");
            else {
                byte[] body = "client failed".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            }
        });
        zapServer.createContext("/JSON/clientSpider/action/stop/", exchange -> {
            clientStopped.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            ajaxStartedAfterClientStop.set(clientStopped.get());
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_AJAX_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"" + target + "\",\"run_id\":\"client-cleanup\"}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED_WITH_WARNINGS",
                    status.at("/result/structuredContent/status").asText(), status.toString());
            assertTrue(clientStopped.get());
            assertTrue(ajaxStarted.get());
            assertTrue(ajaxStartedAfterClientStop.get(),
                    "failed Client Spider must be stopped before AJAX fallback");
            assertTrue(status.at("/result/structuredContent/lanes/0/ajax_executed").asBoolean());
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            zapServer.stop(0);
        }
    }

    @Test
    void scannerCompletionUsesRawCaptureCounterInsteadOfPossiblyStalePipelineSnapshot() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong rawCaptures = new AtomicLong();
        AtomicReference<List<RequestRecord>> rawRecords = new AtomicReference<>(new ArrayList<>());
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            rawCaptures.incrementAndGet();
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(rawRecords.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            rawRecords.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public Pipeline.Result completionSnapshot() { return Pipeline.run(rawRecords.get()); }
                @Override public long capturedCount(Source source, String runId, SourceDetail detail) {
                    return source == Source.SCANNER && "raw-gate".equals(runId)
                            && (detail == null || detail == SourceDetail.ZAP_SPIDER) ? rawCaptures.get() : 0;
                }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"" + target + "\",\"run_id\":\"raw-gate\"}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED_WITH_WARNINGS", status.at("/result/structuredContent/status").asText(),
                    status.toString());
            assertEquals(1, status.at("/result/structuredContent/captured_records").asInt());
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void scannerCampaignResetsZapAndRunsAnonymousThenEachActiveAccount() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<String>> seenAccounts = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<String>> zapSessions = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean omitUserBTraffic = new AtomicBoolean(true);
        SessionBroker sessions = new SessionBroker();
        AnalysisConfig config = new AnalysisConfig();
        for (String accountId : List.of("user-a", "user-b")) {
            AccountProfile account = new AccountProfile(accountId, accountId.toUpperCase(), target, AccessRole.USER);
            config.upsertAccount(account);
            String handle = sessions.beginCapture(account, java.time.Instant.now());
            sessions.observeRequest(handle, URI.create(target + "login"),
                    java.util.Map.of("Authorization", "Bearer " + accountId), java.time.Instant.now());
            sessions.observeResponse(handle, URI.create(target + "account"), 200, null, "{}", List.of(),
                    java.time.Instant.now());
            sessions.endCapture(handle);
        }

        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> {
            List<String> copy = new ArrayList<>(zapSessions.get());
            copy.add(exchange.getRequestURI().getRawQuery());
            zapSessions.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            String account = context.accountId() == null ? "anonymous" : context.accountId();
            List<String> seen = new ArrayList<>(seenAccounts.get());
            seen.add(account);
            seenAccounts.set(seen);
            if (!(omitUserBTraffic.get() && account.equals("user-b"))) {
                List<RequestRecord> copy = new ArrayList<>(records.get());
                copy.add(observation(Source.SCANNER, account, 200, "{}",
                        SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
                records.set(copy);
            }
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            String account = context.accountId() == null ? "anonymous" : context.accountId();
            if (!(omitUserBTraffic.get() && account.equals("user-b"))) {
                List<RequestRecord> copy = new ArrayList<>(records.get());
                copy.add(observation(Source.SCANNER, account, 200, "{}",
                        SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
                records.set(copy);
            }
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            String account = context.accountId() == null ? "anonymous" : context.accountId();
            if (!(omitUserBTraffic.get() && account.equals("user-b"))) {
                List<RequestRecord> copy = new ArrayList<>(records.get());
                copy.add(observation(Source.SCANNER, account, 200, "{}",
                        SourceDetail.ZAP_AJAX_SPIDER, RunPhase.EXPLORATION, context.runId()));
                records.set(copy);
            }
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return config; }
                @Override public SessionBroker sessions() { return sessions; }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode failedStart = tool("flowscope_zap_baseline", "{\"target\":\"" + target
                    + "\",\"run_id\":\"campaign-1\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"user-a\",\"user-b\"]}");
            assertFalse(failedStart.at("/result/isError").asBoolean(), failedStart.toString());
            assertTrue(failedStart.at("/result/structuredContent/campaign_started_at").asLong() > 0);
            assertTrue(failedStart.at("/result/structuredContent/elapsed_seconds").asLong() >= 0);
            assertEquals(2, failedStart.at("/result/structuredContent/lanes/1/queue_position").asInt());
            assertEquals(3, failedStart.at("/result/structuredContent/lanes/1/queue_total").asInt());
            assertTrue(failedStart.at("/result/structuredContent/lanes/1/wait_reason").asText()
                    .contains("lane 완료 후 시작"));
            JsonNode failedStatus = null;
            for (int i = 0; i < 200; i++) {
                failedStatus = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(failedStatus.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(failedStatus);
            assertEquals("FAILED", failedStatus.at("/result/structuredContent/status").asText(),
                    failedStatus.toString());
            assertEquals("FAILED", failedStatus.at("/result/structuredContent/lanes/2/status").asText());
            assertEquals(List.of("anonymous", "user-a", "user-b"), seenAccounts.get());
            assertEquals(3, zapSessions.get().size());
            assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
            assertNull(contexts.current(Source.SCANNER));

            omitUserBTraffic.set(false);
            seenAccounts.set(new ArrayList<>());
            JsonNode started = tool("flowscope_zap_baseline", "{\"target\":\"" + target
                    + "\",\"run_id\":\"campaign-2\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"user-a\",\"user-b\"]}");
            assertFalse(started.at("/result/isError").asBoolean(), started.toString());
            JsonNode status = null;
            for (int i = 0; i < 200; i++) {
                status = tool("flowscope_zap_baseline_status", "{}");
                if (!"RUNNING".equals(status.at("/result/structuredContent/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED", status.at("/result/structuredContent/status").asText(), status.toString());
            assertEquals(List.of("anonymous", "user-a", "user-b"), seenAccounts.get());
            assertEquals(6, zapSessions.get().size());
            assertEquals(3, status.at("/result/structuredContent/lanes").size());
            assertEquals("user-b", status.at("/result/structuredContent/lanes/2/account_id").asText());
            assertTrue(status.at("/result/structuredContent/lanes/0/elapsed_seconds").asLong() >= 0);
            assertTrue(status.at("/result/structuredContent/lanes/0/stage_timeout_seconds").asLong() >= 0);
            assertFalse(status.at("/result/structuredContent/lanes/0/heartbeat_status").asText().isBlank());
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
            sessions.close();
        }
    }

    @Test
    void safeZapCampaignFailsBeforeActivationWhenRequiredPassiveOrDiscoveryAddonIsMissing() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        zapServer.createContext("/JSON/core/view/version/", exchange -> zapReply(exchange,
                "{\"version\":\"2.17.0\"}"));
        zapServer.createContext("/JSON/autoupdate/view/installedAddons/", exchange -> zapReply(exchange,
                "{\"installedAddons\":[{\"id\":\"spider\"}]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode result = tool("flowscope_zap_baseline",
                    "{\"target\":\"" + target + "\",\"run_id\":\"missing-addons\"}");
            assertTrue(result.at("/result/isError").asBoolean(), result.toString());
            assertTrue(result.at("/result/content/0/text").asText().contains("missing required safe ZAP add-on"));
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void explicitApiDefinitionsNeedBurpApprovalBeforeScannerActivation() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public void updateScope(String value) {}
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public AnalysisConfig config() { return new AnalysisConfig(); }
                @Override public boolean approve(String action, String value) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode result = tool("flowscope_zap_baseline", "{\"target\":\"" + target
                    + "\",\"definitions\":[{\"type\":\"OPENAPI\","
                    + "\"url\":\"http://127.0.0.1:8888/openapi.json\"}]}");

            assertTrue(result.at("/result/isError").asBoolean(), result.toString());
            assertTrue(result.at("/result/content/0/text").asText().contains("explicit Burp approval"));
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void refusesRemoteZapApi() {
        assertThrows(IllegalArgumentException.class,
                () -> new ZapClient("https://example.com:8089", ""));
    }

    @Test
    void distinguishesMalformedJsonFromInvalidJsonRpc() throws Exception {
        server = new McpServer(state(Pipeline.run(List.of()), new RunContextRegistry(),
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        HttpResponse<String> malformed = post("test-token", "{");
        assertEquals(400, malformed.statusCode());
        assertEquals(-32700, JSON.readTree(malformed.body()).at("/error/code").asInt());

        HttpResponse<String> invalid = post("test-token", "{\"jsonrpc\":\"1.0\",\"id\":4,\"method\":\"ping\"}");
        assertEquals(400, invalid.statusCode());
        assertEquals(-32600, JSON.readTree(invalid.body()).at("/error/code").asInt());
    }

    @Test
    void rejectsDnsRebindingHostHeader() throws Exception {
        server = new McpServer(state(Pipeline.run(List.of()), new RunContextRegistry(),
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        try (Socket socket = new Socket("127.0.0.1", server.port());
             PrintWriter writer = new PrintWriter(new OutputStreamWriter(socket.getOutputStream()), true);
             BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()))) {
            String body = request(1, "ping", "{}");
            writer.print("POST /mcp HTTP/1.1\r\nHost: evil.example:" + server.port()
                    + "\r\nAuthorization: Bearer test-token\r\nContent-Type: application/json\r\nContent-Length: "
                    + body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + "\r\n\r\n" + body);
            writer.flush();
            assertTrue(reader.readLine().contains("403"));
        }
    }

    @Test
    void acceptsFinalVerdictOnlyWithRepeatedCapturedValidationAndOwnerControl() throws Exception {
        List<RequestRecord> records = validationRecords(false);
        List<RequestRecord> lockedRecords = new ArrayList<>(records.subList(0, 2));
        lockedRecords.add(laneMarker(Source.SCANNER));
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(lockedRecords));
        AuthorizationAnalysis.Finding candidate = result.get().analysis.findings().stream()
                .filter(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA)
                .findFirst().orElseThrow();
        RequestRecord original = records.get(1);
        RequestRecord firstProbe = records.get(2);
        RequestRecord secondProbe = records.get(3);
        RequestRecord control = records.get(4);
        RunContextRegistry contexts = new RunContextRegistry();
        completeAll(contexts, result.get());
        server = new McpServer(state(result, contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode locked = tool("flowscope_lock_dataset", "{}");
        assertFalse(locked.at("/result/isError").asBoolean(), locked.toString());
        List<RequestRecord> currentRecords = new ArrayList<>(records);
        currentRecords.add(laneMarker(Source.SCANNER));
        result.set(Pipeline.run(currentRecords));

        JsonNode tooWeak = tool("flowscope_submit_validation", validationJson(candidate.id(), "CONFIRMED",
                List.of(original.evidenceId), List.of(firstProbe.evidenceId), List.of(control.evidenceId)));
        assertTrue(tooWeak.at("/result/isError").asBoolean());

        JsonNode accepted = tool("flowscope_submit_validation", validationJson(candidate.id(), "CONFIRMED",
                List.of(original.evidenceId), List.of(firstProbe.evidenceId, secondProbe.evidenceId),
                List.of(control.evidenceId)));
        assertFalse(accepted.at("/result/isError").asBoolean(), accepted.toString());
        assertEquals("CONFIRMED", accepted.at("/result/structuredContent/verdict").asText());
        assertEquals("validation-1", accepted.at("/result/structuredContent/run_id").asText());
        assertEquals(1, server.validations().size());
        JsonNode captured = tool("flowscope_list_evidence",
                "{\"run_id\":\"validation-1\",\"source\":\"LLM\",\"phase\":\"VALIDATION\"}");
        assertEquals(3, captured.at("/result/structuredContent/total").asInt());
        assertEquals(3, captured.at("/result/structuredContent/records").size());

        ValidationDecision restored = new ValidationDecision(candidate.id(),
                ValidationDecision.FinalVerdict.CONFIRMED, "restored valid project value",
                List.of(original.evidenceId), List.of(firstProbe.evidenceId, secondProbe.evidenceId),
                List.of(control.evidenceId), "validation-1", java.time.Instant.now());
        server.resetWorkflow();
        server.replaceValidations(List.of(restored));
        assertEquals(1, server.validations().size(),
                "project restore must reconstruct the pre-Judge candidate snapshot");

        ValidationDecision forged = new ValidationDecision(candidate.id(),
                ValidationDecision.FinalVerdict.CONFIRMED, "forged project value",
                List.of(original.evidenceId), List.of(firstProbe.evidenceId), List.of(control.evidenceId),
                "validation-1", java.time.Instant.now());
        server.replaceValidations(List.of(forged));
        assertTrue(server.validations().isEmpty(), "복원된 최종 판정도 반복·대조 검증을 다시 통과해야 함");
    }

    @Test
    void rejectedVerdictMustBeBackedByRepeatedExplicitDenials() throws Exception {
        List<RequestRecord> records = validationRecords(true);
        List<RequestRecord> lockedRecords = new ArrayList<>(records.subList(0, 2));
        lockedRecords.add(laneMarker(Source.SCANNER));
        AtomicReference<Pipeline.Result> result = new AtomicReference<>(Pipeline.run(lockedRecords));
        AuthorizationAnalysis.Finding candidate = result.get().analysis.findings().stream()
                .filter(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA)
                .findFirst().orElseThrow();
        RunContextRegistry contexts = new RunContextRegistry();
        completeAll(contexts, result.get());
        server = new McpServer(state(result, contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        JsonNode locked = tool("flowscope_lock_dataset", "{}");
        assertFalse(locked.at("/result/isError").asBoolean(), locked.toString());
        List<RequestRecord> currentRecords = new ArrayList<>(records);
        currentRecords.add(laneMarker(Source.SCANNER));
        result.set(Pipeline.run(currentRecords));

        JsonNode accepted = tool("flowscope_submit_validation", validationJson(candidate.id(), "REJECTED",
                List.of(records.get(1).evidenceId), List.of(records.get(2).evidenceId, records.get(3).evidenceId),
                List.of(records.get(4).evidenceId)));

        assertFalse(accepted.at("/result/isError").asBoolean(), accepted.toString());
        assertEquals("REJECTED", server.validations().getFirst().verdict().name());
    }

    @Test
    void 응답을_받은_통제요청은_증거ID가_비어도_실패로_원장에_기록되지_않고_완료를_막지_않는다() throws Exception {
        // 실환경 재현: 확장이 원본 레코드에 Evidence ID를 붙이지 않아 TargetResult.evidenceId가 null이었고,
        // 원장이 그 요청을 INVALID_REQUEST로 적어 ALL_FAILED가 되면서 end_run이 영구 거부됐다.
        RequestRecord llm = observation(Source.LLM, "B", 200, "{\"id\":8,\"owner\":\"user-b\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "explore-null-id");
        RequestRecord human = laneMarker(Source.HUMAN);
        human.runId = "human-1";
        RequestRecord scanner = laneMarker(Source.SCANNER);
        scanner.runId = "scanner-1";
        Pipeline.Result result = Pipeline.run(List.of(human, llm, scanner));
        RunContextRegistry contexts = new RunContextRegistry();
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "human-1", result);
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "scanner-1", result);
        AtomicReference<List<RunExecutionLedger.Attempt>> attempts = new AtomicReference<>(List.of());
        AtomicReference<ScopePolicy> scope = new AtomicReference<>(ScopePolicy.parse("https://api.example.test/v1"));
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return result; }
            @Override public ScopePolicy scope() { return scope.get(); }
            @Override public void updateScope(String value) { scope.set(ScopePolicy.parse(value)); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String target) { return false; }
            @Override public List<RouteCandidate> routeCandidates() { return List.of(); }
            @Override public void executionAttemptsChanged(List<RunExecutionLedger.Attempt> values) {
                attempts.set(values);
            }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                // 응답은 받았지만 Evidence ID가 아직 비어 있는 실제 확장 동작을 그대로 흉내 낸다.
                return new McpServer.TargetResult(null, 200, null,
                        "HTTP/1.1 200 OK\r\n\r\n{\"id\":8}", "{\"id\":8}");
            }
        }, 0, "test-token");
        server.start();
        assertFalse(tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"explore-null-id\"}")
                .at("/result/isError").asBoolean());

        tool("flowscope_target_read", "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders/8\"}");

        assertTrue(attempts.get().stream().noneMatch(attempt ->
                        attempt.outcome() == RunExecutionLedger.Outcome.INVALID_REQUEST),
                "HTTP 응답을 받은 요청이 INVALID_REQUEST로 기록됨: " + attempts.get());
        assertFalse(tool("flowscope_list_route_candidates", "{}").at("/result/isError").asBoolean());
        assertFalse(tool("flowscope_list_route_candidates", "{\"view\":\"ASSISTED\"}")
                .at("/result/isError").asBoolean());
        JsonNode ended = tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"explore-null-id\"}");
        assertFalse(ended.at("/result/isError").asBoolean(),
                "응답 Evidence가 있는 run의 완료가 원장 때문에 거부됨: " + ended);
    }

    @Test
    void 상대경로_target은_형식오류로_거부되고_route_후보는_실행가능한_절대URL을_함께_준다() throws Exception {
        // 실환경 재현: 모델이 route 후보의 경로를 그대로 target에 넣어 SCOPE_BLOCKED로만 실패했고 원인이 가려졌다.
        RequestRecord llm = observation(Source.LLM, "B", 200, "{\"id\":8,\"owner\":\"user-b\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "explore-abs");
        Pipeline.Result result = Pipeline.run(List.of(llm));
        RouteCandidate pending = new RouteCandidate("https://api.example.test:443", "GET", "/v1/coupons",
                List.of("/v1/coupons"), false, false,
                List.of(routeProvenance(RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, llm.evidenceId,
                        Source.LLM, "explore-abs", RouteCandidate.Applicability.REVIEW, "llm literal")),
                RouteCandidate.Applicability.REVIEW, "llm literal");
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RunExecutionLedger.Attempt>> attempts = new AtomicReference<>(List.of());
        AtomicReference<ScopePolicy> scope = new AtomicReference<>(ScopePolicy.parse("https://api.example.test/v1"));
        server = new McpServer(new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return result; }
            @Override public ScopePolicy scope() { return scope.get(); }
            @Override public void updateScope(String value) { scope.set(ScopePolicy.parse(value)); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public boolean approve(String action, String target) { return false; }
            @Override public List<RouteCandidate> routeCandidates() { return List.of(pending); }
            @Override public void executionAttemptsChanged(List<RunExecutionLedger.Attempt> values) {
                attempts.set(values);
            }
            @Override public McpServer.TargetResult targetRequest(McpServer.TargetRequest request) {
                throw new AssertionError("상대 경로는 실행기까지 오면 안 된다: " + request.target());
            }
        }, 0, "test-token");
        server.start();
        assertFalse(tool("flowscope_begin_llm_run",
                "{\"phase\":\"EXPLORATION\",\"tool\":\"CODEX\",\"run_id\":\"explore-abs\"}")
                .at("/result/isError").asBoolean());

        JsonNode routes = tool("flowscope_list_route_candidates", "{}");
        assertFalse(routes.at("/result/isError").asBoolean(), routes.toString());
        JsonNode route = routes.at("/result/structuredContent/routes/0");
        assertEquals("/v1/coupons", route.at("/pending_concrete_paths/0").asText());
        assertEquals("https://api.example.test:443/v1/coupons", route.at("/pending_targets/0").asText());

        JsonNode relative = tool("flowscope_target_read", "{\"method\":\"GET\",\"target\":\"/v1/coupons\"}");
        assertTrue(relative.at("/result/isError").asBoolean());
        String message = relative.toString();
        assertTrue(message.contains("absolute URL"), message);
        assertTrue(message.contains("pending_targets"), message);
        assertTrue(attempts.get().stream().allMatch(attempt ->
                        attempt.outcome() == RunExecutionLedger.Outcome.INVALID_REQUEST),
                "형식 오류가 scope 차단으로 기록됨: " + attempts.get());

        JsonNode schema = json(post("test-token", request(4, "tools/list", "{}")));
        String schemas = schema.toString();
        assertTrue(schemas.contains("Absolute URL only"), "target 스키마에 절대 URL 설명이 없음");
    }

    private JsonNode tool(String name, String arguments) throws Exception {
        return json(post("test-token", request(3, "tools/call",
                "{\"name\":\"" + name + "\",\"arguments\":" + arguments + "}")));
    }

    private HttpResponse<String> post(String token, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + "/mcp"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    private static JsonNode json(HttpResponse<String> response) throws Exception {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }

    private static String request(int id, String method, String params) {
        return "{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"" + method
                + "\",\"params\":" + params + "}";
    }

    private static McpServer.State state(Pipeline.Result result, RunContextRegistry contexts, ScopePolicy scope) {
        return state(result, contexts, scope, new AnalysisConfig());
    }

    private static McpServer.State state(Pipeline.Result result, RunContextRegistry contexts,
                                         ScopePolicy scope, AnalysisConfig config) {
        return state(new AtomicReference<>(result), contexts, scope, config);
    }

    private static McpServer.State state(AtomicReference<Pipeline.Result> result, RunContextRegistry contexts,
                                         ScopePolicy scope) {
        return state(result, contexts, scope, new AnalysisConfig());
    }

    private static McpServer.State state(AtomicReference<Pipeline.Result> result, RunContextRegistry contexts,
                                         ScopePolicy scope, AnalysisConfig config) {
        return state(result, contexts, scope, config, new AtomicReference<>(List.of()));
    }

    private static McpServer.State state(AtomicReference<Pipeline.Result> result, RunContextRegistry contexts,
                                         ScopePolicy scope, AnalysisConfig config,
                                         AtomicReference<List<RouteCandidate>> routeCandidates) {
        AtomicReference<ScopePolicy> currentScope = new AtomicReference<>(scope);
        return new McpServer.State() {
            @Override public Pipeline.Result snapshot() { return result.get(); }
            @Override public ScopePolicy scope() { return currentScope.get(); }
            @Override public void updateScope(String value) { currentScope.set(ScopePolicy.parse(value)); }
            @Override public ZapClient zap() { return new ZapClient("http://127.0.0.1:9", ""); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public AnalysisConfig config() { return config; }
            @Override public List<RouteCandidate> routeCandidates() { return routeCandidates.get(); }
            @Override public boolean approve(String action, String target) { return false; }
        };
    }

    private static RouteCandidate.Provenance routeProvenance(RouteCandidate.ProvenanceType type, String evidence,
                                                              Source source, String runId,
                                                              RouteCandidate.Applicability applicability,
                                                              String reason) {
        return new RouteCandidate.Provenance(type, evidence, source, runId, "fixture", applicability, reason);
    }

    private static RouteCandidate candidate(String method, String path, boolean observed, String evidence,
                                            Source source, String runId,
                                            RouteCandidate.ProvenanceType provenanceType) {
        return new RouteCandidate("https://api.example.test:443", method, path, observed,
                List.of(routeProvenance(provenanceType, evidence, source, runId,
                        observed ? RouteCandidate.Applicability.APPLICABLE : RouteCandidate.Applicability.REVIEW,
                        observed ? "observed" : "discovered")),
                observed ? RouteCandidate.Applicability.APPLICABLE : RouteCandidate.Applicability.REVIEW,
                observed ? "observed" : "discovered");
    }

    private static List<RequestRecord> validationRecords(boolean denied) {
        List<RequestRecord> records = new ArrayList<>();
        records.add(observation(Source.HUMAN, "A", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.BROWSER, RunPhase.EXPLORATION, "completed-human"));
        records.add(observation(Source.LLM, "B", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "completed-llm"));
        int status = denied ? 403 : 200;
        String body = denied ? "{\"error\":\"forbidden\"}" : "{\"id\":7,\"owner\":\"user-a\"}";
        records.add(observation(Source.LLM, "B", status, body,
                SourceDetail.LLM_VALIDATION, RunPhase.VALIDATION, "validation-1"));
        records.add(observation(Source.LLM, "B", status, body,
                SourceDetail.LLM_VALIDATION, RunPhase.VALIDATION, "validation-1"));
        records.add(observation(Source.LLM, "A", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.LLM_VALIDATION, RunPhase.VALIDATION, "validation-1"));
        return records;
    }

    private static void complete(RunContextRegistry contexts, Source source, SourceDetail detail, String runId) {
        contexts.activate(source, new RunContextRegistry.Context(detail,
                source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN,
                source == Source.SCANNER ? ToolKind.ZAP : source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER,
                RunPhase.EXPLORATION, runId));
        RequestRecord marker = laneMarker(source);
        marker.runId = runId;
        marker.sourceDetail = detail;
        assertNotNull(LaneCompletionPolicy.complete(contexts, source, runId, Pipeline.run(List.of(marker))));
    }

    private static void complete(RunContextRegistry contexts, Source source, SourceDetail detail, String runId,
                                 Pipeline.Result snapshot) {
        contexts.activate(source, new RunContextRegistry.Context(detail,
                source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN,
                source == Source.SCANNER ? ToolKind.ZAP : source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER,
                RunPhase.EXPLORATION, runId));
        assertNotNull(LaneCompletionPolicy.complete(contexts, source, runId, snapshot));
    }

    private static void completeAll(RunContextRegistry contexts) {
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human");
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "completed-scanner");
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm");
    }

    private static void completeAll(RunContextRegistry contexts, Pipeline.Result snapshot) {
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human", snapshot);
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "completed-scanner", snapshot);
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm", snapshot);
    }

    private static RequestRecord observation(Source source, String fingerprint, int status, String body,
                                             SourceDetail detail, RunPhase phase, String runId) {
        return observationAt(source, fingerprint, status, body, detail, phase, runId, "/v1/orders/7");
    }

    private static RequestRecord observationAt(Source source, String fingerprint, int status, String body,
                                               SourceDetail detail, RunPhase phase, String runId, String path) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", path, status, fingerprint);
        record.body = body;
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.sourceDetail = detail;
        record.phase = phase;
        record.runId = runId;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        record.tool = source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER;
        record.executionTrust = source == Source.HUMAN
                ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        return record;
    }

    private static RequestRecord laneMarker(Source source) {
        SourceDetail detail = switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.ZAP_SPIDER;
            case LLM -> SourceDetail.LLM_EXPLORER;
            default -> SourceDetail.UNKNOWN;
        };
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/health-" + source.name().toLowerCase(), 200, "marker-" + source.name());
        record.body = "{\"ok\":true}";
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.sourceDetail = detail;
        record.phase = RunPhase.EXPLORATION;
        record.runId = "completed-" + source.name().toLowerCase();
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM
                : source == Source.SCANNER ? Orchestrator.SYSTEM : Orchestrator.HUMAN;
        record.tool = source == Source.LLM ? ToolKind.CODEX
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.BROWSER;
        record.executionTrust = source == Source.HUMAN ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        return record;
    }

    private static String validationJson(String candidateId, String verdict, List<String> originals,
                                         List<String> probes, List<String> controls) throws Exception {
        var value = JSON.createObjectNode();
        value.put("candidate_id", candidateId);
        value.put("verdict", verdict);
        value.put("reason", "reproduced with owner control");
        value.set("original_evidence_ids", JSON.valueToTree(originals));
        value.set("validation_evidence_ids", JSON.valueToTree(probes));
        value.set("control_evidence_ids", JSON.valueToTree(controls));
        return JSON.writeValueAsString(value);
    }

    private static RequestRecord record() {
        RequestRecord record = new RequestRecord(Source.LLM, "https://api.example.test:443",
                "GET", "/v1/orders/7", 200, "user-a");
        record.sourceDetail = SourceDetail.LLM_EXPLORER;
        record.orchestrator = Orchestrator.LLM;
        record.tool = ToolKind.CODEX;
        record.phase = RunPhase.EXPLORATION;
        record.runId = "completed-llm";
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.reqText = "GET /v1/orders/7 HTTP/1.1\r\nCookie: session=secret-cookie\r\n\r\npassword=secret-password";
        record.respText = "HTTP/1.1 200 OK\r\nSet-Cookie: session=secret-session\r\n\r\n"
                + "{\"access_token\":\"secret-access-token\"}";
        record.body = "{\"access_token\":\"secret-access-token\"}";
        record.hasResponse = true;
        record.responseContentType = "application/json";
        return record;
    }

    private static ControlledBrowserExplorer.Snapshot browserSnapshotValue(String runId, String currentUrl) {
        return new ControlledBrowserExplorer.Snapshot(runId, currentUrl, "Dashboard", "Orders",
                List.of(new ControlledBrowserExplorer.Element("link", "Orders",
                        "https://api.example.test/v1/orders", "GET")),
                List.of(new ControlledBrowserExplorer.Route("GET",
                        "https://api.example.test/v1/orders", "Fetch", 200)), true);
    }

    private static JsonNode findTool(JsonNode tools, String name) {
        for (JsonNode tool : tools) if (name.equals(tool.path("name").asText())) return tool;
        throw new AssertionError("missing MCP tool: " + name);
    }

    private static void zapReply(com.sun.net.httpserver.HttpExchange exchange, String value) throws java.io.IOException {
        byte[] body = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static void restoreProperty(String name, String value) {
        if (value == null) System.clearProperty(name);
        else System.setProperty(name, value);
    }

    private static void registerSafeZapEnvironment(HttpServer server, int alertCount) {
        server.createContext("/JSON/core/view/version/", exchange -> zapReply(exchange,
                "{\"version\":\"2.17.0\"}"));
        server.createContext("/JSON/autoupdate/view/installedAddons/", exchange -> zapReply(exchange,
                "{\"installedAddons\":["
                        + "{\"id\":\"spider\"},{\"id\":\"client\"},{\"id\":\"spiderAjax\"},"
                        + "{\"id\":\"pscan\"},{\"id\":\"pscanrules\"},{\"id\":\"selenium\"},"
                        + "{\"id\":\"openapi\"},{\"id\":\"websocket\"},{\"id\":\"network\"},"
                        + "{\"id\":\"replacer\"}]}"));
        server.createContext("/JSON/network/view/isHttpProxyEnabled/", exchange -> zapReply(exchange,
                "{\"isHttpProxyEnabled\":\"true\"}"));
        server.createContext("/JSON/network/view/getHttpProxy/", exchange -> zapReply(exchange,
                "{\"getHttpProxy\":{\"host\":\"127.0.0.1\",\"port\":8081}}"));
        server.createContext("/JSON/pscan/action/setEnabled/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/context/action/newContext/", exchange -> zapReply(exchange,
                "{\"contextId\":\"1\"}"));
        server.createContext("/JSON/context/action/includeInContext/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/context/action/setContextInScope/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/replacer/action/addRule/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/replacer/action/removeRule/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/enableAllScanners/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/setScanOnlyInScope/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                "{\"currentTasks\":[]}"));
        server.createContext("/JSON/pscan/action/clearQueue/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/view/scanners/", exchange -> zapReply(exchange,
                "{\"scanners\":[{\"id\":\"10020\",\"enabled\":\"true\"}]}"));
        server.createContext("/JSON/alert/view/numberOfAlerts/", exchange -> zapReply(exchange,
                "{\"numberOfAlerts\":\"" + alertCount + "\"}"));
    }

    private static String zapAlertsPage(int start, int count) {
        StringBuilder value = new StringBuilder("{\"alerts\":[");
        for (int i = 0; i < count; i++) {
            if (i > 0) value.append(',');
            value.append("{\"name\":\"alert-").append(start + i)
                    .append("\",\"evidence\":\"token=raw-alert-secret\"}");
        }
        return value.append("]}").toString();
    }
}
