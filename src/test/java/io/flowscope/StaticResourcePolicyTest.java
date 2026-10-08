package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.ObservedObjectProjection;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class StaticResourcePolicyTest {
    @Test void inspectsOnlyTheFinalPathSegmentWithoutChangingUrlSemantics() {
        for (String path : List.of("/a/PHOTO.JPG?v=1", "/a/photo%2Ejpg", "/a/photo.%6a%70%67",
                "/a/file+name.jpg#part", "https://example.test/a/photo.jpg?v=1", "/a/app.js.gz", "/a/app.css.br", "/a/image.avif.zst")) {
            assertTrue(StaticResourcePolicy.matchesPath(path), path);
        }
        for (String path : List.of("/api/download?filename=a.jpg", "/api/a.jpg/details", "/api/a.jpg/",
                "/a%2Fphoto.jpg", "/bad%ZZ.jpg", "/photo%252Ejpg", "/api/a.json", "/api/a.xml",
                "/api/a.csv", "/api/a.txt", "/api/page.php", "/api/page.html", "/a/data.json.gz", "/a/file.zip")) {
            assertFalse(StaticResourcePolicy.matchesPath(path), path);
        }
        assertFalse(StaticResourcePolicy.matchesPath(null));
    }

    @Test void excludesEveryConfiguredExtensionEvenWithObjectAndApiSignals() {
        for (String extension : StaticResourcePolicy.EXTENSIONS) {
            var r = record("POST", "/assets/123/file." + extension, 403);
            r.op = "https://t:443 POST /assets/{id}/file." + extension;
            r.resource = "asset:123";
            r.requestContentType = "application/json";
            var config = new AnalysisConfig().withTrafficOverride(r.op, TrafficOverride.INCLUDE);
            var classification = TrafficClassifier.classify(r, config);
            assertEquals(TrafficClassification.TrafficClass.STATIC_ASSET, classification.trafficClass(), extension);
            assertFalse(classification.coverageEligible(), extension);
            assertEquals(List.of("STATIC_RESOURCE_EXTENSION"), classification.reasons(), extension);
        }
    }

    @Test void excludesStaticRequestsAcrossStatusesAndMethodsButKeepsRawRecords() {
        for (String method : List.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")) {
            for (int status : List.of(200, 204, 401, 403, 404)) {
                var r = record(method, "/images/123/photo.jpg", status);
                r.reqBody = "{\"itemId\":123}";
                var result = Pipeline.run(List.of(r));
                assertEquals(1, result.records.size());
                assertTrue(result.coverageRecords.isEmpty(), method + status);
                assertTrue(result.analysis.cells().isEmpty(), method + status);
                assertTrue(ObservedObjectProjection.build(result.records).isEmpty(), method + status);
                assertEquals("/images/123/photo.jpg", result.records.getFirst().path);
                assertEquals(r.reqBody, result.records.getFirst().requestBodyForAnalysis());
            }
        }
    }

    @Test void doesNotExcludeExtensionlessImageApisOrOrdinaryAuthorizationResponses() {
        for (String path : List.of("/api/images/123", "/api/items.json", "/api/feed.xml", "/page.php", "/page.html")) {
            var r = record("GET", path, 403);
            r.responseContentType = "application/json";
            assertTrue(Pipeline.run(List.of(r)).records.getFirst().trafficClassification.coverageEligible(), path);
        }
    }

    static RequestRecord record(String method, String path, int status) {
        var r = new RequestRecord(Source.HUMAN, "https://t:443", method, path, status, "anon");
        r.hasResponse = true;
        return r;
    }
}
