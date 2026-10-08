package io.flowscope.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SnapshotObservedObjectsTest {
    @Test void addsDisplayObjectsWithoutChangingMatrixCoordinatesOrRequestLabEvidence() throws Exception {
        var a = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/posts/opaqueTokenA123456", 200, "A");
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/posts/opaqueTokenB123456", 200, "A");
        for (var r : List.of(a,b)) {
            r.hasResponse = true; r.reqText = "GET " + r.path + " HTTP/1.1\r\nHost: t\r\n\r\n";
            r.body = "{\"title\":\"post\"}";
        }
        var result = Pipeline.run(List.of(a,b));
        var analysis = result.analysis;
        var ops = result.records.stream().map(r -> r.op).toList();
        var ids = result.records.stream().map(r -> r.evidenceId).toList();
        var requests = result.records.stream().map(RequestRecord::requestTextForEvidence).toList();
        var writer = new SnapshotJsonWriter(); var json = new ObjectMapper();
        var first = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of()));
        var second = json.readTree(writer.write(2, result, new AnalysisConfig(), List.of(), List.of()));
        assertEquals(2, first.path("displayObjects").size());
        assertEquals(first.path("displayObjects"), second.path("displayObjects"));
        assertEquals(first.path("cells"), second.path("cells"));
        assertEquals(first.path("authorizationMatrix"), second.path("authorizationMatrix"));
        assertSame(analysis, result.analysis);
        assertEquals(ops, result.records.stream().map(r -> r.op).toList());
        assertEquals(ids, result.records.stream().map(r -> r.evidenceId).toList());
        assertEquals(requests, result.records.stream().map(RequestRecord::requestTextForEvidence).toList());
        for (int i=0; i<2; i++) {
            assertEquals(ids.get(i), first.path("events").get(i).path("eventId").asText());
            assertEquals(ops.get(i), first.path("events").get(i).path("op").asText());
        }
    }
}
