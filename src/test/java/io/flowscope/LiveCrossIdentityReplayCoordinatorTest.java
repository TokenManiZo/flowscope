package io.flowscope;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.TrafficClassification;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import io.flowscope.integration.LiveCrossIdentityReplayCoordinator;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

final class LiveCrossIdentityReplayCoordinatorTest {
    private static final URI TARGET = URI.create("https://api.test/api/orders/19");

    @Test
    void requiresExplicitArmingAndDoesNothingWhileStopped() {
        AtomicInteger dispatched = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAndGet(recommendations.size());
            return result(recommendations, true);
        });

        assertThrows(IllegalArgumentException.class,
                () -> coordinator.start(List.of("user-b"), false, false));
        assertFalse(coordinator.offer(eligible("GET", "ev-1"), TARGET, true));
        assertEquals(0, dispatched.get());
        assertEquals(LiveCrossIdentityReplayCoordinator.State.STOPPED, coordinator.snapshot().state());
    }

    @Test
    void fansEachLiveHumanRequestOutToOtherSelectedAccountsAndAnonymousOnce() {
        List<CrossIdentityReplayOrchestrator.Recommendation> dispatched = new ArrayList<>();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            assertTrue(armed);
            dispatched.addAll(recommendations);
            return result(recommendations, true);
        });
        coordinator.start(List.of("user-a", "user-b", "admin"), true, true);

        RequestRecord get = eligible("GET", "ev-get");
        assertTrue(coordinator.offer(get, TARGET, true));
        assertFalse(coordinator.offer(get, TARGET, true), "same Evidence/target pairs must be deduplicated");
        assertEquals(List.of("user-b", "admin", CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY),
                dispatched.stream().map(CrossIdentityReplayOrchestrator.Recommendation::targetIdentity).toList());
        assertTrue(dispatched.stream().noneMatch(value -> value.targetIdentity().equals("user-a")));

        RequestRecord post = eligible("POST", "ev-post");
        assertTrue(coordinator.offer(post, TARGET, true));
        LiveCrossIdentityReplayCoordinator.Snapshot snapshot = coordinator.snapshot();
        assertEquals(6, snapshot.queued());
        assertEquals(3, snapshot.sent());
        assertEquals(3, snapshot.drafted());
        assertFalse(snapshot.toString().toLowerCase().contains("authorization:"));
        assertFalse(snapshot.toString().toLowerCase().contains("cookie:"));
    }

    @Test
    void automaticAnonymousModeSendsOnlyGetAndDeduplicatesTheSamePreparedUrlAcrossAccounts() {
        List<CrossIdentityReplayOrchestrator.Recommendation> dispatched = new ArrayList<>();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAll(recommendations);
            return result(recommendations, true);
        });
        assertThrows(IllegalArgumentException.class,
                () -> coordinator.startAutomaticAnonymousGet(false));
        assertTrue(coordinator.startAutomaticAnonymousGet(true).automaticAnonymousGet());

        RequestRecord accountA = eligible("GET", "ev-a");
        assertTrue(coordinator.offer(accountA, TARGET, true, "same-request"));
        RequestRecord accountB = eligible("GET", "ev-b");
        accountB.laneAccountId = "user-b";
        assertFalse(coordinator.offer(accountB, TARGET, true, "same-request"));
        assertFalse(coordinator.offer(eligible("HEAD", "ev-head"), TARGET, true, "head-request"));
        assertTrue(coordinator.offer(eligible("GET", "ev-other"), TARGET, true, "other-request"));

        assertEquals(2, dispatched.size());
        assertTrue(dispatched.stream().allMatch(value ->
                value.targetIdentity().equals(CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY)));
        assertEquals(accountA.runtimeId(), dispatched.getFirst().basisRuntimeId());
        assertEquals("ev-a", dispatched.getFirst().basisEvidenceId());
        assertEquals(2, coordinator.snapshot().sent());
        coordinator.stop();
        assertFalse(coordinator.snapshot().automaticAnonymousGet());
    }

    @Test
    void reportsTheConcreteReplayFailureInsteadOfHidingItAsACompletedBatch() {
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            var recommendation = recommendations.getFirst();
            return new CrossIdentityReplayOrchestrator.RunResult("failed", true, 0, 0, 1,
                    List.of(new CrossIdentityReplayOrchestrator.Item(recommendation.operation(),
                            recommendation.targetIdentity(), recommendation.basisIdentity(),
                            recommendation.basisEvidenceId(),
                            CrossIdentityReplayOrchestrator.Outcome.EXECUTION_FAILED,
                            null, "CONTROLLED_SEND_FAILED")));
        });
        coordinator.startAutomaticAnonymousGet(true);

        assertTrue(coordinator.offer(eligible("GET", "ev-failed"), TARGET, true, "request"));
        RequestRecord trailingAsset = eligible("GET", "ev-asset");
        trailingAsset.trafficClassification = new TrafficClassification(
                TrafficClassification.TrafficClass.STATIC_ASSET,
                TrafficClassification.Disposition.EXCLUDE, List.of("STATIC"), false);
        assertFalse(coordinator.offer(trailingAsset, TARGET, true, "asset"));

        assertEquals("CONTROLLED_SEND_FAILED", coordinator.snapshot().lastReason());
        assertEquals(2, coordinator.snapshot().skipped());
        assertEquals(1, coordinator.snapshot().failed());
    }

    @Test
    void duplicateObservationDoesNotOverwriteTheLatestReplayFailure() {
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            var recommendation = recommendations.getFirst();
            return new CrossIdentityReplayOrchestrator.RunResult("failed", true, 0, 0, 1,
                    List.of(new CrossIdentityReplayOrchestrator.Item(recommendation.operation(),
                            recommendation.targetIdentity(), recommendation.basisIdentity(),
                            recommendation.basisEvidenceId(),
                            CrossIdentityReplayOrchestrator.Outcome.EXECUTION_FAILED,
                            null, "HTTP_NO_RESPONSE")));
        });
        coordinator.startAutomaticAnonymousGet(true);

        assertTrue(coordinator.offer(eligible("GET", "ev-a"), TARGET, true, "same-request"));
        assertFalse(coordinator.offer(eligible("GET", "ev-b"), TARGET, true, "same-request"));

        assertEquals("HTTP_NO_RESPONSE", coordinator.snapshot().lastReason());
    }

    @Test
    void automaticAnonymousModeDoesNotReplayAnAlreadyAnonymousRequest() {
        AtomicInteger dispatched = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAndGet(recommendations.size());
            return result(recommendations, true);
        });
        coordinator.startAutomaticAnonymousGet(true);

        RequestRecord anonymous = eligible("GET", "ev-anon", Fingerprints.ANONYMOUS);

        assertFalse(coordinator.offer(anonymous, TARGET, true, "anonymous-request"));
        assertEquals(0, dispatched.get());
        assertEquals("ALREADY_ANONYMOUS_BASIS", coordinator.snapshot().lastReason());
    }

    @Test
    void acceptsOnlyLiveRawIncludedHumanApiEvidenceWithKnownBasisAccount() {
        AtomicInteger dispatched = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAndGet(recommendations.size());
            return result(recommendations, true);
        });
        coordinator.start(List.of("user-b"), false, true);

        RequestRecord scanner = eligible("GET", "ev-scanner");
        scanner.executionTrust = ExecutionTrust.CONTROLLED;
        assertFalse(coordinator.offer(scanner, TARGET, true));
        RequestRecord staticAsset = eligible("GET", "ev-static");
        staticAsset.trafficClassification = new TrafficClassification(
                TrafficClassification.TrafficClass.STATIC_ASSET,
                TrafficClassification.Disposition.EXCLUDE, List.of("STATIC"), false);
        assertFalse(coordinator.offer(staticAsset, TARGET, true));
        assertFalse(coordinator.offer(eligible("GET", "ev-imported"), TARGET, false));
        RequestRecord unknownBasis = eligible("GET", "ev-unknown");
        unknownBasis.laneAccountId = null;
        assertFalse(coordinator.offer(unknownBasis, TARGET, true));

        assertEquals(0, dispatched.get());
        assertEquals(0, coordinator.snapshot().queued());
    }

    @Test
    void acceptsOnlyExplicitlySelectedControlledZapAndLlmExplorationTraffic() {
        List<CrossIdentityReplayOrchestrator.Recommendation> dispatched = new ArrayList<>();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAll(recommendations);
            return result(recommendations, true);
        });
        coordinator.start(List.of("user-b"), false, List.of(Source.SCANNER, Source.LLM), true);

        RequestRecord zap = controlled(Source.SCANNER, SourceDetail.ZAP_CLIENT_SPIDER, "zap-user", "ev-zap");
        RequestRecord llm = controlled(Source.LLM, SourceDetail.LLM_EXPLORER, "llm-user", "ev-llm");
        assertTrue(coordinator.offer(zap, TARGET, true));
        assertTrue(coordinator.offer(llm, TARGET, true));

        RequestRecord human = eligible("GET", "ev-human");
        assertFalse(coordinator.offer(human, TARGET, true), "unselected HUMAN must not become a basis");
        RequestRecord replay = controlled(Source.SCANNER, SourceDetail.AUTHORIZATION_REPLAY,
                "user-b", "ev-replay");
        replay.phase = RunPhase.AUTHORIZATION_REPLAY;
        assertFalse(coordinator.offer(replay, TARGET, true), "replay output must never feed itself");
        RequestRecord login = controlled(Source.SCANNER, SourceDetail.ZAP_AUTHENTICATION,
                "zap-user", "ev-login");
        login.phase = RunPhase.SESSION_SETUP;
        assertFalse(coordinator.offer(login, TARGET, true), "session setup is not an authorization basis");

        assertEquals(List.of("ev-zap", "ev-llm"), dispatched.stream()
                .map(CrossIdentityReplayOrchestrator.Recommendation::basisEvidenceId).toList());
        assertEquals(List.of(Source.SCANNER, Source.LLM), coordinator.snapshot().basisSources());
    }

    @Test
    void stopPreventsSubsequentCapturedRequestsFromDispatching() {
        AtomicInteger dispatched = new AtomicInteger();
        AtomicInteger kills = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = new LiveCrossIdentityReplayCoordinator(
                (recommendations, armed) -> {
                    dispatched.addAndGet(recommendations.size());
                    return result(recommendations, true);
                }, () -> { }, kills::incrementAndGet, Runnable::run);
        coordinator.start(List.of("user-b"), false, true);
        assertTrue(coordinator.offer(eligible("GET", "ev-before"), TARGET, true));

        coordinator.stop();

        assertFalse(coordinator.offer(eligible("GET", "ev-after"), TARGET, true));
        assertEquals(1, dispatched.get());
        assertEquals(1, kills.get());
        assertEquals(LiveCrossIdentityReplayCoordinator.State.STOPPED, coordinator.snapshot().state());
    }

    @Test
    void doesNotDropUniqueRequestsAfterTheFormerPerRunLimit() {
        AtomicInteger dispatched = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAndGet(recommendations.size());
            return result(recommendations, true);
        });
        coordinator.start(List.of("user-b"), false, true);

        for (int index = 0; index < 250; index++) {
            assertTrue(coordinator.offer(eligible("GET", "ev-" + index), TARGET, true));
        }

        LiveCrossIdentityReplayCoordinator.Snapshot snapshot = coordinator.snapshot();
        assertEquals(LiveCrossIdentityReplayCoordinator.State.ACTIVE, snapshot.state());
        assertEquals(250, snapshot.queued());
        assertEquals(250, dispatched.get());
    }

    private static LiveCrossIdentityReplayCoordinator coordinator(
            LiveCrossIdentityReplayCoordinator.Dispatcher dispatcher) {
        return new LiveCrossIdentityReplayCoordinator(dispatcher, () -> { }, () -> { }, Runnable::run);
    }

    private static RequestRecord eligible(String method, String evidenceId) {
        return eligible(method, evidenceId, "sub:user-a");
    }

    private static RequestRecord eligible(String method, String evidenceId, String fingerprint) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443",
                method, "/api/orders/19", 200, fingerprint);
        record.hasResponse = true;
        record.executionTrust = ExecutionTrust.OBSERVED;
        record.laneAccountId = "user-a";
        record.evidenceId = evidenceId;
        record.op = method + " /api/orders/{id}";
        record.trafficClassification = new TrafficClassification(
                TrafficClassification.TrafficClass.API,
                TrafficClassification.Disposition.INCLUDE, List.of("API"), false);
        return record;
    }

    private static RequestRecord controlled(Source source, SourceDetail detail,
                                            String accountId, String evidenceId) {
        RequestRecord record = new RequestRecord(source, "https://api.test:443",
                "GET", "/api/orders/19", 200, "sub:" + accountId);
        record.hasResponse = true;
        record.executionTrust = ExecutionTrust.CONTROLLED;
        record.sourceDetail = detail;
        record.phase = RunPhase.EXPLORATION;
        record.laneAccountId = accountId;
        record.evidenceId = evidenceId;
        record.op = "GET /api/orders/{id}";
        record.trafficClassification = new TrafficClassification(
                TrafficClassification.TrafficClass.API,
                TrafficClassification.Disposition.INCLUDE, List.of("API"), false);
        return record;
    }

    private static CrossIdentityReplayOrchestrator.RunResult result(
            List<CrossIdentityReplayOrchestrator.Recommendation> recommendations, boolean armed) {
        int sent = 0;
        int drafted = 0;
        List<CrossIdentityReplayOrchestrator.Item> items = new ArrayList<>();
        for (CrossIdentityReplayOrchestrator.Recommendation recommendation : recommendations) {
            boolean safe = recommendation.operation().startsWith("GET ")
                    || recommendation.operation().startsWith("HEAD ");
            if (safe) sent++; else drafted++;
            items.add(new CrossIdentityReplayOrchestrator.Item(recommendation.operation(),
                    recommendation.targetIdentity(), recommendation.basisIdentity(),
                    recommendation.basisEvidenceId(), safe
                    ? CrossIdentityReplayOrchestrator.Outcome.SENT
                    : CrossIdentityReplayOrchestrator.Outcome.DRAFTED, null,
                    safe ? "CONTROLLED_RESPONSE_RECORDED" : "REPEATER_DRAFT_ONLY"));
        }
        return new CrossIdentityReplayOrchestrator.RunResult("batch", armed, sent, drafted, 0, items);
    }
}
