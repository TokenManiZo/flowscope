package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.LaneCompletionPolicy;
import io.flowscope.core.Masking;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ReviewDecision;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.StoredPayload;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SurfaceAnalyzer;
import io.flowscope.core.parameter.ParameterCoordinates;
import io.flowscope.core.ToolKind;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.SqliteProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SqliteProjectStoreTest {
    @TempDir Path temp;

    @Test
    void relationalProjectRoundTripsWithoutRawCredentials() throws Exception {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "GET", "/orders/7", 200, "sess:4e738ca5563c");
        record.sourceDetail = SourceDetail.BROWSER;
        record.orchestrator = Orchestrator.HUMAN;
        record.tool = ToolKind.BROWSER;
        record.phase = RunPhase.EXPLORATION;
        record.runId = "human-1";
        record.laneAccountId = "acct-test1";
        record.executionTrust = ExecutionTrust.OBSERVED;
        record.reqText = Masking.maskHeaders("GET /orders/7 HTTP/1.1\r\nCookie: session=RAWCOOKIE");
        record.requestPayload = StoredPayload.capture(record.reqText, "text/plain", 1024 * 1024);
        record.body = "{\"id\":7,\"ownerId\":\"test1\"}";
        record.respText = "HTTP/1.1 200 OK\r\n\r\n" + record.body;
        record.responsePayload = StoredPayload.capture(record.respText, "application/json", 1024 * 1024);
        record.hasResponse = true;
        record.timestamp = 1234;
        Pipeline.Result result = Pipeline.run(List.of(record));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.HUMAN, new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, record.runId));
        assertTrue(LaneCompletionPolicy.complete(contexts, Source.HUMAN, record.runId, result) != null);

        AccountProfile account = new AccountProfile("acct-test1", "test1", record.service, AccessRole.USER);
        AnalysisConfig config = new AnalysisConfig().upsertAccount(account)
                .bindSession(record.service, record.fp, account.id())
                .withResourcePolicy(record.resource, io.flowscope.core.ResourcePolicy.OWNER_ONLY);
        config.reviewItem("candidate-1", ReviewDecision.Status.UNRESOLVED,
                "추가 재현 필요", List.of(record.evidenceId));
        LegacyAssessment assessment = new LegacyAssessment("assessment-1", "BOLA", "INCONCLUSIVE",
                "candidate", "more evidence required", List.of(record.evidenceId),
                Instant.parse("2026-08-27T00:00:00Z"));
        ValidationDecision validation = new ValidationDecision("candidate-1",
                ValidationDecision.FinalVerdict.INCONCLUSIVE, "normal control is missing",
                List.of(record.evidenceId), List.of(), List.of(), "",
                Instant.parse("2026-08-27T00:01:00Z"));
        RouteCandidate route = new RouteCandidate(record.service, "UNKNOWN", "/orders/{id}/history",
                false, List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.HTML_LINK,
                record.evidenceId, Source.HUMAN, record.runId, "html")),
                RouteCandidate.Applicability.REVIEW, "미요청 경로");

        Path database = temp.resolve("test.flowscope.db");
        SqliteProjectStore store = new SqliteProjectStore(new ProjectStore());
        RunExecutionLedger ledger = new RunExecutionLedger();
        ledger.record(Source.LLM, "llm-failed", "acct-test1", "GET",
                "https://api.test/orders/8?token=raw-token", RunExecutionLedger.Outcome.TIMEOUT,
                0, null, Instant.parse("2026-09-03T00:02:00Z"), 30_000);
        ProjectStore.ProjectContext projectContext = new ProjectStore.ProjectContext("API 진단",
                List.of("https://api.test:443/"), Instant.parse("2026-09-10T00:00:00Z"));
        store.save(database, List.of(record), config, List.of(assessment), List.of(validation),
                contexts.completedRuns(), List.of(route), ledger.attempts(), projectContext);

        byte[] bytes = Files.readAllBytes(database);
        assertEquals("SQLite format 3\000", new String(bytes, 0, 16, StandardCharsets.ISO_8859_1));
        assertFalse(new String(bytes, StandardCharsets.ISO_8859_1).contains("RAWCOOKIE"));
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
             var statement = connection.createStatement()) {
            assertEquals(1, scalar(statement.executeQuery("SELECT COUNT(*) FROM records")));
            assertEquals(1, scalar(statement.executeQuery("SELECT COUNT(*) FROM accounts")));
            assertEquals(1, scalar(statement.executeQuery("SELECT COUNT(*) FROM session_bindings")));
            assertEquals(2, scalar(statement.executeQuery("SELECT COUNT(*) FROM payloads")));
            assertEquals(1, scalar(statement.executeQuery("SELECT COUNT(*) FROM completed_runs")));
            assertEquals(1, scalar(statement.executeQuery("SELECT COUNT(*) FROM run_attempts")));
        }

        ProjectStore.ProjectData loaded = store.load(database);
        assertEquals(projectContext, loaded.context());
        assertEquals(projectContext, store.readContext(database));
        assertEquals("acct-test1", loaded.records().getFirst().laneAccountId);
        assertEquals(1, loaded.records().size());
        assertEquals("test1", loaded.config().account(account.id()).orElseThrow().label());
        assertEquals(account.id(), loaded.config().boundAccount(record.service, record.fp).orElseThrow().id());
        assertEquals(io.flowscope.core.ResourcePolicy.OWNER_ONLY,
                loaded.config().resourcePolicy(record.op, record.resource));
        assertEquals(Set.of(Source.HUMAN), loaded.completedLanes());
        assertEquals("human-1", loaded.completedRuns().get(Source.HUMAN).runId());
        assertEquals(List.of(route), loaded.routeCandidates());
        assertEquals("INCONCLUSIVE", loaded.assessments().getFirst().verdict());
        assertEquals(ValidationDecision.FinalVerdict.INCONCLUSIVE, loaded.validations().getFirst().verdict());
        assertEquals(RunExecutionLedger.Outcome.TIMEOUT, loaded.runAttempts().getFirst().outcome());
        assertEquals("/orders/8", loaded.runAttempts().getFirst().path());
    }

    @Test
    void sqlite_재열기가_FLOW_V2_선언좌표버전과_canonical경로를_스키마변경_없이_보존한다() throws Exception {
        Path database = temp.resolve("coordinate-version.flowscope.db");
        RouteCandidate candidate = new RouteCandidate("https://api.test:443", "POST", "/api/orders",
                List.of(), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS,
                        "ev-1", Source.LLM, "run-1", "llm-javascript",
                        RouteCandidate.Applicability.REVIEW, "main.js:1")),
                RouteCandidate.Applicability.REVIEW, "main.js:1",
                List.of(new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.JSON_BODY,
                        "/product_id", "product_id", SurfaceAnalysis.Requirement.REQUIRED,
                        "ev-1", Source.LLM, "run-1", "llm-javascript", "main.js:1",
                        ParameterCoordinates.CoordinateVersion.FLOW_V2)));
        SqliteProjectStore store = new SqliteProjectStore(new ProjectStore());
        store.save(database, List.of(), new AnalysisConfig(), List.of(), List.of(), Set.of(), List.of(candidate));

        RouteCandidate restored = store.load(database).routeCandidates().getFirst();
        RouteCandidate.DeclaredParameter param = restored.declaredParameters().getFirst();
        assertEquals(ParameterCoordinates.CoordinateVersion.FLOW_V2, param.coordinateVersion());
        assertEquals("/product_id", param.fieldPath());
        assertEquals("ev-1", param.evidenceId());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(List.of(), List.of(), List.of(restored));
        assertEquals("/product_id", analysis.endpoints().getFirst().parameters().getFirst().canonicalPath());
    }

    @Test
    void rejectsUnsupportedStorageSchema() throws Exception {
        Path database = temp.resolve("unsupported.flowscope.db");
        SqliteProjectStore store = new SqliteProjectStore(new ProjectStore());
        store.save(database, List.of(), new AnalysisConfig(), List.of(), List.of(), Set.of(), List.of());
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
             var statement = connection.createStatement()) {
            statement.executeUpdate("UPDATE metadata SET value='99' WHERE key='storage_schema_version'");
        }
        assertThrows(IllegalArgumentException.class, () -> store.load(database));
    }

    private static int scalar(java.sql.ResultSet result) throws Exception {
        try (result) {
            assertTrue(result.next());
            return result.getInt(1);
        }
    }
}
