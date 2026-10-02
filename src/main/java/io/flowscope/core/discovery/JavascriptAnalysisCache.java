package io.flowscope.core.discovery;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Remembers JavaScript analyses by script content hash. Every rebuild walks all captured scripts in the same order,
 * so an LRU smaller than the set of distinct scripts misses on every lookup and re-runs the isolated parser process
 * for every bundle on every rebuild (measured: 200 bundles took 134-152 s per rebuild with a 128-entry cache, versus
 * 0.01 s once all fit). The limits are therefore set far above a realistic project (records are capped at 20,000)
 * and bounded by the analysed items, not by an entry count small enough to thrash.
 */
final class JavascriptAnalysisCache {
    private final int maxEntries;
    private final long maxItems;
    private long items;
    private final LinkedHashMap<String, JavascriptAnalysis> entries = new LinkedHashMap<>(16, 0.75f, true);

    JavascriptAnalysisCache(int maxEntries, long maxItems) {
        this.maxEntries = Math.max(1, maxEntries);
        this.maxItems = Math.max(1, maxItems);
    }

    synchronized JavascriptAnalysis get(String key) {
        return entries.get(key);
    }

    synchronized void put(String key, JavascriptAnalysis analysis) {
        JavascriptAnalysis previous = entries.put(key, analysis);
        if (previous != null) items -= weight(previous);
        items += weight(analysis);
        // Evict least recently used entries, but always keep the one just added.
        Iterator<Map.Entry<String, JavascriptAnalysis>> eldest = entries.entrySet().iterator();
        while ((entries.size() > maxEntries || items > maxItems) && entries.size() > 1 && eldest.hasNext()) {
            Map.Entry<String, JavascriptAnalysis> entry = eldest.next();
            if (entry.getKey().equals(key)) continue;
            items -= weight(entry.getValue());
            eldest.remove();
        }
    }

    synchronized void clear() {
        entries.clear();
        items = 0;
    }

    synchronized int size() { return entries.size(); }

    synchronized long items() { return items; }

    /** Retained objects grow with the call sites, assets, and issues a script yields; one is the floor per entry. */
    static long weight(JavascriptAnalysis analysis) {
        if (analysis == null) return 1;
        return 1L + analysis.callSites().size() + analysis.assets().size() + analysis.issues().size();
    }
}
