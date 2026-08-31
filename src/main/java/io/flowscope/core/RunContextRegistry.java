package io.flowscope.core;

import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 비동기 도구 실행 중 들어오는 트래픽에 실행 메타데이터를 부착한다. */
public final class RunContextRegistry {
    public record Context(SourceDetail detail, Orchestrator orchestrator, ToolKind tool,
                          RunPhase phase, String runId, String accountId) {
        public Context(SourceDetail detail, Orchestrator orchestrator, ToolKind tool,
                       RunPhase phase, String runId) {
            this(detail, orchestrator, tool, phase, runId, null);
        }
    }

    /** 정상 완료된 정확한 exploration run과 완료 당시 근거를 보존한다. */
    public record CompletedRun(Source source, String runId, SourceDetail detail,
                               Orchestrator orchestrator, ToolKind tool, RunPhase phase,
                               String accountId, Instant completedAt, List<String> evidenceIds,
                               long responseCount, long coverageCount) {
        public CompletedRun {
            evidenceIds = List.copyOf(evidenceIds == null ? List.of() : evidenceIds);
        }
    }

    private final Map<Source, Context> contexts = new EnumMap<>(Source.class);
    private final Map<Source, CompletedRun> completedExplorations = new EnumMap<>(Source.class);

    public synchronized void activate(Source source, Context context) {
        if (source == null || context == null || context.runId() == null || context.runId().isBlank()) {
            throw new IllegalArgumentException("source, context, and runId are required");
        }
        Context active = contexts.get(source);
        if (active != null) {
            throw new IllegalStateException(source + " run already active: " + active.runId());
        }
        if (context.phase() == RunPhase.EXPLORATION
                && (source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM)) {
            completedExplorations.remove(source);
        }
        contexts.put(source, context);
    }

    /** LaneCompletionPolicy가 Evidence 자격을 확인한 뒤에만 호출한다. */
    synchronized boolean complete(Source source, String runId, CompletedRun completed) {
        Context active = contexts.get(source);
        if (active == null || completed == null || runId == null || !active.runId().equals(runId)
                || completed.source() != source || !runId.equals(completed.runId())
                || active.phase() != RunPhase.EXPLORATION) return false;
        contexts.remove(source);
        completedExplorations.put(source, completed);
        return true;
    }

    /** 이전 내부 API 호환용. 검증 없는 clear는 완료를 만들지 않고 run을 중단한다. */
    @Deprecated
    public synchronized boolean clear(Source source, String runId) { return abort(source, runId); }

    public synchronized void transition(Source source, String runId, SourceDetail detail) {
        transition(source, runId, detail, null, false);
    }

    public synchronized void transition(Source source, String runId, SourceDetail detail, String accountId) {
        transition(source, runId, detail, accountId, true);
    }

    private void transition(Source source, String runId, SourceDetail detail,
                            String accountId, boolean replaceAccount) {
        Context active = contexts.get(source);
        if (active == null || runId == null || !runId.equals(active.runId())) {
            throw new IllegalArgumentException("run_id does not match the active " + source + " run");
        }
        contexts.put(source, new Context(detail, active.orchestrator(), active.tool(), active.phase(),
                active.runId(), replaceAccount ? accountId : active.accountId()));
    }

    /** Failed/cancelled runs do not satisfy an independent-lane completion gate. */
    public synchronized boolean abort(Source source, String runId) {
        Context active = contexts.get(source);
        if (active == null || runId == null || !runId.equals(active.runId())) return false;
        contexts.remove(source);
        return true;
    }

    /** 확장 종료·전체 초기화 전용. 정상 도구 종료에는 LaneCompletionPolicy를 사용한다. */
    public synchronized void clear(Source source) { contexts.remove(source); }
    public synchronized Context current(Source source) { return contexts.get(source); }
    public synchronized Set<Source> completedExplorations() { return Set.copyOf(completedExplorations.keySet()); }
    public synchronized Map<Source, CompletedRun> completedRuns() { return Map.copyOf(completedExplorations); }
    public synchronized CompletedRun completedRun(Source source) { return completedExplorations.get(source); }
    public synchronized boolean hasActiveRuns() { return !contexts.isEmpty(); }

    /** A launcher-side evidence gate may revoke a completion recorded by a misbehaving client. */
    public synchronized void invalidateCompleted(Source source) {
        completedExplorations.remove(source);
    }

    public synchronized void restoreCompletedRuns(Map<Source, CompletedRun> values) {
        completedExplorations.clear();
        if (values == null) return;
        values.forEach((source, completed) -> {
            if (source != null && completed != null && completed.source() == source
                    && completed.runId() != null && !completed.runId().isBlank()
                    && completed.phase() == RunPhase.EXPLORATION) {
                completedExplorations.put(source, completed);
            }
        });
    }

    public synchronized void reset() {
        contexts.clear();
        completedExplorations.clear();
    }
}
