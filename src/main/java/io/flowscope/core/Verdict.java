package io.flowscope.core;

/** 소스별 접근 판정 5종(F-10). */
public enum Verdict {
    ALLOW("정상 허용"),
    DENY("정상 차단"),
    SUSPICIOUS("의심 허용"),
    UNDECIDED("판단 불가"),
    UNTESTED("미검증");

    private final String label;
    Verdict(String label) { this.label = label; }
    public String label() { return label; }
}
