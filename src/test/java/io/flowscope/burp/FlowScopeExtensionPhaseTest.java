package io.flowscope.burp;

import io.flowscope.core.RunPhase;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlowScopeExtensionPhaseTest {
    @Test
    void HUMAN_로그인_캡처만_SESSION_SETUP으로_분리한다() {
        assertEquals(RunPhase.SESSION_SETUP,
                FlowScopeExtension.capturePhase(Source.HUMAN, SourceDetail.BROWSER, true));
        assertEquals(RunPhase.BASELINE,
                FlowScopeExtension.capturePhase(Source.HUMAN, SourceDetail.BROWSER, false));
    }

    @Test
    void 다른_source의_기존_phase는_바꾸지_않는다() {
        assertEquals(RunPhase.EXPLORATION,
                FlowScopeExtension.capturePhase(Source.LLM, SourceDetail.LLM_EXPLORER, false));
        assertEquals(RunPhase.EXPLORATION,
                FlowScopeExtension.capturePhase(Source.SCANNER, SourceDetail.ZAP_SPIDER, false));
    }

    @Test
    void HUMAN_pass의_선택_계정은_실제_브로커_세션과_일치할_때만_귀속한다() {
        assertEquals("user-a", FlowScopeExtension.resolveObservedAccount(
                Source.HUMAN, "user-a", null, "user-a"));
        assertNull(FlowScopeExtension.resolveObservedAccount(
                Source.HUMAN, "user-a", null, "user-b"));
        assertNull(FlowScopeExtension.resolveObservedAccount(
                Source.HUMAN, "user-a", null, null));
    }

    @Test
    void 로그인_캡처_계정과_통제_도구_계정은_요청_문맥을_보존한다() {
        assertEquals("user-a", FlowScopeExtension.resolveObservedAccount(
                Source.HUMAN, null, "user-a", null));
        assertEquals("user-b", FlowScopeExtension.resolveObservedAccount(
                Source.SCANNER, "user-b", null, null));
    }

    @Test
    void fresh_SYSTEM_ZAP_익명_lane의_서버_발급_cookie는_새_신원을_만들지_않는다() {
        RunContextRegistry.Context anonymousLane = new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, "zap-anon", null);

        assertEquals("anon", FlowScopeExtension.captureFingerprint(
                Source.SCANNER, anonymousLane, null, null, "tracking=rotated-value"));
    }

    @Test
    void 활성_run이나_Judge_lock이_있으면_범위_변경을_막는다() {
        RunContextRegistry contexts = new RunContextRegistry();
        assertFalse(FlowScopeExtension.scopeMutationBlocked(false, contexts));
        assertTrue(FlowScopeExtension.scopeMutationBlocked(true, contexts));

        contexts.activate(Source.HUMAN, new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.BASELINE, "human-active"));
        assertTrue(FlowScopeExtension.scopeMutationBlocked(false, contexts));
    }
}
