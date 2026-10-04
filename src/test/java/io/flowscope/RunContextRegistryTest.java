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
