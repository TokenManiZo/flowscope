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
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.parameter.ParameterCoordinates;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerHttpGatewayTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void observationsSeparateBrowserCaptureFromPublishedHttpEvidence() throws Exception {
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/json", Map.of(), "{}", false, "ev-http", 2, Instant.now());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(), transport,
                ScopePolicy.parse("https://app.example.test/")::allows, "run-observations", ignored -> {})) {
            gateway.browserObserved("run-observations", "", "GET", "https://app.example.test/api/browser", 200);
            post(gateway, """
                    {"account":"","method":"GET","url":"https://app.example.test/api/http","headers":{},"body":""}
                    """);
            JsonNode response = JSON.readTree(post(gateway, gateway.observationsUrl(),
                    "{\"after_sequence\":0,\"limit\":100}").body());
            assertEquals(2, response.path("observations").size());
            assertEquals("BROWSER_CAPTURED", response.path("observations").get(0).path("record_state").asText());
            assertEquals("", response.path("observations").get(0).path("evidence_id").asText());
            assertEquals("EVIDENCE_STORED", response.path("observations").get(1).path("record_state").asText());
            assertEquals("ev-http", response.path("observations").get(1).path("evidence_id").asText());
            assertEquals(1, JSON.readTree(post(gateway, gateway.observationsUrl(),
                    "{\"after_sequence\":1,\"limit\":100}").body()).path("observations").size());
        }
    }

    @Test
    void worklistChangesConcreteDeclarationOnlyAfterStoredResponse() throws Exception {
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "fetch('/api/search')", false,
                request.url().endsWith("main.js") ? "ev-source" : "ev-search", 1, Instant.now());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(), transport,
                ScopePolicy.parse("https://app.example.test/")::allows, "run-worklist", ignored -> {})) {
            post(gateway, """
                    {"account":"","method":"GET","url":"https://app.example.test/main.js","headers":{},"body":""}
                    """);
            assertEquals(200, post(gateway, gateway.discoveriesUrl(), """
                    {"discoveries":[{"method":"GET","url":"https://app.example.test/api/search",
                      "evidence_ids":["ev-source"],"artifact_kind":"JAVASCRIPT","locator":"main.js:1",
                      "reason":"fetch call","parameters":[]}]}
                    """).statusCode());
            JsonNode before = JSON.readTree(post(gateway, gateway.worklistUrl(), "{}").body());
            assertEquals("UNREQUESTED", before.path("declared_endpoints").get(0).path("state").asText());
            assertEquals("ev-source", before.path("declared_endpoints").get(0)
                    .path("declaration_evidence_ids").get(0).asText());
            post(gateway, """
                    {"account":"","method":"GET","url":"https://app.example.test/api/search","headers":{},"body":""}
                    """);
            JsonNode after = JSON.readTree(post(gateway, gateway.worklistUrl(), "{}").body());
            assertEquals("OBSERVED", after.path("declared_endpoints").get(0).path("state").asText());
            assertEquals("", after.path("declared_endpoints").get(0)
                    .path("observed_accounts").get(0).asText());
        }
    }

    @Test
    void browserGatewayAcceptsExplicitAnonymousHandleButNotMissingAccount() throws Exception {
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(),
                request -> { throw new AssertionError("browser action must not use HTTP transport"); },
                value -> true, "run-anon-browser", ignored -> {})) {
            AtomicReference<String> driven = new AtomicReference<>();
            gateway.browserDriver((account, action, url, ref, text) -> {
                driven.set(account);
                return new LoginBrowser.Page("https://app.example.test/", "Home", List.of(), "");
            });
            assertEquals(200, post(gateway, gateway.browserUrl(),
                    "{\"account\":\"\",\"action\":\"snapshot\",\"url\":\"\",\"ref\":\"\",\"text\":\"\"}").statusCode());
            assertEquals("", driven.get());
            assertEquals(400, post(gateway, gateway.browserUrl(),
                    "{\"action\":\"snapshot\",\"url\":\"\",\"ref\":\"\",\"text\":\"\"}").statusCode());
        }
    }

    @Test
    void followsPageLinkedCdnJavascriptButNeverTreatsTheCdnAsAnApiTarget() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        AtomicReference<ExplorerTransport.Request> captured = new AtomicReference<>();
        ExplorerTransport transport = request -> {
            captured.set(request);
            boolean html = request.url().equals("https://shop.example.test/");
            boolean sourceMap = request.url().endsWith(".map");
            return new ExplorerTransport.Response(200, request.url(), "",
                    html ? "text/html" : sourceMap ? "application/json" : "application/javascript", Map.of(),
                    html ? "<script src='https://cdn.example.test/main.js'></script>"
                            : sourceMap ? "{\"version\":3}" : "import('./chunk.js'); fetch('/api/orders/42');\n//# sourceMappingURL=main.js.map",
                    false, html ? "ev-page" : "ev-script", 1, Instant.now());
        };
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                ScopePolicy.parse("https://shop.example.test/")::allows, "run-cdn", ignored -> {})) {
            JsonNode page = JSON.readTree(post(gateway, """
                    {"account":"","method":"GET","url":"https://shop.example.test/","headers":{},"body":""}
                    """).body());
            assertEquals("https://cdn.example.test/main.js",
                    page.path("supporting_assets").get(0).asText());
            JsonNode script = JSON.readTree(post(gateway, """
                    {"account":"","method":"GET","url":"https://cdn.example.test/main.js","headers":{},"body":""}
                    """).body());
            assertTrue(script.path("supporting_assets").toString().contains("main.js.map"));
            assertEquals(200, post(gateway, """
                    {"account":"","method":"GET","url":"https://cdn.example.test/main.js.map","headers":{},"body":""}
                    """).statusCode());
            assertEquals("https://shop.example.test:443/", captured.get().supportingPageUrl());
            assertEquals(403, post(gateway, """
                    {"account":"","method":"GET","url":"https://cdn.example.test/api/private","headers":{},"body":""}
                    """).statusCode());
            assertEquals(400, post(gateway, """
                    {"account":"account-a","method":"GET","url":"https://cdn.example.test/chunk.js","headers":{},"body":""}
                    """).statusCode());
        }
    }

    @Test
    void injectsOpaqueAccountAuthAndBlocksDuplicateAndScopeEscape() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.register("llm-a", "A", "USER");
        vault.adoptSession(account.id(), java.net.URI.create("https://app.example.test/"), List.of(),
                Map.of("Authorization", "Bearer secret-token"));
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
            JsonNode secretRejected = JSON.readTree(post(gateway, gateway.discoveriesUrl(), secretHeader).body());
            assertEquals(1, secretRejected.path("rejected_parameters").size());
            assertEquals(0, secretRejected.path("accepted_parameters").asInt());
            String unknownRootField = declaration.replaceFirst("\\{", "{\"unexpected\":true,");
            assertEquals(400, post(gateway, gateway.discoveriesUrl(), unknownRootField).statusCode());
            String ambiguousJson = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"criteria.status\"");
            JsonNode ambiguousRejected = JSON.readTree(post(gateway, gateway.discoveriesUrl(), ambiguousJson).body());
            assertEquals(1, ambiguousRejected.path("rejected_parameters").size(),
                    "점 표기 JSON 경로는 canonical pointer가 아니면 추정 없이 보류");
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
            assertEquals(1, JSON.readTree(post(gateway, gateway.discoveriesUrl(), malformedEscape).body())
                    .path("rejected_parameters").size(),
                    "~ 뒤에 0/1/2가 아니면 pointer 이스케이프 계약 위반");
            String canonicalPointer = declaration.replace("\"field_path\":\"product_id\"",
                    "\"field_path\":\"/criteria/status\"");
            HttpResponse<String> accepted = post(gateway, gateway.discoveriesUrl(), canonicalPointer);
            assertEquals(200, accepted.statusCode(), accepted.body());
            assertEquals(1, JSON.readTree(accepted.body()).path("accepted_parameters").asInt());
            // PATH 위치는 변수 개수가 아니라 실제 placeholder 위치여야 한다: /api/orders/{id}는 /segments/2만 유효.
            String wrongSlot = declaration.replace("\"field_path\":\"path[3]\"", "\"field_path\":\"/segments/0\"");
            JsonNode wrongSlotResult = JSON.readTree(post(gateway, gateway.discoveriesUrl(), wrongSlot).body());
            assertEquals(1, wrongSlotResult.path("rejected_parameters").size(),
                    "/segments/0은 'api' 세그먼트이지 placeholder가 아니다");
            assertEquals("/segments/2", wrongSlotResult.path("rejected_parameters").get(0)
                    .path("candidate_field_paths").get(0).asText());
            String rightSlot = declaration.replace("\"field_path\":\"path[3]\"", "\"field_path\":\"/segments/2\"");
            HttpResponse<String> slotOk = post(gateway, gateway.discoveriesUrl(), rightSlot);
            assertEquals(200, slotOk.statusCode(), slotOk.body());
        }
    }

    @Test
    void oneInvalidDiscoveryDoesNotDiscardOtherEvidenceBoundDiscoveries() throws Exception {
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "const routes = {};", false,
                "ev-artifact", 1, Instant.now());
        AtomicReference<List<RouteCandidate>> stored = new AtomicReference<>(List.of());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(), transport,
                value -> value.startsWith("https://app.example.test/"), "run-partial", ignored -> {},
                stored::set)) {
            assertEquals(200, post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/main.js").toString()).statusCode());
            String batch = """
                    {"discoveries":[
                      {"method":"GET","url":"https://app.example.test/api/orders/{orderId}",
                       "evidence_ids":["ev-artifact"],"artifact_kind":"JAVASCRIPT","locator":"main.js:1",
                       "reason":"route","parameters":[{"location":"PATH","field_path":"orderId",
                       "display_name":"orderId","requirement":"REQUIRED"}]},
                      {"method":"GET","url":"https://app.example.test/api/orders/{orderId}/items/{itemId}",
                       "evidence_ids":["ev-invented"],"artifact_kind":"JAVASCRIPT","locator":"main.js:2",
                       "reason":"route","parameters":[{"location":"PATH","field_path":"unknownId",
                       "display_name":"unknownId","requirement":"REQUIRED"}]},
                      {"method":"GET","url":"https://app.example.test/api/users/{userId}",
                       "evidence_ids":["ev-artifact"],"artifact_kind":"JAVASCRIPT","locator":"main.js:3",
                       "reason":"route","parameters":[{"location":"PATH","field_path":"{userId}",
                       "display_name":"userId","requirement":"REQUIRED"}]}
                    ]}
                    """;
            HttpResponse<String> response = post(gateway, gateway.discoveriesUrl(), batch);
            assertEquals(200, response.statusCode(), response.body());
            JsonNode result = JSON.readTree(response.body());
            assertEquals(2, result.path("accepted_endpoints").asInt());
            assertEquals(2, result.path("accepted_parameters").asInt());
            assertEquals(1, result.path("rejected_discoveries").size());
            assertEquals(1, result.path("rejected_discoveries").get(0).path("index").asInt());
            assertTrue(result.path("rejected_discoveries").get(0).path("reason").asText()
                    .contains("Evidence ID"));
            assertEquals(2, stored.get().size());
            assertEquals("/segments/2", stored.get().get(0).declaredParameters().getFirst().fieldPath());
            assertEquals("/segments/2", stored.get().get(1).declaredParameters().getFirst().fieldPath());

            String corrected = batch.replace("ev-invented", "ev-artifact").replace("unknownId", "itemId");
            JsonNode retry = JSON.readTree(post(gateway, gateway.discoveriesUrl(), corrected).body());
            assertEquals(1, retry.path("accepted_endpoints").asInt());
            assertEquals(0, retry.path("rejected_discoveries").size());
        }
    }

    @Test
    void duplicatePathNamesKeepTheEndpointAndValidParametersWhileOfferingExactSlots() throws Exception {
        ExplorerTransport transport = request -> new ExplorerTransport.Response(200, request.url(), "",
                "application/javascript", Map.of(), "const routes = {};", false,
                "ev-artifact", 1, Instant.now());
        AtomicReference<List<RouteCandidate>> stored = new AtomicReference<>(List.of());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(), transport,
                value -> value.startsWith("https://app.example.test/"), "run-duplicate-slot", ignored -> {},
                stored::set)) {
            assertEquals(200, post(gateway, JSON.createObjectNode().put("method", "GET")
                    .put("url", "https://app.example.test/main.js").toString()).statusCode());
            String batch = """
                    {"discoveries":[{"method":"GET","url":"https://app.example.test/api/{id}/orders/{id}",
                      "evidence_ids":["ev-artifact"],"artifact_kind":"JAVASCRIPT","locator":"main.js:1",
                      "reason":"route","parameters":[
                        {"location":"PATH","field_path":"id","display_name":"id","requirement":"UNKNOWN"},
                        {"location":"QUERY","field_path":"sort","display_name":"sort","requirement":"OPTIONAL"}
                      ]}]}
                    """;
            JsonNode result = JSON.readTree(post(gateway, gateway.discoveriesUrl(), batch).body());
            assertEquals(1, result.path("accepted_endpoints").asInt());
            assertEquals(1, result.path("accepted_parameters").asInt());
            assertEquals(1, result.path("rejected_parameters").size());
            JsonNode rejection = result.path("rejected_parameters").get(0);
            assertEquals(0, rejection.path("discovery_index").asInt());
            assertEquals(0, rejection.path("parameter_index").asInt());
            String issueId = rejection.path("issue_id").asText();
            assertFalse(issueId.isBlank());
            assertEquals(issueId, JSON.readTree(post(gateway, gateway.worklistUrl(), "{}").body())
                    .path("pending_issues").get(0).path("issue_id").asText());
            assertEquals(List.of("/segments/1", "/segments/3"),
                    JSON.convertValue(rejection.path("candidate_field_paths"),
                            new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}));
            assertEquals(List.of("/sort"), stored.get().getFirst().declaredParameters().stream()
                    .map(RouteCandidate.DeclaredParameter::fieldPath).toList());

            String corrected = batch.replace("\"field_path\":\"id\"",
                    "\"field_path\":\"/segments/3\",\"replaces_issue_id\":\"" + issueId + "\"");
            JsonNode retry = JSON.readTree(post(gateway, gateway.discoveriesUrl(), corrected).body());
            assertEquals(0, retry.path("accepted_endpoints").asInt());
            assertEquals(1, retry.path("accepted_parameters").asInt());
            assertEquals(0, retry.path("rejected_parameters").size());
            assertEquals(0, JSON.readTree(post(gateway, gateway.worklistUrl(), "{}").body())
                    .path("pending_issues").size());
        }
    }

    /** Without a driven window the tool must refuse, not silently do nothing the model will keep retrying. */
    @Test
    void browserToolRefusesUntilAWindowIsWired() throws Exception {
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no transport"); },
                ScopePolicy.parse("https://app.example.test/")::allows, "run-browser", ignored -> {})) {
            HttpResponse<String> refused = post(gateway, gateway.browserUrl(),
                    """
                    {"account":"usera","action":"snapshot","url":"","ref":"","text":""}
                    """);
            assertEquals(409, refused.statusCode());
            assertFalse(JSON.readTree(refused.body()).path("success").asBoolean());
        }
    }

    @Test
    void browserToolReturnsThePageAndMapsRefusalsToStatusTheModelCanActOn() throws Exception {
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no transport"); },
                ScopePolicy.parse("https://app.example.test/")::allows, "run-browser", ignored -> {})) {
            gateway.browserDriver((account, action, url, ref, text) -> switch (action) {
                case "snapshot" -> new LoginBrowser.Page("https://app.example.test/issues", "이슈",
                        List.of(new LoginBrowser.Element("e1", "button", "열기")), "본문");
                case "navigate" -> throw new IllegalArgumentException("이동할 URL이 exact scope 밖입니다.");
                case "click" -> throw new IllegalStateException("브라우저 창이 닫혀 탐색을 계속할 수 없습니다.");
                default -> throw new java.io.IOException("devtools 연결이 끊어졌습니다.");
            });

            JsonNode page = JSON.readTree(post(gateway, gateway.browserUrl(), """
                    {"account":"usera","action":"snapshot","url":"","ref":"","text":""}
                    """).body());
            assertTrue(page.path("success").asBoolean());
            assertEquals("https://app.example.test/issues", page.path("url").asText());
            assertEquals("이슈", page.path("title").asText());
            assertEquals("e1", page.path("elements").get(0).path("ref").asText());
            assertEquals("열기", page.path("elements").get(0).path("name").asText());

            // Out of scope is the model's mistake to correct; a closed window or a spent budget is not.
            assertEquals(400, post(gateway, gateway.browserUrl(), """
                    {"account":"usera","action":"navigate","url":"https://evil.example.test/","ref":"","text":""}
                    """).statusCode());
            assertEquals(409, post(gateway, gateway.browserUrl(), """
                    {"account":"usera","action":"click","url":"","ref":"e1","text":""}
                    """).statusCode());
            assertEquals(502, post(gateway, gateway.browserUrl(), """
                    {"account":"usera","action":"back","url":"","ref":"","text":""}
                    """).statusCode());

            // An unknown field is a contract drift the model must see, not something to guess past.
            assertEquals(400, post(gateway, gateway.browserUrl(), """
                    {"account":"usera","action":"snapshot","url":"","ref":"","text":"","extra":1}
                    """).statusCode());
        }
    }

    @Test
    void browserToolStillNeedsTheRunCapability() throws Exception {
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no transport"); },
                ScopePolicy.parse("https://app.example.test/")::allows, "run-browser", ignored -> {})) {
            gateway.browserDriver((account, action, url, ref, text) -> {
                throw new AssertionError("must not be driven without the capability");
            });
            HttpRequest request = HttpRequest.newBuilder(URI.create(gateway.browserUrl()))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("""
                            {"account":"usera","action":"snapshot","url":"","ref":"","text":""}
                            """)).build();
            assertEquals(403, HttpClient.newHttpClient()
                    .send(request, HttpResponse.BodyHandlers.ofString()).statusCode());
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
