package io.flowscope.core;

/**
 * 관측 소스 = 탐지 수단(비교 축). 신원(idn)과는 직교한다 (결정로그 D-001).
 * 실제 요청 생성자를 나타낸다. 누가 실행을 지시했는지는 Orchestrator 로 별도 보존한다.
 */
public enum Source {
    HUMAN("사람"),
    SCANNER("스캐너"),
    LLM("LLM"),
    /** 포트 매핑이 없어 출처를 판별 못 한 트래픽. 드롭하지 않고 '미상'으로 보존하되
     *  커버리지 집계에서는 제외한다 (F-01/F-03). */
    UNKNOWN("미상");

    private final String label;

    Source(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
