package io.flowscope.core;

import io.flowscope.core.graph.FlowGraph;
import io.flowscope.core.graph.FlowGraphBuilder;

import java.util.ArrayList;
import java.util.List;

/**
 * L0 파이프라인 한 진입점: 노이즈 제외 → 정규화 → 그래프.
 * Standalone/Burp확장/진단이 모두 이걸 거쳐 동일하게 동작한다.
 */
public final class Pipeline {

    public static final class Result {
        public final FlowGraph graph;
        public final AuthorizationAnalysis analysis;
        /** 정규화된 분석 대상 레코드. 커버리지·갭(F-12~15)의 데이터 공급원이므로 폐기하지 않는다. */
        public final List<RequestRecord> records;
        public final int noiseFiltered;
        Result(FlowGraph graph, AuthorizationAnalysis analysis, List<RequestRecord> records, int noiseFiltered) {
            this.graph = graph;
            this.analysis = analysis;
            this.records = records;
            this.noiseFiltered = noiseFiltered;
        }
        public int kept() { return records.size(); }
    }

    private Pipeline() {}

    public static Result run(List<RequestRecord> all) {
        List<RequestRecord> kept = new ArrayList<>();
        int noise = 0;
        for (RequestRecord r : all) {
            if (TrafficFilter.isNoise(r)) noise++;
            else kept.add(r);
        }
        Normalizer.normalizeAll(kept);
        AnalysisConfig config = new AnalysisConfig();
        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(kept, config);
        FlowGraph graph = FlowGraphBuilder.build(kept, analysis, config);
        return new Result(graph, analysis, kept, noise);
    }

    public static Result run(List<RequestRecord> all, AnalysisConfig config) {
        List<RequestRecord> kept = new ArrayList<>();
        int noise = 0;
        for (RequestRecord r : all) {
            if (TrafficFilter.isNoise(r)) noise++;
            else kept.add(r);
        }
        Normalizer.normalizeAll(kept);
        config.applyIdentityBindings(kept);
        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(kept, config);
        FlowGraph graph = FlowGraphBuilder.build(kept, analysis, config);
        return new Result(graph, analysis, kept, noise);
    }
}
