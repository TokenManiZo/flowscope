package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.Normalizer;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.graph.FlowGraph;
import io.flowscope.core.graph.FlowGraphBuilder;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FlowGraphBuilderTest {

    private byte[] load(String path) throws Exception {
        try (InputStream in = getClass().getResourceAsStream(path)) {
            assertNotNull(in);
            return in.readAllBytes();
        }
    }

    private FlowGraph sampleGraph() throws Exception {
        List<RequestRecord> all = new ArrayList<>();
        all.addAll(BurpXmlParser.parse(load("/sample/human.xml"), Source.HUMAN));
        all.addAll(BurpXmlParser.parse(load("/sample/scanner.xml"), Source.SCANNER));
        Normalizer.normalizeAll(all);
        return FlowGraphBuilder.build(all);
    }

    @Test
    void 노드_구성() throws Exception {
        FlowGraph g = sampleGraph();
        // 신원 3: user-a(AAA), user-b(ADM), user-c(BBB)
        assertEquals(3, g.nodeCount(FlowGraph.NodeType.IDENTITY));
        // 자원 4: orders:101, orders:303, orders:202, products:1
        // (admin/invites, admin/users 는 객체가 없어 자원 노드를 만들지 않음 — F-06/F-07)
        assertEquals(4, g.nodeCount(FlowGraph.NodeType.RESOURCE));
        // 오퍼레이션 7
        assertEquals(7, g.nodeCount(FlowGraph.NodeType.OPERATION));
    }

    @Test
    void 겹침은_같은_신원_안에서만_인정된다() throws Exception {
        // 샘플에서 orders:101 을 사람은 user-a(session=AAA), 스캐너는 user-c(session=BBB)로 호출한다.
        // 서로 다른 신원의 접근이므로 '겹침'이 아니다 — 엣지가 신원별로 분리돼야 한다.
        FlowGraph g = sampleGraph();
        List<FlowGraph.Edge> callsTo101 = g.edges().stream()
                .filter(e -> e.type == FlowGraph.EdgeType.CALLS)
                .filter(e -> e.from.contains("orders:101"))
                .toList();
        assertFalse(callsTo101.isEmpty(), "orders:101 CALLS 엣지가 있어야 한다");
        for (FlowGraph.Edge e : callsTo101) {
            assertEquals(1, e.sources.size(),
                    "신원 " + e.idn + " 의 접근은 한 소스만 관측 — 다른 신원과 합쳐 '겹침'으로 표시하면 안 됨");
        }
        // 신원이 서로 다르므로 엣지도 둘로 나뉜다
        assertEquals(2, callsTo101.stream().map(e -> e.idn).distinct().count());
    }

    @Test
    void 같은_신원을_두_소스가_밟으면_겹침() throws Exception {
        // 같은 신원(fp 동일)을 사람과 스캐너가 모두 관측한 경우에만 겹침
        List<RequestRecord> recs = new ArrayList<>();
        recs.add(new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/api/orders/7", 200, "SAME"));
        recs.add(new RequestRecord(Source.SCANNER, "https://t:443", "GET", "/api/orders/7", 200, "SAME"));
        Normalizer.normalizeAll(recs);
        FlowGraph g = FlowGraphBuilder.build(recs);
        FlowGraph.Edge e = g.edges().stream()
                .filter(x -> x.type == FlowGraph.EdgeType.ACCESS).findFirst().orElseThrow();
        assertEquals(2, e.sources.size(), "같은 신원·같은 조합이면 겹침");
        assertEquals(2, e.count, "관측 횟수 누적(F-07)");
    }

    @Test
    void 스캐너만_밟은_구간() throws Exception {
        // products:1 은 스캐너만 관측
        FlowGraph g = sampleGraph();
        FlowGraph.Edge scannerOnly = g.edges().stream()
                .filter(e -> e.from.contains("products:1"))
                .findFirst().orElseThrow();
        assertEquals(1, scannerOnly.sources.size());
        assertTrue(scannerOnly.sources.contains(Source.SCANNER));
    }

    @Test
    void unknown은_원본에는_남지만_분석셀과_그래프에서는_제외한다() {
        RequestRecord known = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/api/orders/7", 200, "A");
        known.hasResponse = true;
        known.body = "{\"id\":7}";
        RequestRecord unknown = new RequestRecord(Source.UNKNOWN, "https://t:443", "GET", "/internal/debug/9", 200, "U");
        unknown.hasResponse = true;
        unknown.body = "{\"id\":9}";

        io.flowscope.core.Pipeline.Result result = io.flowscope.core.Pipeline.run(List.of(known, unknown));

        assertEquals(2, result.records.size(), "원본 관측은 감사 목적으로 보존");
        assertTrue(result.analysis.cells().stream().noneMatch(c -> c.key().operation().contains("/internal/debug")));
        assertTrue(result.graph.nodes().stream().noneMatch(n -> n.id.contains("/internal/debug")));
    }
}
