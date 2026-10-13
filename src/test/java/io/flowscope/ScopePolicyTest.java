package io.flowscope;

import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ScopePolicyTest {

    @Test
    void wildcard_도메인은_루트와_모든_하위_도메인만_허용한다() {
        ScopePolicy scope = ScopePolicy.parse("*.Example.test");

        assertTrue(scope.allows("https://example.test/"));
        assertTrue(scope.allows("https://api.example.test/orders"));
        assertTrue(scope.allows("https://a.b.example.test/admin"));
        assertFalse(scope.allows("https://badexample.test/"));
        assertFalse(scope.allows("http://api.example.test/"));
        assertFalse(scope.allows("https://api.example.test:8443/"));
        assertEquals(List.of("https://example.test:443/"), scope.entries());
        assertEquals(List.of("https://*.example.test:443/"), scope.configuredEntries());
    }

    @Test
    void 명시적_URL은_기존처럼_하위_도메인을_허용하지_않는다() {
        ScopePolicy scope = ScopePolicy.parse("https://example.test/");

        assertTrue(scope.allows("https://example.test/"));
        assertFalse(scope.allows("https://api.example.test/"));
        assertEquals(scope.entries(), scope.configuredEntries());
    }

    @Test
    void protocol_host_port_path를_모두_검사한다() {
        ScopePolicy scope = ScopePolicy.parse("https://api.example.test:443/api/v1");
        assertTrue(scope.allows("https://api.example.test/api/v1/orders/1"));
        assertFalse(scope.allows("http://api.example.test/api/v1/orders/1"));
        assertFalse(scope.allows("https://evil.example.test/api/v1/orders/1"));
        assertFalse(scope.allows("https://api.example.test:8443/api/v1/orders/1")); // gitleaks:allow -- reserved test domain
        assertFalse(scope.allows("https://api.example.test/api/v10/orders/1"), "path prefix 경계 우회 차단");
    }

    @Test
    void 빈_스코프는_모든_요청을_차단한다() {
        assertTrue(ScopePolicy.parse("").isEmpty());
        assertFalse(ScopePolicy.parse("").allows("https://example.test/"));
    }

    @Test
    void dot_segment와_인코딩된_경로_우회를_거부한다() {
        ScopePolicy scope = ScopePolicy.parse("https://api.example.test/api");

        assertFalse(scope.allows("https://api.example.test/api/../admin"));
        assertFalse(scope.allows("https://api.example.test/api/%2e%2e/admin"));
        assertFalse(scope.allows("https://api.example.test/api/%252e%252e/admin"));
        assertFalse(scope.allows("https://api.example.test/api%2f..%2fadmin"));
        assertFalse(scope.allows("https://api.example.test/api%5c..%5cadmin"));
    }

    @Test
    void 모호한_스코프_자체도_거부한다() {
        assertThrows(IllegalArgumentException.class,
                () -> ScopePolicy.parse("https://api.example.test/api/../admin"));
        assertThrows(IllegalArgumentException.class,
                () -> ScopePolicy.parse("https://api.example.test/api/%2e%2e/admin"));
    }

    @Test
    void XML_fallback도_범위_밖_관측을_제외한다() {
        BurpXmlParser.ParseResult parsed = new BurpXmlParser.ParseResult();
        parsed.records.add(new RequestRecord(Source.LLM, "https://api.example.test:443",
                "GET", "/api/orders", 200, "anon"));
        parsed.records.add(new RequestRecord(Source.LLM, "https://other.example.test:443",
                "GET", "/api/orders", 200, "anon"));

        BurpXmlParser.retainInScope(parsed, ScopePolicy.parse("https://api.example.test/api"));

        assertEquals(1, parsed.records.size());
        assertEquals("https://api.example.test:443", parsed.records.getFirst().service);
        assertEquals(1, parsed.skipped.size());
    }
}
