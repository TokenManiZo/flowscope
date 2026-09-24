package io.flowscope.core;

import java.util.List;
import java.util.Map;

/**
 * 판정 매트릭스용 보수적 projection(PR#12 이식, D-144).
 *
 * <p>P/E/O는 합산 점수가 아니라 서로 독립적인 서열 척도다. 데이터가 부족하면
 * UNKNOWN/COVERAGE_GAP을 유지하며 취약점 또는 안전으로 승격하지 않는다.</p>
 */
public record AuthorizationMatrix(
        Summary summary,
        List<Identity> identities,
        List<ConfigurationWarning> configurationWarnings,
        List<FunctionCell> functions,
        List<ObjectCell> objects,
        List<EvidenceRow> evidence,
        List<LegendItem> policyLegend,
        List<LegendItem> evidenceLegend,
        List<LegendItem> ownershipLegend) {

    public record Summary(
            int policyConfirmed,
            int policyReview,
            int bflaCandidates,
            int bolaIdorCandidates,
            int coverageGaps,
            int invalidExperiments,
            int bflaTestRecommendations,
            int bolaIdorTestRecommendations,
            int manualReviewPending,
            int humanConfirmed,
            int humanDismissed) {}

    public record Identity(String id, String label, String role, String kind) {}

    public record ConfigurationWarning(
            String code,
            String accountId,
            String accountLabel,
            String configuredService,
            String message) {}

    public record Confidence(String code, int level, String label, String basis) {}

    public enum Expected { ALLOW, DENY, UNKNOWN }

    public enum Actual { SUCCESS, DENIED, CONFLICT, AMBIGUOUS, UNTESTED }

    public enum Status {
        BFLA_REPRODUCED,
        BFLA_CANDIDATE,
        BFLA_TEST_RECOMMENDED,
        BFLA_REVIEW_REQUIRED,
        BOLA_REPRODUCED,
        BOLA_IDOR_CANDIDATE,
        BOLA_IDOR_TEST_RECOMMENDED,
        BOLA_IDOR_REVIEW_REQUIRED,
        POLICY_CONFIRMATION_REQUIRED,
        POLICY_ENFORCED,
        EXPECTED_ACCESS,
        EXPECTED_ACCESS_DENIED,
        UNKNOWN_POLICY,
        OWNERSHIP_UNKNOWN,
        INVALID_EXPERIMENT,
        COVERAGE_GAP,
        UNTESTED
    }

    public enum GateState { PASS, FAIL, UNKNOWN, NOT_APPLICABLE }

    public record Gate(String key, String label, GateState state, String reason) {}

    public enum OracleType {
        READ_SEMANTIC,
        CREATE_FOLLOW_UP,
        UPDATE_FOLLOW_UP,
        DELETE_FOLLOW_UP,
        ASYNC_POLL,
        BLIND_EXTERNAL,
        METADATA_ONLY
    }

    public record Oracle(OracleType type, String label, boolean satisfied, String requirement) {}

    public record TestRecommendation(
            String type,
            String basisIdentity,
            String basisIdentityLabel,
            String testIdentity,
            String testIdentityLabel,
            String reason,
            String instruction,
            boolean stateChanging,
            List<String> basisEvidenceIds) {}

    public record FunctionCell(
            String id,
            String identity,
            String identityLabel,
            String role,
            String operation,
            Expected expected,
            List<String> blockingLayers,
            Actual actual,
            Status status,
            String statusLabel,
            Confidence policy,
            Confidence evidence,
            Oracle oracle,
            List<Gate> gates,
            Map<String, String> sourceVerdicts,
            List<Integer> statusCodes,
            List<String> evidenceIds,
            String validationVerdict,
            TestRecommendation recommendation,
            String reviewStatus,
            String reviewNote,
            List<String> reviewEvidenceIds) {}

    public record ObjectCell(
            String id,
            String identity,
            String identityLabel,
            String role,
            String operation,
            String resource,
            String owner,
            String ownerLabel,
            String relation,
            List<String> techniques,
            String resourcePolicy,
            Expected expected,
            List<String> blockingLayers,
            Actual actual,
            Status status,
            String statusLabel,
            Confidence policy,
            Confidence evidence,
            Confidence ownership,
            Oracle oracle,
            List<Gate> gates,
            Map<String, String> sourceVerdicts,
            List<Integer> statusCodes,
            List<String> evidenceIds,
            String validationVerdict,
            TestRecommendation recommendation,
            String reviewStatus,
            String reviewNote,
            List<String> reviewEvidenceIds) {}

    public record EvidenceRow(
            String id,
            String type,
            String identity,
            String identityLabel,
            String operation,
            String resource,
            String resourcePolicy,
            List<String> blockingLayers,
            Status status,
            String statusLabel,
            Confidence policy,
            Confidence evidence,
            Confidence ownership,
            Oracle oracle,
            List<Gate> gates,
            Map<String, String> sourceVerdicts,
            List<Integer> statusCodes,
            List<String> evidenceIds,
            String validationVerdict,
            TestRecommendation recommendation,
            String reviewStatus,
            String reviewNote,
            List<String> reviewEvidenceIds) {}

    public record LegendItem(String code, String title, String description) {}
}
