package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.web.SnapshotJsonWriter;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class SnapshotJsonWriterScaleTest {
    @Test
    void keepsDatasetReplacementRevisionSeparateFromOrdinaryAnalysisRevision() throws Exception {
        Pipeline.Result result = Pipeline.run(List.of());

        var snapshot = new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                new SnapshotJsonWriter().write(17, 4, result, new AnalysisConfig(), List.of(), List.of(),
                        List.of(), List.of(), 0, List.of()));

        assertEquals(17, snapshot.path("revision").asLong());
        assertEquals(4, snapshot.path("datasetRevision").asLong());
    }

    @Test
    void exposesSanitizedExecutionQualityWithoutCreatingEvidence() throws Exception {
        Pipeline.Result result = Pipeline.run(List.of());
        RunExecutionLedger.Summary failed = new RunExecutionLedger.Summary(Source.LLM, "tls-run",
                2, 0, 2, RunExecutionLedger.Quality.ALL_FAILED,
                Map.of(RunExecutionLedger.Outcome.TLS_FAILURE, 2L));

        var snapshot = new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                new SnapshotJsonWriter().write(1, result, new AnalysisConfig(), List.of(), List.of(),
                        List.of(), List.of(), 0, List.of(failed)));

        assertTrue(snapshot.path("events").isEmpty());
        assertEquals("ALL_FAILED", snapshot.at("/runExecutions/0/quality").asText());
        assertEquals(0, snapshot.at("/runExecutions/0/responses").asInt());
        assertEquals(2, snapshot.at("/runExecutions/0/failures").asInt());
    }

    @Test
    void serializesTwentyThousandRepeatedObservationsWithoutQuadraticClusterExpansion() {
        List<RequestRecord> records = new ArrayList<>(20_000);
        for (int index = 0; index < 20_000; index++) {
            RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                    "GET", "/api/items", 200, "sess:scale");
            record.runId = "scale-run";
            record.timestamp = index + 1L;
            record.hasResponse = true;
            record.body = "{\"items\":[]}";
            record.reqText = "GET /api/items HTTP/1.1\r\nHost: api.example.test";
            record.respText = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"items\":[]}";
            records.add(record);
        }
        Pipeline.Result result = Pipeline.run(records);

        byte[] snapshot = assertTimeout(Duration.ofSeconds(15), () -> new SnapshotJsonWriter().write(
                1, result, new AnalysisConfig(), List.of(), List.of()));

        String json = new String(snapshot, java.nio.charset.StandardCharsets.UTF_8);
        assertFalse(json.contains("clusterEvidenceIds"));
        assertTrue(snapshot.length < 32 * 1024 * 1024,
                "20k snapshot should remain linear and below the response budget");
    }
}
