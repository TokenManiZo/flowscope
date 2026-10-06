package io.flowscope.core;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** 현재 규칙 후보의 사람 검토 상태. 구버전 LLM 평가의 검토 기록도 저장 호환을 위해 보존한다. */
public record ReviewDecision(String itemId, Status status, String note,
                             List<String> evidenceIds, Instant decidedAt,
                             java.util.Map<String, String> policyContext, List<String> validationEvidenceIds) {
    public ReviewDecision(String itemId, Status status, String note, List<String> evidenceIds, Instant decidedAt) {
        this(itemId, status, note, evidenceIds, decidedAt, java.util.Map.of(), List.of());
    }
    public ReviewDecision(String itemId, Status status, String note, List<String> evidenceIds, Instant decidedAt,
                          java.util.Map<String, String> policyContext) {
        this(itemId, status, note, evidenceIds, decidedAt, policyContext, List.of());
    }
    public enum Status {
        UNRESOLVED("미확정"),
        CONFIRMED("확정"),
        DISMISSED("폐기");

        private final String label;
        Status(String label) { this.label = label; }
        public String label() { return label; }
    }

    public ReviewDecision {
        if (itemId == null || itemId.isBlank()) throw new IllegalArgumentException("review item id is required");
        if (status == null) throw new IllegalArgumentException("review status is required");
        note = TextLimits.truncate(note == null ? "" : note.trim(), 2_000);
        List<String> normalized = new ArrayList<>();
        if (evidenceIds != null) evidenceIds.stream().filter(id -> id != null && !id.isBlank())
                .distinct().sorted().forEach(normalized::add);
        evidenceIds = List.copyOf(normalized);
        decidedAt = decidedAt == null ? Instant.now() : decidedAt;
        policyContext = java.util.Map.copyOf(policyContext == null ? java.util.Map.of() : policyContext);
        validationEvidenceIds = validationEvidenceIds == null ? List.of() : validationEvidenceIds.stream()
                .filter(id -> id != null && !id.isBlank()).distinct().sorted().toList();
    }

    public boolean appliesTo(List<String> currentEvidenceIds) {
        List<String> normalized = currentEvidenceIds == null ? List.of()
                : currentEvidenceIds.stream().filter(id -> id != null && !id.isBlank()).distinct().sorted().toList();
        return evidenceIds.equals(normalized);
    }
}
