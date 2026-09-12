package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AccessRole;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.parameter.ParameterDiagnostic;
import io.flowscope.core.parameter.ParameterKey;
import io.flowscope.core.parameter.ParameterObservation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class ParameterModelContractTest {
    @Test
    void unknownAggregateShapeSurvivesJsonRoundTrip() throws Exception {
        ObjectMapper json = new ObjectMapper();
        ParameterObservation observation = observation(key(), "ev-unknown", null, null, null, null, null);
        var tree = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(observation);
        tree.put("shape", "UNKNOWN");
        ParameterObservation restored = assertDoesNotThrow(() -> json.treeToValue(tree, ParameterObservation.class));
        assertEquals(ParameterObservation.Shape.UNKNOWN, restored.shape());
        assertEquals(restored, json.readValue(json.writeValueAsString(restored), ParameterObservation.class));
    }

    @Test
    void stableKeyFramesDelimiterAndUtf8FieldsWithoutCollisions() {
        ParameterKey withDelimiter = new ParameterKey("https://a:443", "PATCH", "PATCH /a|b",
                ParameterObservation.Location.JSON_BODY, "/x");
        ParameterKey shifted = new ParameterKey("https://a:443", "PATCH", "PATCH /a",
                ParameterObservation.Location.JSON_BODY, "/b|x");
        assertNotEquals(withDelimiter.stableKey(), shifted.stableKey());
        assertEquals("pk:v1:3:한4:null4:null5:QUERY3:/é", new ParameterKey("한", "null", "null",
                ParameterObservation.Location.QUERY, "/é").stableKey());
    }

    @Test
    void observationRejectsMissingEvidenceAndDefaultsTrafficMetadata() {
        assertThrows(IllegalArgumentException.class, () -> observation(key(), "", null, null, null, null, null));
        ParameterObservation observation = observation(key(), "ev-1", null, null, null, null, null);
        assertEquals(Source.UNKNOWN, observation.source());
        assertEquals(AccessRole.UNKNOWN, observation.role());
        assertEquals(RunPhase.UNKNOWN, observation.phase());
        assertEquals(ParameterObservation.Confidence.UNKNOWN, observation.confidence());
    }

    @Test
    void valueSummaryAndDiagnosticRejectInvalidBounds() {
        assertThrows(IllegalArgumentException.class,
                () -> new ParameterObservation.ValueSummary(null, 0, "sha256:abcd", "x"));
        assertThrows(IllegalArgumentException.class,
                () -> new ParameterObservation.ValueSummary(ParameterObservation.ValueType.STRING,
                        -1, "sha256:abcd", "x"));
        assertThrows(IllegalArgumentException.class,
                () -> new ParameterDiagnostic("", "JSON_LIMIT", 0));
        assertThrows(IllegalArgumentException.class,
                () -> new ParameterDiagnostic("PATCH /orders", "", 0));
        assertThrows(IllegalArgumentException.class,
                () -> new ParameterDiagnostic("PATCH /orders", "JSON_LIMIT", -1));
    }

    private static ParameterKey key() {
        return new ParameterKey("https://a:443", "PATCH", "PATCH /orders/{id}",
                ParameterObservation.Location.JSON_BODY, "/status");
    }

    private static ParameterObservation observation(ParameterKey key, String evidenceId,
                                                     Source source, AccessRole role, RunPhase phase,
                                                     ParameterObservation.ValueSummary value,
                                                     ParameterObservation.Confidence confidence) {
        return new ParameterObservation(key, evidenceId, "run-1", source, "USER A", role, phase,
                ParameterObservation.Presence.PRESENT, ParameterObservation.Shape.SCALAR,
                value, "ctx", confidence);
    }
}
