package io.flowscope.core;

/** HTTP 요청을 실제로 실행한 도구. */
public enum ToolKind {
    BROWSER, BURP, ZAP, CODEX,
    /** 과거 프로젝트의 provenance 역직렬화 전용. 새 Explorer 실행기는 이 값을 사용하지 않는다. */
    @Deprecated CLAUDE,
    OTHER, UNKNOWN
}
