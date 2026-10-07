package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 외부 코드리뷰 지적(#8·#13·#14·#15·#17)에 대한 회귀 테스트.
 * 이 동작들이 다시 깨지면 분석 결과가 조용히 틀려지므로 테스트로 고정한다.
 */
class AccuracyRegressionTest {

    private RequestRecord rec(String path) {
        return new RequestRecord(Source.HUMAN, "https://t:443", "GET", path, 200, "X");
    }

    // ---- #8 경로 이름만으로 정상 API 를 지우면 잘못된 '미관측' 이 된다 ----
    @Test
    void 정상_API는_노이즈로_지우지_않는다() {
        String[] realApis = {
                "/api/analytics/report", "/api/collectors/1", "/api/telemetry-settings",
                "/api/pixel-art/1", "/api/report.txt", "/api/beacon-config", "/api/collect-points/3"
        };
        for (String p : realApis) {
            RequestRecord record = rec(p);
            record.hasResponse = true;
            record.responseContentType = "application/json";
            assertTrue(Pipeline.run(List.of(record)).records.getFirst().trafficClassification.coverageEligible(),
                    "정상 API 를 커버리지에서 제외하면 안 됨: " + p);
        }
    }

    @Test
    void 근거가_일치하는_정적자산만_커버리지에서_제외된다() {
        RequestRecord record = rec("/static/app.4f3a.js");
        record.hasResponse = true;
        record.secFetchDest = "script";
        record.responseContentType = "application/javascript";
        assertFalse(Pipeline.run(List.of(record)).records.getFirst().trafficClassification.coverageEligible());
    }

    // ---- #13 날짜·API 버전을 자원 ID 로 오인하면 커버리지가 왜곡된다 ----
    @Test
    void 날짜_경로는_자원이_아니다() {
        Normalizer.Normalized n = Normalizer.normalize("GET", "/reports/2026/08/24");
        assertNull(n.resource, "날짜는 객체가 아니다");
        assertEquals("GET /reports/2026/08/24", n.op);
    }

    @Test
    void API_버전은_부모_컬렉션이_아니다() {
        Normalizer.Normalized n = Normalizer.normalize("GET", "/v1/2026/users/1");
        assertEquals("users:1", n.resource, "users:1 만 자원, v1/2026 은 아님");
        assertEquals("GET /v1/2026/users/{id}", n.op);
    }

    @Test
    void 버전_뒤_정상_자원은_그대로_인식() {
        Normalizer.Normalized n = Normalizer.normalize("GET", "/api/v2/orders/101");
        assertEquals("orders:101", n.resource);
        assertEquals("GET /api/v2/orders/{id}", n.op);
    }

    // ---- #14 비인증은 일반 사용자 라벨로 섞이면 안 된다 ----
    @Test
    void 비인증은_anon으로_분리된다() {
        List<RequestRecord> recs = List.of(
                new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/a", 200, "anon"),
                new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/b", 200, "sess:abc"));
        recs.get(1).collectionAccountId = "user-a";
        Normalizer.assignIdentities(recs);
        assertEquals("anon", recs.get(0).idn, "비인증은 user-X 로 섞이면 안 됨(F-05)");
        assertEquals("user-a", recs.get(1).idn);
    }

    // ---- #15 응답 없는 항목은 관측이 아니라 후보 ----
    @Test
    void 응답없는_항목은_관측이_아님() {
        String xml = """
                <?xml version="1.0"?>
                <items>
                  <item><method>GET</method><path>/api/a</path><status>200</status>
                    <request base64="false"><![CDATA[GET /api/a HTTP/1.1
                Host: t

                ]]></request>
                    <response base64="false"><![CDATA[HTTP/1.1 200

                {"id":1}]]></response></item>
                  <item><method>GET</method><path>/api/b</path><status>200</status>
                    <request base64="false"><![CDATA[GET /api/b HTTP/1.1
                Host: t

                ]]></request></item>
                </items>
                """;
        List<RequestRecord> recs = BurpXmlParser.parse(xml.getBytes(StandardCharsets.UTF_8), Source.HUMAN);
        assertEquals(2, recs.size());
        assertTrue(recs.get(0).hasResponse, "응답 있는 항목");
        assertFalse(recs.get(1).hasResponse, "응답 없는 항목은 관측 아님(F-02) → 후보로 분리 대상");
    }

    // ---- #17 로케일 독립성 ----
    @Test
    void 터키어_로케일에서도_동일하게_동작() {
        java.util.Locale saved = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(new java.util.Locale("tr", "TR"));
            // "I".toLowerCase() 가 로케일에 따라 'ı' 가 되는 환경
            RequestRecord asset = rec("/static/APP.JS");
            asset.hasResponse = true;
            asset.secFetchDest = "SCRIPT";
            asset.responseContentType = "APPLICATION/JAVASCRIPT";
            assertFalse(Pipeline.run(List.of(asset)).records.getFirst().trafficClassification.coverageEligible());
            RequestRecord api = rec("/api/ITEMS/1");
            api.hasResponse = true;
            api.responseContentType = "application/json";
            assertTrue(Pipeline.run(List.of(api)).records.getFirst().trafficClassification.coverageEligible());
            RequestRecord r = new RequestRecord(Source.HUMAN, "https://t:443", "get", "/api/x", 200, "X");
            assertEquals("GET", r.method, "메서드 대문자화가 로케일에 흔들리면 안 됨");
        } finally {
            java.util.Locale.setDefault(saved);
        }
    }
}
