package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Subscription-backed Codex/Claude CLI launcher. Target traffic still flows only through FlowScope MCP. */
public final class LocalLlmRunner implements AutoCloseable {
    public enum Provider { CODEX, CLAUDE }
    public enum Role { EXPLORER, JUDGE }
    public enum Status { IDLE, RUNNING, SUCCEEDED, FAILED, CANCELLED }
    public enum ReadinessState { CHECKING, READY, LOGIN_REQUIRED, NOT_INSTALLED, ERROR }

    public record Request(Provider provider, Role role, String target, List<String> exactScope,
                          String accountId) {}

    public record State(Status status, Provider provider, Role role, String runId, String providerSessionId,
                        Instant startedAt, Instant endedAt, String message, String outputTail,
                        boolean sessionMetadataMayRemain) {
        static State idle() {
            return new State(Status.IDLE, null, null, "", "", null, null,
                    "LLM 실행 대기", "", false);
        }
    }

    /** Sanitized provider activity shown to the operator; hidden reasoning and raw tool payloads are excluded. */
    /** elapsedMillis는 실행 시작 기준 경과, durationMillis는 도구 호출 하나의 소요(없으면 null). */
    public record Activity(long sequence, Instant at, String kind, String title, String detail,
                           String status, long elapsedMillis, Long durationMillis) {}

    /** Sanitized local CLI readiness. Provider account identifiers and command output are never retained. */
    public record ProviderReadiness(ReadinessState state, boolean ready, String message,
                                    String executable, Instant checkedAt) {}

    @FunctionalInterface
    interface ProcessLauncher {
        Process start(Provider provider, List<String> command, Path directory,
                      Map<String, String> environment) throws IOException;
    }

    private static final int OUTPUT_LIMIT = 64 * 1024;
    private static final int ACTIVITY_LIMIT = 200;
    private static final int ACTIVITY_DETAIL_LIMIT = 4_000;
    private static final int PROVIDER_LINE_LIMIT = 32 * 1024;
    private static final int PREFLIGHT_OUTPUT_LIMIT = 16 * 1024;
    private static final long PREFLIGHT_TTL_SECONDS = 30;
    private static final long PROCESS_TERMINATION_TIMEOUT_MILLIS = 1_000;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern CODEX_SESSION = Pattern.compile("\\\"thread_id\\\"\\s*:\\s*\\\"([0-9a-fA-F-]{16,64})\\\"");
    private static final List<String> EXPLORER_TOOLS = List.of(
            "flowscope_get_status", "flowscope_list_sessions", "flowscope_target_read",
            "flowscope_target_request",
            "flowscope_list_route_candidates", "flowscope_list_evidence", "flowscope_get_evidence",
            "flowscope_browser_navigate", "flowscope_browser_snapshot", "flowscope_browser_interact",
            "flowscope_browser_close",
            "flowscope_end_run");
    private static final List<String> JUDGE_TOOLS = List.of(
            "flowscope_get_status", "flowscope_lock_dataset", "flowscope_list_candidates",
            "flowscope_list_route_candidates", "flowscope_list_evidence", "flowscope_get_evidence",
            "flowscope_list_sessions", "flowscope_zap_alerts", "flowscope_submit_assessment",
            "flowscope_begin_llm_run", "flowscope_target_read", "flowscope_target_request", "flowscope_end_run",
            "flowscope_submit_validation", "flowscope_list_validations");

