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
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
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
            assertTrue(error.getMessage().contains("로그인 성공 정규식"));
            assertFalse(error.getMessage().contains("password-secret"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void acceptsObservedLoginEvidenceWhenActionHasNoBooleanResult() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(
                    zap, new ObjectMapper(), value -> true,
                    () -> List.of(authenticationEvidence("Signed in")));

            ZapBrowserAuthenticator.Identity identity = vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret));
            assertEquals("7", identity.userId());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void acceptsAStatusHeaderIndicatorFromTheObservedResponse() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
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
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
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
            assertThrows(IllegalArgumentException.class, () -> vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
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
