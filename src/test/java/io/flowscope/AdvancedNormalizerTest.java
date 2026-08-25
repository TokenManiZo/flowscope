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
    }
}
