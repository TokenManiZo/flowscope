package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class RunContextRegistryTest {
    @Test
    void switchesTheAccountInsideOneScannerCampaignWithoutCompletingTheLaneEarly() {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, "campaign-1", null));

        contexts.transition(Source.SCANNER, "campaign-1", SourceDetail.ZAP_CLIENT_SPIDER, "user-a");

        assertEquals("user-a", contexts.current(Source.SCANNER).accountId());
        assertEquals(SourceDetail.ZAP_CLIENT_SPIDER, contexts.current(Source.SCANNER).detail());
        assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
        complete(contexts, Source.SCANNER, SourceDetail.ZAP_CLIENT_SPIDER, "campaign-1");
        assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
    }

    @Test
    void newExplorationInvalidatesThePreviousCompletionUntilItEnds() {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "llm-first"));
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "llm-first");
        assertTrue(contexts.completedExplorations().contains(Source.LLM));

        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "llm-retry"));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
        assertTrue(contexts.abort(Source.LLM, "llm-retry"));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void launcherCanRevokeACompletionThatFailedItsEvidenceGate() {
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "llm-no-evidence"));
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "llm-no-evidence");

        contexts.invalidateCompleted(Source.LLM);

        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void independentHumanRunsRequireExactIdsAndDoNotCompleteWhileAnotherWindowIsActive() {
        RunContextRegistry contexts = new RunContextRegistry();
        var a = new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, "human-a", "A");
        var b = new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, "human-b", "B");
        contexts.activateHuman(a);
        contexts.activateHuman(b);
        contexts.activateHuman(new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, "human-anon", null));
        assertNull(contexts.current(Source.HUMAN));
        assertEquals(a, contexts.current(Source.HUMAN, "human-a"));
        assertTrue(contexts.hasActiveRuns());
        assertThrows(IllegalStateException.class, () -> contexts.activateHuman(a));
        assertThrows(IllegalStateException.class, () -> contexts.activateHuman(new RunContextRegistry.Context(
                SourceDetail.BROWSER, Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "a-again", "A")));
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "human-a");
        assertEquals(b, contexts.current(Source.HUMAN, "human-b"));
        assertFalse(contexts.completedExplorations().contains(Source.HUMAN));
        assertTrue(contexts.abort(Source.HUMAN, "human-b"));
        assertTrue(contexts.abort(Source.HUMAN, "human-anon"));
        assertTrue(contexts.completedExplorations().contains(Source.HUMAN));
        assertFalse(contexts.hasActiveRuns());
        contexts.reset();
        assertTrue(contexts.activeHumanRuns().isEmpty());
        assertTrue(contexts.completedExplorations().isEmpty());
    }

    @Test
    void pauseAndResumeInvalidateLateResponsesWithoutEndingOtherAccounts() {
        RunContextRegistry contexts = new RunContextRegistry();
        var a = new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, "a", "A");
        var b = new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, "b", "B");
        contexts.activateHuman(a);
        contexts.activateHuman(b);
        long first = contexts.humanCaptureGeneration("a");
        long other = contexts.humanCaptureGeneration("b");
        assertTrue(contexts.acceptsHumanCapture("a", first));
        contexts.pauseHuman("a", true);
        assertTrue(contexts.humanPaused("a"));
        assertEquals(-1, contexts.humanCaptureGeneration("a"));
        assertFalse(contexts.acceptsHumanCapture("a", first));
        assertTrue(contexts.acceptsHumanCapture("b", other));
        assertEquals(a, contexts.current(Source.HUMAN, "a"));
        contexts.pauseHuman("a", false);
        long resumed = contexts.humanCaptureGeneration("a");
        assertTrue(contexts.acceptsHumanCapture("a", resumed));
        assertFalse(contexts.acceptsHumanCapture("a", first));
        contexts.abort(Source.HUMAN, "a");
        assertFalse(contexts.acceptsHumanCapture("a", resumed));
        assertFalse(contexts.humanPaused("a"));
        assertThrows(IllegalArgumentException.class, () -> contexts.pauseHuman("a", false));
        contexts.activateHuman(a);
        assertFalse(contexts.acceptsHumanCapture("a", resumed), "Reusing a run ID must not revive late responses");
        contexts.clear(Source.HUMAN);
        assertFalse(contexts.acceptsHumanCapture("b", other));
        contexts.activateHuman(a);
        long restarted = contexts.humanCaptureGeneration("a");
        contexts.reset();
        assertFalse(contexts.acceptsHumanCapture("a", restarted));
    }

    @Test
    void scannerAndLlmRejectEachOtherWithoutChangingHumanRuns() {
        for (Source first : java.util.List.of(Source.SCANNER, Source.LLM)) {
            RunContextRegistry contexts = new RunContextRegistry();
            contexts.activateHuman(context(Source.HUMAN, "human-a", "A"));
            contexts.activateHuman(context(Source.HUMAN, "human-b", "B"));
            long generation = contexts.humanCaptureGeneration("human-a");
            Source second = first == Source.SCANNER ? Source.LLM : Source.SCANNER;
            contexts.activate(first, context(first, "first", null));
            assertThrows(IllegalStateException.class, () -> contexts.activate(second, context(second, "second", null)));
            assertNull(contexts.current(second));
            assertEquals("first", contexts.current(first).runId());
            contexts.activateHuman(context(Source.HUMAN, "human-anon", null));
            assertEquals(3, contexts.activeHumanRuns().size());
            assertEquals(generation, contexts.humanCaptureGeneration("human-a"));
            assertTrue(contexts.abort(Source.HUMAN, "human-b"));
            assertNotNull(contexts.current(first));
            assertTrue(contexts.abort(first, "first"));
            contexts.activate(second, context(second, "second", null));
            assertNotNull(contexts.current(second));
            assertEquals(2, contexts.activeHumanRuns().size());
        }
    }

    @Test
    void simultaneousScannerAndLlmStartsRegisterExactlyOneRun() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        var ready = new java.util.concurrent.CountDownLatch(2);
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var attempts = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (Source source : java.util.List.of(Source.SCANNER, Source.LLM)) {
                attempts.add(workers.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("start timed out");
                    try {
                        contexts.activate(source, context(source, source.name(), null));
                        return true;
                    } catch (IllegalStateException rejected) {
                        return false;
                    }
                }));
            }
            try { assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS)); }
            finally { start.countDown(); }
            int accepted = 0;
            for (var attempt : attempts) if (attempt.get(5, java.util.concurrent.TimeUnit.SECONDS)) accepted++;
            assertEquals(1, accepted);
            assertNotEquals(contexts.current(Source.SCANNER) == null, contexts.current(Source.LLM) == null);
        }
    }

    private static RunContextRegistry.Context context(Source source, String runId, String accountId) {
        return new RunContextRegistry.Context(source == Source.HUMAN ? SourceDetail.BROWSER
                : source == Source.SCANNER ? SourceDetail.ZAP_CLIENT_SPIDER : SourceDetail.LLM_EXPLORER,
                source == Source.HUMAN ? Orchestrator.HUMAN : source == Source.SCANNER ? Orchestrator.SYSTEM : Orchestrator.LLM,
                source == Source.HUMAN ? ToolKind.BROWSER : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.CODEX,
                RunPhase.EXPLORATION, runId, accountId);
    }

    private static void complete(RunContextRegistry contexts, Source source, SourceDetail detail, String runId) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/health", 200, "test");
        record.hasResponse = true;
        record.body = "{\"ok\":true}";
        record.sourceDetail = detail;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.SYSTEM;
        record.tool = source == Source.LLM ? ToolKind.CODEX : ToolKind.ZAP;
        record.phase = RunPhase.EXPLORATION;
        record.runId = runId;
        record.executionTrust = source == Source.HUMAN
                ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        assertNotNull(LaneCompletionPolicy.complete(contexts, source, runId, Pipeline.run(java.util.List.of(record))));
    }
}
