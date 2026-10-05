package io.flowscope.core;

/** 사용자가 service-qualified normalized operation에 명시한 분류 정책. */
public enum TrafficOverride {
    AUTO,
    INCLUDE,
    REVIEW,
    EXCLUDE
}
