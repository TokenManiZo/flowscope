package io.flowscope.explorer;

import io.flowscope.integration.SessionBroker;
import io.flowscope.web.FlowScopeWebServer.LlmVerifyState;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * 점검이 끝난 뒤, 보내는 계정(testIdentity) 세션으로 GET 추천을 검증하는 Codex 실행기.
 * Codex를 read-only·ephemeral로 띄워 FlowScope MCP(/mcp)에만 연결한다. 모델 제공자 토큰은 취급하지 않는다.
 */
public final class McpVerificationRunner implements AutoCloseable {
    @FunctionalInterface
    public interface ProcessLauncher {
        Process start(List<String> command, Path directory, Map<String, String> environment) throws IOException;
    }

    private final String mcpUrl;
    private final String mcpToken;
    private final SessionBroker sessions;
    private final ProcessLauncher launcher;
    private final Consumer<String> logger;
    private final io.flowscope.core.McpActivityLog activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-mcp-verify");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicReference<LlmVerifyState> state = new AtomicReference<>(LlmVerifyState.idle());
    private volatile Process activeProcess;
    private volatile boolean running;
    private volatile boolean closed;

    public McpVerificationRunner(String mcpUrl, String mcpToken, SessionBroker sessions,
                                 io.flowscope.core.McpActivityLog activity, Consumer<String> logger) {
        this(mcpUrl, mcpToken, sessions, activity, McpVerificationRunner::startProcess, logger);
    }

    McpVerificationRunner(String mcpUrl, String mcpToken, SessionBroker sessions,
                          io.flowscope.core.McpActivityLog activity,
                          ProcessLauncher launcher, Consumer<String> logger) {
        this.mcpUrl = requireLoopback(mcpUrl);
        this.mcpToken = mcpToken == null ? "" : mcpToken;
        this.sessions = sessions;
        this.activity = activity;
        this.launcher = launcher;
        this.logger = logger == null ? ignored -> {} : logger;
    }

    private void feed(String type, String summary) {
        if (activity != null) activity.record(type, summary, false);
    }

    public LlmVerifyState state() { return state.get(); }

    /** sources: 프런트에서 고른 소스 범위(예: "matrix:bola,bfla;graph:core"). 비면 전체. */
    public synchronized LlmVerifyState start(String sources) {
        if (closed) throw new IllegalStateException("검증 실행기가 종료되었습니다.");
        if (running) throw new IllegalStateException("이전 LLM 판정이 아직 실행 중입니다.");
        String scope = sources == null ? "" : sources.trim();
        String executable = CodexAppServerProvider.resolveExecutable();
        if (executable == null) {
            throw new IllegalStateException("Codex CLI를 찾지 못했습니다. Burp 시작 PATH 또는 flowscope.llm.codex.path를 설정하세요.");
        }
        Path workspace;
        try { workspace = Files.createTempDirectory("flowscope-mcp-verify-"); }
        catch (IOException error) { throw new IllegalStateException("작업공간 생성 실패: " + error.getMessage(), error); }
        List<String> command = command(executable, workspace);
        String prompt = prompt(scope);
        Instant startedAt = Instant.now();
        LlmVerifyState runningState = new LlmVerifyState("RUNNING", scope,
                "LLM이 선택한 소스를 분석하고 GET 추천을 검증하는 중", startedAt.toEpochMilli(), null);
        state.set(runningState);
        running = true;
        feed("info", "LLM 판정 실행 시작 · Codex" + (scope.isBlank() ? "" : " · " + scope));
        worker.execute(() -> execute(runningState, command, workspace, prompt));
        return runningState;
    }

    private void execute(LlmVerifyState runningState, List<String> command, Path workspace, String prompt) {
        try {
            Process process = launcher.start(command, workspace, Map.of("FLOWSCOPE_MCP_TOKEN", mcpToken));
            synchronized (this) {
                if (closed) { process.destroy(); return; }
                activeProcess = process;
            }
            try (OutputStream stdin = process.getOutputStream()) {
                stdin.write(prompt.getBytes(StandardCharsets.UTF_8));
            }
            StringBuilder tail = new StringBuilder();
            Thread reader = drain(process, tail);
            int exit = process.waitFor();
            reader.join();
            if (state.get().status().equals("CANCELLED")) return;
            String output;
            synchronized (tail) { output = tail.toString().strip(); }
            feed("info", "Codex 종료 · exit " + exit + (output.isEmpty() ? " · 출력 없음" : " · 출력 " + output.length() + "자"));
            if (!output.isEmpty()) feed("info", "Codex 출력: " + (output.length() > 1500 ? output.substring(output.length() - 1500) : output));
            LlmVerifyState terminal = exit == 0
                    ? new LlmVerifyState("SUCCEEDED", runningState.accountId(),
                            "LLM 판정이 끝났습니다. 작업 피드를 확인하세요. 도구 호출이 없으면 대상 데이터나 Codex·MCP 연결을 확인하세요.",
                            runningState.startedAt(), Instant.now().toEpochMilli())
                    : new LlmVerifyState("FAILED", runningState.accountId(),
                            "Codex 종료 코드 " + exit + outputSuffix(tail), runningState.startedAt(), Instant.now().toEpochMilli());
            state.set(terminal);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            state.set(failed(runningState, "검증 스레드가 중단되었습니다."));
        } catch (Exception error) {
            state.set(failed(runningState, error.getMessage()));
        } finally {
            activeProcess = null;
            running = false;
            deleteWorkspace(workspace);
        }
    }

    public synchronized LlmVerifyState cancel() {
        LlmVerifyState current = state.get();
        if (!current.status().equals("RUNNING")) return current;
        Process process = activeProcess;
        if (process != null) process.destroy();
        LlmVerifyState cancelled = new LlmVerifyState("CANCELLED", current.accountId(),
                "사용자가 검증을 중단했습니다.", current.startedAt(), Instant.now().toEpochMilli());
        state.set(cancelled);
        return cancelled;
    }

