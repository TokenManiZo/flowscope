package io.flowscope;

import io.flowscope.core.ActiveTrafficGuard;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ActiveTrafficGuardTest {
    private final ScopePolicy scope = ScopePolicy.parse("https://api.example.test/v1");

    @Test
    void scanner와_llm은_exact_scope를_강제한다() {
        assertTrue(ActiveTrafficGuard.allows(Source.SCANNER, scope,
                "https://api.example.test/v1/orders"));
        assertFalse(ActiveTrafficGuard.allows(Source.SCANNER, scope,
                "https://api.example.test/admin"));
        assertFalse(ActiveTrafficGuard.allows(Source.LLM, scope,
                "https://api.example.test/v1/../admin"));
    }

    @Test
    void human과_unknown은_능동_도구_가드_대상이_아니다() {
        assertTrue(ActiveTrafficGuard.allows(Source.HUMAN, scope, "https://outside.example/"));
        assertTrue(ActiveTrafficGuard.allows(Source.UNKNOWN, scope, "https://outside.example/"));
    }

    @Test
    void 빈_scope는_scanner와_llm을_모두_차단한다() {
        ScopePolicy empty = ScopePolicy.parse("");
        assertFalse(ActiveTrafficGuard.allows(Source.SCANNER, empty, "https://api.example.test/v1"));
        assertFalse(ActiveTrafficGuard.allows(Source.LLM, empty, "https://api.example.test/v1"));
    }
}
