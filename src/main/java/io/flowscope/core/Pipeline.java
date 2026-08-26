package io.flowscope.core;

import io.flowscope.core.graph.FlowGraph;
import io.flowscope.core.graph.FlowGraphBuilder;

import java.util.ArrayList;
import java.util.List;

/**
 * 단일 분석 진입점: 정규화 → 신원 연결 → 비파괴 분류 → 커버리지 분석.
 * Standalone/Burp확장/진단이 모두 이걸 거쳐 동일하게 동작한다.
 */
public final class Pipeline {

    public static final class Result {
        public final FlowGraph graph;
        public final AuthorizationAnalysis analysis;
        /** 정규화된 분석 대상 레코드. 커버리지·갭(F-12~15)의 데이터 공급원이므로 폐기하지 않는다. */
        public final List<RequestRecord> records;
        /** 그래프·인가·3-way 커버리지에 실제로 사용한 부분집합. */
        public final List<RequestRecord> coverageRecords;
        public final int excludedCount;
        public final int reviewCount;
        Result(FlowGraph graph, AuthorizationAnalysis analysis, List<RequestRecord> records,
               List<RequestRecord> coverageRecords, int excludedCount, int reviewCount) {
            this.graph = graph;
            this.analysis = analysis;
            this.records = List.copyOf(records);
            this.coverageRecords = List.copyOf(coverageRecords);
            this.excludedCount = excludedCount;
            this.reviewCount = reviewCount;
        }
        public int kept() { return coverageRecords.size(); }
    }

    private Pipeline() {}

    public static Result run(List<RequestRecord> all) {
        return run(all, new AnalysisConfig());
    }

    public static Result run(List<RequestRecord> all, AnalysisConfig config) {
        List<RequestRecord> records = new ArrayList<>(all == null ? List.of() : all);
        Normalizer.normalizeAll(records);
        applyIdentityState(records, config);
        EvidenceIds.assign(records);
        for (RequestRecord record : records) {
            record.trafficClassification = TrafficClassifier.classify(record, config);
        }
        var clusters = ObservationCollapser.byEvidence(records);
        for (RequestRecord record : records) {
            if (record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.UNKNOWN
                    && record.trafficClassification.disposition() == TrafficClassification.Disposition.REVIEW
                    && clusters.get(record.evidenceId).count() >= 3) {
                record.trafficClassification = new TrafficClassification(
                        TrafficClassification.TrafficClass.BACKGROUND,
                        TrafficClassification.Disposition.REVIEW,
                        List.of("REPEATED_STABLE_OBSERVATION"), false);
            }
        }
        List<RequestRecord> coverage = new ArrayList<>();
        int excluded = 0;
        int review = 0;
        for (RequestRecord record : records) {
            if (record.trafficClassification.coverageEligible()) coverage.add(record);
            if (record.trafficClassification.disposition() == TrafficClassification.Disposition.EXCLUDE) excluded++;
            if (record.trafficClassification.disposition() == TrafficClassification.Disposition.REVIEW) review++;
        }
        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(coverage, config);
        FlowGraph graph = FlowGraphBuilder.build(coverage, analysis, config);
        return new Result(graph, analysis, records, coverage, excluded, review);
    }

    private static void applyIdentityState(List<RequestRecord> records, AnalysisConfig config) {
        config.applyIdentityBindings(records);
        for (RequestRecord record : records) {
            if (config.boundAccount(record.service, record.fp).isPresent()) {
                record.authState = AuthState.ACCOUNT_BOUND;
            } else if ("anon".equals(record.fp)) {
                record.authState = AuthState.ANONYMOUS;
                record.idn = "anon";
            } else {
                record.authState = AuthState.UNRESOLVED;
                if (record.fp.startsWith("ck:") || record.fp.startsWith("sess:")) {
                    record.idn = "unresolved-" + Fingerprints.hash(record.service);
                }
            }
            record.role = config.identityRole(record.idn);
        }
    }
}
