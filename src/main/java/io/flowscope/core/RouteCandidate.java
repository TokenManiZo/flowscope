package io.flowscope.core;

import io.flowscope.core.parameter.ParameterCoordinates;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 실제 관측 operation과 아직 요청하지 않은 route를 분리하는 provenance 보존 모델. */
public record RouteCandidate(String service, String method, String pathTemplate,
                             List<String> concretePaths, boolean concretePathsTruncated, boolean observed,
                             List<Provenance> provenance,
                             Applicability applicability, String reviewReason,
                             List<DeclaredParameter> declaredParameters) {
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
        SCRIPT_DEPENDENCY,
        FRAMEWORK_MANIFEST_ASSET,
        HTML_EMBED,
        XML_ROUTE,
        BROWSER_RUNTIME,
        LLM_ARTIFACT_ANALYSIS,
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

    /** LLM이 현재 run의 응답 산출물에서 읽어 낸 값 없는 parameter 선언. */
    public record DeclaredParameter(SurfaceAnalysis.ParameterLocation location, String fieldPath,
                                    String displayName, SurfaceAnalysis.Requirement requirement,
                                    String evidenceId, Source source, String runId,
                                    String adapter, String reason,
                                    ParameterCoordinates.CoordinateVersion coordinateVersion) {
        public DeclaredParameter {
            if (location == null || fieldPath == null || fieldPath.isBlank()
                    || evidenceId == null || evidenceId.isBlank()) {
                throw new IllegalArgumentException("declared parameter requires location, path, and evidence");
            }
            displayName = displayName == null || displayName.isBlank() ? fieldPath : displayName;
            requirement = requirement == null ? SurfaceAnalysis.Requirement.UNKNOWN : requirement;
            source = source == null ? Source.UNKNOWN : source;
            runId = runId == null || runId.isBlank() ? "unknown-run" : runId;
            adapter = adapter == null || adapter.isBlank() ? "unknown-adapter" : adapter;
            reason = reason == null ? "" : reason;
            coordinateVersion = coordinateVersion == null
                    ? ParameterCoordinates.CoordinateVersion.LEGACY_V1 : coordinateVersion;
        }

        /** 좌표 버전 미상(LLM 산출물·구버전 project)은 LEGACY_V1로 저장하고 재적재 시 canonical로 변환한다. */
        public DeclaredParameter(SurfaceAnalysis.ParameterLocation location, String fieldPath,
                                 String displayName, SurfaceAnalysis.Requirement requirement,
                                 String evidenceId, Source source, String runId,
                                 String adapter, String reason) {
            this(location, fieldPath, displayName, requirement, evidenceId, source, runId, adapter, reason,
                    ParameterCoordinates.CoordinateVersion.LEGACY_V1);
        }
    }

    public RouteCandidate {
        method = method == null || method.isBlank() ? "UNKNOWN" : method;
        concretePaths = concretePaths == null ? List.of() : concretePaths.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(RouteCandidate::safeConcretePath).distinct().toList();
        provenance = provenance == null ? List.of() : List.copyOf(new LinkedHashSet<>(provenance));
        declaredParameters = declaredParameters == null
                ? List.of() : List.copyOf(new LinkedHashSet<>(declaredParameters));
        applicability = applicability == null ? Applicability.REVIEW : applicability;
        reviewReason = reviewReason == null ? "" : reviewReason;
        if (service == null || service.isBlank() || pathTemplate == null || pathTemplate.isBlank()) {
            throw new IllegalArgumentException("route candidate requires service and path");
        }
        if (provenance.isEmpty()) {
            throw new IllegalArgumentException("route candidate requires provenance");
        }
    }

    /** 기존 저장 형식과 호출부는 concrete 실행값이 없던 계약으로 계속 읽는다. */
    public RouteCandidate(String service, String method, String pathTemplate, boolean observed,
                          List<Provenance> provenance, Applicability applicability, String reviewReason) {
        this(service, method, pathTemplate,
                pathTemplate != null && !pathTemplate.contains("{") && !pathTemplate.contains("}")
                        ? List.of(pathTemplate) : List.of(),
                false, observed, provenance, applicability, reviewReason, List.of());
    }

    /** 기존 전체 생성자 호출은 선언 parameter가 없던 계약으로 계속 동작한다. */
    public RouteCandidate(String service, String method, String pathTemplate,
                          List<String> concretePaths, boolean concretePathsTruncated, boolean observed,
                          List<Provenance> provenance, Applicability applicability, String reviewReason) {
        this(service, method, pathTemplate, concretePaths, concretePathsTruncated, observed,
                provenance, applicability, reviewReason, List.of());
    }

    public Set<ProvenanceType> provenanceTypes() {
        return provenance.stream().map(Provenance::type)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    public List<String> provenanceEvidenceIds() {
        return provenance.stream().map(Provenance::evidenceId).distinct().toList();
    }

    private static String safeConcretePath(String value) {
        String masked = Masking.maskSecrets(value);
        if (value.equals(masked)) return value;
        int query = value.indexOf('?');
        return query >= 0 ? value.substring(0, query) : masked;
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
