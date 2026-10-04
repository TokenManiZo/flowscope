package io.flowscope.core;

import java.time.Instant;
import java.util.List;

/** HUMAN·SCANNER·LLM exploration 완료 자격을 같은 run 기준으로 판정한다. */
public final class LaneCompletionPolicy {
    public record Decision(boolean eligible, String reason, List<String> evidenceIds,
                           long responseCount, long coverageCount) {
        public Decision {
            reason = reason == null ? "" : reason;
            evidenceIds = List.copyOf(evidenceIds == null ? List.of() : evidenceIds);
        }
    }

    private LaneCompletionPolicy() {}

    public static Decision evaluate(Source source, String runId, Pipeline.Result snapshot) {
        if (source == null || source == Source.UNKNOWN) return denied("지원하지 않는 source입니다.");
        if (runId == null || runId.isBlank() || "default".equals(runId)) return denied("유효한 run ID가 필요합니다.");
        if (snapshot == null) return denied("분석 snapshot이 없습니다.");

        List<RequestRecord> responses = snapshot.records.stream()
                .filter(record -> record.source == source && runId.equals(record.runId))
                .filter(record -> record.phase == RunPhase.EXPLORATION && record.hasResponse)
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.LANE_COMPLETION))
                .toList();
        if (responses.isEmpty()) {
            return denied("exploration run needs at least one trusted in-scope response Evidence");
        }
        long coverage = snapshot.coverageRecords.stream()
                .filter(record -> record.source == source && runId.equals(record.runId))
                .filter(record -> record.phase == RunPhase.EXPLORATION && record.hasResponse)
                .filter(record -> SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.LANE_COMPLETION))
                .count();
        List<String> evidenceIds = responses.stream().map(record -> record.evidenceId)
                .filter(value -> value != null && !value.isBlank()).distinct().sorted().toList();
        if (evidenceIds.isEmpty()) {
            return denied("exploration Evidence IDs have not been assigned yet");
        }
        return new Decision(true, "동일 run의 신뢰 가능한 exploration 응답을 확인했습니다.",
                evidenceIds, responses.size(), coverage);
    }

    public static RunContextRegistry.CompletedRun complete(RunContextRegistry registry, Source source,
                                                            String runId, Pipeline.Result snapshot) {
        if (registry == null) throw new IllegalArgumentException("run registry가 필요합니다.");
        RunContextRegistry.Context active = registry.current(source, runId);
        if (active == null || !runId.equals(active.runId()) || active.phase() != RunPhase.EXPLORATION) {
            throw new IllegalArgumentException("run_id가 활성 exploration run과 일치하지 않습니다.");
        }
        Decision decision = evaluate(source, runId, snapshot);
        if (!decision.eligible()) throw new IllegalStateException(decision.reason());
        RunContextRegistry.CompletedRun completed = new RunContextRegistry.CompletedRun(
                source, runId, active.detail(), active.orchestrator(), active.tool(), active.phase(),
                active.accountId(), Instant.now(), decision.evidenceIds(), decision.responseCount(),
                decision.coverageCount());
        if (!registry.complete(source, runId, completed)) {
            throw new IllegalStateException("run lease가 완료 처리 전에 사라졌습니다.");
        }
        return completed;
    }


    private static Decision denied(String reason) {
        return new Decision(false, reason, List.of(), 0, 0);
    }
}
