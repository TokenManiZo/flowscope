package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.FlowGraph;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DataFlowAnalyzerTest {

    @Test
    void 응답_ID를_뒤요청이_사용할때만_Flow를_연결한다() {
        RequestRecord create = rec("POST", "/api/orders", 1_000, "{\"orderId\":\"abc-101\"}");
        RequestRecord consume = rec("GET", "/api/orders/abc-101", 2_000, "{\"ok\":true}");
        consume.query = "orderId=abc-101";
        RequestRecord unrelated = rec("GET", "/api/profile", 3_000, "{\"id\":\"profile-1\"}");

        Pipeline.Result result = Pipeline.run(List.of(create, consume, unrelated));
        List<FlowGraph.Edge> flows = result.graph.edges().stream()
                .filter(e -> e.type == FlowGraph.EdgeType.FLOW).toList();

        assertEquals(1, flows.size());
        assertTrue(flows.get(0).from.contains("POST /api/orders"));
        assertTrue(flows.get(0).to.contains("GET /api/orders/abc-101"));
    }

    @Test
    void 다른_신원은_같은_ID여도_연결하지_않는다() {
        RequestRecord a = rec("POST", "/api/orders", 1_000, "{\"orderId\":\"abc-101\"}");
        RequestRecord b = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/api/orders/abc-101", 200, "B");
        b.query = "orderId=abc-101";
        b.timestamp = 2_000;
        b.hasResponse = true;
        b.body = "{}";
        Pipeline.Result result = Pipeline.run(List.of(a, b));
        assertTrue(result.graph.edges().stream().noneMatch(e -> e.type == FlowGraph.EdgeType.FLOW));
    }

    private static RequestRecord rec(String method, String path, long timestamp, String body) {
        RequestRecord r = new RequestRecord(Source.HUMAN, "https://t:443", method, path, 200, "A");
        r.timestamp = timestamp;
        r.hasResponse = true;
        r.body = body;
        return r;
    }
}
