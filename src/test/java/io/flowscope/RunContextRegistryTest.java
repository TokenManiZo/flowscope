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
        assertTrue(contexts.clear(Source.SCANNER, "campaign-1"));
        assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
    }
}
