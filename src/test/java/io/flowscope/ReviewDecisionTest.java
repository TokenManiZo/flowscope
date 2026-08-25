package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.ReviewDecision;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class ReviewDecisionTest {
    @Test
    void decisionOnlyAppliesToTheEvidenceSetThatHumanReviewed() {
        AnalysisConfig config = new AnalysisConfig().reviewItem("finding-1",
                ReviewDecision.Status.CONFIRMED, "reproduced", List.of("ev-2", "ev-1", "ev-1"));

        assertEquals(ReviewDecision.Status.CONFIRMED,
                config.reviewStatus("finding-1", List.of("ev-1", "ev-2")));
        assertEquals(ReviewDecision.Status.UNRESOLVED,
                config.reviewStatus("finding-1", List.of("ev-1", "ev-2", "ev-3")));
        config.clearReviews();
        assertEquals(0, config.reviews().size());
    }
}
