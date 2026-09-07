package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerHttpGatewayTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void injectsOpaqueAccountAuthAndBlocksDuplicateAndScopeEscape() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.save(new ExplorerAccountVault.Input("", "A", "USER",
                "https://app.example.test/login", "alice", "pw", ExplorerAccountVault.LoginMode.JSON,
                "", "", "", "", "", ""));
        vault.setToken(account.id(), "Authorization", "Bearer ", "secret-token");
        vault.status(account.id(), ExplorerAccountVault.AuthStatus.READY, "ready");
        AtomicReference<ExplorerTransport.Request> captured = new AtomicReference<>();
        ExplorerTransport transport = request -> {
            captured.set(request);
            return new ExplorerTransport.Response(200, request.url(), "", "application/json", Map.of(),
                    "{\"ok\":true}", false, "ev-1", 3, Instant.now());
        };
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> value.startsWith("https://app.example.test/"), "run-1", ignored -> {})) {
            String payload = JSON.createObjectNode().put("account", account.id()).put("method", "GET")
                    .put("url", "https://app.example.test/api/orders")
                    .set("headers", JSON.createObjectNode().put("Authorization", "attacker-value")).toString();
            HttpResponse<String> first = post(gateway, payload);
            assertEquals(200, first.statusCode());
            assertEquals("Bearer secret-token", captured.get().headers().get("Authorization"));
            assertEquals("ev-1", JSON.readTree(first.body()).path("evidence_id").asText());
            assertEquals(409, post(gateway, payload).statusCode());

            String escaped = JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://outside.example/api").toString();
            assertEquals(403, post(gateway, escaped).statusCode());
        }
    }

    @Test
    void exposesLargeMaskedBodyAsLoopbackArtifact() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "x".repeat(600_000) + "token=secret-value",
                false, "ev-large", 2, Instant.now());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> true, "run-large", ignored -> {})) {
            HttpResponse<String> first = post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/main.js").toString());
            JsonNode body = JSON.readTree(first.body());
            assertFalse(body.path("artifact_url").asText().isBlank());
            HttpRequest download = HttpRequest.newBuilder(URI.create(body.path("artifact_url").asText()))
                    .header("Authorization", "Bearer " + gateway.token()).GET().build();
            HttpResponse<byte[]> artifact = HttpClient.newHttpClient().send(download,
                    HttpResponse.BodyHandlers.ofByteArray());
            assertEquals(200, artifact.statusCode());
            assertTrue(artifact.body().length > 512 * 1024);
            assertFalse(new String(artifact.body(), StandardCharsets.UTF_8).contains("secret-value"));
        }
    }

    @Test
    void blocksMutationMethodsOutsideExplorerSurfaceContract() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerTransport transport = request -> fail("blocked method must not reach transport");
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> true, "run-method", ignored -> {})) {
            String payload = JSON.createObjectNode().put("method", "DELETE")
                    .put("url", "https://app.example.test/api/orders/1").toString();
            assertEquals(400, post(gateway, payload).statusCode());
        }
    }

    @Test
    void transportFailureMayBeRetriedWithoutWeakeningSuccessfulDuplicateBlock() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        ExplorerTransport transport = request -> {
            if (calls.incrementAndGet() == 1) throw new java.io.IOException("temporary connection failure");
            return new ExplorerTransport.Response(200, request.url(), "", "application/json", Map.of(),
                    "{\"ok\":true}", false, "ev-retry", 1, Instant.now());
        };
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> true, "run-retry", ignored -> {})) {
            String payload = JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/retry").toString();
            assertEquals(502, post(gateway, payload).statusCode());
            assertEquals(200, post(gateway, payload).statusCode());
            assertEquals(409, post(gateway, payload).statusCode());
        }
    }

    private static HttpResponse<String> post(ExplorerHttpGateway gateway, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(gateway.url()))
                .header("Authorization", "Bearer " + gateway.token()).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }
}
