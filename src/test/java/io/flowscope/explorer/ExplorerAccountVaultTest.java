package io.flowscope.explorer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.HttpCookie;
import java.net.URI;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerAccountVaultTest {
    @Test
    void adoptedBrowserSessionIsSentButNeverAppearsInViews() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        vault.register("human-a", "테스터", "USER");
        assertThrows(IllegalStateException.class,
                () -> vault.authenticationHeaders("human-a", URI.create("https://app.example.test/api")));
        HttpCookie cookie = new HttpCookie("session-id", "cookie-secret");
        cookie.setPath("/");

        vault.adoptSession("human-a", URI.create("https://app.example.test/"), List.of(cookie),
                Map.of("Authorization", "Bearer token-secret"));
        String serialized = assertDoesNotThrow(() -> new ObjectMapper().writeValueAsString(vault.views()));

        assertFalse(serialized.contains("cookie-secret"));
        assertFalse(serialized.contains("token-secret"));
        assertTrue(serialized.contains("Authorization"), "header names are shown");
        Map<String, String> headers = vault.authenticationHeaders("human-a", URI.create("https://app.example.test/api"));
        assertEquals("Bearer token-secret", headers.get("Authorization"));
        // Netscape-style pair, not RFC 2965 `$Version="1"` which would hide the real cookie.
        assertEquals("session-id=cookie-secret", headers.get("Cookie"));
        vault.clear();
        assertTrue(vault.views().isEmpty());
    }

    @Test
    void reusesTheRegisteredAccountId() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        assertEquals("human-account", vault.register("human-account", "테스터", "USER").id());
        assertThrows(IllegalArgumentException.class, () -> vault.register("", "테스터", "USER"));
    }
}
