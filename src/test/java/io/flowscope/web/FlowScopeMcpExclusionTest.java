package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.LlmFinding;
import io.flowscope.core.MatrixExclusion;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.LoopbackHttpServer;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

final class FlowScopeMcpExclusionTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test void excludedApiDisappearsFromGraphAndCannotBecomeANewFindingUntilRestored() throws Exception {
        var record = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders/101", 200, "anon");
        record.hasResponse = true; record.body = "{\"id\":101}"; record.responseContentType = "application/json";
        var second = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders/102", 200, "anon");
        second.hasResponse = true; second.body = "{\"id\":102}"; second.responseContentType = "application/json";
        Pipeline.Result snapshot = Pipeline.run(List.of(record, second));
        assertFalse(snapshot.coverageRecords.isEmpty());
        String operation = snapshot.coverageRecords.getFirst().op;
        var config = new AnalysisConfig();
        var saved = new AtomicInteger();
        var state = (FlowScopeWebServer.State) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { FlowScopeWebServer.State.class }, (proxy, method, args) -> switch (method.getName()) {
                    case "snapshot" -> snapshot;
                    case "config" -> config;
                    case "validations", "assessments", "findings", "scopeEntries" -> List.of();
                    case "submitFinding" -> { saved.incrementAndGet(); yield null; }
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        var mcp = new FlowScopeMcp(state, "secret", 17777, null);
        assertEquals(2, tool(mcp, "flowscope_get_graph", Map.of()).path("access").size());
        var exclusion = new MatrixExclusion(MatrixExclusion.keyFor("function", operation, null), "function", operation, null, operation);
        config.replaceMatrixExclusions(List.of(exclusion));
        assertEquals(0, tool(mcp, "flowscope_get_graph", Map.of()).path("access").size());
        JsonNode rejected = toolResponse(mcp, "flowscope_submit_finding", Map.of("operation", operation,
                "identity", "anon", "evidence_ids", List.of(record.evidenceId)));
        assertTrue(rejected.at("/result/isError").asBoolean());
        assertEquals(0, saved.get());
        config.replaceMatrixExclusions(List.of());
        assertEquals(2, tool(mcp, "flowscope_get_graph", Map.of()).path("access").size());
        assertFalse(toolResponse(mcp, "flowscope_submit_finding", Map.of("operation", operation,
                "identity", "anon", "evidence_ids", List.of(record.evidenceId))).at("/result/isError").asBoolean());
        assertEquals(1, saved.get());

        assertFalse(snapshot.objects.targets().isEmpty());
        var target = snapshot.objects.targets().values().iterator().next();
        String resource = target.resource();
        config.replaceMatrixExclusions(List.of(new MatrixExclusion(MatrixExclusion.keyFor("object", operation, resource),
                "object", operation, resource, "one object")));
        assertFalse(tool(mcp, "flowscope_get_graph", Map.of()).path("owners").has(resource));
        assertTrue(toolResponse(mcp, "flowscope_submit_finding", Map.of("operation", target.operation(),
                "identity", "anon", "resource", resource, "evidence_ids", List.of(target.evidenceIds().iterator().next()))).at("/result/isError").asBoolean());
        assertTrue(toolResponse(mcp, "flowscope_submit_finding", Map.of("operation", operation,
                "identity", "anon", "evidence_ids", List.of(record.evidenceId))).at("/result/isError").asBoolean());
        assertEquals(1, saved.get());
    }

    private JsonNode tool(FlowScopeMcp mcp, String name, Map<String, ?> args) throws Exception {
        JsonNode response = toolResponse(mcp, name, args);
        assertFalse(response.at("/result/isError").asBoolean(), response.toString());
        return json.readTree(response.at("/result/content/0/text").asText());
    }

    private JsonNode toolResponse(FlowScopeMcp mcp, String name, Map<String, ?> args) throws Exception {
        byte[] body = json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call",
                "params", Map.of("name", name, "arguments", args)));
        var request = new LoopbackHttpServer.Request("POST", "/mcp", null,
                Map.of("host", "localhost:17777", "authorization", "Bearer secret"), body);
        var response = mcp.handle(request);
        assertEquals(200, response.status());
        return json.readTree(new String(response.body(), StandardCharsets.UTF_8));
    }
}
