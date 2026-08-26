package io.flowscope.core;

import java.util.List;

/** 비파괴 트래픽 분류 결과. 제외는 저장 삭제가 아니라 분석 커버리지 제외를 뜻한다. */
public record TrafficClassification(TrafficClass trafficClass, Disposition disposition,
                                    List<String> reasons, boolean userOverride) {
    public enum TrafficClass {
        API,
        NAVIGATION,
        STATIC_ASSET,
        DISCOVERY_METADATA,
        PREFLIGHT,
        TELEMETRY_CANDIDATE,
        BACKGROUND,
        UNKNOWN
    }

    public enum Disposition {
        INCLUDE,
        EXCLUDE,
        REVIEW
    }

    public TrafficClassification {
        trafficClass = trafficClass == null ? TrafficClass.UNKNOWN : trafficClass;
        disposition = disposition == null ? Disposition.REVIEW : disposition;
        reasons = reasons == null ? List.of() : List.copyOf(reasons);
    }

    public boolean coverageEligible() {
        return disposition == Disposition.INCLUDE;
    }

    public static TrafficClassification unresolved(String reason) {
        return new TrafficClassification(TrafficClass.UNKNOWN, Disposition.REVIEW, List.of(reason), false);
    }
}
