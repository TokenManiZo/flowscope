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

import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.parameter.ParameterCoordinates;

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
    void preservesArtifactsBeyondFormerFourMibBoundaryAndSupportsBoundedSearchAndRead() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "한".repeat(1_500_000),
                false, "ev-unicode", 2, Instant.now());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> true, "run-unicode", ignored -> {})) {
            HttpResponse<String> first = post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/main.js").toString());
            JsonNode body = JSON.readTree(first.body());
            assertTrue(body.path("artifact_bytes").asLong() > 4L * 1024 * 1024);
            assertTrue(body.path("artifact_complete").asBoolean());
            HttpRequest download = HttpRequest.newBuilder(URI.create(body.path("artifact_url").asText()))
                    .header("Authorization", "Bearer " + gateway.token()).GET().build();
            HttpResponse<String> artifact = HttpClient.newHttpClient().send(download,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            assertEquals(200, artifact.statusCode());
            assertTrue(artifact.body().chars().allMatch(value -> value == '한'));
            assertEquals(4_500_000, artifact.body().getBytes(StandardCharsets.UTF_8).length);
            assertTrue(body.path("body").asText().getBytes(StandardCharsets.UTF_8).length <= 64 * 1024);
            assertTrue(body.path("body_truncated").asBoolean());

            String artifactId = body.path("artifact_id").asText();
            HttpResponse<String> listed = post(gateway, gateway.artifactsUrl() + "/list", "{}");
            assertEquals(artifactId, JSON.readTree(listed.body()).path("artifacts").get(0)
                    .path("artifact_id").asText());
            String search = JSON.createObjectNode().put("artifact_id", artifactId).put("query", "한한한")
                    .put("case_sensitive", true).put("max_results", 2).toString();
            JsonNode matches = JSON.readTree(post(gateway, gateway.artifactsUrl() + "/search", search).body());
            assertEquals(2, matches.path("matches").size());
            String read = JSON.createObjectNode().put("artifact_id", artifactId).put("char_offset", 1_499_990)
                    .put("max_chars", 32).toString();
            JsonNode range = JSON.readTree(post(gateway, gateway.artifactsUrl() + "/read", read).body());
            assertTrue(range.path("end_of_artifact").asBoolean());
            assertEquals(10, range.path("text").asText().length());
        }
    }

    @Test
    void indexesJavascriptArtifactWithoutCopyingItIntoTheToolResponse() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), " ".repeat(70_000) +
                "fetch('/api/search?keyword=', {method:'POST', body: JSON.stringify({product_id: 1})});",
                false, "ev-index", 2, Instant.now());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> true, "run-index", ignored -> {})) {
            JsonNode response = JSON.readTree(post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/app.js").toString()).body());
            String request = JSON.createObjectNode().put("artifact_id", response.path("artifact_id").asText())
                    .toString();
            JsonNode index = JSON.readTree(post(gateway, gateway.artifactsUrl() + "/index", request).body());
            assertEquals("PARSED", index.path("status").asText());
            assertEquals("/api/search?keyword=", index.path("call_sites").get(0).path("reference").asText());
            assertFalse(index.toString().contains(" ".repeat(70_000)));
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

    @Test
    void storesOnlyCurrentRunEvidenceBoundDiscoveriesAndDeduplicatesSemanticFacts() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "const endpoint='/api/orders/{orderId}'",
                false, "ev-artifact", 1, Instant.now());
        AtomicReference<List<RouteCandidate>> stored = new AtomicReference<>(List.of());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> value.startsWith("https://app.example.test/"), "run-discovery", ignored -> {},
                stored::set)) {
            assertEquals(200, post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/main.js").toString()).statusCode());
            String declaration = """
                    {"discoveries":[{"method":"POST",
                      "url":"https://app.example.test/api/orders/{orderId}",
                      "evidence_ids":["ev-artifact"],"artifact_kind":"JAVASCRIPT",
                      "locator":"main.js:1","reason":"literal route table",
                      "parameters":[
                        {"location":"PATH","field_path":"path[3]","display_name":"orderId","requirement":"REQUIRED"},
                        {"location":"JSON_BODY","field_path":"product_id","display_name":"product_id","requirement":"UNKNOWN"}
                      ]}]}
                    """;

            HttpResponse<String> first = post(gateway, gateway.discoveriesUrl(), declaration);
            assertEquals(200, first.statusCode(), first.body());
            JsonNode counts = JSON.readTree(first.body());
            assertEquals(1, counts.path("accepted_endpoints").asInt());
            assertEquals(2, counts.path("accepted_parameters").asInt());
            RouteCandidate candidate = stored.get().getFirst();
            assertEquals("POST", candidate.method());
            assertEquals("/api/orders/{id}", candidate.pathTemplate());
            assertEquals(Source.LLM, candidate.provenance().getFirst().source());
            assertEquals(RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS,
                    candidate.provenance().getFirst().type());
            assertEquals(2, candidate.declaredParameters().size());
            assertEquals(SurfaceAnalysis.ParameterLocation.PATH,
                    candidate.declaredParameters().getFirst().location());
            // D-143 후속: 신규 Explorer 선언은 서버가 canonical FLOW_V2 좌표로 검증·정규화해 저장한다.
            RouteCandidate.DeclaredParameter pathParameter = candidate.declaredParameters().getFirst();
            assertEquals(ParameterCoordinates.CoordinateVersion.FLOW_V2, pathParameter.coordinateVersion());
            assertEquals("/segments/2", pathParameter.fieldPath(), "legacy path[3]는 template 위치로 무손실 변환");
            assertEquals("orderId", pathParameter.displayName());
            RouteCandidate.DeclaredParameter bodyParameter = candidate.declaredParameters().get(1);
            assertEquals(ParameterCoordinates.CoordinateVersion.FLOW_V2, bodyParameter.coordinateVersion());
            assertEquals("/product_id", bodyParameter.fieldPath());

            HttpResponse<String> duplicate = post(gateway, gateway.discoveriesUrl(), declaration);
            assertEquals(200, duplicate.statusCode(), duplicate.body());
            assertEquals(0, JSON.readTree(duplicate.body()).path("accepted_endpoints").asInt());

            String inventedEvidence = declaration.replace("ev-artifact", "ev-invented");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), inventedEvidence).statusCode());
            String secretHeader = declaration.replace("\"PATH\",\"field_path\":\"path[3]\"",
                    "\"HEADER\",\"field_path\":\"Authorization\"");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), secretHeader).statusCode());
            String unknownRootField = declaration.replaceFirst("\\{", "{\"unexpected\":true,");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), unknownRootField).statusCode());
            String ambiguousJson = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"criteria.status\"");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), ambiguousJson).statusCode(),
                    "점 표기 JSON 경로는 canonical pointer가 아니면 추정 없이 거부");
            // RFC 6901: 빈 참조 토큰(빈 문자열 키)은 유효하다. 엔진도 {"a":{"":{"b":1}}}에서 /a//b를 만든다.
            String emptyKeyPointer = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"/a//b\"");
            HttpResponse<String> emptyKey = post(gateway, gateway.discoveriesUrl(), emptyKeyPointer);
            assertEquals(200, emptyKey.statusCode(), emptyKey.body());
            assertTrue(stored.get().getFirst().declaredParameters().stream()
                    .anyMatch(item -> item.fieldPath().equals("/a//b")
                            && item.coordinateVersion() == ParameterCoordinates.CoordinateVersion.FLOW_V2),
                    "빈 키 pointer를 새 제한 없이 FLOW_V2로 보존");
            String malformedEscape = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"/a~x\"");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), malformedEscape).statusCode(),
                    "~ 뒤에 0/1/2가 아니면 pointer 이스케이프 계약 위반");
            String canonicalPointer = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"/criteria/status\"");
            HttpResponse<String> accepted = post(gateway, gateway.discoveriesUrl(), canonicalPointer);
            assertEquals(200, accepted.statusCode(), accepted.body());
            assertEquals(1, JSON.readTree(accepted.body()).path("accepted_parameters").asInt());
        }
    }

    private static HttpResponse<String> post(ExplorerHttpGateway gateway, String body) throws Exception {
        return post(gateway, gateway.url(), body);
    }

    private static HttpResponse<String> post(ExplorerHttpGateway gateway, String url, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .header("Authorization", "Bearer " + gateway.token()).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }
}
