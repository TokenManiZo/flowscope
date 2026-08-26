package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AdvancedNormalizerTest {

    @Test
    void 쿼리의_객체ID를_추출하고_제어값은_제외한다() {
        RequestRecord r = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/api/order", 200, "A");
        r.query = "orderId=101&page=2&limit=20";
        Normalizer.normalizeAll(List.of(r));

        assertEquals("https://t:443 orders:101", r.resource);
        assertEquals("https://t:443 GET /api/order", r.op);
    }

    @Test
    void GraphQL_operationName으로_엔드포인트_붕괴를_막는다() {
        RequestRecord r = new RequestRecord(Source.LLM, "https://t:443", "POST", "/graphql", 200, "A");
        r.reqBody = "{\"operationName\":\"GetOrder\",\"variables\":{\"orderId\":202}}";
        Normalizer.normalizeAll(List.of(r));

        assertEquals("https://t:443 POST /graphql#GetOrder", r.op);
        assertEquals("https://t:443 orders:202", r.resource);
        assertEquals("GRAPHQL_VARIABLE", Normalizer.resourceEvidence(r));
    }

    @Test
    void 객체_추출_근거를_고정_신뢰도_대신_위치별로_표시한다() {
        RequestRecord path = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders/101", 200, "A");
        RequestRecord query = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders", 200, "A");
        query.query = "orderId=102";
        RequestRecord body = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        body.reqBody = "{\"orderId\":103}";
        Normalizer.normalizeAll(List.of(path, query, body));

        assertEquals("PATH_ID", Normalizer.resourceEvidence(path));
        assertEquals("QUERY_ID", Normalizer.resourceEvidence(query));
        assertEquals("BODY_ID", Normalizer.resourceEvidence(body));
    }

    @Test
    void 중첩배열_JSON과_multipart의_명시적_ID를_추출한다() {
        RequestRecord nested = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        nested.reqBody = "{\"items\":[{\"orderId\":104}]}";
        RequestRecord multipart = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/orders", 200, "A");
        multipart.reqBody = "--x\r\nContent-Disposition: form-data; name=\"orderId\"\r\n\r\n105\r\n--x--";
        Normalizer.normalizeAll(List.of(nested, multipart));

        assertEquals("https://t:443 orders:104", nested.resource);
        assertEquals("https://t:443 orders:105", multipart.resource);
        assertEquals("BODY_ID", Normalizer.resourceEvidence(multipart));
    }
}
