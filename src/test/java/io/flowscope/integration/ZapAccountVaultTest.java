package io.flowscope.integration;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

final class ZapAccountVaultTest {
    @Test
    void exposesOnlyMetadataAndClearsTemporarySecretCopies() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input("", "사용자 A", "USER",
                "https://app.example.test", "https://app.example.test/login", "alice", "secret-value",
                "Welcome alice", "Invalid credentials"));

        assertTrue(saved.id().startsWith("zap-"));
        assertTrue(saved.hasPassword());
        assertTrue(saved.hasLoggedInIndicator());
        assertTrue(saved.hasLoggedOutIndicator());
        assertFalse(saved.toString().contains("alice"));
        assertFalse(saved.toString().contains("secret-value"));

        AtomicReference<char[]> passwordCopy = new AtomicReference<>();
        vault.withSecret(saved.id(), secret -> {
            passwordCopy.set(secret.password());
            assertEquals("alice", new String(secret.username()));
            assertEquals("secret-value", new String(secret.password()));
            return null;
        });
        assertArrayEquals(new char["secret-value".length()], passwordCopy.get());
        vault.close();
        assertTrue(vault.views().isEmpty());
    }

    @Test
    void acceptsARegisteredAccountIdAndRequiresOriginOnlyService() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View linked = vault.save(new ZapAccountVault.Input(
                "user-a", "A", "USER", "https://app.example.test", "https://app.example.test/login",
                "a", "pw", "Signed in", "Signed out"));
        assertEquals("user-a", linked.id());
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test/private", "https://app.example.test/login",
                "a", "pw", "Signed in", "Signed out")));

        ZapAccountVault.View ipv6 = vault.save(new ZapAccountVault.Input(
                "", "IPv6", "USER", "http://[::1]:8888", "http://[::1]:8888/login", "a", "pw",
                "Signed in", "Signed out"));
        assertEquals("http://[::1]:8888", ipv6.service());
    }

    @Test
    void validatesAuthenticatedAccountRoles() {
        ZapAccountVault vault = new ZapAccountVault();
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "anonymous contradiction", "ANONYMOUS", "https://app.example.test",
                "https://app.example.test/login", "a", "pw", "Signed in", "Signed out")));
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "unknown role", "ROOT", "https://app.example.test",
                "https://app.example.test/login", "a", "pw", "Signed in", "Signed out")));

        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input(
                "", "level", "lv1", "https://app.example.test",
                "https://app.example.test/login", "a", "pw", "Signed in", "Signed out"));
        assertEquals("LV1", saved.role());
    }

    @Test
    void longAuthenticationDoesNotBlockStatusViews() throws Exception {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input(
                "", "사용자 A", "USER", "https://app.example.test",
                "https://app.example.test/login", "a", "pw", "Signed in", "Signed out"));
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var authentication = executor.submit(() -> vault.withSecret(saved.id(), secret -> {
                entered.countDown();
                try { release.await(2, TimeUnit.SECONDS); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
                return null;
            }));
            assertTrue(entered.await(1, TimeUnit.SECONDS));
            assertEquals(1, executor.submit(vault::views).get(500, TimeUnit.MILLISECONDS).size());
            release.countDown();
            authentication.get(1, TimeUnit.SECONDS);
        }
    }

    @Test
    void preservesIntentionalWhitespaceInCredentials() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input(
                "", "사용자 A", "USER", "https://app.example.test",
                "https://app.example.test/login", " alice ", " secret value ",
                "Signed in", "Signed out"));

        vault.withSecret(saved.id(), secret -> {
            assertEquals(" alice ", new String(secret.username()));
            assertEquals(" secret value ", new String(secret.password()));
            return null;
        });
    }

    @Test
    void requiresAValidLoggedInVerificationIndicator() {
        ZapAccountVault vault = new ZapAccountVault();
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test", "https://app.example.test/login",
                "a", "pw", "", "")));
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test", "https://app.example.test/login",
                "a", "pw", "[", "")));
    }
}
