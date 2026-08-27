package io.flowscope.core;

/** 관측 경로를 operation template으로 묶은 근거의 강도. 임의 점수는 사용하지 않는다. */
public enum PathTemplateStatus {
    /** 경로 변수로 바꾸지 않고 원문 세그먼트를 유지했다. */
    LITERAL,
    /** 서로 다른 값 또는 독립 관측이 같은 구조에서 반복되어 경로 변수로 추론했다. */
    INFERRED,
    /** 성공 응답의 동일 ID 값으로 다른 Evidence가 경로 변수 추론을 보강했다. */
    CORROBORATED
}
