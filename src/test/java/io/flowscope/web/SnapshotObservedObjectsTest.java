package io.flowscope.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SnapshotObservedObjectsTest {
    @Test void addsDisplayObjectsWithoutChangingMatrixCoordinatesOrRequestLabEvidence() throws Exception {
        var a = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/posts/opaqueTokenA123456", 200, "A");
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/posts/opaqueTokenB123456", 200, "A");
        a.collectionAccountId = "user-a"; b.collectionAccountId = "user-b";
        for (var r : List.of(a,b)) {
            r.hasResponse = true; r.reqText = "GET " + r.path + " HTTP/1.1\r\nHost: t\r\n\r\n";
            r.body = "{\"title\":\"post\"}";
        }
        var result = Pipeline.run(List.of(a,b));
        var analysis = result.analysis;
        var ops = result.records.stream().map(r -> r.op).toList();
        var ids = result.records.stream().map(r -> r.evidenceId).toList();
        var requests = result.records.stream().map(RequestRecord::requestTextForEvidence).toList();
        var writer = new SnapshotJsonWriter(); var json = new ObjectMapper();
        var first = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of()));
        var second = json.readTree(writer.write(2, result, new AnalysisConfig(), List.of(), List.of()));
        assertEquals(2, first.path("displayObjects").size());
        assertEquals(first.path("displayObjects"), second.path("displayObjects"));
        assertEquals(first.path("cells"), second.path("cells"));
        assertEquals(first.path("authorizationMatrix"), second.path("authorizationMatrix"));
        assertSame(analysis, result.analysis);
        assertEquals(ops, result.records.stream().map(r -> r.op).toList());
        assertEquals(ids, result.records.stream().map(r -> r.evidenceId).toList());
        assertEquals(requests, result.records.stream().map(RequestRecord::requestTextForEvidence).toList());
        for (int i=0; i<2; i++) {
            assertEquals(ids.get(i), first.path("events").get(i).path("eventId").asText());
            assertEquals(ops.get(i), first.path("events").get(i).path("op").asText());
        }
    }
    @Test void staticResourcesAreAbsentFromMatrixObjectsAndRoutesButKeepEvidence() throws Exception {
        var image = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/images/123/photo.avif", 403, "anon");
        image.hasResponse = true; image.reqBody = "{\"itemId\":123}";
        image.requestContentType = "application/json";
        image.reqText = "POST /images/123/photo.avif HTTP/1.1\r\nHost: t\r\n\r\n" + image.reqBody;
        var result = Pipeline.run(List.of(image));
        var provenance = List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.HTML_LINK, "fixture", Source.HUMAN, "run", "browser"));
        var asset = new RouteCandidate("https://t:443", "GET", "/assets/font.otf", false, provenance, RouteCandidate.Applicability.REVIEW, "fixture");
        var api = new RouteCandidate("https://t:443", "GET", "/api/items.json", false, provenance, RouteCandidate.Applicability.REVIEW, "fixture");
        var routes = List.of(asset, api);
        var writer = new SnapshotJsonWriter();
        var json = new ObjectMapper();
        var first = json.readTree(writer.write(1, result, new AnalysisConfig(), List.of(), List.of(), List.of(), routes));
        var second = json.readTree(writer.write(2, result, new AnalysisConfig(), List.of(), List.of(), List.of(), routes));
        assertEquals(1, first.path("events").size());
        assertEquals("STATIC_ASSET", first.path("events").get(0).path("trafficClass").asText());
        assertEquals(0, first.path("cells").size());
        assertEquals(0, first.path("displayObjects").size());
        assertEquals(0, first.path("graphFacts").size());
        assertEquals(0, first.path("authorizationMatrix").path("functions").size());
        assertEquals(0, first.path("authorizationMatrix").path("objects").size());
        assertEquals(1, first.path("routeCandidates").size());
        assertEquals("/api/items.json", first.path("routeCandidates").get(0).path("pathTemplate").asText());
        assertEquals(first.path("routeCandidates"), second.path("routeCandidates"));
        assertEquals(image.reqText, result.records.getFirst().requestTextForEvidence());
        assertEquals(2, routes.size());
    }

    @Test void configuredStaticEndpointCannotReappearInMatrix() throws Exception {
        var config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("user-a", "User A", "https://t:443", AccessRole.USER))
                .withEndpointRequirement("https://t:443 GET /assets/app.js", AccessRole.USER)
                .withEndpointRequirement("https://t:443 GET /api/items.json", AccessRole.USER);
        var result = Pipeline.run(List.of(), config);
        var matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        assertTrue(matrix.functions().stream().noneMatch(cell -> cell.operation().endsWith("/assets/app.js")));
        assertTrue(matrix.functions().stream().anyMatch(cell -> cell.operation().endsWith("/api/items.json")));
        assertTrue(StaticResourcePolicy.matchesOperation("GET /assets/app.js"));
        assertTrue(StaticResourcePolicy.matchesOperation("https://t:443 POST /assets/app.css?x=1"));
        assertFalse(StaticResourcePolicy.matchesOperation("https://t:443 GET /api/items.json"));
    }

}
