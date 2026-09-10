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
        JavascriptAnalysis.CallSite profile = find(analysis, "GET", "/api/api/profile");
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
    void 이전_4MiB_경계를_넘은_script도_격리_worker에서_분석한다() {
        String filler = "const padding = \"" + "x".repeat(4_300_000) + "\";\n";
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(
                filler + "fetch('/api/beyond-former-limit');\n");

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis::detail);
        find(analysis, "GET", "/api/beyond-former-limit");
    }

    @Test
    void 일MiB_초과_script의_뒷부분_call_site도_해석한다() {
        String filler = "const pad" + "x".repeat(64) + " = \"" + "y".repeat(1_200_000) + "\";\n";
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(
                filler + "fetch('/api/notices/recent');\n");

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis.detail());
        assertTrue(analysis.callSites().stream()
                        .anyMatch(site -> site.reference().equals("/api/notices/recent")),
                "1MB 이후 call site를 놓침: " + analysis.callSites());
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

    @Test
    void lexical_scope의_객체_멤버에서_fetch_endpoint를_해석한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const routes = {list:'/api/outer'};
                function inner() {
                  const routes = {list:'/api/inner'};
                  fetch(routes.list);
                }
                fetch(routes.list);
                """);

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis::detail);
        find(analysis, "GET", "/api/inner");
        find(analysis, "GET", "/api/outer");
        assertTrue(analysis.issues().isEmpty(), () -> "unexpected issues: " + analysis.issues());
    }

    @Test
    void 정적_bracket_member와_상대경로를_해석한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const routes = {'list':'../orders'};
                fetch(routes['list']);
                const client = axios.create({baseURL:'https://api.example/v2/groups/'});
                client.get('../members');
                """);

        find(analysis, "GET", "../orders");
        find(analysis, "GET", "https://api.example/v2/members");
    }

    @Test
    void axios_instance_baseURL을_상대_URL과_결합하고_instance별로_격리한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const inventory = axios.create({baseURL:'/api/inventory'});
                const billing = axios.create({baseURL:'/api/billing/'});
                inventory.get('/items', {params:{page:1}});
                billing.post('charges', {amount:100});
                """);

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis::detail);
        assertEquals(Set.of("page"), names(find(analysis, "GET", "/api/inventory/items")));
        assertEquals(Set.of("amount"), names(find(analysis, "POST", "/api/billing/charges")));
        assertTrue(analysis.callSites().stream().noneMatch(item -> item.reference().equals("/items")));
    }

    @Test
    void axios_call별_baseURL_override와_절대_URL_규칙을_적용한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const client = axios.create({baseURL:'/api/default'});
                client.get('/orders', {baseURL:'/api/override'});
                client.get('https://other.example/public');
                client.get('https://other.example/forced', {allowAbsoluteUrls:false});
                """);

        find(analysis, "GET", "/api/override/orders");
        find(analysis, "GET", "https://other.example/public");
        find(analysis, "GET", "/api/default/https://other.example/forced");
    }

    @Test
    void 동적_axios_baseURL은_거짓_상대_endpoint를_만들지_않고_실패를_구조화한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const client = axios.create({baseURL: window.runtimeBase});
                client.get('/inst');
                """);

        assertTrue(analysis.callSites().isEmpty());
        assertTrue(analysis.issues().stream().anyMatch(issue ->
                issue.kind() == JavascriptAnalysis.ResolutionIssueKind.UNRESOLVED_AXIOS_BASE_URL));
    }

    @Test
    void 동적_멤버와_알수없는_wrapper는_endpoint로_추정하지_않고_원인을_구분한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const routes = getRoutes();
                fetch(routes.orders);
                apiClient.load('/service/private/report');
                """);

        assertTrue(analysis.callSites().isEmpty());
        assertTrue(analysis.issues().stream().anyMatch(issue ->
                issue.kind() == JavascriptAnalysis.ResolutionIssueKind.UNRESOLVED_MEMBER_REFERENCE));
        assertTrue(analysis.issues().stream().anyMatch(issue ->
                issue.kind() == JavascriptAnalysis.ResolutionIssueKind.UNRECOGNIZED_APPLICATION_WRAPPER));
    }

    @Test
    void 지역변수가_axios_이름을_가리면_HTTP_client로_오인하지_않는다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                function render() {
                  const axios = {get(value) { return value; }};
                  axios.get('/not-http');
                }
                """);

        assertTrue(analysis.callSites().isEmpty());
    }

    @Test
    void 재할당된_URL과_객체_멤버는_초기값으로_거짓_endpoint를_만들지_않는다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                let route = '/api/initial';
                route = '/api/runtime';
                fetch(route);
                const routes = {list:'/api/old'};
                routes.list = window.runtimeRoute;
                fetch(routes.list);
                """);

        assertTrue(analysis.callSites().isEmpty());
        assertEquals(2, analysis.issues().size());
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
