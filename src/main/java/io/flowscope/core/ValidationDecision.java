package io.flowscope.core;

import java.time.Instant;
import java.util.List;

/** 이전 프로젝트에 저장된 LLM 판정 기록. 현재 판정을 생성하거나 승인하는 API가 아니다. */
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


    private static List<String> immutable(List<String> values) {
        return values == null ? List.of() : List.copyOf(values);
    }
}
