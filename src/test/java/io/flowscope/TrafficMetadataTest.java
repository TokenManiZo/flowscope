package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TrafficMetadataTest {

    @Test
    void 세_관측소스와_세부분류를_구분한다() {
        assertEquals("LLM", Source.LLM.label());
        assertTrue(SourceDetail.ZAP_ACTIVE_SCAN.belongsTo(Source.SCANNER));
        assertFalse(SourceDetail.ZAP_ACTIVE_SCAN.belongsTo(Source.LLM));
        assertTrue(SourceDetail.LLM_COACH_PROBE.belongsTo(Source.LLM));
    }

    @Test
    void 스캐너를_LLM이_지시해도_실제소스는_스캐너다() {
        RequestRecord r = new RequestRecord(Source.SCANNER, "https://t:443", "GET", "/", 200, "anon");
        r.sourceDetail = SourceDetail.ZAP_ACTIVE_SCAN;
        r.orchestrator = Orchestrator.LLM;
        r.tool = ToolKind.ZAP;
        r.phase = RunPhase.EXPLORATION;
        r.runId = "zap-run-1";

        assertEquals(Source.SCANNER, r.source);
        assertEquals(Orchestrator.LLM, r.orchestrator);
        assertEquals(ToolKind.ZAP, r.tool);
    }

    @Test
    void 실행컨텍스트는_겹쳐쓸수없고_runId가_맞아야_종료된다() {
        RunContextRegistry registry = new RunContextRegistry();
        RunContextRegistry.Context first = new RunContextRegistry.Context(
                SourceDetail.LLM_EXPLORER, Orchestrator.LLM, ToolKind.CODEX,
                RunPhase.EXPLORATION, "llm-1");
        registry.activate(Source.LLM, first);

        assertThrows(IllegalStateException.class, () -> registry.activate(Source.LLM,
                new RunContextRegistry.Context(SourceDetail.LLM_VALIDATION, Orchestrator.LLM,
                        ToolKind.CODEX, RunPhase.VALIDATION, "llm-2")));
        assertFalse(registry.clear(Source.LLM, "llm-other"));
        assertEquals("llm-1", registry.current(Source.LLM).runId());
        RequestRecord evidence = new RequestRecord(Source.LLM, "https://api.example.test:443",
                "GET", "/health", 200, "test");
        evidence.hasResponse = true;
        evidence.body = "{\"ok\":true}";
        evidence.sourceDetail = SourceDetail.LLM_EXPLORER;
        evidence.orchestrator = Orchestrator.LLM;
        evidence.tool = ToolKind.CODEX;
        evidence.phase = RunPhase.EXPLORATION;
        evidence.runId = "llm-1";
        evidence.executionTrust = ExecutionTrust.CONTROLLED;
        assertNotNull(LaneCompletionPolicy.complete(registry, Source.LLM, "llm-1",
                Pipeline.run(java.util.List.of(evidence))));
        assertNull(registry.current(Source.LLM));
        assertTrue(registry.completedExplorations().contains(Source.LLM));
    }
}
