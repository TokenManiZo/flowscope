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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** D-155: the snapshot surfaces how much attributable API traffic was captured outside a HUMAN pass. */
final class SnapshotTrafficStatsTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void countsHumanApiCapturedOutsideAPassWithoutTurningItIntoCoverage() throws Exception {
        RequestRecord outside = apiRecord("/api/one", RunPhase.BASELINE);
        RequestRecord alsoOutside = apiRecord("/api/two", RunPhase.BASELINE);
        RequestRecord inside = apiRecord("/api/three", RunPhase.EXPLORATION);

        Pipeline.Result result = Pipeline.run(List.of(outside, alsoOutside, inside), new AnalysisConfig());
        JsonNode traffic = json.readTree(new SnapshotJsonWriter().write(1, result, new AnalysisConfig(),
                List.of(), List.of())).path("trafficStats");

        assertEquals(2, traffic.path("humanApiOutsideRun").asInt(),
                "run 밖에서 관측된 인증 API 요청만 센다");
        assertEquals(1, result.coverageRecords.size(),
                "EXPLORATION 요청만 coverage이고 run 밖 트래픽은 coverage를 늘리지 않는다");
    }

    @Test
    void ignoresNonApiAndNonHumanTrafficOutsideAPass() throws Exception {
        RequestRecord navigation = new RequestRecord(Source.HUMAN, "https://app.test:443", "GET", "/", 200, "anon");
        navigation.responseContentType = "text/html";
        navigation.body = "<html></html>";
        navigation.hasResponse = true;
        navigation.phase = RunPhase.BASELINE;
        RequestRecord scanner = new RequestRecord(Source.SCANNER, "https://app.test:443", "GET", "/api/scan", 200, "zap");
        scanner.requestContentType = "application/json";
        scanner.responseContentType = "application/json";
        scanner.body = "{\"id\":1}";
        scanner.hasResponse = true;
        scanner.phase = RunPhase.BASELINE;

        Pipeline.Result result = Pipeline.run(List.of(navigation, scanner), new AnalysisConfig());
        JsonNode traffic = json.readTree(new SnapshotJsonWriter().write(1, result, new AnalysisConfig(),
                List.of(), List.of())).path("trafficStats");

        assertTrue(traffic.has("humanApiOutsideRun"));
        assertEquals(0, traffic.path("humanApiOutsideRun").asInt(),
                "네비게이션과 SCANNER 트래픽은 HUMAN 탐색 안내 대상이 아니다");
    }

    private static RequestRecord apiRecord(String path, RunPhase phase) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://app.test:443", "GET", path, 200, "sess-a");
        record.requestContentType = "application/json";
        record.reqText = "GET " + path + " HTTP/1.1\r\nHost: app.test\r\nContent-Type: application/json\r\n\r\n";
        record.requestPayload = StoredPayload.capture(record.reqText, "application/json", 1024 * 1024);
        record.responseContentType = "application/json";
        record.body = "{\"id\":1}";
        record.hasResponse = true;
        record.phase = phase;
        return record;
    }
}
