package io.flowscope.explorer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerAccountVaultTest {
    @Test
    void credentialsAndLiveAuthNeverAppearInViews() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View view = vault.save(new ExplorerAccountVault.Input("", "테스터", "USER",
                "https://app.example.test/login", "alice@example.test", "password-secret",
                ExplorerAccountVault.LoginMode.JSON, "email", "password", "token",
                "Authorization", "Bearer ", "https://app.example.test/me"));

        vault.setToken(view.id(), "Authorization", "Bearer ", "token-secret");
        vault.status(view.id(), ExplorerAccountVault.AuthStatus.READY, "로그인 준비 완료");
        String serialized = assertDoesNotThrow(() -> new ObjectMapper().writeValueAsString(vault.views()));

        assertTrue(view.id().startsWith("llm-"));
        assertFalse(serialized.contains("password-secret"));
        assertFalse(serialized.contains("token-secret"));
        assertEquals("Bearer token-secret",
                vault.authenticationHeaders(view.id(), URI.create("https://app.example.test/api")).get("Authorization"));
        vault.clear();
        assertTrue(vault.views().isEmpty());
    }

    @Test
    void acceptsAnExistingRegisteredAccountId() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View linked = vault.save(new ExplorerAccountVault.Input(
                "human-account", "테스터", "USER", "https://app.example.test/login", "alice", "secret",
                ExplorerAccountVault.LoginMode.AUTO_FORM, "", "", "", "", "", ""));
        assertEquals("human-account", linked.id());
    }
}
