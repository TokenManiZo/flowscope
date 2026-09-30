package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.web.SnapshotJsonWriter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ManualVerificationPersistenceTest {
    @TempDir Path temp;

    @Test
    void reviewsSavedBeforeManualVerificationStillOpen() throws Exception {
        AnalysisConfig config = new AnalysisConfig();
        config.reviewItem("cell", ReviewDecision.Status.CONFIRMED, "checked", List.of("ev-1"));
        ProjectStore codec = new ProjectStore();
        Path file = temp.resolve("older.json");
        codec.save(file, List.of(), config, List.of(), List.of(), Map.of(), List.of(), List.of());
        var json = new ObjectMapper();
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(file.toFile());
        for (var review : root.withArray("reviews")) {
            ((com.fasterxml.jackson.databind.node.ObjectNode) review).remove(List.of("policy_context", "manual_validation_evidence_ids"));
        }
        json.writeValue(file.toFile(), root);

        ReviewDecision restored = codec.load(file).config().reviews().get("cell");
        assertEquals(ReviewDecision.Status.CONFIRMED, restored.status());
        assertEquals(List.of(), restored.validationEvidenceIds());
        assertEquals(Map.of(), restored.policyContext());

        ((com.fasterxml.jackson.databind.node.ObjectNode) root.withArray("reviews").get(0))
                .put("manual_validation_evidence_ids", "not-an-array");
        json.writeValue(file.toFile(), root);
        assertThrows(Exception.class, () -> codec.load(file), "a present but malformed field is still rejected");
    }

    @Test
    void sqliteProjectsWithOlderReviewsStillOpen() throws Exception {
        AnalysisConfig config = new AnalysisConfig();
        config.reviewItem("cell", ReviewDecision.Status.DISMISSED, "normal", List.of("ev-1"));
        SqliteProjectStore database = new SqliteProjectStore(new ProjectStore());
        Path file = temp.resolve("older.flowscope.db");
        database.save(file, List.of(), config, List.of(), List.of(), Map.of(), List.of(), List.of());
        // Burp에서 열던 기존 .flowscope.db의 판정 문서에는 두 필드가 없다.
        try (var connection = java.sql.DriverManager.getConnection("jdbc:sqlite:" + file);
             var statement = connection.createStatement()) {
            statement.executeUpdate("UPDATE reviews SET document = json_remove(document, '$.policy_context', '$.manual_validation_evidence_ids')");
        }

        ReviewDecision restored = database.load(file).config().reviews().get("cell");
        assertEquals(ReviewDecision.Status.DISMISSED, restored.status());
        assertEquals(List.of(), restored.validationEvidenceIds());
    }

    @Test
    void manualResponsesAndFailedAttemptsRoundTripWithoutBecomingDiscovery() throws Exception {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders/7", 200, "anon");
        record.phase = RunPhase.VALIDATION;
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.originEvidenceId = "ev-0123456789abcdef";
        record.durationMillis = 42;
        record.hasResponse = true;
        record.body = "{\"id\":7}";
        AnalysisConfig config = new AnalysisConfig();
        Pipeline.Result result = Pipeline.runIsolated(List.of(record), config);
        RequestRecord published = result.records.getFirst();
        assertNull(record.evidenceId, "collector DTO is deliberately not the published Evidence");
        assertNotNull(published.evidenceId);
        assertEquals(record.originEvidenceId, published.originEvidenceId);
        assertEquals(0, result.coverageRecords.size());
        config.reviewItem("cell", ReviewDecision.Status.CONFIRMED, "checked", List.of(record.originEvidenceId));
        config.bindReviewPolicy("cell", "alice", published.op, published.resource);
        config.attachReviewValidation("cell", List.of(published.evidenceId));
        RunExecutionLedger ledger = new RunExecutionLedger();
        ledger.record(Source.HUMAN, "manual", null, "GET", "https://api.test/orders/7?token=NEVER-PERSIST",
                RunExecutionLedger.Outcome.TIMEOUT, 0, null, Instant.EPOCH, 30_000, record.originEvidenceId);
        ProjectStore codec = new ProjectStore();
        SqliteProjectStore database = new SqliteProjectStore(codec);
        Path json = temp.resolve("manual.json");
        Path sqlite = temp.resolve("manual.db");
        codec.save(json, result.records, config, List.of(), List.of(), Map.of(), List.of(), ledger.attempts());
        database.save(sqlite, result.records, config, List.of(), List.of(), Map.of(), List.of(), ledger.attempts());
        for (ProjectStore.ProjectData restored : List.of(codec.load(json), database.load(sqlite))) {
            RequestRecord loaded = restored.records().getFirst();
            assertEquals(record.originEvidenceId, loaded.originEvidenceId);
            assertEquals(42, loaded.durationMillis);
            assertEquals(record.originEvidenceId, restored.runAttempts().getFirst().originEvidenceId());
            assertEquals(0, restored.runAttempts().getFirst().status());
            assertNull(restored.runAttempts().getFirst().evidenceId());
            assertEquals(List.of(published.evidenceId), restored.config().reviews().get("cell").validationEvidenceIds());
            assertEquals(config.reviews().get("cell").policyContext(), restored.config().reviews().get("cell").policyContext());
            Pipeline.Result rebuilt = Pipeline.run(restored.records(), restored.config());
            assertTrue(rebuilt.coverageRecords.isEmpty());
            var snapshot = new ObjectMapper().readTree(new SnapshotJsonWriter().write(1, rebuilt, restored.config(), List.of(), List.of()));
            assertEquals(published.evidenceId, snapshot.at("/manualVerifications/0/eventId").asText());
            assertEquals(record.originEvidenceId, snapshot.at("/manualVerifications/0/originEvidenceId").asText());
            assertEquals(42, snapshot.at("/manualVerifications/0/durationMs").asLong());
            assertFalse(snapshot.toString().contains("NEVER-PERSIST"));
        }
    }
}
