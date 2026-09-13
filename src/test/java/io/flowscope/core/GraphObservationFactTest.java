package io.flowscope.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

final class GraphObservationFactTest {
    @Test
    void preservesEvidenceRelationAndDerivesOnlyPresentationGroups() {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://example.test:443",
                "GET", "/api/v2/orders/101", 200, "user-a");
        record.idn = "user-a";
        record.op = "https://example.test:443 GET /api/v2/orders/{id}";
        record.resource = "orders:101/items:5";
        record.evidenceId = "ev-graph-fact";
        record.runId = "human-1";
        record.phase = RunPhase.EXPLORATION;
        record.hasResponse = true;

        GraphObservationFact fact = GraphObservationFact.from(record);

        assertEquals("ev-graph-fact", fact.evidenceId());
        assertEquals("https://example.test:443 GET /api/v2/orders/{id}", fact.operation());
        assertEquals("orders:101/items:5", fact.object());
        assertEquals("orders", fact.objectFamily());
        assertEquals("ORDERS APIs", fact.apiGroup());
        assertEquals("PATH_SEGMENT", fact.apiGroupBasis());
        assertEquals(GraphObservationFact.HttpOutcome.HTTP_2XX, fact.outcome());
    }

    @Test
    void distinguishesRequestOnlyAndObjectlessFacts() {
        RequestRecord record = new RequestRecord(Source.LLM, "https://example.test:443",
                "GET", "/manifest.json", 0, "anon");
        record.idn = "anon";
        record.op = "https://example.test:443 GET /manifest.json";
        record.evidenceId = "ev-request-only";

        GraphObservationFact fact = GraphObservationFact.from(record);

        assertNull(fact.object());
        assertEquals("MANIFEST.JSON APIs", fact.apiGroup());
        assertEquals(GraphObservationFact.HttpOutcome.REQUEST_ONLY, fact.outcome());
    }
}
