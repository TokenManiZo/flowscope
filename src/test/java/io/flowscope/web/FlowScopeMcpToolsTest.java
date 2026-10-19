package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.CoreObjectFixture;
import io.flowscope.core.*;
import io.flowscope.integration.LoopbackHttpServer;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.integration.SessionBroker;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

final class FlowScopeMcpToolsTest {
    private final ObjectMapper json = new ObjectMapper();
    private final AnalysisConfig config = new AnalysisConfig();
    private final SessionBroker sessions = new SessionBroker();
    private final AtomicLong dataset = new AtomicLong(1);
    private final AtomicInteger sends = new AtomicInteger();
    private final RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders/101", 200, "anon");
    private final Pipeline.Result snapshot = Pipeline.run(List.of(record));
    private String sentRequest;
    private final FlowScopeWebServer.State state = (FlowScopeWebServer.State) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[]{FlowScopeWebServer.State.class}, (proxy, method, args) -> switch (method.getName()) {
                case "datasetRevision" -> dataset.get();
                case "snapshot" -> snapshot;
                case "config" -> config;
                case "sessions" -> sessions;
                case "scannerStatus" -> json.createObjectNode().put("status", "COMPLETED").put("alerts", 2);
                case "projectStatus" -> new ProjectWorkspace.Status("", null, List.of());
                case "validations", "scopeEntries" -> List.of();
                case "requestLabDraft" -> new FlowScopeWebServer.RequestLabDraft(record.evidenceId, record.service,
                        "GET /orders/101 HTTP/1.1\r\nHost: api.test\r\nAuthorization: Bearer full-token\r\nCookie: sid=full-cookie\r\n\r\n",
                        "HTTP/1.1 200 OK\r\nSet-Cookie: next=full-value\r\n\r\n{\"id\":101}", true, true, true,
                        "UTF-8", "UTF-8", "anon", "", "", "", "");
                case "sendMcpRequest" -> {
                    sends.incrementAndGet(); sentRequest = (String) args[1];
                    yield new FlowScopeWebServer.RequestLabResult("ev-replay", 200, "HTTP/1.1 200 OK\r\nSet-Cookie: sid=raw-result\r\n\r\n{}", 1, 10, 10);
                }
                default -> throw new UnsupportedOperationException(method.getName());
            });
    private final FlowScopeMcp mcp = new FlowScopeMcp(state, "secret", 17777, null);

    @Test void rawTrafficIncludesAuthenticationHeadersWithoutMasking() throws Exception {
        JsonNode result = call("flowscope_get_evidence", Map.of("evidence_id", record.evidenceId));
        assertFalse(result.path("isError").asBoolean(), result.toString());
        assertTrue(result.path("structuredContent").path("request").asText().contains("Authorization: Bearer full-token"));
        assertTrue(result.path("structuredContent").path("request").asText().contains("sid=full-cookie"));
        assertTrue(result.path("structuredContent").path("response").asText().contains("next=full-value"));
        assertEquals("HUMAN", result.at("/structuredContent/source").asText());
        assertEquals(record.evidenceId, result.at("/structuredContent/evidenceId").asText());
        assertTrue(result.at("/structuredContent/ownerChain").isArray());
    }

    @Test void evidenceExposesActualOwnerAttributionAndSourceChain() throws Exception {
        RequestRecord owner = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/api/orders/101", 200, "A");
        owner.collectionAccountId = "user-a";
        owner.sourceDetail = SourceDetail.BROWSER;
        owner.hasResponse = true;
        owner.body = "{\"id\":101,\"owner\":\"user-a\"}";
        RequestRecord cross = new RequestRecord(Source.LLM, owner.service, "GET", "/api/orders/101", 200, "B");
        cross.collectionAccountId = "user-b";
        cross.sourceDetail = SourceDetail.LLM_VALIDATION;
        cross.hasResponse = true;
        cross.body = owner.body;
        var observed = Pipeline.run(CoreObjectFixture.corroborated(List.of(owner, cross)));
        assertFalse(observed.analysis.owners().isEmpty(), "객체 소유자 분석 근거가 필요합니다: " + observed.objects.targets().keySet());
        FlowScopeWebServer.State fixture = (FlowScopeWebServer.State) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{FlowScopeWebServer.State.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "snapshot" -> observed;
                    case "config" -> new AnalysisConfig();
                    case "scopeEntries" -> List.of(owner.service + "/");
                    case "requestLabDraft" -> new FlowScopeWebServer.RequestLabDraft(cross.evidenceId, cross.service,
                            "GET /api/orders/101 HTTP/1.1\r\nAuthorization: Bearer original-secret\r\n\r\n",
                            "HTTP/1.1 200 OK\r\n\r\n" + cross.body, true, true, true,
                            "UTF-8", "UTF-8", "user-b", "", "", "", "user-b");
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        FlowScopeMcp server = new FlowScopeMcp(fixture, "secret", 17777, null);
        JsonNode evidence = call(server, "flowscope_get_evidence", Map.of("evidence_id", cross.evidenceId));
        assertFalse(evidence.path("isError").asBoolean(), evidence.toString());
        JsonNode raw = evidence.path("structuredContent");
        assertEquals("LLM", raw.path("source").asText());
        assertEquals("LLM_VALIDATION", raw.path("sourceDetail").asText());
        assertTrue(raw.path("request").asText().contains("original-secret"));
        JsonNode chain = raw.path("ownerChain").get(0);
        assertEquals("user-a", chain.path("ownerIdentity").asText(), raw.path("ownerChain").toString()
                + " analyzed=" + observed.analysis.owners());
        assertEquals("user-b", chain.path("accessIdentity").asText());
        assertTrue(chain.path("ownerEvidenceIds").toString().contains(owner.evidenceId));
        assertTrue(chain.path("objectEvidenceIds").toString().contains(owner.evidenceId));
    }

    @Test void everyWriteMethodMustBeEnabledAndGetCanAlsoBeDisabled() throws Exception {
        for (String method : FlowScopeMcp.METHODS) {
            String raw = method + " /orders/101 HTTP/1.1\r\nHost: api.test\r\n\r\n{}";
            Map<String, ?> args = Map.of("evidence_id", record.evidenceId, "account_id", "anon", "request", raw);
            if (!method.equals("GET")) assertTrue(call("flowscope_replay", args).path("isError").asBoolean());
            mcp.permission(1, method, true);
            assertFalse(call("flowscope_replay", args).path("isError").asBoolean());
            assertEquals(raw, sentRequest);
            mcp.permission(1, method, false);
            assertEquals("METHOD_DISABLED", call("flowscope_replay", args).at("/structuredContent/code").asText());
        }
        assertEquals(5, sends.get());
    }

    @Test void collectsANewScopedRequestFromAnEvidenceTemplateAndReadsScannerStatus() throws Exception {
        String request = "GET /vehicles/42 HTTP/1.1\r\nHost: api.test\r\n\r\n";
        JsonNode collected = call("flowscope_collect_request", Map.of("evidence_id", record.evidenceId,
                "account_id", "anon", "request", request));
        assertFalse(collected.path("isError").asBoolean(), collected.toString());
        assertEquals("ev-replay", collected.at("/structuredContent/newEvidenceId").asText());
        assertEquals(request, sentRequest);
        JsonNode scanner = call("flowscope_get_scanner_status", Map.of());
        assertEquals("COMPLETED", scanner.at("/structuredContent/run/status").asText());
    }

    @Test void missingOrUnverifiedSessionNeverFallsBackToAnonymous() throws Exception {
        var account = new AccountProfile("b", "USER B", record.service, AccessRole.USER);
        config.upsertAccount(account);
        var args = Map.of("evidence_id", record.evidenceId, "account_id", "b");
        assertEquals("SESSION_UNAVAILABLE", call("flowscope_replay", args).at("/structuredContent/code").asText());
        String handle = sessions.beginCapture(account, Instant.now());
        sessions.observeRequest(handle, java.net.URI.create(record.service + "/orders/101"), Map.of("Cookie", "sid=b"), Instant.now());
        sessions.observeResponse(handle, java.net.URI.create(record.service + "/orders/101"), 200, null, "{}", List.of(), Instant.now());
        sessions.endCapture(handle);
        assertFalse(sessions.verifiedReplayReady("b", Instant.now()), "arbitrary 200 is not identity proof");
        assertTrue(call("flowscope_replay", args).path("isError").asBoolean());
        assertEquals(0, sends.get());
        sessions.registerAssertedSession(account, Map.of("Cookie", "sid=b"), Instant.now());
        assertFalse(call("flowscope_replay", args).path("isError").asBoolean());
        sessions.revoke(sessions.handleForAccount("b"));
        assertTrue(call("flowscope_replay", args).path("isError").asBoolean());
        assertEquals(1, sends.get());
    }

    @Test void methodPermissionsResetOnProjectChangeAndRejectStaleUi() {
        mcp.permission(1, "DELETE", true);
        dataset.incrementAndGet();
        assertFalse(mcp.settings().at("/methods/DELETE").asBoolean());
        assertTrue(mcp.settings().at("/methods/GET").asBoolean());
        assertThrows(IllegalStateException.class, () -> mcp.permission(1, "DELETE", true));
    }

    @Test void strongProofCanBecomeReadyWhileHumanCaptureContinuesAndExpiredMaterialCannot() {
        var account = new AccountProfile("b", "USER B", record.service, AccessRole.USER);
        String handle = sessions.beginCapture(account, Instant.now());
        var target = java.net.URI.create(record.service + "/me");
        Instant now = Instant.now();
        sessions.observeRequest(handle, target, Map.of("Cookie", "sid=b"), now);
        sessions.observeResponse(handle, target, 200, null, "user-b", List.of(), now, VerificationOutcome.MATCHED);
        assertTrue(sessions.verifiedReplayReady("b", now));
        assertTrue(sessions.viewForAccount("b").orElseThrow().capturing());
        sessions.observeResponse(handle, target, 200, null, "user-b", List.of("sid=b; Max-Age=1; Path=/"), now, VerificationOutcome.MATCHED);
        assertFalse(sessions.verifiedReplayReady("b", now.plusSeconds(2)));
    }

    @Test void rotationInvalidatesOldClientAndSettingsDoNotContainTheConnectionKey() throws Exception {
        assertFalse(mcp.settings().has("token"));
        assertEquals("secret", mcp.connectionInfo().path("token").asText());
        mcp.disconnect();
        assertNotEquals("secret", mcp.token());
        var request = new LoopbackHttpServer.Request("POST", "/mcp", null,
                Map.of("host", "localhost:17777", "authorization", "Bearer secret"), "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(401, mcp.handle(request).status());
    }

    private JsonNode call(String name, Map<String, ?> args) throws Exception {
        return call(mcp, name, args);
    }

    private JsonNode call(FlowScopeMcp server, String name, Map<String, ?> args) throws Exception {
        var request = new LoopbackHttpServer.Request("POST", "/mcp", null,
                Map.of("host", "localhost:17777", "authorization", "Bearer " + server.token()),
                json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call", "params", Map.of("name", name, "arguments", args))));
        var response = server.handle(request);
        assertEquals(200, response.status());
        return json.readTree(response.body()).path("result");
    }
}
