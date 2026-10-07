package io.flowscope.explorer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import io.flowscope.integration.ProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** Selected Explorer account survives credential binding changes and project reopen. */
final class ExplorerIdentityAttributionTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SERVICE = "https://app.example.test:443";

    @TempDir Path temp;

    @Test
    void selectedExplorerAccountSurvivesWithoutFingerprintBindingAndProjectReopen() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerAccountVault.View account = vault.register("llm-a", "A", "USER");
        vault.adoptSession(account.id(), java.net.URI.create("https://app.example.test/"), List.of(),
                Map.of("Authorization", "Bearer secret-token"));

        // 1) 계정 선택·인증 준비: 실제 gateway가 선택 계정과 주입 토큰을 transport 요청으로 넘긴다.
        AtomicReference<ExplorerTransport.Request> outgoing = new AtomicReference<>();
        ExplorerTransport transport = request -> {
            outgoing.set(request);
            return new ExplorerTransport.Response(200, request.url(), "", "application/json", Map.of(),
                    "{\"ok\":true}", false, "ev-1", 1, Instant.now());
        };
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> value.startsWith("https://app.example.test/"), "run-1", ignored -> {})) {
            String payload = JSON.createObjectNode().put("account", account.id()).put("method", "GET")
                    .put("url", "https://app.example.test/api/orders").toString();
            assertEquals(200, post(gateway, payload).statusCode());
        }
        ExplorerTransport.Request request = outgoing.get();
        assertEquals(account.id(), request.accountId(), "gateway must forward the selected account as forcedAccountId");
        assertEquals("Bearer secret-token", request.headers().get("Authorization"));

        // 2) transport 계약: forcedAccountId → 지문 → bindSession → Pipeline 계정 신원.
        String fp = Fingerprints.of(request.headers().get("Authorization"), request.headers().get("Cookie"));
        assertNotEquals(Fingerprints.ANONYMOUS, fp);
        assertFalse(fp.contains("secret-token"));
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile(account.id(), "A", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, fp, account.id());

        Pipeline.Result live = Pipeline.run(List.of(explorerRecord(fp, account.id())), config);
        assertEquals(account.id(), live.records.getFirst().idn);
        assertEquals(AuthState.ACCOUNT_BOUND, live.records.getFirst().authState);

        // 3) 선택한 계정은 자격 지문 binding이 없어도 유지된다.
        AnalysisConfig unbound = new AnalysisConfig()
                .upsertAccount(new AccountProfile(account.id(), "A", SERVICE, AccessRole.USER));
        Pipeline.Result withoutBinding = Pipeline.run(List.of(explorerRecord(fp, account.id())), unbound);
        assertEquals(account.id(), withoutBinding.records.getFirst().idn);
        assertEquals(AuthState.ACCOUNT_BOUND, withoutBinding.records.getFirst().authState);

        // 4) 프로젝트 재열기: 저장 → 로드 → Pipeline 재실행에서도 같은 계정으로 다시 귀속된다.
        Path file = temp.resolve("explorer.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, live.records, config, List.of());
        assertFalse(Files.readString(file).contains("secret-token"), "raw token must not be persisted");

        ProjectStore.ProjectData loaded = store.load(file);
        Pipeline.Result reopened = Pipeline.run(loaded.records(), loaded.config());
        assertEquals(account.id(), reopened.records.getFirst().idn);
        assertEquals(AuthState.ACCOUNT_BOUND, reopened.records.getFirst().authState);
        assertEquals(account.id(), loaded.config()
                .boundAccount(SERVICE, loaded.records().getFirst().fp).orElseThrow().id());
    }

    /** FlowScopeExtension의 Explorer transport가 만드는 LLM 레코드 필드를 그대로 재현한다. */
    private static RequestRecord explorerRecord(String fp, String accountId) {
        RequestRecord record = new RequestRecord(Source.LLM, SERVICE, "GET", "/api/orders", 200, fp);
        record.sourceDetail = SourceDetail.LLM_EXPLORER;
        record.orchestrator = Orchestrator.LLM;
        record.tool = ToolKind.CODEX;
        record.phase = RunPhase.EXPLORATION;
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.runId = "run-1";
        record.laneAccountId = accountId;
        record.collectionAccountId = accountId;
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.body = "{\"ok\":true}";
        return record;
    }

    private static HttpResponse<String> post(ExplorerHttpGateway gateway, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(gateway.url()))
                .header("Authorization", "Bearer " + gateway.token()).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }
}
