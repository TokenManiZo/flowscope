package io.flowscope;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
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
    void stopsAcceptingNewCapturesAtThePerRunRecommendationLimit() {
        AtomicInteger dispatched = new AtomicInteger();
        LiveCrossIdentityReplayCoordinator coordinator = coordinator((recommendations, armed) -> {
            dispatched.addAndGet(recommendations.size());
            return result(recommendations, true);
        });
        coordinator.start(List.of("user-b"), false, true);

        for (int index = 0; index < LiveCrossIdentityReplayCoordinator.MAX_RECOMMENDATIONS_PER_RUN; index++) {
            assertTrue(coordinator.offer(eligible("GET", "ev-" + index), TARGET, true));
        }

        assertFalse(coordinator.offer(eligible("GET", "ev-over-limit"), TARGET, true));
        LiveCrossIdentityReplayCoordinator.Snapshot snapshot = coordinator.snapshot();
        assertEquals(LiveCrossIdentityReplayCoordinator.State.LIMIT_REACHED, snapshot.state());
        assertEquals(LiveCrossIdentityReplayCoordinator.MAX_RECOMMENDATIONS_PER_RUN, snapshot.queued());
        assertEquals(LiveCrossIdentityReplayCoordinator.MAX_RECOMMENDATIONS_PER_RUN, dispatched.get());
    }

    private static LiveCrossIdentityReplayCoordinator coordinator(
            LiveCrossIdentityReplayCoordinator.Dispatcher dispatcher) {
        return new LiveCrossIdentityReplayCoordinator(dispatcher, () -> { }, () -> { }, Runnable::run);
    }

    private static RequestRecord eligible(String method, String evidenceId) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443",
                method, "/api/orders/19", 200, "sub:user-a");
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
