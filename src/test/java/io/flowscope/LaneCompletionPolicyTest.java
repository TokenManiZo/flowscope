package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

final class LaneCompletionPolicyTest {
    @Test
    void controlledLlmAndObservedHumanCompleteButUnverifiedLlmCannot() {
        String controlledRun = "controlled-" + UUID.randomUUID();
        String unverifiedRun = "unverified-" + UUID.randomUUID();
        String humanRun = "human-" + UUID.randomUUID();

        Pipeline.Result snapshot = Pipeline.run(List.of(
                evidence(Source.LLM, controlledRun, ExecutionTrust.CONTROLLED),
                evidence(Source.LLM, unverifiedRun, ExecutionTrust.UNVERIFIED_RUNTIME),
                evidence(Source.HUMAN, humanRun, ExecutionTrust.OBSERVED)));

        assertTrue(LaneCompletionPolicy.evaluate(Source.LLM, controlledRun, snapshot).eligible());
        assertFalse(LaneCompletionPolicy.evaluate(Source.LLM, unverifiedRun, snapshot).eligible());
        assertTrue(LaneCompletionPolicy.evaluate(Source.HUMAN, humanRun, snapshot).eligible());
        assertEquals(2, snapshot.coverageRecords.size(),
                "explicitly unverified runtime traffic must remain in raw records but leave coverage");
        assertEquals(3, snapshot.records.size());
    }

    @Test
    void completionRetainsExactEvidenceMembership() {
        String runId = "scanner-" + UUID.randomUUID();
        RequestRecord original = evidence(Source.SCANNER, runId, ExecutionTrust.CONTROLLED);
        Pipeline.Result completionSnapshot = Pipeline.run(List.of(original));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.SCANNER, new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, runId));

        RunContextRegistry.CompletedRun completed = LaneCompletionPolicy.complete(
                contexts, Source.SCANNER, runId, completionSnapshot);
        assertEquals(List.of(original.evidenceId), completed.evidenceIds());
        assertThrows(UnsupportedOperationException.class, () -> completed.evidenceIds().add("late"));
        assertNull(contexts.current(Source.SCANNER));
    }

    private static RequestRecord evidence(Source source, String runId, ExecutionTrust trust) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/v1/health/" + UUID.randomUUID(), 200, "test");
        record.hasResponse = true;
        record.body = "{\"ok\":true}";
        record.sourceDetail = switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.ZAP_SPIDER;
            case LLM -> SourceDetail.LLM_EXPLORER;
            default -> SourceDetail.UNKNOWN;
        };
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.SYSTEM;
        record.tool = source == Source.LLM ? ToolKind.CODEX
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.BROWSER;
        record.phase = RunPhase.EXPLORATION;
        record.runId = runId;
        record.executionTrust = trust;
        return record;
    }
}
