package io.flowscope.core.discovery;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JavascriptAnalysisProcessTest {
    private final String previousTimeout = System.getProperty("flowscope.javascript.workerTimeoutSeconds");

    @AfterEach
    void cleanup() {
        if (previousTimeout == null) System.clearProperty("flowscope.javascript.workerTimeoutSeconds");
        else System.setProperty("flowscope.javascript.workerTimeoutSeconds", previousTimeout);
        JavascriptAnalysisProcess.setWorkerClassForTest(null);
        JavascriptCallSiteAnalyzer.clearCache();
    }

    @Test
    void distinctScriptsReuseOneIsolatedProcessWithoutSharingCompilerState() {
        JavascriptCallSiteAnalyzer.clearCache();
        int starts = JavascriptAnalysisProcess.processStarts();
        String first = "const route='/api/one'; fetch(route);";
        String second = "const route='/api/two'; fetch(route);";

        assertEquals(JavascriptCallSiteAnalyzer.analyzeInWorker(first),
                JavascriptCallSiteAnalyzer.analyze(first));
        assertEquals(JavascriptCallSiteAnalyzer.analyzeInWorker(second),
                JavascriptCallSiteAnalyzer.analyze(second));
        assertEquals(starts + 1, JavascriptAnalysisProcess.processStarts());

        JavascriptCallSiteAnalyzer.clearCache();
        assertTrue(JavascriptCallSiteAnalyzer.analyze("fetch('/api/three')").callSites().stream()
                .anyMatch(call -> call.reference().equals("/api/three")));
        assertEquals(starts + 2, JavascriptAnalysisProcess.processStarts());
    }

    @Test
    void unexpectedWorkerExitRestartsForTheNextScript() {
        JavascriptCallSiteAnalyzer.clearCache();
        int starts = JavascriptAnalysisProcess.processStarts();
        JavascriptCallSiteAnalyzer.analyze("fetch('/api/before-crash')");
        JavascriptAnalysisProcess.terminateWorkerForTest();

        JavascriptAnalysis after = JavascriptCallSiteAnalyzer.analyze("fetch('/api/after-crash')");

        assertEquals(JavascriptAnalysis.Status.PARSED, after.status());
        assertTrue(after.callSites().stream().anyMatch(call -> call.reference().equals("/api/after-crash")));
        assertEquals(starts + 2, JavascriptAnalysisProcess.processStarts());
    }

    @Test
    void workerIsRecycledAfterTheBoundedNumberOfRequests() {
        JavascriptCallSiteAnalyzer.clearCache();
        int starts = JavascriptAnalysisProcess.processStarts();
        for (int i = 0; i < 129; i++) {
            JavascriptAnalysis result = JavascriptCallSiteAnalyzer.analyze("fetch('/api/item/" + i + "')");
            assertEquals(JavascriptAnalysis.Status.PARSED, result.status());
        }
        assertEquals(starts + 2, JavascriptAnalysisProcess.processStarts());
    }

    @Test
    void timedOutWorkerIsKilledAndTheFollowingRequestSucceeds() {
        JavascriptCallSiteAnalyzer.clearCache();
        JavascriptAnalysisProcess.setWorkerClassForTest(StallingJavascriptAnalysisWorker.class.getName());
        System.setProperty("flowscope.javascript.workerTimeoutSeconds", "1");
        int starts = JavascriptAnalysisProcess.processStarts();

        JavascriptAnalysis timedOut = JavascriptCallSiteAnalyzer.analyze("fetch('/api/timeout')");
        assertEquals(JavascriptAnalysis.Status.LIMIT_EXCEEDED, timedOut.status());
        assertTrue(timedOut.detail().contains("exceeded"));
        assertFalse(JavascriptAnalysisProcess.workerAliveForTest());

        // Recovery starts a fresh JVM/parser; the intentional one-second timeout only applies to the stalled worker.
        System.clearProperty("flowscope.javascript.workerTimeoutSeconds");
        JavascriptAnalysisProcess.setWorkerClassForTest(null);
        JavascriptAnalysis next = JavascriptCallSiteAnalyzer.analyze("fetch('/api/after-timeout')");
        assertEquals(JavascriptAnalysis.Status.PARSED, next.status(), next::detail);
        assertTrue(next.callSites().stream().anyMatch(call -> call.reference().equals("/api/after-timeout")));
        assertEquals(starts + 2, JavascriptAnalysisProcess.processStarts());
    }

    @Test
    void incompleteOutputIsRejectedWithoutPoisoningTheNextRequest() {
        JavascriptCallSiteAnalyzer.clearCache();
        JavascriptAnalysisProcess.setWorkerClassForTest(IncompleteJavascriptAnalysisWorker.class.getName());

        JavascriptAnalysis incomplete = JavascriptCallSiteAnalyzer.analyze("fetch('/api/incomplete')");
        assertEquals(JavascriptAnalysis.Status.PARSE_FAILED, incomplete.status());

        JavascriptAnalysisProcess.setWorkerClassForTest(null);
        JavascriptAnalysis next = JavascriptCallSiteAnalyzer.analyze("fetch('/api/after-incomplete')");
        assertEquals(JavascriptAnalysis.Status.PARSED, next.status());
        assertTrue(next.callSites().stream().anyMatch(call -> call.reference().equals("/api/after-incomplete")));
    }

    @Test
    void datasetResetStopsAnActiveParserWithoutWaitingForItsTimeout() throws Exception {
        JavascriptCallSiteAnalyzer.clearCache();
        JavascriptAnalysisProcess.setWorkerClassForTest(StallingJavascriptAnalysisWorker.class.getName());
        System.setProperty("flowscope.javascript.workerTimeoutSeconds", "5");
        var pool = Executors.newSingleThreadExecutor();
        try {
            var pending = pool.submit(() -> JavascriptCallSiteAnalyzer.analyze("fetch('/api/old-project')"));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!JavascriptAnalysisProcess.workerAliveForTest() && System.nanoTime() < deadline) {
                TimeUnit.MILLISECONDS.sleep(5);
            }
            assertTrue(JavascriptAnalysisProcess.workerAliveForTest());

            long started = System.nanoTime();
            JavascriptCallSiteAnalyzer.clearCache();
            assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(2));
            assertEquals(JavascriptAnalysis.Status.PARSE_FAILED, pending.get(2, TimeUnit.SECONDS).status());
        } finally {
            pool.shutdownNow();
        }
    }
}
