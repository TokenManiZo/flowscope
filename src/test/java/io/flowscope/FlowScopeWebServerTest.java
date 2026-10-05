package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.HarParser;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.StoredPayload;
import io.flowscope.core.ToolKind;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.integration.SessionBroker;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import io.flowscope.integration.LiveCrossIdentityReplayCoordinator;
import io.flowscope.integration.ZapAccountVault;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.integration.GraphWorkspace;
import io.flowscope.integration.RequestLabWorkspace;
import io.flowscope.web.FlowScopeWebServer;
import io.flowscope.explorer.ExplorerAccountVault;
import io.flowscope.explorer.ExplorerCoordinator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.URI;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

final class FlowScopeWebServerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final TestState state = new TestState();
    private FlowScopeWebServer server;
    private String token;


    @AfterEach void stop() {
        if (server != null) server.close();
        state.sessions.close();
        state.zapAccounts.close();
    }

    @Test void requestLabWorkspacePersistsMaskedStateChecksRevisionsAndNeverSendsTraffic() throws Exception {
        start();
        long dataset = state.datasetRevision();
        String evidence = state.record.evidenceId;
        var change = new RequestLabWorkspace.Change("create", 1, "saved", "GET / HTTP/1.1\r\nCookie: TOP-SECRET\r\n\r\n",
                "ORIGINAL", null, false, false, 1);
        String body = "eventId=" + encode(evidence) + "&datasetRevision=" + dataset + "&revision=0&change=" + encode(JSON.writeValueAsString(change));
        assertEquals(403, post("/api/request-lab/workspace", body, "wrong-token").statusCode());
        HttpResponse<String> saved = post("/api/request-lab/workspace", body, token);
        assertEquals(200, saved.statusCode());
        assertEquals(1, json(saved).path("revision").asLong());
        assertFalse(json(saved).has("tab"));
        assertEquals(0, state.manualRequestCount.get());
        JsonNode draft = json(get("/api/request-lab?eventId=" + encode(evidence), token, null));
        assertFalse(draft.path("workspace").toString().contains("TOP-SECRET"));
        assertEquals("saved", draft.at("/workspace/tab/entries/1/name").asText());
        assertFalse(json(get("/api/request-lab?eventId=" + encode(evidence) + "&workspace=exclude", token, null)).has("workspace"));
        assertEquals(409, post("/api/request-lab/workspace", body, token).statusCode());
        assertEquals(409, post("/api/request-lab/workspace", body.replace("datasetRevision=" + dataset, "datasetRevision=" + (dataset + 1)), token).statusCode());
        String deletion = "eventId=" + encode(evidence) + "&datasetRevision=" + dataset + "&revision=1&change="
                + encode(JSON.writeValueAsString(new RequestLabWorkspace.Change("delete", 1, null, null, null, null, false, null, 0)));
        assertEquals(200, post("/api/request-lab/workspace", deletion, token).statusCode());
        assertTrue(state.requestLabWorkspace.tab(evidence).entries().isEmpty());
        assertEquals(2, state.requestLabWorkspace.tab(evidence).nextId());
        assertFalse(json(get("/api/snapshot", token, null)).toString().contains("requestLabWorkspace"));
    }

    @Test void graphWorkspaceApiChecksRevisionsAndAcknowledgesWithoutResendingAllViews() throws Exception {
        start();
        long dataset = state.datasetRevision(), analysisRevision = state.revision();
        JsonNode initial = JSON.readTree(get("/api/graph-workspace", token, null).body());
        assertEquals(dataset, initial.path("datasetRevision").asLong());
        var view = new GraphWorkspace.View(Map.of("operation:GET /orders", new GraphWorkspace.Point(700, 125)),
                Map.of(), new GraphWorkspace.Viewport(1, new GraphWorkspace.Point(5, -2)), List.of());
        String changes = URLEncoder.encode(JSON.writeValueAsString(new GraphWorkspace.Change(null,
                Map.of("[\"site\",\"\",\"\"]", view), List.of(), null, null)), StandardCharsets.UTF_8);
        String body = "datasetRevision=" + dataset + "&revision=0&changes=" + changes;
        HttpResponse<String> saved = post("/api/graph-workspace", body, token);
        assertEquals(200, saved.statusCode());
        JsonNode acknowledgement = JSON.readTree(saved.body());
        assertEquals(1, acknowledgement.path("revision").asLong());
        assertFalse(acknowledgement.has("workspace"));
        assertEquals(analysisRevision, state.revision());
        assertEquals(409, post("/api/graph-workspace", body, token).statusCode());
        assertEquals(409, post("/api/graph-workspace", "datasetRevision=" + (dataset + 1) + "&revision=1&changes=" + changes, token).statusCode());
        assertEquals(1, JSON.readTree(get("/api/graph-workspace", token, null).body()).at("/workspace/views").size());
        assertEquals(400, post("/api/graph-workspace", "datasetRevision=" + dataset + "&revision=1&changes=null", token).statusCode());
    }

    @Test void graphWorkspaceAcceptsLongKeysAndAppliesGeometryPatchesAtomically() throws Exception {
        start();
        long dataset = state.datasetRevision();
        String operation = "https://api.test:443 GET /" + "segment/".repeat(300);
        String node = "operation:" + operation;
        String viewKey = JSON.writeValueAsString(List.of("operation", "orders", operation));
        var view = new GraphWorkspace.View(Map.of(node, new GraphWorkspace.Point(540, 200),
                "hidden", new GraphWorkspace.Point(540, 600)), Map.of(), null, List.of());
        var change = new GraphWorkspace.Change(new GraphWorkspace.Navigation("operation", "orders", operation, 18, 18, ""),
                Map.of(viewKey, view), List.of(), null, null);
        assertEquals(200, post("/api/graph-workspace", "datasetRevision=" + dataset + "&revision=0&changes="
                + encode(JSON.writeValueAsString(change)), token).statusCode());
        // Sparse JSON fields use defaults; the omitted viewport must preserve the current viewport.
        var patch = JSON.createObjectNode();
        patch.putObject("views");
        patch.putObject("viewPatches").putObject(viewKey).putObject("positions")
                .putObject(node).put("x", 650).put("y", 250);
        String body = "datasetRevision=" + dataset + "&revision=1&changes=" + encode(patch.toString());
        assertEquals(200, post("/api/graph-workspace", body, token).statusCode());
        JsonNode saved = JSON.readTree(get("/api/graph-workspace", token, null).body());
        assertEquals(operation, saved.at("/workspace/navigation/operation").asText());
        JsonNode positions = saved.at("/workspace/views").get(viewKey).get("positions");
        assertEquals(650, positions.get(node).get("x").asDouble());
        assertEquals(600, positions.get("hidden").get("y").asDouble());
        // Invalid geometry cannot install any portion of the patch or advance the revision.
        ((ObjectNode) patch.get("viewPatches").get(viewKey).get("positions").get(node)).put("x", 10_000_001);
        assertEquals(400, post("/api/graph-workspace", "datasetRevision=" + dataset + "&revision=2&changes="
                + encode(patch.toString()), token).statusCode());
        assertEquals(2, JSON.readTree(get("/api/graph-workspace", token, null).body()).path("revision").asLong());
    }

    @Test void graphWorkspaceSavesLargerLayoutsWithOrdinaryShortKeys() throws Exception {
        start();
        var changes = JSON.createObjectNode();
        var view = changes.putObject("views").putObject("site");
        var positions = view.putObject("positions");
        for (int index = 0; index < 80; index++) {
            positions.putObject("operation:GET /orders/" + index).put("x", 540).put("y", index * 100);
        }
        view.putObject("sizes");
        view.putArray("expandedGroups");
        String encoded = changes.toString();
        assertTrue(encoded.length() > 2_000);
        assertEquals(200, post("/api/graph-workspace", "datasetRevision=" + state.datasetRevision()
                + "&revision=0&changes=" + encode(encoded), token).statusCode());
        JsonNode saved = JSON.readTree(get("/api/graph-workspace", token, null).body());
        JsonNode restored = saved.at("/workspace/views/site/positions");
        assertEquals(80, restored.size());
        for (int index = 0; index < 80; index++) {
            JsonNode point = restored.get("operation:GET /orders/" + index);
            assertEquals(540.0, point.path("x").asDouble());
            assertEquals(index * 100.0, point.path("y").asDouble());
        }
        assertEquals(1, saved.path("revision").asLong());
    }

    @Test void graphWorkspaceJsonLimitCountsUtf8BytesBeforeParsing() throws Exception {
        start();
        String oversized = "{\"views\":{},\"unused\":\"" + "a".repeat(2 * 1024 * 1024 - 2_000) + "한".repeat(1_000) + "\"}";
        assertTrue(oversized.length() < 2 * 1024 * 1024);
        assertTrue(oversized.getBytes(StandardCharsets.UTF_8).length > 2 * 1024 * 1024);
        String body = "datasetRevision=" + state.datasetRevision() + "&revision=0&changes=" + encode(oversized);
        assertTrue(body.getBytes(StandardCharsets.UTF_8).length < 4 * 1024 * 1024);
        HttpResponse<String> response = post("/api/graph-workspace", body, token);
        assertEquals(413, response.statusCode());
        assertEquals("그래프 작업 상태가 너무 큽니다.", JSON.readTree(response.body()).path("message").asText());
        assertEquals(0, JSON.readTree(get("/api/graph-workspace", token, null).body()).path("revision").asLong());
    }

    @Test
    void redirectsAppMountToTrailingSlash() throws Exception {
        start();

        HttpResponse<String> response = get("/app", null, null);

        assertEquals(308, response.statusCode());
        assertEquals("/app/", response.headers().firstValue("Location").orElseThrow());
    }

    @Test
    void keepsLegacyClearBlockedAndOffersExplicitProjectResetAndDelete() throws Exception {
        start();

        HttpResponse<String> clear = post("/api/clear", "", token);
        assertEquals(409, clear.statusCode());
        assertEquals(1, state.records.size(), "legacy reset must not delete Evidence");

        HttpResponse<String> started = post("/api/projects", "action=start&name=Target+A&scope="
                + URLEncoder.encode("https://app.example.test/", StandardCharsets.UTF_8), token);
        HttpResponse<String> updated = post("/api/projects", "action=update&name=Renamed&scope="
                + URLEncoder.encode("https://app.example.test/\nhttps://auth.example.test/", StandardCharsets.UTF_8), token);
        HttpResponse<String> reset = post("/api/projects", "action=reset", token);
        HttpResponse<String> deleted = post("/api/projects", "action=delete&id=old-project", token);
        HttpResponse<String> listed = get("/api/projects", token, null);

        assertEquals(200, started.statusCode());
        assertEquals(200, updated.statusCode());
        assertEquals("Renamed|https://app.example.test/\nhttps://auth.example.test/", state.updatedProject);
        assertEquals(200, reset.statusCode());
        assertTrue(state.records.isEmpty());
        assertEquals(200, deleted.statusCode());
        assertEquals("old-project", state.deletedProjectId);
        assertEquals("Target A", JSON.readTree(started.body()).path("active").path("name").asText());
        assertEquals("SAVED", JSON.readTree(started.body()).path("saveState").asText());
        assertEquals("https://app.example.test/", state.startedProjectScope);
        assertEquals(200, listed.statusCode());
        assertEquals(1, JSON.readTree(listed.body()).path("projects").size());
    }

    @Test
    void servesReactUiAtTheBurpLaunchRootAndKeepsLegacyAtItsExplicitMount() throws Exception {
        start();

        HttpResponse<String> root = get("/", null, null);
        HttpResponse<String> legacy = get("/legacy/", null, null);

        assertEquals(200, root.statusCode());
        assertTrue(root.body().contains("<div id=\"root\"></div>"));
        assertFalse(root.body().contains("<h1>FlowScope</h1>"));
        assertTrue(legacy.body().contains("<h1>FlowScope</h1>"));
    }

    @Test
    void servesMigratingStaticMountsWithoutLeakingCapabilitiesIntoViteAssets() throws Exception {
        start();

        HttpResponse<String> root = get("/", null, null);
        HttpResponse<String> legacy = get("/legacy/", null, null);
        HttpResponse<String> app = get("/app/", null, null);
        assertEquals(200, root.statusCode());
        assertTrue(root.body().contains("<div id=\"root\"></div>"));
        assertFalse(root.body().contains("<h1>FlowScope</h1>"));
        assertEquals(200, legacy.statusCode());
        assertTrue(legacy.body().contains("<h1>FlowScope</h1>"));
        assertTrue(legacy.body().contains(token));
        assertEquals(200, app.statusCode());
        assertTrue(app.body().contains("<div id=\"root\"></div>"));
        assertTrue(app.body().matches("(?s).*name=\"flowscope-capability\" content=\"[0-9a-f]{64}\".*"));

        List<String> assets = viteAssetUrls(app.body());
        assertTrue(assets.stream().anyMatch(path -> path.endsWith(".js")));
        assertTrue(assets.stream().anyMatch(path -> path.endsWith(".css")));
        for (String asset : assets) {
            HttpResponse<String> assetResponse = get(asset, null, null);
            assertEquals(200, assetResponse.statusCode(), asset);
            assertEquals(asset.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
                    assetResponse.headers().firstValue("Content-Type").orElseThrow());
            assertFalse(assetResponse.body().contains(token), asset);
        }
    }

    @Test
    void constrainsStaticMountsToSafeMethodsAndPaths() throws Exception {
        start();
        HttpResponse<String> app = get("/app/", null, null);
        String asset = viteAssetUrls(app.body()).getFirst();
        HttpResponse<String> getResponse = get(asset, null, null);
        HttpResponse<String> headResponse = head(asset);

        assertEquals(getResponse.statusCode(), headResponse.statusCode());
        assertEquals(getResponse.headers().map(), headResponse.headers().map());
        assertEquals("", headResponse.body());
        HttpResponse<String> postResponse = post(asset, "", token);
        assertEquals(405, postResponse.statusCode());
        assertEquals("GET, HEAD", postResponse.headers().firstValue("Allow").orElseThrow());
        for (String invalidPath : List.of("/app/%2e%2e/index.html", "/app/assets/%5csecret", "/app/assets/%00",
                "/app/assets/unknown.exe", "/app/assets/not-present.js")) {
            assertEquals(404, get(invalidPath, null, null).statusCode(), invalidPath);
        }
        assertEquals(403, get("/api/snapshot", null, null).statusCode());
    }

    @Test
    void staticHeadSuccessTransmitsNoBytesAfterHeaders() throws Exception {
        start();

        assertStaticHeadMatchesGet("/app/");
    }

    @Test
    void staticHeadMissingAssetTransmitsNoBytesAfterHeaders() throws Exception {
        start();

        assertStaticHeadMatchesGet("/app/assets/not-present.js");
    }

    @Test
    void staticHeadInvalidAssetTransmitsNoBytesAfterHeaders() throws Exception {
        start();

        assertStaticHeadMatchesGet("/app/assets/%5csecret");
    }

    @Test
    void staticHeadMalformedAssetTransmitsNoBytesAfterHeaders() throws Exception {
        start();

        assertStaticHeadMatchesGet("/app/assets/%zz");
    }

    @Test
    void retiredLlmAndMcpRoutesAreNotExposed() throws Exception {
        start();
        for (String path : List.of("/api/llm-run", "/api/ai-preview", "/api/ai-scenarios", "/mcp")) {
            assertEquals(404, get(path, token, null).statusCode(), path);
            assertEquals(404, post(path, "action=start&role=JUDGE", token).statusCode(), path);
        }
    }

    @Test
    void explorerRoutesExposeRunFactsWithoutEchoingCredentials() throws Exception {
        start();

        JsonNode initial = json(get("/api/explorer-run", token, origin()));
        assertEquals("IDLE", initial.at("/run/status").asText());
        assertEquals(0, initial.at("/run/endpointDeclarations").asInt());
        assertEquals(0, initial.at("/run/parameterDeclarations").asInt());
        assertEquals(0, initial.at("/run/capabilityProbes").asInt());
        assertEquals(state.record.service + "/", initial.at("/scope/0").asText());
        JsonNode catalog = json(get("/api/explorer-models", token, origin()));
        assertEquals("gpt-5.6-sol", catalog.path("configuredModel").asText());
        assertEquals("gpt-6.1-sol", catalog.at("/models/1/id").asText());

        assertEquals(400, post("/api/explorer-accounts", "action=save&id=human-a&loginUrl=x", token).statusCode());
        HttpResponse<String> opened = post("/api/explorer-accounts",
                "action=browser-open&id=human-a&url=" + encode(state.record.service + "/"), token);
        assertEquals(200, opened.statusCode());
        assertEquals("NEEDS_INPUT", JSON.readTree(opened.body()).at("/account/status").asText());
        HttpResponse<String> completed = post("/api/explorer-accounts", "action=browser-complete&id=human-a", token);
        assertEquals(200, completed.statusCode());
        assertFalse(completed.body().contains("session-secret"));
        assertEquals("Authorization", JSON.readTree(completed.body()).at("/account/headerNames/0").asText(""),
                "only header names may be exposed");
        String accountId = JSON.readTree(completed.body()).at("/account/id").asText();

        HttpResponse<String> started = post("/api/explorer-run",
                "action=start&target=" + encode(state.record.service + "/")
                        + "&anonymous=false&accounts=" + accountId + "&model=gpt-6.1-sol",
                token);
        assertEquals(202, started.statusCode());
        assertEquals("RUNNING", JSON.readTree(started.body()).at("/run/status").asText());
        assertEquals(accountId, JSON.readTree(started.body()).at("/run/accountIds/0").asText());
        assertEquals("gpt-6.1-sol", JSON.readTree(started.body()).at("/run/model").asText());
    }

    @Test
    void explorerReadinessCanBeRecheckedWithoutStartingARun() throws Exception {
        start();

        HttpResponse<String> response = post("/api/explorer-run", "action=recheck", token);

        assertEquals(200, response.statusCode());
        assertEquals("READY", JSON.readTree(response.body()).at("/run/providerReadiness").asText());
        assertEquals(1, state.explorerReadinessChecks);
    }

    @Test
    void zapAccountsStayMemoryOnlyAndScannerRunExposesOnlySafeMetadata() throws Exception {
        start();

        HttpResponse<String> saved = post("/api/zap-accounts",
                "action=save&label=ZAP-A&role=USER&service=" + encode(state.record.service)
                        + "&loginUrl=" + encode(state.record.service + "/login")
                        + "&username=" + encode(" zap-user@example.test ")
                        + "&password=" + encode("  zap-secret-password  "), token);

        assertEquals(200, saved.statusCode(), saved.body());
        assertFalse(saved.body().contains("zap-user@example.test"));
        assertFalse(saved.body().contains("zap-secret-password"));
        assertEquals(" zap-user@example.test ", state.lastZapAccountInput.username());
        assertEquals("  zap-secret-password  ", state.lastZapAccountInput.password());
        String accountId = JSON.readTree(saved.body()).at("/account/id").asText();
        JsonNode scanner = json(get("/api/scanner-run", token, origin()));
        assertEquals(accountId, scanner.at("/accounts/0/id").asText());
        assertTrue(scanner.at("/accounts/0/hasPassword").asBoolean());
        assertFalse(scanner.at("/accounts/0/hasLoggedInIndicator").asBoolean());
        assertFalse(scanner.at("/accounts/0/hasLoggedOutIndicator").asBoolean());
        assertFalse(scanner.toString().contains("zap-user@example.test"));
        assertFalse(scanner.toString().contains("zap-secret-password"));

        HttpResponse<String> deleted = post("/api/zap-accounts",
                "action=delete&id=" + encode(accountId), token);
        assertEquals(200, deleted.statusCode(), deleted.body());
        assertEquals(0, json(get("/api/scanner-run", token, origin())).at("/accounts").size());
    }

    @Test
    void accountSettingsShowTheSavedZapLoginIdAndPasswordOnlyToTheSettingsPanel() throws Exception {
        start();
        String accountId = json(post("/api/account-save",
                "label=USER+A&role=User&target=" + encode(state.record.service), token)).path("id").asText();
        assertEquals(200, post("/api/zap-accounts", "action=save&id=" + encode(accountId)
                + "&label=USER+A&role=USER&service=" + encode(state.record.service)
                + "&loginUrl=" + encode(state.record.service + "/login")
                + "&username=" + encode("zap-user@example.test") + "&password=" + encode("zap-secret-password"),
                token).statusCode());

        JsonNode settings = json(get("/api/account-settings?account=" + encode(accountId), token, origin()));
        assertEquals("zap-user@example.test", settings.at("/zap/loginId").asText());
        assertEquals("zap-secret-password", settings.at("/zap/password").asText());
        assertFalse(settings.at("/zap/connected").asBoolean(), "the stub ZAP is unavailable");
        assertFalse(settings.at("/zap/connectionLabel").asText().isBlank(), "a real disconnection is shown");
        JsonNode scanner = json(get("/api/scanner-run", token, origin()));
        assertFalse(scanner.toString().contains("zap-secret-password"), "the account list stays metadata-only");
        assertFalse(get("/api/snapshot", token, origin()).body().contains("zap-secret-password"));
    }

    @Test
    void zapAccountCanRefreshTheIndependentRegisteredSessionWithoutExposingCredentials() throws Exception {
        start();

        HttpResponse<String> response = post("/api/zap-accounts",
                "action=refresh-session&id=user-a", token);

        assertEquals(202, response.statusCode(), response.body());
        assertEquals("user-a", state.refreshedZapSessionAccountId);
        assertEquals("RUNNING", JSON.readTree(response.body()).path("status").asText());
        assertFalse(response.body().contains("password"));
        assertFalse(response.body().contains("Authorization"));
        assertFalse(response.body().contains("Cookie"));
    }

    @Test
    void archivedAssessmentsAreReadOnlyAndDoNotBecomeCurrentCandidates() throws Exception {
        start();
        state.archivedAssessments = List.of(new LegacyAssessment("old-1", "BOLA", "LIKELY",
                "옛 평가", "token=ARCHIVESECRET", List.of(state.record.evidenceId),
                java.time.Instant.parse("2026-08-24T00:00:00Z")));
        state.archivedValidations = List.of(new ValidationDecision("old-1",
                ValidationDecision.FinalVerdict.CONFIRMED, "token=VERDICTSECRET",
                List.of(state.record.evidenceId), List.of("old-repro"), List.of("old-control"),
                "old-run", java.time.Instant.parse("2026-08-24T00:01:00Z")));
        HttpResponse<String> response = get("/api/snapshot", token, null);
        assertEquals(200, response.statusCode());
        JsonNode snapshot = JSON.readTree(response.body());
        assertTrue(snapshot.path("legacyLlm").path("readOnly").asBoolean());
        assertEquals("2026-08-24T00:00:00Z",
                snapshot.at("/legacyLlm/assessments/0/createdAt").asText());
        assertEquals("CONFIRMED", snapshot.at("/legacyLlm/validations/0/verdict").asText());
        assertFalse(response.body().contains("ARCHIVESECRET"));
        assertFalse(response.body().contains("VERDICTSECRET"));
        assertFalse(snapshot.path("scenarios").toString().contains("old-1"));
        assertEquals(400, post("/api/review", "itemId=old-1&status=CONFIRMED&note=change", token).statusCode());
    }

    @Test
    void servesBrandedUiAndProtectsApiWithCapabilityAndOrigin() throws Exception {
        start();
        HttpResponse<String> index = get("/legacy/", null, null);
        assertEquals(200, index.statusCode());
        assertTrue(index.body().contains("<h1>FlowScope</h1>"));
        assertTrue(index.body().contains("HUMAN pass 시작"));
        assertTrue(index.body().contains("Evidence 표시"));
        assertTrue(index.body().contains("--human:#2563EB; --scanner:#DC2626; --llm:#111827;"));
        assertTrue(index.body().contains("human:{n:'사람',c:'--human',ab:'H'}"));
        assertTrue(index.body().contains("scanner:{n:'스캐너',c:'--scanner',ab:'S'}"));
        assertTrue(index.body().contains("llm:{n:'LLM',c:'--llm',ab:'L'}"));
        assertTrue(index.body().contains("사람 H (파랑·실선)"));
        assertTrue(index.body().contains("스캐너 S (빨강·파선)"));
        assertTrue(index.body().contains("LLM L (검정·점선)"));
        assertTrue(index.body().contains("검토 대기"));
        assertTrue(index.body().contains("인증·화면·반복 보조 흐름 표시"));
        assertTrue(index.body().contains("저장 상한으로 유실"));
        assertTrue(index.body().contains("샘플 데이터 · 실제 HUMAN/ZAP/LLM 점검 결과가 아님"));
        assertTrue(index.body().contains("activeDispositions={INCLUDE:true,REVIEW:true,EXCLUDE:false}"));
        assertTrue(index.body().contains("첫 점검을 시작하세요"));
        assertTrue(index.body().contains("Burp exact scope → 로그인/HUMAN pass → ZAP 기준선 → Evidence 검토"));
        assertTrue(index.body().contains("완료되지 않은 단계 하나만 엽니다"));
        assertTrue(index.body().contains("data-setup-stage=\"scope\""));
        assertTrue(index.body().contains("data-setup-pane=\"scanner\""));
        assertTrue(index.body().contains("function selectSetupStage(stage,pinned=true)"));
        assertTrue(index.body().contains("const autoStage=!scopeReady?'scope':!humanReady?'human':!scannerReady?'scanner':'review'"));
        assertTrue(index.body().contains("pane.hidden=pane.dataset.setupPane!==stage"));
        assertFalse(index.body().contains("/api/llm-run"));
        assertFalse(index.body().contains("LLM Explorer 시작"));
        assertFalse(index.body().contains("Judge 시작"));
        assertTrue(index.body().contains("executionQualityLabel"));
        assertTrue(index.body().contains("전송 전부 실패"));
        assertTrue(index.body().contains("TLS 인증서 검증"));
        assertTrue(index.body().contains("scannerlane"));
        assertTrue(index.body().contains("Client "));
        assertTrue(index.body().contains("scannerstate.completed_with_warnings"));
        assertTrue(index.body().contains("SCANNER_RUN.status==='COMPLETED_WITH_WARNINGS'"));
        assertTrue(index.body().contains("scannerWarning?'경고 완료'"));
        assertTrue(index.body().contains("SCANNER_RUN.elapsed_seconds"));
        assertTrue(index.body().contains("SCANNER_RUN.last_heartbeat_age_seconds"));
        assertTrue(index.body().contains("lane.wait_reason"));
        assertTrue(index.body().contains("RESPONDING_NO_NEW_TRAFFIC"));
        assertTrue(index.body().contains("STARTING:'실행 준비 중'"));
        assertTrue(index.body().contains("lane.passive_remaining"));
        assertTrue(index.body().contains("lane.passive_task"));
        assertTrue(index.body().contains("Alert 집계 전"));
        assertFalse(index.body().contains("Traditional Spider"));
        assertFalse(index.body().contains("AJAX Spider 보완"));
        assertTrue(index.body().contains("실시간 실행 기록"));
        assertTrue(index.body().contains("SCANNER_RUN.events"));
        assertTrue(index.body().contains("id=\"scannerRunCancel\""));
        assertTrue(index.body().contains("출처 검증 차단"));
        assertTrue(index.body().contains("WAITING_FOR_ZAP_RESPONSE"));
        assertTrue(index.body().contains("작업 신호"));
        assertTrue(index.body().contains("마지막 정상 상태를 유지합니다"));
        assertTrue(index.body().contains("1초마다 갱신"));
        assertFalse(index.body().contains("ZAP Desktop 설정"));
        assertTrue(index.body().contains("Docker Chromium 시작"));
        assertTrue(index.body().contains("/api/zap-status"));
        assertTrue(index.body().contains("!ZAP_STATUS.connected"));
        assertTrue(index.body().contains("classList.toggle('empty-state',!EVENTS.length&&!SERVER_ROUTE_CANDIDATES.length)"));
        assertTrue(index.body().contains("v1.2.0-beta.49 · 3소스"));
        assertTrue(index.body().contains("id=\"fScanner\" accept=\".xml,.har\""));
        assertTrue(index.body().contains("ZAP HAR"));
        assertTrue(index.body().contains("/api/import-har"));
        assertTrue(index.body().contains(".graphcanvas{display:none}.graphlist{display:block}"));
        assertTrue(index.body().contains("<div class=\"graphcanvas\" id=\"graphCanvas\" style=\"display:none\"><div id=\"cy\"></div></div>"));
        assertTrue(index.body().contains("API·입력 차이 작업목록"));
        assertTrue(index.body().contains("surfaceExtraction"));
        assertTrue(index.body().contains("SERVER_SURFACE=data.surface||{endpoints:[],extractions:[]}"));
        assertTrue(index.body().contains("function renderSurface()"));
        assertTrue(index.body().contains("function filteredSurface()"));
        assertTrue(index.body().contains("visibleObservations:observations"));
        assertTrue(index.body().contains("선언은 대상 산출물에서 읽은 검토 기준이고 관측은 실제 HTTP Evidence"));
        assertTrue(index.body().contains("item.evidenceId,item.applicability,item.reason].map(esc)"));
        assertTrue(index.body().contains("· 로그인 필요"));
        assertTrue(index.body().contains("등록 계정과 로그인 상태"));
        assertTrue(index.body().contains("쿠키·토큰·subject 단서는 같은 로그인 세션의 내부 근거로 묶"));
        assertTrue(index.body().contains("고급 세션 진단"));
        assertTrue(index.body().contains("사용 가능"));
        assertTrue(index.body().contains("다시 로그인 필요"));
        assertTrue(index.body().contains("동일 인증정보 충돌"));
        assertTrue(index.body().contains("요청 실험실"));
        assertTrue(index.body().contains("원문 그대로"));
        assertTrue(index.body().contains("비로그인으로 전송"));
        assertTrue(index.body().contains("/api/request-lab"));
        assertTrue(index.body().contains("REQUEST_LAB_GENERATION"));
        assertTrue(index.body().contains("REQUEST_LAB_IN_FLIGHT"));
        assertTrue(index.body().contains("REQUEST_LAB_RETRY"));
        assertTrue(index.body().contains("sameRetry?REQUEST_LAB_RETRY.operationId:requestLabOperationId()"));
        assertTrue(index.body().contains("eventId!==REQUEST_LAB_EVENT_ID"));
        assertTrue(index.body().contains("data-gap=\"'+candidate+'\""));
        assertTrue(index.body().contains("일반 미검증 조합"));
        assertTrue(index.body().contains("SERVER_MANAGED_SESSIONS.filter(session=>session.status==='ACTIVE'"));
        assertTrue(index.body().contains("좁은 화면용 API 목록"));
        assertTrue(index.body().contains("renderGraphList(cellValues,visibleOperations)"));
        assertTrue(index.body().contains("let GRAPH_LEVEL='api', GRAPH_SELECTED_GROUP=''"));
        assertTrue(index.body().contains("<button class=\"vbtn on\" data-graph-level=\"api\">API</button>"));
        assertTrue(index.body().contains("counts:{human:new Set(),scanner:new Set(),llm:new Set()}"));
        assertTrue(index.body().contains("flowscope.graph-state.v5"));
        assertTrue(index.body().contains("GRAPH_STATE.viewports[CY_GRAPH_LEVEL||GRAPH_LEVEL]"));
        assertTrue(index.body().contains("data-detail="));
        assertTrue(index.body().contains("상세 보기"));
        assertTrue(index.body().contains("showOperation(item.op,0,item.eventId)"));
        assertTrue(index.body().contains("text-overflow-wrap':'whitespace'"));
        assertTrue(index.body().contains("관측 신원과 재사용 가능한 등록 계정 세션은 별도 상태"));
        assertTrue(index.body().contains("ACTIVE 등록 계정 없음"));
        assertTrue(index.body().contains("let HUMAN_RUN={active:false,completed:false,runId:''}"));
        assertTrue(index.body().contains("const humanReady=HUMAN_RUN.completed"));
        assertTrue(index.body().contains("syncHumanRun();syncExtension();syncScannerRun();"));
        assertTrue(index.body().contains("setInterval(()=>{syncHumanRun();syncExtension();syncScannerRun();},1000)"));
        assertFalse(index.body().contains("counts.human+'건 완료'"));
        assertTrue(index.body().contains("data-source-count=\"human\""));
        assertTrue(index.body().contains("EVENTS.filter(event=>event.coverageEligible)"));
        assertTrue(index.body().contains("cb.addEventListener('change',()=>{activeSources[cb.value]=cb.checked;renderSurface();renderGraph();})"));
        assertTrue(index.body().contains("if(view==='source')cy.edges('[src]').forEach"));
        assertTrue(index.body().contains("accessByRelation=new Map()"));
        assertTrue(index.body().contains("function showAccessEdge(edge)"));
        assertTrue(index.body().contains("taxiTurn:accessTurn(c.idn,s)"));
        assertTrue(index.body().contains("'label':'data(label)'"));
        assertTrue(index.body().contains("wrapGraphLabel"));
        assertTrue(index.body().contains("nodeHeight"));
        assertFalse(index.body().contains("shortLabel(value.slice(p+1),36)"));
        assertTrue(index.body().contains("API 요구 권한 0개 · BFLA 비교 비활성"));
        assertTrue(index.body().contains("identityKindLabel(idn)"));
        assertFalse(index.body().contains("세션 '+sessions+'개"));
        assertTrue(index.body().contains("응답 ID가 다음 요청으로 전달된 관계는 메인 접근 그래프와 섞지 않고"));
        assertFalse(index.body().contains("etype:'flow'"));
        assertFalse(index.body().contains("cycleRole("));
        assertFalse(index.body().contains("__FLOWSCOPE_CAPABILITY__"));

        assertEquals(403, get("/api/snapshot", null, null).statusCode());
        assertEquals(403, get("/api/snapshot", token, "https://evil.example").statusCode());

        JsonNode zapStatus = json(get("/api/zap-status", token, origin()));
        assertFalse(zapStatus.path("connected").asBoolean());
        assertEquals("UNAVAILABLE", zapStatus.path("state").asText());

        HttpResponse<String> snapshot = get("/api/snapshot", token, origin());
        assertEquals(200, snapshot.statusCode(), snapshot.body());
        assertEquals("no-store", snapshot.headers().firstValue("Cache-Control").orElse(""));
        JsonNode body = JSON.readTree(snapshot.body());
        assertEquals(1, body.path("events").size());
        assertEquals(1, body.path("cells").size());
        assertEquals("untested", body.at("/cells/0/overall").asText());
        assertEquals("untested", body.at("/cells/0/perSource/human").asText());
        assertEquals("human", body.at("/activeSources/0").asText());
        assertEquals(1, body.at("/trafficStats/captured").asInt());
        assertEquals(0, body.at("/trafficStats/dropped").asInt());
        assertEquals(0, body.at("/trafficStats/payloadMetadataOnly").asInt());
        assertFalse(body.path("sampleMode").asBoolean());
        assertTrue(body.at("/events/0/coverageEligible").asBoolean());
        assertEquals("API", body.at("/events/0/trafficClass").asText());
        assertFalse(body.at("/events/0/classificationReasons").isEmpty());
        assertEquals("CORROBORATED", body.at("/events/0/pathTemplateStatus").asText());
        assertEquals("RESPONSE_ID_MATCH", body.at("/events/0/pathTemplateReasons/0").asText());
        assertEquals(1, body.at("/events/0/repeatCount").asInt());
        assertFalse(body.at("/events/0").has("clusterEvidenceIds"));
        assertEquals("PATH_ID", body.at("/events/0/objects/0/evidence").asText());
        assertEquals(1, body.path("routeCandidates").size());
        assertFalse(body.at("/routeCandidates/0/observed").asBoolean());
        assertEquals(List.of("REVIEW"), JSON.convertValue(
                body.at("/routeCandidates/0/priorityReasons"),
                new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}));
        assertEquals(1, body.at("/surface/endpoints").size());
        JsonNode observedSurface = java.util.stream.StreamSupport.stream(
                        body.at("/surface/endpoints").spliterator(), false)
                .filter(item -> item.at("/key/pathTemplate").asText().equals("/v1/orders/{id}"))
                .findFirst().orElseThrow();
        assertEquals("OBSERVED_NOT_DECLARED", observedSurface.path("deltaState").asText());
        assertEquals("human", observedSurface.at("/observations/0/source").asText().toLowerCase());
        assertTrue(body.at("/surface/extractions").isArray());
        assertTrue(index.body().contains("해석 실패 지점"));
        assertTrue(index.body().contains("data-rail=\"surface\""));
        assertTrue(index.body().contains("접근 대상 ID"));

        JsonNode evidence = json(get("/api/evidence?operation="
                + encode(body.at("/events/0/op").asText()), token, origin()));
        assertEquals("FULL", evidence.at("/records/0/requestPayload/retention").asText());
        assertTrue(evidence.at("/records/0/requestPayload/bytes").asInt() > 0);
        assertEquals(64, evidence.at("/records/0/requestPayload/digest").asText().length());
        assertTrue(index.body().contains("압축 전문 총량 상한 초과"));
    }

    @Test
    void importsZapHarOnlyAsScannerTraffic() throws Exception {
        start();
        String har = """
                {"log":{"version":"1.2","entries":[{
                  "startedDateTime":"2026-08-30T00:00:00Z",
                  "request":{"method":"GET","url":"https://api.example.test/v1/har-orders/9","headers":[]},
                  "response":{"status":200,"statusText":"OK","headers":[{"name":"Content-Type","value":"application/json"}],"content":{"mimeType":"application/json","text":"{\\\"id\\\":9}"}}
                }]}}
                """;

        HttpResponse<String> imported = postRaw("/api/import-har?source=scanner&name=zap.har",
                har, "application/json", token);

        assertEquals(200, imported.statusCode(), imported.body());
        JsonNode result = JSON.readTree(imported.body());
        assertEquals(1, result.path("imported").asInt());
        assertEquals(0, result.path("failed").asInt());
        JsonNode event = java.util.stream.StreamSupport.stream(
                        json(get("/api/snapshot", token, origin())).path("events").spliterator(), false)
                .filter(item -> item.path("path").asText().equals("/v1/har-orders/9"))
                .findFirst().orElseThrow();
        assertEquals("scanner", event.path("source").asText());

        assertEquals(400, postRaw("/api/import-har?source=human&name=wrong.har",
                har, "application/json", token).statusCode());
    }

    /** PR #11 evidence contract: derived parameter metadata rides on /api/evidence without values or sensitive paths. */
    @Test
    void evidenceExposesDerivedParameterMetadataWithoutValuesOrSensitivePaths() throws Exception {
        RequestRecord search = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/v1/search", 200, "sess:abcdef123456");
        search.query = "status=open&password=hunter2";
        search.reqText = "GET /v1/search?status=open&password=***MASKED*** HTTP/1.1\r\nHost: api.example.test\r\n\r\n";
        search.respText = "HTTP/1.1 200 OK\r\n\r\n{}";
        search.requestPayload = StoredPayload.capture(search.reqText, "", 1024 * 1024);
        search.responsePayload = StoredPayload.capture(search.respText, "", 1024 * 1024);
        search.body = "{}";
        search.hasResponse = true;
        search.timestamp = 2;
        state.records.add(search);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        String op = java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                .filter(item -> item.path("path").asText().startsWith("/v1/search"))
                .findFirst().orElseThrow().path("op").asText();
        HttpResponse<String> response = get("/api/evidence?operation=" + encode(op), token, origin());
        assertEquals(200, response.statusCode(), response.body());
        JsonNode record = JSON.readTree(response.body()).path("records").get(0);
        assertEquals(op, record.at("/parameterContext/operation").asText());
        assertEquals("HUMAN", record.at("/parameterContext/source").asText());
        assertEquals("RETAINED", record.at("/parameterContext/retention").asText());
        assertEquals(200, record.at("/parameterContext/status").asInt());
        JsonNode observations = record.path("parameterObservations");
        assertEquals(1, observations.size(), observations.toString());
        assertEquals("QUERY", observations.at("/0/key/location").asText());
        assertEquals("/status", observations.at("/0/key/canonicalPath").asText());
        assertTrue(observations.at("/0/key/stableKey").asText().startsWith("pk:v1:"));
        assertEquals("PRESENT", observations.at("/0/presence").asText());
        assertEquals("STRING", observations.at("/0/valueType").asText());
        assertEquals(4, observations.at("/0/byteLength").asInt());
        assertTrue(observations.at("/0/digest").asText().matches("[0-9a-f]{64}"), observations.toString());
        assertTrue(observations.at("/0/contextSignature").asText().startsWith("ctx:v1:sha256:"));
        assertFalse(response.body().contains("hunter2"));
        assertFalse(response.body().contains("maskedPreview"));
        assertFalse(response.body().contains("\"/password\""));
    }

    @Test
    void snapshotSeparatesMainComparisonReviewAndExcludedEvidence() throws Exception {
        RequestRecord review = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/status", 200, "anon");
        review.body = "ok";
        review.hasResponse = true;
        RequestRecord excluded = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/static/app.js", 200, "anon");
        excluded.hasResponse = true;
        excluded.secFetchDest = "script";
        excluded.responseContentType = "application/javascript";
        state.records.add(review);
        state.records.add(excluded);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));

        assertEquals(3, snapshot.at("/trafficStats/captured").asInt());
        assertEquals(1, snapshot.at("/trafficStats/coverage").asInt());
        assertEquals(1, snapshot.at("/trafficStats/review").asInt());
        assertEquals(1, snapshot.at("/trafficStats/excluded").asInt());
        JsonNode reviewEvent = java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                .filter(value -> value.path("path").asText().equals("/status")).findFirst().orElseThrow();
        assertEquals("REVIEW", reviewEvent.path("trafficDisposition").asText());
        assertFalse(reviewEvent.path("coverageEligible").asBoolean());
    }

    @Test
    void startsAndEndsExactHumanRunWithoutOverlap() throws Exception {
        start();
        JsonNode idle = json(get("/api/human-run", token, origin()));
        assertFalse(idle.path("active").asBoolean());
        assertFalse(idle.path("completed").asBoolean());

        JsonNode began = json(post("/api/human-run", "action=begin&runId=human-p5-1", token));
        assertTrue(began.path("active").asBoolean());
        assertFalse(began.path("completed").asBoolean());
        assertEquals("human-p5-1", began.path("runId").asText());
        assertEquals("실제 리스너 감지 대기", began.path("proxy").asText());
        assertEquals("human-p5-1", state.contexts.current(Source.HUMAN).runId());

        state.observedHumanPort = 8888;
        state.otherHumanPort = 9999;
        state.otherHumanRequests = 2;
        JsonNode bound = json(get("/api/human-run", token, origin()));
        assertEquals("http://127.0.0.1:8888", bound.path("proxy").asText());
        assertEquals(2, bound.path("otherListenerRequests").asInt());
        assertEquals(9999, bound.path("otherListenerPort").asInt());

        assertEquals(400, post("/api/human-run", "action=begin&runId=human-p5-2", token).statusCode());
        assertEquals(400, post("/api/human-run", "action=end&runId=wrong", token).statusCode());
        assertEquals("human-p5-1", state.contexts.current(Source.HUMAN).runId());

        state.addHumanEvidence("human-p5-1", null);
        JsonNode ended = json(post("/api/human-run", "action=end&runId=human-p5-1", token));
        assertFalse(ended.path("active").asBoolean());
        assertTrue(ended.path("completed").asBoolean());
        assertNull(state.contexts.current(Source.HUMAN));

        JsonNode restarted = json(post("/api/human-run", "action=begin&runId=human-p5-3", token));
        assertTrue(restarted.path("active").asBoolean());
        assertFalse(restarted.path("completed").asBoolean());
    }

    @Test
    void endingAHumanRunWithoutEvidenceAbortsItInsteadOfFailing() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();
        json(post("/api/human-run", "action=begin&runId=human-empty&account=user-a", token));

        HttpResponse<String> ended = post("/api/human-run", "action=end&runId=human-empty", token);

        assertEquals(200, ended.statusCode());
        JsonNode body = json(ended);
        assertFalse(body.path("active").asBoolean());
        assertFalse(body.path("completed").asBoolean());
        assertNull(state.contexts.current(Source.HUMAN));
        assertFalse(state.sessions.viewForAccount("user-a").orElseThrow().capturing());
        assertEquals(400, post("/api/human-run", "action=end&runId=human-empty", token).statusCode());
    }

    @Test
    void startsHumanRunWithAnExplicitRegisteredAccount() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();

        // No prior login capture: the pass itself captures the account session.
        JsonNode began = json(post("/api/human-run", "action=begin&runId=human-a&account=user-a", token));

        assertEquals("user-a", began.path("accountId").asText());
        assertEquals("user-a", state.contexts.current(Source.HUMAN).accountId());
        assertTrue(state.sessions.viewForAccount("user-a").orElseThrow().capturing());
        state.addHumanEvidence("human-a", "user-a");
        assertEquals(200, post("/api/human-run", "action=end&runId=human-a", token).statusCode());
        assertFalse(state.sessions.viewForAccount("user-a").orElseThrow().capturing());
        assertEquals(400, post("/api/human-run", "action=begin&runId=human-b&account=missing", token).statusCode());
    }

    @Test
    void capturesManagedSessionWithoutReturningRawCredentials() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();

        assertEquals(200, post("/api/session-capture", "action=begin&account=user-a", token).statusCode());
        String handle = state.sessions.handleForAccount("user-a");
        state.sessions.observeRequest(handle, URI.create(state.record.service + "/login"),
                Map.of("Authorization", "Bearer raw-access-token", "Cookie", "sid=raw-cookie"),
                java.time.Instant.now());
        state.sessions.observeResponse(handle, URI.create(state.record.service + "/account"), 200,
                null, "{\"id\":\"user-a\"}", List.of(), java.time.Instant.now());
        var ended = post("/api/session-capture", "action=end&account=user-a", token);
        assertEquals(200, ended.statusCode());
        assertTrue(ended.body().contains("HUMAN pass와 요청 실험실"));
        assertFalse(ended.body().contains("LLM에서"));

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        assertEquals("ACTIVE", snapshot.at("/managedSessions/0/status").asText());
        assertEquals("user-a", snapshot.at("/managedSessions/0/accountId").asText());
        assertFalse(snapshot.toString().contains("raw-access-token"));
        assertFalse(snapshot.toString().contains("raw-cookie"));
        JsonNode broker = json(get("/api/session-capture", token, origin()));
        assertFalse(broker.toString().contains("raw-access-token"));
        assertFalse(broker.toString().contains("raw-cookie"));
    }

    @Test
    void pastedHeaderBlockRegistersCredentialsAndSettingsShowOnlyMaskedPreviews() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();

        String block = "GET /me HTTP/1.1\nHost: api.example.test\nAuthorization: Bearer raw-access-token-value\n"
                + "Cookie: sid=raw-cookie-value-long\nAccept: */*";
        assertEquals(200, post("/api/session-capture", "action=credential&account=user-a&headers="
                + encode(block), token).statusCode());

        JsonNode settings = json(get("/api/account-settings?account=user-a", token, origin()));
        assertEquals("ACTIVE", settings.at("/human/status").asText());
        String credentials = settings.at("/human/credentials").toString();
        assertTrue(credentials.contains("Bearer raw-••••"), credentials);
        assertTrue(credentials.contains("sid=raw-••••"), credentials);
        assertFalse(settings.toString().contains("access-token-value"));
        assertFalse(settings.toString().contains("cookie-value-long"));
    }

    @Test
    void deletesAnAccountEvenWhenObservedSessionsAreStillBoundToIt() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.config.bindSession(state.record.service, state.record.fp, "user-a");
        state.rebuild();
        start();

        assertEquals(200, post("/api/account-delete", "id=user-a", token).statusCode());
        assertTrue(state.config.account("user-a").isEmpty());
        assertFalse(state.config.sessionBindings().containsValue("user-a"));
    }

    @Test
    void projectsCookieTokenAndSubjectArtifactsAsOneRegisteredAccount() throws Exception {
        state.records.clear();
        AccountProfile account = new AccountProfile("test1", "test1", state.record.service, AccessRole.USER);
        state.config.upsertAccount(account);
        List<String> fingerprints = List.of("ck:d1acd57ee88d", "tok:710e0dbdd422", "sub:test1@example.test");
        for (int i = 0; i < fingerprints.size(); i++) {
            RequestRecord record = new RequestRecord(Source.HUMAN, state.record.service,
                    "GET", "/account/" + i, 200, fingerprints.get(i));
            record.hasResponse = true;
            record.timestamp = i + 1L;
            state.records.add(record);
            state.config.bindSession(record.service, record.fp, account.id());
        }
        RequestRecord unresolved = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/account/unresolved", 200, "");
        unresolved.hasResponse = true;
        state.records.add(unresolved);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        assertEquals(1, snapshot.path("accounts").size());
        assertEquals("test1", snapshot.at("/accounts/0/label").asText());
        assertEquals(3, snapshot.at("/accounts/0/authArtifactCount").asInt());
        assertFalse(snapshot.at("/accounts/0").has("boundSessions"));
        assertEquals(3, snapshot.path("sessions").size());
        for (JsonNode session : snapshot.path("sessions")) {
            assertEquals("test1", session.path("accountId").asText());
            assertTrue(session.path("registered").asBoolean());
        }
        assertEquals(Set.of("COOKIE", "AUTHORIZATION", "SUBJECT_HINT"),
                java.util.stream.StreamSupport.stream(snapshot.path("sessions").spliterator(), false)
                        .map(value -> value.path("artifactKind").asText()).collect(java.util.stream.Collectors.toSet()));
    }

    @Test
    void startsOneServerOwnedScannerCampaignForAnonymousAndSelectedAccounts() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.config.upsertAccount(new AccountProfile("user-b", "USER B", state.record.service, AccessRole.USER));
        activateSession("user-a", "token-a");
        activateSession("user-b", "token-b");
        state.rebuild();
        start();

        JsonNode initial = json(get("/api/scanner-run", token, origin()));
        assertEquals("NOT_STARTED", initial.at("/run/status").asText());
        assertEquals(state.record.service + "/", initial.at("/scope/0").asText());

        HttpResponse<String> started = post("/api/scanner-run", "target=" + encode(state.record.service + "/")
                + "&anonymous=true&accounts=user-a%2Cuser-b", token);
        assertEquals(202, started.statusCode(), started.body());
        JsonNode body = JSON.readTree(started.body());
        assertEquals("RUNNING", body.at("/run/status").asText());
        assertEquals(state.record.service + "/", state.scannerTarget);
        assertEquals(List.of("user-a", "user-b"), state.scannerAccounts);
        assertTrue(state.scannerAnonymous);
    }

    @Test
    void excludesItsOwnLoopbackControlPlaneFromScannerTargets() throws Exception {
        start();
        state.scannerScope = List.of(server.url());

        JsonNode listed = json(get("/api/scanner-run", token, origin()));
        assertEquals(0, listed.path("scope").size());
        HttpResponse<String> rejected = post("/api/scanner-run",
                "target=" + encode(server.url()) + "&anonymous=true", token);
        assertEquals(400, rejected.statusCode());
        assertTrue(rejected.body().contains("Web 제어면"));
    }

    @Test
    void excludesItsBracketedIpv6LoopbackControlPlaneFromScannerTargets() throws Exception {
        start();
        state.scannerScope = List.of("http://[::1]:" + server.port() + "/");

        JsonNode listed = json(get("/api/scanner-run", token, origin()));
        assertEquals(0, listed.path("scope").size());
        HttpResponse<String> rejected = post("/api/scanner-run",
                "target=" + encode("http://[::1]:" + server.port() + "/") + "&anonymous=true", token);
        assertEquals(400, rejected.statusCode());
        assertTrue(rejected.body().contains("Web 제어면"));
    }

    @Test
    void cancelsTheServerOwnedScannerCampaign() throws Exception {
        start();

        HttpResponse<String> cancelled = post("/api/scanner-run", "action=cancel", token);

        assertEquals(200, cancelled.statusCode(), cancelled.body());
        assertTrue(state.scannerCancelled);
        assertEquals("CANCELLED", JSON.readTree(cancelled.body()).at("/run/status").asText());
    }


    @Test
    void editsServiceBoundAccountPolicyAndHumanReview() throws Exception {
        start();
        JsonNode account = json(post("/api/account-save", "label=USER+A&role=User&target=https%3A%2F%2Fapi.example.test", token));
        String accountId = account.path("id").asText();
        assertFalse(accountId.isBlank());

        assertEquals(400, post("/api/session-bind", "fingerprint=" + encode(state.record.fp)
                + "&account=" + encode(accountId), token).statusCode());
        JsonNode bound = json(post("/api/session-bind", "service=" + encode(state.record.service)
                + "&fingerprint=" + encode(state.record.fp) + "&account=" + encode(accountId), token));
        assertTrue(bound.path("success").asBoolean());
        assertEquals(accountId, state.config.boundAccount(state.record.service, state.record.fp).orElseThrow().id());
        JsonNode accountSnapshot = json(get("/api/snapshot", token, origin()));
        assertEquals(accountId, accountSnapshot.at("/sessions/0/accountId").asText());
        assertEquals("COOKIE", accountSnapshot.at("/sessions/0/artifactKind").asText());

        String operation = state.snapshot().records.getFirst().op;
        assertEquals(200, post("/api/requirement", "operation=" + encode(operation) + "&role=Admin", token).statusCode());
        assertEquals("Admin", state.config.endpointRequirement(operation).label());
        String resource = state.snapshot().records.getFirst().resource;
        assertEquals(200, post("/api/resource-policy", "target=" + encode(resource)
                + "&policy=PUBLIC", token).statusCode());
        assertEquals(io.flowscope.core.ResourcePolicy.PUBLIC, state.config.resourcePolicy(operation, resource));
        assertEquals(200, post("/api/resource-policy", "target=" + encode(resource)
                + "&policy=UNKNOWN", token).statusCode());
        assertEquals(io.flowscope.core.ResourcePolicy.UNKNOWN, state.config.resourcePolicy(operation, resource));
        // operation+resource를 주면 그 API로 그 객체를 다룰 때만 공개한다.
        assertEquals(200, post("/api/resource-policy", "operation=" + encode(operation) + "&resource=" + encode(resource)
                + "&policy=PUBLIC", token).statusCode());
        assertEquals(io.flowscope.core.ResourcePolicy.PUBLIC, state.config.resourcePolicy(operation, resource));
        assertEquals(io.flowscope.core.ResourcePolicy.UNKNOWN, state.config.resourcePolicy(operation, resource + "-other"));
        assertEquals(200, post("/api/resource-policy", "operation=" + encode(operation) + "&resource=" + encode(resource)
                + "&policy=UNKNOWN", token).statusCode());
        assertEquals(io.flowscope.core.ResourcePolicy.UNKNOWN, state.config.resourcePolicy(operation, resource));
        assertEquals(200, post("/api/traffic-override", "operation=" + encode(operation)
                + "&value=EXCLUDE", token).statusCode());
        assertEquals(io.flowscope.core.TrafficOverride.EXCLUDE, state.config.trafficOverride(operation));
        assertEquals(0, state.snapshot().coverageRecords.size());
        assertEquals(1, state.snapshot().records.size());
        assertEquals(200, post("/api/traffic-override", "operation=" + encode(operation) + "&value=REVIEW", token).statusCode());
        assertEquals(io.flowscope.core.TrafficOverride.REVIEW, state.config.trafficOverride(operation));
        assertEquals(0, state.snapshot().coverageRecords.size());
        assertEquals(1, state.snapshot().records.size());
        assertEquals("USER_REVIEW", json(get("/api/snapshot", token, origin())).at("/events/0/classificationReasons/0").asText());
        assertEquals(200, post("/api/traffic-override", "operation=" + encode(operation)
                + "&value=AUTO", token).statusCode());

        state.config.upsertAccount(new AccountProfile("owner", "OWNER", state.record.service, AccessRole.USER));
        state.config.withResourceOwner(state.snapshot().records.getFirst().resource, "owner");
        state.rebuild();
        String findingId = state.snapshot().analysis.findings().getFirst().id();
        assertEquals(200, post("/api/review", "itemId=" + encode(findingId)
                + "&status=CONFIRMED&note=manual+reproduction", token).statusCode());
        assertEquals("CONFIRMED", state.config.reviews().get(findingId).status().name());

        // 판정 매트릭스 cell도 서버가 정한 Evidence(대상+기준)로만 사람 검토를 받는다(D-144).
        JsonNode matrixSnapshot = json(get("/api/snapshot", token, origin()));
        JsonNode matrix = matrixSnapshot.path("authorizationMatrix");
        assertTrue(matrix.path("summary").has("bolaIdorTestRecommendations"));
        assertFalse(matrix.path("functions").isEmpty());
        JsonNode reviewable = null;
        // D-166: 확정 소유자 자기추천은 제거됐으므로, 추천 또는 후보/검토 상태인 실제 리뷰 대상 cell로 왕복을 검사한다.
        java.util.Set<String> reviewableStatus = java.util.Set.of(
                "BFLA_CANDIDATE", "BFLA_REVIEW_REQUIRED", "BOLA_IDOR_CANDIDATE", "BOLA_IDOR_REVIEW_REQUIRED");
        for (JsonNode cell : matrix.path("objects")) {
            boolean hasRec = !cell.path("recommendation").isMissingNode() && !cell.path("recommendation").isNull();
            if (hasRec || reviewableStatus.contains(cell.path("status").asText())) { reviewable = cell; break; }
        }
        assertNotNull(reviewable, "사람 검토가 가능한(추천 또는 후보) 객체 cell이 있어야 한다");
        String cellId = reviewable.path("id").asText();
        assertEquals("UNRESOLVED", reviewable.path("reviewStatus").asText());
        assertEquals(200, post("/api/review", "itemId=" + encode(cellId) + "&status=DISMISSED&note=shared+object", token).statusCode());
        List<String> boundEvidence = new java.util.ArrayList<>();
        reviewable.path("reviewEvidenceIds").forEach(id -> boundEvidence.add(id.asText()));
        assertEquals(boundEvidence, state.config.reviews().get(cellId).evidenceIds());
        JsonNode reviewed = json(get("/api/snapshot", token, origin())).path("authorizationMatrix");
        boolean dismissed = false;
        for (JsonNode cell : reviewed.path("objects")) if (cell.path("id").asText().equals(cellId)) dismissed = cell.path("reviewStatus").asText().equals("DISMISSED");
        assertTrue(dismissed);
        assertEquals(1, reviewed.path("summary").path("humanDismissed").asInt());
        assertEquals(400, post("/api/review", "itemId=object-unknown&status=CONFIRMED&note=x", token).statusCode());
        assertEquals(400, post("/api/review", "itemId=" + encode(cellId)
                + "&status=CONFIRMED&validationEvidenceIds=" + encode(state.record.evidenceId), token).statusCode(),
                "ordinary discovery Evidence cannot be attached as a manual response");
        assertEquals(io.flowscope.core.ReviewDecision.Status.DISMISSED, state.config.reviews().get(cellId).status());
        String ownFunction = null;
        for (JsonNode cell : matrix.path("functions")) if (cell.path("identity").asText().equals(accountId)) {
            ownFunction = cell.path("id").asText(); break;
        }
        assertNotNull(ownFunction);
        RequestRecord manual = new RequestRecord(Source.HUMAN, state.record.service, state.record.method,
                state.record.path, 200, state.record.fp);
        manual.phase = io.flowscope.core.RunPhase.VALIDATION;
        manual.executionTrust = io.flowscope.core.ExecutionTrust.CONTROLLED;
        manual.originEvidenceId = state.record.evidenceId;
        manual.body = state.record.body;
        manual.hasResponse = true;
        manual.timestamp = 2;
        state.records.add(manual);
        state.rebuild();
        assertEquals(200, post("/api/review", "itemId=" + encode(ownFunction)
                + "&status=CONFIRMED&validationEvidenceIds=" + encode(manual.evidenceId), token).statusCode());
        assertEquals(List.of(manual.evidenceId), state.config.reviews().get(ownFunction).validationEvidenceIds());
        assertEquals(200, post("/api/requirement", "operation=" + encode(operation) + "&role=USER", token).statusCode());
        assertEquals(io.flowscope.core.ReviewDecision.Status.UNRESOLVED,
                state.config.reviewStatus(ownFunction, state.config.reviews().get(ownFunction).evidenceIds()));
        assertEquals(io.flowscope.core.ReviewDecision.Status.CONFIRMED, state.config.reviews().get(ownFunction).status());
    }

    @Test
    void restrictsOwnersToSameServiceIdentities() throws Exception {
        start();
        RequestRecord record = state.snapshot().records.getFirst();
        state.config.upsertAccount(new AccountProfile("same", "Same", record.service, AccessRole.USER));
        state.config.upsertAccount(new AccountProfile("foreign", "Foreign", "https://foreign.test", AccessRole.USER));
        String body = "resource=" + encode(record.resource) + "&identity=";
        for (String invalid : List.of("public", "other", "foreign", "unknown-owner")) {
            assertEquals(400, post("/api/owner", body + invalid, token).statusCode());
        }
        assertEquals(200, post("/api/owner", body + "same", token).statusCode(), "owner need not have an active login session");
        assertEquals("same", state.config.resourceOwners().get(record.resource));
        assertEquals(200, post("/api/owner", body, token).statusCode());
        assertFalse(state.config.resourceOwners().containsKey(record.resource));
        assertTrue(json(get("/api/manual-attempts", token, origin())).isArray());
    }

    @Test
    void accountSettingsCombinesSafeRuntimeStateAndPersistsOnlyTheProofRule() throws Exception {
        start();
        String accountId = json(post("/api/account-save",
                "label=USER+A&role=User&target=" + encode(state.record.service), token)).path("id").asText();

        JsonNode initial = json(get("/api/account-settings?account=" + encode(accountId), token, origin()));
        assertEquals(accountId, initial.path("id").asText());
        assertEquals("NONE", initial.at("/human/verificationSource").asText());
        assertFalse(initial.toString().contains("raw-session-secret"));
        assertEquals("", initial.at("/zap/loginId").asText());
        assertEquals("", initial.at("/llm/loginId").asText());
        assertEquals(1, initial.path("candidates").size());

        JsonNode saved = json(post("/api/account-settings", "action=save-proof&account=" + encode(accountId)
                + "&method=GET&path=" + encode("/v1/orders/7") + "&subject=" + encode("\"id\":7"), token));
        assertEquals("/v1/orders/7", saved.at("/proofRule/path").asText());
        assertEquals("\"id\":7", state.config.verificationRule(accountId).orElseThrow().expectedSubject());

        String candidateId = saved.at("/candidates/0/id").asText();
        assertEquals(200, post("/api/account-settings", "action=link-candidate&account=" + encode(accountId)
                + "&candidate=" + encode(candidateId), token).statusCode());
        assertEquals(candidateId, state.linkedCandidateId);

        JsonNode cleared = json(post("/api/account-settings", "action=save-proof&account=" + encode(accountId)
                + "&method=&path=&subject=", token));
        assertTrue(cleared.at("/proofRule/path").asText().isBlank());
        assertTrue(state.config.verificationRule(accountId).isEmpty());
    }

    @Test
    void opensEditedRequestWithSelectedCredentialsAsAnUnsentRepeaterDraft() throws Exception {
        start();
        String evidenceId = state.snapshot().records.getFirst().evidenceId;
        String edited = "GET /v1/orders/8 HTTP/1.1\r\nHost: api.example.test\r\n\r\n";
        assertEquals(200, post("/api/replay", "eventId=" + encode(evidenceId)
                + "&credentialMode=ORIGINAL&accountId=&request=" + encode(edited), token).statusCode());
        assertEquals(FlowScopeWebServer.CredentialMode.ORIGINAL, state.repeaterCredentialMode);
        JsonNode response = json(post("/api/replay", "eventId=" + encode(evidenceId)
                + "&credentialMode=ACCOUNT&accountId=owner&request=" + encode(edited), token));
        assertTrue(response.path("openedDraft").asBoolean());
        assertTrue(state.opened.get());
        assertEquals(edited, state.repeaterRequest);
        assertEquals(FlowScopeWebServer.CredentialMode.ACCOUNT, state.repeaterCredentialMode);
        assertEquals("owner", state.repeaterAccountId);
        assertEquals("", response.path("replayId").asText());
    }

    @Test
    void authorizationReplayForwardsOneRunArmingAndExposesAKillSwitch() throws Exception {
        start();

        JsonNode unarmed = json(post("/api/authorization-replay",
                "action=run&itemId=matrix-item&armed=false", token));
        assertFalse(unarmed.path("run").path("armed").asBoolean());
        assertEquals(0, unarmed.path("run").path("sent").asInt());
        assertEquals("matrix-item", state.authorizationReplayItemId);
        assertFalse(state.authorizationReplayArmed);

        JsonNode armed = json(post("/api/authorization-replay",
                "action=run&itemId=matrix-item&armed=true", token));
        assertTrue(armed.path("run").path("armed").asBoolean());
        assertEquals(1, armed.path("run").path("sent").asInt());
        assertTrue(state.authorizationReplayArmed);
        assertFalse(armed.toString().contains("raw-replay-secret"));

        JsonNode killed = json(post("/api/authorization-replay", "action=kill", token));
        assertTrue(killed.path("success").asBoolean());
        assertTrue(state.authorizationReplayKilled);
    }

    @Test
    void liveAuthorizationReplayApiRequiresArmingAndReturnsCredentialFreeStatus() throws Exception {
        start();

        assertEquals(400, post("/api/authorization-replay",
                "action=start-live&accounts=user-b%2Cadmin&anonymous=true&armed=false", token).statusCode());
        JsonNode started = json(post("/api/authorization-replay",
                "action=start-live&accounts=user-b%2Cadmin&anonymous=true&sources=HUMAN%2CZAP%2CLLM&armed=true",
                token));
        assertEquals("ACTIVE", started.path("live").path("state").asText());
        assertEquals(List.of("user-b", "admin"), JSON.convertValue(
                started.path("live").path("targetAccountIds"),
                JSON.getTypeFactory().constructCollectionType(List.class, String.class)));
        assertTrue(started.path("live").path("includeAnonymous").asBoolean());
        assertEquals(List.of("HUMAN", "SCANNER", "LLM"), JSON.convertValue(
                started.path("live").path("basisSources"),
                JSON.getTypeFactory().constructCollectionType(List.class, String.class)));
        assertFalse(started.toString().contains("raw-live-secret"));

        assertEquals(400, post("/api/authorization-replay",
                "action=start-live&accounts=user-b&sources=IMPORT&armed=true", token).statusCode());

        JsonNode status = json(get("/api/authorization-replay", token, origin()));
        assertEquals("ACTIVE", status.path("live").path("state").asText());
        JsonNode stopped = json(post("/api/authorization-replay", "action=stop-live", token));
        assertEquals("STOPPED", stopped.path("live").path("state").asText());
        assertTrue(state.liveAuthorizationReplayStopped);
    }

    @Test
    void previewsLiveRequestLabCredentialsWithoutSendingOrCachingAndKeepsTheLocalBoundary() throws Exception {
        start();
        String evidenceId = state.snapshot().records.getFirst().evidenceId;
        String form = "datasetRevision=" + state.datasetRevision() + "&eventId=" + encode(evidenceId) + "&credentialMode=ACCOUNT&accountId=user-a&request="
                + encode("GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test\r\n\r\n");
        assertEquals(403, post("/api/request-lab/credentials", form, "wrong-token").statusCode());
        assertEquals(405, get("/api/request-lab/credentials", token, origin()).statusCode());
        assertEquals(400, post("/api/request-lab/credentials", form.replace("accountId=user-a", "accountId="), token).statusCode());
        assertEquals(400, post("/api/request-lab/credentials", form.replace("credentialMode=ACCOUNT", "credentialMode=OTHER"), token).statusCode());
        assertEquals(400, post("/api/request-lab/credentials", "datasetRevision=" + state.datasetRevision() + "&eventId=" + encode(evidenceId)
                + "&credentialMode=ANONYMOUS&request=" + encode("x".repeat(1_048_577)), token).statusCode());
        assertEquals(400, post("/api/request-lab/credentials", form.replace("datasetRevision=" + state.datasetRevision(), "datasetRevision=-1"), token).statusCode());
        assertEquals(0, state.credentialPreviewCount);
        HttpResponse<String> preview = post("/api/request-lab/credentials", form, token);
        assertEquals(200, preview.statusCode(), preview.body());
        assertEquals("no-store", preview.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("live-preview-secret", json(preview).path("headers").get(0).path("value").asText());
        assertEquals(1, state.credentialPreviewCount);
        assertEquals(0, state.manualRequestCount.get());
        assertFalse(state.opened.get());
        assertFalse(get("/api/snapshot", token, origin()).body().contains("live-preview-secret"));
        assertFalse(get("/api/manual-attempts", token, origin()).body().contains("live-preview-secret"));
        state.rejectCredentialPreview = true;
        HttpResponse<String> rejected = post("/api/request-lab/credentials", form, token);
        assertEquals(400, rejected.statusCode());
        assertFalse(rejected.body().contains("live-preview-secret"));
        assertTrue(rejected.body().contains("scope"));
        state.rejectCredentialPreview = false;
        state.changeDatasetDuringPreview = true;
        HttpResponse<String> replaced = post("/api/request-lab/credentials", form, token);
        assertEquals(400, replaced.statusCode());
        assertFalse(replaced.body().contains("live-preview-secret"));
    }

    @Test
    void opensAndSendsAnExplicitRawRequestLabDraftWithoutPuttingItInSnapshot() throws Exception {
        start();
        String evidenceId = state.snapshot().records.getFirst().evidenceId;

        JsonNode draft = json(get("/api/request-lab?eventId=" + encode(evidenceId), token, origin()));
        assertEquals(evidenceId, draft.path("eventId").asText());
        assertEquals(state.record.service, draft.path("service").asText());
        assertTrue(draft.path("request").asText().contains("raw-session-secret"));
        assertTrue(draft.path("rawRequestRetained").asBoolean());
        assertTrue(draft.path("requestEditable").asBoolean());
        assertEquals("UTF-8", draft.path("requestCharset").asText());
        assertEquals("USER A", draft.path("observedIdentity").asText());
        assertEquals("없음", draft.path("reusableSession").asText());
        assertFalse(json(get("/api/snapshot", token, origin())).toString().contains("raw-session-secret"));

        String editedRequest = "POST /v1/orders/8 HTTP/1.1\r\nHost: api.example.test\r\n"
                + "Cookie: edited-secret\r\nContent-Type: text/plain\r\n\r\n" + "x".repeat(3_000);
        String operationId = "request-lab-operation-0001";
        HttpResponse<String> sent = post("/api/request-lab", "action=send&operationId=" + operationId
                + "&eventId=" + encode(evidenceId)
                + "&credentialMode=ANONYMOUS&accountId=&request="
                + encode(editedRequest), token);
        assertEquals(200, sent.statusCode(), sent.body());
        JsonNode result = JSON.readTree(sent.body());
        assertEquals(204, result.path("status").asInt());
        assertEquals("ev-manual", result.path("eventId").asText());
        assertEquals("ANONYMOUS", state.manualCredentialMode.name());
        assertTrue(state.manualRequest.contains("edited-secret"));
        assertEquals(editedRequest, state.manualRequest);
        assertTrue(result.path("response").asText().contains("204 No Content"));

        HttpResponse<String> duplicate = post("/api/request-lab", "action=send&operationId=" + operationId
                + "&eventId=" + encode(evidenceId) + "&credentialMode=ANONYMOUS&accountId=&request="
                + encode(editedRequest), token);
        assertEquals(200, duplicate.statusCode());
        assertEquals(1, state.manualRequestCount.get());

        HttpResponse<String> collision = post("/api/request-lab", "action=send&operationId=" + operationId
                + "&eventId=" + encode(evidenceId) + "&credentialMode=ANONYMOUS&accountId=&request="
                + encode(editedRequest + "changed"), token);
        assertEquals(400, collision.statusCode());
        assertEquals(1, state.manualRequestCount.get());
    }

    @Test
    void concurrentRequestLabRetriesJoinOneServerExecution() throws Exception {
        start();
        state.blockManualRequest = true;
        String evidenceId = state.snapshot().records.getFirst().evidenceId;
        String operationId = "request-lab-concurrent-0001";
        String body = "action=send&operationId=" + operationId
                + "&eventId=" + encode(evidenceId)
                + "&credentialMode=ANONYMOUS&accountId=&request="
                + encode("POST /v1/orders/8 HTTP/1.1\r\nHost: api.example.test\r\n\r\nx");
        HttpRequest request = HttpRequest.newBuilder(URI.create(
                        server.url().substring(0, server.url().length() - 1) + "/api/request-lab"))
                .header("X-FlowScope-Token", token)
                .header("Origin", origin())
                .header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        java.util.concurrent.CompletableFuture<HttpResponse<String>> first =
                client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        assertTrue(state.manualRequestEntered.await(2, java.util.concurrent.TimeUnit.SECONDS));
        java.util.concurrent.CompletableFuture<HttpResponse<String>> duplicate =
                client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        state.manualRequestRelease.countDown();

        assertEquals(200, first.get(2, java.util.concurrent.TimeUnit.SECONDS).statusCode());
        assertEquals(200, duplicate.get(2, java.util.concurrent.TimeUnit.SECONDS).statusCode());
        assertEquals(1, state.manualRequestCount.get());
    }

    @Test
    void snapshotIsLightweightAndObjectlessEvidenceLoadsMaskedOnDemand() throws Exception {
        RequestRecord health = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/health", 200, "sess:health");
        health.reqText = "GET /health HTTP/1.1\r\nHost: api.example.test\r\nCookie: session=raw-secret";
        health.respText = "HTTP/1.1 200 OK\r\nSet-Cookie: session=response-secret\r\n\r\n{\"token\":\"body-secret\"}";
        health.body = "{\"token\":\"body-secret\"}";
        health.hasResponse = true;
        state.records.add(health);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        JsonNode event = snapshot.path("events").findValuesAsText("path").contains("/health")
                ? java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                        .filter(value -> value.path("path").asText().equals("/health")).findFirst().orElseThrow()
                : fail("objectless event missing");
        assertTrue(event.path("resource").isNull());
        assertFalse(event.has("reqText"));
        assertFalse(event.has("respText"));
        assertFalse(snapshot.toString().contains("raw-secret"));

        JsonNode evidence = json(get("/api/evidence?operation=" + encode(event.path("op").asText()), token, origin()));
        assertEquals(1, evidence.path("total").asInt());
        assertFalse(evidence.path("hasMore").asBoolean());
        assertTrue(evidence.at("/records/0/request").asText().contains("session=***"));
        assertTrue(evidence.at("/records/0/response").asText().contains("session=***"));
        assertFalse(evidence.toString().contains("body-secret"));
    }

    @Test
    void boundsEvidenceDetailAndReportsPaginationHonestly() throws Exception {
        for (int i = 0; i < 205; i++) {
            RequestRecord copy = new RequestRecord(Source.HUMAN, state.record.service,
                    "GET", "/v1/orders/7", 200, "sess:page-" + i);
            copy.reqText = "GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test";
            copy.respText = "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}";
            copy.requestPayload = state.record.requestPayload;
            copy.responsePayload = state.record.responsePayload;
            copy.body = "{\"id\":7}";
            copy.hasResponse = true;
            copy.timestamp = i + 2L;
            state.records.add(copy);
        }
        state.rebuild();
        start();

        JsonNode first = json(get("/api/evidence?operation=" + encode(state.record.op), token, origin()));
        assertEquals(206, first.path("total").asInt());
        assertEquals(200, first.path("records").size());
        assertTrue(first.path("hasMore").asBoolean());

        JsonNode second = json(get("/api/evidence?operation=" + encode(state.record.op)
                + "&offset=200&limit=200", token, origin()));
        assertEquals(6, second.path("records").size());
        assertFalse(second.path("hasMore").asBoolean());

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        JsonNode clustered = java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                .filter(value -> value.path("repeatCount").asInt() == 206).findFirst().orElseThrow();
        assertFalse(clustered.has("clusterEvidenceIds"));
        JsonNode clusterFirst = json(get("/api/cluster-evidence?clusterId="
                + encode(clustered.path("clusterId").asText()), token, origin()));
        assertEquals(206, clusterFirst.path("total").asInt());
        assertEquals(200, clusterFirst.path("evidenceIds").size());
        assertTrue(clusterFirst.path("hasMore").asBoolean());
        JsonNode clusterSecond = json(get("/api/cluster-evidence?clusterId="
                + encode(clustered.path("clusterId").asText()) + "&offset=200", token, origin()));
        assertEquals(6, clusterSecond.path("evidenceIds").size());
        assertFalse(clusterSecond.path("hasMore").asBoolean());
    }

    private void start() throws Exception {
        server = new FlowScopeWebServer(state, 0);
        server.start();
        String html = get("/", null, null).body();
        var matcher = Pattern.compile("name=\"flowscope-capability\" content=\"([0-9a-f]{64})\"").matcher(html);
        assertTrue(matcher.find());
        token = matcher.group(1);
    }

    private void activateSession(String accountId, String token) {
        AccountProfile account = state.config.account(accountId).orElseThrow();
        String handle = state.sessions.beginCapture(account, java.time.Instant.EPOCH);
        state.sessions.observeRequest(handle, URI.create(state.record.service + "/login"),
                Map.of("Authorization", "Bearer " + token), java.time.Instant.EPOCH);
        state.sessions.observeResponse(handle, URI.create(state.record.service + "/me"), 200, null,
                "{\"id\":\"" + accountId + "\"}", List.of(), java.time.Instant.EPOCH);
        state.sessions.endCapture(handle);
    }

    private HttpResponse<String> get(String path, String capability, String origin) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path)).GET();
        if (capability != null) request.header("X-FlowScope-Token", capability);
        if (origin != null) request.header("Origin", origin);
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> head(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path))
                .method("HEAD", HttpRequest.BodyPublishers.noBody()).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    private void assertStaticHeadMatchesGet(String path) throws Exception {
        RawHttpResponse getResponse = rawRequest("GET", path);
        RawHttpResponse headResponse = rawRequest("HEAD", path);

        assertEquals(getResponse.status(), headResponse.status());
        assertEquals(getResponse.contentLength(), headResponse.contentLength());
        assertArrayEquals(new byte[0], headResponse.body());
    }

    private RawHttpResponse rawRequest(String method, String path) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", server.port())) {
            OutputStream output = socket.getOutputStream();
            output.write((method + " " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + server.port()
                    + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            output.flush();
            byte[] response = socket.getInputStream().readAllBytes();
            int separator = headerSeparator(response);
            assertTrue(separator >= 0, "response must contain HTTP headers");
            String headers = new String(response, 0, separator, StandardCharsets.ISO_8859_1);
            String[] lines = headers.split("\\r\\n");
            int status = Integer.parseInt(lines[0].split(" ")[1]);
            String contentLength = java.util.Arrays.stream(lines)
                    .filter(line -> line.regionMatches(true, 0, "Content-Length: ", 0, "Content-Length: ".length()))
                    .findFirst().orElseThrow().substring("Content-Length: ".length());
            return new RawHttpResponse(status, contentLength,
                    java.util.Arrays.copyOfRange(response, separator + 4, response.length));
        }
    }

    private static int headerSeparator(byte[] response) {
        for (int i = 0; i <= response.length - 4; i++) {
            if (response[i] == '\r' && response[i + 1] == '\n' && response[i + 2] == '\r' && response[i + 3] == '\n') {
                return i;
            }
        }
        return -1;
    }

    private record RawHttpResponse(int status, String contentLength, byte[] body) {}

    private HttpResponse<String> post(String path, String body, String capability) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path))
                .header("X-FlowScope-Token", capability)
                .header("Origin", origin())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postRaw(String path, String body, String contentType, String capability) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path))
                .header("X-FlowScope-Token", capability)
                .header("Origin", origin())
                .header("Content-Type", contentType)
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String origin() { return server.url().substring(0, server.url().length() - 1); }
    private static JsonNode json(HttpResponse<String> response) throws Exception {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private static List<String> viteAssetUrls(String html) {
        var matcher = Pattern.compile("(?:src|href)=\"\\./assets/([^\"]+)\"").matcher(html);
        List<String> paths = new ArrayList<>();
        while (matcher.find()) paths.add("/app/assets/" + matcher.group(1));
        return paths;
    }

    private static final class TestState implements FlowScopeWebServer.State {
        private final AnalysisConfig config = new AnalysisConfig();
        private final List<RequestRecord> records = new ArrayList<>();
        private final AtomicLong revision = new AtomicLong();
        private final AtomicBoolean opened = new AtomicBoolean();
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final SessionBroker sessions = new SessionBroker();
        private final ZapAccountVault zapAccounts = new ZapAccountVault();
        private final RequestRecord record;
        private volatile String scannerTarget = "";
        private volatile List<String> scannerScope;
        private volatile List<String> scannerAccounts = List.of();
        private volatile boolean scannerAnonymous;
        private volatile int observedHumanPort = -1;
        private volatile int otherHumanPort = -1;
        private volatile long otherHumanRequests;
        private volatile boolean scannerCancelled;
        private volatile ZapAccountVault.Input lastZapAccountInput;
        private volatile String refreshedZapSessionAccountId = "";
        private volatile String linkedCandidateId = "";
        private final List<ExplorerAccountVault.View> explorerAccounts = new ArrayList<>();
        private volatile ExplorerCoordinator.Snapshot explorerRun = new ExplorerCoordinator.Snapshot(
                ExplorerCoordinator.Status.IDLE, "", "", null, null, 0, "Explorer 실행 대기", "READY",
                List.of(), false, 0, 0, 0, 0, 0, List.of(), List.of());
        private volatile int explorerReadinessChecks;
        private volatile String manualRequest = "";
        private volatile FlowScopeWebServer.CredentialMode manualCredentialMode;
        private volatile int credentialPreviewCount;
        private volatile boolean rejectCredentialPreview;
        private volatile boolean changeDatasetDuringPreview;
        private volatile String repeaterRequest = "";
        private volatile FlowScopeWebServer.CredentialMode repeaterCredentialMode;
        private volatile String repeaterAccountId = "";
        private volatile String authorizationReplayItemId = "";
        private volatile boolean authorizationReplayArmed;
        private volatile boolean authorizationReplayKilled;
        private volatile boolean liveAuthorizationReplayStopped;
        private volatile LiveCrossIdentityReplayCoordinator.Snapshot liveAuthorizationReplay =
                new LiveCrossIdentityReplayCoordinator.Snapshot("",
                        LiveCrossIdentityReplayCoordinator.State.STOPPED, false, List.of(), false,
                        0, 0, 0, 0, 0, 0, "NOT_STARTED");
        private final java.util.concurrent.atomic.AtomicInteger manualRequestCount =
                new java.util.concurrent.atomic.AtomicInteger();
        private volatile boolean blockManualRequest;
        private final java.util.concurrent.CountDownLatch manualRequestEntered =
                new java.util.concurrent.CountDownLatch(1);
        private final java.util.concurrent.CountDownLatch manualRequestRelease =
                new java.util.concurrent.CountDownLatch(1);
        private volatile Pipeline.Result result;
        private volatile String startedProjectScope = "";
        private volatile String deletedProjectId = "";
        private volatile String updatedProject = "";
        private volatile ProjectWorkspace.Status projectStatus = new ProjectWorkspace.Status("/tmp/projects",
                null, List.of());
        private GraphWorkspace graphWorkspace = GraphWorkspace.empty();
        private RequestLabWorkspace requestLabWorkspace = RequestLabWorkspace.empty();
        private long graphRevision;
        private final List<RouteCandidate> routeCandidates = List.of(new RouteCandidate(
                "https://api.example.test:443", "UNKNOWN", "/v1/admin", false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.HTML_LINK,
                        "ev-route", Source.HUMAN, "human-run", "html-dom")),
                RouteCandidate.Applicability.REVIEW, "HTML 링크는 method를 증명하지 않음"));

        TestState() {
            record = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                    "GET", "/v1/orders/7", 200, "sess:abcdef123456");
            record.reqText = "GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test\r\nCookie: [masked]";
            record.respText = "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}";
            record.requestPayload = StoredPayload.capture(record.reqText, "", 1024 * 1024);
            record.responsePayload = StoredPayload.capture(record.respText, "", 1024 * 1024);
            record.body = "{\"id\":7}";
            record.hasResponse = true;
            record.timestamp = 1;
            records.add(record);
            scannerScope = List.of(record.service + "/");
            rebuild();
        }

        @Override public Pipeline.Result snapshot() { return result; }
        @Override public long revision() { return revision.get(); }
        @Override public GraphWorkspace.State graphWorkspace() {
            return new GraphWorkspace.State(datasetRevision(), graphRevision, graphWorkspace);
        }
        @Override public GraphWorkspace.State updateGraphWorkspace(long dataset, long expectedRevision, GraphWorkspace.Change change) {
            if (dataset != datasetRevision() || expectedRevision != graphRevision) throw new IllegalStateException("stale graph workspace");
            graphWorkspace = change.apply(graphWorkspace);
            graphRevision++;
            return graphWorkspace();
        }
        @Override public RequestLabWorkspace.State requestLabWorkspace(String evidenceId) {
            return new RequestLabWorkspace.State(datasetRevision(), requestLabWorkspace.revision(), true, requestLabWorkspace.tab(evidenceId));
        }
        @Override public RequestLabWorkspace.State updateRequestLabWorkspace(String evidenceId, long dataset, long expectedRevision, RequestLabWorkspace.Change change) {
            if (dataset != datasetRevision() || expectedRevision != requestLabWorkspace.revision()) throw new IllegalStateException("stale Request Lab workspace");
            requestLabWorkspace = change.apply(requestLabWorkspace, evidenceId);
            return requestLabWorkspace(evidenceId);
        }
        @Override public AnalysisConfig config() { return config; }
        private List<LegacyAssessment> archivedAssessments = List.of();
        private List<ValidationDecision> archivedValidations = List.of();
        @Override public List<LegacyAssessment> assessments() { return archivedAssessments; }
        @Override public List<ValidationDecision> validations() { return archivedValidations; }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public int humanListenerPort(String runId) { return observedHumanPort; }
        @Override public int otherHumanListenerPort(String runId) { return otherHumanPort; }
        @Override public long otherHumanListenerRequests(String runId) { return otherHumanRequests; }
        @Override public SessionBroker sessions() { return sessions; }
        @Override public List<FlowScopeWebServer.AccountRequestCandidate> accountRequestCandidates(String accountId) {
            return List.of(new FlowScopeWebServer.AccountRequestCandidate(record.evidenceId, 200, "GET",
                    "/v1/orders/7", "application/json", true, false, true, true, "연결 가능",
                    "GET /v1/orders/7 HTTP/1.1\r\nCookie: ***MASKED***", "HTTP/1.1 200 OK"));
        }
        @Override public void linkAccountRequestCandidate(String accountId, String evidenceId) {
            linkedCandidateId = evidenceId;
        }
        @Override public List<ZapAccountVault.View> zapAccounts() { return zapAccounts.views(); }
        @Override public java.util.Optional<ZapAccountVault.Credentials> zapCredentials(String accountId) {
            return zapAccounts.credentials(accountId);
        }
        @Override public ZapAccountVault.View saveZapAccount(ZapAccountVault.Input input) {
            lastZapAccountInput = input;
            return zapAccounts.save(input);
        }
        @Override public void removeZapAccount(String id) { zapAccounts.remove(id); }
        @Override public JsonNode refreshAccountSession(String id) {
            refreshedZapSessionAccountId = id;
            return JSON.createObjectNode().put("status", "RUNNING").put("stage", "AUTHENTICATION");
        }
        @Override public List<String> scopeEntries() { return scannerScope; }
        @Override public ProjectWorkspace.Status projectStatus() { return projectStatus; }
        @Override public ProjectWorkspace.Status startProject(String name, String scope) {
            startedProjectScope = scope;
            ProjectWorkspace.Entry entry = new ProjectWorkspace.Entry("target-a", name,
                    List.of(scope), "2026-09-10T00:00:00Z", 1, 100, true, true, true);
            projectStatus = new ProjectWorkspace.Status("/tmp/projects", entry, List.of(entry));
            return projectStatus;
        }
        @Override public ProjectWorkspace.Status openProject(String id) { return projectStatus; }
        @Override public ProjectWorkspace.Status updateProject(String name, String scope) {
            updatedProject = name + "|" + scope;
            return projectStatus;
        }
        @Override public ProjectWorkspace.Status resetProjectTraffic() {
            records.clear();
            rebuild();
            return projectStatus;
        }
        @Override public ProjectWorkspace.Status deleteProject(String id) {
            deletedProjectId = id;
            return projectStatus;
        }
        @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
        @Override public JsonNode startScanner(String target, List<String> accountIds, boolean includeAnonymous) {
            scannerTarget = target;
            scannerAccounts = List.copyOf(accountIds);
            scannerAnonymous = includeAnonymous;
            return JSON.createObjectNode().put("status", "RUNNING").put("stage", "CLIENT_SPIDER");
        }
        @Override public JsonNode scannerStatus() {
            return JSON.createObjectNode().put("status", "NOT_STARTED");
        }
        @Override public JsonNode cancelScanner() {
            scannerCancelled = true;
            return JSON.createObjectNode().put("status", "CANCELLED");
        }
        @Override public ExplorerCoordinator.Snapshot explorerStatus() { return explorerRun; }
        @Override public List<ExplorerAccountVault.View> explorerAccounts() { return List.copyOf(explorerAccounts); }
        @Override public ExplorerAccountVault.View openExplorerBrowserLogin(String id, String url) {
            ExplorerAccountVault.View value = new ExplorerAccountVault.View(id, "A", "USER", url,
                    ExplorerAccountVault.AuthStatus.NEEDS_INPUT, "로그인 대기",
                    java.time.Instant.now().toString(), 0, List.of(), true);
            explorerAccounts.add(value);
            return value;
        }
        @Override public ExplorerAccountVault.View completeExplorerBrowserLogin(String id) {
            // The real vault exposes header names only; "session-secret" stands for a value that must not leak.
            ExplorerAccountVault.View value = new ExplorerAccountVault.View(id, "A", "USER", "",
                    ExplorerAccountVault.AuthStatus.READY, "브라우저 로그인 세션 (사용자 확인)",
                    java.time.Instant.now().toString(), 1, List.of("Authorization"), true);
            explorerAccounts.clear();
            explorerAccounts.add(value);
            return value;
        }
        @Override public ExplorerCoordinator.Snapshot startExplorer(ExplorerCoordinator.StartRequest request) {
            explorerRun = new ExplorerCoordinator.Snapshot(ExplorerCoordinator.Status.RUNNING, "llm-test-run",
                    request.target(), java.time.Instant.now(), null, 0, "탐색 중", "READY",
                    request.accountIds(), request.includeAnonymous(), 0, 0, 0, 0, 0, List.of(), List.of(), request.model());
            return explorerRun;
        }
        @Override public io.flowscope.explorer.ExplorerProvider.ModelCatalog explorerModels() {
            return new io.flowscope.explorer.ExplorerProvider.ModelCatalog("gpt-5.6-sol", List.of(
                    new io.flowscope.explorer.ExplorerProvider.ModelOption("gpt-5.6-sol", "GPT-5.6 Sol", false),
                    new io.flowscope.explorer.ExplorerProvider.ModelOption("gpt-6.1-sol", "GPT-6.1 Sol", true)));
        }
        @Override public ExplorerCoordinator.Snapshot recheckExplorerProvider() {
            explorerReadinessChecks++;
            return explorerRun;
        }




        @Override public void rebuild() { result = Pipeline.run(new ArrayList<>(records), config); revision.incrementAndGet(); }
        @Override public Pipeline.Result completionSnapshot() { rebuild(); return result; }
        @Override public void loadSample() { }
        @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
            BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
            records.addAll(parsed.records);
            rebuild();
            return parsed;
        }
        @Override public BurpXmlParser.ParseResult importHar(byte[] har) {
            BurpXmlParser.ParseResult parsed = HarParser.parseDetailed(har);
            BurpXmlParser.retainInScope(parsed, ScopePolicy.parse(String.join("\n", scannerScope)));
            records.addAll(parsed.records);
            rebuild();
            return parsed;
        }
        @Override public RequestRecord openInRepeater(String evidenceId, String request,
                                                      FlowScopeWebServer.CredentialMode credentialMode,
                                                      String accountId) {
            RequestRecord value = result.records.stream().filter(item -> item.evidenceId.equals(evidenceId)).findFirst().orElseThrow();
            opened.set(true);
            repeaterRequest = request;
            repeaterCredentialMode = credentialMode;
            repeaterAccountId = accountId;
            return value;
        }
        @Override public FlowScopeWebServer.RequestLabDraft requestLabDraft(String evidenceId) {
            RequestRecord value = result.records.stream().filter(item -> item.evidenceId.equals(evidenceId))
                    .findFirst().orElseThrow();
            return new FlowScopeWebServer.RequestLabDraft(value.evidenceId, value.service,
                    "GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test\r\nCookie: raw-session-secret\r\n\r\n",
                    "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}", true, true, true,
                    "UTF-8", "UTF-8", "USER A", "없음", "", "메모리 원문");
        }
        @Override public List<FlowScopeWebServer.RequestLabCredentialHeader> requestLabCredentials(
                String evidenceId, String request, FlowScopeWebServer.CredentialMode mode, String accountId) {
            credentialPreviewCount++;
            if (rejectCredentialPreview) throw new IllegalStateException("live-preview-secret");
            if (changeDatasetDuringPreview) revision.incrementAndGet();
            return List.of(new FlowScopeWebServer.RequestLabCredentialHeader("Cookie", "live-preview-secret"));
        }
        @Override public FlowScopeWebServer.RequestLabResult sendRequestLab(String evidenceId, String request,
                                                                            FlowScopeWebServer.CredentialMode mode,
                                                                            String accountId) {
            manualRequest = request;
            manualCredentialMode = mode;
            manualRequestCount.incrementAndGet();
            if (blockManualRequest) {
                manualRequestEntered.countDown();
                try {
                    if (!manualRequestRelease.await(2, java.util.concurrent.TimeUnit.SECONDS)) {
                        throw new IllegalStateException("manual request release timeout");
                    }
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("manual request interrupted", error);
                }
            }
            return new FlowScopeWebServer.RequestLabResult("ev-manual", 204,
                    "HTTP/1.1 204 No Content\r\n\r\n", 17, request.length(), 27);
        }
        @Override public CrossIdentityReplayOrchestrator.RunResult runAuthorizationReplay(
                String itemId, boolean armed) {
            authorizationReplayItemId = itemId;
            authorizationReplayArmed = armed;
            int sent = armed ? 1 : 0;
            int skipped = armed ? 0 : 1;
            CrossIdentityReplayOrchestrator.Outcome outcome = armed
                    ? CrossIdentityReplayOrchestrator.Outcome.SENT
                    : CrossIdentityReplayOrchestrator.Outcome.SKIPPED_UNARMED;
            FlowScopeWebServer.RequestLabResult rawResult = armed
                    ? new FlowScopeWebServer.RequestLabResult("ev-replay", 200,
                    "raw-replay-secret", 1, 1, 1) : null;
            return new CrossIdentityReplayOrchestrator.RunResult("authorization-replay-test", armed,
                    sent, 0, skipped, List.of(new CrossIdentityReplayOrchestrator.Item(
                    "GET /api/orders/{id}", "user-b", "user-a", "ev-basis", outcome,
                    rawResult, armed ? "CONTROLLED_RESPONSE_RECORDED" : "RUN_NOT_ARMED")));
        }
        @Override public void killAuthorizationReplay() { authorizationReplayKilled = true; }
        @Override public LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                List<String> accountIds, boolean anonymous, boolean armed) {
            return startLiveAuthorizationReplay(accountIds, anonymous, List.of(Source.HUMAN), armed);
        }
        @Override public LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                List<String> accountIds, boolean anonymous, List<Source> basisSources, boolean armed) {
            if (!armed) throw new IllegalArgumentException("approval required");
            liveAuthorizationReplay = new LiveCrossIdentityReplayCoordinator.Snapshot(
                    "live-test", LiveCrossIdentityReplayCoordinator.State.ACTIVE, true,
                    accountIds, anonymous, 0, 0, 0, 0, 0, 0, "ARMED", basisSources);
            return liveAuthorizationReplay;
        }
        @Override public LiveCrossIdentityReplayCoordinator.Snapshot liveAuthorizationReplayStatus() {
            return liveAuthorizationReplay;
        }
        @Override public LiveCrossIdentityReplayCoordinator.Snapshot stopLiveAuthorizationReplay() {
            liveAuthorizationReplayStopped = true;
            liveAuthorizationReplay = new LiveCrossIdentityReplayCoordinator.Snapshot(
                    liveAuthorizationReplay.runId(), LiveCrossIdentityReplayCoordinator.State.STOPPED,
                    false, liveAuthorizationReplay.targetAccountIds(), liveAuthorizationReplay.includeAnonymous(),
                    liveAuthorizationReplay.observed(), liveAuthorizationReplay.eligible(),
                    liveAuthorizationReplay.queued(), liveAuthorizationReplay.sent(),
                    liveAuthorizationReplay.drafted(), liveAuthorizationReplay.skipped(), "STOPPED_BY_OPERATOR");
            return liveAuthorizationReplay;
        }

        private void addHumanEvidence(String runId, String accountId) {
            RequestRecord evidence = new RequestRecord(Source.HUMAN, record.service,
                    "GET", "/v1/human-pass", 200, accountId == null ? "anon" : accountId);
            evidence.hasResponse = true;
            evidence.body = "{\"ok\":true}";
            evidence.sourceDetail = SourceDetail.BROWSER;
            evidence.orchestrator = Orchestrator.HUMAN;
            evidence.tool = ToolKind.BROWSER;
            evidence.phase = RunPhase.EXPLORATION;
            evidence.runId = runId;
            evidence.executionTrust = ExecutionTrust.OBSERVED;
            records.add(evidence);
            rebuild();
        }
    }
}
