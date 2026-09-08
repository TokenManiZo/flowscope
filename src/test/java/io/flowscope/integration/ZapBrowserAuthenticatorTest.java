package io.flowscope.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class ZapBrowserAuthenticatorTest {
    @Test
    void configuresFirefoxUserAndRequiresExplicitZapVerificationSuccess() throws Exception {
        List<String> requests = new ArrayList<>();
        HttpServer server = authenticationApi(requests, "{\"authSuccessful\":\"true\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(zap, new ObjectMapper(),
                    value -> value.startsWith("https://app.example.test/"));

            ZapBrowserAuthenticator.Identity identity = vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret));

            assertEquals("7", identity.userId());
            assertEquals("firefox-headless", identity.browser());
            assertTrue(requests.stream().anyMatch(value -> value.startsWith(
                    "/JSON/context/action/includeInContext/")));
            assertTrue(requests.stream().anyMatch(value -> value.contains("browserId%3Dfirefox-headless")));
            assertTrue(requests.stream().anyMatch(value -> value.contains("checkingStrategy=AUTO_DETECT")));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void refusesToExploreWhenZapDoesNotReturnAnAuthenticatedVerificationResult() throws Exception {
        HttpServer server = authenticationApi(new ArrayList<>(), "{\"Result\":\"OK\"}");
        server.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            ZapAccountVault vault = accountVault();
            ZapBrowserAuthenticator authenticator = new ZapBrowserAuthenticator(zap, new ObjectMapper(), value -> true);

            IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                    vault.withSecret("zap-a", secret -> authenticator.authenticate(
                            "run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
            assertTrue(error.getMessage().contains("검증하지 못했습니다"));
            assertFalse(error.getMessage().contains("password-secret"));
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
                    value -> value.equals("https://app.example.test/"));
            assertThrows(IllegalArgumentException.class, () -> vault.withSecret("zap-a", secret ->
                    authenticator.authenticate("run-1", "https://app.example.test/", 0, "3", "ctx", secret)));
        } finally {
            server.stop(0);
        }
    }

    private static ZapAccountVault accountVault() {
        ZapAccountVault vault = new ZapAccountVault();
        vault.save(new ZapAccountVault.Input("zap-a", "A", "USER", "https://app.example.test",
                "https://app.example.test/login", "alice", "password-secret"));
        return vault;
    }

    private static HttpServer authenticationApi(List<String> requests, String authenticationResponse) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (String path : List.of(
                "/JSON/context/action/includeInContext/",
                "/JSON/authentication/action/setAuthenticationMethod/",
                "/JSON/sessionManagement/action/setSessionManagementMethod/",
                "/JSON/verification/action/setVerificationMethod/",
                "/JSON/users/action/newUser/",
                "/JSON/users/action/setAuthenticationCredentials/",
                "/JSON/users/action/setUserEnabled/",
                "/JSON/users/action/authenticateAsUser/")) {
            server.createContext(path, exchange -> {
                requests.add(path + "?" + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                String response = path.contains("newUser") ? "{\"userId\":\"7\"}"
                        : path.contains("authenticateAsUser") ? authenticationResponse : "{\"Result\":\"OK\"}";
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
        }
        return server;
    }
}
