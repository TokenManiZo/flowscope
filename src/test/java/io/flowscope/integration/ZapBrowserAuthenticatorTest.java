package io.flowscope.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class ZapBrowserAuthenticatorTest {
    @Test
    void configuresChromeUserWithExplicitVerificationIndicators() throws Exception {
        List<String> requests = new ArrayList<>();
        HttpServer server = authenticationApi(requests, "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(zap, new ObjectMapper(),
                    value -> value.startsWith("https://app.example.test/"),
                    () -> List.of(authenticationEvidence("Signed in")));

            ZapBrowserAuthenticator.Identity identity = vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret));

            assertEquals("7", identity.userId());
            assertEquals("chrome-headless", identity.browser());
            assertTrue(requests.stream().anyMatch(value -> value.startsWith(
                    "/JSON/context/action/includeInContext/")));
            assertTrue(requests.stream().anyMatch(value -> value.contains("browserId%3Dchrome-headless")));
            assertTrue(requests.stream().anyMatch(value -> value.startsWith(
                    "/JSON/authentication/action/setLoggedInIndicator/") && value.contains("Signed+in")));
            assertTrue(requests.stream().anyMatch(value -> value.startsWith(
                    "/JSON/authentication/action/setLoggedOutIndicator/") && value.contains("Invalid+credentials")));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void refusesToExploreWithoutMatchingAuthenticationEvidence() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true,
                    () -> List.of(authenticationEvidence("Invalid credentials")));

            IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                    vault.withSecret("zap-a", secret -> authenticator.authenticate(
                            "run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
            assertTrue(error.getMessage().contains("재사용 가능한 ZAP 인증 응답"));
            assertFalse(error.getMessage().contains("password-secret"));
            // D-164: 선택적 명시 정규식을 사용한 경우에는 관측 결과를 진단에 남긴다.
            assertTrue(error.getMessage().contains("인증 응답 1건"), error.getMessage());
            assertTrue(error.getMessage().contains("[200]"), error.getMessage());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void namesZeroAuthenticationResponsesWhenTheBrowserSubmittedNothing() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true, List::of);
            IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                    vault.withSecret("zap-a", secret -> authenticator.authenticate(
                            "run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
            assertTrue(error.getMessage().contains("인증 단계 응답이 0건"), error.getMessage());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsObservedEvidenceWhenZapDoesNotConfirmAuthentication() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true,
                    () -> List.of(authenticationEvidence("Signed in")));

            IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                    vault.withSecret("zap-a", secret -> authenticator.authenticate(
                            "run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
            assertTrue(error.getMessage().contains("로그인 실패"), error.getMessage());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void autoVerifiesWithoutRegexAndDoesNotConfigureIndicatorEndpoints() throws Exception {
        List<String> requests = new ArrayList<>();
        HttpServer server = authenticationApi(requests, "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = new ZapAccountVault();
            vault.save(new ZapAccountVault.Input("zap-a", "A", "USER", "https://app.example.test",
                    "https://app.example.test/login", "alice", "password-secret", "", ""));
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true,
                    () -> List.of(authenticationEvidence("{\"profile\":\"alice\"}")));

            ZapBrowserAuthenticator.Identity identity = vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret));

            assertEquals("7", identity.userId());
            assertTrue(identity.verifiedEvidenceRuntimeId() > 0);
            assertFalse(requests.stream().anyMatch(value -> value.contains("setLoggedInIndicator")));
            assertFalse(requests.stream().anyMatch(value -> value.contains("setLoggedOutIndicator")));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsFailedZapAuthenticationEvenWhenAResponseIsTwoHundred() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"false\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = new ZapAccountVault();
            vault.save(new ZapAccountVault.Input("zap-a", "A", "USER", "https://app.example.test",
                    "https://app.example.test/login", "alice", "wrong-password", "", ""));
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true,
                    () -> List.of(authenticationEvidence("login page")));

            IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                    vault.withSecret("zap-a", secret -> authenticator.authenticate(
                            "run-1", "https://app.example.test/", 0, "3", "ctx", secret)));

            assertTrue(error.getMessage().contains("로그인 실패"), error.getMessage());
            assertFalse(error.getMessage().contains("wrong-password"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void acceptsAStatusHeaderIndicatorFromTheObservedResponse() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = new ZapAccountVault();
            vault.save(new ZapAccountVault.Input("zap-a", "A", "USER", "https://app.example.test",
                    "https://app.example.test/login", "alice", "password-secret",
                    "Location: /dashboard", ""));
            RequestRecord evidence = authenticationEvidence("");
            evidence.respText = "HTTP/1.1 302 Found\r\nLocation: /dashboard\r\n\r\n";
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true, () -> List.of(evidence));

            ZapBrowserAuthenticator.Identity identity = vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret));
            assertEquals("7", identity.userId());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsWhenALoggedOutResponseWasObservedAfterTheLoggedInResponse() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            RequestRecord loggedIn = authenticationEvidence("Signed in");
            RequestRecord loggedOut = authenticationEvidence("Invalid credentials");
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true, () -> List.of(loggedIn, loggedOut));

            assertThrows(IllegalStateException.class, () -> vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsAnOutOfScopeLoginPageBeforeCallingZap() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(zap, new ObjectMapper(),
                    value -> value.equals("https://app.example.test/"), List::of);
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
                    vault.withSecret("zap-a", secret ->
                            authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
            // D-157/D-163: 어느 값이 scope 밖인지 이름을 붙인다(대상은 scope 안, 로그인 URL이 밖).
            assertTrue(error.getMessage().contains("로그인 URL"), error.getMessage());
            assertFalse(error.getMessage().startsWith("대상"), error.getMessage());
            assertTrue(error.getMessage().contains("scope 밖"), error.getMessage());
        } finally {
            server.stop(0);
        }
    }

    private static ZapAccountVault accountVault() {
        ZapAccountVault vault = new ZapAccountVault();
        vault.save(new ZapAccountVault.Input("zap-a", "A", "USER", "https://app.example.test",
                "https://app.example.test/login", "alice", "password-secret",
                "Signed in", "Invalid credentials"));
        return vault;
    }

    private static HttpServer authenticationApi(List<String> requests, String authenticationResponse) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (String path : List.of(
                "/JSON/context/action/includeInContext/",
                "/JSON/authentication/action/setAuthenticationMethod/",
                "/JSON/authentication/action/setLoggedInIndicator/",
                "/JSON/authentication/action/setLoggedOutIndicator/",
                "/JSON/sessionManagement/action/setSessionManagementMethod/",
                "/JSON/users/action/newUser/",
                "/JSON/users/action/setAuthenticationCredentials/",
                "/JSON/users/action/setUserEnabled/",
                "/JSON/users/action/authenticateAsUser/")) {
            server.createContext(path, exchange -> {
                requests.add(path + "?" + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                String response = path.contains("newUser") ? "{\"userId\":\"7\"}"
                        : path.contains("authenticateAsUser") ? authenticationResponse
                        : "{\"Result\":\"OK\"}";
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
        }
        return server;
    }

    private static RequestRecord authenticationEvidence(String responseBody) {
        RequestRecord record = new RequestRecord(Source.SCANNER, "https://app.example.test:443",
                "POST", "/login", 200, "anon");
        record.sourceDetail = SourceDetail.ZAP_AUTHENTICATION;
        record.runId = "run-1";
        record.laneAccountId = "zap-a";
        record.hasResponse = true;
        record.body = responseBody;
        return record;
    }
}
