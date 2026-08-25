package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BurpXmlParserTest {

    private byte[] load(String path) throws Exception {
        try (InputStream in = getClass().getResourceAsStream(path)) {
            assertNotNull(in, "리소스 없음: " + path);
            return in.readAllBytes();
        }
    }

    @Test
    void 사람_샘플_파싱() throws Exception {
        List<RequestRecord> recs = BurpXmlParser.parse(load("/sample/human.xml"), Source.HUMAN);
        assertEquals(6, recs.size());

        RequestRecord first = recs.get(0);
        assertEquals(Source.HUMAN, first.source);
        assertEquals("GET", first.method);
        assertEquals("/api/orders/101", first.path);
        assertEquals(200, first.status);
        assertTrue(first.fp.startsWith("sess:"), "Cookie session= 을 해시한 fp");
        assertFalse(first.fp.contains("AAA"), "원문 토큰 미저장(F-05)");
        assertTrue(first.hasResponse, "응답 본문 파싱됨(F-02)");
    }

    @Test
    void 관리자_세션_fp_구분() throws Exception {
        List<RequestRecord> recs = BurpXmlParser.parse(load("/sample/human.xml"), Source.HUMAN);
        RequestRecord adminUsers = recs.stream()
                .filter(r -> r.path.equals("/api/admin/users")).findFirst().orElseThrow();
        List<RequestRecord> all = BurpXmlParser.parse(load("/sample/human.xml"), Source.HUMAN);
        RequestRecord userA = all.get(0);
        assertNotEquals(userA.fp, adminUsers.fp, "다른 세션은 다른 fp 로 구분");
    }

    @Test
    void 스캐너_샘플_파싱() throws Exception {
        List<RequestRecord> recs = BurpXmlParser.parse(load("/sample/scanner.xml"), Source.SCANNER);
        assertEquals(4, recs.size());
        assertTrue(recs.stream().allMatch(r -> r.source == Source.SCANNER));
    }
}
