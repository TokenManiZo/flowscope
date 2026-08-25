package io.flowscope.core;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;

/** 실제 검증·대조 Evidence 번들에 묶인 LLM 최종 판정. */
public record ValidationDecision(
        String candidateId,
        FinalVerdict verdict,
        String reason,
        List<String> originalEvidenceIds,
        List<String> validationEvidenceIds,
        List<String> controlEvidenceIds,
        String runId,
        Instant decidedAt) {

    public enum FinalVerdict { CONFIRMED, INCONCLUSIVE, REJECTED }

    public ValidationDecision {
        if (candidateId == null || candidateId.isBlank()) throw new IllegalArgumentException("candidateId is required");
        if (verdict == null) throw new IllegalArgumentException("verdict is required");
        if (reason == null || reason.isBlank()) throw new IllegalArgumentException("reason is required");
        originalEvidenceIds = immutable(originalEvidenceIds);
        validationEvidenceIds = immutable(validationEvidenceIds);
        controlEvidenceIds = immutable(controlEvidenceIds);
        runId = runId == null ? "" : runId;
        decidedAt = decidedAt == null ? Instant.now() : decidedAt;
    }

    public List<String> allEvidenceIds() {
        LinkedHashSet<String> all = new LinkedHashSet<>(originalEvidenceIds);
        all.addAll(validationEvidenceIds);
        all.addAll(controlEvidenceIds);
        return List.copyOf(all);
    }

    private static List<String> immutable(List<String> values) {
        return values == null ? List.of() : List.copyOf(values);
    }
}
