package io.flowscope;

import io.flowscope.core.CollectionProgress;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class CollectionProgressTest {
    private RouteCandidate route(String method, String path, String run, RouteCandidate.ProvenanceType kind) {
        return new RouteCandidate("https://api.test:443", method, path,
                kind == RouteCandidate.ProvenanceType.OBSERVED_REQUEST,
                List.of(new RouteCandidate.Provenance(kind, "ev-" + run + method + path, Source.LLM, run, "fixture")),
                RouteCandidate.Applicability.REVIEW, "fixture");
    }

    @Test
    void comparisonsPreserveMethodsAndKeepUnknownDeclarationsOutsideOperationCounts() {
        var observed = RouteCandidate.ProvenanceType.OBSERVED_REQUEST;
        var declared = RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL;
        List<RouteCandidate> candidates = List.of(route("GET", "/items", "before", observed),
                route("POST", "/items", "before", declared), route("UNKNOWN", "/other", "before", declared),
                route("GET", "/items", "after", observed), route("POST", "/items", "after", observed),
                route("GET", "/main.js", "after", RouteCandidate.ProvenanceType.HTML_SCRIPT));
        var before = CollectionProgress.forRun(candidates, Source.LLM, "before");
        var after = CollectionProgress.forRun(candidates, Source.LLM, "after");
        assertEquals(1, before.observedOperations().size());
        assertEquals(1, before.declaredUnobservedOperations().size());
        assertEquals(1, before.unknownMethodPaths().size());
        assertEquals(2, after.observedOperations().size());
        var diff = CollectionProgress.compare("before", before, "after", after);
        assertEquals(1, diff.observedAdded().count());
        assertEquals("POST", diff.observedAdded().items().getFirst().method());
        assertEquals(0, diff.observedRemoved().count());
        assertEquals(1, diff.declaredUnobservedRemoved().count());
        assertEquals(1, diff.unknownMethodRemoved().count());
        assertEquals(1, diff.unitVersion());
    }

    @Test
    void diffCountsRemainCompleteWhenTheDisplayedListIsBounded() {
        List<RouteCandidate> candidates = java.util.stream.IntStream.range(0, 150)
                .mapToObj(index -> route("GET", "/items/feature-" + index, "after",
                        RouteCandidate.ProvenanceType.OBSERVED_REQUEST)).toList();
        var diff = CollectionProgress.compare("before", CollectionProgress.fromFacts(List.of()), "after",
                CollectionProgress.forRun(candidates, Source.LLM, "after"));
        assertEquals(150, diff.observedAdded().count());
        assertEquals(100, diff.observedAdded().items().size());
        assertTrue(diff.observedAdded().truncated());
    }
}
