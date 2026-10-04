package io.flowscope.core.discovery;

import java.util.List;

/** JavaScript를 실행하지 않고 AST에서 직접 확인한 HTTP call-site와 파싱 상태. */
public record JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                                 List<ResolutionIssue> issues, Status status, String detail,
                                 List<ClientRoute> clientRoutes, List<RouteHint> routeHints,
                                 boolean routeHintsTruncated) {
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
    /** body key 경로의 한 단계. {@code arrayElement}면 배열 원소 wildcard이고 key는 null, 아니면 리터럴 키(문자 {@code *} 포함). */
    public record Segment(String key, boolean arrayElement) {
        public static Segment element() { return new Segment(null, true); }
        public Segment {
            if (arrayElement ? key != null : key == null) {
                throw new IllegalArgumentException("segment is either a literal key or an array element");
            }
        }
    }

    /** body key 값이 리터럴이면 그 종류. DYNAMIC은 식별자·호출 등 정적으로 알 수 없는 값이다. */
    public enum LiteralKind { STRING, INTEGER, NUMBER, BOOLEAN, NULL, ARRAY, OBJECT, DYNAMIC }

    public record Parameter(String name, ParameterKind kind, List<Segment> segments, LiteralKind literal) {
        public Parameter(String name, ParameterKind kind) { this(name, kind, null, LiteralKind.DYNAMIC); }
        public Parameter(String name, ParameterKind kind, List<Segment> segments) { this(name, kind, segments, LiteralKind.DYNAMIC); }
        public Parameter {
            segments = segments == null ? null : List.copyOf(segments);
            literal = literal == null ? LiteralKind.DYNAMIC : literal;
        }
    }

    public record AssetReference(String reference, String reason, int line, int column) {}

    /** 라우터 설정 객체(`{path:"/shop", element:...}`)에 정적으로 적힌 클라이언트 화면 경로. 요청이 아니라 화면 주소다. */
    public record ClientRoute(String path, int line, int column) {}

    public enum RouteHintKind { PREFIX, PATH_FRAGMENT }

    /** Route-shaped JavaScript text not bound to a proven HTTP call-site. Never an endpoint declaration. */
    public record RouteHint(String value, RouteHintKind kind, int line, int column) {}

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
        clientRoutes = clientRoutes == null ? List.of() : List.copyOf(clientRoutes);
        routeHints = routeHints == null ? List.of() : List.copyOf(routeHints);
    }

    public JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                              List<ResolutionIssue> issues, Status status, String detail,
                              List<ClientRoute> clientRoutes) {
        this(callSites, assets, issues, status, detail, clientRoutes, List.of(), false);
    }

    public JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                              List<ResolutionIssue> issues, Status status, String detail) {
        this(callSites, assets, issues, status, detail, List.of(), List.of(), false);
    }

    public JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                              Status status, String detail) {
        this(callSites, assets, List.of(), status, detail, List.of(), List.of(), false);
    }
}
