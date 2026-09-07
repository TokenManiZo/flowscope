package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.web.SnapshotJsonWriter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class LegacyLlmArchiveTest {
    @TempDir Path directory;

    @Test
    void rejectsAssessmentCollectionsBeyondRetainedByteBudget() {
        List<String> evidenceIds = java.util.stream.IntStream.range(0, 200)
                .mapToObj(index -> "evidence-" + index + "-" + "x".repeat(230)).toList();
        List<LegacyAssessment> values = java.util.stream.IntStream.range(0, 100)
                .mapToObj(index -> new LegacyAssessment("assessment-" + index, "BOLA", "LIKELY",
                        "candidate", "r".repeat(4_096), evidenceIds, java.time.Instant.EPOCH))
                .toList();

        assertThrows(IllegalArgumentException.class, () -> LegacyAssessment.validateSet(values));
    }

    @Test
    void oldVerdictForCurrentFindingSurvivesBothFormatsWithoutOverridingCurrentRules() throws Exception {
        SampleProject.Data sample = SampleProject.create();
        // Store accepts only canonically masked payloads, as the capture path supplies.
        for (RequestRecord record : sample.records()) {
            record.requestPayload = StoredPayload.capture(Masking.maskHeaders(record.reqText), "", 1024 * 1024);
            record.responsePayload = StoredPayload.capture(Masking.maskHeaders(record.respText), "", 1024 * 1024);
        }
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());
        assertFalse(result.analysis.findings().isEmpty());
        var finding = result.analysis.findings().getFirst();
        var assessment = new LegacyAssessment("legacy-assessment", "BOLA", "LIKELY",
                "old assessment", "old reason", finding.evidenceIds(), Instant.parse("2026-08-24T00:00:00Z"));
        var verdict = new ValidationDecision(finding.id(), ValidationDecision.FinalVerdict.CONFIRMED,
                "old verdict", finding.evidenceIds(), List.of("old-reproduction"), List.of("old-control"),
                "retired-judge-run", Instant.parse("2026-08-24T00:01:00Z"));
        SnapshotJsonWriter writer = new SnapshotJsonWriter();
        ObjectMapper json = new ObjectMapper();
        var before = json.readTree(writer.write(1, result, sample.config(), List.of(), List.of()));
        var archived = json.readTree(writer.write(1, result, sample.config(), List.of(assessment), List.of(verdict)));
        assertEquals(before.path("scenarios"), archived.path("scenarios"));
        assertFalse(archived.path("scenarios").toString().contains("finalVerdict"));
        assertEquals("CONFIRMED", archived.at("/legacyLlm/validations/0/verdict").asText());

        Path file = directory.resolve("legacy.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, result.records, sample.config(), List.of(assessment), List.of(verdict));
        var restored = store.load(file);
        assertEquals(List.of(assessment), restored.assessments());
        assertEquals(List.of(verdict), restored.validations());

        Path db = directory.resolve("legacy.flowscope.db");
        SqliteProjectStore sqlite = new SqliteProjectStore(store);
        sqlite.save(db, restored.records(), restored.config(), restored.assessments(), restored.validations(),
                Set.of(), List.of());
        var reopened = sqlite.load(db);
        assertEquals(restored.assessments(), reopened.assessments());
        assertEquals(restored.validations(), reopened.validations());
        assertEquals(result.records.stream().map(record -> record.evidenceId).toList(),
                reopened.records().stream().map(record -> record.evidenceId).toList());
    }
}
