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
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id").observedShapes());
        assertEquals(java.util.Set.of(Source.LLM),
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/coupon").observedSources());
        SurfaceAnalysis.ParameterObservation couponObservation = parameter(endpoint,
                SurfaceAnalysis.ParameterLocation.JSON_BODY, "/coupon").observations().getFirst();
        assertEquals(Source.LLM, couponObservation.source());
        assertEquals("llm-run", couponObservation.runId());
        assertEquals("anon", couponObservation.identity());
        assertEquals(200, couponObservation.status());
        assertEquals(SurfaceAnalysis.ValueShape.STRING, couponObservation.shape());
        assertEquals(SurfaceAnalysis.ValueShape.BOOLEAN,
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/filters/active")
                        .observedShapes().iterator().next());
        assertEquals(java.util.Set.of(Source.HUMAN),
                parameter(endpoint, SurfaceAnalysis.ParameterLocation.QUERY, "/sort").observedSources());
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
                parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "/segments/2").requirement());
        assertEquals("orderId", parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "/segments/2").displayName());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(get, SurfaceAnalysis.ParameterLocation.QUERY, "/expand").requirement());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/orders/{id}");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/note").requirement());

        SurfaceAnalysis.EndpointFact form = endpoint(analysis, "GET", "/api/search");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(form, SurfaceAnalysis.ParameterLocation.QUERY, "/keyword").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(form, SurfaceAnalysis.ParameterLocation.QUERY, "/sort").requirement());
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
        assertNotNull(parameter(search, SurfaceAnalysis.ParameterLocation.QUERY, "/sort"));
        assertNotNull(parameter(search, SurfaceAnalysis.ParameterLocation.QUERY, "/page"));
        SurfaceAnalysis.EndpointFact orders = endpoint(analysis, "POST", "/api/orders");
        assertNotNull(parameter(orders, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id"));
        assertNotNull(parameter(orders, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/note"));
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
        assertTrue(orders.parameters().stream().noneMatch(item -> item.fieldPath().equals("/adminOnly")));
        assertTrue(orders.parameters().stream().noneMatch(item -> item.fieldPath().equals("/hiddenFlag")));
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
        assertNotNull(parameter(export, SurfaceAnalysis.ParameterLocation.QUERY, "/product_id"));
        assertNotNull(parameter(export, SurfaceAnalysis.ParameterLocation.QUERY, "/format"));
        assertTrue(export.parameters().stream().noneMatch(item -> item.fieldPath().equals("/intent")));
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
        assertNotNull(parameter(getOrder, SurfaceAnalysis.ParameterLocation.GRAPHQL_VARIABLE, "/id"));
        assertNotNull(parameter(getOrder, SurfaceAnalysis.ParameterLocation.GRAPHQL_VARIABLE, "/includeOwner"));
        assertTrue(getOrder.parameters().stream().noneMatch(item -> item.fieldPath().equals("/query")
                || item.fieldPath().equals("/operationName")));
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
                parameter(form, SurfaceAnalysis.ParameterLocation.FORM_BODY, "/qv").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(form, SurfaceAnalysis.ParameterLocation.FORM_BODY, "/zn").requirement());
        SurfaceAnalysis.EndpointFact multipart = endpoint(analysis, "POST", "/v9/beta");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED,
                parameter(multipart, SurfaceAnalysis.ParameterLocation.MULTIPART_BODY, "/blob").requirement());
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL,
                parameter(multipart, SurfaceAnalysis.ParameterLocation.MULTIPART_BODY, "/tag").requirement());
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
        assertNotNull(parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/aa_z9"));
        assertNotNull(parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/nested_k/r2"));
    }

    @Test
    void 산출물_파싱실패와_입력상한을_빈결과와_구분해_보고한다() {
        String previous = System.getProperty("flowscope.javascript.workerBytes");
        try {
            System.setProperty("flowscope.javascript.workerBytes", "1024");
            RequestRecord oversized = document("/assets/large.js", "application/javascript",
                    "a".repeat(1_025));
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
        } finally {
            if (previous == null) System.clearProperty("flowscope.javascript.workerBytes");
            else System.setProperty("flowscope.javascript.workerBytes", previous);
            io.flowscope.core.discovery.JavascriptCallSiteAnalyzer.clearCache();
        }
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

    @Test
    void OPTIONS는_API기능_관측이_아닌_capability_probe로_분리한다() {
        RequestRecord options = request(Source.LLM, "OPTIONS", "/api/orders/17", 204);
        options.sourceDetail = io.flowscope.core.SourceDetail.LLM_EXPLORER;
        Pipeline.Result result = Pipeline.runIsolated(List.of(options), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        assertTrue(analysis.endpoints().isEmpty());
        assertEquals(1, analysis.probes().size());
        assertEquals("OPTIONS", analysis.probes().getFirst().key().method());
        assertEquals(result.records.getFirst().evidenceId, analysis.probes().getFirst().evidenceId());
    }

    @Test
    void 일반_OPTIONS_API는_기존처럼_기능_관측으로_유지한다() {
        RequestRecord options = request(Source.HUMAN, "OPTIONS", "/api/capabilities", 200);
        Pipeline.Result result = Pipeline.runIsolated(List.of(options), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        assertNotNull(endpoint(analysis, "OPTIONS", "/api/capabilities"));
        assertTrue(analysis.probes().isEmpty());
    }

    @Test
    void LLM_산출물_선언은_실제관측과_분리해_endpoint와_parameter를_보존한다() {
        RouteCandidate candidate = new RouteCandidate("https://app.test:443", "POST", "/api/orders/{id}",
                List.of(), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS,
                        "ev-js", Source.LLM, "llm-run", "llm-javascript",
                        RouteCandidate.Applicability.REVIEW, "app.js:42")),
                RouteCandidate.Applicability.REVIEW, "app.js:42",
                List.of(new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.JSON_BODY,
                        "product_id", "product_id", SurfaceAnalysis.Requirement.UNKNOWN,
                        "ev-js", Source.LLM, "llm-run", "llm-javascript", "app.js:42")));

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(List.of(), List.of(), List.of(candidate));

        SurfaceAnalysis.EndpointFact endpoint = endpoint(analysis, "POST", "/api/orders/{id}");
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, endpoint.deltaState());
        assertEquals(Source.LLM, endpoint.declarations().getFirst().source());
        SurfaceAnalysis.ParameterFact parameter = parameter(endpoint,
                SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id");
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, parameter.deltaState());
        assertEquals("ev-js", parameter.declarations().getFirst().evidenceId());
    }

    @Test
    void 같은_canonical좌표의_선언과_관측은_하나의_ParameterFact로_병합된다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/api/orders":{"post":{"requestBody":{"content":{
                  "application/json":{"schema":{"type":"object","properties":{"product_id":{"type":"integer"}}}}}}}}}}
                """);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/orders", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"product_id\":7}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/orders");
        List<SurfaceAnalysis.ParameterFact> productId = post.parameters().stream()
                .filter(item -> item.location() == SurfaceAnalysis.ParameterLocation.JSON_BODY
                        && item.canonicalPath().equals("/product_id")).toList();
        assertEquals(1, productId.size(), "같은 좌표의 선언·관측은 ParameterFact 하나로 병합해야 한다");
        SurfaceAnalysis.ParameterFact fact = productId.getFirst();
        assertFalse(fact.declarations().isEmpty(), "선언 보존");
        assertFalse(fact.observations().isEmpty(), "관측 보존");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, fact.deltaState());
        assertEquals("/product_id", fact.fieldPath(), "fieldPath는 canonicalPath와 동일한 machine 좌표");
    }

    @Test
    void 점_리터럴_키와_중첩_JSON경로는_다른_canonical좌표로_구분한다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/search", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"filters.active\":true,\"filters\":{\"active\":false}}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/search");
        Set<String> jsonPaths = post.parameters().stream()
                .filter(item -> item.location() == SurfaceAnalysis.ParameterLocation.JSON_BODY)
                .map(SurfaceAnalysis.ParameterFact::canonicalPath).collect(Collectors.toSet());
        assertTrue(jsonPaths.contains("/filters.active"), "리터럴 점 키는 이스케이프 없이 /filters.active");
        assertTrue(jsonPaths.contains("/filters/active"), "중첩 경로는 /filters/active로 구분");
    }

    @Test
    void PATH는_선언이름이_달라도_구조위치가_같으면_병합하고_세그먼트마다_구분한다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/api/users/{userId}/orders/{orderId}":{
                  "get":{"parameters":[{"name":"userId","in":"path","required":true},
                    {"name":"orderId","in":"path","required":true}]}}}}
                """);
        RequestRecord human = request(Source.HUMAN, "GET",
                "/api/users/7f000001-0000-4000-8000-000000000001/orders/550e8400-e29b-41d4-a716-446655440000", 200);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact get = endpoint(analysis, "GET", "/api/users/{id}/orders/{id}");
        SurfaceAnalysis.ParameterFact userSlot = parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "/segments/2");
        SurfaceAnalysis.ParameterFact orderSlot = parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "/segments/4");
        assertNotSame(userSlot, orderSlot, "세그먼트마다 좌표가 구분된다");
        // 선언 이름(userId/orderId)이 구조 좌표(/segments/N)와 무관하게 표시되고, 이름이 아니라 위치로 join한다.
        assertEquals("userId", userSlot.displayName());
        assertEquals("orderId", orderSlot.displayName());
        assertFalse(userSlot.declarations().isEmpty(), "선언 join");
        assertFalse(userSlot.observations().isEmpty(), "관측 join");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, userSlot.deltaState());
        assertTrue(userSlot.observedShapes().contains(SurfaceAnalysis.ValueShape.UUID));
        assertTrue(orderSlot.observedShapes().contains(SurfaceAnalysis.ValueShape.UUID));
    }

    @Test
    void 같은_토큰이라도_QUERY와_FORM_BODY는_다른_ParameterFact다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/list", 200);
        human.query = "sort=asc";
        human.requestContentType = "application/x-www-form-urlencoded";
        human.reqBody = "sort=desc";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/list");
        SurfaceAnalysis.ParameterFact query = parameter(post, SurfaceAnalysis.ParameterLocation.QUERY, "/sort");
        SurfaceAnalysis.ParameterFact form = parameter(post, SurfaceAnalysis.ParameterLocation.FORM_BODY, "/sort");
        assertEquals("/sort", query.canonicalPath());
        assertEquals("/sort", form.canonicalPath());
        assertEquals(2, post.parameters().stream()
                .filter(item -> item.canonicalPath().equals("/sort")).count(), "location이 좌표 identity의 일부");
    }

    @Test
    void JSON_배열은_wildcard로_특수문자_키는_이스케이프로_좌표화한다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/bulk", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"items\":[{\"id\":1}],\"a/b\":1,\"a~b\":2,\"a*b\":3}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/bulk");
        Set<String> paths = post.parameters().stream()
                .filter(item -> item.location() == SurfaceAnalysis.ParameterLocation.JSON_BODY)
                .map(SurfaceAnalysis.ParameterFact::canonicalPath).collect(Collectors.toSet());
        assertTrue(paths.contains("/items/*/id"), "배열 원소는 wildcard 세그먼트");
        assertTrue(paths.contains("/a~1b"), "/ 는 ~1로 이스케이프");
        assertTrue(paths.contains("/a~0b"), "~ 는 ~0으로 이스케이프");
        assertTrue(paths.contains("/a~2b"), "리터럴 * 는 ~2로 이스케이프");
    }

    @Test
    void 본문이_잘려_파싱_실패해도_선언을_관측으로_오인하지_않고_진단만_남긴다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/api/orders":{"post":{"requestBody":{"content":{
                  "application/json":{"schema":{"type":"object","properties":{"a":{"type":"integer"},
                    "b":{"type":"integer"}}}}}}}}}}
                """);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/orders", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"a\":1,\"b\":";
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/orders");
        assertTrue(post.observedSources().contains(Source.HUMAN), "요청은 도달했으므로 endpoint는 관측됨");
        SurfaceAnalysis.ParameterFact declaredA = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/a");
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, declaredA.deltaState(),
                "잘린 본문을 관측으로 오인하지 않는다");
        assertTrue(declaredA.observations().isEmpty());
        assertTrue(analysis.parameterDiagnostics().stream()
                .anyMatch(item -> item.reasonCode().equals("INVALID_JSON")), "파싱 실패 진단 보존");
    }

    @Test
    void LEGACY_V1_점표기_JSON선언은_FLOW_V2_관측과_병합하지_않고_진단을_남긴다() {
        RouteCandidate candidate = new RouteCandidate("https://app.test:443", "POST", "/api/orders",
                List.of(), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS,
                        "ev-js", Source.LLM, "llm-run", "llm-javascript",
                        RouteCandidate.Applicability.REVIEW, "app.js:1")),
                RouteCandidate.Applicability.REVIEW, "app.js:1",
                List.of(new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.JSON_BODY,
                        "filters.active", "filters.active", SurfaceAnalysis.Requirement.UNKNOWN,
                        "ev-js", Source.LLM, "llm-run", "llm-javascript", "app.js:1")));
        RequestRecord human = request(Source.HUMAN, "POST", "/api/orders", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"filters\":{\"active\":true}}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of(candidate));

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/orders");
        SurfaceAnalysis.ParameterFact declared = post.parameters().stream()
                .filter(item -> item.canonicalPath().equals("filters.active")).findFirst().orElseThrow();
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, declared.deltaState(),
                "모호한 legacy 좌표는 관측과 자동 join하지 않는다");
        SurfaceAnalysis.ParameterFact observed = post.parameters().stream()
                .filter(item -> item.canonicalPath().equals("/filters/active")).findFirst().orElseThrow();
        assertEquals(SurfaceAnalysis.DeltaState.OBSERVED_NOT_DECLARED, observed.deltaState());
        assertTrue(analysis.parameterDiagnostics().stream()
                .anyMatch(item -> item.reasonCode().equals("LEGACY_AMBIGUOUS_COORDINATE")), "모호 좌표 진단 보존");
    }

    @Test
    void 직렬화된_SurfaceAnalysis는_원문값_digest_preview_인증정보를_노출하지_않는다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/login", 200);
        human.query = "token=SECRET_QUERY_TOKEN";
        human.requestContentType = "application/json";
        human.reqBody = "{\"password\":\"P@ssw0rd-RAW\",\"id\":\"550e8400-e29b-41d4-a716-446655440000\"}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        String serialized = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(analysis).toString();
        assertFalse(serialized.contains("P@ssw0rd-RAW"), "원문 값 노출 금지");
        assertFalse(serialized.contains("SECRET_QUERY_TOKEN"), "query 원문 노출 금지");
        assertFalse(serialized.contains("550e8400"), "UUID 원문 노출 금지");
        assertFalse(serialized.contains("sha256:"), "digest 노출 금지");
        assertFalse(serialized.toLowerCase().contains("preview"), "preview 필드 노출 금지");
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
