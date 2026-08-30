package io.flowscope.integration;

import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

final class LocalLlmRunnerTest {
    private final RunContextRegistry contexts = new RunContextRegistry();
    private final SessionBroker sessions = new SessionBroker();
    private final AtomicBoolean datasetLocked = new AtomicBoolean();
    private LocalLlmRunner runner;

    @AfterEach void close() {
        if (runner != null) runner.close();
        sessions.close();
    }

    @Test
    void removesDirectApiKeysFromSubscriptionCliEnvironment() {
        Map<String, String> environment = new HashMap<>(Map.of(
                "OPENAI_API_KEY", "must-not-pass",
                "ANTHROPIC_API_KEY", "must-not-pass",
                "PATH", "/usr/bin"));

        LocalLlmRunner.configureSubscriptionEnvironment(environment,
                Map.of("FLOWSCOPE_MCP_TOKEN", "local-token"));

        assertFalse(environment.containsKey("OPENAI_API_KEY"));
        assertFalse(environment.containsKey("ANTHROPIC_API_KEY"));
        assertEquals("/usr/bin", environment.get("PATH"));
        assertEquals("local-token", environment.get("FLOWSCOPE_MCP_TOKEN"));
    }

    @Test
    void prependsResolvedCliDirectorySoEnvShebangCanFindNodeFromBurp() {
        Map<String, String> environment = new HashMap<>(Map.of("PATH", "/usr/bin"));

        LocalLlmRunner.configureExecutablePath(environment, "/opt/homebrew/bin/codex");

        assertEquals("/opt/homebrew/bin" + java.io.File.pathSeparator + "/usr/bin",
                environment.get("PATH"));
        LocalLlmRunner.configureExecutablePath(environment, "/opt/homebrew/bin/codex");
        assertEquals("/opt/homebrew/bin" + java.io.File.pathSeparator + "/usr/bin",
                environment.get("PATH"));
    }

    @Test
    void preservesExistingPathKeyCasing() {
        Map<String, String> environment = new HashMap<>(Map.of("Path", "/usr/bin"));

        LocalLlmRunner.configureExecutablePath(environment, "/opt/homebrew/bin/codex");

        assertFalse(environment.containsKey("PATH"));
        assertEquals("/opt/homebrew/bin" + java.io.File.pathSeparator + "/usr/bin",
                environment.get("Path"));
    }

