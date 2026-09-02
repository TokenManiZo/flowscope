package io.flowscope.core;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/** 병합 후보를 provenance 경계로 잘라 source/run별로 다시 판정한다. */
public final class RouteCandidateViews {
    private RouteCandidateViews() {}

    public static List<RouteCandidate> forRun(Collection<RouteCandidate> candidates, Source source, String runId) {
        if (source == null || runId == null || runId.isBlank()) return List.of();
        List<RouteCandidate> visible = new ArrayList<>();
        for (RouteCandidate candidate : candidates == null ? List.<RouteCandidate>of() : candidates) {
            List<RouteCandidate.Provenance> provenance = candidate.provenance().stream()
                    .filter(item -> item.source() == source && runId.equals(item.runId())).toList();
            if (provenance.isEmpty()) continue;
            boolean observed = provenance.stream().anyMatch(item ->
                    item.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST);
            RouteCandidate.Applicability applicability = observed || provenance.stream().anyMatch(item ->
                    item.applicability() == RouteCandidate.Applicability.APPLICABLE)
                    ? RouteCandidate.Applicability.APPLICABLE : RouteCandidate.Applicability.REVIEW;
            String reason = observed ? "실제 request/response 관측"
                    : provenance.stream().filter(item -> item.applicability() == applicability)
                    .map(RouteCandidate.Provenance::reason).filter(value -> !value.isBlank())
                    .findFirst().orElse("현재 source/run provenance만 표시");
            visible.add(new RouteCandidate(candidate.service(), candidate.method(), candidate.pathTemplate(),
                    candidate.concretePaths(), candidate.concretePathsTruncated(), observed,
                    provenance, applicability, reason));
        }
        return RouteCandidateExtractor.prioritized(visible);
    }
}
