package io.flowscope.integration;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import io.flowscope.web.FlowScopeWebServer;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/**
 * One-run, explicitly armed cross-identity replay coordinator.
 *
 * <p>The implementation is deliberately serialized. Consequently no target can ever have more than one
 * in-flight automatic replay, and a freshness downgrade is observed before the next request for that identity.
 * Credential maps are method-local only and never enter the returned run report.</p>
 */
public final class CrossIdentityReplayOrchestrator {
    public static final String ANONYMOUS_IDENTITY = "anon";
    public static final int MAX_CONCURRENT_PER_TARGET = 1;
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD");
    private static final Set<String> DRAFT_ONLY_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

    public record Recommendation(String operation, String targetIdentity, String basisIdentity,
                                 String basisEvidenceId, URI target) {
        public Recommendation {
            operation = required(operation, "operation");
            targetIdentity = required(targetIdentity, "targetIdentity");
            basisIdentity = required(basisIdentity, "basisIdentity");
            basisEvidenceId = required(basisEvidenceId, "basisEvidenceId");
            if (target == null || !target.isAbsolute()) throw new IllegalArgumentException("absolute target is required");
        }
    }

    /** Safe replay provenance. It intentionally contains no request credentials. */
    public record ReplayContext(String runId, String targetIdentity, String basisIdentity,
                                String basisEvidenceId, Instant replayedAt,
                                ExecutionTrust executionTrust) {
        public ReplayContext {
            runId = required(runId, "runId");
            targetIdentity = required(targetIdentity, "targetIdentity");
            basisIdentity = required(basisIdentity, "basisIdentity");
            basisEvidenceId = required(basisEvidenceId, "basisEvidenceId");
            if (replayedAt == null) throw new IllegalArgumentException("replayedAt is required");
            if (executionTrust != ExecutionTrust.CONTROLLED) {
                throw new IllegalArgumentException("active replay must be CONTROLLED");
            }
        }

        /** Applies the fixed provenance contract before the transport publishes this Evidence. */
        public void applyTo(RequestRecord record) {
            if (record == null || record.source != Source.SCANNER) {
                throw new IllegalArgumentException("active replay Evidence must use the existing SCANNER source");
            }
            record.sourceDetail = SourceDetail.AUTHORIZATION_REPLAY;
            record.orchestrator = Orchestrator.SYSTEM;
            record.tool = ToolKind.BURP;
            record.phase = RunPhase.AUTHORIZATION_REPLAY;
            record.executionTrust = ExecutionTrust.CONTROLLED;
            record.runId = runId;
            record.laneAccountId = targetIdentity;
            record.replayBasisIdentity = basisIdentity;
            record.replayBasisEvidenceId = basisEvidenceId;
            if (record.timestamp == 0) record.timestamp = replayedAt.toEpochMilli();
        }
    }

    /** Response data needed for the existing Request Lab result and SessionBroker freshness feedback. */
    public record Exchange(FlowScopeWebServer.RequestLabResult result, String location, String body,
                           List<String> setCookieHeaders) {
        public Exchange {
            if (result == null) throw new IllegalArgumentException("result is required");
            setCookieHeaders = setCookieHeaders == null ? List.of() : List.copyOf(setCookieHeaders);
        }
    }

    @FunctionalInterface
    public interface Transport {
        Exchange send(Recommendation recommendation, Map<String, String> credentialHeaders,
                      ReplayContext context) throws Exception;
    }

    @FunctionalInterface
    public interface DraftOpener {
        void open(Recommendation recommendation, Map<String, String> credentialHeaders) throws Exception;
    }

    public enum Outcome {
        SENT,
        DRAFTED,
        SKIPPED_UNARMED,
        SKIPPED_DUPLICATE,
        SKIPPED_INELIGIBLE,
        SKIPPED_UNSUPPORTED_METHOD,
        SKIPPED_KILL_SWITCH,
        EXECUTION_FAILED,
        DRAFT_FAILED
    }

    /** Safe report item: credentials and raw request headers are deliberately absent. */
    public record Item(String operation, String targetIdentity, String basisIdentity,
                       String basisEvidenceId, Outcome outcome,
                       FlowScopeWebServer.RequestLabResult result, String reason) {}

    public record RunResult(String runId, boolean armed, int sent, int drafted, int skipped, List<Item> items) {
        public RunResult { items = List.copyOf(items); }
    }

    private final SessionBroker sessions;
    private final Supplier<ScopePolicy> scope;
    private final Transport transport;
    private final DraftOpener draftOpener;
    private final Clock clock;
    private final AtomicBoolean killSwitch = new AtomicBoolean();

    public CrossIdentityReplayOrchestrator(SessionBroker sessions, Supplier<ScopePolicy> scope,
                                           Transport transport, DraftOpener draftOpener, Clock clock) {
        this.sessions = java.util.Objects.requireNonNull(sessions, "sessions");
        this.scope = java.util.Objects.requireNonNull(scope, "scope");
        this.transport = java.util.Objects.requireNonNull(transport, "transport");
        this.draftOpener = java.util.Objects.requireNonNull(draftOpener, "draftOpener");
        this.clock = java.util.Objects.requireNonNull(clock, "clock");
    }

    /** Stops the current run before its next draft or network send. */
    public void kill() { killSwitch.set(true); }

    /** Arms a sequence of live batches. A later kill remains effective until this is called again. */
    public void beginContinuousRun() { killSwitch.set(false); }

