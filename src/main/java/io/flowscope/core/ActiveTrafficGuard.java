package io.flowscope.core;

/** Exact-scope gate for active scanner and LLM proxy lanes. */
public final class ActiveTrafficGuard {
    private ActiveTrafficGuard() {}

    public static boolean allows(Source source, ScopePolicy scope, String target) {
        if (source != Source.SCANNER && source != Source.LLM) return true;
        return scope != null && scope.allows(target);
    }

    /** 브라우저 사용은 막지 않되 모든 source의 저장 Evidence는 현재 exact scope로 제한한다. */
    public static boolean allowsCapture(ScopePolicy scope, String target) {
        return scope != null && scope.allows(target);
    }
}
