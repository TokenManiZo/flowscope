package io.flowscope.burp;

import io.flowscope.core.RunPhase;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlowScopeExtensionPhaseTest {
    @Test
    void countsCapturedScannerRecordsFromTheRawStoreBeforePipelineRebuild() {
        RequestRecord matching = new RequestRecord(Source.SCANNER, "https://api.example.test:443",
                "GET", "/v1/orders", 200, "anon");
        matching.runId = "zap-1";
        matching.sourceDetail = SourceDetail.ZAP_SPIDER;
        RequestRecord otherStage = new RequestRecord(Source.SCANNER, "https://api.example.test:443",
                "GET", "/v1/profile", 200, "anon");
        otherStage.runId = "zap-1";
        otherStage.sourceDetail = SourceDetail.ZAP_CLIENT_SPIDER;
        RequestRecord otherRun = new RequestRecord(Source.SCANNER, "https://api.example.test:443",
                "GET", "/v1/admin", 200, "anon");
        otherRun.runId = "zap-2";
        otherRun.sourceDetail = SourceDetail.ZAP_SPIDER;

        List<RequestRecord> raw = List.of(matching, otherStage, otherRun);
        assertEquals(2, FlowScopeExtension.capturedCount(raw, Source.SCANNER, "zap-1", null));
        assertEquals(1, FlowScopeExtension.capturedCount(raw, Source.SCANNER, "zap-1",
                SourceDetail.ZAP_SPIDER));
    }

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
        assertEquals(RunPhase.SESSION_SETUP,
                FlowScopeExtension.capturePhase(Source.SCANNER, SourceDetail.ZAP_AUTHENTICATION, false));
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
    void Burp_내장_Scanner는_활성_ZAP_run_context를_상속하지_않는다() {
        RunContextRegistry.Context zapLane = new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, "zap-run", "user-a");

        assertNull(FlowScopeExtension.toolRunContext(SourceDetail.OTHER_SCANNER, zapLane));
        assertEquals(zapLane, FlowScopeExtension.toolRunContext(SourceDetail.ZAP_SPIDER, zapLane));
    }

    @Test
    void SYSTEM_ZAP_lane은_run별_capability가_맞는_요청만_허용한다() {
        RunContextRegistry.Context zapLane = new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, "zap-run", "user-a");

        assertTrue(FlowScopeExtension.scannerCampaignRequestAllowed(
                zapLane, "zap-run", "capability", "capability"));
        assertFalse(FlowScopeExtension.scannerCampaignRequestAllowed(
                zapLane, "zap-run", "capability", "wrong"));
        assertFalse(FlowScopeExtension.scannerCampaignRequestAllowed(
                zapLane, "other-run", "capability", "capability"));
    }

    @Test
    void ZAP_직접_로그인_lane만_ZAP이_만든_인증값을_보존한다() {
        RunContextRegistry.Context zapLane = new RunContextRegistry.Context(SourceDetail.ZAP_SPIDER,
                Orchestrator.SYSTEM, ToolKind.ZAP, RunPhase.EXPLORATION, "zap-run", "zap-user-a");
        RunContextRegistry.Context humanLane = new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "zap-run", "user-a");

        assertTrue(FlowScopeExtension.scannerUsesDirectAuthentication(zapLane, "zap-run"));
        assertFalse(FlowScopeExtension.scannerUsesDirectAuthentication(zapLane, "other-run"));
        assertFalse(FlowScopeExtension.scannerUsesDirectAuthentication(humanLane, "zap-run"));
    }

    @Test
    void 활성_run이_있으면_범위_변경을_막는다() {
        RunContextRegistry contexts = new RunContextRegistry();
        assertFalse(FlowScopeExtension.scopeMutationBlocked(contexts));

        contexts.activate(Source.HUMAN, new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.BASELINE, "human-active"));
        assertTrue(FlowScopeExtension.scopeMutationBlocked(contexts));
    }

    @Test
    void HUMAN_pass_안의_Repeater와_Intruder는_브라우저로_덮어쓰지_않는다() {
        RunContextRegistry.Context humanPass = new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "human-pass");

        assertEquals(SourceDetail.BURP_REPEATER, FlowScopeExtension.effectiveDetail(
                Source.HUMAN, SourceDetail.BURP_REPEATER, humanPass));
        assertEquals(SourceDetail.BURP_INTRUDER, FlowScopeExtension.effectiveDetail(
                Source.HUMAN, SourceDetail.BURP_INTRUDER, humanPass));
        assertEquals(ToolKind.BURP, FlowScopeExtension.effectiveTool(
                Source.HUMAN, SourceDetail.BURP_REPEATER, humanPass));
        assertEquals(ToolKind.BURP, FlowScopeExtension.effectiveTool(
                Source.HUMAN, SourceDetail.BURP_INTRUDER, humanPass));
        assertEquals(ToolKind.BURP, FlowScopeExtension.effectiveTool(
                Source.HUMAN, SourceDetail.BURP_REPEATER, null));
    }

    @Test
    void HUMAN_pass의_브라우저와_통제_lane은_run_context_도구를_유지한다() {
        RunContextRegistry.Context humanPass = new RunContextRegistry.Context(SourceDetail.BROWSER,
                Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "human-pass");
        RunContextRegistry.Context controlledLlm = new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "llm-pass");

        assertEquals(SourceDetail.BROWSER, FlowScopeExtension.effectiveDetail(
                Source.HUMAN, SourceDetail.BROWSER, humanPass));
        assertEquals(ToolKind.BROWSER, FlowScopeExtension.effectiveTool(
                Source.HUMAN, SourceDetail.BROWSER, humanPass));
        assertEquals(SourceDetail.LLM_EXPLORER, FlowScopeExtension.effectiveDetail(
                Source.LLM, SourceDetail.UNKNOWN, controlledLlm));
        assertEquals(ToolKind.CODEX, FlowScopeExtension.effectiveTool(
                Source.LLM, SourceDetail.UNKNOWN, controlledLlm));
    }
}
