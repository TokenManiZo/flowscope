package io.flowscope.core;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 결정론적 접근권한·커버리지 분석 결과(F-10~F-17, F-23~24). */
public record AuthorizationAnalysis(
        Map<String, OwnerInfo> owners,
        List<CoverageCell> cells,
        List<Gap> gaps,
        List<Finding> findings,
        Set<Source> activeSources) {

    public record CellKey(String identity, String operation, String resource) {
        public String stableKey() {
            if (!requiresFraming(identity) && !requiresFraming(operation)
                    && !requiresFraming(resource) && !"<none>".equals(resource)) {
                return identity + "|" + operation + "|" + (resource == null ? "<none>" : resource);
            }
            return "v2:" + frame(identity) + frame(operation) + frame(resource);
        }

        private static String frame(String value) {
            if (value == null) return "-1:";
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            StringBuilder encoded = new StringBuilder(bytes.length * 2);
            for (byte valueByte : bytes) encoded.append(String.format("%02x", valueByte));
            return bytes.length + ":" + encoded;
        }

        private static boolean requiresFraming(String value) {
            return value != null && value.contains("|");
        }
    }

    public record OwnerInfo(
            String resource,
            String identity,
            int confidence,
            String basis,
            boolean confirmed) {
        public boolean decisionGrade() {
            return identity != null && confidence >= 50;
        }
    }

    public record Decision(
            Verdict verdict,
            String reason,
            boolean roleViolation) {}

    public record CoverageCell(
            CellKey key,
            Map<Source, Decision> perSource,
            Verdict overall,
            boolean conflict,
            Set<Source> missedBy,
            List<String> evidenceIds) {}

    public enum GapType { UNCROSSED, PARTIAL_DISCOVERY, CONFLICT }

    public record Gap(
            String id,
            GapType type,
            String identity,
            String operation,
            String resource,
            Set<Source> missedBy,
            int risk,
            String reason) {}

    public enum FindingType { BOLA, BFLA }
    public enum Severity { CRITICAL, HIGH, MEDIUM, LOW }

    public record Finding(
            String id,
            FindingType type,
            Severity severity,
            String title,
            CellKey cell,
            String reason,
            List<String> evidenceIds,
            boolean confirmed) {}

    public static AuthorizationAnalysis empty() {
        return new AuthorizationAnalysis(Map.of(), List.of(), List.of(), List.of(), Set.of());
    }
}
