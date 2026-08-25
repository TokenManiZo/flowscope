package io.flowscope.core;

/** 요청 실행을 지시한 주체. 실제 요청 생성자인 Source 와 직교한다. */
public enum Orchestrator {
    HUMAN("사람"),
    LLM("LLM"),
    SYSTEM("시스템"),
    UNKNOWN("미상");

    private final String label;
    Orchestrator(String label) { this.label = label; }
    public String label() { return label; }
}
