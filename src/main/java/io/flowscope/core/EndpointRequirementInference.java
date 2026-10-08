package io.flowscope.core;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/** 관측 응답 분포에서 대상 신원을 제외하고 endpoint 최소 요구 역할 후보를 보수적으로 유도한다. */
final class EndpointRequirementInference {
    enum Provenance { UNKNOWN, OBSERVED_DISTRIBUTION, EXPLICIT }

    record Requirement(AccessRole role, Provenance provenance, String basis) {
        public Requirement {
            role = role == null ? AccessRole.UNKNOWN : role;
            provenance = provenance == null ? Provenance.UNKNOWN : provenance;
            basis = basis == null ? "" : basis;
        }
    }

    private record Observation(String identity, AccessRole role, boolean successful, boolean denied) {}

    private EndpointRequirementInference() {}

    static Requirement resolve(String operation, String targetIdentity,
                               List<RequestRecord> records, AnalysisConfig config) {
        AnalysisConfig effectiveConfig = config == null ? new AnalysisConfig() : config;
        AccessRole explicit = effectiveConfig.endpointRequirement(operation);
        if (explicit != AccessRole.UNKNOWN) {
            return new Requirement(explicit, Provenance.EXPLICIT,
                    "사용자가 요구 권한 " + explicit.label() + "을 명시함");
        }
        if (operation == null || records == null || records.isEmpty()) return unknown();

        List<Observation> observations = records.stream()
                .filter(Objects::nonNull)
                .filter(record -> operation.equals(record.op))
                .filter(record -> record.idn != null && !record.idn.equals(targetIdentity))
                .filter(record -> record.source != Source.UNKNOWN && record.hasResponse)
                .filter(record -> record.phase != RunPhase.VALIDATION && record.phase != RunPhase.COACH_PROBE)
                .filter(record -> !"HEAD".equals(record.method) && !"OPTIONS".equals(record.method))
                .map(record -> new Observation(record.idn, effectiveConfig.identityRole(record.idn),
                        ResponseEvidence.successful(record), ResponseEvidence.denied(record)))
                .filter(observation -> observation.role() != AccessRole.UNKNOWN)
                .toList();
        if (observations.stream().map(Observation::identity).distinct().count() < 2
                || observations.stream().anyMatch(observation -> !observation.successful() && !observation.denied())) {
            return unknown();
        }

        AccessRole minimumSuccessful = observations.stream().filter(Observation::successful)
                .map(Observation::role).min(Comparator.comparingInt(AccessRole::rank))
                .orElse(AccessRole.UNKNOWN);
        if (minimumSuccessful == AccessRole.UNKNOWN || minimumSuccessful == AccessRole.ANONYMOUS) return unknown();

        List<Observation> lower = observations.stream()
                .filter(observation -> observation.role().rank() < minimumSuccessful.rank()).toList();
        List<Observation> atLeast = observations.stream()
                .filter(observation -> observation.role().rank() >= minimumSuccessful.rank()).toList();
        if (lower.isEmpty() || lower.stream().anyMatch(observation -> !observation.denied())
                || atLeast.isEmpty() || atLeast.stream().anyMatch(observation -> !observation.successful())) {
            return unknown();
        }

        long successfulIdentities = atLeast.stream().map(Observation::identity).distinct().count();
        long deniedIdentities = lower.stream().map(Observation::identity).distinct().count();
        return new Requirement(minimumSuccessful, Provenance.OBSERVED_DISTRIBUTION,
                "대상 계정 제외 관측 분포: " + minimumSuccessful.label() + " 이상 성공 "
                        + successfulIdentities + "개 계정 · 하위 역할 차단 " + deniedIdentities + "개 계정");
    }

    private static Requirement unknown() {
        return new Requirement(AccessRole.UNKNOWN, Provenance.UNKNOWN, "요구 역할을 유도할 교차 관측 근거 부족");
    }
}
