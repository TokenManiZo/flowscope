package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.VerificationOutcome;
import io.flowscope.integration.SessionBroker;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class SessionBrokerTest {
    @Test
    void capturesRotatesAndInjectsOnlyInsideTheAccountServiceAndScope() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.parse("2026-08-25T00:00:00Z"));

        broker.observeRequest(handle, URI.create("https://api.test/login"), Map.of(
                "Cookie", "analytics=noise; session=first",
                "X-CSRF-Token", "csrf-1"), Instant.parse("2026-08-25T00:00:01Z"));
        broker.observeResponse(handle, URI.create("https://api.test/login"), 200, null, "ok",
                List.of("session=rotated; Path=/; Secure; HttpOnly", "prefs=compact; Path=/"),
                Instant.parse("2026-08-25T00:00:02Z"));
        broker.endCapture(handle);

        Map<String, String> headers = broker.headersForAccount("acct-a",
                URI.create("https://api.test/v1/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.parse("2026-08-25T00:00:03Z"));
        assertTrue(headers.get("Cookie").contains("session=rotated"));
        assertTrue(headers.get("Cookie").contains("prefs=compact"));
        assertEquals("csrf-1", headers.get("X-CSRF-Token"));
        assertFalse(headers.get("Cookie").contains("session=first"));

        assertThrows(IllegalArgumentException.class, () -> broker.headersForAccount("acct-a",
                URI.create("https://other.test/v1/orders"), ScopePolicy.parse("https://other.test/"),
                Instant.parse("2026-08-25T00:00:03Z")));
        assertThrows(IllegalArgumentException.class, () -> broker.headersForAccount("acct-a",
                URI.create("https://api.test/private"), ScopePolicy.parse("https://api.test/public"),
                Instant.parse("2026-08-25T00:00:03Z")));

        SessionBroker.SessionView view = broker.views().getFirst();
        assertEquals("acct-a", view.accountId());
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(3, view.cookieCount());
        assertFalse(view.toString().contains("rotated"));
        assertFalse(view.toString().contains("csrf-1"));
    }

    @Test
    void runningCaptureIsReplayReadyOnlyAfterAnAcceptedResponseLikeHeaders() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-b", "USER B", "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/me"), Map.of("Authorization", "Bearer b-token"), Instant.EPOCH);
        assertFalse(broker.viewForAccount("acct-b").orElseThrow().replayReady());

        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null, "{}", List.of(), Instant.EPOCH);
        broker.noteRecordedRequest(handle, "GET /me");
        SessionBroker.SessionView view = broker.viewForAccount("acct-b").orElseThrow();
        assertTrue(view.capturing());
        assertTrue(view.replayReady());
        assertNotNull(view.lastRecordedAt());
        assertEquals("Bearer b-token", broker.headersForAccount("acct-b", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(1)).get("Authorization"));
    }

    @Test
    void treatsUnauthorizedAsSuspectButNotRoleDenialAndRequiresReauthenticationAfterDeletion() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=first"), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);
        broker.endCapture(handle);

        broker.observeResponse(handle, URI.create("https://api.test/admin"), 403, null,
                "forbidden", List.of(), Instant.ofEpochSecond(1));
        assertEquals(SessionBroker.Status.ACTIVE, broker.viewForAccount("acct-a").orElseThrow().status());

        broker.observeResponse(handle, URI.create("https://api.test/me"), 401, null,
                "unauthorized", List.of(), Instant.ofEpochSecond(2));
        assertEquals(SessionBroker.Status.SUSPECT, broker.viewForAccount("acct-a").orElseThrow().status());
        assertThrows(IllegalStateException.class, () -> broker.headersForAccount("acct-a",
                URI.create("https://api.test/me"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)));

        broker.observeResponse(handle, URI.create("https://api.test/logout"), 200, null, "ok",
                List.of("session=; Max-Age=0; Path=/"), Instant.ofEpochSecond(3));
        assertEquals(SessionBroker.Status.REAUTH_REQUIRED,
                broker.viewForAccount("acct-a").orElseThrow().status());
    }

    @Test
    void neverPersistsOrReturnsRawSessionMaterialInItsSafeView() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"), Map.of(
                "Authorization", "Bearer raw-secret-token",
                "Cookie", "session=raw-secret-cookie"), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);
        broker.endCapture(handle);

        String safe = broker.views().toString();
        assertFalse(safe.contains("raw-secret-token"));
        assertFalse(safe.contains("raw-secret-cookie"));
        assertEquals(handle, broker.handleForAccount("acct-a"));

        broker.close();
        assertTrue(broker.views().isEmpty());
        assertThrows(IllegalArgumentException.class, () -> broker.handleForAccount("acct-a"));
    }

    @Test
    void resolvesOnlyOneExactManagedCredentialSet() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=secret; consent=yes"), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);
        broker.endCapture(handle);

        assertEquals("acct-a", broker.accountForRequest(URI.create("https://api.test/orders"),
                Map.of("Cookie", "theme=dark; consent=yes; session=secret"), Instant.ofEpochSecond(1)).orElseThrow());
        assertTrue(broker.accountForRequest(URI.create("https://api.test/orders"),
                Map.of("Cookie", "consent=yes; session=other"), Instant.ofEpochSecond(1)).isEmpty());
    }

    @Test
    void requiresANonSuspiciousResponseBeforeAClaimedLoginSessionBecomesActive() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Authorization", "Bearer token-a"), Instant.EPOCH);

        broker.endCapture(handle);

        assertEquals(SessionBroker.Status.UNVERIFIED,
                broker.viewForAccount("acct-a").orElseThrow().status());
        assertThrows(IllegalStateException.class, () -> broker.headersForAccount("acct-a",
                URI.create("https://api.test/me"), ScopePolicy.parse("https://api.test/"), Instant.EPOCH));
    }

    @Test
    void preventsTwoAccountsFromCapturingTheSameServiceAtTheSameTime() {
        SessionBroker broker = new SessionBroker();
        AccountProfile accountA = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        AccountProfile accountB = new AccountProfile("acct-b", "USER B",
                "https://api.test:443", AccessRole.USER);
        broker.beginCapture(accountA, Instant.EPOCH);

        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> broker.beginCapture(accountB, Instant.EPOCH));

        assertTrue(error.getMessage().contains("acct-a"));
        assertTrue(broker.viewForAccount("acct-b").isEmpty());
    }

    @Test
    void credentialBindingConflictCannotReturnToActiveWithoutAReplacementCapture() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-b", "USER B",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=shared"), Instant.EPOCH);
        broker.markCredentialConflict("acct-b");

        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"acct-b\"}", List.of(), Instant.ofEpochSecond(1));
        broker.endCapture(handle);

        SessionBroker.SessionView view = broker.viewForAccount("acct-b").orElseThrow();
        assertEquals(SessionBroker.Status.SUSPECT, view.status());
        assertTrue(view.credentialConflict());
        assertThrows(IllegalStateException.class, () -> broker.headersForAccount("acct-b",
                URI.create("https://api.test/me"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)));
    }

    @Test
    void conflictedSessionCannotMakeTheOriginalAccountAmbiguous() {
        SessionBroker broker = new SessionBroker();
        AccountProfile original = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String originalHandle = broker.beginCapture(original, Instant.EPOCH);
        broker.observeRequest(originalHandle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=shared"), Instant.EPOCH);
        broker.observeResponse(originalHandle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"acct-a\"}", List.of(), Instant.ofEpochSecond(1));
        broker.endCapture(originalHandle);

        AccountProfile conflicting = new AccountProfile("acct-b", "USER B",
                "https://api.test:443", AccessRole.USER);
        String conflictingHandle = broker.beginCapture(conflicting, Instant.ofEpochSecond(2));
        broker.observeRequest(conflictingHandle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=shared"), Instant.ofEpochSecond(2));
        broker.markCredentialConflict("acct-b");

        assertEquals("acct-a", broker.accountForRequest(URI.create("https://api.test/me"),
                Map.of("Cookie", "session=shared"), Instant.ofEpochSecond(3)).orElseThrow());
    }

    @Test
    void declaresEveryHeaderThatManagedRunsMustRemoveBeforeInjection() {
        assertEquals(java.util.Set.of("Authorization", "Cookie", "Proxy-Authorization",
                        "X-CSRF-Token", "X-XSRF-Token", "X-CSRFToken"),
                SessionBroker.managedHeaderNames());
    }

    @Test
    void importsExplicitBurpExchangesIntoIndependentReusableAccountSlots() {
        SessionBroker broker = new SessionBroker();
        AccountProfile accountA = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        AccountProfile accountB = new AccountProfile("acct-b", "USER B",
                "https://api.test:443", AccessRole.USER);

        broker.captureObservedExchange(accountA, URI.create("https://api.test/me"),
                Map.of("Authorization", "Bearer token-a", "Cookie", "session=a"),
                200, null, "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);
        broker.captureObservedExchange(accountB, URI.create("https://api.test/me"),
                Map.of("Authorization", "Bearer token-b", "Cookie", "session=b"),
                200, null, "{\"id\":\"acct-b\"}", List.of(), Instant.ofEpochSecond(1));

        assertEquals(SessionBroker.Status.ACTIVE,
                broker.viewForAccount("acct-a").orElseThrow().status());
        assertEquals(SessionBroker.Status.ACTIVE,
                broker.viewForAccount("acct-b").orElseThrow().status());
        assertEquals("Bearer token-a", broker.headersForAccount("acct-a",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)).get("Authorization"));
        assertEquals("Bearer token-b", broker.headersForAccount("acct-b",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)).get("Authorization"));
        assertFalse(broker.views().toString().contains("token-a"));
        assertFalse(broker.views().toString().contains("session=b"));
    }

    @Test
    void rejectsCrossAccountCredentialReuseWithoutDestroyingEitherValidSlot() {
        SessionBroker broker = new SessionBroker();
        AccountProfile accountA = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        AccountProfile accountB = new AccountProfile("acct-b", "USER B",
                "https://api.test:443", AccessRole.USER);
        broker.captureObservedExchange(accountA, URI.create("https://api.test/me"),
                Map.of("Cookie", "session=a"), 200, null, "ok", List.of(), Instant.EPOCH);
        broker.captureObservedExchange(accountB, URI.create("https://api.test/me"),
                Map.of("Cookie", "session=b"), 200, null, "ok", List.of(), Instant.ofEpochSecond(1));

        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> broker.captureObservedExchange(accountB, URI.create("https://api.test/me"),
                        Map.of("Cookie", "session=a"), 200, null, "ok", List.of(),
                        Instant.ofEpochSecond(2)));

        assertTrue(error.getMessage().contains("acct-a"));
        assertTrue(broker.headersForAccount("acct-a", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(3))
                .get("Cookie").contains("session=a"));
        assertTrue(broker.headersForAccount("acct-b", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(3))
                .get("Cookie").contains("session=b"));
    }

    @Test
    void refusesSelectedBurpExchangeWithoutReusableCredentialsOrUsableResponse() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);

        assertThrows(IllegalArgumentException.class,
                () -> broker.captureObservedExchange(account, URI.create("https://api.test/me"),
                        Map.of("Accept", "application/json"), 200, null, "ok", List.of(), Instant.EPOCH));
        assertThrows(IllegalStateException.class,
                () -> broker.captureObservedExchange(account, URI.create("https://api.test/me"),
                        Map.of("Authorization", "Bearer expired"), 401, null, "unauthorized",
                        List.of(), Instant.EPOCH));
        assertTrue(broker.viewForAccount("acct-a").isEmpty());
    }

    // --- Stage 6: verification source (ACTIVE ⊥ proof strength) ---

    private static String captureLegacyActive(SessionBroker broker, String accountId) {
        AccountProfile account = new AccountProfile(accountId, accountId,
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=" + accountId), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/home"), 200, null, "ok",
                List.of(), Instant.EPOCH);
        broker.endCapture(handle);
        return handle;
    }

    @Test
    void legacyResponseActiveIsNotStrongEnoughForVerifiedReplay() {
        SessionBroker broker = new SessionBroker();
        captureLegacyActive(broker, "acct-a");

        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.LEGACY_RESPONSE, view.verificationSource());
        // Legacy ACTIVE still usable for backward-compatible Request Lab...
        assertNotNull(broker.headersForAccount("acct-a", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(1)));
        // ...but rejected by the strong gate used for active cross-identity replay.
        assertThrows(IllegalStateException.class, () -> broker.headersForVerifiedAccount("acct-a",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(1)));
    }

    @Test
    void operatorImportedExchangeIsAssertedAndUsableForVerifiedReplay() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        broker.captureObservedExchange(account, URI.create("https://api.test/me"),
                Map.of("Cookie", "session=a"), 200, null, "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);

        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.OPERATOR_ASSERTED, view.verificationSource());
        assertTrue(broker.headersForVerifiedAccount("acct-a", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(1)).get("Cookie").contains("session=a"));
    }

    @Test
    void ruleMatchedResponsePromotesToRuleMatchedAndClearsPendingFromCapturing() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=a"), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null, "{\"id\":\"acct-a\"}",
                List.of(), Instant.EPOCH, VerificationOutcome.MATCHED);
        // During capture the external verification source stays NONE.
        assertEquals(SessionBroker.VerificationSource.NONE,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());

        broker.endCapture(handle);
        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.RULE_MATCHED, view.verificationSource());
        assertNotNull(broker.headersForVerifiedAccount("acct-a", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(1)));
    }

    @Test
    void ruleTargetFailedKeepsSessionUnverified() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=a"), Instant.EPOCH);
        // 200 login page on the verification endpoint: explicit success indicator did not match.
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null, "<login form>",
                List.of(), Instant.EPOCH, VerificationOutcome.TARGET_FAILED);
        broker.endCapture(handle);

        assertEquals(SessionBroker.Status.UNVERIFIED,
                broker.viewForAccount("acct-a").orElseThrow().status());
        assertThrows(IllegalStateException.class, () -> broker.headersForVerifiedAccount("acct-a",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(1)));
    }

    @Test
    void offTargetResponseUnderARuleDoesNotStronglyPromote() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=a"), Instant.EPOCH);
        broker.observeResponse(handle, URI.create("https://api.test/orders"), 200, null, "[]",
                List.of(), Instant.EPOCH, VerificationOutcome.OFF_TARGET);
        broker.endCapture(handle);

        assertEquals(SessionBroker.Status.UNVERIFIED,
                broker.viewForAccount("acct-a").orElseThrow().status());
    }

    @Test
    void legacyActiveUpgradesToRuleMatchedAndIsNotDowngradedByUnrelatedResponses() {
        SessionBroker broker = new SessionBroker();
        String handle = captureLegacyActive(broker, "acct-a");
        assertEquals(SessionBroker.VerificationSource.LEGACY_RESPONSE,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());

        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null, "{\"id\":\"acct-a\"}",
                List.of(), Instant.ofEpochSecond(1), VerificationOutcome.MATCHED);
        assertEquals(SessionBroker.VerificationSource.RULE_MATCHED,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());

        // An unrelated off-target 2xx must not downgrade a strong session back to LEGACY.
        broker.observeResponse(handle, URI.create("https://api.test/orders"), 200, null, "[]",
                List.of(), Instant.ofEpochSecond(2), VerificationOutcome.OFF_TARGET);
        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.RULE_MATCHED, view.verificationSource());
    }

    @Test
    void leavingActiveResetsVerificationSourceToNone() {
        SessionBroker broker = new SessionBroker();
        String handle = captureLegacyActive(broker, "acct-a");
        broker.observeResponse(handle, URI.create("https://api.test/me"), 401, null, "unauthorized",
                List.of(), Instant.ofEpochSecond(1));
        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.SUSPECT, view.status());
        assertEquals(SessionBroker.VerificationSource.NONE, view.verificationSource());
    }

    @Test
    void invalidatedSessionDoesNotAutoReviveToActiveOnAPlainRequest() {
        SessionBroker broker = new SessionBroker();
        String handle = captureLegacyActive(broker, "acct-a");
        assertEquals(SessionBroker.Status.ACTIVE, broker.viewForAccount("acct-a").orElseThrow().status());
        broker.observeResponse(handle, URI.create("https://api.test/me"), 401, null, "unauthorized",
                List.of(), Instant.ofEpochSecond(1));
        assertEquals(SessionBroker.Status.SUSPECT, broker.viewForAccount("acct-a").orElseThrow().status());

        // A later plain authenticated request must not settle straight back to ACTIVE without a new
        // confirming response — responseConfirmed was cleared on invalidation.
        broker.observeRequest(handle, URI.create("https://api.test/orders"),
                Map.of("Cookie", "session=acct-a"), Instant.ofEpochSecond(2));
        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertNotEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.NONE, view.verificationSource());
    }

    @Test
    void credentialConflictAndMaterialLossAlsoClearResponseConfirmed() {
        // credential conflict path
        SessionBroker conflictBroker = new SessionBroker();
        String conflictHandle = captureLegacyActive(conflictBroker, "acct-a");
        conflictBroker.markCredentialConflict("acct-a");
        conflictBroker.observeRequest(conflictHandle, URI.create("https://api.test/orders"),
                Map.of("Cookie", "session=acct-a"), Instant.ofEpochSecond(2));
        assertNotEquals(SessionBroker.Status.ACTIVE,
                conflictBroker.viewForAccount("acct-a").orElseThrow().status());

        // material loss path (cookie cleared via Max-Age=0)
        SessionBroker materialBroker = new SessionBroker();
        String materialHandle = captureLegacyActive(materialBroker, "acct-b");
        materialBroker.observeResponse(materialHandle, URI.create("https://api.test/logout"), 200, null, "ok",
                List.of("session=acct-b; Max-Age=0; Path=/"), Instant.ofEpochSecond(2));
        assertEquals(SessionBroker.Status.REAUTH_REQUIRED,
                materialBroker.viewForAccount("acct-b").orElseThrow().status());
        assertEquals(SessionBroker.VerificationSource.NONE,
                materialBroker.viewForAccount("acct-b").orElseThrow().verificationSource());
    }

    @Test
    void targetFailedResponseInvalidatesEvenAStronglyVerifiedSession() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        broker.captureObservedExchange(account, URI.create("https://api.test/me"),
                Map.of("Cookie", "session=a"), 200, null, "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);
        assertEquals(SessionBroker.VerificationSource.OPERATOR_ASSERTED,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());

        // The verification endpoint now returns a 200 login page: strong proof is lost, not preserved.
        broker.observeResponse(broker.handleForAccount("acct-a"), URI.create("https://api.test/me"),
                200, null, "<login form>", List.of(), Instant.ofEpochSecond(1), VerificationOutcome.TARGET_FAILED);
        SessionBroker.SessionView view = broker.viewForAccount("acct-a").orElseThrow();
        assertEquals(SessionBroker.Status.UNVERIFIED, view.status());
        assertEquals(SessionBroker.VerificationSource.NONE, view.verificationSource());
        assertThrows(IllegalStateException.class, () -> broker.headersForVerifiedAccount("acct-a",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)));
    }

    @Test
    void registerAssertedSessionInstallsOperatorAssertedWithoutCrossAccountConflict() {
        SessionBroker broker = new SessionBroker();
        AccountProfile a = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        broker.captureObservedExchange(a, URI.create("https://api.test/me"),
                Map.of("Cookie", "sess_a=aaa"), 200, null, "{\"id\":\"acct-a\"}", List.of(), Instant.EPOCH);

        // The operator pastes USER B's credential directly. Even with USER A's residual cookie present
        // (same-browser sequential login), the explicit path has no cross-account block, so it succeeds.
        AccountProfile b = new AccountProfile("acct-b", "USER B", "https://api.test:443", AccessRole.USER);
        broker.registerAssertedSession(b, "sess_a=aaa; sess_b=zzz-secret", "Bearer btoken", Instant.ofEpochSecond(1));

        SessionBroker.SessionView view = broker.viewForAccount("acct-b").orElseThrow();
        assertEquals(SessionBroker.Status.ACTIVE, view.status());
        assertEquals(SessionBroker.VerificationSource.OPERATOR_ASSERTED, view.verificationSource());
        assertEquals("Bearer btoken", broker.headersForVerifiedAccount("acct-b",
                URI.create("https://api.test/orders"), ScopePolicy.parse("https://api.test/"),
                Instant.ofEpochSecond(2)).get("Authorization"));
        // Raw material never appears in the safe view, and account A's slot is untouched.
        assertFalse(broker.views().toString().contains("btoken"));
        // 세션 handle은 무작위 UUID(16진수)라 16진수 문자만으로 된 값은 우연히 겹칠 수 있다. 16진수 밖의 값으로 검사한다.
        assertFalse(broker.views().toString().contains("zzz-secret"));
        assertEquals(SessionBroker.Status.ACTIVE, broker.viewForAccount("acct-a").orElseThrow().status());
    }

    @Test
    void pastedHeaderMapStoresManagedHeadersAndPreviewsOnlyAShortPrefix() {
        SessionBroker broker = new SessionBroker();
        AccountProfile a = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        broker.registerAssertedSession(a, Map.of("authorization", "Bearer eyJhbGciOiJzecret-tail",
                "Cookie", "sid=abcdefghijklmn-secret; x=1", "X-XSRF-Token", "csrf-value-long-enough",
                "Accept", "application/json"), Instant.EPOCH);

        Map<String, String> replay = broker.headersForAccount("acct-a", URI.create("https://api.test/orders"),
                ScopePolicy.parse("https://api.test/"), Instant.ofEpochSecond(1));
        assertEquals("Bearer eyJhbGciOiJzecret-tail", replay.get("Authorization"));
        assertEquals("csrf-value-long-enough", replay.get("X-XSRF-Token"));
        assertFalse(replay.containsKey("Accept"));

        String previews = broker.credentialPreviews("acct-a").toString();
        assertTrue(previews.contains("Bearer eyJh••••"));
        assertTrue(previews.contains("sid=abcd••••"));
        assertTrue(previews.contains("x=••••"));
        assertFalse(previews.contains("secret"));
        assertEquals(List.of(), broker.credentialPreviews("missing"));
    }

    @Test
    void registerAssertedSessionRejectsEmptyMaterial() {
        SessionBroker broker = new SessionBroker();
        AccountProfile a = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        assertThrows(IllegalArgumentException.class,
                () -> broker.registerAssertedSession(a, "  ", "  ", Instant.EPOCH));
    }

    @Test
    void matchedResponseWithErrorStatusDoesNotPromoteLegacyToRuleMatched() {
        SessionBroker broker = new SessionBroker();
        String handle = captureLegacyActive(broker, "acct-a");
        assertEquals(SessionBroker.VerificationSource.LEGACY_RESPONSE,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());

        // A 500 that echoes the subject is MATCHED-shaped but not a success status: no RULE_MATCHED upgrade.
        broker.observeResponse(handle, URI.create("https://api.test/me"), 500, null, "{\"id\":\"acct-a\"}",
                List.of(), Instant.ofEpochSecond(1), VerificationOutcome.MATCHED);
        assertEquals(SessionBroker.VerificationSource.LEGACY_RESPONSE,
                broker.viewForAccount("acct-a").orElseThrow().verificationSource());
    }

    // --- HUMAN pass recording: the operator's account choice wins, credentials follow the latest login ---

    private static final URI API = URI.create("https://api.test/v1/orders");
    private static final ScopePolicy SCOPE = ScopePolicy.parse("https://api.test/");

    private static String jwt(String sub) { return jwt(sub, 1); }

    private static String jwt(String sub, int iat) {
        java.util.Base64.Encoder encoder = java.util.Base64.getUrlEncoder().withoutPadding();
        return "Bearer " + encoder.encodeToString("{\"alg\":\"none\"}".getBytes())
                + "." + encoder.encodeToString(("{\"sub\":\"" + sub + "\",\"iat\":" + iat + "}").getBytes())
                + ".sig";
    }

    private static String beginRecording(SessionBroker broker, String accountId) {
        return broker.beginCapture(new AccountProfile(accountId, accountId, "https://api.test:443", AccessRole.USER),
                Instant.EPOCH);
    }

    @Test
    void recordingFollowsRotatingCookiesAndReplaysTheLatestValuesWhileStillCapturing() {
        SessionBroker broker = new SessionBroker();
        String handle = beginRecording(broker, "acct-a");
        broker.observeRequest(handle, API, Map.of("Cookie", "NNB=t; NID_SES=s1"), Instant.EPOCH);
        broker.observeResponse(handle, API, 200, null, "ok", List.of(), Instant.EPOCH);
        broker.observeRequest(handle, API, Map.of("Cookie", "NNB=t; NID_SES=s2"), Instant.ofEpochSecond(1));

        assertEquals(handle, broker.activeCaptureForService("https://api.test:443").orElseThrow());
        String cookie = broker.headersForAccount("acct-a", API, SCOPE, Instant.ofEpochSecond(2)).get("Cookie");
        assertTrue(cookie.contains("NID_SES=s2"));
        assertFalse(cookie.contains("NID_SES=s1"));
    }

    @Test
    void theOperatorsCaptureFollowsANewLoginInsteadOfPausing() {
        SessionBroker broker = new SessionBroker();
        String handle = beginRecording(broker, "acct-b");
        // Leftover traffic of the previous account, then the operator logs in as B: both stay in B's capture.
        broker.observeRequest(handle, API, Map.of("Authorization", jwt("alice")), Instant.EPOCH);
        broker.observeRequest(handle, API, Map.of("Authorization", jwt("bob")), Instant.ofEpochSecond(1));
        broker.observeResponse(handle, API, 200, null, "{\"error\":\"token expired\"}", List.of(), Instant.ofEpochSecond(1));
        broker.observeResponse(handle, API, 200, null, "ok", List.of(), Instant.ofEpochSecond(2));

        assertEquals(handle, broker.activeCaptureForService("https://api.test:443").orElseThrow());
        assertEquals(jwt("bob"), broker.headersForAccount("acct-b", API, SCOPE, Instant.ofEpochSecond(3)).get("Authorization"));
        // Burp tool traffic compares against the browser's latest login.
        assertTrue(broker.matchesRecordingIdentity(handle, Map.of("Authorization", jwt("bob", 9))));
        assertFalse(broker.matchesRecordingIdentity(handle, Map.of("Authorization", jwt("alice"))));
        broker.noteRecordedRequest(handle, "GET /v1/orders");
        assertEquals("GET /v1/orders", broker.viewForAccount("acct-b").orElseThrow().lastRecordedApi());
        assertNotNull(broker.viewForAccount("acct-b").orElseThrow().lastRecordedAt());
    }

    @Test
    void toolRequestsWithAnotherAuthorizationIdentityAreNotAttributedToTheRecording() {
        SessionBroker broker = new SessionBroker();
        String handle = beginRecording(broker, "acct-a");
        assertTrue(broker.matchesRecordingIdentity(handle, Map.of("Authorization", jwt("alice"))));
        broker.observeRequest(handle, API, Map.of("Authorization", jwt("alice")), Instant.EPOCH);

        assertTrue(broker.matchesRecordingIdentity(handle, Map.of("Authorization", jwt("alice"))));
        assertTrue(broker.matchesRecordingIdentity(handle, Map.of("Cookie", "sid=1")));
        assertFalse(broker.matchesRecordingIdentity(handle, Map.of("Authorization", jwt("bob"))));
    }

    @Test
    void authorizationOwnerIgnoresCookieOnlySessionsLeftWithSharedTrackerCookies() {
        SessionBroker broker = new SessionBroker();
        String b = beginRecording(broker, "acct-b");
        broker.observeRequest(b, API, Map.of("Cookie", "NNB=t; NID_AUT=b"), Instant.EPOCH);
        broker.observeResponse(b, API, 200, null, "ok", List.of("NID_AUT=; Max-Age=0; Path=/"), Instant.EPOCH);
        broker.endCapture(b);
        Map<String, String> aliceRequest = Map.of("Cookie", "NNB=t; NID_AUT=a");

        // The strict cookie matcher sees B's leftover tracker cookie as "all stored cookies present".
        assertEquals("acct-b", broker.accountForRequest(API, aliceRequest, Instant.EPOCH).orElseThrow());
        // Recording ownership checks therefore use only exact Authorization ownership.
        assertTrue(broker.accountForAuthorization(API, null).isEmpty());

        String c = beginRecording(broker, "acct-c");
        broker.observeRequest(c, API, Map.of("Authorization", jwt("carol")), Instant.EPOCH);
        broker.observeResponse(c, API, 200, null, "ok", List.of(), Instant.EPOCH);
        broker.endCapture(c);
        assertEquals("acct-c", broker.accountForAuthorization(API, jwt("carol")).orElseThrow());
        assertTrue(broker.accountForAuthorization(API, jwt("dave")).isEmpty());
    }
}
