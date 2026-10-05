package io.flowscope.core;

import java.time.Instant;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.Objects;
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
    private final Map<String, Context> humanRuns = new LinkedHashMap<>();
    private record HumanCapture(boolean paused, long generation) {}
    private final Map<String, HumanCapture> humanCaptures = new java.util.concurrent.ConcurrentHashMap<>();
    private long humanCaptureSequence;
    private final Object humanCaptureLock = new Object();
    private final Map<Source, CompletedRun> completedExplorations = new EnumMap<>(Source.class);

    public synchronized void activate(Source source, Context context) {
        if (source == null || context == null || context.runId() == null || context.runId().isBlank()) {
            throw new IllegalArgumentException("source, context, and runId are required");
        }
        Context active = current(source);
        if (active != null || source == Source.HUMAN && !humanRuns.isEmpty()) {
            throw new IllegalStateException(source + " run already active");
        }
        if (context.phase() == RunPhase.EXPLORATION
                && (source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM)) {
            completedExplorations.remove(source);
        }
        if (source == Source.HUMAN) {
            humanRuns.put(context.runId(), context);
            synchronized (humanCaptureLock) {
                humanCaptures.put(context.runId(), new HumanCapture(false, ++humanCaptureSequence));
            }
        }
        else contexts.put(source, context);
    }

    /** Independent browser listeners may collect different HUMAN accounts concurrently. */
    public synchronized void activateHuman(Context context) {
        if (context == null || context.runId() == null || context.runId().isBlank()) {
            throw new IllegalArgumentException("context and runId are required");
        }
        if (humanRuns.containsKey(context.runId()) || humanRuns.values().stream()
                .anyMatch(active -> Objects.equals(active.accountId(), context.accountId()))) {
            throw new IllegalStateException("이 계정은 이미 HUMAN 수집 중입니다.");
        }
        completedExplorations.remove(Source.HUMAN);
        humanRuns.put(context.runId(), context);
        synchronized (humanCaptureLock) {
            humanCaptures.put(context.runId(), new HumanCapture(false, ++humanCaptureSequence));
        }
    }

    public synchronized void pauseHuman(String runId, boolean paused) {
        synchronized (humanCaptureLock) {
            HumanCapture capture = humanCaptures.get(runId);
            if (capture == null) throw new IllegalArgumentException("활성 수집 실행을 찾지 못했습니다.");
            if (capture.paused() != paused) {
                humanCaptures.put(runId, new HumanCapture(paused, ++humanCaptureSequence));
            }
        }
    }

    public boolean humanPaused(String runId) {
        HumanCapture capture = humanCaptures.get(runId);
        return capture != null && capture.paused();
    }

    /** A paused request or a response from before pause/end cannot re-enter collection after resume. */
    public long humanCaptureGeneration(String runId) {
        HumanCapture capture = humanCaptures.get(runId);
        return capture == null || capture.paused() ? -1 : capture.generation();
    }

    public boolean acceptsHumanCapture(String runId, long generation) {
        return generation >= 0 && humanCaptureGeneration(runId) == generation;
    }

    /** Commit lock is separate from the registry monitor: callbacks must not acquire that monitor. */
    public boolean captureHumanIfCurrent(String runId, long generation, java.util.function.BooleanSupplier commit) {
        synchronized (humanCaptureLock) {
            return acceptsHumanCapture(runId, generation) && commit.getAsBoolean();
        }
    }

    public synchronized List<Context> activeHumanRuns() { return List.copyOf(humanRuns.values()); }

    public synchronized Context current(Source source, String runId) {
        if (source == Source.HUMAN) return humanRuns.get(runId);
        Context context = contexts.get(source);
        return context != null && Objects.equals(context.runId(), runId) ? context : null;
    }

    /** LaneCompletionPolicy가 Evidence 자격을 확인한 뒤에만 호출한다. */
    synchronized boolean complete(Source source, String runId, CompletedRun completed) {
        Context active = current(source, runId);
        if (active == null || completed == null || runId == null || !active.runId().equals(runId)
                || completed.source() != source || !runId.equals(completed.runId())
                || active.phase() != RunPhase.EXPLORATION) return false;
        remove(source, runId);
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
        Context active = current(source, runId);
        if (active == null || runId == null || !runId.equals(active.runId())) {
            throw new IllegalArgumentException("run_id does not match the active " + source + " run");
        }
        Context changed = new Context(detail, active.orchestrator(), active.tool(), active.phase(),
                active.runId(), replaceAccount ? accountId : active.accountId());
        if (source == Source.HUMAN) humanRuns.put(runId, changed);
        else contexts.put(source, changed);
    }

    /** Failed/cancelled runs do not satisfy an independent-lane completion gate. */
    public synchronized boolean abort(Source source, String runId) {
        Context active = current(source, runId);
        if (active == null || runId == null || !runId.equals(active.runId())) return false;
        remove(source, runId);
        return true;
    }

    /** 확장 종료·전체 초기화 전용. 정상 도구 종료에는 LaneCompletionPolicy를 사용한다. */
    public synchronized void clear(Source source) {
        contexts.remove(source);
        if (source == Source.HUMAN) {
            humanRuns.clear();
            synchronized (humanCaptureLock) { humanCaptures.clear(); }
        }
    }
    private void remove(Source source, String runId) {
        if (source == Source.HUMAN) {
            humanRuns.remove(runId);
            synchronized (humanCaptureLock) { humanCaptures.remove(runId); }
        }
        else contexts.remove(source);
    }
    /** Multiple HUMAN browsers have no implicit current account; callers must use the listener's run ID. */
    public synchronized Context current(Source source) {
        return source == Source.HUMAN ? humanRuns.size() == 1 ? humanRuns.values().iterator().next() : null
                : contexts.get(source);
    }
    public synchronized Set<Source> completedExplorations() {
        var completed = java.util.EnumSet.noneOf(Source.class);
        completed.addAll(completedExplorations.keySet());
        if (!humanRuns.isEmpty()) completed.remove(Source.HUMAN);
        return Set.copyOf(completed);
    }
    public synchronized Map<Source, CompletedRun> completedRuns() {
        Map<Source, CompletedRun> completed = new EnumMap<>(completedExplorations);
        if (!humanRuns.isEmpty()) completed.remove(Source.HUMAN);
        return Map.copyOf(completed);
    }
    public synchronized CompletedRun completedRun(Source source) {
        return source == Source.HUMAN && !humanRuns.isEmpty() ? null : completedExplorations.get(source);
    }
    public synchronized boolean hasActiveRuns() { return !contexts.isEmpty() || !humanRuns.isEmpty(); }

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
        humanRuns.clear();
        synchronized (humanCaptureLock) { humanCaptures.clear(); }
        completedExplorations.clear();
    }
}
