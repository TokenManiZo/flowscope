package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 보안 회귀 테스트: Burp XML 은 신뢰할 수 없는 입력이다.
 * 과거 결함(P0): 외부 DTD 로딩만 끄고 DOCTYPE/외부 엔티티를 허용해 file:///etc/hosts 가 읽혔다.
 */
class XxeSecurityTest {

    private static byte[] xml(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void 외부엔티티로_로컬파일_읽기_차단() {
        String payload = """
                <?xml version="1.0"?>
                <!DOCTYPE items [ <!ENTITY xxe SYSTEM "file:///etc/hosts"> ]>
                <items>
                  <item>
                    <method>GET</method>
                    <path>&xxe;</path>
                    <status>200</status>
                    <request base64="false"><![CDATA[GET / HTTP/1.1

                ]]></request>
                  </item>
                </items>
                """;
        // DOCTYPE 자체를 거부하므로 문서 단위 파싱 실패가 정상 동작
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> BurpXmlParser.parse(xml(payload), Source.HUMAN));
        assertTrue(ex.getMessage().contains("파싱 실패"), "DOCTYPE 은 거부되어야 한다");
    }

    @Test
    void 파라미터엔티티_DOCTYPE도_차단() {
        String payload = """
                <?xml version="1.0"?>
                <!DOCTYPE items [ <!ENTITY % pe SYSTEM "file:///etc/passwd"> %pe; ]>
                <items><item><method>GET</method><path>/a</path><status>200</status></item></items>
                """;
        assertThrows(RuntimeException.class, () -> BurpXmlParser.parse(xml(payload), Source.HUMAN));
    }

    @Test
    void 엔티티확장_DoS_billion_laughs_차단() {
        String payload = """
                <?xml version="1.0"?>
                <!DOCTYPE lolz [
                  <!ENTITY lol "lol">
                  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
                  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
                ]>
                <items><item><method>GET</method><path>&lol3;</path><status>200</status></item></items>
                """;
        assertThrows(RuntimeException.class, () -> BurpXmlParser.parse(xml(payload), Source.HUMAN));
    }

    @Test
    void 정상_XML은_여전히_파싱됨() throws Exception {
        try (var in = getClass().getResourceAsStream("/sample/human.xml")) {
            assertNotNull(in);
            List<RequestRecord> recs = BurpXmlParser.parse(in.readAllBytes(), Source.HUMAN);
            assertEquals(6, recs.size(), "정상 입력은 영향 없어야 한다");
        }
    }
}
