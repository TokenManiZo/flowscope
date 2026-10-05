package io.flowscope.burp;

import io.flowscope.core.RunPhase;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ToolKind;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlowScopeExtensionPhaseTest {
    @Test
    void 라이브_재전송은_같은_Evidence_ID의_저장본보다_방금_수집한_runtime_원문을_선택한다() {
        RequestRecord stored = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "GET", "/api/orders", 200, "user-a");
        stored.evidenceId = "same-evidence";
        RequestRecord captured = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "GET", "/api/orders", 200, "user-a");
        captured.evidenceId = "same-evidence";
        var recommendation = new CrossIdentityReplayOrchestrator.Recommendation(
                "GET /api/orders", "anon", "user-a", "same-evidence",
                URI.create("https://api.test/api/orders"), captured.runtimeId());

        assertEquals(captured.runtimeId(),
                FlowScopeExtension.liveReplayBasis(List.of(stored, captured), recommendation).runtimeId());
    }

    @Test
    void 프로젝트_설치와_종료는_같은_원자_경계를_사용한다() throws Exception {
        Object monitor = new Object();
        AtomicBoolean shuttingDown = new AtomicBoolean(false);
        AtomicBoolean installed = new AtomicBoolean(false);
        CountDownLatch installStarted = new CountDownLatch(1);
        CountDownLatch releaseInstall = new CountDownLatch(1);
        CountDownLatch shutdownAttempted = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var install = executor.submit(() -> FlowScopeExtension.runBeforeShutdown(monitor, shuttingDown, () -> {
                installStarted.countDown();
                try { releaseInstall.await(); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new RuntimeException(error); }
                installed.set(true);
            }));
            assertTrue(installStarted.await(1, TimeUnit.SECONDS));
            var shutdown = executor.submit(() -> {
                shutdownAttempted.countDown();
                synchronized (monitor) { shuttingDown.set(true); }
            });
            assertTrue(shutdownAttempted.await(1, TimeUnit.SECONDS));
            assertFalse(shuttingDown.get(), "shutdown cannot cross an in-progress dataset install");
            releaseInstall.countDown();
            assertTrue(install.get(1, TimeUnit.SECONDS));
            shutdown.get(1, TimeUnit.SECONDS);
        }
        assertTrue(installed.get());
        AtomicBoolean lateInstall = new AtomicBoolean(false);
        assertFalse(FlowScopeExtension.runBeforeShutdown(monitor, shuttingDown, () -> lateInstall.set(true)));
        assertFalse(lateInstall.get());
    }

    @Test
    void ZAP_일시_통신_실패는_세_번_연속되기_전까지_UNREACHABLE로_확정하지_않는다() {
        FlowScopeExtension.ZapProbeStatus status = new FlowScopeExtension.ZapProbeStatus();

        assertEquals("RETRYING", status.failure(false));
        assertEquals("RETRYING", status.failure(false));
        assertEquals("UNREACHABLE", status.failure(false));
    }

    @Test
    void ZAP_probe_성공은_연속_실패를_초기화하고_API_key_오류는_즉시_확정한다() {
        FlowScopeExtension.ZapProbeStatus status = new FlowScopeExtension.ZapProbeStatus();

        assertEquals("RETRYING", status.failure(false));
        status.success();
        assertEquals("RETRYING", status.failure(false));
        assertEquals("AUTH_FAILED", status.failure(true));
        assertEquals(0, status.consecutiveFailures());
        assertEquals("RETRYING", status.failure(false));
    }

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
    void A_잔여_인증은_B_캡처에서_건너뛰고_B_로그인은_계속_받는다() {
        assertNull(FlowScopeExtension.captureAccountForCredential("user-b", "user-a"));
        assertEquals("user-b", FlowScopeExtension.captureAccountForCredential("user-b", "user-b"));
        assertEquals("user-b", FlowScopeExtension.captureAccountForCredential("user-b", null));
    }

    @Test
    void A_잔여_인증으로_B_캡처가_억제된_응답은_A나_B_세션을_갱신하지_않는다() {
        assertNull(FlowScopeExtension.resolveSessionUpdateAccount(
                Source.HUMAN, null, null, "user-a", true));
        assertEquals("user-a", FlowScopeExtension.resolveSessionUpdateAccount(
                Source.HUMAN, null, null, "user-a", false));
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
