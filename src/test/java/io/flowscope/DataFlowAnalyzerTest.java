package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.FlowGraph;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
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

    @Test
    void 비구조화_장문은_정규식_역추적없이_제한시간안에_종료한다() {
        RequestRecord producer = rec("GET", "/api/blob", 1_000, "x".repeat(64 * 1024));
        RequestRecord consumer = rec("GET", "/api/next", 2_000, "{}");

        assertTimeoutPreemptively(Duration.ofSeconds(2),
                () -> assertTrue(Pipeline.run(List.of(producer, consumer)).graph.edges().stream()
                        .noneMatch(edge -> edge.type == FlowGraph.EdgeType.FLOW)));
    }

    @Test
    void 부분문자열은_데이터전달로_연결하지_않는다() {
        RequestRecord producer = rec("GET", "/api/orders", 1_000, "{\"orderId\":\"123\"}");
        RequestRecord consumer = rec("GET", "/api/orders/1234", 2_000, "{}");

        assertTrue(DataFlowAnalyzer.analyze(List.of(producer, consumer)).isEmpty());
    }

    @Test
    void 같은값은_가장가까운_이전생성자와만_연결한다() {
        RequestRecord first = rec("GET", "/api/first", 1_000, "{\"orderId\":\"abc-101\"}");
        RequestRecord latest = rec("GET", "/api/latest", 2_000, "{\"orderId\":\"abc-101\"}");
        RequestRecord consumer = rec("GET", "/api/orders/abc-101", 3_000, "{}");

        List<DataFlowAnalyzer.Link> links = DataFlowAnalyzer.analyze(List.of(first, latest, consumer));
        assertEquals(1, links.size());
        assertSame(latest, links.getFirst().producer());
    }

    @Test
    void 이만건의_고유값은_선형인덱스로_분석한다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            records.add(rec("GET", "/api/source/" + i, i * 2L + 1,
                    "{\"itemId\":\"value-" + i + "\"}"));
            records.add(rec("GET", "/api/target/value-" + i, i * 2L + 2, "{}"));
        }

        assertTimeoutPreemptively(Duration.ofSeconds(5),
                () -> assertEquals(10_000, DataFlowAnalyzer.analyze(records).size()));
    }

    @Test
    void 값인덱스는_전역상한에서_가장오래된값을_축출한다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int page = 0; page < 101; page++) {
            StringBuilder body = new StringBuilder("{\"items\":[");
            for (int item = 0; item < 1_000; item++) {
                if (item > 0) body.append(',');
                body.append("{\"itemId\":\"value-").append(page).append('-').append(item).append("\"}");
            }
            body.append("]}");
            records.add(rec("GET", "/api/source/" + page, page + 1L, body.toString()));
        }
        RequestRecord oldest = rec("GET", "/api/target/value-0-0", 200, "{}");
        RequestRecord newest = rec("GET", "/api/target/value-100-999", 201, "{}");
        records.add(oldest);
        records.add(newest);

        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
            List<DataFlowAnalyzer.Link> links = DataFlowAnalyzer.analyze(records);
            assertTrue(links.stream().noneMatch(link -> link.consumer() == oldest));
            assertTrue(links.stream().anyMatch(link -> link.consumer() == newest));
        });
    }

    private static RequestRecord rec(String method, String path, long timestamp, String body) {
        RequestRecord r = new RequestRecord(Source.HUMAN, "https://t:443", method, path, 200, "A");
        r.timestamp = timestamp;
        r.hasResponse = true;
        r.body = body;
        r.evidenceId = method + "-" + path + "-" + timestamp;
        return r;
    }
}
