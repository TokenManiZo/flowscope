package io.flowscope.integration;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
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
    public static final int MAX_RECOMMENDATIONS_PER_RUN = 200;
    private static final Set<String> SUPPORTED_METHODS =
            Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE");

    public enum State { STOPPED, ACTIVE, LIMIT_REACHED }

    public record Snapshot(String runId, State state, boolean armed,
                           List<String> targetAccountIds, boolean includeAnonymous,
                           int observed, int eligible, int queued,
                           int sent, int drafted, int skipped, String lastReason) {
        public Snapshot { targetAccountIds = List.copyOf(targetAccountIds); }
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
    private final LinkedHashSet<String> deduplicated = new LinkedHashSet<>();
    private String runId = "";
    private State state = State.STOPPED;
    private boolean armed;
    private boolean includeAnonymous;
    private int observed;
    private int eligible;
    private int queued;
    private int sent;
    private int drafted;
    private int skipped;
    private String lastReason = "NOT_STARTED";

    public LiveCrossIdentityReplayCoordinator(Dispatcher dispatcher, Runnable beginRun,
                                              Runnable killRun, Executor executor) {
        this.dispatcher = java.util.Objects.requireNonNull(dispatcher, "dispatcher");
        this.beginRun = java.util.Objects.requireNonNull(beginRun, "beginRun");
        this.killRun = java.util.Objects.requireNonNull(killRun, "killRun");
        this.executor = java.util.Objects.requireNonNull(executor, "executor");
    }

    public synchronized Snapshot start(List<String> accountIds, boolean anonymous, boolean approved) {
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
        beginRun.run();
        runId = "live-authorization-replay-" + UUID.randomUUID();
        state = State.ACTIVE;
        armed = true;
        includeAnonymous = anonymous;
        targetAccountIds.clear();
        targetAccountIds.addAll(selected);
        deduplicated.clear();
        observed = eligible = queued = sent = drafted = skipped = 0;
        lastReason = "ARMED";
        return snapshot();
    }

    public void stop() {
        synchronized (this) {
            if (state == State.STOPPED) return;
            state = State.STOPPED;
            armed = false;
            lastReason = "STOPPED_BY_OPERATOR";
        }
        killRun.run();
    }

    public synchronized void reset() {
        state = State.STOPPED;
        armed = false;
        includeAnonymous = false;
        targetAccountIds.clear();
        deduplicated.clear();
        runId = "";
        observed = eligible = queued = sent = drafted = skipped = 0;
        lastReason = "NOT_STARTED";
        killRun.run();
    }

    public synchronized boolean acceptingCaptures() { return state == State.ACTIVE && armed; }

    /** Offers one newly captured, analyzed HUMAN exchange. Imported or evicted raw exchanges are rejected. */
    public boolean offer(RequestRecord record, URI target, boolean rawRequestRetained) {
        List<CrossIdentityReplayOrchestrator.Recommendation> recommendations;
        String offeredRunId;
        synchronized (this) {
            if (!acceptingCaptures()) return false;
            observed++;
            String rejection = rejection(record, target, rawRequestRetained);
            if (rejection != null) {
                skipped++;
                lastReason = rejection;
                return false;
            }
            recommendations = recommendations(record, target);
            if (recommendations.isEmpty()) {
                skipped++;
                lastReason = "NO_OTHER_SELECTED_IDENTITY";
                return false;
            }
            eligible++;
            queued += recommendations.size();
            if (queued >= MAX_RECOMMENDATIONS_PER_RUN) state = State.LIMIT_REACHED;
            lastReason = "QUEUED";
            offeredRunId = runId;
        }
        executor.execute(() -> dispatch(offeredRunId, recommendations));
        return true;
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(runId, state, armed, new ArrayList<>(targetAccountIds), includeAnonymous,
                observed, eligible, queued, sent, drafted, skipped, lastReason);
    }

    private synchronized List<CrossIdentityReplayOrchestrator.Recommendation> recommendations(
            RequestRecord record, URI target) {
        LinkedHashSet<String> identities = new LinkedHashSet<>(targetAccountIds);
        if (includeAnonymous) identities.add(CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY);
        identities.remove(record.laneAccountId);
        List<CrossIdentityReplayOrchestrator.Recommendation> values = new ArrayList<>();
        for (String identity : identities) {
            if (queued + values.size() >= MAX_RECOMMENDATIONS_PER_RUN) break;
            String key = record.evidenceId + "\0" + identity;
            if (!deduplicated.add(key)) continue;
            values.add(new CrossIdentityReplayOrchestrator.Recommendation(record.op, identity,
                    record.laneAccountId, record.evidenceId, target));
        }
        return values;
    }

    private void dispatch(String offeredRunId,
                          List<CrossIdentityReplayOrchestrator.Recommendation> recommendations) {
        synchronized (this) {
            if (!runId.equals(offeredRunId) || state == State.STOPPED || !armed) {
                skipped += recommendations.size();
                lastReason = "RUN_STOPPED_BEFORE_DISPATCH";
                return;
            }
        }
        try {
            CrossIdentityReplayOrchestrator.RunResult result = dispatcher.dispatch(recommendations, true);
            synchronized (this) {
                if (!runId.equals(offeredRunId)) return;
                sent += result.sent();
                drafted += result.drafted();
                skipped += result.skipped();
                lastReason = "BATCH_COMPLETED";
            }
        } catch (RuntimeException error) {
            synchronized (this) {
                if (!runId.equals(offeredRunId)) return;
                skipped += recommendations.size();
                lastReason = "BATCH_FAILED";
            }
        }
    }

    private static String rejection(RequestRecord record, URI target, boolean rawRequestRetained) {
        if (record == null || target == null || !target.isAbsolute()) return "INVALID_EVIDENCE_TARGET";
        if (record.source != Source.HUMAN || record.executionTrust != ExecutionTrust.OBSERVED) {
            return "NOT_OBSERVED_HUMAN_EVIDENCE";
        }
        if (!record.hasResponse || record.evidenceId == null || record.evidenceId.isBlank()
                || record.op == null || record.op.isBlank()
                || record.method == null || record.method.isBlank()
                || record.laneAccountId == null || record.laneAccountId.isBlank()) {
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
        return null;
    }
}
