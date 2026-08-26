package io.flowscope;

import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateViews;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class RouteCandidateViewsTest {
    @Test
    void runViewKeepsOnlyOwnProvenanceAndRecomputesObservedAndApplicability() {
        RouteCandidate merged = new RouteCandidate("https://api.test:443", "GET", "/orders/{id}", true,
                List.of(
                        provenance(RouteCandidate.ProvenanceType.OBSERVED_REQUEST, "human-observed", Source.HUMAN,
                                "human-1", RouteCandidate.Applicability.APPLICABLE, "human observed"),
                        provenance(RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, "llm-script", Source.LLM,
                                "llm-1", RouteCandidate.Applicability.REVIEW, "llm literal")),
                RouteCandidate.Applicability.APPLICABLE, "실제 request/response 관측");
        RouteCandidate hidden = new RouteCandidate("https://api.test:443", "POST", "/admin", false,
                List.of(provenance(RouteCandidate.ProvenanceType.OPENAPI, "human-openapi", Source.HUMAN,
                        "human-1", RouteCandidate.Applicability.APPLICABLE, "human spec")),
                RouteCandidate.Applicability.APPLICABLE, "human spec");

        List<RouteCandidate> visible = RouteCandidateViews.forRun(List.of(merged, hidden), Source.LLM, "llm-1");

        assertEquals(1, visible.size());
        RouteCandidate candidate = visible.getFirst();
        assertFalse(candidate.observed(), "다른 source의 관측 상태가 현재 run으로 새면 안 됨");
        assertEquals(RouteCandidate.Applicability.REVIEW, candidate.applicability());
        assertEquals("llm literal", candidate.reviewReason());
        assertEquals(List.of("llm-script"), candidate.provenanceEvidenceIds());
        assertEquals(Source.LLM, candidate.provenance().getFirst().source());
    }

    private static RouteCandidate.Provenance provenance(RouteCandidate.ProvenanceType type, String evidence,
                                                        Source source, String runId,
                                                        RouteCandidate.Applicability applicability, String reason) {
        return new RouteCandidate.Provenance(type, evidence, source, runId, "fixture", applicability, reason);
    }
}
