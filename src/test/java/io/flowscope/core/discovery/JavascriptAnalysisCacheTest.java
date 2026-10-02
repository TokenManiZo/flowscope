package io.flowscope.core.discovery;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JavascriptAnalysisCacheTest {
    private static JavascriptAnalysis analysis(int assets) {
        List<JavascriptAnalysis.AssetReference> refs = java.util.stream.IntStream.range(0, assets)
                .mapToObj(i -> new JavascriptAnalysis.AssetReference("/chunk-" + i + ".js", "import", 1, i)).toList();
        return new JavascriptAnalysis(List.of(), refs, List.of(), JavascriptAnalysis.Status.PARSED, "");
    }

    @Test
    void aRebuildOverMoreBundlesThanTheOldLimitHitsOnEverySecondPass() {
        // The old 128-entry LRU missed every lookup when a SPA had more bundles, re-parsing all of them per rebuild.
        JavascriptAnalysisCache cache = new JavascriptAnalysisCache(4_096, 1_000_000);
        for (int i = 0; i < 300; i++) cache.put("bundle-" + i, analysis(3));
        int hits = 0;
        for (int i = 0; i < 300; i++) if (cache.get("bundle-" + i) != null) hits++;
        assertEquals(300, hits);
    }

    @Test
    void memoryIsBoundedByAnalysedItemsAndEvictsTheLeastRecentlyUsedFirst() {
        JavascriptAnalysisCache cache = new JavascriptAnalysisCache(4_096, 100);
        cache.put("a", analysis(39));   // weight 40
        cache.put("b", analysis(39));   // weight 40
        assertNotNull(cache.get("a"));  // a is now the most recently used
        cache.put("c", analysis(39));   // 120 > 100: evict the eldest, b

        assertNull(cache.get("b"));
        assertNotNull(cache.get("a"));
        assertNotNull(cache.get("c"));
        assertTrue(cache.items() <= 100);
    }

    @Test
    void anOversizedAnalysisIsStillKeptAloneAndClearResetsTheBudget() {
        JavascriptAnalysisCache cache = new JavascriptAnalysisCache(4_096, 10);
        cache.put("small", analysis(1));
        cache.put("huge", analysis(50));

        assertNotNull(cache.get("huge"));
        assertNull(cache.get("small"));
        cache.clear();
        assertEquals(0, cache.size());
        assertEquals(0, cache.items());
    }
}
