package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.ObservedObjectProjection;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ObservedObjectProjectionTest {
    private static RequestRecord record(String path, int number) {
        var r = new RequestRecord(Source.HUMAN, "https://t:443", "GET", path, 200, "A");
        r.hasResponse = true; r.evidenceId = "event-" + number; r.timestamp = number;
        Normalizer.normalizeAll(List.of(r));
        return r;
    }
    @Test void requiresTwoRealPathObservationsWithoutRequiringOtherSources() {
        var a = record("/posts/12313213", 1);
        assertTrue(ObservedObjectProjection.build(List.of(a)).isEmpty());
        assertTrue(ObservedObjectProjection.build(List.of(a, a)).isEmpty());
        var b = record(a.path, 2);
        var out = ObservedObjectProjection.build(List.of(a, b));
        assertEquals(2, out.size()); assertEquals(out.getFirst().objectKey(), out.getLast().objectKey());
        assertEquals(1, out.getLast().ordinal());
    }
    @Test void crapiStringIdsBecomeThreeObjectsAndRecentStaysAnApi() {
        var a = record("/community/posts/7bLfZ8nkq40LJuVovEVVLS", 1);
        var b = record("/community/posts/n6q4X6y6BXx7CbGKCytRii", 2);
        var c = record("/community/posts/BvFq9vBre9Bvmmk3xv6", 3);
        var recent = record("/community/posts/recent", 4);
        var out = ObservedObjectProjection.build(List.of(a, b, c, recent));
        assertEquals(3, out.size());
        assertEquals(1, out.stream().map(ObservedObjectProjection.ObjectObservation::apiKey).distinct().count());
        assertEquals(List.of(1,2,3), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertNull(a.resource, "display projection must not rewrite canonical analysis resource");
    }
    @Test void structureFindsStringIdsAndKeepsParentScopesAndFixedSuffixes() {
        var out = ObservedObjectProjection.build(List.of(record("/api/101/detail/5", 1),record("/api/101/detail/6", 2),record("/api/202/detail/1", 3)));
        assertEquals(3, out.size());
        assertEquals(out.get(0).apiKey(), out.get(1).apiKey());
        assertNotEquals(out.get(0).apiKey(), out.get(2).apiKey());
        assertEquals(List.of(1,2,1), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        var strings = ObservedObjectProjection.build(List.of(record("/orders/alpha/detail", 4),record("/orders/beta/detail", 5)));
        assertEquals(2, strings.size()); assertTrue(strings.getFirst().apiKey().endsWith("/orders/{id}/detail"));
    }
    @Test void methodAndServiceAndUntrustedTrafficDoNotCorroborate() {
        var a = record("/posts/100", 1);
        var b = new RequestRecord(Source.HUMAN, "https://t:443", "POST", "/posts/200", 200, "A");
        b.hasResponse = true; b.evidenceId = "event-2"; Normalizer.normalizeAll(List.of(b));
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
        b = record("/posts/200", 2); b.executionTrust = ExecutionTrust.UNVERIFIED_RUNTIME;
        assertTrue(ObservedObjectProjection.build(List.of(a,b)).isEmpty());
    }
    @Test void queryObjectsUseAllFieldsAndCompareCombinationsWithoutRequiringTwoObservations() {
        var a = record("/lookup", 1); a.query = "page=1&userid=1";
        var b = record("/lookup", 2); b.query = "userid=1&page=1";
        var c = record("/lookup", 3); c.query = "page=2&userid=1";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertEquals(3, out.size()); assertEquals(List.of("/page", "/userid"), out.getFirst().fields());
        assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertEquals(List.of(1,1,2), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals(1, ObservedObjectProjection.build(List.of(a)).size());
    }
    @Test void queryPreservesRepeatedValueOrderAndNeverUsesPasswordValueInObjectIdentity() {
        var a = record("/lookup", 1); a.query = "a=1&a=2&password=first-secret";
        var b = record("/lookup", 2); b.query = "a=2&a=1&password=second-secret";
        var c = record("/lookup", 3); c.query = "a=1&a=2&password=third-secret";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertNotEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertEquals(out.get(0).objectKey(), out.get(2).objectKey());
        assertFalse(out.toString().contains("first-secret"));
    }
    @Test void bodyCombinesNestedTypedDataWithoutUsingSensitiveValuesOrKeyOrder() {
        var a = record("/lookup", 1); a.reqBody = "{\"userID\":1,\"password\":\"one\",\"items\":[{\"id\":5}]}";
        var b = record("/lookup", 2); b.reqBody = "{\"items\":[{\"id\":5}],\"password\":\"two\",\"userID\":1}";
        var c = record("/lookup", 3); c.reqBody = "{\"userID\":\"1\",\"password\":\"three\",\"items\":[{\"id\":5}]}";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertEquals(3, out.size()); assertEquals("REQUEST_BODY", out.getFirst().kind());
        assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        assertNotEquals(out.get(0).objectKey(), out.get(2).objectKey());
        assertEquals(List.of("/items/*/id", "/password", "/userID"), out.getFirst().fields());
        assertEquals(1, ObservedObjectProjection.build(List.of(a)).size());
    }
    @Test void bodyKeepsArrayOrderAndParsesFormXmlAndRejectsInvalidJson() {
        var a = record("/lookup", 1); a.reqBody = "{\"ids\":[1,2]}";
        var b = record("/lookup", 2); b.reqBody = "{\"ids\":[2,1]}";
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertNotEquals(out.get(0).objectKey(), out.get(1).objectKey());
        var form = record("/lookup", 3); form.requestContentType = "application/x-www-form-urlencoded"; form.reqBody = "userID=1&password=abc";
        assertEquals(1, ObservedObjectProjection.build(List.of(form)).size());
        var xml = record("/lookup", 4); xml.requestContentType = "application/xml"; xml.reqBody = "<request><id>1</id></request>";
        assertEquals(1, ObservedObjectProjection.build(List.of(xml)).size());
        var invalid = record("/lookup", 5); invalid.reqBody = "{\"id\":1,\"id\":2}";
        assertTrue(ObservedObjectProjection.build(List.of(invalid)).isEmpty());
    }
    @Test void pathQueryAndBodyAllRemainVisibleWithoutChangingCanonicalCoordinates() {
        var a = record("/orders/101", 1); a.query = "page=1"; a.reqBody = "{\"userID\":9,\"password\":\"secret\"}";
        var b = record("/orders/202", 2);
        var original = a.op + "\0" + a.resource;
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(Set.of("PATH","QUERY","REQUEST_BODY"), new HashSet<>(out.stream().filter(o -> o.eventId().equals(a.evidenceId)).map(ObservedObjectProjection.ObjectObservation::kind).toList()));
        assertEquals(original, a.op + "\0" + a.resource);
    }
    @Test void parameterlessGetUsesWholeResponseRatherThanSplittingArrayItems() {
        var a = record("/products", 1); a.body = "{\"items\":[{\"id\":1},{\"id\":2}],\"total\":2}";
        var b = record("/products", 2); b.body = "{\"total\":2,\"items\":[{\"id\":1},{\"id\":2}]}";
        var c = record("/products", 3); c.body = "{\"items\":[{\"id\":2},{\"id\":1}],\"total\":2}";
        var out = ObservedObjectProjection.build(List.of(a,b,c));
        assertEquals(3, out.size()); assertEquals("RESPONSE_BODY", out.getFirst().kind());
        assertEquals(List.of(1,1,2), out.stream().map(ObservedObjectProjection.ObjectObservation::ordinal).toList());
        assertEquals(1, ObservedObjectProjection.build(List.of(a)).size());
    }
    @Test void responseFallbackCannotBypassTheSinglePathGateOrDuplicateRequestObjects() {
        var a = record("/products/123", 1); a.body = "{\"id\":123}";
        assertTrue(ObservedObjectProjection.build(List.of(a)).isEmpty());
        var b = record("/products", 2); b.query = "page=1"; b.body = "{\"id\":123}";
        assertEquals(List.of("QUERY"), ObservedObjectProjection.build(List.of(b)).stream().map(ObservedObjectProjection.ObjectObservation::kind).toList());
        var c = record("/products", 3); c.reqBody = "{\"id\":1}"; c.body = "{\"id\":123}";
        assertEquals(List.of("REQUEST_BODY"), ObservedObjectProjection.build(List.of(c)).stream().map(ObservedObjectProjection.ObjectObservation::kind).toList());
    }
    @Test void responseXmlIsNormalizedAndExternalEntitiesHtmlAndErrorsAreRejected() {
        var a = record("/products", 1); a.responseContentType = "application/xml"; a.body = "<items><id>1</id><password>one</password></items>";
        var b = record("/products", 2); b.responseContentType = "application/xml"; b.body = "<items>\n <id>1</id><password>two</password>\n</items>";
        var out = ObservedObjectProjection.build(List.of(a,b));
        assertEquals(2, out.size()); assertEquals(out.get(0).objectKey(), out.get(1).objectKey());
        var evil = record("/products", 3); evil.responseContentType = "application/xml"; evil.body = "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><x>&e;</x>";
        assertTrue(ObservedObjectProjection.build(List.of(evil)).isEmpty());
        var html = record("/products", 4); html.responseContentType = "text/html"; html.body = "<html><body>hello</body></html>";
        assertTrue(ObservedObjectProjection.build(List.of(html)).isEmpty());
        var error = new RequestRecord(Source.HUMAN, "https://t:443", "GET", "/products", 500, "A"); error.hasResponse = true; error.evidenceId = "error"; error.body = "{\"error\":true}"; Normalizer.normalizeAll(List.of(error));
        assertTrue(ObservedObjectProjection.build(List.of(error)).isEmpty());
    }
}
