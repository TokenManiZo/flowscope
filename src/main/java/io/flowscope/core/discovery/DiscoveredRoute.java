package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;

/** Adapter가 발견한 원시 참조. scope·정규화·dedup은 공통 core가 담당한다. */
public record DiscoveredRoute(String reference, String method,
                              RouteCandidate.ProvenanceType provenanceType,
                              RouteCandidate.Applicability applicability,
                              String reason, String adapter) {
    public DiscoveredRoute {
        method = method == null || method.isBlank() ? "UNKNOWN" : method;
        applicability = applicability == null ? RouteCandidate.Applicability.REVIEW : applicability;
        reason = reason == null ? "" : reason;
        if (reference == null || reference.isBlank() || provenanceType == null
                || adapter == null || adapter.isBlank()) {
            throw new IllegalArgumentException("discovered route requires reference, provenance, and adapter");
        }
    }
}
