package io.flowscope.integration;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.TrafficClassification;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * Memory-only live HUMAN capture fan-out. It selects eligible observed API Evidence and delegates
 * transport and authorization interpretation to the existing safe replay and analyzer paths.
 */
public final class LiveCrossIdentityReplayCoordinator {
    private static final Set<String> SUPPORTED_METHODS =
            Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE");

    private static final int MAX_WAITING = 200;
    private static final long MAX_RETAINED_BYTES = 8L * 1024 * 1024;

    public enum State { STOPPED, ACTIVE, LIMIT_REACHED }

    public record Snapshot(String runId, State state, boolean armed,
                           List<String> targetAccountIds, boolean includeAnonymous,
                           boolean automaticAnonymousGet,
                           int observed, int eligible, int queued,
                           int sent, int drafted, int skipped, int failed, String lastReason,
                           List<Source> basisSources, int pending, int limited) {
        public Snapshot {
            targetAccountIds = List.copyOf(targetAccountIds);
            basisSources = List.copyOf(basisSources);
        }

        public Snapshot(String runId, State state, boolean armed,
                        List<String> targetAccountIds, boolean includeAnonymous, boolean automaticAnonymousGet,
                        int observed, int eligible, int queued, int sent, int drafted, int skipped, int failed,
                        String lastReason, List<Source> basisSources) {
            this(runId, state, armed, targetAccountIds, includeAnonymous, automaticAnonymousGet,
                    observed, eligible, queued, sent, drafted, skipped, failed, lastReason, basisSources, 0, 0);
        }

        public Snapshot(String runId, State state, boolean armed,
                        List<String> targetAccountIds, boolean includeAnonymous,
                        boolean automaticAnonymousGet,
                        int observed, int eligible, int queued,
                        int sent, int drafted, int skipped, String lastReason,
                        List<Source> basisSources) {
            this(runId, state, armed, targetAccountIds, includeAnonymous, automaticAnonymousGet,
                    observed, eligible, queued, sent, drafted, skipped, 0, lastReason, basisSources);
        }

        public Snapshot(String runId, State state, boolean armed,
                        List<String> targetAccountIds, boolean includeAnonymous,
                        int observed, int eligible, int queued,
                        int sent, int drafted, int skipped, String lastReason,
                        List<Source> basisSources) {
            this(runId, state, armed, targetAccountIds, includeAnonymous, false,
                    observed, eligible, queued, sent, drafted, skipped, 0, lastReason, basisSources);
        }

        public Snapshot(String runId, State state, boolean armed,
                        List<String> targetAccountIds, boolean includeAnonymous,
                        int observed, int eligible, int queued,
                        int sent, int drafted, int skipped, String lastReason) {
            this(runId, state, armed, targetAccountIds, includeAnonymous, false,
                    observed, eligible, queued, sent, drafted, skipped, 0, lastReason,
                    List.of(Source.HUMAN));
        }
    }

    @FunctionalInterface
    public interface Dispatcher {
        CrossIdentityReplayOrchestrator.RunResult dispatch(
                List<CrossIdentityReplayOrchestrator.Recommendation> recommendations, boolean armed);
    }

    private final Dispatcher dispatcher;
    private final Runnable beginRun;
    private final Runnable killRun;
    private final Executor executor;
    private final LinkedHashSet<String> targetAccountIds = new LinkedHashSet<>();
    private final LinkedHashSet<Source> basisSources = new LinkedHashSet<>();
    private final LinkedHashSet<String> deduplicated = new LinkedHashSet<>();
    private final Set<PendingTask> tasks = new LinkedHashSet<>();
    private final ThreadLocal<String> dispatchRun = new ThreadLocal<>();
    private long retainedBytes;
    private int limited;
    private String runId = "";
    private State state = State.STOPPED;
    private boolean armed;
    private boolean includeAnonymous;
    private boolean automaticAnonymousGet;
    private int observed;
    private int eligible;
    private int queued;
    private int sent;
    private int drafted;
    private int skipped;
    private int failed;
    private String lastReason = "NOT_STARTED";

    public LiveCrossIdentityReplayCoordinator(Dispatcher dispatcher, Runnable beginRun,
                                              Runnable killRun, Executor executor) {
        this.dispatcher = java.util.Objects.requireNonNull(dispatcher, "dispatcher");
        this.beginRun = java.util.Objects.requireNonNull(beginRun, "beginRun");
        this.killRun = java.util.Objects.requireNonNull(killRun, "killRun");
        this.executor = java.util.Objects.requireNonNull(executor, "executor");
    }

