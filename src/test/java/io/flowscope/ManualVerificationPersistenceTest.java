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
