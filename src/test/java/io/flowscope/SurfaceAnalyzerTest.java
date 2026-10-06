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
        // 파라미터 값은 저장하지 않는다. 4단계 link/cell의 resource(객체 키 `product:<id>`)는 인가 정본이 이미 공개하는
        // 객체 식별자라 값 검사에서 그 필드만 제외한다(같은 UUID가 객체 키이기도 함).
        String withoutResourceKeys = withoutResourceKeys(analysis);
        assertFalse(withoutResourceKeys.contains("WELCOME"));
        assertFalse(withoutResourceKeys.contains("550e8400"));
        assertTrue(parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id").authorizationTargets()
                .stream().allMatch(link -> link.resource() == null || link.resource().startsWith("https://app.test:443 ")),
                "link resource는 인가 정본의 객체 키 형식이다");
    }

    /** 직렬화 결과에서 인가 객체 키 필드(resource/targetResource)만 제거한다. 값 노출 검사용. */
    private static String withoutResourceKeys(SurfaceAnalysis analysis) {
        String serialized = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(analysis).toString();
        return serialized.replaceAll("\"(?:resource|targetResource)\":\"[^\"]*\"", "");
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
        assertTrue(orders.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/adminOnly")));
        assertTrue(orders.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/hiddenFlag")));
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
        assertTrue(export.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/intent")));
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
        assertTrue(getOrder.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/query")
                || item.canonicalPath().equals("/operationName")));
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
        // binary 파일 파트는 엔진이 관측하지 않으므로(text field만) 선언하면 영구 거짓 미관측 gap이 된다 — PR#11 규칙대로 제외.
        assertTrue(multipart.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/blob")));
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
        assertEquals("product_id", fact.fieldPath(), "fieldPath는 사람이 읽는 표시 경로(기계 좌표는 canonicalPath)");
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
        assertEquals("userId", userSlot.fieldPath(), "PATH 표시 경로는 /segments/N이 아니라 선언명");
        assertEquals("/segments/2", userSlot.canonicalPath());
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
        assertEquals(SurfaceAnalysis.DeltaState.UNRESOLVED_COORDINATE, declared.deltaState(),
                "모호한 legacy 좌표는 UNRESOLVED_COORDINATE로 남아 Gap 승격 대상이 아니다");
        assertFalse(declared.coordinateResolved());
        assertFalse(declared.declarations().getFirst().coordinateResolved());
        assertEquals(io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion.LEGACY_V1,
                declared.declarations().getFirst().coordinateVersion());
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
        // `id` 값은 인가 정본의 객체 키(resource)로도 쓰이므로 그 필드를 뺀 나머지에서 값 노출을 검사한다(4단계).
        assertFalse(withoutResourceKeys(analysis).contains("550e8400"), "UUID 원문 노출 금지");
        assertFalse(serialized.contains("\"digest\""), "값 digest 필드 노출 금지");
        // sha256:는 요청 값 digest가 아니라 요청 단위 구조 서명(contextSignature·profile.contextPresence 키)과
        // 좌표만으로 만든 gap ID(pg:v1:/pg:auth:)에만 허용된다. 모두 값이 아닌 구조·좌표의 digest다(3·4단계 범위 확장, 의미 동일).
        String withoutSignatures = serialized.replaceAll("ctx:v1:sha256:[0-9a-f]+", "")
                .replaceAll("pg:(?:v1|auth):sha256:[0-9a-f]+", "");
        assertFalse(withoutSignatures.contains("sha256:"), "구조 서명·gap 좌표 ID 외 digest 노출 금지");
        assertFalse(serialized.toLowerCase().contains("preview"), "preview 필드 노출 금지");
    }

    @Test
    void JS_body는_AST_구조를_보존해_중첩_리터럴점키_배열원소를_구분하고_관측과_join한다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                fetch('/api/search', {method:'POST', body: JSON.stringify({
                  criteria: {status: state, tags: ['new']},
                  "criteria.status": literalDot,
                  items: [{id: selected}],
                  cursor: null
                })});
                """);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/search", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"criteria\":{\"status\":true,\"tags\":[\"x\"]},\"items\":[{\"id\":1}],\"cursor\":null}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(script, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/search");
        SurfaceAnalysis.ParameterFact nested = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria/status");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, nested.deltaState(),
                "AST 중첩 객체는 pointer 세그먼트로 확정되어 관측과 join");
        assertTrue(nested.coordinateResolved());
        assertEquals("criteria.status", nested.fieldPath());
        SurfaceAnalysis.ParameterFact literal = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria.status");
        assertEquals(SurfaceAnalysis.DeltaState.DECLARED_NOT_OBSERVED, literal.deltaState(),
                "리터럴 점 키는 중첩과 다른 확정 좌표");
        assertTrue(literal.coordinateResolved());
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/items/*/id").deltaState(),
                "배열 원소 객체 필드는 wildcard 세그먼트로 join");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria/tags").deltaState(),
                "배열 필드 자체도 선언");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/cursor").deltaState());
        assertTrue(post.parameters().stream().allMatch(SurfaceAnalysis.ParameterFact::coordinateResolved),
                "AST 세그먼트가 있는 JS 선언은 미확정이 없다");
        assertTrue(analysis.parameterDiagnostics().stream()
                .noneMatch(item -> item.reasonCode().equals("UNRESOLVED_PARAMETER_COORDINATE")));
    }

    @Test
    void 표시_경로는_기계_좌표와_분리되어_사람이_읽는_형태다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/order/search", 200);
        human.query = "sort=DESC";
        human.requestContentType = "application/json";
        human.reqBody = "{\"filters\":{\"active\":true},\"items\":[{\"id\":1}]}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/order/search");
        SurfaceAnalysis.ParameterFact nested = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/filters/active");
        assertEquals("filters.active", nested.fieldPath());
        assertEquals("active", nested.displayName());
        SurfaceAnalysis.ParameterFact element = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/items/*/id");
        assertEquals("items[].id", element.fieldPath());
        SurfaceAnalysis.ParameterFact sort = parameter(post, SurfaceAnalysis.ParameterLocation.QUERY, "/sort");
        assertEquals("sort", sort.fieldPath());
        assertEquals("sort", sort.displayName());
        assertTrue(post.parameters().stream().noneMatch(item -> item.fieldPath().startsWith("/")),
                "기계 좌표(/...)가 표시 경로로 새지 않는다");
    }

    @Test
    void 관측은_요청_단위_contextSignature를_보존한다() {
        RequestRecord human = request(Source.HUMAN, "POST", "/api/order/search", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"product_id\":7,\"coupon\":\"WELCOME\"}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(human), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/order/search");
        String product = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/product_id")
                .observations().getFirst().contextSignature();
        String coupon = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/coupon")
                .observations().getFirst().contextSignature();
        assertNotNull(product);
        assertTrue(product.startsWith("ctx:v1:"), "조건 조합 분석용 요청 단위 서명");
        assertEquals(product, coupon, "같은 요청의 파라미터는 같은 context signature");
        assertFalse(product.contains("WELCOME"));
    }

    @Test
    void distinct_값_집계는_상한에서_잘리고_truncated와_진단을_남긴다() {
        List<RequestRecord> records = new java.util.ArrayList<>();
        for (int i = 0; i < SurfaceAnalyzer.MAX_DISTINCT_VALUES + 4; i++) {
            RequestRecord human = request(Source.HUMAN, "POST", "/api/items", 200);
            human.requestContentType = "application/json";
            human.reqBody = "{\"code\":\"v" + i + "\"}";
            records.add(human);
        }
        Pipeline.Result result = Pipeline.runIsolated(records, new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.ParameterFact code = parameter(endpoint(analysis, "POST", "/api/items"),
                SurfaceAnalysis.ParameterLocation.JSON_BODY, "/code");
        assertEquals(SurfaceAnalyzer.MAX_DISTINCT_VALUES, code.distinctValueCount());
        assertTrue(code.distinctValueTruncated());
        assertTrue(analysis.parameterDiagnostics().stream()
                .anyMatch(item -> item.reasonCode().equals("DISTINCT_VALUE_LIMIT")));
    }

    @Test
    void OpenAPI_path_slot_정렬이_모호하면_임의_선언_대신_진단만_남긴다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/orders/{orderId}":{"get":{"parameters":[
                  {"name":"orderId","in":"path","required":true}]}}}}
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        String evidenceId = result.records.getFirst().evidenceId;
        // mounted prefix가 placeholder를 하나 더 가진 후보: schema slot 1개 vs template slot 2개 → 정렬 불가
        RouteCandidate mounted = new RouteCandidate("https://app.test:443", "GET", "/catalogs/{id}/orders/{id}",
                List.of(), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.OPENAPI, evidenceId,
                        Source.HUMAN, "human-run", "openapi", RouteCandidate.Applicability.REVIEW, "mounted")),
                RouteCandidate.Applicability.REVIEW, "mounted", List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of(mounted));

        SurfaceAnalysis.EndpointFact get = endpoint(analysis, "GET", "/catalogs/{id}/orders/{id}");
        assertTrue(get.parameters().stream().noneMatch(item -> item.location() == SurfaceAnalysis.ParameterLocation.PATH),
                "정렬할 수 없는 PATH slot을 임의로 선언하지 않는다");
        assertTrue(analysis.parameterDiagnostics().stream()
                .anyMatch(item -> item.reasonCode().equals("UNRESOLVED_PATH_ALIGNMENT")));
    }

    @Test
    void PATH_좌표는_변수_개수가_아니라_실제_placeholder_위치를_검사하고_legacy와_같은_결과를_낸다() {
        RouteCandidate candidate = new RouteCandidate("https://app.test:443", "GET", "/api/orders/{id}",
                List.of(), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS,
                        "ev-js", Source.LLM, "llm-run", "llm-javascript",
                        RouteCandidate.Applicability.REVIEW, "app.js:1")),
                RouteCandidate.Applicability.REVIEW, "app.js:1",
                List.of(
                        new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.PATH, "/segments/0",
                                "wrongSlot", SurfaceAnalysis.Requirement.REQUIRED, "ev-js", Source.LLM, "llm-run",
                                "llm-javascript", "app.js:1",
                                io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion.FLOW_V2),
                        new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.PATH, "path[1]",
                                "legacyWrongSlot", SurfaceAnalysis.Requirement.REQUIRED, "ev-js", Source.LLM, "llm-run",
                                "llm-javascript", "app.js:1"),
                        new RouteCandidate.DeclaredParameter(SurfaceAnalysis.ParameterLocation.PATH, "/segments/2",
                                "orderId", SurfaceAnalysis.Requirement.REQUIRED, "ev-js", Source.LLM, "llm-run",
                                "llm-javascript", "app.js:1",
                                io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion.FLOW_V2)));

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(List.of(), List.of(), List.of(candidate));

        SurfaceAnalysis.EndpointFact get = endpoint(analysis, "GET", "/api/orders/{id}");
        SurfaceAnalysis.ParameterFact valid = parameter(get, SurfaceAnalysis.ParameterLocation.PATH, "/segments/2");
        assertTrue(valid.coordinateResolved());
        assertEquals("orderId", valid.displayName());
        List<SurfaceAnalysis.ParameterFact> unresolved = get.parameters().stream()
                .filter(item -> item.location() == SurfaceAnalysis.ParameterLocation.PATH && !item.coordinateResolved())
                .toList();
        assertEquals(2, unresolved.size(), "placeholder가 아닌 위치는 신규(/segments/0)·legacy(path[1]) 모두 미확정");
        assertTrue(unresolved.stream().allMatch(item -> item.deltaState() == SurfaceAnalysis.DeltaState.UNRESOLVED_COORDINATE));
        assertTrue(get.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/segments/0")
                && item.coordinateResolved()), "/segments/0을 확정 좌표로 받지 않는다");
    }

    @Test
    void JSON_실제_타입은_형식_신호에_덮이지_않고_distinct도_타입_차이를_보존한다() {
        RequestRecord text = request(Source.HUMAN, "POST", "/api/codes", 200);
        text.requestContentType = "application/json";
        text.reqBody = "{\"code\":\"1\",\"id\":\"550e8400-e29b-41d4-a716-446655440000\"}";
        RequestRecord number = request(Source.HUMAN, "POST", "/api/codes", 200);
        number.requestContentType = "application/json";
        number.reqBody = "{\"code\":1}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(text, number), new io.flowscope.core.AnalysisConfig());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/codes");
        SurfaceAnalysis.ParameterFact code = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/code");
        assertEquals(Set.of(SurfaceAnalysis.ValueType.STRING, SurfaceAnalysis.ValueType.INTEGER), code.observedValueTypes(),
                "\"1\"과 1은 실제 타입이 다르다");
        assertEquals(2, code.distinctValueCount(), "타입이 다르면 같은 문자열이라도 distinct");
        SurfaceAnalysis.ParameterFact id = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/id");
        assertTrue(id.observedValueTypes().contains(SurfaceAnalysis.ValueType.STRING), "UUID 형식은 실제 타입 STRING을 유지");
        assertTrue(id.observedShapes().contains(SurfaceAnalysis.ValueShape.UUID), "형식 신호는 표시 shape로만 남는다");
    }

    @Test
    void JS_리터럴_별표_키와_배열_원소_wildcard를_구분해_관측과_합친다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                fetch('/api/bulk', {method:'POST', body: JSON.stringify({payload: {"*": flag}, items: [{id: selected}]})});
                """);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/bulk", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"payload\":{\"*\":1},\"items\":[{\"id\":1}]}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(script, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/bulk");
        SurfaceAnalysis.ParameterFact literal = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/payload/~2");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, literal.deltaState(),
                "리터럴 * 키는 ~2로 이스케이프되어 선언·관측이 한 Fact로 합쳐진다");
        assertTrue(post.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/payload/*")),
                "리터럴 * 키를 배열 wildcard로 오인하지 않는다");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/items/*/id").deltaState(),
                "배열 원소 wildcard 동작은 유지");
    }

    @Test
    void OpenAPI_선언은_operation_override_union_enum_path타입을_PR_정의_의미로_보존한다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.1.0","components":{"parameters":{"q":{"name":"q","in":"query","required":true,"schema":{"type":"integer"}}},
                  "schemas":{"Choice":{"oneOf":[{"type":"string","enum":["READY","DONE"]},{"type":"integer"}]}}},
                 "paths":{"/orders/{orderId}":{
                   "parameters":[{"$ref":"#/components/parameters/q"},{"name":"orderId","in":"path","required":true,"schema":{"type":"integer"}}],
                   "get":{},
                   "post":{"parameters":[{"name":"q","in":"query","required":false,"schema":{"type":"string"}}],
                     "requestBody":{"content":{"application/json":{"schema":{"type":"object","properties":{
                       "choice":{"$ref":"#/components/schemas/Choice"},
                       "alternative":{"anyOf":[{"type":"boolean"},{"type":"number"}]},
                       "createdAt":{"type":"string","format":"date-time"}}}}}}}}}}
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact get = endpoint(analysis, "GET", "/orders/{id}");
        SurfaceAnalysis.ParameterFact getQ = parameter(get, SurfaceAnalysis.ParameterLocation.QUERY, "/q");
        assertEquals(1, getQ.declarations().size(), "path-level parameter는 한 번만 선언");
        assertEquals(SurfaceAnalysis.Requirement.REQUIRED, getQ.requirement());
        assertEquals(SurfaceAnalysis.ValueType.INTEGER, getQ.declarations().getFirst().declaredType());
        assertEquals(SurfaceAnalysis.Confidence.INFERRED, getQ.declarations().getFirst().confidence());
        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/orders/{id}");
        SurfaceAnalysis.ParameterFact postQ = parameter(post, SurfaceAnalysis.ParameterLocation.QUERY, "/q");
        assertEquals(1, postQ.declarations().size(), "operation-level parameter가 같은 (in,name)의 path-level을 override");
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL, postQ.requirement());
        assertEquals(SurfaceAnalysis.ValueType.STRING, postQ.declarations().getFirst().declaredType());
        SurfaceAnalysis.ParameterFact orderId = parameter(post, SurfaceAnalysis.ParameterLocation.PATH, "/segments/1");
        assertEquals("orderId", orderId.displayName());
        assertEquals(SurfaceAnalysis.ValueType.INTEGER, orderId.declarations().getFirst().declaredType(),
                "path parameter의 선언 타입은 slot 좌표에 부착");
        SurfaceAnalysis.ParameterFact choice = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/choice");
        assertEquals(3, choice.declarations().size(), "oneOf 변형과 enum 인덱스별 선언");
        assertEquals(SurfaceAnalysis.Requirement.CONDITIONAL, choice.requirement());
        assertEquals(Set.of("oneOf[0];enum[0];", "oneOf[0];enum[1];", "oneOf[1];"),
                choice.declarations().stream().map(SurfaceAnalysis.Declaration::conditionText).collect(Collectors.toSet()));
        assertEquals(Set.of(SurfaceAnalysis.ValueType.STRING, SurfaceAnalysis.ValueType.INTEGER),
                choice.declarations().stream().map(SurfaceAnalysis.Declaration::declaredType).collect(Collectors.toSet()));
        SurfaceAnalysis.ParameterFact alternative = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/alternative");
        assertEquals(2, alternative.declarations().size());
        assertEquals(SurfaceAnalysis.Requirement.CONDITIONAL, alternative.requirement());
        assertEquals(Set.of(SurfaceAnalysis.ValueType.BOOLEAN, SurfaceAnalysis.ValueType.NUMBER),
                alternative.declarations().stream().map(SurfaceAnalysis.Declaration::declaredType).collect(Collectors.toSet()));
        assertEquals(SurfaceAnalysis.ValueType.DATE_TIME,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/createdAt").declarations().getFirst().declaredType());
        assertFalse(analysis.toString().contains("READY"), "enum 값은 복사하지 않는다");
    }

    @Test
    void OpenAPI_swagger_body_formData와_form_multipart_binary_제외를_PR_의미로_처리한다() {
        RequestRecord swagger = document("/swagger.json", "application/json", """
                {"swagger":"2.0","basePath":"/v2","paths":{"/orders":{"post":{"parameters":[
                  {"in":"formData","name":"note","type":"string"},
                  {"in":"body","name":"payload","schema":{"type":"object","properties":{"count":{"type":"integer"}}}}]}}}}
                """);
        RequestRecord form = document("/form.json", "application/json", """
                {"openapi":"3.0.0","paths":{"/form":{"post":{"requestBody":{"content":{
                  "application/x-www-form-urlencoded":{"schema":{"properties":{"q":{"type":"string"}}}},
                  "multipart/form-data":{"schema":{"properties":{"label":{"type":"string"},"file":{"type":"string","format":"binary"}}}}}}}}}}
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(swagger, form), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact orders = endpoint(analysis, "POST", "/v2/orders");
        SurfaceAnalysis.ParameterFact note = parameter(orders, SurfaceAnalysis.ParameterLocation.FORM_BODY, "/note");
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL, note.requirement(), "required 미표기는 OPTIONAL(PR 의미)");
        assertEquals(SurfaceAnalysis.ValueType.STRING, note.declarations().getFirst().declaredType());
        assertEquals(SurfaceAnalysis.ValueType.INTEGER,
                parameter(orders, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/count").declarations().getFirst().declaredType());
        SurfaceAnalysis.EndpointFact formEndpoint = endpoint(analysis, "POST", "/form");
        assertEquals(SurfaceAnalysis.ValueType.STRING,
                parameter(formEndpoint, SurfaceAnalysis.ParameterLocation.FORM_BODY, "/q").declarations().getFirst().declaredType());
        assertEquals(SurfaceAnalysis.ValueType.STRING,
                parameter(formEndpoint, SurfaceAnalysis.ParameterLocation.MULTIPART_BODY, "/label").declarations().getFirst().declaredType());
        assertTrue(formEndpoint.parameters().stream().noneMatch(item -> item.canonicalPath().equals("/file")),
                "binary 파일 필드는 입력 선언으로 만들지 않는다");
    }

    @Test
    void OpenAPI_외부ref_순환ref_선언은_건너뛴다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.0","components":{"schemas":{"Loop":{"$ref":"#/components/schemas/Loop"}}},
                 "paths":{"/orders":{"post":{"requestBody":{"content":{"application/json":{"schema":{"properties":{
                  "remote":{"$ref":"https://outside.test/schema"},"loop":{"$ref":"#/components/schemas/Loop"},
                  "password":{"type":"string"},"safe":{"type":"boolean"}}}}}}}}}}
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/orders");
        assertEquals(Set.of("/password", "/safe"), post.parameters().stream().map(SurfaceAnalysis.ParameterFact::canonicalPath)
                .collect(Collectors.toSet()), "외부 $ref·순환 $ref는 선언하지 않는다. password도 다른 이름과 똑같이 선언한다");
    }

    @Test
    void JS_선언은_computed_spread_동적method_proto_컨테이너를_거부하고_리터럴_타입을_전달한다() {
        RequestRecord script = document("/assets/app.js", "application/javascript", """
                axios.post('/orders', {[field]: true});
                axios.post('/orders', payload);
                axios.post('/orders', {...payload, admin: true});
                fetch('/orders', {method: verb, body: JSON.stringify({admin2: true})});
                // axios.post('/orders', {comment: true});
                const text = "axios.post('/orders', {text: true})";
                axios.post('/orders', {__proto__: {polluted: true}, constructor: {chain: true}, prototype: {x: 1}, safe: true, plain: 1});
                """);
        Pipeline.Result result = Pipeline.runIsolated(List.of(script), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/orders");
        assertEquals(Set.of("/safe", "/plain"), post.parameters().stream()
                .filter(item -> item.location() == SurfaceAnalysis.ParameterLocation.JSON_BODY)
                .map(SurfaceAnalysis.ParameterFact::canonicalPath).collect(Collectors.toSet()),
                "computed key·비리터럴·spread 포함 객체·__proto__·constructor/prototype 컨테이너·주석·문자열은 선언이 아니다");
        assertTrue(analysis.endpoints().stream().noneMatch(item -> item.parameters().stream()
                .anyMatch(parameter -> parameter.canonicalPath().equals("/admin2"))), "method를 해석하지 못한 call-site는 입력을 선언하지 않는다");
        SurfaceAnalysis.Declaration safe = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/safe").declarations().getFirst();
        assertEquals(SurfaceAnalysis.Confidence.INFERRED, safe.confidence());
        assertEquals(SurfaceAnalysis.ValueType.BOOLEAN, safe.declaredType(), "리터럴 값 종류를 선언 타입으로 전달");
        assertEquals(SurfaceAnalysis.ValueType.INTEGER,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/plain").declarations().getFirst().declaredType());
    }

    @Test
    void 파라미터당_선언은_32개에서_잘리고_진단을_남긴다() {
        StringBuilder enums = new StringBuilder();
        for (int i = 0; i < 40; i++) { if (i > 0) enums.append(','); enums.append("\"V").append(i).append('"'); }
        RequestRecord openapi = document("/openapi.json", "application/json",
                "{\"openapi\":\"3.0.0\",\"paths\":{\"/orders\":{\"post\":{\"requestBody\":{\"content\":{\"application/json\":{\"schema\":"
                        + "{\"type\":\"object\",\"properties\":{\"state\":{\"type\":\"string\",\"enum\":[" + enums + "]}}}}}}}}}}");
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.ParameterFact state = parameter(endpoint(analysis, "POST", "/orders"),
                SurfaceAnalysis.ParameterLocation.JSON_BODY, "/state");
        assertEquals(32, state.declarations().size(), "PR provenance/definition 상한 32");
        assertTrue(analysis.parameterDiagnostics().stream()
                .anyMatch(item -> item.reasonCode().equals("DECLARATION_LIMIT") && item.droppedCount() == 8));
        assertFalse(analysis.toString().contains("V39"), "enum 값은 복사하지 않는다");
    }

    @Test
    void OpenAPI_servers_변수_확장이_상한을_넘으면_route를_만들지_않는다() {
        RequestRecord openapi = document("/openapi.json", "application/json",
                "{\"openapi\":\"3.0.0\",\"servers\":[{\"url\":\"/{v}{v}\",\"variables\":{\"v\":{\"default\":\""
                        + "x".repeat(5000) + "\"}}}],\"paths\":{\"/orders\":{\"post\":{}}}}");
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        assertTrue(candidates.stream().noneMatch(item -> item.pathTemplate().contains("xxxx")),
                "확장 상한을 넘는 server base는 거부한다");
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

    @Test
    void 엔드포인트_파라미터_상한에서_기존_좌표는_계속_갱신되고_신규_초과만_진단으로_남는다() {
        int max = SurfaceAnalyzer.MAX_PARAMETERS_PER_ENDPOINT;
        String wide = wideJson(max);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/wide", 200);
        human.requestContentType = "application/json";
        human.reqBody = wide;
        RequestRecord scanner = request(Source.SCANNER, "POST", "/api/wide", 200);
        scanner.requestContentType = "application/json";
        scanner.reqBody = wide;
        RequestRecord overflow = request(Source.HUMAN, "POST", "/api/wide", 200);
        overflow.requestContentType = "application/json";
        overflow.reqBody = wideJson(max + 1);

        SurfaceAnalysis forward = analyzeWide(List.of(human, scanner, overflow));
        SurfaceAnalysis.EndpointFact endpoint = endpoint(forward, "POST", "/api/wide");
        assertEquals(max, endpoint.parameters().size(), "상한까지는 모두 보존한다");
        for (String path : List.of("/p0", "/p" + (max - 1))) {
            SurfaceAnalysis.ParameterFact fact = parameter(endpoint, SurfaceAnalysis.ParameterLocation.JSON_BODY, path);
            assertEquals(java.util.Set.of(Source.HUMAN, Source.SCANNER), fact.observedSources(),
                    "상한에 닿은 뒤 도착한 SCANNER 관측도 기존 좌표에는 계속 갱신된다: " + path);
            assertEquals(fact.observedSources(), fact.profile().sourceCounts().keySet(),
                    "Fact의 source와 프로파일 집계가 같은 관측 집합을 본다: " + path);
        }
        assertTrue(forward.parameterDiagnostics().stream().anyMatch(item -> item.reasonCode().equals("PARAMETER_LIMIT")
                && item.operation().equals("POST /api/wide") && item.droppedCount() == 1),
                "1,025번째 신규 좌표는 경고 없이 사라지지 않는다");

        SurfaceAnalysis reversed = analyzeWide(List.of(overflow, scanner, human));
        assertEquals(endpoint.parameters().stream().map(SurfaceAnalysis.ParameterFact::canonicalPath).sorted().toList(),
                endpoint(reversed, "POST", "/api/wide").parameters().stream()
                        .map(SurfaceAnalysis.ParameterFact::canonicalPath).sorted().toList(),
                "수집 순서를 바꿔도 보존되는 좌표 집합은 같다");
    }

    private static SurfaceAnalysis analyzeWide(List<RequestRecord> records) {
        Pipeline.Result result = Pipeline.runIsolated(records, new io.flowscope.core.AnalysisConfig());
        return SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of());
    }

    private static String wideJson(int fields) {
        StringBuilder body = new StringBuilder("{");
        for (int i = 0; i < fields; i++) body.append(i > 0 ? "," : "").append("\"p").append(i).append("\":1");
        return body.append("}").toString();
    }

    @Test
    void 선언에_구조적으로_덮인_컨테이너와_배열_원소_관측은_미선언_관측이_아니다() {
        RequestRecord openapi = document("/openapi.json", "application/json", """
                {"openapi":"3.0.3","paths":{"/api/search":{"post":{"requestBody":{"content":{"application/json":{"schema":{
                  "type":"object","properties":{"criteria":{"type":"object","properties":{
                    "status":{"type":"string"},"labels":{"type":"array","items":{"type":"string"}}}}}}}}}}}}}
                """);
        RequestRecord human = request(Source.HUMAN, "POST", "/api/search", 200);
        human.requestContentType = "application/json";
        human.reqBody = "{\"criteria\":{\"status\":\"open\",\"labels\":[\"a\",\"b\"]},\"extra\":1}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi, human), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());
        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);
        SurfaceAnalysis.EndpointFact post = endpoint(analysis, "POST", "/api/search");

        SurfaceAnalysis.ParameterFact container = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria");
        assertTrue(container.declarations().isEmpty(), "선언은 리프·배열 필드 관례를 유지한다(D-143 ①)");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, container.deltaState(),
                "멤버가 선언된 객체 컨테이너 관측은 미선언 관측이 아니다");
        SurfaceAnalysis.ParameterFact element = parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria/labels/*");
        assertTrue(element.declarations().isEmpty());
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED, element.deltaState(),
                "배열 필드가 선언된 원소 관측은 미선언 관측이 아니다");
        assertEquals(SurfaceAnalysis.DeltaState.ONE_SOURCE_OBSERVED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/criteria/labels").deltaState());
        assertEquals(SurfaceAnalysis.DeltaState.OBSERVED_NOT_DECLARED,
                parameter(post, SurfaceAnalysis.ParameterLocation.JSON_BODY, "/extra").deltaState(),
                "정말 선언되지 않은 리프는 그대로 미선언 관측이다");
    }

    @Test
    void schema_깊이_상한은_64이고_넘긴_선언은_진단으로_남는다() {
        // 선언은 리프만 만들므로(D-143 ①) 깊이 60 체인은 리프 하나를 선언하고, 70 체인은 리프가 상한 밖이라 선언 0개 + 진단이다.
        RequestRecord openapi = document("/openapi.json", "application/json",
                "{\"openapi\":\"3.0.3\",\"paths\":{"
                        + "\"/api/deep60\":{\"post\":{\"requestBody\":{\"content\":{\"application/json\":{\"schema\":" + nestedSchema(60) + "}}}}},"
                        + "\"/api/deep70\":{\"post\":{\"requestBody\":{\"content\":{\"application/json\":{\"schema\":" + nestedSchema(70) + "}}}}}"
                        + "}}");
        Pipeline.Result result = Pipeline.runIsolated(List.of(openapi), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());
        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        SurfaceAnalysis.EndpointFact deep60 = endpoint(analysis, "POST", "/api/deep60");
        assertEquals(1, deep60.parameters().size(), "깊이 60의 리프는 선언된다(이전 상한 20에서는 사라졌다)");
        assertEquals(60, deep60.parameters().getFirst().canonicalPath().split("/").length - 1);
        assertTrue(analysis.parameterDiagnostics().stream().noneMatch(d -> d.reasonCode().equals("DECLARATION_DEPTH_LIMIT")
                && d.operation().equals("POST /api/deep60")));

        SurfaceAnalysis.EndpointFact deep70 = endpoint(analysis, "POST", "/api/deep70");
        assertTrue(deep70.parameters().isEmpty(), "상한 밖 리프는 선언하지 않는다");
        assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("DECLARATION_DEPTH_LIMIT")
                && d.operation().equals("POST /api/deep70") && d.droppedCount() >= 1),
                "깊이 때문에 끊기면 선언 0개·오류 없음으로 끝나지 않는다");
    }

    private static String nestedSchema(int depth) {
        StringBuilder open = new StringBuilder();
        StringBuilder close = new StringBuilder();
        for (int i = 0; i < depth; i++) { open.append("{\"type\":\"object\",\"properties\":{\"n").append(i).append("\":"); close.append("}}"); }
        return open.append("{\"type\":\"string\"}").append(close).toString();
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
                .filter(item -> item.location() == location && item.canonicalPath().equals(path))
                .findFirst().orElseThrow();
    }
}
