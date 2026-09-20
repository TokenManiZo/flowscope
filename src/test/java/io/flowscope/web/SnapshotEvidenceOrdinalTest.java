package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 표시용 Evidence 순번(#N)은 원본 `ev-…` ID를 건드리지 않고, 프로젝트 스냅샷 단위로 관측순 1..N을 부여한다. */
final class SnapshotEvidenceOrdinalTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void assigns_sequential_ordinals_per_distinct_evidence_in_first_seen_order() throws Exception {
        Pipeline.Result result = Pipeline.run(List.of(
                request("/api/orders/2", 2_000), request("/api/orders/1", 1_000)));
        JsonNode root = json.readTree(new SnapshotJsonWriter()
                .write(1, result, new AnalysisConfig(), List.of(), List.of()));
        JsonNode ordinals = root.path("evidenceOrdinals");

        // 원본 ID는 내용 해시 그대로 유지되고, 매핑은 distinct Evidence마다 1..N을 빠짐없이 부여한다.
        assertTrue(ordinals.fieldNames().hasNext(), root.toString());
        assertEquals(2, ordinals.size());
        for (JsonNode event : root.path("events")) {
            String id = event.path("eventId").asText();
            assertTrue(id.startsWith("ev-"), id);
            assertTrue(ordinals.has(id), "순번 누락: " + id);
        }
        // 최초 관측(firstSeen)이 이른 요청이 낮은 번호를 갖는다: /api/orders/1(1000) → #1, /api/orders/2(2000) → #2.
        String earlier = eventIdForPath(root, "/api/orders/1");
        String later = eventIdForPath(root, "/api/orders/2");
        assertEquals(1, ordinals.path(earlier).asInt());
        assertEquals(2, ordinals.path(later).asInt());
    }

    private static String eventIdForPath(JsonNode root, String path) {
        for (JsonNode event : root.path("events")) {
            if (path.equals(event.path("path").asText())) return event.path("eventId").asText();
        }
        throw new IllegalStateException("no event for " + path);
    }

    private static RequestRecord request(String path, long timestamp) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://app.test:443", "GET", path, 200, "anon");
        record.timestamp = timestamp;
        record.reqText = "GET " + path + " HTTP/1.1\r\nHost: app.test\r\n\r\n";
        record.body = "{}";
        record.hasResponse = true;
        record.phase = RunPhase.EXPLORATION;
        return record;
    }
}
