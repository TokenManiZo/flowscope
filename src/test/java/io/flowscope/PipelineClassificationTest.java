package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PipelineClassificationTest {

    @Test
    void 게시된_분석스냅샷은_수집레코드의_후속변경과_분리된다() {
        RequestRecord input = api(Source.HUMAN, "/api/orders/1", "sess:a");
        input.body = "{\"id\":1}";

        Pipeline.Result published = Pipeline.runIsolated(List.of(input), new AnalysisConfig());
        input.body = "{\"id\":2}";
        Pipeline.runIsolated(List.of(input), new AnalysisConfig());

        assertNull(input.op, "수집 DTO에는 분석 산출물을 in-place로 쓰지 않는다");
        assertNotNull(published.records.getFirst().op);
        assertEquals("{\"id\":1}", published.records.getFirst().body);
    }
    private RequestRecord api(Source source, String path, String fp) {
        RequestRecord record = new RequestRecord(source, "https://t:443", "GET", path, 200, fp);
        record.hasResponse = true;
        record.responseContentType = "application/json";
        return record;
    }

    @Test
    void 원본은_전부_보존하고_응답없음과_검증요청만_커버리지에서_제외한다() {
        RequestRecord discovery = api(Source.LLM, "/api/orders/1", "tok:a");
        discovery.phase = RunPhase.EXPLORATION;
        RequestRecord validation = api(Source.LLM, "/api/orders/1", "tok:a");
        validation.phase = RunPhase.VALIDATION;
        RequestRecord noResponse = api(Source.HUMAN, "/api/missing", "anon");
        noResponse.hasResponse = false;

        Pipeline.Result result = Pipeline.run(List.of(discovery, validation, noResponse));

        assertEquals(3, result.records.size());
        assertEquals(1, result.coverageRecords.size());
        assertEquals(2, result.excludedCount);
        assertEquals(1, result.analysis.cells().size());
    }

    @Test
    void 일반_cookie_회전은_신원을_늘리지_않고_미확정으로_표시한다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 1_000; i++) records.add(api(Source.HUMAN, "/api/ping", "ck:" + i));

        Pipeline.Result result = Pipeline.run(records);

        assertEquals(1, result.records.stream().map(record -> record.idn).distinct().count());
        assertTrue(result.records.stream().allMatch(record -> record.authState == AuthState.UNRESOLVED));
    }

    @Test
    void 명시적으로_연결한_cookie만_계정신원이_된다() {
        RequestRecord record = api(Source.HUMAN, "/api/me", "ck:abc");
        AnalysisConfig config = new AnalysisConfig();
        config.upsertAccount(new AccountProfile("acct-a", "USER A", "https://t:443", AccessRole.USER));
        config.bindSession("https://t:443", "ck:abc", "acct-a");

        Pipeline.Result result = Pipeline.run(List.of(record), config);

        assertEquals("acct-a", result.records.getFirst().idn);
        assertEquals(AuthState.ACCOUNT_BOUND, result.records.getFirst().authState);
    }

    @Test
    void 통제된_ZAP_계정_lane은_cookie_형식이_아닌_laneAccountId로_귀속한다() {
        RequestRecord record = api(Source.SCANNER, "/api/me", "ck:rotating-cookie");
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.laneAccountId = "zap-a";
        AnalysisConfig config = new AnalysisConfig();
        config.upsertAccount(new AccountProfile("zap-a", "ZAP A", "https://t:443", AccessRole.USER));

        Pipeline.Result result = Pipeline.run(List.of(record), config);

        assertEquals("zap-a", result.records.getFirst().idn);
        assertEquals(AuthState.ACCOUNT_BOUND, result.records.getFirst().authState);
        assertTrue(config.boundAccount("https://t:443", "ck:rotating-cookie").isEmpty(),
                "ZAP lane attribution must not create a reusable Session Broker binding");
    }

    @Test
    void 같은_응답의_반복_폴링은_Evidence와_검토함에_남지만_메인_비교에서는_보류한다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443",
                    "GET", "/status", 200, "anon");
            record.hasResponse = true;
            record.body = "ok";
            record.timestamp = i + 1;
            records.add(record);
        }

        Pipeline.Result result = Pipeline.run(records);

        assertTrue(result.records.stream().allMatch(record -> record.trafficClassification.trafficClass()
                == TrafficClassification.TrafficClass.POLLING));
        assertTrue(result.coverageRecords.isEmpty());
        assertEquals(0, result.excludedCount);
        assertEquals(3, result.reviewCount);
    }
}
