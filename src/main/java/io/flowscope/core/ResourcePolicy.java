package io.flowscope.core;

/** 사용자가 명시하는 객체 공유 범위. UNKNOWN은 기존 소유관계 기반 추론을 유지한다. */
public enum ResourcePolicy {
    UNKNOWN("정책 미정"),
    OWNER_ONLY("소유자 전용"),
    ROLE_SHARED("동일 역할 공유"),
    AUTHENTICATED_SHARED("인증 사용자 공유"),
    PUBLIC("공개"),
    ADMIN_ONLY("관리자 전용");

    private final String label;

    ResourcePolicy(String label) { this.label = label; }

    public String label() { return label; }
}
