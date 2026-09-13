package io.flowscope.core;

/** FlowScope가 대상 요청 경로를 통제했는지 외부 클라이언트를 관측만 했는지 나타낸다. */
public enum ExecutionTrust {
    CONTROLLED,
    OBSERVED,
    UNVERIFIED_RUNTIME,
    IMPORTED,
    UNKNOWN
}