    public synchronized Snapshot start(List<String> accountIds, boolean anonymous, boolean approved) {
        return start(accountIds, anonymous, List.of(Source.HUMAN), approved);
    }

    public synchronized Snapshot start(List<String> accountIds, boolean anonymous,
                                       List<Source> sources, boolean approved) {
        return start(accountIds, anonymous, sources, approved, false);
    }

    public synchronized Snapshot startAutomaticAnonymousGet(boolean approved) {
        return start(List.of(), true, List.of(Source.HUMAN), approved, true);
    }

    private Snapshot start(List<String> accountIds, boolean anonymous,
                           List<Source> sources, boolean approved,
                           boolean automaticAnonymousGet) {
        if (!approved) throw new IllegalArgumentException("안전 자동 재전송 허용 승인이 필요합니다.");
        if (state != State.STOPPED) throw new IllegalStateException("현재 라이브 재전송을 먼저 중지하세요.");
        LinkedHashSet<String> selected = new LinkedHashSet<>();
        if (accountIds != null) for (String accountId : accountIds) {
            if (accountId != null && !accountId.isBlank()
                    && !CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY.equals(accountId.trim())) {
                selected.add(accountId.trim());
            }
        }
        if (selected.isEmpty() && !anonymous) {
            throw new IllegalArgumentException("대상 등록 계정 또는 비로그인을 하나 이상 선택하세요.");
        }
        LinkedHashSet<Source> selectedSources = new LinkedHashSet<>();
        if (sources != null) for (Source source : sources) {
            if (source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM) {
                selectedSources.add(source);
            }
        }
        if (selectedSources.isEmpty()) {
            throw new IllegalArgumentException("기준 요청 출처(HUMAN/ZAP/LLM)를 하나 이상 선택하세요.");
        }
        beginRun.run();
        runId = "live-authorization-replay-" + UUID.randomUUID();
        state = State.ACTIVE;
        armed = true;
        includeAnonymous = anonymous;
        this.automaticAnonymousGet = automaticAnonymousGet;
        targetAccountIds.clear();
        targetAccountIds.addAll(selected);
        basisSources.clear();
        basisSources.addAll(selectedSources);
        deduplicated.clear();
        observed = eligible = queued = sent = drafted = skipped = failed = limited = 0;
        lastReason = "ARMED";
        return snapshot();
    }

    public synchronized void stop() {
        if (state == State.STOPPED) return;
        state = State.STOPPED;
        armed = false;
        automaticAnonymousGet = false;
        lastReason = "STOPPED_BY_OPERATOR";
        killRun.run();
        for (PendingTask task : List.copyOf(tasks)) {
            if (!task.running) {
                if (task.run.equals(runId)) skipped += task.recommendations.size();
                task.release();
                if (executor instanceof java.util.concurrent.ThreadPoolExecutor pool) pool.remove(task);
            }
        }
    }

    public synchronized void reset() {
        stop();
        includeAnonymous = false;
        targetAccountIds.clear();
        basisSources.clear();
        deduplicated.clear();
        runId = "";
        observed = eligible = queued = sent = drafted = skipped = failed = limited = 0;
        lastReason = "NOT_STARTED";
        killRun.run();
    }

    public synchronized boolean isDispatchCurrent() {
        String dispatch = dispatchRun.get();
        return dispatch == null || dispatch.equals(runId) && acceptingCaptures();
    }

    /** The caller holds the dataset lock; stop cannot interleave with this commit. */
    public synchronized boolean commitCurrentDispatch(Runnable commit) {
        if (!isDispatchCurrent()) return false;
        commit.run();
        return true;
    }

    public synchronized boolean acceptingCaptures() { return state == State.ACTIVE && armed; }

    public synchronized boolean acceptingCaptures(Source source) {
        return acceptingCaptures() && basisSources.contains(source);
    }

    public synchronized boolean acceptingCaptures(RequestRecord record) {
        return acceptingCaptures() && basisSourceEligible(record);
    }

    /** Offers one newly captured, analyzed HUMAN exchange. Imported or evicted raw exchanges are rejected. */
    public boolean offer(RequestRecord record, URI target, boolean rawRequestRetained) {
        return offer(record, target, rawRequestRetained, null);
    }

