package io.flowscope.explorer;

import io.flowscope.core.LaneCompletionPolicy;
import io.flowscope.core.Masking;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;

/** 계정 준비 → loopback HTTP gateway → Codex turn → Evidence 완료 gate를 소유한다. */
public final class ExplorerCoordinator implements AutoCloseable {
    public enum Status {
        IDLE, AUTHENTICATING, RUNNING, COMPLETED, COMPLETED_WITH_LIMITATIONS,
        FAILED, CANCELLED, FAILED_CLEANUP
    }

    public record StartRequest(String target, List<String> accountIds, boolean includeAnonymous) {
        public StartRequest { accountIds = List.copyOf(accountIds == null ? List.of() : accountIds); }
    }

    public record Activity(long sequence, Instant at, String kind, String title, String detail,
                           String status, Long durationMillis) {}

    public record Snapshot(Status status, String runId, String target, Instant startedAt, Instant endedAt,
                           long elapsedMillis, String message, String providerReadiness,
                           List<String> accountIds, boolean anonymous, long attempts, long responses,
                           long endpointDeclarations, long parameterDeclarations, long capabilityProbes,
                           List<ExplorerProvider.Unresolved> unresolved, List<Activity> activities) {
        public Snapshot {
            accountIds = List.copyOf(accountIds == null ? List.of() : accountIds);
            unresolved = List.copyOf(unresolved == null ? List.of() : unresolved);
            activities = List.copyOf(activities == null ? List.of() : activities);
        }
    }

    private static final int ACTIVITY_LIMIT = 300;
    private final ExplorerAccountVault vault;
    private final ExplorerTransport transport;
    private final ExplorerProvider provider;
    private final RunContextRegistry contexts;
    private final Predicate<String> exactScope;
    private final Supplier<Pipeline.Result> completionSnapshot;
    private final Consumer<List<RouteCandidate>> discoverySink;
    private final Consumer<String> logger;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-explorer-coordinator");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicLong activitySequence = new AtomicLong();
    private final Set<String> declaredEndpointKeys = new LinkedHashSet<>();
    private final Set<String> declaredParameterKeys = new LinkedHashSet<>();
    private volatile Snapshot snapshot = idle();
    private volatile ExplorerHttpGateway gateway;
    private volatile ExplorerProvider.Handle providerHandle;
    private volatile boolean closed;

    public ExplorerCoordinator(ExplorerAccountVault vault, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<String> logger) {
        this(vault, transport, provider, contexts, exactScope, completionSnapshot, ignored -> {}, logger);
    }

    public ExplorerCoordinator(ExplorerAccountVault vault, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<List<RouteCandidate>> discoverySink,
                               Consumer<String> logger) {
        this.vault = vault;
        this.transport = transport;
        this.provider = provider;
        this.contexts = contexts;
        this.exactScope = exactScope;
        this.completionSnapshot = completionSnapshot;
        this.discoverySink = discoverySink == null ? ignored -> {} : discoverySink;
        this.logger = logger == null ? ignored -> {} : logger;
    }

    public synchronized Snapshot start(StartRequest request) {
        if (closed) throw new IllegalStateException("Explorer가 종료됐습니다.");
        if (active(snapshot.status())) throw new IllegalStateException("Explorer가 이미 실행 중입니다.");
        if (request == null || request.target() == null || request.target().isBlank()) {
            throw new IllegalArgumentException("Explorer 대상이 필요합니다.");
        }
        if (!exactScope.test(request.target())) throw new IllegalArgumentException("대상이 현재 exact scope 밖입니다.");
        if (!request.includeAnonymous() && request.accountIds().isEmpty()) {
            throw new IllegalArgumentException("비로그인 또는 하나 이상의 Explorer 계정을 선택하세요.");
        }
        request.accountIds().forEach(vault::view);
        String readiness = provider.readiness();
        if (!"READY".equals(readiness)) throw new IllegalStateException(readiness);
        if (contexts.hasActiveRuns()) throw new IllegalStateException("활성 HUMAN/ZAP/LLM 실행을 먼저 종료하세요.");
        String runId = "llm-explorer-" + System.currentTimeMillis() + "-"
                + UUID.randomUUID().toString().substring(0, 8);
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        activitySequence.set(0);
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        snapshot = new Snapshot(Status.AUTHENTICATING, runId, request.target(), Instant.now(), null,
                0, "Explorer 계정과 세션을 준비하는 중입니다.", readiness,
                request.accountIds(), request.includeAnonymous(), 0, 0, 0, 0, 0, List.of(), List.of());
        addActivity("SYSTEM", "Explorer 준비", "exact scope와 Codex 로그인을 확인했습니다.", "RUNNING", null);
        worker.execute(() -> prepareAndStart(request, runId));
        return current();
    }

