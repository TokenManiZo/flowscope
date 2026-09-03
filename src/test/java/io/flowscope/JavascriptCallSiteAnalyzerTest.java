package io.flowscope;

import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

final class JavascriptCallSiteAnalyzerTest {
    @Test
    void modern_module_async_optional_syntax를_실행하지_않고_AST로_분석한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                import http from 'axios';
                const base = '/api';
                const client = axios.create({baseURL: base});
                export async function load(id) {
                  const value = window?.state;
                  await fetch(`${base}/orders/${id}?expand=owner`);
                  return http.post(base + '/search', {product_id: id, filters: {active: true}});
                }
                client.get('/api/profile', {params: {view: 'full'}});
                """);

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis::detail);
        assertEquals(3, analysis.callSites().size());
        JavascriptAnalysis.CallSite orders = find(analysis, "GET", "/api/orders/{expr}?expand=owner");
        assertEquals(Set.of("expand"), names(orders));
        JavascriptAnalysis.CallSite search = find(analysis, "POST", "/api/search");
        assertEquals(Set.of("product_id", "filters.active"), names(search));
        JavascriptAnalysis.CallSite profile = find(analysis, "GET", "/api/profile");
        assertEquals(Set.of("view"), names(profile));
    }

    @Test
    void 임의함수와_문자열은_HTTP_call_site로_오인하지_않는다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const route = '/api/not-called';
                audit.get('/api/not-http');
                const xhrMetrics = {open(method, path) { return path; }};
                xhrMetrics.open('GET', '/api/not-xhr');
                const unrelated = {url:'/api/not-config', method:'DELETE', admin:true};
                """);

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status());
        assertTrue(analysis.callSites().isEmpty());
    }

    @Test
    void 입력상한을_넘긴_script는_빈결과가_아니라_제한상태로_보고한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("a".repeat(1_048_577));

        assertEquals(JavascriptAnalysis.Status.LIMIT_EXCEEDED, analysis.status());
        assertTrue(analysis.detail().contains("1048576"));
        assertTrue(analysis.callSites().isEmpty());
    }

    @Test
    void fetch_options와_axios_config는_각_call_site의_parameter만_귀속한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const opts = {method:'PATCH', body:JSON.stringify({status:'paid', meta:{reason:'x'}})};
                fetch('/api/orders/7', opts);
                axios.request({url:'/api/list?page=1', method:'GET', params:{sort:'DESC'}});
                const unrelated = {secretFlag:true};
                """);

        assertEquals(Set.of("status", "meta.reason"), names(find(analysis, "PATCH", "/api/orders/7")));
        assertEquals(Set.of("page", "sort"), names(find(analysis, "GET", "/api/list?page=1")));
        assertTrue(analysis.callSites().stream().flatMap(item -> item.parameters().stream())
                .noneMatch(item -> item.name().equals("secretFlag")));
    }

    private static JavascriptAnalysis.CallSite find(JavascriptAnalysis analysis, String method, String reference) {
        return analysis.callSites().stream()
                .filter(item -> item.method().equals(method) && item.reference().equals(reference))
                .findFirst().orElseThrow(() -> new AssertionError(method + " " + reference + " 없음: " + analysis));
    }

    private static Set<String> names(JavascriptAnalysis.CallSite call) {
        return call.parameters().stream().map(JavascriptAnalysis.Parameter::name).collect(Collectors.toSet());
    }
}
