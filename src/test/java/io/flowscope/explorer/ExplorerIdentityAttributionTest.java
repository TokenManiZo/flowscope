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

/**
 * Explorer 신원 귀속 통합 회귀.
 *
 * <p>고정하는 경로: LLM 계정 선택·인증 준비({@link ExplorerAccountVault}) → 실제 {@link ExplorerHttpGateway}가
 * vault 토큰을 주입해 transport에 넘기는 요청 → 지문 → {@code bindSession} → {@link Pipeline#run} 계정 신원 →
 * {@link ProjectStore} 저장·재열기 뒤 재유도.
 *
 * <p>정직한 경계: FlowScopeExtension의 실제 transport 본문(recordFrom 호출부와 forcedAccountId→fp→bindSession)은
 * Montoya api·records·ledger에 묶인 private 구현이라 여기서 실행하지 않고, 그 본문이 만드는 레코드 필드와
 * bindSession 계약을 그대로 재현한다. 지문은 {@link Fingerprints#of}를 쓰는데, LLM lane에서
 * {@code captureFingerprint(LLM, null, …)}가 이 함수로 환원됨은 {@code io.flowscope.burp.ExplorerFingerprintTest}가
 * 고정한다. 이 테스트가 통과해도 실제 Burp 완주는 별도 운영 gate다. LLM lane은 D-130에 따라 laneAccountId만으로는
 * 귀속되지 않고 지문 binding으로만 귀속되므로 그 경계도 음성 대조로 고정한다.
 */
final class ExplorerIdentityAttributionTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SERVICE = "https://app.example.test:443";

    @TempDir Path temp;

    @Test
    void selectedExplorerAccountBindsThroughFingerprintAndSurvivesProjectReopen() throws Exception {
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

        // 3) 음성 대조(D-130): laneAccountId만 있고 binding이 없으면 LLM lane은 계정 신원을 얻지 못한다.
        AnalysisConfig unbound = new AnalysisConfig()
                .upsertAccount(new AccountProfile(account.id(), "A", SERVICE, AccessRole.USER));
        Pipeline.Result withoutBinding = Pipeline.run(List.of(explorerRecord(fp, account.id())), unbound);
        assertNotEquals(account.id(), withoutBinding.records.getFirst().idn);
        assertNotEquals(AuthState.ACCOUNT_BOUND, withoutBinding.records.getFirst().authState);

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
