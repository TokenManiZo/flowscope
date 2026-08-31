package io.flowscope.burp;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnalysisPublicationGateTest {
    @Test
    void rejectsAResultAfterTheInputStateWasInvalidated() {
        AnalysisPublicationGate gate = new AnalysisPublicationGate();
        long staleEpoch = gate.invalidate();
        gate.invalidate();
        AtomicBoolean published = new AtomicBoolean();

        assertFalse(gate.publishIfCurrent(staleEpoch, () -> published.set(true)));
        assertFalse(published.get());
    }

    @Test
    void publishesOnlyTheCurrentInputState() {
        AnalysisPublicationGate gate = new AnalysisPublicationGate();
        long currentEpoch = gate.invalidate();
        AtomicBoolean published = new AtomicBoolean();

        assertTrue(gate.publishIfCurrent(currentEpoch, () -> published.set(true)));
        assertTrue(published.get());
    }
}
