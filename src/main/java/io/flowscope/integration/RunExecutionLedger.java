package io.flowscope.integration;

import io.flowscope.core.Masking;
import io.flowscope.core.Source;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * HTTP Evidence가 생기기 전 단계의 실행 결과를 보존한다. 실패를 Evidence나 그래프 관측으로
 * 승격하지 않으며, raw header/body/query/예외문은 저장하지 않는다.
 */
public final class RunExecutionLedger {
    public enum Outcome {
        HTTP_RESPONSE,
        TLS_FAILURE,
        DNS_FAILURE,
        TIMEOUT,
        CONNECTION_FAILURE,
        NO_RESPONSE,
        SCOPE_BLOCKED,
        APPROVAL_DENIED,
        INVALID_REQUEST,
        OTHER_FAILURE
    }

    public enum Quality { NOT_ATTEMPTED, ALL_FAILED, PARTIAL_FAILURE, RESPONSES_OBSERVED }

    public record Attempt(long sequence, Source source, String runId, String accountId,
                          String method, String service, String path, Outcome outcome,
                          int status, String evidenceId, Instant attemptedAt, long durationMillis) {
        public Attempt {
            if (sequence < 1) throw new IllegalArgumentException("attempt sequence must be positive");
            if (source == null || source == Source.UNKNOWN) {
                throw new IllegalArgumentException("attempt source must be HUMAN, SCANNER, or LLM");
            }
            runId = bounded(runId, "run id", 128, true);
            accountId = bounded(accountId, "account id", 128, false);
            method = bounded(method == null ? "UNKNOWN" : method.toUpperCase(Locale.ROOT),
                    "method", 16, true);
            service = bounded(service, "service", 512, false);
            path = bounded(path == null || path.isBlank() ? "/" : Masking.maskSecrets(path),
                    "path", 2_048, true);
            if (path.indexOf('?') >= 0 || path.indexOf('#') >= 0) {
                throw new IllegalArgumentException("attempt path must not contain query or fragment");
            }
            if (outcome == null) throw new IllegalArgumentException("attempt outcome is required");
            if (status < 0 || status > 999) throw new IllegalArgumentException("invalid HTTP status");
            evidenceId = bounded(evidenceId, "evidence id", 256, false);
            if (outcome == Outcome.HTTP_RESPONSE && (status < 100 || evidenceId == null)) {
                throw new IllegalArgumentException("HTTP response attempt needs status and Evidence ID");
            }
            if (outcome != Outcome.HTTP_RESPONSE && (status != 0 || evidenceId != null)) {
                throw new IllegalArgumentException("failed attempt cannot carry response Evidence");
            }
            if (attemptedAt == null) throw new IllegalArgumentException("attempt time is required");
            if (durationMillis < 0) throw new IllegalArgumentException("attempt duration cannot be negative");
        }
    }

    public record Summary(Source source, String runId, long attempted, long responses, long failures,
                          Quality quality, Map<Outcome, Long> outcomes) {
        public Summary {
            outcomes = Map.copyOf(outcomes == null ? Map.of() : outcomes);
        }
    }

    private static final int DEFAULT_LIMIT = 5_000;
    private final int limit;
    private final ArrayDeque<Attempt> attempts = new ArrayDeque<>();
    private long nextSequence = 1;

    public RunExecutionLedger() {
        this(DEFAULT_LIMIT);
    }

    RunExecutionLedger(int limit) {
        if (limit < 1) throw new IllegalArgumentException("attempt limit must be positive");
        this.limit = limit;
    }

    public synchronized Attempt record(Source source, String runId, String accountId, String method,
                                       String target, Outcome outcome, int status, String evidenceId,
                                       Instant attemptedAt, long durationMillis) {
        TargetParts targetParts = targetParts(target);
        Attempt attempt = new Attempt(nextSequence++, source, runId, accountId, method,
                targetParts.service(), targetParts.path(), outcome, status, evidenceId,
                attemptedAt == null ? Instant.now() : attemptedAt, durationMillis);
        attempts.addLast(attempt);
        while (attempts.size() > limit) attempts.removeFirst();
        return attempt;
    }

    public synchronized List<Attempt> attempts() {
        return List.copyOf(attempts);
    }

    public synchronized void replace(List<Attempt> values) {
        attempts.clear();
        nextSequence = 1;
        for (Attempt value : values == null ? List.<Attempt>of() : values) {
            attempts.addLast(value);
            nextSequence = Math.max(nextSequence, value.sequence() + 1);
            while (attempts.size() > limit) attempts.removeFirst();
        }
    }

    public synchronized void clear() {
        attempts.clear();
        nextSequence = 1;
    }

    public synchronized Summary summarize(Source source, String runId) {
        EnumMap<Outcome, Long> outcomes = new EnumMap<>(Outcome.class);
        long attempted = 0;
        long responses = 0;
        for (Attempt attempt : attempts) {
            if (attempt.source() != source || !attempt.runId().equals(runId)) continue;
            attempted++;
            outcomes.merge(attempt.outcome(), 1L, Long::sum);
            if (attempt.outcome() == Outcome.HTTP_RESPONSE) responses++;
        }
        long failures = attempted - responses;
        Quality quality = attempted == 0 ? Quality.NOT_ATTEMPTED
                : responses == 0 ? Quality.ALL_FAILED
                : failures > 0 ? Quality.PARTIAL_FAILURE
                : Quality.RESPONSES_OBSERVED;
        return new Summary(source, runId == null ? "" : runId, attempted, responses, failures,
                quality, outcomes);
    }

    public synchronized List<Summary> summaries() {
        Map<String, SourceRun> runs = new java.util.LinkedHashMap<>();
        for (Attempt attempt : attempts) {
            runs.putIfAbsent(attempt.source().name() + "\u0000" + attempt.runId(),
                    new SourceRun(attempt.source(), attempt.runId()));
        }
        List<Summary> result = new ArrayList<>();
        runs.values().forEach(run -> result.add(summarize(run.source(), run.runId())));
        int from = Math.max(0, result.size() - 100);
        return List.copyOf(result.subList(from, result.size()));
    }

    private static TargetParts targetParts(String target) {
        try {
            URI uri = URI.create(target == null ? "" : target);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            int port = uri.getPort() >= 0 ? uri.getPort() : "https".equals(scheme) ? 443 : 80;
            String service = scheme.isBlank() || host.isBlank() ? null
                    : scheme + "://" + host + ":" + port;
            String path = uri.getRawPath();
            return new TargetParts(service, path == null || path.isBlank() ? "/" : path);
        } catch (IllegalArgumentException ignored) {
            return new TargetParts(null, "/");
        }
    }

    private static String bounded(String value, String label, int max, boolean required) {
        if (value == null || value.isBlank()) {
            if (required) throw new IllegalArgumentException(label + " is required");
            return null;
        }
        String safe = Masking.maskSecrets(value.trim());
        if (safe.length() > max) throw new IllegalArgumentException(label + " is too long");
        return safe;
    }

    private record TargetParts(String service, String path) {}
    private record SourceRun(Source source, String runId) {}
}
