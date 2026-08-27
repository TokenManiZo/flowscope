package io.flowscope.core;

import java.util.EnumMap;
import java.util.EnumSet;
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

    private final Map<Source, Context> contexts = new EnumMap<>(Source.class);
    private final Set<Source> completedExplorations = EnumSet.noneOf(Source.class);

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

    public synchronized boolean clear(Source source, String runId) {
        Context active = contexts.get(source);
        if (active == null || runId == null || !active.runId().equals(runId)) return false;
        contexts.remove(source);
        if (active.phase() == RunPhase.EXPLORATION
                && (source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM)) {
            completedExplorations.add(source);
        }
        return true;
    }

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

    /** 확장 종료·전체 초기화 전용. 정상 도구 종료에는 runId 조건부 clear를 사용한다. */
    public synchronized void clear(Source source) { contexts.remove(source); }
    public synchronized Context current(Source source) { return contexts.get(source); }
    public synchronized Set<Source> completedExplorations() { return Set.copyOf(completedExplorations); }
    public synchronized boolean hasActiveRuns() { return !contexts.isEmpty(); }

    public synchronized void restoreCompleted(Set<Source> sources) {
        if (sources == null) return;
        sources.stream().filter(source -> source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM)
                .forEach(completedExplorations::add);
    }

    public synchronized void reset() {
        contexts.clear();
        completedExplorations.clear();
    }
}
