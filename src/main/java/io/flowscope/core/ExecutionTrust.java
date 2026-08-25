package io.flowscope.core;

/** Whether FlowScope controlled the target request path or only observed an external client. */
public enum ExecutionTrust {
    CONTROLLED,
    OBSERVED,
    UNVERIFIED_RUNTIME,
    IMPORTED,
    UNKNOWN
}
