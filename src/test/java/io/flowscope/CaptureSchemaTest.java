package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.Masking;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 수집 스키마 — 명세가 '입력값'으로 요구하는 데이터를 실제로 보관하는지 검증.
 *  F-06 객체 분석: 경로 + Query + 요청 Body
 *  F-09 Flow    : 요청·응답의 ID/토큰, 시각
 *  F-18/19 재전송: 원본 Request
 *  F-22 상세    : 요청/응답 상세 (단, 인증정보는 가린 상태)
 *  F-05        : 원문 토큰은 저장하지 않는다
 */
class CaptureSchemaTest {

    private static final String XML = """
            <?xml version="1.0"?>
            <items>
              <item>
                <method>POST</method>
                <path>/api/orders?userId=7&amp;token=SUPERSECRET</path>
                <status>200</status>
                <host>api.shop.test</host>
                <port>443</port>
                <protocol>https</protocol>
                <request base64="false"><![CDATA[POST /api/orders?userId=7&token=SUPERSECRET HTTP/1.1
            Host: api.shop.test
            Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG
            Cookie: session=SECRETSESSION; theme=dark

            {"orderId":101,"password":"hunter2"}]]></request>
                <response base64="false"><![CDATA[HTTP/1.1 200

            {"id":101,"owner":"user-a","access_token":"LEAKED"}]]></response>
              </item>
            </items>
            """;

    private RequestRecord parsed() {
        List<RequestRecord> recs = BurpXmlParser.parse(XML.getBytes(StandardCharsets.UTF_8), Source.HUMAN);
        assertEquals(1, recs.size());
        return recs.get(0);
    }

    @Test
    void 쿼리를_보관한다_F06() {
        RequestRecord r = parsed();
        assertNotNull(r.query, "F-06 은 Query 를 객체 식별 입력으로 요구한다");
        assertTrue(r.query.contains("userId=7"));
        assertEquals("/api/orders", r.path, "path 에는 쿼리가 섞이면 안 된다");
    }

    @Test
    void 요청_본문을_보관한다_F06() {
        RequestRecord r = parsed();
        assertNotNull(r.reqBody, "F-06 은 요청 Body 를 요구한다");
        assertTrue(r.reqBody.contains("orderId"), "본문의 객체 식별값이 남아야 한다");
    }

    @Test
    void 원본_요청을_보관한다_F18_F22() {
        RequestRecord r = parsed();
        assertNotNull(r.reqText, "F-18 재전송·F-22 상세는 원본 Request 를 요구한다");
        assertTrue(r.reqText.contains("POST /api/orders"), "요청 라인 보존");
        assertTrue(r.reqText.contains("Host: api.shop.test"), "헤더 구조 보존");
    }

    @Test
    void 인증정보는_가린다_F05_F22() {
        RequestRecord r = parsed();
        // 원문 토큰이 어디에도 남으면 안 된다
        String all = String.join("|", r.reqText, String.valueOf(r.reqBody),
                String.valueOf(r.query), String.valueOf(r.body), r.fp);
        assertFalse(all.contains("SECRETSESSION"), "세션 원문 저장 금지(F-05)");
        assertFalse(all.contains("SUPERSECRET"), "쿼리의 토큰 값 마스킹");
        assertFalse(all.contains("hunter2"), "본문의 password 마스킹");
        assertFalse(all.contains("LEAKED"), "응답의 access_token 마스킹");
        assertFalse(r.reqText.contains("eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG"), "Authorization 값 마스킹");
        // 구조는 남아야 상세 보기가 가능
        assertTrue(r.reqText.contains("Authorization:"), "헤더 이름은 남긴다(F-22)");
        assertTrue(r.reqText.contains("theme=dark") || r.reqText.contains("theme=***"), "비밀 아닌 쿠키 이름은 유지");
    }

    @Test
    void 응답_본문의_소유필드는_남는다_F10() {
        RequestRecord r = parsed();
        assertTrue(r.hasResponse);
        assertTrue(r.body.contains("\"owner\":\"user-a\""),
                "F-10 판정 오라클이 쓰는 소유필드는 마스킹하면 안 된다");
    }

    @Test
    void 마스킹_유틸_단독_동작() {
        assertFalse(Masking.maskSecrets("{\"token\":\"abc123\"}").contains("abc123"));
        assertTrue(Masking.maskSecrets("{\"id\":101}").contains("101"), "일반 필드는 그대로");
        assertTrue(Masking.truncate("x".repeat(100), 10).endsWith("(truncated)"));
    }

    @Test
    void 공백과_중첩값이_있는_JSON_secret_전체를_가린다() {
        String masked = Masking.maskBody("""
                {"password":"correct horse battery staple","profile":{"access_token":"alpha beta"}}
                """, "application/json");

        assertFalse(masked.contains("correct horse battery staple"));
        assertFalse(masked.contains("alpha beta"));
        assertTrue(masked.contains("***MASKED***"));
    }

    @Test
    void multipart_secret_part_전체를_가린다() {
        String body = """
                --AaB03x\r
                Content-Disposition: form-data; name="username"\r
                \r
                alice\r
                --AaB03x\r
                Content-Disposition: form-data; name="password"\r
                \r
                correct horse battery staple\r
                --AaB03x--\r
                """;

        String masked = Masking.maskBody(body, "multipart/form-data; boundary=AaB03x");

        assertTrue(masked.contains("alice"));
        assertFalse(masked.contains("correct horse battery staple"));
        assertTrue(masked.contains("***MASKED***"));
    }

    @Test
    void 전문_마스킹도_Content_Type에_따라_본문을_가린다() {
        String message = "POST /login HTTP/1.1\r\nContent-Type: application/json\r\n\r\n"
                + "{\"password\":\"alpha beta\"}";

        assertFalse(Masking.maskHeaders(message).contains("alpha beta"));
    }

    @Test
    void 증분_재분석에서도_동일관측의_evidence_id가_충돌하지_않는다() {
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders/1", 200, "A");
        RequestRecord second = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/orders/1", 200, "A");
        first.hasResponse = true;
        second.hasResponse = true;
        Pipeline.run(List.of(first));
        Pipeline.run(List.of(first, second));

        assertNotEquals(first.evidenceId, second.evidenceId);
        assertTrue(second.evidenceId.startsWith(first.evidenceId + "-"));
    }
}
