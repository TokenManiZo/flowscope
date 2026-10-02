package io.flowscope.core.discovery;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertSame;

class JavascriptAnalysisConcurrencyTest {
    @Test
    void concurrentCallersShareOneParseOfTheSameScript() throws Exception {
        // Rebuild worker, snapshot request, and LLM gateway used to each start a parser JVM for the same script.
        String script = "fetch('/api/concurrency/" + System.nanoTime() + "');";
        int callers = 4;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        try {
            List<Future<JavascriptAnalysis>> results = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return JavascriptCallSiteAnalyzer.analyze(script);
                }));
            }
            start.countDown();
            JavascriptAnalysis first = results.get(0).get();
            // Each separate parse deserializes a new instance; one shared parse hands every caller the same one.
            for (Future<JavascriptAnalysis> result : results) assertSame(first, result.get());
        } finally {
            pool.shutdownNow();
        }
    }
}
