package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import io.flowscope.integration.McpServer;
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
    void authenticatesNegotiatesAndExposesEvidence() throws Exception {
        RequestRecord record = record();
        RunContextRegistry contexts = new RunContextRegistry();
        completeAll(contexts);
        server = new McpServer(state(Pipeline.run(List.of(record, laneMarker(Source.HUMAN), laneMarker(Source.SCANNER))), contexts,
                ScopePolicy.parse("https://api.example.test/v1")), 0, "test-token");
        server.start();

        HttpResponse<String> denied = post("wrong", request(1, "ping", "{}"));
        assertEquals(401, denied.statusCode());

        JsonNode initialized = json(post("test-token", request(2, "initialize",
                "{\"protocolVersion\":\"future-version\"}")));
        assertEquals("2025-11-25", initialized.at("/result/protocolVersion").asText());
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
        completeAll(contexts);
        server = new McpServer(state(Pipeline.run(List.of(record, laneMarker(Source.HUMAN), laneMarker(Source.SCANNER))), contexts,
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
        assertTrue(lock.at("/result/structuredContent/error").asText().contains("captured exploration responses"));
    }

    @Test
    void explorerCannotReadCrossSourceStateAndJudgeCannotStartBeforeDatasetLock() throws Exception {
        RequestRecord human = observation(Source.HUMAN, "A", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.BROWSER, RunPhase.EXPLORATION, "human-1");
        RequestRecord llm = observation(Source.LLM, "B", 200, "{\"id\":8,\"owner\":\"user-b\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "explore-1");
        Pipeline.Result result = Pipeline.run(List.of(human, llm, laneMarker(Source.SCANNER)));
        RouteCandidate shared = new RouteCandidate("https://api.example.test:443", "GET", "/v1/shared", true,
                List.of(
                        routeProvenance(RouteCandidate.ProvenanceType.OBSERVED_REQUEST, human.evidenceId,
                                Source.HUMAN, "human-1", RouteCandidate.Applicability.APPLICABLE, "human observed"),
                        routeProvenance(RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, llm.evidenceId,
                                Source.LLM, "explore-1", RouteCandidate.Applicability.REVIEW, "llm literal")),
                RouteCandidate.Applicability.APPLICABLE, "human observed");
        RouteCandidate humanOnly = new RouteCandidate("https://api.example.test:443", "POST", "/v1/admin", false,
                List.of(routeProvenance(RouteCandidate.ProvenanceType.OPENAPI, human.evidenceId,
                        Source.HUMAN, "human-1", RouteCandidate.Applicability.APPLICABLE, "human OpenAPI")),
                RouteCandidate.Applicability.APPLICABLE, "human OpenAPI");
        AtomicReference<List<RouteCandidate>> routeCandidates = new AtomicReference<>(List.of(shared, humanOnly));
        RunContextRegistry contexts = new RunContextRegistry();
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "human-1");
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "scanner-1");
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
        assertTrue(tool("flowscope_list_candidates", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_list_assessments", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_list_validations", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_zap_baseline_status", "{}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_get_evidence", "{\"evidence_id\":\"" + human.evidenceId + "\"}")
                .at("/result/isError").asBoolean());
        assertFalse(tool("flowscope_get_evidence", "{\"evidence_id\":\"" + llm.evidenceId + "\"}")
                .at("/result/isError").asBoolean());

        tool("flowscope_end_run", "{\"source\":\"LLM\",\"run_id\":\"explore-1\"}");
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

        JsonNode accepted = tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"Accept\":\"application/json\"}}");
        assertFalse(accepted.at("/result/isError").asBoolean(), accepted.toString());
        assertEquals("https://api.example.test/v1/orders", captured.get().target());
        assertEquals("user-a", captured.get().accountId());
        assertFalse(accepted.toString().contains("raw-secret"));
        assertFalse(accepted.toString().contains("raw-token"));
        assertEquals("CONTROLLED", accepted.at("/result/structuredContent/execution_trust").asText());

        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://outside.example/v1\"}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"Authorization\":\"Bearer injected\"}}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"headers\":{\"X-Test\":\"ok\\r\\nInjected: value\"}}")
                .at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"GET\",\"target\":\"https://api.example.test/v1/orders\"," +
                        "\"account_id\":\"missing\"}").at("/result/isError").asBoolean());
        assertTrue(tool("flowscope_target_request",
                "{\"method\":\"DELETE\",\"target\":\"https://api.example.test/v1/orders/7\"," +
                        "\"confirmed\":true}").at("/result/isError").asBoolean());
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
    void deterministicZapBaselineRunsBothSpidersWaitsForPassiveAndPublishesAlerts() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human");
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm");
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
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
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"test alert\",\"evidence\":\"token=raw-alert-secret\"}]}"));
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
                @Override public boolean approve(String action, String target) { return false; }
            }, 0, "test-token");
            server.start();

            JsonNode started = tool("flowscope_zap_baseline",
                    "{\"target\":\"http://127.0.0.1:8888/\",\"run_id\":\"zap-baseline-1\"}");
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
            assertEquals(1, status.at("/result/structuredContent/alert_count").asInt());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/traditional_captures").asInt());
            assertEquals(1, status.at("/result/structuredContent/lanes/0/rendered_captures").asInt());
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertFalse(tool("flowscope_lock_dataset", "{}").at("/result/isError").asBoolean());
            JsonNode alerts = tool("flowscope_zap_alerts",
                    "{\"target\":\"http://127.0.0.1:8888/\"}");
            assertEquals("BASELINE_SNAPSHOT", alerts.at("/result/structuredContent/source").asText());
            assertFalse(alerts.toString().contains("raw-alert-secret"));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void deterministicZapBaselineFallsBackWhenClientCompletesWithoutRenderedTraffic() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human");
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm");
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
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
    void scannerCompletionUsesRawCaptureCounterInsteadOfPossiblyStalePipelineSnapshot() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong rawCaptures = new AtomicLong();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            rawCaptures.incrementAndGet();
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new McpServer(new McpServer.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
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
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
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
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
            sessions.close();
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
        completeAll(contexts);
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
        completeAll(contexts);
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

    private static List<RequestRecord> validationRecords(boolean denied) {
        List<RequestRecord> records = new ArrayList<>();
        records.add(observation(Source.HUMAN, "A", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.BROWSER, RunPhase.EXPLORATION, "human-1"));
        records.add(observation(Source.LLM, "B", 200, "{\"id\":7,\"owner\":\"user-a\"}",
                SourceDetail.LLM_EXPLORER, RunPhase.EXPLORATION, "explore-1"));
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
        assertTrue(contexts.clear(source, runId));
    }

    private static void completeAll(RunContextRegistry contexts) {
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human");
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_SPIDER, "completed-scanner");
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm");
    }

    private static RequestRecord observation(Source source, String fingerprint, int status, String body,
                                             SourceDetail detail, RunPhase phase, String runId) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/v1/orders/7", status, fingerprint);
        record.body = body;
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.sourceDetail = detail;
        record.phase = phase;
        record.runId = runId;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        record.tool = source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER;
        record.executionTrust = detail == SourceDetail.LLM_VALIDATION
                ? ExecutionTrust.CONTROLLED : ExecutionTrust.OBSERVED;
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
        record.executionTrust = source == Source.LLM ? ExecutionTrust.CONTROLLED : ExecutionTrust.OBSERVED;
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
        record.runId = "llm-1";
        record.reqText = "GET /v1/orders/7 HTTP/1.1\r\nCookie: session=secret-cookie\r\n\r\npassword=secret-password";
        record.respText = "HTTP/1.1 200 OK\r\nSet-Cookie: session=secret-session\r\n\r\n"
                + "{\"access_token\":\"secret-access-token\"}";
        record.body = "{\"access_token\":\"secret-access-token\"}";
        record.hasResponse = true;
        record.responseContentType = "application/json";
        return record;
    }

    private static void zapReply(com.sun.net.httpserver.HttpExchange exchange, String value) throws java.io.IOException {
        byte[] body = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