    public synchronized Snapshot current() {
        Snapshot value = snapshot;
        long elapsed = value.startedAt() == null ? 0 : Math.max(0,
                (value.endedAt() == null ? Instant.now() : value.endedAt()).toEpochMilli()
                        - value.startedAt().toEpochMilli());
        return new Snapshot(value.status(), value.runId(), value.target(), value.startedAt(), value.endedAt(),
                elapsed, value.message(), provider.readiness(), value.accountIds(), value.anonymous(),
                value.attempts(), value.responses(), value.endpointDeclarations(),
                value.parameterDeclarations(), value.capabilityProbes(), value.unresolved(), value.activities());
    }

    public List<ExplorerAccountVault.View> accounts() { return vault.views(); }
    public ExplorerAccountVault.View saveAccount(ExplorerAccountVault.Input input) { return vault.save(input); }
    public void removeAccount(String id) { vault.remove(id); }
    public void clearAccounts() { vault.clear(); }

    public synchronized Snapshot steer(String message) {
        if (snapshot.status() != Status.RUNNING || providerHandle == null) {
            throw new IllegalStateException("진행 중인 Explorer가 없습니다.");
        }
        providerHandle.steer(message);
        return current();
    }

    public synchronized Snapshot cancel() {
        if (!active(snapshot.status())) return current();
        if (providerHandle != null) providerHandle.cancel();
        contexts.abort(Source.LLM, snapshot.runId());
        closeGateway();
        snapshot = terminal(Status.CANCELLED, "사용자가 Explorer를 중단했습니다.", snapshot.unresolved());
        addActivity("SYSTEM", "Explorer 중단", "실행과 gateway를 종료했습니다.", "CANCELLED", null);
        return current();
    }

    public synchronized Snapshot clear() {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 상태를 지울 수 없습니다.");
        snapshot = idle();
        activitySequence.set(0);
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        return snapshot;
    }

    public synchronized Snapshot recheckProvider() {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 Codex 준비 상태를 다시 확인할 수 없습니다.");
        provider.invalidateReadiness();
        return current();
    }

    private void prepareAndStart(StartRequest request, String runId) {
        List<String> readyAccounts = new ArrayList<>();
        List<ExplorerProvider.Unresolved> limitations = new ArrayList<>();
        try {
            ExplorerHttpGateway created = new ExplorerHttpGateway(
                    vault, transport, exactScope, runId, this::gatewayEvent,
                    candidates -> acceptDiscoveries(runId, candidates));
            synchronized (this) {
                if (!sameActiveRun(runId)) {
                    created.close();
                    return;
                }
                gateway = created;
            }
            ExplorerAuthRuntime auth = new ExplorerAuthRuntime(vault, transport);
            for (String accountId : request.accountIds()) {
                if (!sameActiveRun(runId)) return;
                addActivity("AUTH", "계정 로그인", accountId + " 세션을 준비합니다.", "RUNNING", null);
                ExplorerAccountVault.View view = auth.authenticate(accountId, runId);
                if (view.status() == ExplorerAccountVault.AuthStatus.READY) {
                    readyAccounts.add(accountId);
                    addActivity("AUTH", "계정 로그인", view.label() + " READY", "COMPLETED", null);
                } else {
                    limitations.add(new ExplorerProvider.Unresolved("authentication", view.label(), view.message()));
                    addActivity("AUTH", "계정 로그인", view.label() + " · " + view.message(), "FAILED", null);
                }
            }
            if (readyAccounts.isEmpty() && !request.includeAnonymous()) {
                fail(runId, "선택한 계정 중 로그인 가능한 계정이 없습니다.", limitations);
                return;
            }
            String prompt = prompt(request.target(), readyAccounts, request.includeAnonymous());
            synchronized (this) {
                if (!sameActiveRun(runId)) return;
                snapshot = update(Status.RUNNING, "Codex Explorer가 독립적으로 대상 산출물과 API를 탐색 중입니다.",
                        limitations, null);
                providerHandle = provider.start(new ExplorerProvider.Request(runId, request.target(),
                        List.of(request.target()), readyAccounts, gateway.url(), gateway.discoveriesUrl(),
                        gateway.token(), prompt),
                        providerListener(runId, limitations));
            }
        } catch (Exception error) {
            fail(runId, "Explorer 시작 실패: " + safe(error.getMessage()), limitations);
        }
    }

