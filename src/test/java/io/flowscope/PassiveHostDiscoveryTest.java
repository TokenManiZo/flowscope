package io.flowscope;

import io.flowscope.core.PassiveHostDiscovery;
import io.flowscope.core.ScopePolicy;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PassiveHostDiscoveryTest {
    private final PassiveHostDiscovery discovery = new PassiveHostDiscovery();
    private final ScopePolicy scope = ScopePolicy.parse("https://example.test/");

    @Test void passiveCaptureRequiresAnObservedDescendantAndPreservesPathAndDatasetBoundaries() {
        String url = "https://api.example.test/orders";
        assertFalse(discovery.allowsPassiveCapture(0, scope, url));
        discovery.observe(0, scope, url);
        assertTrue(discovery.allowsPassiveCapture(0, scope, url));
        assertFalse(discovery.allowsPassiveCapture(0, scope, "https://example.test/private"));
        assertFalse(discovery.allowsPassiveCapture(0, scope, "https://example.test.other/orders"));
        assertFalse(discovery.allowsPassiveCapture(1, scope, url));
        assertFalse(discovery.allowsPassiveCapture(0, scope, url));
    }

    @Test void discoversOnlyObservedRelatedOriginsWithoutChangingScope() {
        for (String url : List.of("https://example.test/", "https://API.example.test/orders?token=secret",
                "https://api.example.test/other", "https://a.b.example.test/", "https://otherexample.test/",
                "https://example.test.other.test/", "https://third.test/")) discovery.observe(1, scope, url);
        assertEquals(List.of("https://a.b.example.test:443", "https://api.example.test:443"), discovery.candidates(1, scope));
        assertFalse(scope.allows("https://api.example.test/"));
    }

    @Test void keepsProtocolAndPortAndDoesNotOfferRegisteredPathAsWiderScope() {
        discovery.observe(1, scope, "http://api.example.test/");
        discovery.observe(1, scope, "https://api.example.test:8443/");
        discovery.observe(1, scope, "https://api.example.test/api/orders");
        ScopePolicy expanded = ScopePolicy.parse("https://example.test/\nhttps://api.example.test/api");
        assertEquals(List.of("http://api.example.test:80", "https://api.example.test:8443"), discovery.candidates(1, expanded));
        assertFalse(expanded.allows("https://api.example.test/admin"));
    }

    @Test void respectsExplicitRootRatherThanGuessingParent() {
        ScopePolicy www = ScopePolicy.parse("https://www.example.test/");
        discovery.observe(1, www, "https://api.example.test/");
        discovery.observe(1, www, "https://a.www.example.test/");
        assertEquals(List.of("https://a.www.example.test:443"), discovery.candidates(1, www));
        assertTrue(discovery.candidates(1, ScopePolicy.parse("https://other.test/")).isEmpty());
    }

    @Test void projectReplacementRejectsLateRequestsAndResetClearsCandidates() {
        discovery.observe(1, scope, "https://old.example.test/");
        assertTrue(discovery.candidates(2, scope).isEmpty());
        discovery.observe(1, scope, "https://late.example.test/");
        discovery.observe(2, scope, "https://new.example.test/");
        assertEquals(List.of("https://new.example.test:443"), discovery.candidates(2, scope));
        assertTrue(discovery.candidates(1, scope).isEmpty());
    }

    @Test void keepsObservedHostsForGraphAfterRegistrationWithoutCreatingEvidence() {
        discovery.observe(1, scope, "https://api.example.test/api/orders");
        ScopePolicy expanded = ScopePolicy.parse("https://example.test/\nhttps://api.example.test/api");
        assertTrue(discovery.candidates(1, expanded).isEmpty());
        assertEquals(List.of("https://api.example.test:443"), discovery.observedOrigins(1, expanded));
        assertTrue(discovery.observedOrigins(2, expanded).isEmpty());
        discovery.observe(1, expanded, "https://late.example.test/");
        assertTrue(discovery.observedOrigins(2, expanded).isEmpty());
    }

    @Test void rejectsInvalidAddressesAndDoesNotDiscoverUnderIpOrLocalhost() {
        for (String url : List.of("garbage", "ftp://api.example.test/", "https://user:pass@api.example.test/",
                "https://api.example.test/#fragment", "https://api.example.test:0/", "https://api.example.test:65536/",
                "https://" + "a".repeat(64) + ".example.test/")) discovery.observe(1, scope, url);
        discovery.observe(1, scope, null);
        discovery.observe(1, null, "https://api.example.test/");
        assertTrue(discovery.candidates(1, scope).isEmpty());
        discovery.observe(1, ScopePolicy.parse("http://127.0.0.1/\nhttp://localhost/"), "http://a.localhost/");
        assertTrue(discovery.candidates(1, scope).isEmpty());
    }

    @Test void limitsUniqueOriginsAndDuplicatesDoNotConsumeCapacity() {
        for (int i = 0; i < 1000; i++) discovery.observe(1, scope, "https://first.example.test/" + i);
        for (int i = 0; i < 300; i++) discovery.observe(1, scope, "https://host" + i + ".example.test/");
        assertEquals(256, discovery.candidates(1, scope).size());
    }
}