    public boolean offer(RequestRecord record, URI target, boolean rawRequestRetained,
                         String anonymousRequestKey) {
        return offer(record, target, rawRequestRetained, anonymousRequestKey, 0, () -> { });
    }

    public boolean offer(RequestRecord record, URI target, boolean rawRequestRetained,
                         String anonymousRequestKey, long bytes, Runnable release) {
        PendingTask task;
        List<String> keys;
        synchronized (this) {
            if (!acceptingCaptures()) return false;
            observed++;
            String rejection = rejection(record, target, rawRequestRetained, anonymousRequestKey);
            if (rejection != null) {
                skipped++;
                if (queued == 0) lastReason = rejection;
                return false;
            }
            if (bytes < 0 || bytes > MAX_RETAINED_BYTES - retainedBytes
                    || tasks.stream().filter(pending -> !pending.running).count() >= MAX_WAITING) {
                skipped++;
                limited++;
                lastReason = "PENDING_LIMIT_REACHED";
                return false;
            }
            var recommendations = recommendations(record, target, anonymousRequestKey);
            if (recommendations.isEmpty()) {
                skipped++;
                if (queued == 0) lastReason = "NO_OTHER_SELECTED_IDENTITY";
                return false;
            }
            keys = recommendations.stream().map(recommendation -> automaticAnonymousGet
                    ? anonymousRequestKey + "\0" + recommendation.targetIdentity()
                    : record.evidenceId + "\0" + recommendation.targetIdentity()).toList();
            task = new PendingTask(runId, recommendations, bytes, release);
            tasks.add(task);
            retainedBytes += bytes;
            eligible++;
            queued += recommendations.size();
            lastReason = "QUEUED";
        }
        try {
            executor.execute(task);
            return true;
        } catch (java.util.concurrent.RejectedExecutionException error) {
            synchronized (this) {
                task.release();
                if (task.run.equals(runId)) {
                    deduplicated.removeAll(keys);
                    eligible--;
                    queued -= task.recommendations.size();
                    skipped++;
                    limited++;
                    lastReason = "PENDING_LIMIT_REACHED";
                }
            }
            return false;
        }
    }

    private final class PendingTask implements Runnable {
        private final String run;
        private final List<CrossIdentityReplayOrchestrator.Recommendation> recommendations;
        private final long bytes;
        private final Runnable cleanup;
        private boolean running;
        private boolean released;

        private PendingTask(String run, List<CrossIdentityReplayOrchestrator.Recommendation> recommendations,
                            long bytes, Runnable cleanup) {
            this.run = run;
            this.recommendations = recommendations;
            this.bytes = bytes;
            this.cleanup = cleanup;
        }

        @Override public void run() {
            synchronized (LiveCrossIdentityReplayCoordinator.this) {
                if (released) return;
                running = true;
            }
            dispatchRun.set(run);
            try { dispatch(run, recommendations); }
            finally {
                dispatchRun.remove();
                synchronized (LiveCrossIdentityReplayCoordinator.this) { release(); }
            }
        }

        private void release() {
            if (released) return;
            released = true;
            tasks.remove(this);
            retainedBytes -= bytes;
            cleanup.run();
        }
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(runId, state, armed, new ArrayList<>(targetAccountIds), includeAnonymous,
                automaticAnonymousGet,
                observed, eligible, queued, sent, drafted, skipped, failed, lastReason,
                new ArrayList<>(basisSources),
                tasks.stream().filter(task -> task.run.equals(runId)).mapToInt(task -> task.recommendations.size()).sum(),
                limited);
    }

    private synchronized List<CrossIdentityReplayOrchestrator.Recommendation> recommendations(
            RequestRecord record, URI target, String anonymousRequestKey) {
        LinkedHashSet<String> identities = new LinkedHashSet<>(targetAccountIds);
        if (includeAnonymous) identities.add(CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY);
        identities.remove(record.selectedIdentity());
        List<CrossIdentityReplayOrchestrator.Recommendation> values = new ArrayList<>();
        for (String identity : identities) {
            String key = automaticAnonymousGet
                    ? anonymousRequestKey + "\0" + identity
                    : record.evidenceId + "\0" + identity;
            if (!deduplicated.add(key)) continue;
            values.add(new CrossIdentityReplayOrchestrator.Recommendation(record.op, identity,
                    record.selectedIdentity(), record.evidenceId, target, record.runtimeId()));
        }
        return values;
    }

