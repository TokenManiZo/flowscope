package io.flowscope.explorer;

import io.flowscope.core.ScopePolicy;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class BrowserScopePolicyTest {
    private final BrowserScopePolicy policy = new BrowserScopePolicy(
            ScopePolicy.parse("https://app.example.test/")::allows);

    @Test
    void permitsExactScopeButBlocksExternalNavigationAndApiCallsBeforeDispatch() {
        assertTrue(policy.allows(new LoginBrowser.BrowserRequest("GET",
                "https://app.example.test/api/orders", "XHR", "https://app.example.test/", false)));
        assertFalse(policy.allows(new LoginBrowser.BrowserRequest("GET",
                "https://outside.example/", "Document", "https://app.example.test/", false)));
        assertFalse(policy.allows(new LoginBrowser.BrowserRequest("POST",
                "https://outside.example/api", "Fetch", "https://app.example.test/", false)));
    }

    @Test
    void allowsOnlyPassiveUncredentialedStaticAssetsFromAnInScopePage() {
        assertTrue(policy.allows(new LoginBrowser.BrowserRequest("GET",
                "https://cdn.example.test/app.js", "Script", "https://app.example.test/", false)));
        assertFalse(policy.allows(new LoginBrowser.BrowserRequest("GET",
                "https://cdn.example.test/app.js", "Script", "https://outside.example/", false)));
        assertFalse(policy.allows(new LoginBrowser.BrowserRequest("GET",
                "https://cdn.example.test/app.js", "Script", "https://app.example.test/", true)));
        assertFalse(policy.allows(new LoginBrowser.BrowserRequest("POST",
                "https://cdn.example.test/app.js", "Script", "https://app.example.test/", false)));
    }
}
