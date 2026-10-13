package io.flowscope.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LlmFindingTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void findingSavedBeforeJudgmentFieldsStillLoads() throws Exception {
        String saved = "{\"id\":\"llm:GET /orders/{id}:anon:\",\"operation\":\"GET /orders/{id}\",\"identity\":\"anon\","
                + "\"resource\":null,\"verdict\":\"IDOR 의심\",\"confidence\":\"high\",\"note\":\"n\","
                + "\"evidenceIds\":[\"ev-1\"],\"createdAt\":5}";
        LlmFinding finding = json.readValue(saved, LlmFinding.class);
        assertEquals("IDOR 의심", finding.verdict());
        assertEquals("", finding.judgment());
        assertEquals(List.of(), finding.judgmentEvidenceIds());
        assertEquals(0L, finding.judgedAt());
    }

    @Test
    void judgmentRoundTripsAndKeepsTheOriginalFinding() throws Exception {
        LlmFinding finding = new LlmFinding("llm:x", "GET /orders/{id}", "anon", "orders:1", "IDOR 의심",
                "high", "n", List.of("ev-1"), 5L).withJudgment("not_vulnerable", "401 차단", List.of("ev-2"), 9L);
        LlmFinding loaded = json.readValue(json.writeValueAsString(finding), LlmFinding.class);
        assertEquals(finding, loaded);
        assertEquals("IDOR 의심", loaded.verdict());
        assertEquals("not_vulnerable", loaded.judgment());
    }

    @Test
    void judgmentOutsideTheThreeValuesIsRejected() {
        LlmFinding finding = new LlmFinding("llm:x", "GET /a", "anon", null, "", "", "", List.of(), 1L);
        assertThrows(IllegalArgumentException.class, () -> finding.withJudgment("confirmed", "", List.of(), 2L));
    }
}
