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
}
