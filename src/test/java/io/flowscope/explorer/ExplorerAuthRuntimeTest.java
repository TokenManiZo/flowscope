package io.flowscope.explorer;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerAuthRuntimeTest {
    @Test
    void autoFormKeepsHiddenFieldsAndPromotesResponseCookie() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/login", "alice", "pw-secret",
                ExplorerAccountVault.LoginMode.AUTO_FORM, "", "", "", "", "",
                "https://app.example.test/me"));
        List<ExplorerTransport.Request> requests = new ArrayList<>();
        ExplorerTransport transport = request -> {
            requests.add(request);
            if (request.url().endsWith("/login") && request.method().equals("GET")) {
                return response(request.url(), 200, "text/html", Map.of(),
                        "<form method='post' action='/sessions'><input type='hidden' name='csrf' value='c1'>"
                                + "<input type='email' name='email'><input type='password' name='password'></form>");
            }
            if (request.url().endsWith("/sessions")) {
                return response(request.url(), 302, "text/plain",
                        Map.of("Set-Cookie", List.of("sid=s1; Path=/; HttpOnly"), "Location", List.of("/home")), "");
            }
            if (request.url().endsWith("/home")) return response(request.url(), 200, "text/html", Map.of(), "home");
            return response(request.url(), 200, "application/json", Map.of(), "{\"id\":\"alice\"}");
        };

        ExplorerAccountVault.View ready = new ExplorerAuthRuntime(vault, transport)
                .authenticate(account.id(), "run-1");

        assertEquals(ExplorerAccountVault.AuthStatus.READY, ready.status());
        assertTrue(ready.cookieCount() > 0);
        ExplorerTransport.Request submit = requests.stream().filter(value -> value.url().endsWith("/sessions"))
                .findFirst().orElseThrow();
        String body = new String(submit.body(), java.nio.charset.StandardCharsets.UTF_8);
        assertTrue(body.contains("csrf=c1"));
        assertTrue(body.contains("email=alice"));
        assertTrue(body.contains("password=pw-secret"));
        assertTrue(requests.stream().anyMatch(ExplorerTransport.Request::sessionSetup));
        assertTrue(requests.stream().filter(value -> value.url().endsWith("/me")).findFirst().orElseThrow()
                .headers().get("Cookie").contains("sid=s1"));
    }

    @Test
    void jsonLoginExtractsConfiguredTokenPath() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/api/login", "alice", "pw",
                ExplorerAccountVault.LoginMode.JSON, "email", "password", "data.accessToken",
                "X-Session", "Token ", "https://app.example.test/me"));
        List<ExplorerTransport.Request> requests = new ArrayList<>();
        ExplorerTransport transport = request -> {
            requests.add(request);
            return request.url().endsWith("/login")
                    ? response(request.url(), 200, "application/json", Map.of(), "{\"data\":{\"accessToken\":\"abc\"}}")
                    : response(request.url(), 200, "application/json", Map.of(), "{\"ok\":true}");
        };

        ExplorerAccountVault.View ready = new ExplorerAuthRuntime(vault, transport).authenticate(account.id(), "run-2");

        assertEquals(ExplorerAccountVault.AuthStatus.READY, ready.status());
        assertEquals("Token abc", requests.get(1).headers().get("X-Session"));
    }

    @Test
    void doesNotCallPlainSuccessResponseAnAuthenticatedSession() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/api/login", "alice", "wrong",
                ExplorerAccountVault.LoginMode.JSON, "email", "password", "",
                "", "", ""));
        ExplorerTransport transport = request -> response(request.url(), 200, "application/json", Map.of(),
                "{\"message\":\"request accepted\"}");

        ExplorerAccountVault.View result = new ExplorerAuthRuntime(vault, transport)
                .authenticate(account.id(), "run-no-artifact");

        assertEquals(ExplorerAccountVault.AuthStatus.NEEDS_INPUT, result.status());
        assertTrue(result.message().contains("검증 URL"));
    }

    @Test
    void rejectsValidationRedirectedBackToLoginForm() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/api/login", "alice", "wrong",
                ExplorerAccountVault.LoginMode.JSON, "email", "password", "data.token",
                "Authorization", "Bearer ", "https://app.example.test/me"));
        ExplorerTransport transport = request -> {
            if (request.url().endsWith("/api/login")) {
                return response(request.url(), 200, "application/json", Map.of(), "{\"data\":{\"token\":\"abc\"}}");
            }
            if (request.url().endsWith("/me")) {
                return response(request.url(), 302, "text/plain", Map.of("Location", List.of("/login")), "");
            }
            return response(request.url(), 200, "text/html", Map.of(),
                    "<form><input type='password' name='password'></form>");
        };

        ExplorerAccountVault.View result = new ExplorerAuthRuntime(vault, transport)
                .authenticate(account.id(), "run-login-loop");

        assertEquals(ExplorerAccountVault.AuthStatus.NEEDS_INPUT, result.status());
    }

    @Test
    void rejectsPasswordBearingGetLoginForm() {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/login", "alice", "pw",
                ExplorerAccountVault.LoginMode.AUTO_FORM, "", "", "", "", "", ""));
        List<ExplorerTransport.Request> requests = new ArrayList<>();
        ExplorerTransport transport = request -> {
            requests.add(request);
            return response(request.url(), 200, "text/html", Map.of(),
                    "<form method='get'><input name='email'><input type='password' name='password'></form>");
        };

        ExplorerAccountVault.View result = new ExplorerAuthRuntime(vault, transport)
                .authenticate(account.id(), "run-get-login");

        assertEquals(ExplorerAccountVault.AuthStatus.NEEDS_INPUT, result.status());
        assertEquals(1, requests.size());
    }

    private static ExplorerTransport.Response response(String url, int status, String type,
                                                       Map<String, List<String>> headers, String body) {
        String location = headers.entrySet().stream().filter(value -> value.getKey().equalsIgnoreCase("Location"))
                .flatMap(value -> value.getValue().stream()).findFirst().orElse("");
        return new ExplorerTransport.Response(status, url, location, type, headers, body,
                false, "ev-test", 1, Instant.now());
    }
}
