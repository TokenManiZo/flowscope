package io.flowscope.burp;

import io.flowscope.explorer.ExplorerCoordinator;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The login window reaches no Burp listener, so this assembly is the only path from a CDP observation to Evidence.
 * What it gets wrong is not caught anywhere downstream.
 */
class BrowserExchangeRecordingTest {
    private static ExplorerCoordinator.BrowserExchange exchange(String method, String url,
                                                                Map<String, String> requestHeaders, String requestBody,
                                                                int status, Map<String, String> responseHeaders,
                                                                String responseBody) {
        return new ExplorerCoordinator.BrowserExchange("run-1", "usera", method, url, requestHeaders, requestBody,
                status, responseHeaders, responseBody);
    }

    private static String text(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static String contentLength(String message) {
        return message.lines().filter(line -> line.toLowerCase().startsWith("content-length:"))
                .map(line -> line.substring(line.indexOf(':') + 1).trim()).findFirst().orElse(null);
    }

    @Test
    void requestKeepsTheCookieThatIdentifiesTheLane() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cookie", "session=abc123");
        headers.put("Accept", "application/json");
        String raw = text(FlowScopeExtension.browserRequestBytes(
                exchange("GET", "https://app.example.test/api/me?page=2", headers, "", 200, Map.of(), "")));

        assertTrue(raw.startsWith("GET /api/me?page=2 HTTP/1.1\r\n"), raw);
        assertTrue(raw.contains("\r\nHost: app.example.test\r\n"), raw);
        assertTrue(raw.contains("\r\nCookie: session=abc123\r\n"), raw);
        assertTrue(raw.endsWith("\r\n\r\n"), raw);
    }

    @Test
    void requestBodyIsFramedWithItsOwnLengthNotTheBrowsersClaim() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Content-Length", "9999");
        byte[] bytes = FlowScopeExtension.browserRequestBytes(
                exchange("POST", "http://app.example.test:8080/api/issues", headers, "{\"name\":\"가\"}",
                        200, Map.of(), ""));
        String raw = text(bytes);

        byte[] body = "{\"name\":\"가\"}".getBytes(StandardCharsets.UTF_8);
        assertEquals(String.valueOf(body.length), contentLength(raw));
        assertFalse(raw.contains("9999"), raw);
        assertEquals(1, raw.split("(?i)content-length:", -1).length - 1, raw);
        assertTrue(raw.endsWith("{\"name\":\"가\"}"), raw);
    }

    /** CDP already decoded the body, so a surviving Content-Encoding would make every reader decode garbage. */
    @Test
    void responseDropsTheFramingOfBytesThatNoLongerExist() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Content-Encoding", "gzip");
        headers.put("Content-Length", "31");
        headers.put("Transfer-Encoding", "chunked");
        headers.put("Set-Cookie", "session=abc123; Path=/");
        String raw = text(FlowScopeExtension.browserResponseBytes(
                exchange("GET", "https://app.example.test/api/me", Map.of(), "", 200, headers, "{\"id\":1}")));

        assertTrue(raw.startsWith("HTTP/1.1 200 \r\n"), raw);
        assertFalse(raw.toLowerCase().contains("content-encoding"), raw);
        assertFalse(raw.toLowerCase().contains("transfer-encoding"), raw);
        assertEquals("8", contentLength(raw));
        assertTrue(raw.contains("\r\nSet-Cookie: session=abc123; Path=/\r\n"), raw);
        assertTrue(raw.endsWith("\r\n\r\n{\"id\":1}"), raw);
    }

    @Test
    void emptyBodiesAndHttp2PseudoHeadersDoNotProduceABrokenMessage() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(":method", "GET");
        headers.put(":authority", "app.example.test");
        headers.put("Accept", "*/*");
        String request = text(FlowScopeExtension.browserRequestBytes(
                exchange("GET", "https://app.example.test/", headers, null, 204, Map.of(), null)));
        assertFalse(request.contains(":method"), request);
        assertFalse(request.contains(":authority"), request);
        assertEquals("0", contentLength(request));
        assertTrue(request.endsWith("\r\n\r\n"), request);

        String response = text(FlowScopeExtension.browserResponseBytes(
                exchange("GET", "https://app.example.test/", Map.of(), null, 204, Map.of(), null)));
        assertTrue(response.startsWith("HTTP/1.1 204 \r\n"), response);
        assertEquals("0", contentLength(response));
    }

    /** A header value smuggling CRLF would let page content forge headers into FlowScope's own Evidence. */
    @Test
    void headerInjectionFromPageControlledValuesIsDropped() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Evil", "a\r\nX-Injected: yes");
        headers.put("Bad Name", "x");
        headers.put("Accept", "*/*");
        String raw = text(FlowScopeExtension.browserRequestBytes(
                exchange("GET", "https://app.example.test/", headers, "", 200, Map.of(), "")));
        assertFalse(raw.contains("X-Injected"), raw);
        assertFalse(raw.contains("X-Evil"), raw);
        assertFalse(raw.contains("Bad Name"), raw);
        assertTrue(raw.contains("\r\nAccept: */*\r\n"), raw);
    }

    /** A body the page sent is not re-framed against a stale response length. */
    @Test
    void ipv6AndRootPathsStillProduceAWellFormedRequestLine() {
        String raw = text(FlowScopeExtension.browserRequestBytes(
                exchange("GET", "https://[::1]:8443", Map.of(), "", 200, Map.of(), "")));
        assertTrue(raw.startsWith("GET / HTTP/1.1\r\n"), raw);
        assertTrue(raw.contains("\r\nHost: [::1]:8443\r\n"), raw);
    }
}
