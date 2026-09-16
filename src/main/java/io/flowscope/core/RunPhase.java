package io.flowscope.core;

/** 한 실행 안에서 요청이 발생한 목적 단계. */
public enum RunPhase {
    BASELINE,
    SESSION_SETUP,
    EXPLORATION,
    AUTHORIZATION_REPLAY,
    COACH_PROBE,
    VALIDATION,
    IMPORT,
    UNKNOWN
}
