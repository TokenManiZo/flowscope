package io.flowscope.core.discovery;

import java.util.List;

/** JavaScript를 실행하지 않고 AST에서 직접 확인한 HTTP call-site와 파싱 상태. */
public record JavascriptAnalysis(List<CallSite> callSites, List<AssetReference> assets,
                                 Status status, String detail) {
    public enum Status { PARSED, PARTIAL, PARSE_FAILED, LIMIT_EXCEEDED }

    public enum ParameterKind { QUERY, JSON_BODY, FORM_BODY }

    public record Parameter(String name, ParameterKind kind) {}

    public record AssetReference(String reference, String reason, int line, int column) {}

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
        status = status == null ? Status.PARSE_FAILED : status;
        detail = detail == null ? "" : detail;
    }
}