    @Test
    void startsCodexExplorerAsEphemeralFreshSessionAndRequiresExactRunEnd() throws Exception {
        FakeProcess process = new FakeProcess(0, "{\"type\":\"done\"}\n");
        AtomicReference<List<String>> command = new AtomicReference<>();
        AtomicReference<Map<String, String>> environment = new AtomicReference<>();
        runner = runner((value, directory, env) -> {
            command.set(value);
            environment.set(env);
            return process;
        });

        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));

        assertEquals(started.runId(), contexts.current(Source.LLM).runId());
        await(() -> command.get() != null && process.prompt().contains("run_id=" + started.runId()));
        assertTrue(command.get().contains("--ephemeral"));
        assertFalse(command.get().contains("resume"));
        assertTrue(command.get().contains("shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\""));
        assertTrue(command.get().contains("tools.web_search=false"));
        assertTrue(command.get().contains("features.plugins=false"));
        assertTrue(command.get().contains("features.browser_use=false"));
        assertTrue(command.get().contains("--strict-config"));
        assertFalse(command.get().contains("--search"));
        assertEquals("local-mcp-token", environment.get().get("FLOWSCOPE_MCP_TOKEN"));
        assertFalse(process.prompt().contains("local-mcp-token"));
        assertTrue(process.prompt().contains("Primary entry target: https://api.example.test/v1"));
        assertTrue(process.prompt().contains("run_id=" + started.runId()));

        assertTrue(contexts.clear(Source.LLM, started.runId()));
        process.release();
        LocalLlmRunner.State completed = awaitFinished();

        assertEquals(LocalLlmRunner.Status.SUCCEEDED, completed.status(), completed.message());
        assertTrue(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void disablesDiscoveredCodexSkillsWithoutChangingUserFiles() throws Exception {
        Path home = Files.createTempDirectory("flowscope-codex-home-");
        Path first = Files.createDirectories(home.resolve("skills/first")).resolve("SKILL.md");
        Path second = Files.createDirectories(home.resolve("plugins/cache/example/skills/second"))
                .resolve("SKILL.md");
        Files.writeString(first, "first");
        Files.writeString(second, "second");
        try {
            String config = LocalLlmRunner.disabledCodexSkills(home);

            assertTrue(config.contains(first.toAbsolutePath().normalize().toString()));
            assertTrue(config.contains(second.toAbsolutePath().normalize().toString()));
            assertTrue(config.contains("enabled=false"));
            assertTrue(Files.exists(first));
            assertTrue(Files.exists(second));
        } finally {
            try (var paths = Files.walk(home)) {
                paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                    try { Files.deleteIfExists(path); }
                    catch (java.io.IOException ignored) { }
                });
            }
        }
    }

    @Test
    void failsAndAbortsExplorerWhenCliDoesNotEndItsRun() throws Exception {
        FakeProcess process = new FakeProcess(0, "finished without MCP end\n");
        runner = runner((command, directory, environment) -> process);

        runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        process.release();
        LocalLlmRunner.State completed = awaitFinished();

        assertEquals(LocalLlmRunner.Status.FAILED, completed.status());
        assertTrue(completed.message().contains("정상 종료하지 않았습니다"));
        assertNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void cancellationBeforeProcessRegistrationStillStopsTheChild() throws Exception {
        FakeProcess process = new FakeProcess(0, "must not continue\n");
        CountDownLatch launcherEntered = new CountDownLatch(1);
        CountDownLatch returnProcess = new CountDownLatch(1);
        runner = runner((command, directory, environment) -> {
            launcherEntered.countDown();
            try {
                if (!returnProcess.await(3, TimeUnit.SECONDS)) throw new java.io.IOException("test launcher timeout");
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new java.io.IOException("test launcher interrupted", error);
            }
            return process;
        });

        runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        assertTrue(launcherEntered.await(3, TimeUnit.SECONDS));
        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.cancel().status());
        returnProcess.countDown();

        await(() -> !process.isAlive());
        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.state().status());
        assertNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void closeBeforeProcessRegistrationStopsTheChildAndRejectsNewRuns() throws Exception {
        FakeProcess process = new FakeProcess(0, "must not survive extension unload\n");
        CountDownLatch launcherEntered = new CountDownLatch(1);
        CountDownLatch returnProcess = new CountDownLatch(1);
        runner = runner((command, directory, environment) -> {
            launcherEntered.countDown();
            try {
                if (!returnProcess.await(3, TimeUnit.SECONDS)) throw new java.io.IOException("test launcher timeout");
            } catch (InterruptedException ignored) {
                try {
                    if (!returnProcess.await(3, TimeUnit.SECONDS)) throw new java.io.IOException("test launcher timeout");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new java.io.IOException("test launcher interrupted twice", error);
                }
            }
            return process;
        });

        LocalLlmRunner.Request request = new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), "");
        runner.start(request);
        assertTrue(launcherEntered.await(3, TimeUnit.SECONDS));
        runner.close();
        returnProcess.countDown();

        await(() -> !process.isAlive());
        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.state().status());
        assertThrows(IllegalStateException.class, () -> runner.start(request));
    }

    @Test
    void claudeExplorerUsesNoPersistenceButJudgeKeepsSeparateNamedSession() throws Exception {
        FakeProcess explorer = new FakeProcess(0, "ok\n");
        AtomicReference<List<String>> explorerCommand = new AtomicReference<>();
        AtomicReference<Map<String, String>> explorerEnvironment = new AtomicReference<>();
        runner = runner((command, directory, environment) -> {
            explorerCommand.set(command);
            explorerEnvironment.set(environment);
            return explorer;
        });
        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CLAUDE,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        assertTrue(contexts.clear(Source.LLM, started.runId()));
        explorer.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
        assertTrue(explorerCommand.get().contains("--no-session-persistence"));
        int settingSources = explorerCommand.get().indexOf("--setting-sources");
        assertTrue(settingSources >= 0);
        assertEquals("", explorerCommand.get().get(settingSources + 1));
        assertEquals("1", explorerEnvironment.get().get("CLAUDE_CODE_DISABLE_AUTO_MEMORY"));

        completeOtherLanes();
        runner.close();
        FakeProcess judge = new FakeProcess(0, "judge complete\n");
        FakeProcess followup = new FakeProcess(0, "follow-up complete\n");
        AtomicReference<List<String>> judgeCommand = new AtomicReference<>();
        java.util.concurrent.atomic.AtomicInteger launches = new java.util.concurrent.atomic.AtomicInteger();
        runner = runner((command, directory, environment) -> {
            judgeCommand.set(command);
            return launches.getAndIncrement() == 0 ? judge : followup;
        });
        LocalLlmRunner.State judgeStarted = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CLAUDE,
                LocalLlmRunner.Role.JUDGE, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        datasetLocked.set(true);
        judge.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
        assertFalse(judgeCommand.get().contains("--no-session-persistence"));
        int sessionIndex = judgeCommand.get().indexOf("--session-id");
        assertTrue(sessionIndex >= 0);
        assertEquals(judgeStarted.providerSessionId(), judgeCommand.get().get(sessionIndex + 1));
        assertFalse(judgeStarted.providerSessionId().isBlank());

        runner.followUp("Explain only the accepted Evidence bundle");
        await(() -> judgeCommand.get().contains("--resume"));
        int resumeIndex = judgeCommand.get().indexOf("--resume");
        assertEquals(judgeStarted.providerSessionId(), judgeCommand.get().get(resumeIndex + 1));
        assertFalse(judgeCommand.get().contains("--session-id"));
        followup.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
        assertEquals(LocalLlmRunner.Status.IDLE, runner.invalidate().status());
        assertThrows(IllegalStateException.class, () -> runner.followUp("stale Judge must not resume"));
    }

    @Test
    void rejectsJudgeBeforeAllThreeCompletedLanesAndRejectsInactiveAccount() {
        runner = runner((command, directory, environment) -> new FakeProcess(0, ""));

        IllegalStateException judge = assertThrows(IllegalStateException.class, () -> runner.start(
                new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX, LocalLlmRunner.Role.JUDGE,
                        "https://api.example.test/v1", List.of("https://api.example.test/v1"), "")));
        assertTrue(judge.getMessage().contains("모두 정상 종료"));

        assertThrows(IllegalArgumentException.class, () -> runner.start(
                new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX, LocalLlmRunner.Role.EXPLORER,
                        "https://api.example.test/v1", List.of("https://api.example.test/v1"), "user-a")));

        datasetLocked.set(true);
        IllegalStateException locked = assertThrows(IllegalStateException.class, () -> runner.start(
                new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX, LocalLlmRunner.Role.EXPLORER,
                        "https://api.example.test/v1", List.of("https://api.example.test/v1"), "")));
        assertTrue(locked.getMessage().contains("잠긴 dataset"));
    }

    @Test
    void preservesCodexJudgeSessionIdWhenOutputTailOverflows() throws Exception {
        completeOtherLanes();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(
                io.flowscope.core.SourceDetail.LLM_EXPLORER, io.flowscope.core.Orchestrator.LLM,
                io.flowscope.core.ToolKind.CODEX, io.flowscope.core.RunPhase.EXPLORATION, "llm-run"));
        assertTrue(contexts.clear(Source.LLM, "llm-run"));
        String sessionId = "123e4567-e89b-12d3-a456-426614174000";
        String output = "{\"type\":\"thread.started\",\"thread_id\":\"" + sessionId + "\"}\n"
                + "x".repeat(96 * 1024);
        FakeProcess process = new FakeProcess(0, output);
        FakeProcess followup = new FakeProcess(0, "follow-up complete\n");
        AtomicReference<List<String>> command = new AtomicReference<>();
        java.util.concurrent.atomic.AtomicInteger launches = new java.util.concurrent.atomic.AtomicInteger();
        runner = runner((value, directory, environment) -> {
            command.set(value);
            return launches.getAndIncrement() == 0 ? process : followup;
        });

        runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.JUDGE, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        datasetLocked.set(true);
        process.release();

        LocalLlmRunner.State completed = awaitFinished();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, completed.status(), completed.message());
        assertEquals(sessionId, completed.providerSessionId());
        assertTrue(completed.outputTail().length() <= 64 * 1024);

        runner.followUp("Explain the accepted Evidence only");
        await(() -> command.get().contains("resume"));
        assertTrue(command.get().contains("shell_environment_policy.filters.FLOWSCOPE_MCP_TOKEN=\"exclude\""));
        assertTrue(command.get().contains("tools.web_search=false"));
        int resumeIndex = command.get().indexOf("resume");
        assertEquals(sessionId, command.get().get(command.get().size() - 2));
        assertTrue(resumeIndex >= 0);
        followup.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
    }

    private LocalLlmRunner runner(LocalLlmRunner.ProcessLauncher launcher) {
        return new LocalLlmRunner("http://127.0.0.1:8787/mcp", "local-mcp-token", contexts, sessions,
                datasetLocked::get, launcher, ignored -> {}, Map.of(LocalLlmRunner.Provider.CODEX, "/bin/sh",
                        LocalLlmRunner.Provider.CLAUDE, "/bin/sh"));
    }

    private void completeOtherLanes() {
        for (Source source : List.of(Source.HUMAN, Source.SCANNER)) {
            String runId = source.name().toLowerCase() + "-run";
            contexts.activate(source, new RunContextRegistry.Context(
                    source == Source.HUMAN ? io.flowscope.core.SourceDetail.BROWSER
                            : io.flowscope.core.SourceDetail.ZAP_SPIDER,
                    io.flowscope.core.Orchestrator.SYSTEM,
                    source == Source.HUMAN ? io.flowscope.core.ToolKind.BROWSER : io.flowscope.core.ToolKind.ZAP,
                    io.flowscope.core.RunPhase.EXPLORATION, runId));
            assertTrue(contexts.clear(source, runId));
        }
    }

    private LocalLlmRunner.State awaitFinished() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        LocalLlmRunner.State current;
        do {
            current = runner.state();
            if (current.status() != LocalLlmRunner.Status.RUNNING) return current;
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        return fail("runner did not finish");
    }

    private static void await(java.util.function.BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(10);
        assertTrue(condition.getAsBoolean(), "condition did not become true");
    }

    private static final class FakeProcess extends Process {
        private final ByteArrayOutputStream prompt = new ByteArrayOutputStream();
        private final InputStream output;
        private final int exitCode;
        private final CountDownLatch release = new CountDownLatch(1);
        private volatile boolean alive = true;

        FakeProcess(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = new ByteArrayInputStream(output.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }

        String prompt() { return prompt.toString(java.nio.charset.StandardCharsets.UTF_8); }
        void release() { alive = false; release.countDown(); }
        @Override public OutputStream getOutputStream() { return prompt; }
        @Override public InputStream getInputStream() { return output; }
        @Override public InputStream getErrorStream() { return InputStream.nullInputStream(); }
        @Override public int waitFor() throws InterruptedException { release.await(); return exitCode; }
        @Override public boolean waitFor(long timeout, TimeUnit unit) throws InterruptedException {
            return release.await(timeout, unit);
        }
        @Override public int exitValue() {
            if (alive) throw new IllegalThreadStateException();
            return exitCode;
        }
        @Override public void destroy() { release(); }
        @Override public Process destroyForcibly() { release(); return this; }
        @Override public boolean isAlive() { return alive; }
    }
}
