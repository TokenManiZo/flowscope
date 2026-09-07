package io.flowscope.core;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 이전 프로젝트의 LLM 평가를 보존하는 읽기 전용 기록. 실행·판정 제출 기능은 없다. */
public record LegacyAssessment(String id, String type, String verdict, String title, String reason,
                               List<String> evidenceIds, Instant createdAt) {
    public LegacyAssessment {
        id = boundedLegacyAssessmentText(id, "assessment id", 128);
        type = boundedLegacyAssessmentText(type, "assessment type", 64);
        if (!Set.of("LIKELY", "INCONCLUSIVE", "REJECTED").contains(verdict)) {
            throw new IllegalArgumentException("invalid assessment verdict");
        }
        title = boundedLegacyAssessmentText(Masking.maskSecrets(title), "assessment title", 256);
        reason = boundedLegacyAssessmentText(Masking.maskSecrets(reason), "assessment reason", 4_096);
        if (evidenceIds == null || evidenceIds.isEmpty() || evidenceIds.size() > 200) {
            throw new IllegalArgumentException("assessment evidence_ids must contain 1 to 200 values");
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String evidenceId : evidenceIds) {
            normalized.add(boundedLegacyAssessmentText(evidenceId, "assessment evidence id", 256));
        }
        evidenceIds = List.copyOf(normalized);
        if (createdAt == null) throw new IllegalArgumentException("assessment createdAt is required");
    }

    private static final int MAX_ASSESSMENTS = 1_000;
    private static final long MAX_ASSESSMENT_RETAINED_BYTES = 4L * 1024 * 1024;

    public static void validateSet(List<LegacyAssessment> values) {
        if (values == null || values.size() > MAX_ASSESSMENTS) {
            throw new IllegalArgumentException("assessment limit exceeded");
        }
        if (assessmentRetainedBytes(values) > MAX_ASSESSMENT_RETAINED_BYTES) {
            throw new IllegalArgumentException("assessment retained-byte limit exceeded");
        }
    }

    private static long assessmentRetainedBytes(List<LegacyAssessment> values) {
        long total = 0;
        for (LegacyAssessment value : values) total += assessmentRetainedBytes(value);
        return total;
    }

    private static long assessmentRetainedBytes(LegacyAssessment value) {
        long total = utf8Bytes(value.id()) + utf8Bytes(value.type()) + utf8Bytes(value.verdict())
                + utf8Bytes(value.title()) + utf8Bytes(value.reason()) + 32;
        for (String evidenceId : value.evidenceIds()) total += utf8Bytes(evidenceId) + 8;
        return total;
    }

    private static int utf8Bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String boundedLegacyAssessmentText(String value, String field, int maxChars) {
        if (value == null || value.isBlank() || value.length() > maxChars) {
            throw new IllegalArgumentException(field + " is required and must be at most " + maxChars + " characters");
        }
        return value;
    }
}
