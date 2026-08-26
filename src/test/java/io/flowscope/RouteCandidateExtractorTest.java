package io.flowscope;

import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

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
    void 관측_JavaScript_literal은_후보지만_문자열조합은_꾸며내지_않는다() {
        RequestRecord script = new RequestRecord(Source.HUMAN, "https://app.test:443",
                "GET", "/app/main.js", 200, "anon");
        script.hasResponse = true;
        script.responseContentType = "application/javascript";
        script.body = "fetch('/app/api/users/7'); fetch('/app/api/orders/9', {method:'POST'}); "
                + "fetch('/app/api/dynamic', options); axios.get('/app/api/orders/' + id);";
        script = Pipeline.run(List.of(script)).records.getFirst();

        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(List.of(script),
                ScopePolicy.parse("https://app.test/app/"), List.of());

        assertEquals(3, candidates.size());
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("GET")
                && value.pathTemplate().equals("/app/api/users/{id}")));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("POST")
                && value.pathTemplate().equals("/app/api/orders/{id}")));
        assertTrue(candidates.stream().anyMatch(value -> value.method().equals("UNKNOWN")
                && value.pathTemplate().equals("/app/api/dynamic")));
        assertTrue(candidates.stream().allMatch(value -> value.applicability() == RouteCandidate.Applicability.REVIEW));
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
}
