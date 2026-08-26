package io.flowscope.core;

import java.util.List;
import java.util.Set;

/** 실제 관측 operation과 아직 요청하지 않은 route를 분리하는 provenance 보존 모델. */
public record RouteCandidate(String service, String method, String pathTemplate, boolean observed,
                             Set<ProvenanceType> provenanceTypes,
                             List<String> provenanceEvidenceIds,
                             Applicability applicability, String reviewReason) {
    public enum ProvenanceType {
        OBSERVED_REQUEST,
        BURP_UNREQUESTED,
        HTML_LINK,
        HTML_FORM,
        LOCATION,
        JAVASCRIPT_LITERAL,
        ROBOTS_OR_SITEMAP,
        WEB_MANIFEST,
        OPENAPI
    }

    public enum Applicability { APPLICABLE, REVIEW }

    public RouteCandidate {
        method = method == null || method.isBlank() ? "UNKNOWN" : method;
        provenanceTypes = provenanceTypes == null ? Set.of() : Set.copyOf(provenanceTypes);
        provenanceEvidenceIds = provenanceEvidenceIds == null ? List.of() : List.copyOf(provenanceEvidenceIds);
        applicability = applicability == null ? Applicability.REVIEW : applicability;
        reviewReason = reviewReason == null ? "" : reviewReason;
        if (service == null || service.isBlank() || pathTemplate == null || pathTemplate.isBlank()) {
            throw new IllegalArgumentException("route candidate requires service and path");
        }
        if (provenanceTypes.isEmpty() || provenanceEvidenceIds.isEmpty()) {
            throw new IllegalArgumentException("route candidate requires provenance");
        }
    }
}