    private final String mcpUrl;
    private final String mcpToken;
    /** 도구 호출 시작 시각(item id 또는 tool_use id 기준). 완료 이벤트에서 소요 시간을 계산하고 비운다. */
    private final java.util.concurrent.ConcurrentHashMap<String, Instant> toolStarts =
            new java.util.concurrent.ConcurrentHashMap<>();
    private final RunContextRegistry contexts;
    private final SessionBroker sessions;
    private final ProcessLauncher launcher;
    private final Consumer<String> logger;
    private final BooleanSupplier datasetLocked;
    private final Predicate<String> explorerHasEvidence;
    private final Consumer<String> explorerCleanup;
    private final boolean enforceSubscriptionLogin;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-llm-cli");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicReference<State> state = new AtomicReference<>(State.idle());
    private final AtomicReference<List<Activity>> activities = new AtomicReference<>(List.of());
    private final AtomicLong activitySequence = new AtomicLong();
    private final AtomicBoolean readinessRefreshActive = new AtomicBoolean();
    private final AtomicReference<Map<Provider, ProviderReadiness>> providerReadiness =
            new AtomicReference<>(Map.of());
    private final Map<Provider, String> executableOverrides;
    private final ExecutorService readinessWorker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-llm-readiness");
        thread.setDaemon(true);
        return thread;
    });
    private volatile Process activeProcess;
    private volatile Path activeWorkspace;
    private volatile boolean taskActive;
    private volatile boolean closed;
    private volatile Request judgeRequest;
    private volatile String promptPreview = "";

    public LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts,
                          SessionBroker sessions, BooleanSupplier datasetLocked,
                          Predicate<String> explorerHasEvidence, Consumer<String> logger) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, LocalLlmRunner::startProcess, logger,
                configuredExecutables(), explorerHasEvidence, ignored -> {}, true);
    }

    public LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts,
                          SessionBroker sessions, BooleanSupplier datasetLocked,
                          Predicate<String> explorerHasEvidence, Consumer<String> explorerCleanup,
                          Consumer<String> logger) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, LocalLlmRunner::startProcess, logger,
                configuredExecutables(), explorerHasEvidence, explorerCleanup, true);
    }

    LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts, SessionBroker sessions,
                   BooleanSupplier datasetLocked, ProcessLauncher launcher, Consumer<String> logger,
                   Map<Provider, String> executableOverrides) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, launcher, logger,
                executableOverrides, ignored -> true, ignored -> {}, false);
    }

    LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts, SessionBroker sessions,
                   BooleanSupplier datasetLocked, ProcessLauncher launcher, Consumer<String> logger,
                   Map<Provider, String> executableOverrides, Predicate<String> explorerHasEvidence) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, launcher, logger,
                executableOverrides, explorerHasEvidence, ignored -> {}, false);
    }

    LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts, SessionBroker sessions,
                   BooleanSupplier datasetLocked, ProcessLauncher launcher, Consumer<String> logger,
                   Map<Provider, String> executableOverrides, Predicate<String> explorerHasEvidence,
                   Consumer<String> explorerCleanup) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, launcher, logger,
                executableOverrides, explorerHasEvidence, explorerCleanup, false);
    }

    private LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts, SessionBroker sessions,
                           BooleanSupplier datasetLocked, ProcessLauncher launcher, Consumer<String> logger,
                           Map<Provider, String> executableOverrides, Predicate<String> explorerHasEvidence,
                           Consumer<String> explorerCleanup,
                           boolean enforceSubscriptionLogin) {
        this.mcpUrl = requireLoopbackMcp(mcpUrl);
        this.mcpToken = mcpToken == null ? "" : mcpToken;
        this.contexts = contexts;
        this.sessions = sessions;
        this.datasetLocked = datasetLocked == null ? () -> false : datasetLocked;
        this.launcher = launcher;
        this.logger = logger == null ? ignored -> {} : logger;
        this.executableOverrides = Map.copyOf(executableOverrides == null ? Map.of() : executableOverrides);
        this.explorerHasEvidence = explorerHasEvidence == null ? ignored -> false : explorerHasEvidence;
        this.explorerCleanup = explorerCleanup == null ? ignored -> {} : explorerCleanup;
        this.enforceSubscriptionLogin = enforceSubscriptionLogin;
        providerReadiness.set(initialReadiness());
        if (enforceSubscriptionLogin) refreshReadiness();
    }

    public State state() { return state.get(); }

    public List<Activity> activities() { return activities.get(); }

    public String promptPreview() { return promptPreview; }

    public Map<Provider, Boolean> availability() {
        Map<Provider, Boolean> result = new EnumMap<>(Provider.class);
        readiness().forEach((provider, value) -> result.put(provider, value.ready()));
        return Map.copyOf(result);
    }

    public Map<Provider, String> providerMessages() {
        Map<Provider, String> result = new EnumMap<>(Provider.class);
        readiness().forEach((provider, value) -> result.put(provider, value.message()));
        return Map.copyOf(result);
    }

    public Map<Provider, ProviderReadiness> readiness() {
        Map<Provider, ProviderReadiness> current = providerReadiness.get();
        boolean stale = current.values().stream().map(ProviderReadiness::checkedAt)
                .filter(java.util.Objects::nonNull)
                .min(Comparator.naturalOrder())
                .map(value -> value.plusSeconds(PREFLIGHT_TTL_SECONDS).isBefore(Instant.now()))
                .orElse(true);
        if (enforceSubscriptionLogin && stale) refreshReadiness();
        return current;
    }

    public void refreshReadiness() {
        if (!enforceSubscriptionLogin || closed || !readinessRefreshActive.compareAndSet(false, true)) return;
        readinessWorker.execute(() -> {
            try {
                Map<Provider, ProviderReadiness> refreshed = new EnumMap<>(Provider.class);
                for (Provider provider : Provider.values()) refreshed.put(provider, checkProvider(provider));
                providerReadiness.set(Map.copyOf(refreshed));
            } finally {
                readinessRefreshActive.set(false);
            }
        });
    }

    public synchronized State start(Request request) {
        if (closed) throw new IllegalStateException("LLM 실행기가 이미 종료되었습니다.");
        if (taskActive) throw new IllegalStateException("이전 LLM 프로세스가 아직 종료 중입니다.");
        if (request == null || request.provider() == null || request.role() == null) {
            throw new IllegalArgumentException("provider와 role이 필요합니다.");
        }
        if (request.target() == null || request.target().isBlank() || request.exactScope() == null
                || request.exactScope().isEmpty() || !request.exactScope().contains(request.target())) {
            throw new IllegalArgumentException("대상은 현재 FlowScope exact scope 중 하나여야 합니다.");
        }
        ProviderReadiness readiness = enforceSubscriptionLogin ? checkProvider(request.provider())
                : providerReadiness.get().get(request.provider());
        updateReadiness(request.provider(), readiness);
        if (readiness == null || !readiness.ready()) {
            throw new IllegalStateException(readiness == null ? request.provider() + " CLI 준비 상태를 확인하지 못했습니다."
                    : readiness.message());
        }
        String executable = readiness.executable();
        if (contexts.hasActiveRuns()) throw new IllegalStateException("활성 HUMAN/SCANNER/LLM run을 먼저 종료하세요.");
        if (request.role() == Role.EXPLORER && datasetLocked.getAsBoolean()) {
            throw new IllegalStateException("잠긴 dataset에는 새 Explorer를 추가할 수 없습니다. 수집을 초기화해 새 점검을 시작하세요.");
        }
        if (request.role() == Role.JUDGE && !contexts.completedExplorations()
                .containsAll(Set.of(Source.HUMAN, Source.SCANNER, Source.LLM))) {
            throw new IllegalStateException("HUMAN, SCANNER, LLM 탐색 레인을 모두 정상 종료한 뒤 Judge를 시작하세요.");
        }
        String accountId = request.accountId() == null ? "" : request.accountId().trim();
        if (request.role() == Role.EXPLORER && !accountId.isBlank()) requireActiveSession(accountId);

        String runId = request.role() == Role.EXPLORER
                ? "llm-explorer-" + System.currentTimeMillis() + "-" + randomSuffix()
                : "judge-" + UUID.randomUUID();
        String providerSessionId = request.role() == Role.JUDGE && request.provider() == Provider.CLAUDE
                ? UUID.randomUUID().toString() : "";
        Path workspace;
        try { workspace = createWorkspace(); }
        catch (IOException error) { throw new IllegalStateException("LLM 전용 작업공간 생성 실패: " + error.getMessage(), error); }

        if (request.role() == Role.EXPLORER) {
            contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                    Orchestrator.LLM, tool(request.provider()), RunPhase.EXPLORATION, runId,
                    accountId.isBlank() ? null : accountId));
        }
        List<String> command;
        String prompt;
        try {
            writeClaudeMcpConfig(workspace);
            command = command(request.provider(), request.role(), executable, workspace, providerSessionId);
            prompt = prompt(request, runId, accountId);
        } catch (RuntimeException | IOException error) {
            abortActiveLlm();
            deleteWorkspace(workspace);
            throw new IllegalStateException("LLM 실행 준비 실패: " + error.getMessage(), error);
        }

        resetActivities(prompt);
        addActivity("SYSTEM", "실행 준비", request.provider() + " " + request.role()
                + " · " + request.target() + " · " + (accountId.isBlank() ? "비로그인" : accountId), "READY");

        Instant startedAt = Instant.now();
        boolean metadataWarning = request.provider() == Provider.CLAUDE && request.role() == Role.EXPLORER;
        State running = new State(Status.RUNNING, request.provider(), request.role(), runId,
                providerSessionId, startedAt, null, "새 " + request.provider() + " " + request.role() + " 실행 중",
                "", metadataWarning);
        state.set(running);
        if (request.role() == Role.JUDGE) judgeRequest = request;
        activeWorkspace = workspace;
        taskActive = true;
        worker.execute(() -> execute(running, command, workspace, prompt));
        return running;
    }

    public synchronized State followUp(String message) {
        if (closed) throw new IllegalStateException("LLM 실행기가 이미 종료되었습니다.");
        if (taskActive) throw new IllegalStateException("이전 LLM 프로세스가 아직 종료 중입니다.");
        State previous = state.get();
        if (previous.status() != Status.SUCCEEDED || previous.role() != Role.JUDGE
                || previous.provider() == null || previous.providerSessionId().isBlank() || judgeRequest == null) {
            throw new IllegalStateException("재개할 수 있는 완료된 Judge 세션이 없습니다.");
        }
        if (!datasetLocked.getAsBoolean()) throw new IllegalStateException("Judge dataset lock이 더 이상 유효하지 않습니다.");
        String safeMessage = Masking.truncate(Masking.maskSecrets(message == null ? "" : message.trim()), 4_000);
        if (safeMessage.isBlank()) throw new IllegalArgumentException("후속 질문을 입력하세요.");
        ProviderReadiness readiness = enforceSubscriptionLogin ? checkProvider(previous.provider())
                : providerReadiness.get().get(previous.provider());
        updateReadiness(previous.provider(), readiness);
        if (readiness == null || !readiness.ready()) {
            throw new IllegalStateException(readiness == null ? previous.provider() + " CLI 준비 상태를 확인하지 못했습니다."
                    : readiness.message());
        }
        String executable = readiness.executable();
        Path workspace;
        try {
            workspace = createWorkspace();
            writeClaudeMcpConfig(workspace);
        } catch (IOException error) {
            throw new IllegalStateException("Judge 재개 작업공간 생성 실패: " + error.getMessage(), error);
        }
        List<String> command = resumeCommand(previous.provider(), executable, workspace,
                previous.providerSessionId());
        String prompt = "Continue only the existing FlowScope Judge analysis for the already locked dataset. "
                + "Do not start Explorer, change scope, use external web/search, or invent Evidence. "
                + "Use only FlowScope MCP and preserve the server Evidence gate.\n\nOperator follow-up:\n" + safeMessage;
        resetActivities(prompt);
        addActivity("SYSTEM", "Judge 후속 실행 준비", previous.provider() + " · 기존 공급자 세션 재개", "READY");
        State running = new State(Status.RUNNING, previous.provider(), Role.JUDGE, previous.runId(),
                previous.providerSessionId(), Instant.now(), null, "기존 Judge 세션 후속 분석 중", "",
                previous.sessionMetadataMayRemain());
        state.set(running);
        activeWorkspace = workspace;
        taskActive = true;
        worker.execute(() -> execute(running, command, workspace, prompt));
        return running;
    }

    public synchronized State cancel() {
        State current = state.get();
        if (current.status() != Status.RUNNING) return current;
        abortActiveLlm();
        if (current.role() == Role.EXPLORER) contexts.invalidateCompleted(Source.LLM);
        addActivity("SYSTEM", "실행 중단", "사용자가 현재 LLM 실행을 중단했습니다.", "CANCELLED");
        State cancelled = new State(Status.CANCELLED, current.provider(), current.role(), current.runId(),
                current.providerSessionId(), current.startedAt(), Instant.now(), "사용자가 LLM 실행을 중단했습니다.",
                current.outputTail(), current.sessionMetadataMayRemain());
        state.set(cancelled);
        Process process = activeProcess;
        if (process != null && !terminateProcess(process)) {
            State failed = terminationFailed(current);
            state.set(failed);
            return failed;
        }
        return cancelled;
    }

    public synchronized State invalidate() {
        judgeRequest = null;
        if (taskActive) return cancel();
        State previous = state.get();
        if (previous.role() == Role.EXPLORER) cleanupExplorer(previous.runId());
        State idle = State.idle();
        state.set(idle);
        activities.set(List.of());
        activitySequence.set(0);
        promptPreview = "";
        return idle;
    }

    private void execute(State running, List<String> command, Path workspace, String prompt) {
        BoundedOutput output = new BoundedOutput(OUTPUT_LIMIT);
        State terminal = null;
        try {
            if (closed || state.get() != running) return;
            Map<String, String> environment = running.provider() == Provider.CLAUDE
                    ? Map.of("FLOWSCOPE_MCP_TOKEN", mcpToken, "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1")
                    : Map.of("FLOWSCOPE_MCP_TOKEN", mcpToken);
            Process process = launcher.start(running.provider(), command, workspace, environment);
            synchronized (this) {
                if (closed || state.get() != running) {
                    if (!terminateProcess(process)) state.set(terminationFailed(running));
                    return;
                }
                activeProcess = process;
            }
            addActivity("SYSTEM", "CLI 실행", running.provider() + " 구독 CLI 프로세스를 시작했습니다.", "RUNNING");
            try (OutputStream stdin = process.getOutputStream()) {
                stdin.write(prompt.getBytes(StandardCharsets.UTF_8));
            }
            Thread reader = Thread.ofVirtual().start(() -> copy(process.getInputStream(), output, running));
            int exit = process.waitFor();
            reader.join();
            if (state.get().status() == Status.CANCELLED) return;
            String tail = sanitizeOutput(output.text());
            String providerSessionId = running.providerSessionId();
            if (running.provider() == Provider.CODEX && running.role() == Role.JUDGE) {
                Matcher matcher = CODEX_SESSION.matcher(output.sessionText());
                if (matcher.find()) providerSessionId = matcher.group(1);
            }
            RunContextRegistry.Context active = contexts.current(Source.LLM);
            if (active != null) {
                contexts.abort(Source.LLM, active.runId());
                throw new IllegalStateException("LLM이 활성 run을 정상 종료하지 않았습니다: " + active.runId());
            }
            if (exit != 0) throw new IllegalStateException("CLI 종료 코드 " + exit);
            RunContextRegistry.CompletedRun completedLlm = contexts.completedRun(Source.LLM);
            if (running.role() == Role.EXPLORER && (completedLlm == null
                    || !running.runId().equals(completedLlm.runId()))) {
                throw new IllegalStateException("Explorer 완료 레인이 기록되지 않았습니다.");
            }
            if (running.role() == Role.EXPLORER && !explorerHasEvidence.test(running.runId())) {
                contexts.invalidateCompleted(Source.LLM);
                throw new IllegalStateException("Explorer가 이 run의 응답 Evidence를 한 건도 남기지 않았습니다.");
            }
            if (running.role() == Role.EXPLORER) {
                addActivity("EVIDENCE", "응답 Evidence 확인", "현재 Explorer run에 귀속된 응답 Evidence가 확인됐습니다.",
                        "COMPLETED");
            }
            if (running.role() == Role.JUDGE && !datasetLocked.getAsBoolean()) {
                throw new IllegalStateException("Judge가 3-lane dataset lock을 완료하지 않았습니다.");
            }
            terminal = new State(Status.SUCCEEDED, running.provider(), running.role(), running.runId(),
                    providerSessionId, running.startedAt(), Instant.now(),
                    running.role() == Role.EXPLORER ? "독립 LLM 탐색이 정상 종료되었습니다."
                            : running.message().contains("후속") ? "기존 Judge 세션의 후속 분석이 완료되었습니다."
                            : providerSessionId.isBlank() ? "Judge는 완료됐지만 공급자 세션 ID를 확인하지 못해 후속 재개는 사용할 수 없습니다."
                            : "Judge 실행이 완료됐고 후속 재개용 세션을 보존했습니다.",
                    tail, running.sessionMetadataMayRemain());
            addActivity("SYSTEM", "실행 완료", terminal.message(), "SUCCEEDED");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            abortActiveLlm();
            terminal = failedState(running, output.text(), "LLM 실행 스레드가 중단되었습니다.");
        } catch (Exception error) {
            abortActiveLlm();
            terminal = failedState(running, output.text(), error.getMessage());
        } finally {
            if (running.role() == Role.EXPLORER) cleanupExplorer(running.runId());
            activeProcess = null;
            activeWorkspace = null;
            deleteWorkspace(workspace);
            taskActive = false;
            if (terminal != null && state.get().status() != Status.CANCELLED) state.set(terminal);
        }
    }

    private State failedState(State running, String output, String message) {
        if (running.role() == Role.EXPLORER) contexts.invalidateCompleted(Source.LLM);
        String safe = message == null || message.isBlank() ? "LLM 실행 실패" : message;
        logger.accept("FlowScope " + running.provider() + " " + running.role() + " 실패: " + safe);
        addActivity("ERROR", "실행 실패", safe, "FAILED");
        return new State(Status.FAILED, running.provider(), running.role(), running.runId(),
                running.providerSessionId(), running.startedAt(), Instant.now(), safe,
                sanitizeOutput(output), running.sessionMetadataMayRemain());
    }

    private State terminationFailed(State running) {
        String message = "LLM 자식 프로세스 종료를 확인하지 못했습니다. 실행 중인 CLI를 직접 종료한 뒤 다시 시도하세요.";
        logger.accept("FlowScope " + running.provider() + " " + running.role() + " 종료 실패");
        addActivity("ERROR", "프로세스 종료 실패", message, "FAILED");
        return new State(Status.FAILED, running.provider(), running.role(), running.runId(),
                running.providerSessionId(), running.startedAt(), Instant.now(), message,
                running.outputTail(), running.sessionMetadataMayRemain());
    }

    private static boolean terminateProcess(Process process) {
        if (process == null || !process.isAlive()) return true;
        List<ProcessHandle> descendants = processDescendants(process);
        requestTermination(descendants, false);
        process.destroy();
        if (awaitExit(process, descendants)) return true;
        requestTermination(descendants, true);
        process.destroyForcibly();
        return awaitExit(process, descendants);
    }

    private static List<ProcessHandle> processDescendants(Process process) {
        try {
            return process.descendants().sorted(Comparator
                    .comparingInt(LocalLlmRunner::processDepth).reversed()
                    .thenComparingLong(ProcessHandle::pid)).toList();
        }
        catch (UnsupportedOperationException | SecurityException ignored) { return List.of(); }
    }

    private static int processDepth(ProcessHandle handle) {
        int depth = 0;
        ProcessHandle current = handle;
        for (int hop = 0; hop < 64; hop++) {
            try {
                var parent = current.parent();
                if (parent.isEmpty()) return depth;
                depth++;
                current = parent.get();
            } catch (SecurityException ignored) {
                return depth;
            }
        }
        return depth;
    }

    private static void requestTermination(List<ProcessHandle> descendants, boolean forcibly) {
        for (ProcessHandle handle : descendants) {
            if (!handle.isAlive()) continue;
            try {
                if (forcibly) handle.destroyForcibly();
                else handle.destroy();
            } catch (IllegalStateException | UnsupportedOperationException | SecurityException ignored) {
                // 최종 alive 확인이 실패 여부를 결정한다.
            }
        }
    }

    private static boolean awaitExit(Process process, List<ProcessHandle> descendants) {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(PROCESS_TERMINATION_TIMEOUT_MILLIS);
        try {
            process.waitFor(PROCESS_TERMINATION_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS);
            List<CompletableFuture<ProcessHandle>> pending = descendants.stream()
                    .filter(ProcessHandle::isAlive).map(ProcessHandle::onExit).toList();
            if (!pending.isEmpty()) {
                long remaining = deadline - System.nanoTime();
                if (remaining > 0) {
                    CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new))
                            .get(remaining, TimeUnit.NANOSECONDS);
                }
            }
            return !process.isAlive() && descendants.stream().noneMatch(ProcessHandle::isAlive);
        } catch (TimeoutException ignored) {
            return false;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return !process.isAlive() && descendants.stream().noneMatch(ProcessHandle::isAlive);
        } catch (java.util.concurrent.ExecutionException ignored) {
            return false;
        }
    }

    private void cleanupExplorer(String runId) {
        if (runId == null || runId.isBlank()) return;
        try { explorerCleanup.accept(runId); }
        catch (RuntimeException error) {
            logger.accept("FlowScope Explorer browser cleanup failed: " + error.getMessage());
        }
    }

    private List<String> command(Provider provider, Role role, String executable, Path workspace,
                                 String providerSessionId) {
        if (provider == Provider.CODEX) {
            List<String> command = new ArrayList<>(List.of(executable, "-a", "never", "-s", "read-only",
                    "-C", workspace.toString(), "-c", "mcp_servers.flowscope.url=\"" + mcpUrl + "\"",
                    "-c", "mcp_servers.flowscope.bearer_token_env_var=\"FLOWSCOPE_MCP_TOKEN\"",
                    "-c", "mcp_servers.flowscope.required=true",
                    "-c", "shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\"",
                    "-c", "tools.web_search=false"));
            addCodexIsolation(command);
            command.addAll(List.of("exec", "--strict-config", "--skip-git-repo-check",
                    "--ignore-user-config", "--ignore-rules", "--json"));
            if (role == Role.EXPLORER) command.add("--ephemeral");
            command.add("-");
            return List.copyOf(command);
        }
        List<String> allowed = role == Role.EXPLORER ? EXPLORER_TOOLS : JUDGE_TOOLS;
        String toolNames = allowed.stream().map(name -> "mcp__flowscope__" + name)
                .reduce((left, right) -> left + "," + right).orElse("");
        List<String> command = new ArrayList<>(List.of(executable, "-p", "--permission-mode", "dontAsk",
                "--mcp-config", workspace.resolve("mcp.json").toString(), "--strict-mcp-config",
                "--setting-sources", "",
                "--tools", toolNames, "--allowedTools", toolNames, "--output-format", "stream-json",
                "--verbose"));
        if (role == Role.EXPLORER) command.add("--no-session-persistence");
        else command.addAll(List.of("--session-id", providerSessionId));
        return List.copyOf(command);
    }

    private List<String> resumeCommand(Provider provider, String executable, Path workspace,
                                       String providerSessionId) {
        if (provider == Provider.CODEX) {
            List<String> command = new ArrayList<>(List.of(executable, "-a", "never", "-s", "read-only",
                    "-C", workspace.toString(),
                    "-c", "mcp_servers.flowscope.url=\"" + mcpUrl + "\"",
                    "-c", "mcp_servers.flowscope.bearer_token_env_var=\"FLOWSCOPE_MCP_TOKEN\"",
                    "-c", "mcp_servers.flowscope.required=true",
                    "-c", "shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\"",
                    "-c", "tools.web_search=false"));
            addCodexIsolation(command);
            command.addAll(List.of("exec", "resume",
                    "--strict-config", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--json",
                    providerSessionId, "-"));
            return List.copyOf(command);
        }
        String toolNames = JUDGE_TOOLS.stream().map(name -> "mcp__flowscope__" + name)
                .reduce((left, right) -> left + "," + right).orElse("");
        return List.of(executable, "-p", "--permission-mode", "dontAsk", "--mcp-config",
                workspace.resolve("mcp.json").toString(), "--strict-mcp-config", "--setting-sources", "",
                "--tools", toolNames,
                "--allowedTools", toolNames, "--output-format", "stream-json", "--verbose",
                "--resume", providerSessionId);
    }

    private String prompt(Request request, String runId, String accountId) throws IOException {
        String common = resource("/agent-workspace/AGENTS.md");
        String role = resource(request.role() == Role.EXPLORER
                ? "/agent-workspace/prompts/explorer.md" : "/agent-workspace/prompts/judge.md");
        String scopes = String.join("\n", request.exactScope().stream().map(value -> "- " + value).toList());
        String preamble = request.role() == Role.EXPLORER
                ? "FlowScope has already started the isolated EXPLORATION run. Do not call flowscope_begin_llm_run. "
                + "Use exactly run_id=" + runId + " and end it with flowscope_end_run before exiting.\n"
                : "Start as a new Judge context with no Explorer conversation. Lock the dataset before synthesis.\n";
        // 익명 run에 "ANONYMOUS"를 계정 이름처럼 알려 주면 모델이 그 값을 account_id 인자로 보내고 서버가 거부한다.
        String account = request.role() == Role.EXPLORER
                ? (accountId.isBlank()
                        ? "No account is selected for this run; it is anonymous. Never pass account_id.\n"
                        : "Selected Explorer account_id: " + accountId
                                + ". The run already fixes it, so do not pass account_id.\n")
                : "Judge account selection: use only safe account IDs returned by flowscope_list_sessions.\n";
        return "# FlowScope launcher-bound execution\n\n"
                + "This invocation was started by the local FlowScope UI for an explicitly authorized assessment.\n"
                + "Primary entry target: " + request.target() + "\n"
                + "Exact allowed scope:\n" + scopes + "\n"
                + account
                + "Provider: " + request.provider() + "\n"
                + preamble + "Do not resume, inspect, or infer any previous model conversation.\n"
                + "Write every message intended for the operator (progress notes, summaries, the final report) in Korean. "
                + "Keep tool names, URLs, HTTP methods, and Evidence IDs exactly as they are.\n\n"
                + common + "\n\n" + role;
    }

    private void requireActiveSession(String accountId) {
        SessionBroker.SessionView session = sessions.viewForAccount(accountId)
                .orElseThrow(() -> new IllegalArgumentException("선택한 계정의 캡처 세션이 없습니다."));
        if (session.status() != SessionBroker.Status.ACTIVE) {
            throw new IllegalStateException("선택한 계정 세션이 ACTIVE가 아닙니다: " + session.status());
        }
    }

    private void abortActiveLlm() {
        RunContextRegistry.Context active = contexts.current(Source.LLM);
        if (active != null) contexts.abort(Source.LLM, active.runId());
    }

    private Path createWorkspace() throws IOException {
        Path directory = Files.createTempDirectory("flowscope-llm-");
        try {
            Files.setPosixFilePermissions(directory, Set.of(PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE));
        } catch (UnsupportedOperationException ignored) {
            // Windows and non-POSIX filesystems do not expose POSIX permissions.
        }
        return directory;
    }

    private void writeClaudeMcpConfig(Path workspace) throws IOException {
        ObjectNode root = new ObjectMapper().createObjectNode();
        ObjectNode flowscope = root.putObject("mcpServers").putObject("flowscope");
        flowscope.put("type", "http");
        flowscope.put("url", mcpUrl);
        flowscope.putObject("headers").put("Authorization", "Bearer ${FLOWSCOPE_MCP_TOKEN}");
        Files.writeString(workspace.resolve("mcp.json"), root.toString(), StandardCharsets.UTF_8);
    }

    private String resource(String name) throws IOException {
        try (InputStream input = LocalLlmRunner.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("번들 프롬프트가 없습니다: " + name);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private String resolveExecutable(Provider provider) {
        return resolveExecutable(provider, executableOverrides, System.getenv(),
                System.getProperty("os.name", ""), Path.of(System.getProperty("user.home", ".")));
    }

    static String resolveExecutable(Provider provider, Map<Provider, String> overrides,
                                    Map<String, String> environment, String osName, Path userHome) {
        String configured = overrides == null ? null : overrides.get(provider);
        if (configured != null && !configured.isBlank()) return executable(configured);
        String name = provider == Provider.CODEX ? "codex" : "claude";
        for (Path directory : candidateDirectories(environment, osName, userHome)) {
            for (String executableName : executableNames(provider, osName)) {
                Path candidate = directory.resolve(executableName);
                if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toString();
            }
        }
        return null;
    }

    static List<String> executableNames(Provider provider, String osName) {
        String name = provider == Provider.CODEX ? "codex" : "claude";
        return osName != null && osName.toLowerCase(Locale.ROOT).contains("win")
                ? List.of(name + ".exe", name + ".cmd", name + ".bat", name)
                : List.of(name);
    }

    private static List<Path> candidateDirectories(Map<String, String> environment, String osName, Path userHome) {
        Map<String, String> env = environment == null ? Map.of() : environment;
        LinkedHashSet<Path> directories = new LinkedHashSet<>();
        String path = env.entrySet().stream().filter(entry -> "PATH".equalsIgnoreCase(entry.getKey()))
                .map(Map.Entry::getValue).findFirst().orElse("");
        for (String entry : path.split(Pattern.quote(java.io.File.pathSeparator))) addDirectory(directories, entry);
        for (String key : List.of("NVM_BIN", "PNPM_HOME")) addDirectory(directories, env.get(key));
        String bun = env.get("BUN_INSTALL");
        if (bun != null && !bun.isBlank()) addDirectory(directories, Path.of(bun).resolve("bin").toString());
        if (userHome != null) addDirectory(directories, userHome.resolve(".local/bin").toString());
        boolean windows = osName != null && osName.toLowerCase(Locale.ROOT).contains("win");
        if (windows) {
            addDirectory(directories, joinEnv(env.get("LOCALAPPDATA"), "Microsoft", "WinGet", "Links"));
            addDirectory(directories, joinEnv(env.get("APPDATA"), "npm"));
        } else {
            addDirectory(directories, "/opt/homebrew/bin");
            addDirectory(directories, "/usr/local/bin");
            addDirectory(directories, "/usr/bin");
        }
        return List.copyOf(directories);
    }

    private static String joinEnv(String root, String... parts) {
        if (root == null || root.isBlank()) return null;
        Path path = Path.of(root);
        for (String part : parts) path = path.resolve(part);
        return path.toString();
    }

    private static void addDirectory(Set<Path> directories, String value) {
        if (value == null || value.isBlank()) return;
        try { directories.add(Path.of(value).toAbsolutePath().normalize()); }
        catch (RuntimeException ignored) { }
    }

    private Map<Provider, ProviderReadiness> initialReadiness() {
        Map<Provider, ProviderReadiness> initial = new EnumMap<>(Provider.class);
        for (Provider provider : Provider.values()) {
            String executable = resolveExecutable(provider);
            if (executable == null) initial.put(provider, notInstalled(provider));
            else if (!enforceSubscriptionLogin) initial.put(provider, new ProviderReadiness(ReadinessState.READY,
                    true, provider + " 테스트 실행기를 사용할 수 있습니다.", executable, Instant.now()));
            else initial.put(provider, new ProviderReadiness(ReadinessState.CHECKING, false,
                    provider + " CLI 로그인 상태를 자동 확인하는 중입니다.", executable, Instant.now()));
        }
        return Map.copyOf(initial);
    }

    private ProviderReadiness checkProvider(Provider provider) {
        String executable = resolveExecutable(provider);
        if (executable == null) return notInstalled(provider);
        List<String> command = provider == Provider.CODEX
                ? List.of(executable, "login", "status")
                : List.of(executable, "auth", "status", "--json");
        Process process = null;
        BoundedOutput output = new BoundedOutput(PREFLIGHT_OUTPUT_LIMIT);
        try {
            ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
            configureSubscriptionEnvironment(builder.environment(), Map.of());
            configureExecutablePath(builder.environment(), executable);
            process = builder.start();
            Process launched = process;
            Thread reader = Thread.ofVirtual().start(() -> copyBounded(launched.getInputStream(), output));
            if (!process.waitFor(6, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                reader.join(1_000);
                return new ProviderReadiness(ReadinessState.ERROR, false,
                        provider + " 로그인 확인 시간이 초과됐습니다. 터미널에서 CLI 로그인을 확인하세요.",
                        executable, Instant.now());
            }
            reader.join(1_000);
            ProviderReadiness interpreted = interpretStatus(provider, executable, process.exitValue(), output.text());
            if (provider == Provider.CODEX && interpreted.ready() && !codexLoginAvailable()) {
                return new ProviderReadiness(ReadinessState.ERROR, false,
                        "Codex 로그인은 확인됐지만 격리 실행에 필요한 auth.json을 찾지 못했습니다. "
                                + "CODEX_HOME 또는 " + propertyName(provider) + " 설정을 확인하세요.",
                        executable, Instant.now());
            }
            return interpreted;
        } catch (IOException error) {
            return new ProviderReadiness(ReadinessState.ERROR, false,
                    provider + " 로그인 상태 명령을 실행하지 못했습니다: " + safeError(error), executable, Instant.now());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return new ProviderReadiness(ReadinessState.ERROR, false,
                    provider + " 로그인 확인이 중단됐습니다.", executable, Instant.now());
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
        }
    }

    static ProviderReadiness interpretStatus(Provider provider, String executable, int exitCode, String output) {
        Instant checkedAt = Instant.now();
        if (provider == Provider.CODEX) {
            return exitCode == 0
                    ? new ProviderReadiness(ReadinessState.READY, true,
                    "Codex CLI와 ChatGPT 구독 로그인을 자동 확인했습니다.", executable, checkedAt)
                    : new ProviderReadiness(ReadinessState.LOGIN_REQUIRED, false,
                    "Codex CLI는 설치됐지만 로그인이 필요합니다. 터미널에서 codex login을 한 번 실행하세요.",
                    executable, checkedAt);
        }
        try {
            JsonNode status = JSON.readTree(output == null ? "" : output);
            if (exitCode == 0 && status.path("loggedIn").asBoolean(false)) {
                return new ProviderReadiness(ReadinessState.READY, true,
                        "Claude Code CLI와 claude.ai 구독 로그인을 자동 확인했습니다.", executable, checkedAt);
            }
            return new ProviderReadiness(ReadinessState.LOGIN_REQUIRED, false,
                    "Claude Code CLI는 설치됐지만 로그인이 필요합니다. 터미널에서 claude를 실행해 로그인하세요.",
                    executable, checkedAt);
        } catch (IOException ignored) {
            return new ProviderReadiness(ReadinessState.ERROR, false,
                    "Claude 로그인 상태 응답을 해석하지 못했습니다. CLI를 업데이트한 뒤 다시 확인하세요.",
                    executable, checkedAt);
        }
    }

    private static void copyBounded(InputStream input, BoundedOutput output) {
        byte[] buffer = new byte[2_048];
        try (input) {
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        } catch (IOException ignored) { }
    }

    private static String safeError(IOException error) {
        String message = error.getMessage();
        return Masking.truncate(Masking.maskSecrets(message == null ? error.getClass().getSimpleName() : message), 240);
    }

    private static ProviderReadiness notInstalled(Provider provider) {
        return new ProviderReadiness(ReadinessState.NOT_INSTALLED, false,
                provider + " CLI를 찾지 못했습니다. 공식 CLI를 설치한 뒤 다시 확인하세요.", "", Instant.now());
    }

    private void updateReadiness(Provider provider, ProviderReadiness value) {
        if (provider == null || value == null) return;
        providerReadiness.updateAndGet(previous -> {
            Map<Provider, ProviderReadiness> next = new EnumMap<>(Provider.class);
            next.putAll(previous);
            next.put(provider, value);
            return Map.copyOf(next);
        });
    }

    private static boolean codexLoginAvailable() {
        return codexLoginAvailable(codexHome());
    }

    static boolean codexLoginAvailable(Path home) {
        return home != null && Files.isRegularFile(home.resolve("auth.json"));
    }

    private static String executable(String value) {
        try {
            Path path = Path.of(value);
            return Files.isRegularFile(path) && Files.isExecutable(path) ? path.toString() : null;
        } catch (RuntimeException ignored) { return null; }
    }

    private static Map<Provider, String> configuredExecutables() {
        Map<Provider, String> configured = new EnumMap<>(Provider.class);
        for (Provider provider : Provider.values()) {
            String value = System.getProperty(propertyName(provider), "").trim();
            if (!value.isBlank()) configured.put(provider, value);
        }
        return configured;
    }

    private static String propertyName(Provider provider) {
        return provider == Provider.CODEX ? "flowscope.llm.codex.path" : "flowscope.llm.claude.path";
    }

    private static ToolKind tool(Provider provider) {
        return provider == Provider.CODEX ? ToolKind.CODEX : ToolKind.CLAUDE;
    }

    private static Process startProcess(Provider provider, List<String> command, Path directory,
                                        Map<String, String> environment) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true);
        configureSubscriptionEnvironment(builder.environment(), environment);
        configureExecutablePath(builder.environment(), command.getFirst());
        if (provider == Provider.CODEX) {
            builder.environment().put("CODEX_HOME",
                    prepareIsolatedCodexHome(directory, codexHome()).toString());
        }
        return builder.start();
    }

    static void configureSubscriptionEnvironment(Map<String, String> inherited,
                                                 Map<String, String> required) {
        inherited.remove("OPENAI_API_KEY");
        inherited.remove("ANTHROPIC_API_KEY");
        inherited.putAll(required);
    }

    static void configureExecutablePath(Map<String, String> environment, String executable) {
        if (environment == null || executable == null || executable.isBlank()) return;
        Path path;
        try { path = Path.of(executable).toAbsolutePath().normalize(); }
        catch (RuntimeException ignored) { return; }
        Path parent = path.getParent();
        if (parent == null) return;
        String pathKey = environment.keySet().stream()
                .filter(key -> "PATH".equalsIgnoreCase(key))
                .findFirst()
                .orElse("PATH");
        String current = environment.getOrDefault(pathKey, "");
        List<String> entries = new ArrayList<>();
        entries.add(parent.toString());
        if (!current.isBlank()) {
            for (String entry : current.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator))) {
                if (!entry.isBlank() && !entries.contains(entry)) entries.add(entry);
            }
        }
        environment.put(pathKey, String.join(java.io.File.pathSeparator, entries));
    }

    private static void addCodexIsolation(List<String> command) {
        for (String feature : List.of("plugins", "apps", "in_app_browser", "browser_use",
                "browser_use_external", "computer_use", "multi_agent", "goals", "memories",
                "skill_search", "hooks", "unified_exec", "shell_tool", "code_mode", "view_image")) {
            command.addAll(List.of("-c", "features." + feature + "=false"));
        }
    }

    static Path prepareIsolatedCodexHome(Path workspace, Path sourceHome) throws IOException {
        if (workspace == null) throw new IOException("Codex 격리 작업공간이 없습니다.");
        Path sourceAuth = sourceHome == null ? null : sourceHome.resolve("auth.json");
        if (sourceAuth == null || !Files.isRegularFile(sourceAuth)) {
            throw new IOException("Codex 구독 로그인을 찾지 못했습니다. 터미널에서 codex login을 먼저 실행하세요.");
        }
        Path isolatedHome = Files.createDirectory(workspace.resolve("codex-home"));
        setOwnerOnly(isolatedHome, true);
        Path isolatedAuth = isolatedHome.resolve("auth.json");
        try {
            Files.createSymbolicLink(isolatedAuth, sourceAuth.toAbsolutePath().normalize());
        } catch (IOException | UnsupportedOperationException | SecurityException symbolicFailure) {
            try {
                Files.createLink(isolatedAuth, sourceAuth);
            } catch (IOException | UnsupportedOperationException | SecurityException hardLinkFailure) {
                Files.copy(sourceAuth, isolatedAuth);
                setOwnerOnly(isolatedAuth, false);
            }
        }
        return isolatedHome;
    }

    private static Path codexHome() {
        String configured = System.getenv("CODEX_HOME");
        if (configured != null && !configured.isBlank()) {
            try { return Path.of(configured).toAbsolutePath().normalize(); }
            catch (RuntimeException ignored) { }
        }
        String userHome = System.getProperty("user.home", "");
        return userHome.isBlank() ? null : Path.of(userHome, ".codex").toAbsolutePath().normalize();
    }

    private static void setOwnerOnly(Path path, boolean directory) {
        try {
            Files.setPosixFilePermissions(path, directory
                    ? Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE)
                    : Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (IOException | UnsupportedOperationException ignored) {
            // Windows and non-POSIX filesystems do not expose POSIX permissions.
        }
    }

    private static String requireLoopbackMcp(String value) {
        java.net.URI uri = java.net.URI.create(value);
        String host = uri.getHost();
        if (!"http".equalsIgnoreCase(uri.getScheme()) || host == null
                || !(host.equals("127.0.0.1") || host.equalsIgnoreCase("localhost") || host.equals("::1"))) {
            throw new IllegalArgumentException("MCP URL은 localhost HTTP만 허용합니다.");
        }
        return value;
    }

    private void copy(InputStream input, BoundedOutput output, State running) {
        char[] buffer = new char[2048];
        StringBuilder line = new StringBuilder();
        boolean truncated = false;
        try (InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
            int read;
            while ((read = reader.read(buffer)) >= 0) {
                byte[] bytes = new String(buffer, 0, read).getBytes(StandardCharsets.UTF_8);
                output.write(bytes, 0, bytes.length);
                for (int index = 0; index < read; index++) {
                    char value = buffer[index];
                    if (value == '\n') {
                        publishProviderLine(running.provider(), line.toString(), truncated);
                        line.setLength(0);
                        truncated = false;
                    } else if (line.length() < PROVIDER_LINE_LIMIT) {
                        line.append(value);
                    } else {
                        truncated = true;
                    }
                }
                publishLiveOutput(running, output.text());
            }
            if (!line.isEmpty() || truncated) publishProviderLine(running.provider(), line.toString(), truncated);
        } catch (IOException ignored) {
            // Process termination can close the stream while the reader is active.
        }
    }

    private void publishLiveOutput(State running, String value) {
        state.updateAndGet(current -> current.status() == Status.RUNNING
                && current.runId().equals(running.runId())
                ? new State(current.status(), current.provider(), current.role(), current.runId(),
                current.providerSessionId(), current.startedAt(), current.endedAt(), current.message(),
                sanitizeOutput(value), current.sessionMetadataMayRemain()) : current);
    }

    private void publishProviderLine(Provider provider, String rawLine, boolean truncated) {
        String line = rawLine == null ? "" : rawLine.strip();
        if (line.isBlank()) return;
        if (truncated) {
            addActivity("SYSTEM", "공급자 출력 생략", "단일 출력 이벤트가 표시 상한을 넘어 잘랐습니다.", "TRUNCATED");
            return;
        }
        try {
            JsonNode root = JSON.readTree(line);
            if (root == null || !root.isObject()) return;
            if (provider == Provider.CODEX) publishCodexEvent(root);
            else publishClaudeEvent(root);
        } catch (IOException ignored) {
            if (line.toLowerCase(java.util.Locale.ROOT).contains("error") || line.contains("실패")) {
                addActivity("ERROR", "CLI 출력", line, "FAILED");
            }
        }
    }

    private void publishCodexEvent(JsonNode root) {
        String type = root.path("type").asText("");
        if ("thread.started".equals(type)) {
            addActivity("SYSTEM", "새 Codex 세션", "이 실행 전용 공급자 세션을 시작했습니다.", "RUNNING");
        } else if ("turn.started".equals(type)) {
            addActivity("SYSTEM", "탐색 시작", "모델이 FlowScope 실행 지침과 허용 도구로 탐색을 시작했습니다.", "RUNNING");
        } else if ("turn.completed".equals(type)) {
            addActivity("SYSTEM", "모델 작업 완료", "모델 turn이 종료됐습니다. 서버 완료 게이트를 확인합니다.", "COMPLETED");
        } else if (type.startsWith("item.")) {
            JsonNode item = root.path("item");
            String itemType = item.path("type").asText("");
            if (itemType.contains("reasoning")) return;
            if ("agent_message".equals(itemType)) {
                addActivity("MODEL", "LLM 응답", item.path("text").asText(""), "item.completed".equals(type) ? "COMPLETED" : "RUNNING");
            } else if (itemType.contains("tool") || itemType.contains("mcp")) {
                String name = firstText(item, "name", "tool", "server");
                String itemId = item.path("id").asText("");
                boolean completed = "item.completed".equals(type);
                if (!completed && !itemId.isBlank()) toolStarts.put(itemId, Instant.now());
                Long duration = completed ? toolDuration(itemId) : null;
                // Codex는 item.completed 이벤트 안의 item.status("failed")로 도구 실패를 알린다. 이벤트 종류만 보면 실패가 성공으로 찍힌다.
                boolean failed = completed && ("failed".equalsIgnoreCase(item.path("status").asText(""))
                        || !item.path("error").isMissingNode() && !item.path("error").isNull());
                String reason = failed ? toolFailureReason(item) : "";
                addActivity("TOOL", toolLabel(name) + toolDetail(item.path("arguments")),
                        failed ? "실패 · " + (reason.isBlank() ? "사유 없음" : reason)
                                : completed ? "완료" : "호출 중",
                        failed ? "FAILED" : completed ? "COMPLETED" : "RUNNING", duration);
            }
        } else if (type.contains("error") || root.path("error").isObject() || root.path("error").isTextual()) {
            addActivity("ERROR", "Codex 오류", firstText(root, "message", "error"), "FAILED");
        }
    }

    private void publishClaudeEvent(JsonNode root) {
        String type = root.path("type").asText("");
        if ("system".equals(type)) {
            addActivity("SYSTEM", "Claude 실행 준비", root.path("subtype").asText("공급자 초기화"), "RUNNING");
            return;
        }
        if ("assistant".equals(type)) {
            for (JsonNode content : root.path("message").path("content")) {
                String contentType = content.path("type").asText("");
                if ("thinking".equals(contentType)) continue;
                if ("text".equals(contentType)) {
                    addActivity("MODEL", "LLM 응답", content.path("text").asText(""), "RUNNING");
                } else if ("tool_use".equals(contentType)) {
                    String useId = content.path("id").asText("");
                    if (!useId.isBlank()) toolStarts.put(useId, Instant.now());
                    addActivity("TOOL", toolLabel(content.path("name").asText("")) + toolDetail(content.path("input")),
                            "호출 중", "RUNNING");
                }
            }
            return;
        }
        if ("user".equals(type)) {
            for (JsonNode content : root.path("message").path("content")) {
                if ("tool_result".equals(content.path("type").asText(""))) {
                    boolean failed = content.path("is_error").asBoolean(false);
                    String reason = failed ? toolFailureReason(content) : "";
                    addActivity("TOOL", "FlowScope 도구 결과",
                            failed ? "실패 · " + (reason.isBlank() ? "사유 없음" : reason) : "완료",
                            failed ? "FAILED" : "COMPLETED", toolDuration(content.path("tool_use_id").asText("")));
                }
            }
            return;
        }
        if ("result".equals(type)) {
            boolean failed = root.path("is_error").asBoolean(false);
            String result = root.path("result").asText("");
            addActivity(failed ? "ERROR" : "MODEL", failed ? "Claude 오류" : "LLM 최종 응답", result,
                    failed ? "FAILED" : "COMPLETED");
        }
    }

    private void resetActivities(String prompt) {
        activities.set(List.of());
        activitySequence.set(0);
        toolStarts.clear();
        promptPreview = Masking.truncate(Masking.maskSecrets(prompt == null ? "" : prompt), 24_000);
    }

    private void addActivity(String kind, String title, String detail, String activityStatus) {
        addActivity(kind, title, detail, activityStatus, null);
    }

    private void addActivity(String kind, String title, String detail, String activityStatus, Long durationMillis) {
        String safeTitle = Masking.truncate(Masking.maskSecrets(title == null ? "" : title), 160);
        String safeDetail = Masking.truncate(Masking.maskSecrets(detail == null ? "" : detail), ACTIVITY_DETAIL_LIMIT);
        if (safeTitle.isBlank() && safeDetail.isBlank()) return;
        Instant now = Instant.now();
        Instant startedAt = state.get().startedAt();
        long elapsed = startedAt == null ? 0 : Math.max(0, now.toEpochMilli() - startedAt.toEpochMilli());
        Activity activity = new Activity(activitySequence.incrementAndGet(), now, kind,
                safeTitle, safeDetail, activityStatus, elapsed, durationMillis);
        activities.updateAndGet(previous -> {
            if (!previous.isEmpty()) {
                Activity last = previous.getLast();
                if (last.kind().equals(activity.kind()) && last.title().equals(activity.title())
                        && last.detail().equals(activity.detail()) && last.status().equals(activity.status())) {
                    return previous;
                }
            }
            int from = Math.max(0, previous.size() - ACTIVITY_LIMIT + 1);
            List<Activity> next = new ArrayList<>(previous.subList(from, previous.size()));
            next.add(activity);
            return List.copyOf(next);
        });
    }

    /** 도구 이름을 사용자가 읽는 행동명으로 바꾼다. 모르는 이름은 원문을 그대로 둔다. */
    static String toolLabel(String name) {
        String key = name == null ? "" : name.replaceFirst("^mcp__flowscope__", "");
        return switch (key) {
            case "flowscope_target_read" -> "대상 읽기";
            case "flowscope_target_request" -> "대상 요청(쓰기)";
            case "flowscope_list_route_candidates" -> "route 후보 조회";
            case "flowscope_get_status" -> "상태 확인";
            case "flowscope_list_sessions" -> "세션 확인";
            case "flowscope_list_evidence" -> "Evidence 목록 조회";
            case "flowscope_get_evidence" -> "Evidence 조회";
            case "flowscope_browser_navigate" -> "브라우저 열기";
            case "flowscope_browser_snapshot" -> "브라우저 스냅샷";
            case "flowscope_browser_interact" -> "브라우저 조작";
            case "flowscope_browser_close" -> "브라우저 닫기";
            case "flowscope_end_run" -> "실행 종료 요청";
            case "flowscope_begin_llm_run" -> "실행 시작";
            case "flowscope_lock_dataset" -> "데이터셋 잠금";
            case "flowscope_list_candidates" -> "후보 조회";
            case "flowscope_list_assessments" -> "평가 목록 조회";
            case "flowscope_submit_assessment" -> "평가 제출";
            case "flowscope_submit_validation" -> "검증 제출";
            case "flowscope_list_validations" -> "검증 목록 조회";
            case "flowscope_zap_alerts" -> "ZAP 경고 조회";
            case "" -> "FlowScope 도구 호출";
            default -> key;
        };
    }

    /** 인자 중 method와 target(URL)만 보여준다. 헤더·본문·계정은 표시하지 않는다. */
    static String toolDetail(JsonNode arguments) {
        if (arguments == null || !arguments.isObject()) return "";
        String method = arguments.path("method").asText("");
        String target = arguments.path("target").asText("");
        if (target.isBlank()) target = arguments.path("evidence_id").asText("");
        if (method.isBlank() && target.isBlank()) return "";
        return " · " + (method.isBlank() ? "" : method.toUpperCase(Locale.ROOT) + " ") + target;
    }

    /** 실패 결과에서 사유 문장만 뽑는다. {"error":"..."} JSON이면 error 값만, 아니면 텍스트 앞부분. */
    static String toolFailureReason(JsonNode item) {
        List<String> texts = new ArrayList<>();
        String direct = firstText(item, "error");
        if (!direct.isBlank()) texts.add(direct);
        JsonNode content = item.path("result").path("content");
        if (content.isMissingNode()) content = item.path("content");
        if (content.isTextual()) texts.add(content.asText());
        else for (JsonNode part : content) {
            String text = part.path("text").asText("");
            if (!text.isBlank()) texts.add(text);
        }
        for (String text : texts) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{")) {
                try {
                    String error = JSON.readTree(trimmed).path("error").asText("");
                    if (!error.isBlank()) return error;
                } catch (Exception ignored) { /* JSON이 아니면 원문 앞부분을 쓴다 */ }
            }
            if (!trimmed.isBlank()) return Masking.truncate(trimmed, 300);
        }
        return "";
    }

    private Long toolDuration(String id) {
        if (id == null || id.isBlank()) return null;
        Instant started = toolStarts.remove(id);
        return started == null ? null : Math.max(0, Instant.now().toEpochMilli() - started.toEpochMilli());
    }

    private static String firstText(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode value = node.path(field);
            if (value.isTextual() && !value.asText().isBlank()) return value.asText();
            if (value.isObject()) {
                String message = value.path("message").asText("");
                if (!message.isBlank()) return message;
            }
        }
        return "";
    }

    private static String sanitizeOutput(String value) {
        return Masking.truncate(Masking.maskSecrets(value == null ? "" : value), OUTPUT_LIMIT);
    }

    private static String randomSuffix() {
        byte[] bytes = new byte[4];
        new java.security.SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private static void deleteWorkspace(Path directory) {
        if (directory == null || !directory.getFileName().toString().startsWith("flowscope-llm-")) return;
        try (var paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); }
                catch (IOException ignored) { }
            });
        } catch (IOException | RuntimeException ignored) { }
    }

    @Override public synchronized void close() {
        closed = true;
        cancel();
        Process process = activeProcess;
        if (process != null && !terminateProcess(process)) {
            State current = state.get();
            if (current.provider() != null) state.set(terminationFailed(current));
        }
        abortActiveLlm();
        worker.shutdownNow();
        readinessWorker.shutdownNow();
        deleteWorkspace(activeWorkspace);
    }

    private static final class BoundedOutput {
        private static final int PREFIX_LIMIT = 8 * 1024;
        private final int limit;
        private final ByteArrayOutputStream prefix = new ByteArrayOutputStream();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();

        BoundedOutput(int limit) { this.limit = limit; }

        synchronized void write(byte[] value, int offset, int length) {
            int prefixAvailable = Math.min(length, Math.max(0, PREFIX_LIMIT - prefix.size()));
            if (prefixAvailable > 0) prefix.write(value, offset, prefixAvailable);
            int overflow = bytes.size() + length - limit;
            if (overflow > 0) {
                byte[] existing = bytes.toByteArray();
                bytes.reset();
                int keepFrom = Math.min(existing.length, overflow);
                bytes.write(existing, keepFrom, existing.length - keepFrom);
            }
            int available = Math.min(length, Math.max(0, limit - bytes.size()));
            if (available > 0) bytes.write(value, offset + length - available, available);
        }

        synchronized String text() { return bytes.toString(StandardCharsets.UTF_8); }

        synchronized String sessionText() {
            return prefix.toString(StandardCharsets.UTF_8) + "\n" + text();
        }
    }
}
