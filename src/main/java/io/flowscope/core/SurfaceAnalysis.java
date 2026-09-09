package io.flowscope.core;

import java.util.List;
import java.util.Set;

/**
 * 실제 HTTP 관측과 대상이 제공한 선언을 분리한 endpoint/parameter surface 사실 모델.
 * 값은 보존하지 않고 위치, 필드 경로, 형태, Evidence 역참조만 보존한다.
 */
public record SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions,
                              List<ProbeObservation> probes) {
    public enum ParameterLocation { PATH, QUERY, JSON_BODY, FORM_BODY, MULTIPART_BODY, HEADER, GRAPHQL_VARIABLE }
    public enum ValueShape { EMPTY, STRING, INTEGER, DECIMAL, BOOLEAN, UUID, ARRAY, OBJECT, NULL, BINARY, UNKNOWN }
    public enum Requirement { REQUIRED, OPTIONAL, UNKNOWN }
    public enum ExtractionStatus { PARSED, PARTIAL, FAILED, LIMIT_EXCEEDED }
    public enum ExtractionFailure { NONE, SYNTAX_RECOVERY, PARSE_FAILED, INPUT_SIZE_LIMIT, AST_NODE_LIMIT }
    public enum ExtractionIssueKind {
        DYNAMIC_URL,
        UNRESOLVED_MEMBER_REFERENCE,
        UNRESOLVED_AXIOS_BASE_URL,
        UNRECOGNIZED_APPLICATION_WRAPPER,
        UNSUPPORTED_INTERPROCEDURAL_FLOW
    }
    public enum DeltaState {
        DECLARED_NOT_OBSERVED,
        ONE_SOURCE_OBSERVED,
        MULTI_SOURCE_OBSERVED,
        ALL_SOURCES_OBSERVED,
        OBSERVED_NOT_DECLARED
    }

    public record EndpointKey(String service, String method, String pathTemplate) {
        public String operation() { return service + " " + method + " " + pathTemplate; }
        public String stableKey() { return service + "\u0000" + method + "\u0000" + pathTemplate; }
    }

    public record Observation(String evidenceId, Source source, String runId, String identity, int status) {}

    /** OPTIONS는 API 기능 관측과 분리해 보존하는 capability/preflight 근거다. */
    public record ProbeObservation(EndpointKey key, String evidenceId, Source source,
                                   String runId, String identity, int status) {}

    public record ParameterObservation(String evidenceId, Source source, String runId, String identity,
                                       int status, ValueShape shape) {}

    public record Declaration(String evidenceId, Source source, String runId, String type,
                              String adapter, String reason) {}

    public record ExtractionIssue(ExtractionIssueKind kind, String adapter, String detail,
                                  int line, int column) {}

    public record ExtractionReport(String evidenceId, Source source, String runId, String artifactKind,
                                   String adapter, ExtractionStatus status, ExtractionFailure failure, String detail,
                                   int endpointCallSites, int assetReferences, List<ExtractionIssue> issues) {
        public ExtractionReport {
            issues = issues == null ? List.of() : List.copyOf(issues);
        }

        public ExtractionReport(String evidenceId, Source source, String runId, String artifactKind,
                                String adapter, ExtractionStatus status, ExtractionFailure failure, String detail,
                                int endpointCallSites, int assetReferences) {
            this(evidenceId, source, runId, artifactKind, adapter, status, failure, detail,
                    endpointCallSites, assetReferences, List.of());
        }
    }

    public record ParameterFact(ParameterLocation location, String fieldPath, String displayName,
                                Requirement requirement, Set<ValueShape> observedShapes,
                                Set<Source> observedSources, List<String> observationEvidenceIds,
                                List<ParameterObservation> observations,
                                List<Declaration> declarations, DeltaState deltaState) {}

    public record EndpointFact(EndpointKey key, Set<Source> observedSources,
                               List<Observation> observations, List<Declaration> declarations,
                               List<ParameterFact> parameters, DeltaState deltaState) {}

    public SurfaceAnalysis {
        endpoints = endpoints == null ? List.of() : List.copyOf(endpoints);
        extractions = extractions == null ? List.of() : List.copyOf(extractions);
        probes = probes == null ? List.of() : List.copyOf(probes);
    }

    public SurfaceAnalysis(List<EndpointFact> endpoints) { this(endpoints, List.of(), List.of()); }

    public SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions) {
        this(endpoints, extractions, List.of());
    }
}
