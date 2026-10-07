package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.StoredPayload;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class SnapshotParameterEvidenceTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void unsupported_and_malformed_retained_bodies_are_incomplete_in_evidence_and_surface() throws Exception {
        for (String[] fixture : List.of(
                new String[] { "text/plain", "UNPARSED-BODY-SENTINEL" },
                new String[] { "multipart/form-data; boundary=x", "no boundary or parts" })) {
            Pipeline.Result result = Pipeline.run(List.of(request(fixture[0], fixture[1])));
            SnapshotJsonWriter writer = new SnapshotJsonWriter();
            JsonNode evidence = evidence(writer, result);
            assertEquals("RETAINED", evidence.at("/parameterContext/retention").asText());
            assertFalse(evidence.at("/parameterContext/complete").asBoolean());
            assertEquals("EXTRACTION_DIAGNOSTICS", evidence.at("/parameterContext/completenessReason").asText());
            assertEquals("/safe", evidence.at("/parameterObservations/0/key/canonicalPath").asText());
            JsonNode surface = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of())).path("surface");
            assertTrue(surface.at("/endpoints/0/requestContexts/0/complete").isBoolean());
            assertFalse(surface.at("/endpoints/0/requestContexts/0/complete").asBoolean());
            assertFalse(surface.path("parameterDiagnostics").isEmpty());
        }
    }

    @Test
    void form_and_multipart_evidence_use_the_same_public_locations_as_surface() throws Exception {
        for (String[] fixture : List.of(
                new String[] { "application/x-www-form-urlencoded", "title=hello", "FORM_BODY" },
                new String[] { "multipart/form-data; boundary=x", "--x\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nhello\r\n--x--\r\n", "MULTIPART_BODY" })) {
            Pipeline.Result result = Pipeline.run(List.of(request(fixture[0], fixture[1])));
            SnapshotJsonWriter writer = new SnapshotJsonWriter();
            JsonNode evidence = evidence(writer, result);
            assertTrue(evidence.at("/parameterContext/complete").asBoolean());
            JsonNode input = null;
            for (JsonNode observation : evidence.path("parameterObservations")) {
                if ("/title".equals(observation.at("/key/canonicalPath").asText())) input = observation;
            }
            assertNotNull(input);
            assertEquals(fixture[2], input.at("/key/location").asText());
            assertEquals(5, input.path("byteLength").asInt());
            assertTrue(input.path("digest").asText().matches("[0-9a-f]{64}"));
            JsonNode surface = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of())).path("surface");
            boolean sameCoordinate = false;
            for (JsonNode parameter : surface.at("/endpoints/0/parameters")) {
                sameCoordinate |= fixture[2].equals(parameter.path("location").asText())
                        && "/title".equals(parameter.path("canonicalPath").asText());
            }
            assertTrue(sameCoordinate);
        }
    }

    @Test
    void container_summaries_never_invent_bytes_or_value_digests() throws Exception {
        Pipeline.Result result = Pipeline.run(List.of(request("application/json",
                "{\"object\":{},\"note\":\"token=hidden\"}")));
        JsonNode evidence = evidence(new SnapshotJsonWriter(), result);
        boolean containerFound = false;
        boolean noteFound = false;
        for (JsonNode observation : evidence.path("parameterObservations")) {
            if ("/object".equals(observation.at("/key/canonicalPath").asText())) {
                containerFound = true;
                assertEquals("OBJECT", observation.path("shape").asText());
                assertTrue(observation.path("byteLength").isNull());
                assertTrue(observation.path("digest").isNull());
            }
            if ("/note".equals(observation.at("/key/canonicalPath").asText())) {
                noteFound = true;
                // 값에 token=이 들어 있어도 다른 값과 똑같이 digest를 만든다.
                assertFalse(observation.path("digest").isNull());
            }
        }
        assertTrue(containerFound);
        assertTrue(noteFound);
        assertFalse(evidence.path("parameterObservations").toString().contains("preview"));
    }

    private JsonNode evidence(SnapshotJsonWriter writer, Pipeline.Result result) throws Exception {
        return json.readTree(writer.evidence(result, result.records.getFirst().op, 0, 20)).path("records").get(0);
    }

    @Test
    void sensitive_omission_alone_keeps_the_request_complete_in_evidence_and_surface() throws Exception {
        Pipeline.Result result = Pipeline.run(List.of(request("application/json", "{\"password\":\"x\",\"safe\":\"1\"}")));
        SnapshotJsonWriter writer = new SnapshotJsonWriter();
        JsonNode evidence = evidence(writer, result);
        assertEquals("RETAINED", evidence.at("/parameterContext/retention").asText());
        assertTrue(evidence.at("/parameterContext/complete").asBoolean(), evidence.toString());
        assertTrue(evidence.at("/parameterContext/completenessReason").isMissingNode());
        assertEquals("/safe", evidence.at("/parameterObservations/0/key/canonicalPath").asText());
        JsonNode surface = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of())).path("surface");
        assertTrue(surface.at("/endpoints/0/requestContexts/0/complete").asBoolean(), surface.toString());
    }

    private static RequestRecord request(String contentType, String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://app.test:443", "POST", "/api/orders", 200, "anon");
        record.evidenceId = "parameter-evidence";
        record.query = "safe=ok";
        record.reqBody = body;
        record.requestContentType = contentType;
        record.reqText = "POST /api/orders?safe=ok HTTP/1.1\r\nHost: app.test\r\nContent-Type: " + contentType + "\r\n\r\n" + body;
        record.requestPayload = StoredPayload.capture(record.reqText, contentType, 1024 * 1024);
        record.responseContentType = "application/json";
        record.body = "{}";
        record.hasResponse = true;
        record.phase = RunPhase.EXPLORATION;
        return record;
    }
}
