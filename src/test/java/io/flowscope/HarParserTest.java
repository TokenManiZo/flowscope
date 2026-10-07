package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.HarParser;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

final class HarParserTest {

    @Test
    void zapHar의_요청응답문맥을_scanner_evidence로_보존한다() {
        String har = """
                {
                  "log": {
                    "version": "1.2",
                    "creator": {"name": "OWASP ZAP", "version": "2.17.0"},
                    "entries": [{
                      "startedDateTime": "2026-08-30T10:20:30.123+09:00",
                      "request": {
                        "method": "POST",
                        "url": "https://api.example.test:8443/orders/101?view=full&token=raw-query-secret",
                        "httpVersion": "HTTP/2",
                        "headers": [
                          {"name": "Authorization", "value": "Bearer raw-access-token"},
                          {"name": "Cookie", "value": "sid=raw-cookie"},
                          {"name": "Content-Type", "value": "application/json"}
                        ],
                        "postData": {"mimeType": "application/json", "text": "{\\\"password\\\":\\\"raw-password\\\",\\\"orderId\\\":101}"}
                      },
                      "response": {
                        "status": 200,
                        "statusText": "OK",
                        "httpVersion": "HTTP/2",
                        "headers": [
                          {"name": "Content-Type", "value": "application/json"},
                          {"name": "Location", "value": "/orders/101"}
                        ],
                        "content": {"mimeType": "application/json", "encoding": "base64", "text": "eyJvcmRlcklkIjoxMDEsIm5hbWUiOiJ0ZXN0In0="}
                      }
                    }]
                  }
                }
                """;

        RequestRecord record = HarParser.parseDetailed(har.getBytes(StandardCharsets.UTF_8)).records.getFirst();

        assertEquals(Source.SCANNER, record.source);
        assertEquals(SourceDetail.HAR_IMPORT, record.sourceDetail);
        assertEquals(ToolKind.ZAP, record.tool);
        assertEquals(RunPhase.IMPORT, record.phase);
        assertEquals(ExecutionTrust.IMPORTED, record.executionTrust);
        assertEquals("har-import", record.runId);
        assertEquals("https://api.example.test:8443", record.service);
        assertEquals("POST", record.method);
        assertEquals("/orders/101", record.path);
        // HAR의 쿼리·본문·인증 헤더는 원문 그대로 가져온다.
        assertEquals("view=full&token=raw-query-secret", record.query);
        assertTrue(record.reqText.contains("raw-access-token"));
        assertTrue(record.reqText.contains("raw-cookie"));
        assertTrue(record.reqText.contains("raw-password"));
        assertTrue(record.fp.startsWith("tok:"));
        assertEquals(200, record.status);
        assertTrue(record.hasResponse);
        assertEquals("{\"orderId\":101,\"name\":\"test\"}", record.body);
        assertEquals("/orders/101", record.location);
        assertEquals("application/json", record.requestContentType);
        assertEquals("application/json", record.responseContentType);
        assertEquals(1788052830123L, record.timestamp);
        assertNotNull(record.requestPayload);
        assertNotNull(record.responsePayload);
    }

    @Test
    void 응답없는_entry는_후보로_보존하고_잘못된_entry만_건너뛴다() {
        String har = """
                {"log":{"version":"1.2","entries":[
                  {"request":{"method":"GET","url":"http://127.0.0.1:8888/api/pending","headers":[]},
                   "response":{"status":0,"statusText":"","headers":[],"content":{"text":""}}},
                  {"request":{"method":"GET","url":"file:///tmp/not-http","headers":[]},
                   "response":{"status":200,"headers":[],"content":{"text":"ignored"}}},
                  {"request":{"method":"","url":"http://127.0.0.1:8888/missing-method","headers":[]}}
                ]}}
                """;

        BurpXmlParser.ParseResult result = HarParser.parseDetailed(har.getBytes(StandardCharsets.UTF_8));

        assertEquals(1, result.records.size());
        assertFalse(result.records.getFirst().hasResponse);
        assertEquals(0, result.records.getFirst().status);
        assertEquals(2, result.skipped.size());
    }

    @Test
    void har도_exact_scope_밖_관측을_제외한다() {
        String har = """
                {"log":{"version":"1.2","entries":[
                  {"request":{"method":"GET","url":"https://api.example.test/v1/orders","headers":[]},"response":{"status":200,"headers":[],"content":{"text":"{}"}}},
                  {"request":{"method":"GET","url":"https://api.example.test/admin","headers":[]},"response":{"status":200,"headers":[],"content":{"text":"{}"}}},
                  {"request":{"method":"GET","url":"https://other.example/v1/orders","headers":[]},"response":{"status":200,"headers":[],"content":{"text":"{}"}}}
                ]}}
                """;
        BurpXmlParser.ParseResult result = HarParser.parseDetailed(har.getBytes(StandardCharsets.UTF_8));

        BurpXmlParser.retainInScope(result, ScopePolicy.parse("https://api.example.test/v1"));

        assertEquals(1, result.records.size());
        assertEquals("/v1/orders", result.records.getFirst().path);
        assertEquals(2, result.skipped.stream().filter(value -> value.startsWith("scope 밖")).count());
    }

    @Test
    void binary_base64_응답은_본문을_문자열로_왜곡하지_않고_metadata만_남긴다() {
        String har = """
                {"log":{"version":"1.2","entries":[{
                  "request":{"method":"GET","url":"https://api.example.test/image.png","headers":[]},
                  "response":{"status":200,"headers":[{"name":"Content-Type","value":"image/png"}],
                    "content":{"mimeType":"image/png","encoding":"base64","text":"AAEC"}}
                }]}}
                """;

        RequestRecord record = HarParser.parseDetailed(har.getBytes(StandardCharsets.UTF_8)).records.getFirst();

        assertTrue(record.hasResponse);
        assertNull(record.body);
        assertEquals(io.flowscope.core.StoredPayload.Retention.BINARY_METADATA_ONLY,
                record.responsePayload.retention());
        assertFalse(record.responsePayload.retained());
    }

    @Test
    void har_문서형식이_아니면_항목_0건으로_성공시키지_않는다() {
        assertThrows(IllegalArgumentException.class,
                () -> HarParser.parseDetailed("{\"entries\":[]}".getBytes(StandardCharsets.UTF_8)));
        assertThrows(IllegalArgumentException.class,
                () -> HarParser.parseDetailed("not-json".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void ipv6_url을_중복_대괄호_없이_service로_정규화한다() {
        String har = """
                {"log":{"version":"1.2","entries":[{
                  "request":{"method":"GET","url":"http://[::1]:8080/health","headers":[]},
                  "response":{"status":200,"headers":[],"content":{"text":"ok"}}
                }]}}
                """;

        RequestRecord record = HarParser.parseDetailed(har.getBytes(StandardCharsets.UTF_8)).records.getFirst();

        assertEquals("http://[::1]:8080", record.service);
    }
}