    private void dispatch(String offeredRunId,
                          List<CrossIdentityReplayOrchestrator.Recommendation> recommendations) {
        synchronized (this) {
            if (!runId.equals(offeredRunId)) return;
            if (state == State.STOPPED || !armed) {
                skipped += recommendations.size();
                lastReason = "RUN_STOPPED_BEFORE_DISPATCH";
                return;
            }
        }
        try {
            CrossIdentityReplayOrchestrator.RunResult result = dispatcher.dispatch(recommendations, true);
            synchronized (this) {
                if (!runId.equals(offeredRunId) || state == State.STOPPED) return;
                sent += result.sent();
                drafted += result.drafted();
                skipped += result.skipped();
                failed += (int) result.items().stream().filter(item ->
                        item.outcome() == CrossIdentityReplayOrchestrator.Outcome.EXECUTION_FAILED
                                || item.outcome() == CrossIdentityReplayOrchestrator.Outcome.DRAFT_FAILED).count();
                lastReason = result.sent() > 0 || result.drafted() > 0
                        ? "BATCH_COMPLETED"
                        : result.items().isEmpty() ? "BATCH_COMPLETED"
                        : result.items().getLast().reason();
            }
        } catch (RuntimeException error) {
            synchronized (this) {
                if (!runId.equals(offeredRunId) || state == State.STOPPED) return;
                skipped += recommendations.size();
                failed += recommendations.size();
                lastReason = "BATCH_FAILED";
            }
        }
    }

    private String rejection(RequestRecord record, URI target, boolean rawRequestRetained,
                             String anonymousRequestKey) {
        if (record == null || target == null || !target.isAbsolute()) return "INVALID_EVIDENCE_TARGET";
        if (!basisSourceEligible(record)) {
            return "SOURCE_NOT_ELIGIBLE";
        }
        if (!record.hasResponse || record.evidenceId == null || record.evidenceId.isBlank()
                || record.op == null || record.op.isBlank()
                || record.method == null || record.method.isBlank()) {
            return "INCOMPLETE_BASIS_EVIDENCE";
        }
        if (!rawRequestRetained) return "RAW_REQUEST_NOT_AVAILABLE";
        if (record.trafficClassification == null
                || record.trafficClassification.trafficClass() != TrafficClassification.TrafficClass.API
                || record.trafficClassification.disposition() != TrafficClassification.Disposition.INCLUDE) {
            return "NOT_INCLUDED_API_EVIDENCE";
        }
        if (!SUPPORTED_METHODS.contains(record.method.toUpperCase(Locale.ROOT))) {
            return "METHOD_NOT_SUPPORTED";
        }
        if (automaticAnonymousGet && !record.method.equalsIgnoreCase("GET")) {
            return "AUTOMATIC_ANONYMOUS_GET_ONLY";
        }
        if (automaticAnonymousGet && Fingerprints.ANONYMOUS.equals(record.selectedIdentity())) {
            return "ALREADY_ANONYMOUS_BASIS";
        }
        if (automaticAnonymousGet && (anonymousRequestKey == null || anonymousRequestKey.isBlank())) {
            return "ANONYMOUS_REQUEST_KEY_UNAVAILABLE";
        }
        return null;
    }

    private boolean basisSourceEligible(RequestRecord record) {
        if (record == null || record.passiveSubdomainTraffic || !basisSources.contains(record.source)) return false;
        if (record.source == Source.HUMAN) {
            return record.executionTrust == ExecutionTrust.OBSERVED;
        }
        if (record.source == Source.SCANNER) {
            return record.executionTrust == ExecutionTrust.CONTROLLED
                    && record.sourceDetail != SourceDetail.AUTHORIZATION_REPLAY
                    && record.sourceDetail != SourceDetail.ZAP_AUTHENTICATION
                    && record.phase == io.flowscope.core.RunPhase.EXPLORATION;
        }
        return record.source == Source.LLM
                && record.executionTrust == ExecutionTrust.CONTROLLED
                && record.sourceDetail == SourceDetail.LLM_EXPLORER
                && record.phase == io.flowscope.core.RunPhase.EXPLORATION;
    }
}
