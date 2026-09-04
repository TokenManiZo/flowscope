package io.flowscope;

import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SurfaceAnalyzer;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

final class SurfaceAnalyzerTest {
    @Test
    void 관측값은_저장하지_않고_위치_필드경로_형태와_소스만_데이터화한다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/order/search", 200);
        human.query = "sort=DESC&page=2";
        human.requestContentType = "application/json";
        human.reqBody = "{\"product_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"filters\":{\"active\":true}}";
        RequestRecord llm = request(Source.LLM, "POST", "/api/order/search", 200);
        llm.requestContentType = "application/json";
        llm.reqBody = "{\"product_id\":7,\"coupon\":\"WELCOME\"}";

        Pipeline.Result result = Pipeline.runIsolated(List.of(human, llm), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());
        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact endpoint = endpoint(analysis, "POST", "/api/order/search");
        assertEquals(SurfaceAnalysis.DeltaState.MULTI_SOURCE_OBSERVED, endpoint.deltaState());
        assertEquals(java.util.Set.of(Source.HUMAN, Source.LLM), endpoint.observedSources());
        assertEquals(java.util.Set.of(SurfaceAnalysis.ValueShape.UUID, SurfaceAnalysis.ValueShape.INTEGER),
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "product_id").observedShapes());
        assertEquals(java.util.Set.of(Source.LLM),
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "coupon").observedSources());
        SurfaceAnalysis.ParameterObservation couponObservation = parameter(endpoint,
                SurfaceAnalysis.ParameterLocation.JSON_BODY, "coupon").observations().getFirst();
        assertEquals(Source.LLM, couponObservation.source());
        assertEquals("llm-run", couponObservation.runId());
        assertEquals("anon", couponObservation.identity());
        assertEquals(200, couponObservation.status());
        assertEquals(SurfaceAnalysis.ValueShape.STRING, couponObservation.shape());
        assertEquals(SurfaceAnalysis.ValueShape.BOOLEAN,
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "filters.active")
                        .observedShapes().iterator().next());
        assertEquals(java.util.Set.of(Source.HUMAN),
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.QUERY, "sort").observedSources());
        assertFalse(analysis.toString().contains("WELCOME"));
        assertFalse(analysis.toString().contains("550e8400"));
    }

    @Test
    void OpenAPI와_HTML_form의_선언을_관측과_분리하고_미관측으로_표시한다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/api/orders/{orderId}":{
                  "get":{"parameters":[{"name":"orderId","in":"path","required":true},
                    {"name":"expand","in":"query","required":false}]},
                  "post":{"requestBody":{"required":true,"content":{"application/json":{"schema":{
                    "type":"object","required":["product_id"],"properties":{"product_id":{"type":"integer"},
                    "note":{"type":"string"}}}}}}}}}}
                """);
        RequestRecord html = document("/search", "text/html", """
                <form action="/api/search" method="get">
                  <input name="keyword" required><select name="sort"><option>DESC</option></select>
                </form>
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi, html), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact get = endpoint(analysis, "GET", "/api/orders/{id}");
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, get.deltaState());
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "path[3]").requirement());
        assertEquals("orderId", parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "path[3]").displayName());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(get, SurfaceAnalysis.ParameterLocation.QUERY, "expand").requirement());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/orders/{id}");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "product_id").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "note").requirement());

        SurfaceAnalysis.EndpointFact form = endpoint(analysis, "GET", "/api/search");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(form, SurfaceAnalysis.ParameterLocation.QUERY, "keyword").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(form, SurfaceAnalysis.ParameterLocation.QUERY, "sort").requirement());
    }

    @Test
    void 정적_JS는_직접_확인되는_query와_body_key만_선언하고_동적값은_추정하지_않는다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                fetch('/api/search?sort=DESC&page=1');
                fetch('/api/orders', {method:'POST', body: JSON.stringify({product_id: selected, note: memo})});
                const dynamic = '/api/' + moduleName;
                fetch(dynamic);
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(script), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact search = endpoint(analysis, "GET", "/api/search");
        assertNotNull(parameter(search, SurfaceAnalysis.ParameterLocation.QUERY, "sort"));
        assertNotNull(parameter(search, SurfaceAnalysis.ParameterLocation.QUERY, "page"));
        SurfaceAnalysis.EndpointFact orders = endpoint(analysis, "POST", "/api/orders");
        assertNotNull(parameter(orders, SurfaceAnalysis.ParameterLocation.JSON_BODY, "product_id"));
        assertNotNull(parameter(orders, SurfaceAnalysis.ParameterLocation.JSON_BODY, "note"));
        assertTrue(analysis.endpoints().stream().noneMatch(item -> item.key().pathTemplate().contains("moduleName")));
    }

    @Test
    void 정적_JS의_다른_문장에_있는_객체키를_요청_파라미터로_오인하지_않는다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                fetch('/api/orders', {method:'POST'});
                const unrelated = JSON.stringify({adminOnly: true, hiddenFlag: false});
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(script), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact orders = endpoint(analysis, "POST", "/api/orders");
        assertTrue(orders.parameters().stream().noneMatch(item -> item.fieldPath().equals("adminOnly")));
        assertTrue(orders.parameters().stream().noneMatch(item -> item.fieldPath().equals("hiddenFlag")));
    }

    @Test
    void HTML_script_link는_route_inventory에_남지만_API_surface를_오염시키지_않는다() {
        RequestRecord html = document("/", "text/html", """
                <a href="/dashboard">dashboard</a>
                <script src="/assets/app.js"></script>
                <form action="/api/search"><input name="keyword"></form>
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(html), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        assertNotNull(endpoint(analysis, "GET", "/api/search"));
        assertTrue(analysis.endpoints().stream().noneMatch(item -> item.key().pathTemplate().equals("/dashboard")));
        assertTrue(analysis.endpoints().stream().noneMatch(item -> item.key().pathTemplate().equals("/assets/app.js")));
        assertTrue(candidates.stream().anyMatch(item -> item.pathTemplate().equals("/assets/app.js")));
    }

    @Test
    void HTML_formaction은_부모폼_필드와_선택_submitter를_해당_endpoint에_선언한다() {
        RequestRecord html = document("/orders", "text/html", """
                <form action="/api/orders" method="post">
                  <input name="product_id" required>
                  <button name="intent" value="save">save</button>
                  <button name="format" value="csv" formaction="/api/orders/export" formmethod="get">export</button>
                </form>
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(html), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact export = endpoint(analysis, "GET", "/api/orders/export");
        assertNotNull(parameter(export, SurfaceAnalysis.ParameterLocation.QUERY, "product_id"));
        assertNotNull(parameter(export, SurfaceAnalysis.ParameterLocation.QUERY, "format"));
        assertTrue(export.parameters().stream().noneMatch(item -> item.fieldPath().equals("intent")));
    }

    @Test
    void GraphQL은_operation별_endpoint와_variable을_transport필드와_분리한다() {
        RequestRecord first = request(Source.HUMAN, "POST", "/graphql", 200);
        first.requestContentType = "application/json";
        first.reqBody = """
                {"operationName":"GetOrder","query":"query GetOrder($id: ID!){order(id:$id){id}}",
                 "variables":{"id":"a1","includeOwner":true}}
                """;
        RequestRecord second = request(Source.LLM, "POST", "/graphql", 200);
        second.requestContentType = "application/json";
        second.reqBody = """
                {"operationName":"ListOrders","query":"query ListOrders($page:Int){orders(page:$page){id}}",
                 "variables":{"page":2}}
                """;
        Pipeline.Result result = Pipeline.runIsolated(List.of(first, second), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact getOrder = endpoint(analysis, "POST", "/graphql#GetOrder");
        assertNotNull(parameter(getOrder, SurfaceAnalysis.ParameterLocation.GRAPHQL_VARIABLE, "id"));
        assertNotNull(parameter(getOrder, SurfaceAnalysis.ParameterLocation.GRAPHQL_VARIABLE, "includeOwner"));
        assertTrue(getOrder.parameters().stream().noneMatch(item -> item.fieldPath().equals("query")
                || item.fieldPath().equals("operationName")));
        assertNotNull(endpoint(analysis, "POST", "/graphql#ListOrders"));
    }

    @Test
    void OpenAPI3_form과_multipart도_JSON과_같은_범용_입력사실로_분리한다() {
        RequestRecord openapi = document("/schema", "application/json", """
                {"openapi":"3.1.0","paths":{
                  "/v9/alpha":{"post":{"requestBody":{"content":{
                    "application/x-www-form-urlencoded":{"schema":{"type":"object","required":["qv"],
                      "properties":{"qv":{"type":"string"},"zn":{"type":"integer"}}}}
                  }}}},
                  "/v9/beta":{"post":{"requestBody":{"content":{
                    "multipart/form-data":{"schema":{"type":"object","required":["blob"],
                      "properties":{"blob":{"type":"string","format":"binary"},"tag":{"type":"string"}}}}
                  }}}}
                }}
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact form = endpoint(analysis, "POST", "/v9/alpha");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(form, SurfaceAnalysis.ParameterLocation.FORM_BODY, "qv").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(form, SurfaceAnalysis.ParameterLocation.FORM_BODY, "zn").requirement());
        SurfaceAnalysis.EndpointFact multipart = endpoint(analysis, "POST", "/v9/beta");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(multipart, SurfaceAnalysis.ParameterLocation.MULTIPART_BODY, "blob").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(multipart, SurfaceAnalysis.ParameterLocation.MULTIPART_BODY, "tag").requirement());
    }

    @Test
    void 업무명과_무관한_임의_경로와_필드도_동일한_구조규칙으로_분석한다() {
        RequestRecord first = request(Source.HUMAN, "POST", "/xqv/917", 200);
        first.requestContentType = "application/json";
        first.reqBody = "{\"aa_z9\":17,\"nested_k\":{\"r2\":false}}";
        RequestRecord second = request(Source.SCANNER, "POST", "/xqv/918", 200);
        second.requestContentType = "application/json";
        second.reqBody = "{\"aa_z9\":18,\"nested_k\":{\"r2\":true}}";

        Pipeline.Result result = Pipeline.runIsolated(List.of(first, second), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());
        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact endpoint = endpoint(analysis, "POST", "/xqv/{id}");
        assertEquals(java.util.Set.of(Source.HUMAN, Source.SCANNER), endpoint.observedSources());
        assertNotNull(parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "aa_z9"));
        assertNotNull(parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "nested_k.r2"));
    }

    @Test
    void 산출물_파싱실패와_입력상한을_빈결과와_구분해_보고한다() {
        RequestRecord oversized = document("/assets/large.js", "application/javascript",
                "a".repeat(4_194_305));
        RequestRecord invalidOpenApi = document("/openapi.json", "application/json", "{not-json");
        Pipeline.Result result = Pipeline.runIsolated(List.of(oversized, invalidOpenApi),
                new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        assertTrue(analysis.extractions().stream().anyMatch(report ->
                report.failure() == SurfaceAnalysis.ExtractionFailure.INPUT_SIZE_LIMIT
                        && report.status() == SurfaceAnalysis.ExtractionStatus.LIMIT_EXCEEDED));
        assertTrue(analysis.extractions().stream().anyMatch(report ->
                report.artifactKind().equals("OPENAPI")
                        && report.failure() == SurfaceAnalysis.ExtractionFailure.PARSE_FAILED));
    }

    @Test
    void JavaScript_call_site_해석실패를_정상파싱_0건과_구분한다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                const client = axios.create({baseURL: window.runtimeBase});
                client.get('/orders');
                const routes = loadRoutes();
                fetch(routes.admin);
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(script), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.ExtractionReport report = analysis.extractions().getFirst();
        assertEquals(SurfaceAnalysis.ExtractionStatus.PARSED, report.status());
        assertEquals(0, report.endpointCallSites());
        assertEquals(Set.of(SurfaceAnalysis.ExtractionIssueKind.UNRESOLVED_AXIOS_BASE_URL,
                        SurfaceAnalysis.ExtractionIssueKind.UNRESOLVED_MEMBER_REFERENCE),
                report.issues().stream().map(SurfaceAnalysis.ExtractionIssue::kind).collect(Collectors.toSet()));
    }

    private static RequestRecord request(Source source, String method, String path, int status) {
        RequestRecord record = new RequestRecord(source, "https://app.test:443", method, path, status, "anon");
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.body = "{}";
        record.runId = source.name().toLowerCase() + "-run";
        return record;
    }

    private static RequestRecord document(String path, String mediaType, String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://app.test:443", "GET", path, 200, "anon");
        record.hasResponse = true;
        record.responseContentType = mediaType;
        record.body = body;
        record.runId = "human-run";
        return record;
    }

    private static SurfaceAnalysis.EndpointFact endpoint(SurfaceAnalysis analysis, String method, String path) {
        return analysis.endpoints().stream()
                .filter(item -> item.key().method().equals(method) && item.key().pathTemplate().equals(path))
                .findFirst().orElseThrow();
    }

    private static SurfaceAnalysis.ParameterFact parameter(SurfaceAnalysis.EndpointFact endpoint,
                                                           SurfaceAnalysis.ParameterLocation location,
                                                           String path) {
        return endpoint.parameters().stream()
                .filter(item -> item.location() == location && item.fieldPath().equals(path))
                .findFirst().orElseThrow();
    }
}
