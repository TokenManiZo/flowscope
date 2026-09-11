package io.flowscope.core.discovery;

import java.util.List;

/** JavaScript를 실행하지 않고 AST에서 직접 확인한 HTTP call-site와 파싱 상태. */
public record JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                                 List<ResolutionIssue> issues, Status status, String detail) {
    public enum Status { PARSED, PARTIAL, PARSE_FAILED, LIMIT_EXCEEDED }

    public enum ParameterKind { QUERY, JSON_BODY, FORM_BODY }

    public enum ResolutionIssueKind {
        DYNAMIC_URL,
        UNRESOLVED_MEMBER_REFERENCE,
        UNRESOLVED_AXIOS_BASE_URL,
        UNRECOGNIZED_APPLICATION_WRAPPER,
        UNSUPPORTED_INTERPROCEDURAL_FLOW
    }

    /**
     * {@code segments}는 AST에서 보존한 body key 경로(중첩은 세그먼트, 배열 원소 객체는 {@code *})다.
     * null은 세그먼트 정보 없이 만들어진(이미 평탄화된) 이름으로, 점이 있으면 중첩과 리터럴 키를 구분할 수 없다.
     */
    public record Parameter(String name, ParameterKind kind, List<String> segments) {
        public Parameter(String name, ParameterKind kind) { this(name, kind, null); }
        public Parameter {
            segments = segments == null ? null : List.copyOf(segments);
        }
    }

    public record AssetReference(String reference, String reason, int line, int column) {}

    public record ResolutionIssue(ResolutionIssueKind kind, String adapter, String detail,
                                  int line, int column) {
        public ResolutionIssue {
            adapter = adapter == null || adapter.isBlank() ? "javascript-ast" : adapter;
            detail = detail == null ? "" : detail;
        }
    }

    public record CallSite(String reference, String method, List<Parameter> parameters,
                           String adapter, String reason, int line, int column) {
        public CallSite {
            method = method == null || method.isBlank() ? "UNKNOWN" : method;
            parameters = parameters == null ? List.of() : List.copyOf(parameters);
            adapter = adapter == null || adapter.isBlank() ? "javascript-ast" : adapter;
            reason = reason == null ? "" : reason;
        }
    }

    public JavascriptAnalysis {
        callSites = callSites == null ? List.of() : List.copyOf(callSites);
        assets = assets == null ? List.of() : List.copyOf(assets);
        issues = issues == null ? List.of() : List.copyOf(issues);
        status = status == null ? Status.PARSE_FAILED : status;
        detail = detail == null ? "" : detail;
    }

    public JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                              Status status, String detail) {
        this(callSites, assets, List.of(), status, detail);
    }
}
