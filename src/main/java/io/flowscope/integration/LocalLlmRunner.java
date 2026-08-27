package io.flowscope.integration;

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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Subscription-backed Codex/Claude CLI launcher. Target traffic still flows only through FlowScope MCP. */
public final class LocalLlmRunner implements AutoCloseable {
    public enum Provider { CODEX, CLAUDE }
    public enum Role { EXPLORER, JUDGE }
    public enum Status { IDLE, RUNNING, SUCCEEDED, FAILED, CANCELLED }

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

    @FunctionalInterface
    interface ProcessLauncher {
        Process start(List<String> command, Path directory, Map<String, String> environment) throws IOException;
    }

    private static final int OUTPUT_LIMIT = 64 * 1024;
    private static final Pattern CODEX_SESSION = Pattern.compile("\\\"thread_id\\\"\\s*:\\s*\\\"([0-9a-fA-F-]{16,64})\\\"");
    private static final List<String> EXPLORER_TOOLS = List.of(
            "flowscope_get_status", "flowscope_list_sessions", "flowscope_target_request",
            "flowscope_list_route_candidates", "flowscope_list_evidence", "flowscope_get_evidence",
            "flowscope_end_run");
    private static final List<String> JUDGE_TOOLS = List.of(
            "flowscope_get_status", "flowscope_lock_dataset", "flowscope_list_candidates",
            "flowscope_list_route_candidates", "flowscope_list_evidence", "flowscope_get_evidence",
            "flowscope_list_sessions", "flowscope_zap_alerts", "flowscope_submit_assessment",
            "flowscope_begin_llm_run", "flowscope_target_request", "flowscope_end_run",
            "flowscope_submit_validation", "flowscope_list_validations");

    private final String mcpUrl;
    private final String mcpToken;
    private final RunContextRegistry contexts;
    private final SessionBroker sessions;
    private final ProcessLauncher launcher;
    private final Consumer<String> logger;
    private final BooleanSupplier datasetLocked;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-llm-cli");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicReference<State> state = new AtomicReference<>(State.idle());
    private final Map<Provider, String> executableOverrides;
    private volatile Process activeProcess;
    private volatile Path activeWorkspace;
    private volatile boolean taskActive;
    private volatile boolean closed;
    private volatile Request judgeRequest;

