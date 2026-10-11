package io.flowscope.core;

import java.util.List;

/**
 * LLM이 교차 재전송 결과를 해석해 남긴 소견(추천). 판정 엔진의 verdict가 아니라 사람이 검토할 참고 자료다.
 * 프로젝트 파일에 영속 저장되어 프로젝트를 다시 열어도 유지된다.
 */
public record LlmFinding(
        String id,
        String operation,
        String identity,
        String resource,
        String verdict,
        String confidence,
        String note,
        List<String> evidenceIds,
        long createdAt) {

    public LlmFinding {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("id가 필요합니다.");
        if (operation == null || operation.isBlank()) throw new IllegalArgumentException("operation이 필요합니다.");
        if (identity == null || identity.isBlank()) throw new IllegalArgumentException("identity가 필요합니다.");
        verdict = verdict == null ? "" : verdict;
        confidence = confidence == null ? "" : confidence;
        note = note == null ? "" : note;
        evidenceIds = evidenceIds == null ? List.of() : List.copyOf(evidenceIds);
    }
}
