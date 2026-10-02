package io.flowscope;

import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
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
    void 라우터_설정_객체의_정적_화면_경로를_찾는다() {
        // crAPI 번들의 React Router v6 형태(실측)와 Vue Router·Angular의 공식 route 객체.
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const SHOP = "/shop";
                jsx(Route, {path: SHOP, element: jsx(Guard, {component: Shop})});
                jsx(Route, {path: "/service-report", element: jsx(Report, {})});
                jsx(Route, {path: "/post/:id", element: jsx(Post, {})});
                jsx(Route, {path: "*", element: jsx(NotFound, {})});
                const vue = [{path: '/forum', component: Forum}, {path: '/orders', children: []}];
                const angular = [{path: '/mechanic-dashboard', loadComponent: () => import('./m.js')}];
                const data = {path: '/not-a-route', size: 3};
                const svg = {path: 'M0 0L10 10', element: 'path'};
                """);

        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis::detail);
        assertEquals(List.of("/shop", "/service-report", "/forum", "/orders", "/mechanic-dashboard"),
                analysis.clientRoutes().stream().map(JavascriptAnalysis.ClientRoute::path).toList());
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
        // 사용 직전에 직선으로 대입된 값('/api/runtime')은 실제 요청 경로다. 오래된 초기값('/api/initial')과
        // 속성 변경으로 바뀐 객체 멤버는 여전히 풀지 않는다.
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                let route = '/api/initial';
                route = '/api/runtime';
                fetch(route);
                const routes = {list:'/api/old'};
                routes.list = window.runtimeRoute;
                fetch(routes.list);
                """);

        assertEquals(List.of("/api/runtime"), analysis.callSites().stream().map(call -> call.reference()).toList());
        assertEquals(1, analysis.issues().size());
    }

    @Test
    void 분기_안의_재할당은_순서를_단정할_수_없어_풀지_않고_긴_한줄_번들에서도_순서를_구조로_판단한다() {
        StringBuilder minified = new StringBuilder();
        for (int i = 0; i < 600; i++) minified.append("var p").append(i).append('=').append(i).append(';');
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(minified
                + "function*load(e){let t;e=\"api/v2/items\";t=yield fetch(\"/svc/\"+e,{headers:{}});return t}"
                + "function save(u){let r='/api/a';if(u)r='/api/b';fetch(r)}");

        assertTrue(analysis.callSites().stream()
                .anyMatch(call -> "/svc/api/v2/items".equals(call.reference()) && "GET".equals(call.method())),
                analysis.callSites().toString());
        assertTrue(analysis.callSites().stream().anyMatch(call -> "/api/a".equals(call.reference())),
                "the dominating declaration is used; the conditional branch is not assumed");
        assertFalse(analysis.callSites().stream().anyMatch(call -> "/api/b".equals(call.reference())));
    }

    @Test
    void 경로_변수를_replace로_채우거나_쿼리_템플릿을_이어붙인_URL을_푼다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                const base = 'workshop/', api = {POST_BY_ID:'api/v2/posts/<postId>', LIST:'api/shop/products'};
                function* byId(id) { const e = base + api.POST_BY_ID; yield fetch(e.replace('<postId>', id)); }
                function* list(page) { const e = base + api.LIST + `?limit=30&offset=${page}`; yield fetch(e, {headers:{}}); }
                """);

        assertTrue(analysis.callSites().stream()
                .anyMatch(call -> call.reference().equals("workshop/api/v2/posts/{expr}")), analysis.callSites().toString());
        assertTrue(analysis.callSites().stream()
                .anyMatch(call -> call.reference().startsWith("workshop/api/shop/products?limit=30") && "GET".equals(call.method())),
                analysis.callSites().toString());
    }

    @Test
    void 중첩_객체와_배열_원소_객체의_body_key는_AST_세그먼트를_보존한다() {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze("""
                fetch('/api/items', {method:'POST', body:JSON.stringify({meta:{reason:'x'}, "a.b": 1, "*": 2, items:[{id: 1}], tags:['t']})});
                """);

        JavascriptAnalysis.CallSite call = find(analysis, "POST", "/api/items");
        Map<String, List<JavascriptAnalysis.Segment>> segments = new java.util.LinkedHashMap<>();
        call.parameters().forEach(parameter -> segments.put(parameter.name(), parameter.segments()));
        JavascriptAnalysis.Segment meta = new JavascriptAnalysis.Segment("meta", false);
        assertEquals(List.of(meta, new JavascriptAnalysis.Segment("reason", false)), segments.get("meta.reason"), "중첩은 세그먼트로 보존");
        assertEquals(List.of(new JavascriptAnalysis.Segment("a.b", false)), segments.get("a.b"), "리터럴 점 키는 한 세그먼트");
        assertEquals(List.of(new JavascriptAnalysis.Segment("*", false)), segments.get("*"), "리터럴 * 키는 배열 원소가 아닌 키 세그먼트");
        assertEquals(List.of(new JavascriptAnalysis.Segment("items", false), JavascriptAnalysis.Segment.element(),
                new JavascriptAnalysis.Segment("id", false)), segments.get("items[].id"), "배열 원소 객체는 wildcard 세그먼트");
        assertEquals(List.of(new JavascriptAnalysis.Segment("items", false)), segments.get("items"), "배열 필드 자체");
        assertEquals(List.of(new JavascriptAnalysis.Segment("tags", false)), segments.get("tags"));
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