    public LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts,
                          SessionBroker sessions, BooleanSupplier datasetLocked, Consumer<String> logger) {
        this(mcpUrl, mcpToken, contexts, sessions, datasetLocked, LocalLlmRunner::startProcess, logger,
                configuredExecutables());
    }

    LocalLlmRunner(String mcpUrl, String mcpToken, RunContextRegistry contexts, SessionBroker sessions,
                   BooleanSupplier datasetLocked, ProcessLauncher launcher, Consumer<String> logger,
                   Map<Provider, String> executableOverrides) {
        this.mcpUrl = requireLoopbackMcp(mcpUrl);
        this.mcpToken = mcpToken == null ? "" : mcpToken;
        this.contexts = contexts;
        this.sessions = sessions;
        this.datasetLocked = datasetLocked == null ? () -> false : datasetLocked;
        this.launcher = launcher;
        this.logger = logger == null ? ignored -> {} : logger;
        this.executableOverrides = Map.copyOf(executableOverrides == null ? Map.of() : executableOverrides);
    }

    public State state() { return state.get(); }

    public Map<Provider, Boolean> availability() {
        Map<Provider, Boolean> result = new EnumMap<>(Provider.class);
        for (Provider provider : Provider.values()) result.put(provider, resolveExecutable(provider) != null);
        return Map.copyOf(result);
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
        String executable = resolveExecutable(request.provider());
        if (executable == null) {
            throw new IllegalStateException(request.provider() + " CLI를 찾지 못했습니다. Burp 시작 PATH 또는 "
                    + propertyName(request.provider()) + "를 설정하세요.");
        }
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
        String executable = resolveExecutable(previous.provider());
        if (executable == null) throw new IllegalStateException(previous.provider() + " CLI를 찾지 못했습니다.");
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
        Process process = activeProcess;
        if (process != null) process.destroy();
        abortActiveLlm();
        State cancelled = new State(Status.CANCELLED, current.provider(), current.role(), current.runId(),
                current.providerSessionId(), current.startedAt(), Instant.now(), "사용자가 LLM 실행을 중단했습니다.",
                current.outputTail(), current.sessionMetadataMayRemain());
        state.set(cancelled);
        return cancelled;
    }

    public synchronized State invalidate() {
        judgeRequest = null;
        if (taskActive) return cancel();
        State idle = State.idle();
        state.set(idle);
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
            Process process = launcher.start(command, workspace, environment);
            synchronized (this) {
                if (closed || state.get() != running) {
                    process.destroy();
                    return;
                }
                activeProcess = process;
            }
            try (OutputStream stdin = process.getOutputStream()) {
                stdin.write(prompt.getBytes(StandardCharsets.UTF_8));
            }
            Thread reader = Thread.ofVirtual().start(() -> copy(process.getInputStream(), output));
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
            if (running.role() == Role.EXPLORER && !contexts.completedExplorations().contains(Source.LLM)) {
                throw new IllegalStateException("Explorer 완료 레인이 기록되지 않았습니다.");
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
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            abortActiveLlm();
            terminal = failedState(running, output.text(), "LLM 실행 스레드가 중단되었습니다.");
        } catch (Exception error) {
            abortActiveLlm();
            terminal = failedState(running, output.text(), error.getMessage());
        } finally {
            activeProcess = null;
            activeWorkspace = null;
            deleteWorkspace(workspace);
            taskActive = false;
            if (terminal != null && state.get().status() != Status.CANCELLED) state.set(terminal);
        }
    }

    private State failedState(State running, String output, String message) {
        String safe = message == null || message.isBlank() ? "LLM 실행 실패" : message;
        logger.accept("FlowScope " + running.provider() + " " + running.role() + " 실패: " + safe);
        return new State(Status.FAILED, running.provider(), running.role(), running.runId(),
                running.providerSessionId(), running.startedAt(), Instant.now(), safe,
                sanitizeOutput(output), running.sessionMetadataMayRemain());
    }

    private List<String> command(Provider provider, Role role, String executable, Path workspace,
                                 String providerSessionId) {
        if (provider == Provider.CODEX) {
            List<String> command = new ArrayList<>(List.of(executable, "-a", "never", "-s", "read-only",
                    "-C", workspace.toString(), "-c", "mcp_servers.flowscope.url=\"" + mcpUrl + "\"",
                    "-c", "mcp_servers.flowscope.bearer_token_env_var=\"FLOWSCOPE_MCP_TOKEN\"",
                    "-c", "mcp_servers.flowscope.required=true",
                    "-c", "shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\"",
                    "-c", "tools.web_search=false", "exec", "--strict-config", "--skip-git-repo-check",
                    "--ignore-user-config", "--json"));
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
            return List.of(executable, "-a", "never", "-s", "read-only", "-C", workspace.toString(),
                    "-c", "mcp_servers.flowscope.url=\"" + mcpUrl + "\"",
                    "-c", "mcp_servers.flowscope.bearer_token_env_var=\"FLOWSCOPE_MCP_TOKEN\"",
                    "-c", "mcp_servers.flowscope.required=true",
                    "-c", "shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\"",
                    "-c", "tools.web_search=false", "exec", "resume",
                    "--strict-config", "--skip-git-repo-check", "--ignore-user-config", "--json",
                    providerSessionId, "-");
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
        String account = request.role() == Role.EXPLORER
                ? "Selected Explorer account_id: " + (accountId.isBlank() ? "ANONYMOUS" : accountId) + "\n"
                : "Judge account selection: use only safe account IDs returned by flowscope_list_sessions.\n";
        return "# FlowScope launcher-bound execution\n\n"
                + "This invocation was started by the local FlowScope UI for an explicitly authorized assessment.\n"
                + "Primary entry target: " + request.target() + "\n"
                + "Exact allowed scope:\n" + scopes + "\n"
                + account
                + "Provider: " + request.provider() + "\n"
                + preamble + "Do not resume, inspect, or infer any previous model conversation.\n\n"
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
        String configured = executableOverrides.get(provider);
        if (configured != null && !configured.isBlank()) return executable(configured);
        String name = provider == Provider.CODEX ? "codex" : "claude";
        String path = System.getenv().getOrDefault("PATH", "");
        List<String> directories = new ArrayList<>(List.of(path.split(java.io.File.pathSeparator)));
        directories.addAll(List.of("/opt/homebrew/bin", "/usr/local/bin"));
        for (String directory : directories) {
            if (directory == null || directory.isBlank()) continue;
            Path candidate = Path.of(directory, name);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toString();
        }
        return null;
    }

    private static String executable(String value) {
        Path path = Path.of(value);
        return Files.isRegularFile(path) && Files.isExecutable(path) ? path.toString() : null;
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

    private static Process startProcess(List<String> command, Path directory,
                                        Map<String, String> environment) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true);
        configureSubscriptionEnvironment(builder.environment(), environment);
        return builder.start();
    }

    static void configureSubscriptionEnvironment(Map<String, String> inherited,
                                                 Map<String, String> required) {
        inherited.remove("OPENAI_API_KEY");
        inherited.remove("ANTHROPIC_API_KEY");
        inherited.putAll(required);
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

    private static void copy(InputStream input, BoundedOutput output) {
        byte[] buffer = new byte[4096];
        try {
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        } catch (IOException ignored) {
            // Process termination can close the stream while the reader is active.
        }
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
        if (process != null) process.destroy();
        abortActiveLlm();
        worker.shutdownNow();
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
