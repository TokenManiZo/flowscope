package io.flowscope.core;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 실제 관측 operation과 아직 요청하지 않은 route를 분리하는 provenance 보존 모델. */
public record RouteCandidate(String service, String method, String pathTemplate, boolean observed,
                             List<Provenance> provenance,
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
        OPENAPI,
        HTML_SCRIPT,
        HTML_EMBED,
        XML_ROUTE,
        LEGACY_UNMAPPED
    }

    public enum Applicability { APPLICABLE, REVIEW }

    public record Provenance(ProvenanceType type, String evidenceId, Source source,
                             String runId, String adapter, Applicability applicability, String reason) {
        public Provenance(ProvenanceType type, String evidenceId, Source source, String runId, String adapter) {
            this(type, evidenceId, source, runId, adapter, Applicability.REVIEW, "");
        }

        public Provenance {
            if (type == null || evidenceId == null || evidenceId.isBlank()) {
                throw new IllegalArgumentException("route provenance requires type and evidence");
            }
            source = source == null ? Source.UNKNOWN : source;
            runId = runId == null || runId.isBlank() ? "unknown-run" : runId;
            adapter = adapter == null || adapter.isBlank() ? "unknown-adapter" : adapter;
            applicability = applicability == null ? Applicability.REVIEW : applicability;
            reason = reason == null ? "" : reason;
        }
    }

    public RouteCandidate {
        method = method == null || method.isBlank() ? "UNKNOWN" : method;
        provenance = provenance == null ? List.of() : List.copyOf(new LinkedHashSet<>(provenance));
        applicability = applicability == null ? Applicability.REVIEW : applicability;
        reviewReason = reviewReason == null ? "" : reviewReason;
        if (service == null || service.isBlank() || pathTemplate == null || pathTemplate.isBlank()) {
            throw new IllegalArgumentException("route candidate requires service and path");
        }
        if (provenance.isEmpty()) {
            throw new IllegalArgumentException("route candidate requires provenance");
        }
    }

    public Set<ProvenanceType> provenanceTypes() {
        return provenance.stream().map(Provenance::type)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    public List<String> provenanceEvidenceIds() {
        return provenance.stream().map(Provenance::evidenceId).distinct().toList();
    }

    public Set<Source> discoveredSources() {
        return provenance.stream().map(Provenance::source)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    public Set<String> discoveredRunIds() {
        return provenance.stream().map(Provenance::runId)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }
}
