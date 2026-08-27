package io.flowscope;

import io.flowscope.core.Normalizer;
import io.flowscope.core.PathTemplateStatus;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RouteTemplateEvidenceTest {

    @Test
    void 서로_다른_숫자값이_같은_위치에서_반복되면_자동으로_묶는다() {
        RequestRecord first = record("GET", "/orders/101", 200, null);
        RequestRecord second = record("GET", "/orders/202", 200, null);

        Normalizer.normalizeAll(List.of(first, second));

        assertEquals("https://t:443 GET /orders/{id}", first.op);
        assertEquals(first.op, second.op);
        assertEquals(PathTemplateStatus.INFERRED, first.pathTemplateStatus);
        assertTrue(first.pathTemplateReasons.contains("MULTIPLE_VALUES_SAME_POSITION"));
        assertEquals("/orders/101", first.path, "원본 경로는 정규화 뒤에도 보존해야 한다");
    }

    @Test
    void 성공응답의_동일한_id는_단일관측도_확정근거다() {
        RequestRecord record = record("GET", "/orders/101", 200, "{\"id\":101}");

        Normalizer.normalizeAll(List.of(record));

        assertEquals("https://t:443 GET /orders/{id}", record.op);
        assertEquals(PathTemplateStatus.CORROBORATED, record.pathTemplateStatus);
        assertTrue(record.pathTemplateReasons.contains("RESPONSE_ID_MATCH"));
    }

    @Test
    void 근거없는_단일_숫자경로는_리터럴로_보존한다() {
        RequestRecord record = record("GET", "/status/200", 200, "{\"ok\":true}");

        Normalizer.normalizeAll(List.of(record));

        assertEquals("https://t:443 GET /status/200", record.op);
        assertEquals(PathTemplateStatus.LITERAL, record.pathTemplateStatus);
        assertTrue(record.pathTemplateReasons.isEmpty());
    }

    @Test
    void uuid와_긴_16진값은_형식근거로_단일관측도_묶는다() {
        RequestRecord uuid = record("GET", "/users/2f1e8b90-7c1a-4d3e-9a2b-1c2d3e4f5a6b", 200, null);
        RequestRecord hex = record("GET", "/objects/0123456789abcdef", 200, null);

        Normalizer.normalizeAll(List.of(uuid, hex));

        assertEquals(PathTemplateStatus.INFERRED, uuid.pathTemplateStatus);
        assertEquals(PathTemplateStatus.INFERRED, hex.pathTemplateStatus);
        assertTrue(uuid.op.endsWith("/users/{id}"));
        assertTrue(hex.op.endsWith("/objects/{id}"));
    }

    @Test
    void 날짜와_API버전은_경로변수로_승격하지_않는다() {
        RequestRecord date = record("GET", "/reports/2026/08/24", 200, null);
        RequestRecord version = record("GET", "/api/v2", 200, null);

        Normalizer.normalizeAll(List.of(date, version));

        assertTrue(date.op.endsWith("/reports/2026/08/24"));
        assertTrue(version.op.endsWith("/api/v2"));
        assertEquals(PathTemplateStatus.LITERAL, date.pathTemplateStatus);
        assertEquals(PathTemplateStatus.LITERAL, version.pathTemplateStatus);
    }

    @Test
    void 한_메서드의_응답근거는_같은_서비스와_구조의_다른_메서드에도_적용한다() {
        RequestRecord get = record("GET", "/orders/101", 200, "{\"orderId\":101}");
        RequestRecord delete = record("DELETE", "/orders/101", 204, null);

        Normalizer.normalizeAll(List.of(get, delete));

        assertTrue(get.op.endsWith("GET /orders/{id}"));
        assertTrue(delete.op.endsWith("DELETE /orders/{id}"));
        assertEquals(PathTemplateStatus.CORROBORATED, delete.pathTemplateStatus);
        assertTrue(delete.pathTemplateReasons.contains("CORROBORATED_RESPONSE_ID_MATCH"));
    }

    @Test
    void 경로묶음_근거는_서비스경계를_넘지_않는다() {
        RequestRecord supported = record("GET", "/orders/101", 200, "{\"id\":101}");
        RequestRecord otherService = new RequestRecord(Source.HUMAN, "https://other.test:443",
                "GET", "/orders/101", 200, "A");
        otherService.hasResponse = true;
        otherService.body = "{\"ok\":true}";

        Normalizer.normalizeAll(List.of(supported, otherService));

        assertEquals("https://t:443 GET /orders/{id}", supported.op);
        assertEquals("https://other.test:443 GET /orders/101", otherService.op);
        assertEquals(PathTemplateStatus.LITERAL, otherService.pathTemplateStatus);
    }

    @Test
    void 중첩경로의_일반_id는_가장_가까운_객체만_보강한다() {
        RequestRecord record = record("GET", "/orders/101/items/101", 200, "{\"id\":101}");

        Normalizer.normalizeAll(List.of(record));

        assertEquals("https://t:443 GET /orders/101/items/{id}", record.op);
        assertEquals(PathTemplateStatus.CORROBORATED, record.pathTemplateStatus);
        assertEquals("https://t:443 orders:101/items:101", record.resource);
    }

    private static RequestRecord record(String method, String path, int status, String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443", method, path, status, "A");
        record.hasResponse = true;
        record.body = body;
        return record;
    }
}
