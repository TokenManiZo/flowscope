package io.flowscope.core;

/** Exact-scope gate for active scanner and LLM proxy lanes. */
public final class ActiveTrafficGuard {
    private ActiveTrafficGuard() {}

    public static boolean allows(Source source, ScopePolicy scope, String target) {
        if (source != Source.SCANNER && source != Source.LLM) return true;
        return scope != null && scope.allows(target);
    }
}
