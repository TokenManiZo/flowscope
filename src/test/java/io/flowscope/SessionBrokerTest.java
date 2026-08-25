package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.ScopePolicy;
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
    void treatsUnauthorizedAsSuspectButNotRoleDenialAndRequiresReauthenticationAfterDeletion() {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile("acct-a", "USER A",
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, Instant.EPOCH);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Cookie", "session=first"), Instant.EPOCH);
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
        broker.endCapture(handle);

        String safe = broker.views().toString();
        assertFalse(safe.contains("raw-secret-token"));
        assertFalse(safe.contains("raw-secret-cookie"));
        assertEquals(handle, broker.handleForAccount("acct-a"));

        broker.close();
        assertTrue(broker.views().isEmpty());
        assertThrows(IllegalArgumentException.class, () -> broker.handleForAccount("acct-a"));
    }
}
