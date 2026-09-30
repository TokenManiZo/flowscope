package io.flowscope;

import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class RouteCandidateExtractorTest {
    private RequestRecord html(String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://app.test:443",
                "GET", "/app/", 200, "anon");
        record.hasResponse = true;
        record.responseContentType = "text/html";
        record.body = body;
        return Pipeline.run(List.of(record)).records.getFirst();
    }

    @Test
    void 관측_HTML과_Location에서_same_scope_미요청_route만_추출한다() {
        RequestRecord page = html("""
                <link href="/app/app.webmanifest" rel="icon manifest">
                <a href="/app/orders/42">order</a>
                <form method="post" action="/app/orders"><input name="x"></form>
                <a href="https://outside.test/private">outside</a>
                """);
        page.location = "/app/next";

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(page),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("UNKNOWN")
                && value.pathTemplate().equals("/app/orders/{id}")
                && value.provenanceTypes().contains(RouteCandidate.ProvenanceType.HTML_LINK)));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("POST")
                && value.pathTemplate().equals("/app/orders")
                && value.provenanceTypes().contains(RouteCandidate.ProvenanceType.HTML_FORM)));
        assertTrue(candidates.stream().anyMatch(value -> value.pathTemplate().equals("/app/next")
                && value.provenanceTypes().contains(RouteCandidate.ProvenanceType.LOCATION)));
        assertTrue(candidates.stream().anyMatch(value -> value.pathTemplate().equals("/app/app.webmanifest")
                && value.provenanceTypes().contains(RouteCandidate.ProvenanceType.WEB_MANIFEST)));
        assertFalse(candidates.stream().anyMatch(value -> value.service().contains("outside.test")));
        assertTrue(candidates.stream().allMatch(value -> !value.provenanceEvidenceIds().isEmpty()));
    }

    @Test
    void 정규화된_object_template에도_실제로_요청할_concrete_path를_보존한다() {
        RequestRecord page = html("""
                <a href="/app/orders/42?view=full">first</a>
                <a href="/app/orders/77?view=full">second</a>
                """);

        RouteCandidate candidate = find(RouteCandidateExtractor.extract(List.of(page),
                ScopePolicy.parse("https://app.test/app/"), List.of()),
                "UNKNOWN", "/app/orders/{id}");

        assertEquals(List.of("/app/orders/42?view=full", "/app/orders/77?view=full"),
                candidate.concretePaths());
        assertFalse(candidate.concretePathsTruncated());
    }

    @Test
    void concrete_path의_인증_query값은_저장하거나_explorer에_노출하지_않는다() {
        RequestRecord page = html("<a href='/app/orders/42?access_token=raw-secret'>order</a>");

        RouteCandidate candidate = find(RouteCandidateExtractor.extract(List.of(page),
                ScopePolicy.parse("https://app.test/app/"), List.of()),
                "UNKNOWN", "/app/orders/{id}");

        assertEquals(List.of("/app/orders/42"), candidate.concretePaths());
        assertFalse(candidate.toString().contains("raw-secret"));
    }

    @Test
    void 실제_관측_request의_query도_concrete_visit값으로_보존한다() {
        RequestRecord first = new RequestRecord(Source.LLM, "https://app.test:443",
                "GET", "/app/orders/42", 200, "A");
        first.query = "view=full";
        first.hasResponse = true;
        first.responseContentType = "application/json";
        RequestRecord second = new RequestRecord(Source.LLM, "https://app.test:443",
                "GET", "/app/orders/77", 200, "A");
        second.query = "view=summary";
        second.hasResponse = true;
        second.responseContentType = "application/json";
        List<RequestRecord> observed = Pipeline.run(List.of(first, second)).records;

        RouteCandidate candidate = find(RouteCandidateExtractor.extract(observed,
                ScopePolicy.parse("https://app.test/app/"), List.of()),
                "GET", "/app/orders/{id}");

        assertEquals(List.of("/app/orders/42?view=full", "/app/orders/77?view=summary"),
                candidate.concretePaths());
    }

    @Test
    void 고카디널리티_object의_concrete_path는_상한과_초과표시를_유지한다() {
        StringBuilder links = new StringBuilder();
        for (int id = 1; id <= 201; id++) {
            links.append("<a href='/app/orders/").append(id).append("'>order</a>");
        }

        RouteCandidate candidate = find(RouteCandidateExtractor.extract(List.of(html(links.toString())),
                ScopePolicy.parse("https://app.test/app/"), List.of()),
                "UNKNOWN", "/app/orders/{id}");

        assertEquals(200, candidate.concretePaths().size());
        assertTrue(candidate.concretePathsTruncated());
        assertEquals("/app/orders/1", candidate.concretePaths().getFirst());
        assertEquals("/app/orders/200", candidate.concretePaths().getLast());
    }

    @Test
    void 관측_JavaScript_AST는_literal과_구조가_보이는_dynamic_template을_분리한다() {
        RequestRecord script = new RequestRecord(Source.HUMAN, "https://app.test:443",
                "GET", "/app/main.js", 200, "anon");
        script.hasResponse = true;
        script.responseContentType = "application/javascript";
        script.body = "fetch('/app/api/users/7'); fetch('/app/api/orders/9', {method:'POST'}); "
                + "fetch('/app/api/dynamic', options); axios.get('/app/api/orders/' + id);";
        script = Pipeline.run(List.of(script)).records.getFirst();

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(script),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertEquals(4, candidates.size());
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("GET")
                && value.pathTemplate().equals("/app/api/users/{id}")));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("POST")
                && value.pathTemplate().equals("/app/api/orders/{id}")));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("UNKNOWN")
                && value.pathTemplate().equals("/app/api/dynamic")));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("GET")
                && value.pathTemplate().equals("/app/api/orders/{id}")
                && value.concretePaths().isEmpty()));
        assertTrue(candidates.stream().allMatch(value -> value.applicability() == RouteCandidate.Applicability.REVIEW));
    }

    @Test
    void 외부_CDN_스크립트는_페이지_기준_API_선언을_만들되_자체를_API_관측으로_세지않는다() {
        RequestRecord script = new RequestRecord(Source.SCANNER, "https://cdn.test:443",
                "GET", "/assets/main.js", 200, "anon");
        script.hasResponse = true;
        script.responseContentType = "application/javascript";
        script.body = "fetch('/api/orders/42'); fetch('api/search?keyword=test');";
        script.supportingPageUrl = "https://app.test:443/shop/";
        Pipeline.Result result = Pipeline.run(List.of(script));

        assertTrue(result.coverageRecords.isEmpty());
        List<RouteCandidate> routes = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());
        assertTrue(routes.stream().anyMatch(route -> route.service().equals("https://app.test:443")
                && route.pathTemplate().equals("/api/orders/{id}") && !route.observed()));
        assertTrue(routes.stream().anyMatch(route -> route.service().equals("https://app.test:443")
                && route.pathTemplate().equals("/shop/api/search") && !route.observed()));
        assertFalse(routes.stream().anyMatch(route -> route.service().contains("cdn.test")));
        assertTrue(routes.stream().allMatch(route -> route.provenanceEvidenceIds().contains(script.evidenceId)));
    }

    @Test
    void 과거_UNKNOWN_외부_자산은_API_선언의_출처로_승격하지않는다() {
        RequestRecord script = new RequestRecord(Source.UNKNOWN, "https://cdn.test:443",
                "GET", "/main.js", 200, "anon");
        script.hasResponse = true;
        script.responseContentType = "application/javascript";
        script.body = "fetch('/api/private')";
        script.supportingPageUrl = "https://app.test:443/";
        Pipeline.Result result = Pipeline.run(List.of(script));

        assertTrue(RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of()).isEmpty());
    }

    @Test
    void 실제_관측_operation과_미응답_SiteMap후보를_분리하고_분석수를_오염시키지_않는다() {
        RequestRecord observed = new RequestRecord(Source.HUMAN, "https://app.test:443",
                "GET", "/app/api/orders/1", 200, "anon");
        observed.hasResponse = true;
        observed.responseContentType = "application/json";
        Pipeline.Result result = Pipeline.run(List.of(observed));
        RouteCandidateExtractor.Seed unrequested = new RouteCandidateExtractor.Seed(
                "https://app.test/app/admin", "UNKNOWN", RouteCandidate.ProvenanceType.BURP_UNREQUESTED,
                "sitemap:1");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/app/"), List.of(unrequested));

        RouteCandidate seen = candidates.stream().filter(RouteCandidate::observed).findFirst().orElseThrow();
        RouteCandidate missing = candidates.stream().filter(value -> !value.observed()).findFirst().orElseThrow();
        assertEquals("GET", seen.method());
        assertEquals("UNKNOWN", missing.method());
        assertEquals(1, result.coverageRecords.size());
        assertEquals(1, result.analysis.cells().size());
    }

    @Test
    void 후보는_임의점수없이_적용가능성_method_객체_상태변경_근거로_정렬한다() {
        RouteCandidateExtractor.Seed unknownLink = new RouteCandidateExtractor.Seed(
                "https://app.test/app/help", "UNKNOWN", RouteCandidate.ProvenanceType.BURP_UNREQUESTED,
                "sitemap:help");
        RouteCandidateExtractor.Seed writeObject = new RouteCandidateExtractor.Seed(
                "https://app.test/app/orders/9", "DELETE", RouteCandidate.ProvenanceType.BURP_UNREQUESTED,
                "sitemap:order");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(),
                ScopePolicy.parse("https://app.test/app/"), List.of(unknownLink, writeObject));

        assertEquals("DELETE", candidates.getFirst().method());
        assertEquals(List.of("REVIEW", "METHOD_EXPLICIT", "OBJECT_TEMPLATE", "STATE_CHANGING"),
                RouteCandidateExtractor.priorityReasons(candidates.getFirst()));
        assertFalse(RouteCandidateExtractor.priorityReasons(candidates.getFirst()).stream()
                .anyMatch(reason -> reason.contains("CONFIDENCE")));
    }

    @Test
    void 비정형_HTML_base_form_inline_script를_공통_core로_추출한다() {
        RequestRecord page = html("""
                <!doctype html><base href="/app/v2/"><a href=orders/7>order
                <form action=search method=post><button formaction=export formmethod=get>export</button>
                <script>fetch('api/profile'); $.post('api/audit')</script>
                """);

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(page),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertCandidate(candidates, "UNKNOWN", "/app/v2/orders/{id}", "html-dom");
        assertCandidate(candidates, "POST", "/app/v2/search", "html-dom");
        assertCandidate(candidates, "GET", "/app/v2/export", "html-dom");
        assertCandidate(candidates, "GET", "/app/v2/api/profile", "html-dom");
        assertCandidate(candidates, "POST", "/app/v2/api/audit", "html-dom");
    }

    @Test
    void OpenAPI_YAML_server_base와_JSON을_같은_계약으로_추출한다() {
        RequestRecord yaml = document("/app/openapi.yaml", "application/yaml", """
                openapi: 3.1.0
                servers:
                  - url: /app/api/v2
                paths:
                  /orders/{orderId}:
                    get: {}
                    post: {}
                """, Source.SCANNER, "scanner-run");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(yaml),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertCandidate(candidates, "GET", "/app/api/v2/orders/{id}", "openapi-json-yaml");
        RouteCandidate post = find(candidates, "POST", "/app/api/v2/orders/{id}");
        assertTrue(post.concretePaths().isEmpty(), "스키마 template에 실제 관측하지 않은 ID를 만들면 안 된다");
        assertEquals(Set.of(Source.SCANNER), post.discoveredSources());
        assertEquals(Set.of("scanner-run"), post.discoveredRunIds());
    }

    @Test
    void 일반_XML의_명시_route_method만_추출하고_XXE는_거부한다() {
        RequestRecord xml = document("/app/screen.xml", "application/xml", """
                <screen><request action="/app/api/orders" method="POST"/>
                <endpoint>/app/api/profile</endpoint><label>api/not-a-route value</label></screen>
                """, Source.HUMAN, "human-run");
        RequestRecord xxe = document("/app/unsafe.xml", "application/xml", """
                <!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><screen><endpoint>&e;</endpoint></screen>
                """, Source.HUMAN, "human-run");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(xml, xxe),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertCandidate(candidates, "POST", "/app/api/orders", "xml-explicit-route");
        assertCandidate(candidates, "UNKNOWN", "/app/api/profile", "xml-explicit-route");
        assertFalse(candidates.stream().anyMatch(value -> value.pathTemplate().contains("etc/passwd")));
    }

    @Test
    void method_미상_후보는_같은_path의_GET_관측으로_거짓_승격하지_않는다() {
        RequestRecord observed = document("/app/orders/7", "application/json", "{}", Source.HUMAN, "human-run");
        RequestRecord page = html("<a href='/app/orders/7'>order</a>");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(observed, page),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertTrue(find(candidates, "GET", "/app/orders/7").observed());
        assertFalse(find(candidates, "UNKNOWN", "/app/orders/{id}").observed());
    }

    @Test
    void 근거없는_숫자_관측은_route_inventory에서도_literal이다() {
        RequestRecord status = document("/app/status/200", "application/json", "{\"ok\":true}",
                Source.HUMAN, "human-run");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(status),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertTrue(find(candidates, "GET", "/app/status/200").observed());
        assertFalse(candidates.stream().anyMatch(value -> value.pathTemplate().equals("/app/status/{id}")));
    }

    @Test
    void 동일_후보의_source_run_adapter_provenance를_매핑해_결합한다() {
        RequestRecord human = document("/app/h.html", "text/html",
                "<a href='/app/shared'>shared</a>", Source.HUMAN, "human-run");
        RequestRecord llm = document("/app/l.js", "application/javascript",
                "fetch('/app/shared', options)", Source.LLM, "llm-run");

        RouteCandidate candidate = find(RouteCandidateExtractor.extract(List.of(human, llm),
                ScopePolicy.parse("https://app.test/app/"), List.of()), "UNKNOWN", "/app/shared");

        assertEquals(Set.of(Source.HUMAN, Source.LLM), candidate.discoveredSources());
        assertEquals(Set.of("human-run", "llm-run"), candidate.discoveredRunIds());
        assertEquals(2, candidate.provenance().size());
        assertTrue(candidate.provenance().stream().anyMatch(value -> value.source() == Source.HUMAN
                && value.adapter().equals("html-dom") && value.evidenceId().equals(human.evidenceId)));
        assertTrue(candidate.provenance().stream().anyMatch(value -> value.source() == Source.LLM
                && value.adapter().equals("javascript-ast") && value.evidenceId().equals(llm.evidenceId)));
    }

    @Test
    void 모던번들의_정적동적_import와_Next_manifest_chunk를_탐색후보로_보존한다() {
        RequestRecord module = document("/assets/main.mjs", "application/javascript", """
                import './shared.js';
                const feature = './feature.mjs';
                import(feature);
                """, Source.HUMAN, "human-run");
        RequestRecord next = document("/_next/static/build/_buildManifest.js", "application/javascript", """
                self.__BUILD_MANIFEST={"/admin":["static/chunks/pages/admin-a1.js"],
                  "/orders":["static/chunks/pages/orders-b2.js"]};
                """, Source.HUMAN, "human-run");

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(module, next),
                ScopePolicy.parse("https://app.test/"), List.of());

        assertCandidate(candidates, "GET", "/assets/shared.js", "javascript-ast");
        assertCandidate(candidates, "GET", "/assets/feature.mjs", "javascript-ast");
        assertCandidate(candidates, "GET", "/_next/static/chunks/pages/admin-a1.js", "next-build-manifest");
        assertCandidate(candidates, "GET", "/_next/static/chunks/pages/orders-b2.js", "next-build-manifest");
    }

    private RequestRecord document(String path, String mediaType, String body, Source source, String runId) {
        RequestRecord record = new RequestRecord(source, "https://app.test:443", "GET", path, 200, "anon");
        record.hasResponse = true;
        record.responseContentType = mediaType;
        record.body = body;
        record.runId = runId;
        return Pipeline.run(List.of(record)).records.getFirst();
    }

    private static void assertCandidate(List<RouteCandidate> candidates, String method, String path, String adapter) {
        RouteCandidate candidate = find(candidates, method, path);
        assertTrue(candidate.provenance().stream().anyMatch(value -> value.adapter().equals(adapter)),
                () -> "adapter provenance 없음: " + adapter + " in " + candidate);
    }

    private static RouteCandidate find(List<RouteCandidate> candidates, String method, String path) {
        return candidates.stream().filter(value -> value.method().equals(method) && value.pathTemplate().equals(path))
                .findFirst().orElseThrow(() -> new AssertionError("candidate 없음: " + method + " " + path
                        + "\n" + candidates));
    }
}
