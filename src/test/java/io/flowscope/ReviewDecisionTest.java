package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.ReviewDecision;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class ReviewDecisionTest {
    @Test
    void relatedPolicyChangesRequireReviewWithoutDeletingTheAudit() {
        AnalysisConfig config = new AnalysisConfig();
        config.withIdentityRole("alice", io.flowscope.core.AccessRole.USER);
        config.reviewItem("cell", ReviewDecision.Status.CONFIRMED, "checked", List.of("ev"));
        config.bindReviewPolicy("cell", "alice", "GET /orders", "orders:1");
        config.withEndpointRequirement("GET /other", io.flowscope.core.AccessRole.ADMIN);
        assertEquals(ReviewDecision.Status.CONFIRMED, config.reviewStatus("cell", List.of("ev")));
        config.withResourceOwner("orders:1", "bob");
        assertEquals(ReviewDecision.Status.UNRESOLVED, config.reviewStatus("cell", List.of("ev")));
        assertEquals(ReviewDecision.Status.CONFIRMED, config.reviews().get("cell").status());
    }

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
