package io.flowscope;

import io.flowscope.core.AccountVerificationRule;
import io.flowscope.core.VerificationOutcome;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

final class AccountVerificationRuleTest {

    private static AccountVerificationRule rule(String subject) {
        return AccountVerificationRule.fromExchange("acct-a", "GET",
                URI.create("https://api.test/me"), subject).orElseThrow();
    }

    @Test
    void matchesOnlyOnTheVerificationEndpointWithTheSuccessIndicator() {
        AccountVerificationRule rule = rule("\"id\":\"acct-a\"");
        assertEquals(VerificationOutcome.MATCHED,
                rule.evaluate("GET", URI.create("https://api.test/me"), "{\"id\":\"acct-a\",\"n\":1}"));
        // On the endpoint but the indicator is absent (e.g. a 200 login page).
        assertEquals(VerificationOutcome.TARGET_FAILED,
                rule.evaluate("GET", URI.create("https://api.test/me"), "<html>login</html>"));
        // A different endpoint grants no proof.
        assertEquals(VerificationOutcome.OFF_TARGET,
                rule.evaluate("GET", URI.create("https://api.test/orders"), "{\"id\":\"acct-a\"}"));
        // A different method is off-target too.
        assertEquals(VerificationOutcome.OFF_TARGET,
                rule.evaluate("POST", URI.create("https://api.test/me"), "{\"id\":\"acct-a\"}"));
    }

    @Test
    void normalizesEndpointToMethodOriginAndPathWithoutQueryOrFragment() {
        AccountVerificationRule rule = AccountVerificationRule.fromExchange("acct-a", "get",
                URI.create("https://api.test/me?token=secret#frag"), "acct-a").orElseThrow();
        assertEquals("GET", rule.method());
        assertEquals("https://api.test:443", rule.origin());
        assertEquals("/me", rule.path());
        // The stored rule keeps no query token, and still matches the same path regardless of query.
        assertFalse(rule.toString().contains("secret"));
        assertEquals(VerificationOutcome.MATCHED,
                rule.evaluate("GET", URI.create("https://api.test/me?token=other"), "acct-a here"));
    }

    @Test
    void aTargetOnlyRuleWithoutAnIndicatorIsNotStrongAndIsNotBuilt() {
        assertTrue(AccountVerificationRule.fromExchange("acct-a", "GET",
                URI.create("https://api.test/me"), "   ").isEmpty());
        assertTrue(AccountVerificationRule.fromExchange("acct-a", "GET",
                URI.create("https://api.test/me"), null).isEmpty());
    }

    @Test
    void rejectsCredentialLikeIndicators() {
        assertThrows(IllegalArgumentException.class, () -> rule("Bearer abcdef123456"));
        assertThrows(IllegalArgumentException.class, () -> rule("Authorization: x"));
        assertThrows(IllegalArgumentException.class, () -> rule("my-password-here password"));
        assertThrows(IllegalArgumentException.class,
                () -> rule("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef12"));
        assertThrows(IllegalArgumentException.class, () -> rule("x".repeat(201)));
    }

    @Test
    void directConstructorEnforcesOriginAndPathInvariants() {
        // The project-load path uses the canonical constructor, so it must reject malformed rules too.
        assertThrows(IllegalArgumentException.class,
                () -> new AccountVerificationRule("acct-a", "GET", "ftp://api.test", "/me", "acct-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new AccountVerificationRule("acct-a", "GET", "https://api.test:443/path", "/me", "acct-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new AccountVerificationRule("acct-a", "GET", "https://api.test:443?x=1", "/me", "acct-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new AccountVerificationRule("acct-a", "GET", "https://api.test:443", "me", "acct-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new AccountVerificationRule("acct-a", "GET", "https://api.test:443", "/me?x=1", "acct-a"));
        // A well-formed rule is accepted and its origin is canonicalized with the default port.
        AccountVerificationRule rule = new AccountVerificationRule("acct-a", "get", "https://api.test", "/me", "acct-a");
        assertEquals("GET", rule.method());
        assertEquals("https://api.test:443", rule.origin());
    }

    @Test
    void keepsShortHumanIdentityIndicators() {
        Optional<AccountVerificationRule> built = AccountVerificationRule.fromExchange("acct-a", "GET",
                URI.create("https://api.test/me"), "Welcome, USER A");
        assertTrue(built.isPresent());
        assertEquals("Welcome, USER A", built.orElseThrow().expectedSubject());
    }
}
