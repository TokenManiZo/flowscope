package io.flowscope.core;

/** 요청 당시 확인 가능한 인증 상태. Cookie 존재만으로 로그인으로 단정하지 않는다. */
public enum AuthState {
    ANONYMOUS,
    ACCOUNT_BOUND,
    UNRESOLVED
}
