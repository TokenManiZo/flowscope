package io.flowscope;

import io.flowscope.core.ResponseEvidence;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ResponseEvidenceTest {

    @Test
    void 자원형식에_맞는_실무형_ID_필드를_인식한다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"orderId\":101,\"total\":5000}",
                "https://t:443 orders:101", "user-a"));
        assertTrue(ResponseEvidence.showsObject(
                "{\"order_uuid\":\"abc-101\"}",
                "https://t:443 orders:abc-101", "user-a"));
        assertFalse(ResponseEvidence.showsObject(
                "{\"userId\":101,\"total\":5000}",
                "https://t:443 orders:101", "user-a"),
                "다른 자원 타입의 ID가 우연히 같아도 주문 객체 근거가 아니다");
    }

    @Test
    void 중첩자원은_최종대상_ID만_객체근거로_쓴다() {
        assertFalse(ResponseEvidence.showsObject(
                "{\"orderId\":101}",
                "https://t:443 orders:101/items:5", "user-a"));
        assertTrue(ResponseEvidence.showsObject(
                "{\"itemId\":5}",
                "https://t:443 orders:101/items:5", "user-a"));
        assertFalse(ResponseEvidence.showsObject("{\"id\":5}", "malformed-resource", "user-a"));
    }

    @Test
    void 정상데이터_안의_거부문구를_soft_deny로_오인하지_않는다() {
        RequestRecord record = response(200,
                "{\"orders\":[{\"id\":101,\"status\":\"not allowed\"}]}");

        assertTrue(ResponseEvidence.successful(record));
        assertFalse(ResponseEvidence.denied(record));
    }

    @Test
    void 최상위_오류봉투의_거부문구는_200이어도_거부다() {
        RequestRecord record = response(200, "{\"error\":\"permission denied\"}");
        RequestRecord camelCase = response(200, "{\"errorMessage\":\"Unauthorized\"}");

        assertFalse(ResponseEvidence.successful(record));
        assertTrue(ResponseEvidence.denied(record));
        assertFalse(ResponseEvidence.successful(camelCase));
        assertTrue(ResponseEvidence.denied(camelCase));
    }

    @Test
    void 과도한_중첩과_크기는_판정기를_죽이지_않고_근거없음으로_끝난다() {
        String deep = "{\"x\":".repeat(200) + "{\"id\":7}" + "}".repeat(200);
        String huge = "{\"id\":7,\"padding\":\"" + "x".repeat(1_100_000) + "\"}";
        String hugeWithBenignPhrase = "{\"orders\":[{\"status\":\"not allowed\"}],\"padding\":\""
                + "x".repeat(1_100_000) + "\"}";

        assertDoesNotThrow(() -> ResponseEvidence.showsObject(
                deep, "https://t:443 orders:7", "user-a"));
        assertFalse(ResponseEvidence.showsObject(deep, "https://t:443 orders:7", "user-a"));
        assertFalse(ResponseEvidence.showsObject(huge, "https://t:443 orders:7", "user-a"));
        assertTrue(ResponseEvidence.successful(response(200, hugeWithBenignPhrase)));
    }

    @Test
    void 소유자문자열만으로_대상객체_노출을_확정하지_않는다() {
        assertFalse(ResponseEvidence.showsObject(
                "{\"owner\":\"user-a\",\"message\":\"request completed\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID가_있으면_owner가_생략된_응답도_객체근거다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"description\":\"order\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID가_있으면_owner표현은_별도_소유자오라클에_맡긴다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"owner\":\"user-b\"}",
                "https://t:443 orders:7", "user-a"));
    }

    @Test
    void 대상ID와_확정owner가_같은_객체에_있으면_객체근거다() {
        assertTrue(ResponseEvidence.showsObject(
                "{\"id\":7,\"user\":{\"email\":\"user-a\"}}",
                "https://t:443 orders:7", "user-a"));
    }

    private static RequestRecord response(int status, String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443",
                "GET", "/orders/101", status, "anon");
        record.hasResponse = true;
        record.body = body;
        return record;
    }
}
