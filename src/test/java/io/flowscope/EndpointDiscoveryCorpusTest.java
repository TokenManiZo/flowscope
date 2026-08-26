package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** 범용 protocol fixture truth set. 실제 대상·블라인드 benchmark 성능을 주장하는 데이터가 아니다. */
final class EndpointDiscoveryCorpusTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void 일반_endpoint_corpus의_TP_FP_FN을_정확히_계산하고_회귀를_막는다() throws Exception {
        InputStream stream = getClass().getResourceAsStream("/discovery/endpoint-corpus.json");
        assertNotNull(stream);
        JsonNode cases = JSON.readTree(stream);
        int truePositive = 0;
        int falsePositive = 0;
        int falseNegative = 0;

        for (JsonNode fixture : cases) {
            List<RequestRecord> records = new ArrayList<>();
            for (JsonNode document : fixture.path("documents")) {
                RequestRecord record = new RequestRecord(Source.HUMAN, "https://fixture.test:443", "GET",
                        document.path("path").asText(), 200, "anon");
                record.hasResponse = true;
                record.responseContentType = document.path("mediaType").asText();
                record.body = document.path("body").asText();
                record.runId = "corpus-" + fixture.path("name").asText();
                records.add(record);
            }
            Pipeline.Result pipeline = Pipeline.run(records);
            Set<String> actual = new LinkedHashSet<>();
            RouteCandidateExtractor.extract(pipeline.records, ScopePolicy.parse(fixture.path("scope").asText()),
                            List.of()).stream().filter(candidate -> !candidate.observed())
                    .forEach(candidate -> actual.add(candidate.method() + " " + candidate.pathTemplate()));
            Set<String> expected = new LinkedHashSet<>();
            fixture.path("expected").forEach(value -> expected.add(value.asText()));

            Set<String> missing = new LinkedHashSet<>(expected);
            missing.removeAll(actual);
            Set<String> unexpected = new LinkedHashSet<>(actual);
            unexpected.removeAll(expected);
            Set<String> matched = new LinkedHashSet<>(actual);
            matched.retainAll(expected);
            truePositive += matched.size();
            falsePositive += unexpected.size();
            falseNegative += missing.size();
            assertEquals(expected, actual, () -> fixture.path("name").asText()
                    + " missing=" + missing + " unexpected=" + unexpected);
        }

        assertEquals(18, truePositive, "고정 truth set의 알려진 route 수");
        assertEquals(0, falsePositive, "고정 fixture에서 꾸며낸 route 회귀");
        assertEquals(0, falseNegative, "고정 fixture에서 놓친 route 회귀");
    }
}
