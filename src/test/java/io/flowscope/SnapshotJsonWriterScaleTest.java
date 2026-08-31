package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.web.SnapshotJsonWriter;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class SnapshotJsonWriterScaleTest {
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