    private ExplorerProvider.Listener providerListener(String runId,
                                                        List<ExplorerProvider.Unresolved> initialLimitations) {
        return new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity event) {
                if (sameActiveRun(runId)) addActivity(event.kind(), event.title(), event.detail(),
                        event.status(), event.durationMillis());
            }

            @Override public void completed(ExplorerProvider.Result result) {
                List<ExplorerProvider.Unresolved> limitations = new ArrayList<>(initialLimitations);
                limitations.addAll(result.unresolved());
                finish(runId, result.summary(), limitations);
            }

            @Override public void failed(String message) { fail(runId, message, initialLimitations); }
        };
    }

    private synchronized void finish(String runId, String message,
                                     List<ExplorerProvider.Unresolved> limitations) {
        if (!sameActiveRun(runId)) return;
        try {
            LaneCompletionPolicy.complete(contexts, Source.LLM, runId, completionSnapshot.get());
            closeGateway();
            Status status = limitations.isEmpty() ? Status.COMPLETED : Status.COMPLETED_WITH_LIMITATIONS;
            String summary = "Explorer 완료 · HTTP 시도 " + snapshot.attempts()
                    + "건 · 응답 Evidence " + snapshot.responses()
                    + "건 · 선언 endpoint " + snapshot.endpointDeclarations()
                    + "건 · 선언 parameter " + snapshot.parameterDeclarations()
                    + "건 · OPTIONS probe " + snapshot.capabilityProbes() + "건";
            snapshot = terminal(status, summary, limitations);
            addActivity("SYSTEM", "Explorer 완료", status == Status.COMPLETED
                    ? "응답 Evidence와 종료 조건을 확인했습니다."
                    : "응답 Evidence를 보존하고 미해결 항목을 함께 남겼습니다.", status.name(), null);
        } catch (Exception error) {
            contexts.abort(Source.LLM, runId);
            closeGateway();
            snapshot = terminal(Status.FAILED,
                    "Explorer 완료 gate 실패: " + safe(error.getMessage()), limitations);
            addActivity("ERROR", "완료 gate 실패", snapshot.message(), "FAILED", null);
        }
    }

    private synchronized void fail(String runId, String message,
                                   List<ExplorerProvider.Unresolved> limitations) {
        if (!sameActiveRun(runId)) return;
        contexts.abort(Source.LLM, runId);
        closeGateway();
        snapshot = terminal(Status.FAILED, safe(message), limitations);
        addActivity("ERROR", "Explorer 실패", snapshot.message(), "FAILED", null);
        logger.accept("FlowScope Explorer 실패: " + snapshot.message());
    }

    private synchronized void gatewayEvent(ExplorerHttpGateway.Event event) {
        if (!active(snapshot.status())) return;
        long attempts = snapshot.attempts() + 1;
        boolean evidenceStored = event.httpStatus() > 0
                && event.evidenceId() != null && !event.evidenceId().isBlank();
        long responses = snapshot.responses() + (evidenceStored ? 1 : 0);
        long probes = snapshot.capabilityProbes()
                + (evidenceStored && event.method().equals("OPTIONS") ? 1 : 0);
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), attempts, responses,
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), probes,
                snapshot.unresolved(), snapshot.activities());
        String account = event.accountId() == null || event.accountId().isBlank() ? "비로그인" : event.accountId();
        addActivity("HTTP", event.method() + " " + event.url(),
                account + (event.httpStatus() > 0 ? " · HTTP " + event.httpStatus() + " · " + event.evidenceId()
                        : " · " + event.message()), event.status(), event.durationMillis());
    }

    private synchronized void acceptDiscoveries(String runId, List<RouteCandidate> candidates) {
        if (!sameActiveRun(runId) || candidates == null || candidates.isEmpty()) return;
        discoverySink.accept(List.copyOf(candidates));
        long newEndpoints = 0;
        long newParameters = 0;
        for (RouteCandidate candidate : candidates) {
            String endpointKey = candidate.service() + "\0" + candidate.method() + "\0" + candidate.pathTemplate();
            if (declaredEndpointKeys.add(endpointKey)) newEndpoints++;
            for (RouteCandidate.DeclaredParameter parameter : candidate.declaredParameters()) {
                if (declaredParameterKeys.add(endpointKey + "\0" + parameter.location()
                        + "\0" + parameter.fieldPath())) newParameters++;
            }
        }
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations() + newEndpoints,
                snapshot.parameterDeclarations() + newParameters, snapshot.capabilityProbes(),
                snapshot.unresolved(), snapshot.activities());
        addActivity("DISCOVERY", "산출물 선언 저장",
                "endpoint " + newEndpoints + "건 · parameter " + newParameters
                        + "건을 현재 run Evidence에 연결했습니다.", "COMPLETED", null);
    }

    private synchronized void addActivity(String kind, String title, String detail,
                                          String status, Long durationMillis) {
        if (snapshot == null) return;
        List<Activity> next = new ArrayList<>(snapshot.activities());
        next.add(new Activity(activitySequence.incrementAndGet(), Instant.now(), kind,
                Masking.truncate(Masking.maskSecrets(title == null ? "" : title), 2_048),
                safe(detail), status, durationMillis));
        if (next.size() > ACTIVITY_LIMIT) next = new ArrayList<>(next.subList(next.size() - ACTIVITY_LIMIT, next.size()));
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                snapshot.unresolved(), List.copyOf(next));
    }

    private Snapshot update(Status status, String message, List<ExplorerProvider.Unresolved> unresolved,
                            Instant endedAt) {
        return new Snapshot(status, snapshot.runId(), snapshot.target(), snapshot.startedAt(), endedAt,
                snapshot.elapsedMillis(), message, snapshot.providerReadiness(), snapshot.accountIds(),
                snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                unresolved, snapshot.activities());
    }

    private Snapshot terminal(Status status, String message, List<ExplorerProvider.Unresolved> unresolved) {
        return update(status, message, List.copyOf(unresolved), Instant.now());
    }

    private boolean sameRun(String runId) { return runId != null && runId.equals(snapshot.runId()); }

    private boolean sameActiveRun(String runId) { return sameRun(runId) && active(snapshot.status()); }

    private static boolean active(Status status) {
        return status == Status.AUTHENTICATING || status == Status.RUNNING;
    }

    private void closeGateway() {
        ExplorerHttpGateway value = gateway;
        gateway = null;
        providerHandle = null;
        if (value != null) value.close();
    }

    private static Snapshot idle() {
        return new Snapshot(Status.IDLE, "", "", null, null, 0, "Explorer 실행 대기", "확인 전",
                List.of(), false, 0, 0, 0, 0, 0, List.of(), List.of());
    }

    private static String prompt(String target, List<String> accounts, boolean anonymous) throws IOException {
        String instructions;
        try (InputStream input = ExplorerCoordinator.class.getResourceAsStream("/explorer/explorer-system.md")) {
            if (input == null) throw new IOException("Explorer 지침 리소스가 없습니다.");
            instructions = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        String handles = accounts.isEmpty() ? "- 없음" : String.join("\n", accounts.stream().map(value -> "- " + value).toList());
        return instructions + "\n\n# 실행 입력\n"
                + "대상 시작 URL: " + target + "\n"
                + "사용 가능한 인증 계정 handle:\n" + handles + "\n"
                + "비로그인 handle: " + (anonymous ? "빈 문자열로 사용 가능" : "사용 금지") + "\n";
    }

    private static String safe(String value) {
        return Masking.truncate(Masking.maskSecrets(value == null ? "" : value), 4_000);
    }

    @Override public synchronized void close() {
        closed = true;
        if (active(snapshot.status())) cancel();
        closeGateway();
        provider.close();
        vault.close();
        worker.shutdownNow();
    }
}
