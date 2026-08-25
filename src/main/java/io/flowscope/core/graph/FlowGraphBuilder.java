package io.flowscope.core.graph;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.AuthorizationAnalyzer;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.DataFlowAnalyzer;
import io.flowscope.core.Source;

import java.util.List;

/**
 * 정규화된 레코드 -> 플로우 그래프 (기능명세서 F-07).
 * identity -[access]-> resource -[calls]-> operation.
 * 각 엣지는 관측 소스를 누적해 오버레이 비교(F-08/F-13)의 기반이 된다.
 */
public final class FlowGraphBuilder {

    private FlowGraphBuilder() {}

    public static FlowGraph build(List<RequestRecord> records) {
        AnalysisConfig config = new AnalysisConfig();
        return build(records, AuthorizationAnalyzer.analyze(records, config), config);
    }

    public static FlowGraph build(List<RequestRecord> records, AuthorizationAnalysis analysis) {
        return build(records, analysis, new AnalysisConfig());
    }

    public static FlowGraph build(List<RequestRecord> records, AuthorizationAnalysis analysis, AnalysisConfig config) {
        FlowGraph g = new FlowGraph();
        List<RequestRecord> analyzable = records.stream().filter(r -> r.source != Source.UNKNOWN).toList();
        for (RequestRecord r : analyzable) {
            if (r.idn == null || r.op == null) {
                throw new IllegalStateException("정규화되지 않은 레코드: " + r);
            }
            String iId = "I:" + r.idn;
            String oId = "O:" + r.op;
            g.addNode(iId, config.identityLabel(r.idn), FlowGraph.NodeType.IDENTITY);
            g.addNode(oId, withoutService(r.op), FlowGraph.NodeType.OPERATION);

            if (r.resource == null) {
                // 객체 없는 요청은 요청자 → 엔드포인트 직결 (F-06/F-07)
                g.addEdge(iId, oId, FlowGraph.EdgeType.ACCESS, r);
            } else {
                String rId = "R:" + r.resource;
                g.addNode(rId, withoutService(r.resource), FlowGraph.NodeType.RESOURCE);
                g.addEdge(iId, rId, FlowGraph.EdgeType.ACCESS, r);
                // CALLS 도 신원별로 분리: 다른 신원의 호출이 '겹침'으로 오표시되면 안 된다
                g.addEdge(rId, oId, FlowGraph.EdgeType.CALLS, r);
            }
        }
        for (DataFlowAnalyzer.Link link : DataFlowAnalyzer.analyze(analyzable)) {
            if (link.producer().op.equals(link.consumer().op)) continue;
            g.addEdge("O:" + link.producer().op, "O:" + link.consumer().op,
                    FlowGraph.EdgeType.FLOW, link.consumer());
        }
        for (AuthorizationAnalysis.CoverageCell cell : analysis.cells()) {
            g.markVerdict("O:" + cell.key().operation(), cell.overall());
            if (cell.key().resource() != null) g.markVerdict("R:" + cell.key().resource(), cell.overall());
        }
        return g;
    }

    /** 서비스는 노드 ID에 보존하되, 화면 라벨에서는 경로 판독을 위해 숨긴다. */
    private static String withoutService(String value) {
        int separator = value.indexOf(' ');
        return separator < 0 ? value : value.substring(separator + 1);
    }
}
