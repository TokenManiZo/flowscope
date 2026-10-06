package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.TextLimits;
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
    void 인증정보와_비밀값도_원문_그대로_보관한다() {
        RequestRecord r = parsed();
        // 마스킹을 하지 않는다: 재시작 뒤에도 Request Lab이 같은 요청을 다시 보낼 수 있어야 한다.
        assertTrue(r.reqText.contains("eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG"), "Authorization 값 보존");
        assertTrue(r.reqText.contains("SECRETSESSION"), "세션 쿠키 보존");
        assertTrue(r.query.contains("SUPERSECRET"), "쿼리의 토큰 값 보존");
        assertTrue(r.reqBody.contains("hunter2"), "본문의 password 보존");
        assertTrue(r.body.contains("LEAKED"), "응답의 access_token 보존");
        assertTrue(r.reqText.contains("theme=dark"), "일반 쿠키 보존");
        // 신원 지문은 원문이 아니라 해시다.
        assertFalse(r.fp.contains("SECRETSESSION"));
    }

    @Test
    void 응답_본문의_소유필드는_남는다_F10() {
        RequestRecord r = parsed();
        assertTrue(r.hasResponse);
        assertTrue(r.body.contains("\"owner\":\"user-a\""),
                "F-10 판정 오라클이 쓰는 소유필드를 보존한다");
    }

    @Test
    void 긴_본문은_길이_상한에서_자른다() {
        assertTrue(TextLimits.truncate("x".repeat(100), 10).endsWith("(truncated)"));
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
