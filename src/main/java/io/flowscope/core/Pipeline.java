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
        return runInternal(all, config, false);
    }

    /** 동시 조회되는 UI 게시본을 수집 DTO와 분리해 재분석 중 데이터 레이스를 막는다. */
    public static Result runIsolated(List<RequestRecord> all, AnalysisConfig config) {
        return runInternal(all, config, true);
    }

    private static Result runInternal(List<RequestRecord> all, AnalysisConfig config, boolean isolate) {
        AnalysisConfig effectiveConfig = isolate ? config.snapshotCopy() : config;
        List<RequestRecord> input = all == null ? List.of() : all;
        List<RequestRecord> records = isolate
                ? input.stream().map(RequestRecord::analysisCopy)
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new))
                : new ArrayList<>(input);
        Normalizer.normalizeAll(records);
        applyIdentityState(records, effectiveConfig);
        EvidenceIds.assign(records);
        for (RequestRecord record : records) {
            record.trafficClassification = TrafficClassifier.classify(record, effectiveConfig);
        }
        var corroboratedOperations = records.stream()
                .filter(Pipeline::strongCorroboratingEvidence)
                .map(Pipeline::serviceOperationKey)
                .collect(java.util.stream.Collectors.toSet());
        for (RequestRecord record : records) {
            if (record.trafficClassification.disposition() == TrafficClassification.Disposition.REVIEW
                    && immutableDiscoveryGateAllows(record)
                    && corroboratedOperations.contains(serviceOperationKey(record))) {
                record.trafficClassification = new TrafficClassification(
                        TrafficClassification.TrafficClass.API,
                        TrafficClassification.Disposition.INCLUDE,
                        List.of("OPERATION_CORROBORATED_BY_API_EVIDENCE"), false);
            }
        }
        var clusters = ObservationCollapser.byEvidence(records);
        for (RequestRecord record : records) {
            if (record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.UNKNOWN
                    && record.trafficClassification.disposition() == TrafficClassification.Disposition.REVIEW
                    && clusters.get(record.evidenceId).count() >= 3) {
                record.trafficClassification = new TrafficClassification(
                        TrafficClassification.TrafficClass.POLLING,
                        TrafficClassification.Disposition.REVIEW,
                        List.of("REPEATED_STABLE_OBSERVATION"), false);
            }
        }
        List<RequestRecord> coverage = new ArrayList<>();
        int excluded = 0;
        int review = 0;
        for (RequestRecord record : records) {
            if (record.trafficClassification.coverageEligible()
                    && SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.ANALYSIS_COVERAGE)) {
                coverage.add(record);
            }
            if (record.trafficClassification.disposition() == TrafficClassification.Disposition.EXCLUDE) excluded++;
            if (record.trafficClassification.disposition() == TrafficClassification.Disposition.REVIEW) review++;
        }
        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(coverage, effectiveConfig);
        FlowGraph graph = FlowGraphBuilder.build(coverage, analysis, effectiveConfig);
        return new Result(graph, analysis, records, coverage, excluded, review);
    }

    private static boolean strongCorroboratingEvidence(RequestRecord record) {
        return immutableDiscoveryGateAllows(record)
                && record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.API
                && record.trafficClassification.disposition() == TrafficClassification.Disposition.INCLUDE
                && !record.trafficClassification.userOverride();
    }

    private static boolean immutableDiscoveryGateAllows(RequestRecord record) {
        return record.hasResponse
                && record.source != Source.UNKNOWN
                && record.phase != RunPhase.SESSION_SETUP
                && record.phase != RunPhase.VALIDATION
                && record.phase != RunPhase.COACH_PROBE
                && (record.source != Source.HUMAN || record.phase != RunPhase.BASELINE);
    }

    private static String serviceOperationKey(RequestRecord record) {
        return record.service + "\0" + record.op;
    }

    private static void applyIdentityState(List<RequestRecord> records, AnalysisConfig config) {
        for (RequestRecord record : records) {
            record.idn = record.selectedIdentity();
            record.authState = Fingerprints.ANONYMOUS.equals(record.idn)
                    ? AuthState.ANONYMOUS : AuthState.ACCOUNT_BOUND;
            record.role = config.identityRole(record.idn);
        }
    }
}
