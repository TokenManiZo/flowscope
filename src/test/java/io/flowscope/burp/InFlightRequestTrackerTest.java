package io.flowscope.burp;

import io.flowscope.core.Orchestrator;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InFlightRequestTrackerTest {
    @Test
    void preservesTheRequestTimeHumanPassUntilTheMatchingResponseArrives() {
        InFlightRequestTracker tracker = new InFlightRequestTracker(10, 60_000);
        RunContextRegistry.Context pass = new RunContextRegistry.Context(SourceDetail.BURP_REPEATER,
                Orchestrator.HUMAN, ToolKind.BURP, RunPhase.EXPLORATION, "human-pass", "user-a");

        assertTrue(tracker.remember(42, pass, "user-a", false, 7, 1_000));

        InFlightRequestTracker.Observation observed = tracker.remove(42);
        assertEquals(pass, observed.context());
        assertEquals("user-a", observed.humanCaptureAccountId());
        assertFalse(observed.humanCaptureSuppressed());
        assertEquals(7, observed.datasetEpoch());
        assertTrue(observed.belongsTo(7));
        assertFalse(observed.belongsTo(8));
        assertNull(tracker.remove(42));
    }

    @Test
    void boundsInFlightStateWithoutReplacingAnExistingCorrelation() {
        InFlightRequestTracker tracker = new InFlightRequestTracker(1, 60_000);

        assertTrue(tracker.remember(1, null, null, false, 1, 1_000));
        assertFalse(tracker.remember(2, null, null, false, 1, 1_001));
        assertEquals(1, tracker.remove(1).datasetEpoch());
    }

    @Test
    void removesExpiredCorrelationsBeforeApplyingTheCapacityLimit() {
        InFlightRequestTracker tracker = new InFlightRequestTracker(1, 100);

        assertTrue(tracker.remember(1, null, null, false, 1, 1_000));
        assertTrue(tracker.remember(2, null, null, false, 2, 1_101));
        assertNull(tracker.remove(1));
        assertEquals(2, tracker.remove(2).datasetEpoch());
    }

    @Test
    void concurrentBurpCallbacksCannotExceedTheMetadataCapacity() throws Exception {
        int capacity = 8;
        int attempts = 80;
        InFlightRequestTracker tracker = new InFlightRequestTracker(capacity, 60_000);
        CountDownLatch ready = new CountDownLatch(attempts);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger accepted = new AtomicInteger();

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int messageId = 0; messageId < attempts; messageId++) {
                int id = messageId;
                executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    if (tracker.remember(id, null, null, false, 1, 1_000)) accepted.incrementAndGet();
                    return null;
                });
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
        }

        assertEquals(capacity, accepted.get());
    }

    @Test
    void preservesSuppressedCaptureStateUntilTheMatchingResponseArrives() {
        InFlightRequestTracker tracker = new InFlightRequestTracker(10, 60_000);

        assertTrue(tracker.remember(7, null, null, true, 3, 1_000));

        InFlightRequestTracker.Observation observed = tracker.remove(7);
        assertNull(observed.humanCaptureAccountId());
        assertTrue(observed.humanCaptureSuppressed());
    }
}
