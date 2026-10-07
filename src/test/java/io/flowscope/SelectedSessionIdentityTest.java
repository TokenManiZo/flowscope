package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.*;
import io.flowscope.integration.ProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SelectedSessionIdentityTest {
    private static final String SERVICE = "https://api.example.test:443";
    @TempDir Path temp;

    @ParameterizedTest
    @EnumSource(value = Source.class, names = {"HUMAN", "SCANNER", "LLM"})
    void selectedSessionWinsOverRotatingOrOtherAccountsCredentials(Source source) {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("a", "USER A", SERVICE, AccessRole.USER))
                .upsertAccount(new AccountProfile("b", "USER B", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, "sess:shared", "b");
        for (String identity : List.of("anon", "a")) {
            for (String fingerprint : List.of("anon", "unresolved", "ck:tracker", "sess:shared", "tok:rotated")) {
                RequestRecord record = record(source, identity, fingerprint);
                record.laneAccountId = "b"; // Conflicting legacy/credential metadata must never win.
                String raw = record.reqText;
                Pipeline.Result result = Pipeline.runIsolated(List.of(record), config);
                RequestRecord analyzed = result.records.getFirst();
                assertEquals(identity, analyzed.idn);
                assertEquals(identity.equals("anon") ? AuthState.ANONYMOUS : AuthState.ACCOUNT_BOUND,
                        analyzed.authState);
                assertEquals(fingerprint, analyzed.fp);
                assertEquals(raw, analyzed.reqText);
                assertTrue(result.analysis.cells().stream().allMatch(cell -> cell.key().identity().equals(identity)));
                assertEquals("b", config.boundAccount(SERVICE, "sess:shared").orElseThrow().id());
            }
        }
    }

    @Test
    void configuredWebsiteAccountIncludesItsActuallyObservedApiService() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(
                new AccountProfile("a", "USER A", "https://www.example.test:443", AccessRole.USER));
        Pipeline.Result result = Pipeline.run(List.of(record(Source.HUMAN, "a", "ck:tracker")), config);
        var matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        var cell = matrix.functions().stream().filter(value -> value.identity().equals("a")
                && value.operation().startsWith(SERVICE) && !value.evidenceIds().isEmpty()).findFirst().orElseThrow();
        assertTrue(cell.gates().stream().anyMatch(gate -> gate.key().equals("session")
                && gate.state() == AuthorizationMatrix.GateState.PASS));
        assertTrue(matrix.identities().stream().noneMatch(identity -> identity.kind().equals("UNRESOLVED")));
    }

    @Test
    void changingAttributionKeepsEvidenceAndDifferentCardsAreNeverMerged() {
        RequestRecord a = record(Source.HUMAN, "a", "sess:shared");
        Pipeline.run(List.of(a));
        String evidence = a.evidenceId;
        a.collectionAccountId = "b";
        Pipeline.run(List.of(a));
        assertEquals(evidence, a.evidenceId);
        RequestRecord b = record(Source.HUMAN, "a", "sess:shared");
        assertEquals(List.of(b), RecordMerge.missing(List.of(a), List.of(b), 10));
        Pipeline.Result result = Pipeline.run(List.of(a, b));
        assertEquals(2, result.records.stream().map(value -> value.evidenceId).distinct().count());
        assertEquals(2, result.analysis.cells().size());
    }

    @Test
    void legacyUnresolvedStateLoadsWithLaneOrAnonymousAndKeepsCredentials() throws Exception {
        RequestRecord account = record(Source.LLM, null, "sess:shared");
        account.laneAccountId = "a";
        RequestRecord anonymous = record(Source.HUMAN, null, "ck:tracker");
        Path file = temp.resolve("legacy.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, List.of(account, anonymous), new AnalysisConfig(), List.of());
        ObjectMapper json = new ObjectMapper();
        var saved = json.readTree(Files.readString(file));
        for (var row : saved.path("records")) ((ObjectNode) row).put("auth_state", "UNRESOLVED");
        Files.writeString(file, json.writeValueAsString(saved));
        var loaded = store.load(file).records();
        assertEquals("a", loaded.get(0).selectedIdentity());
        assertEquals(AuthState.ACCOUNT_BOUND, loaded.get(0).authState);
        assertEquals("anon", loaded.get(1).selectedIdentity());
        assertEquals(AuthState.ANONYMOUS, loaded.get(1).authState);
        assertEquals(account.reqText, loaded.get(0).reqText);
        assertEquals(anonymous.reqText, loaded.get(1).reqText);
    }

    @Test
    void anonymousCreateWithCookiesNeverBecomesAnAccountOwnershipProof() {
        RequestRecord create = new RequestRecord(Source.HUMAN, SERVICE, "POST", "/api/items", 201, "ck:tracker");
        create.collectionAccountId = "anon";
        create.hasResponse = true;
        create.phase = RunPhase.EXPLORATION;
        create.responseContentType = "application/json";
        create.body = "{\"id\":101}";
        RequestRecord read = record(Source.HUMAN, "a", "tok:a");
        var result = Pipeline.run(List.of(create, read));
        var owner = result.analysis.owners().get(read.resource);
        assertFalse(owner.basis().contains("생성 요청자"));
        assertFalse(owner.confirmed());
    }

    private static RequestRecord record(Source source, String identity, String fingerprint) {
        RequestRecord record = new RequestRecord(source, SERVICE, "GET", "/api/items/101", 200, fingerprint);
        record.collectionAccountId = identity;
        record.hasResponse = true;
        record.phase = RunPhase.EXPLORATION;
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.timestamp = 1000;
        record.responseContentType = "application/json";
        record.body = "{\"id\":101}";
        record.reqText = "GET /api/items/101 HTTP/1.1\r\nCookie: session=original\r\nAuthorization: Bearer original\r\n\r\n";
        return record;
    }
}
