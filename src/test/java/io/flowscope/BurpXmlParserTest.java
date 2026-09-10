package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
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

    @Test
    void 명시된_본문_문자셋을_보존한다() {
        Charset eucKr = Charset.forName("EUC-KR");
        byte[] request = messageBytes(
                "POST /submit HTTP/1.1\r\nHost: example.test\r\n"
                        + "Content-Type: application/x-www-form-urlencoded; charset=EUC-KR\r\n\r\n",
                "name=한글", eucKr);
        byte[] response = messageBytes(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=EUC-KR\r\n\r\n",
                "성공", eucKr);

        RequestRecord record = BurpXmlParser.parse(
                xml("example.test", "8080", "http", request, response).getBytes(StandardCharsets.UTF_8),
                Source.HUMAN).getFirst();

        assertEquals("name=한글", record.reqBody);
        assertEquals("성공", record.body);
        assertTrue(record.reqText.endsWith("name=한글"));
        assertTrue(record.respText.endsWith("성공"));
    }

    @Test
    void ipv6_host와_port를_하나의_service로_정규화한다() {
        byte[] request = "GET /health HTTP/1.1\r\nHost: [::1]:8443\r\n\r\n"
                .getBytes(StandardCharsets.ISO_8859_1);
        byte[] response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nok"
                .getBytes(StandardCharsets.ISO_8859_1);

        RequestRecord record = BurpXmlParser.parse(
                xml("::1", "8443", "https", request, response).getBytes(StandardCharsets.UTF_8),
                Source.HUMAN).getFirst();

        assertEquals("https://[::1]:8443", record.service);
    }

    private static byte[] messageBytes(String headers, String body, Charset charset) {
        byte[] head = headers.getBytes(StandardCharsets.ISO_8859_1);
        byte[] content = body.getBytes(charset);
        byte[] result = new byte[head.length + content.length];
        System.arraycopy(head, 0, result, 0, head.length);
        System.arraycopy(content, 0, result, head.length, content.length);
        return result;
    }

    private static String xml(String host, String port, String protocol, byte[] request, byte[] response) {
        return "<items><item>"
                + "<time>2026-09-10T12:00:00</time>"
                + "<url>http://example.test/</url>"
                + "<host>" + host + "</host><port>" + port + "</port><protocol>" + protocol + "</protocol>"
                + "<method>POST</method><path>/submit</path><extension>null</extension>"
                + "<request base64=\"true\">" + Base64.getEncoder().encodeToString(request) + "</request>"
                + "<status>200</status><response base64=\"true\">"
                + Base64.getEncoder().encodeToString(response) + "</response>"
                + "</item></items>";
    }
}