    /**
     * Executes one bounded run. The {@code armed} value is consumed by this call and is never retained for a later run.
     */
    public synchronized RunResult execute(List<Recommendation> recommendations, boolean armed) {
        beginContinuousRun();
        return executeContinuousBatch(recommendations, armed);
    }

    /** Executes one batch without clearing a kill requested for the surrounding live run. */
    public synchronized RunResult executeContinuousBatch(List<Recommendation> recommendations, boolean armed) {
        String runId = "authorization-replay-" + UUID.randomUUID();
        List<Item> items = new ArrayList<>();
        Set<String> deduplicated = new LinkedHashSet<>();
        int sent = 0;
        int drafted = 0;
        int skipped = 0;

        for (Recommendation recommendation : recommendations == null ? List.<Recommendation>of() : recommendations) {
            String method = method(recommendation.operation());
            String dedupKey = method + "\0" + recommendation.operation() + "\0" + recommendation.targetIdentity();
            if (!deduplicated.add(dedupKey)) {
                items.add(item(recommendation, Outcome.SKIPPED_DUPLICATE, null, "DUPLICATE_OPERATION_IDENTITY"));
                skipped++;
                continue;
            }
            if (killSwitch.get()) {
                items.add(item(recommendation, Outcome.SKIPPED_KILL_SWITCH, null, "RUN_KILLED"));
                skipped++;
                continue;
            }
            if (SAFE_METHODS.contains(method)) {
                if (!armed) {
                    items.add(item(recommendation, Outcome.SKIPPED_UNARMED, null, "RUN_NOT_ARMED"));
                    skipped++;
                    continue;
                }
                Map<String, String> credentials;
                try {
                    credentials = credentials(recommendation);
                } catch (RuntimeException error) {
                    items.add(item(recommendation, Outcome.SKIPPED_INELIGIBLE, null,
                            "SESSION_OR_SCOPE_INELIGIBLE"));
                    skipped++;
                    continue;
                }
                if (killSwitch.get()) {
                    items.add(item(recommendation, Outcome.SKIPPED_KILL_SWITCH, null, "RUN_KILLED"));
                    skipped++;
                    continue;
                }
                ReplayContext context = new ReplayContext(runId, recommendation.targetIdentity(),
                        recommendation.basisIdentity(), recommendation.basisEvidenceId(), clock.instant(),
                        ExecutionTrust.CONTROLLED);
                try {
                    Exchange exchange = transport.send(recommendation, credentials, context);
                    String reason = "CONTROLLED_RESPONSE_RECORDED";
                    if (!anonymous(recommendation)) {
                        try {
                            sessions.observeResponse(sessions.handleForAccount(recommendation.targetIdentity()),
                                    recommendation.target(), exchange.result().status(), exchange.location(), exchange.body(),
                                    exchange.setCookieHeaders(), clock.instant());
                        } catch (RuntimeException feedbackError) {
                            reason = "CONTROLLED_RESPONSE_RECORDED_FRESHNESS_FEEDBACK_FAILED";
                        }
                    }
                    items.add(item(recommendation, Outcome.SENT, exchange.result(), reason));
                    sent++;
                } catch (Exception error) {
                    items.add(item(recommendation, Outcome.EXECUTION_FAILED, null, "CONTROLLED_SEND_FAILED"));
                    skipped++;
                }
                continue;
            }
            if (DRAFT_ONLY_METHODS.contains(method)) {
                Map<String, String> credentials;
                try {
                    credentials = credentials(recommendation);
                } catch (RuntimeException error) {
                    items.add(item(recommendation, Outcome.SKIPPED_INELIGIBLE, null,
                            "SESSION_OR_SCOPE_INELIGIBLE"));
                    skipped++;
                    continue;
                }
                try {
                    draftOpener.open(recommendation, credentials);
                    items.add(item(recommendation, Outcome.DRAFTED, null, "REPEATER_DRAFT_ONLY"));
                    drafted++;
                } catch (Exception error) {
                    items.add(item(recommendation, Outcome.DRAFT_FAILED, null, "REPEATER_DRAFT_FAILED"));
                    skipped++;
                }
                continue;
            }
            items.add(item(recommendation, Outcome.SKIPPED_UNSUPPORTED_METHOD, null, "METHOD_NOT_SUPPORTED"));
            skipped++;
        }
        return new RunResult(runId, armed, sent, drafted, skipped, items);
    }

    private Map<String, String> credentials(Recommendation recommendation) {
        if (anonymous(recommendation)) {
            ScopePolicy current = scope.get();
            if (current == null || !current.allows(recommendation.target().toString())) {
                throw new IllegalStateException("anonymous target is outside exact scope");
            }
            return Map.of();
        }
        return sessions.headersForAccount(recommendation.targetIdentity(), recommendation.target(),
                scope.get(), clock.instant());
    }

    private static boolean anonymous(Recommendation recommendation) {
        return ANONYMOUS_IDENTITY.equals(recommendation.targetIdentity());
    }

    private static Item item(Recommendation value, Outcome outcome,
                             FlowScopeWebServer.RequestLabResult result, String reason) {
        return new Item(value.operation(), value.targetIdentity(), value.basisIdentity(),
                value.basisEvidenceId(), outcome, result, reason);
    }

    private static String method(String operation) {
        int separator = operation.indexOf(' ');
        return (separator < 0 ? operation : operation.substring(0, separator)).trim().toUpperCase(Locale.ROOT);
    }

    private static String required(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value.trim();
    }
}
