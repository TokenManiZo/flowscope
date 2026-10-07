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
    void acceptsAutomaticVerificationWithoutUserWrittenIndicators() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test", "https://app.example.test/login",
                "a", "pw", "", ""));
        assertFalse(saved.hasLoggedInIndicator());
        assertFalse(saved.hasLoggedOutIndicator());

        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test", "https://app.example.test/login",
                "a", "pw", "[", "")));
    }

    @Test
    void storesInjectedCookieAndHeadersWithoutFormCredentials() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input(
                "", "주입 계정", "USER", "https://app.example.test", "",
                "", "", "SESSION=abc123; csrf=z9", "Authorization: Bearer token-xyz",
                "INJECT", "Welcome", "", ""));

        assertEquals(ZapAccountVault.AuthMode.INJECT, saved.authMode());
        assertTrue(saved.hasCookie());
        assertTrue(saved.hasHeaders());
        assertFalse(saved.hasPassword());
        assertEquals("", saved.loginUrl());
        assertFalse(saved.toString().contains("token-xyz"));
        assertFalse(saved.toString().contains("abc123"));

        AtomicReference<char[]> cookieCopy = new AtomicReference<>();
        vault.withSecret(saved.id(), secret -> {
            cookieCopy.set(secret.cookie());
            assertNull(secret.loginUrl());
            assertEquals("SESSION=abc123; csrf=z9", new String(secret.cookie()));
            assertEquals("Authorization: Bearer token-xyz", new String(secret.headers()));
            assertEquals(0, secret.username().length);
            return null;
        });
        // 주입값 복사본도 사용 후 지운다.
        assertArrayEquals(new char["SESSION=abc123; csrf=z9".length()], cookieCopy.get());
    }

    @Test
    void injectModeAcceptsCookieOnlyOrHeaderOnlyButNotNeither() {
        ZapAccountVault vault = new ZapAccountVault();
        assertTrue(vault.save(new ZapAccountVault.Input("", "쿠키만", "USER", "https://app.example.test",
                "", "", "", "SESSION=only", "", "INJECT", "", "", "")).hasCookie());
        assertTrue(vault.save(new ZapAccountVault.Input("", "헤더만", "USER", "https://app.example.test",
                "", "", "", "", "Authorization: Bearer t", "INJECT", "", "", "")).hasHeaders());
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "빈값", "USER", "https://app.example.test",
                "", "", "", "", "", "INJECT", "", "", "")));
    }

    @Test
    void injectModeRejectsMalformedCookieHeaderAndSmuggling() {
        ZapAccountVault vault = new ZapAccountVault();
        // 쿠키에 줄바꿈(헤더 스머글링) 금지
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "줄바꿈", "USER", "https://app.example.test",
                "", "", "", "SESSION=a\r\nInjected: 1", "", "INJECT", "", "", "")));
        // name=value 형식이 아닌 쿠키
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "형식", "USER", "https://app.example.test",
                "", "", "", "justavalue", "", "INJECT", "", "", "")));
        // 값 없는 헤더
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "헤더형식", "USER", "https://app.example.test",
                "", "", "", "", "Authorization:", "INJECT", "", "", "")));
    }

    @Test
    void storesSameOriginVerifyUrlAndRejectsCrossOrigin() {
        ZapAccountVault vault = new ZapAccountVault();
        ZapAccountVault.View saved = vault.save(new ZapAccountVault.Input("", "검증URL", "USER",
                "https://app.example.test", "", "", "", "SESSION=a", "", "INJECT", "", "",
                "https://app.example.test/api/me"));
        assertEquals("https://app.example.test/api/me", saved.verifyUrl());
        vault.withSecret(saved.id(), secret -> { assertEquals("https://app.example.test/api/me", secret.verifyUrl().toString()); return null; });
        // 다른 호스트의 검증 URL은 거부한다(범위 밖 전송 방지).
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input("", "교차", "USER",
                "https://app.example.test", "", "", "", "SESSION=a", "", "INJECT", "", "",
                "https://evil.example.test/api/me")));
    }

    @Test
    void rejectsUnknownAuthMode() {
        ZapAccountVault vault = new ZapAccountVault();
        assertThrows(IllegalArgumentException.class, () -> vault.save(new ZapAccountVault.Input(
                "", "A", "USER", "https://app.example.test", "", "", "",
                "SESSION=a", "", "WEIRD", "", "", "")));
    }
}