    private LlmVerifyState failed(LlmVerifyState runningState, String message) {
        String safe = message == null || message.isBlank() ? "LLM 검증 실패" : message;
        logger.accept("FlowScope LLM 검증 실패: " + safe);
        return new LlmVerifyState("FAILED", runningState.accountId(), safe,
                runningState.startedAt(), Instant.now().toEpochMilli());
    }

    private List<String> command(String executable, Path workspace) {
        // Codex는 MCP 도구 호출에 승인을 요구한다. -a never면 전부 거부되므로, 비대화형 자동 승인(--approve-for-me)을 쓴다.
        // 도구는 read-only 주석을 달아 두었고, 위험한 재전송·범위는 FlowScope 서버가 GET·exact scope로 다시 막는다.
        return List.of(executable, "-C", workspace.toString(),
                "-c", "mcp_servers.flowscope.url=\"" + mcpUrl + "\"",
                "-c", "mcp_servers.flowscope.bearer_token_env_var=\"FLOWSCOPE_MCP_TOKEN\"",
                "-c", "mcp_servers.flowscope.required=true",
                "-c", "shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\"",
                "-c", "tools.web_search=false", "exec", "--approve-for-me", "--skip-git-repo-check",
                "--ignore-user-config", "--json", "--ephemeral", "-");
    }

    private String prompt(String sources) {
        String scopeLine = sources.isBlank() ? "소스: 전체(판정 매트릭스 + 점검 그래프)"
                : "선택한 소스 범위: " + sources;
        return "# FlowScope LLM 판정 (점검 후 취약점 추천)\n\n"
                + "점검이 끝난 데이터를 보고 IDOR/BOLA/BFLA 취약점을 찾는다. " + scopeLine + "\n\n"
                + "절차:\n"
                + "1. flowscope_get_status로 점검 범위와 보낼 수 있는 계정을 확인한다. accounts에서 usable=true인 계정만 재전송에 쓴다.\n"
                + "   비로그인(account_id=anon)은 로그인이 필요 없고 항상 usable=true다. 세션 상태명(CAPTURING 등)이 아니라 usable 값으로 판단한다.\n"
                + "2. 선택한 소스를 읽는다 — 판정 매트릭스는 flowscope_list_recommendations(scope=bola|bfla|all),"
                + " 점검 그래프는 flowscope_get_graph(scope=core|all).\n"
                + "3. GET 추천(getAutoRunnable=true)을 대상으로, 보내는 계정(testIdentity)이 usable일 때"
                + " flowscope_cross_send_get(evidence_id=basisEvidenceId, account_id=testIdentity)으로 재전송한다."
                + " testIdentity가 anon이면 account_id=anon으로 보낸다. usable이 아니면 건너뛴다.\n"
                + "4. 필요하면 flowscope_get_evidence로 원본 요청/응답을 확인한다.\n"
                + "5. 재전송 응답을 원본과 비교해 취약점 여부를 판단하고,"
                + " flowscope_submit_finding(operation, identity, resource, verdict, confidence, note, evidence_ids)으로 소견을 남긴다.\n\n"
                + "규칙:\n"
                + "- GET만 재전송한다. 쓰기(POST/PUT/PATCH/DELETE)는 실행하지 않는다.\n"
                + "- FlowScope MCP 도구만 사용한다. 외부 네트워크·웹 검색·직접 요청은 금지한다.\n"
                + "- 판정을 확정하지 않는다. verdict는 추천/소견이며 확정은 사람이 한다.\n"
                + "- 범위를 넓히거나 추론하지 않는다. 서버가 거부하는 요청은 그대로 둔다.\n";
    }

    private static final int OUTPUT_TAIL_LIMIT = 2000;

    /** Codex 출력을 소비하면서 끝부분만 제한 길이로 모은다(실패 진단용). */
    private static Thread drain(Process process, StringBuilder tail) {
        return Thread.ofVirtual().start(() -> {
            try (var input = process.getInputStream()) {
                byte[] buffer = new byte[4096];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    synchronized (tail) {
                        tail.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
                        if (tail.length() > OUTPUT_TAIL_LIMIT) tail.delete(0, tail.length() - OUTPUT_TAIL_LIMIT);
                    }
                }
            } catch (IOException ignored) { }
        });
    }

    private static String outputSuffix(StringBuilder tail) {
        String text;
        synchronized (tail) { text = tail.toString().strip(); }
        return text.isEmpty() ? "" : " · 출력: " + text;
    }

    private static Process startProcess(List<String> command, Path directory,
                                        Map<String, String> environment) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true);
        builder.environment().remove("OPENAI_API_KEY");
        builder.environment().remove("ANTHROPIC_API_KEY");
        builder.environment().putAll(environment);
        return builder.start();
    }

    private static String requireLoopback(String value) {
        URI uri = URI.create(value);
        String host = uri.getHost();
        if (!"http".equalsIgnoreCase(uri.getScheme()) || host == null
                || !(host.equals("127.0.0.1") || host.equalsIgnoreCase("localhost") || host.equals("::1"))) {
            throw new IllegalArgumentException("MCP URL은 localhost HTTP만 허용합니다.");
        }
        return value;
    }

    private static void deleteWorkspace(Path directory) {
        if (directory == null || !directory.getFileName().toString().startsWith("flowscope-mcp-verify-")) return;
        try (var paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException | RuntimeException ignored) { }
    }

    @Override public synchronized void close() {
        closed = true;
        cancel();
        Process process = activeProcess;
        if (process != null) process.destroy();
        worker.shutdownNow();
    }
}
