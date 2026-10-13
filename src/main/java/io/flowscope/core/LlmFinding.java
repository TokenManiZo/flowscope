package io.flowscope.core;

import java.util.List;
import java.util.Set;

/**
 * LLM이 교차 재전송 결과를 해석해 남긴 소견(추천). 판정 엔진의 verdict가 아니라 사람이 검토할 참고 자료다.
 * 프로젝트 파일에 영속 저장되어 프로젝트를 다시 열어도 유지된다.
 *
 * <p>judgment* 필드는 사용자가 고른 소견을 LLM이 직접 판정한 결과다(MCP 설계 §11). FlowScope 판정 규칙을 따르지 않는
 * LLM 자신의 판단이며, 서버는 강등·재검사 없이 그대로 저장한다. 판정 전에는 judgment가 빈 문자열이다.
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
        long createdAt,
        String judgment,
        String judgmentReason,
        List<String> judgmentEvidenceIds,
        long judgedAt) {

    /** LLM 판정 값: 취약 / 취약 아님 / 판단 불가. */
    public static final Set<String> JUDGMENTS = Set.of("vulnerable", "not_vulnerable", "inconclusive");

    public LlmFinding {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("id가 필요합니다.");
        if (operation == null || operation.isBlank()) throw new IllegalArgumentException("operation이 필요합니다.");
        if (identity == null || identity.isBlank()) throw new IllegalArgumentException("identity가 필요합니다.");
        verdict = verdict == null ? "" : verdict;
        confidence = confidence == null ? "" : confidence;
        note = note == null ? "" : note;
        evidenceIds = evidenceIds == null ? List.of() : List.copyOf(evidenceIds);
        judgment = judgment == null ? "" : judgment;
        judgmentReason = judgmentReason == null ? "" : judgmentReason;
        judgmentEvidenceIds = judgmentEvidenceIds == null ? List.of() : List.copyOf(judgmentEvidenceIds);
    }

    /** 판정 전 소견. */
    public LlmFinding(String id, String operation, String identity, String resource, String verdict,
                      String confidence, String note, List<String> evidenceIds, long createdAt) {
        this(id, operation, identity, resource, verdict, confidence, note, evidenceIds, createdAt,
                "", "", List.of(), 0L);
    }

    /** 같은 소견에 LLM 판정을 붙인 사본. */
    public LlmFinding withJudgment(String value, String reason, List<String> judgmentEvidence, long at) {
        if (!JUDGMENTS.contains(value)) {
            throw new IllegalArgumentException("verdict는 vulnerable, not_vulnerable, inconclusive 중 하나여야 합니다.");
        }
        return new LlmFinding(id, operation, identity, resource, verdict, confidence, note, evidenceIds, createdAt,
                value, reason, judgmentEvidence, at);
    }
}
