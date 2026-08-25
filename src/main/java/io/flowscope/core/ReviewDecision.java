package io.flowscope.core;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Human disposition of a deterministic finding or an LLM assessment. */
public record ReviewDecision(String itemId, Status status, String note,
                             List<String> evidenceIds, Instant decidedAt) {
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
        note = Masking.truncate(Masking.maskSecrets(note == null ? "" : note.trim()), 2_000);
        List<String> normalized = new ArrayList<>();
        if (evidenceIds != null) evidenceIds.stream().filter(id -> id != null && !id.isBlank())
                .distinct().sorted().forEach(normalized::add);
        evidenceIds = List.copyOf(normalized);
        decidedAt = decidedAt == null ? Instant.now() : decidedAt;
    }

    public boolean appliesTo(List<String> currentEvidenceIds) {
        List<String> normalized = currentEvidenceIds == null ? List.of()
                : currentEvidenceIds.stream().filter(id -> id != null && !id.isBlank()).distinct().sorted().toList();
        return evidenceIds.equals(normalized);
    }
}
