package io.flowscope.core;

/**
 * Evidence 신뢰도를 소비 목적별로 판정하는 단일 정책 경계다.
 * 원 관측은 보존하되, 통제되지 않은 SCANNER/LLM 런타임 트래픽이 완료를
 * 만족시키지 못하도록 생성 경로와 소비 자격을 분리한다.
 */
public final class SourceTrustPolicy {
    public enum Use {
        ANALYSIS_COVERAGE,
        LANE_COMPLETION
    }

    private SourceTrustPolicy() {}

    public static boolean allows(RequestRecord record, Use use) {
        if (record == null || record.source == null || record.executionTrust == null || use == null) return false;
        return allows(record.source, record.executionTrust, use);
    }

    public static boolean allows(Source source, ExecutionTrust trust, Use use) {
        if (source == null || trust == null || use == null || source == Source.UNKNOWN) return false;
        return switch (use) {
            // Legacy projects and pure analyzer fixtures may predate executionTrust. They remain usable for
            // non-decisive analysis, while explicitly observed external runtimes are quarantined.
            case ANALYSIS_COVERAGE -> trust != ExecutionTrust.UNVERIFIED_RUNTIME;
            case LANE_COMPLETION -> switch (source) {
                case HUMAN -> trust == ExecutionTrust.OBSERVED || trust == ExecutionTrust.CONTROLLED;
                case SCANNER, LLM -> trust == ExecutionTrust.CONTROLLED;
                case UNKNOWN -> false;
            };
        };
    }
}
