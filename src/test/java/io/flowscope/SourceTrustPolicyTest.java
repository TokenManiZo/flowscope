package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class SourceTrustPolicyTest {
    @Test
    void purposeSpecificTrustDoesNotPromoteUnverifiedRuntimeTraffic() {
        assertTrue(SourceTrustPolicy.allows(Source.HUMAN, ExecutionTrust.OBSERVED,
                SourceTrustPolicy.Use.LANE_COMPLETION));
        assertTrue(SourceTrustPolicy.allows(Source.SCANNER, ExecutionTrust.CONTROLLED,
                SourceTrustPolicy.Use.DATASET_LOCK));
        assertTrue(SourceTrustPolicy.allows(Source.LLM, ExecutionTrust.CONTROLLED,
                SourceTrustPolicy.Use.EXPLORER_VISIBILITY));

        for (SourceTrustPolicy.Use use : SourceTrustPolicy.Use.values()) {
            assertFalse(SourceTrustPolicy.allows(Source.LLM, ExecutionTrust.UNVERIFIED_RUNTIME, use), use.name());
        }
        assertFalse(SourceTrustPolicy.allows(Source.SCANNER, ExecutionTrust.IMPORTED,
                SourceTrustPolicy.Use.LANE_COMPLETION));
        assertTrue(SourceTrustPolicy.allows(Source.SCANNER, ExecutionTrust.IMPORTED,
                SourceTrustPolicy.Use.ANALYSIS_COVERAGE));
        assertFalse(SourceTrustPolicy.allows(Source.HUMAN, ExecutionTrust.OBSERVED,
                SourceTrustPolicy.Use.DECISIVE_VERDICT));
    }
}
