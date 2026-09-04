package io.flowscope.integration;

import io.flowscope.core.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
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
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

final class LocalLlmRunnerTest {
    @TempDir Path tempDirectory;
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
    void resolvesCliFromStandardUserInstallDirectoriesOutsideBurpPath() throws Exception {
        Path userHome = Files.createDirectories(tempDirectory.resolve("home"));
        Path localBin = Files.createDirectories(userHome.resolve(".local/bin"));
        Path codex = localBin.resolve("codex");
        Files.writeString(codex, "test");
        codex.toFile().setExecutable(true);

        String resolved = LocalLlmRunner.resolveExecutable(LocalLlmRunner.Provider.CODEX, Map.of(),
                Map.of("PATH", tempDirectory.resolve("empty").toString()), "Mac OS X", userHome);

        assertEquals(codex.toString(), resolved);
    }

    @Test
    void recognizesWindowsCliLauncherNames() {
        assertEquals(List.of("claude.exe", "claude.cmd", "claude.bat", "claude"),
                LocalLlmRunner.executableNames(LocalLlmRunner.Provider.CLAUDE, "Windows 11"));
        assertEquals(List.of("codex"),
                LocalLlmRunner.executableNames(LocalLlmRunner.Provider.CODEX, "Linux"));
    }

    @Test
    void interpretsOfficialSubscriptionStatusWithoutRetainingProviderIdentity() {
        LocalLlmRunner.ProviderReadiness codex = LocalLlmRunner.interpretStatus(
                LocalLlmRunner.Provider.CODEX, "/usr/local/bin/codex", 0,
                "Logged in using ChatGPT\nuser@example.test");
        LocalLlmRunner.ProviderReadiness claude = LocalLlmRunner.interpretStatus(
                LocalLlmRunner.Provider.CLAUDE, "/usr/local/bin/claude", 0,
                "{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"email\":\"user@example.test\"}");
        LocalLlmRunner.ProviderReadiness loggedOut = LocalLlmRunner.interpretStatus(
                LocalLlmRunner.Provider.CLAUDE, "/usr/local/bin/claude", 1,
                "{\"loggedIn\":false,\"email\":\"user@example.test\"}");

        assertEquals(LocalLlmRunner.ReadinessState.READY, codex.state());
        assertEquals(LocalLlmRunner.ReadinessState.READY, claude.state());
        assertEquals(LocalLlmRunner.ReadinessState.LOGIN_REQUIRED, loggedOut.state());
        assertFalse((codex.message() + claude.message() + loggedOut.message()).contains("user@example.test"));
    }

    @Test
    void startsCodexExplorerAsEphemeralFreshSessionAndRequiresExactRunEnd() throws Exception {
        FakeProcess process = new FakeProcess(0, "{\"type\":\"done\"}\n");
        AtomicReference<List<String>> command = new AtomicReference<>();
        AtomicReference<Map<String, String>> environment = new AtomicReference<>();
        runner = runner((provider, value, directory, env) -> {
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
        assertTrue(command.get().contains("features.skill_search=false"));
        assertTrue(command.get().contains("features.shell_tool=false"));
        assertTrue(command.get().contains("--strict-config"));
        assertTrue(command.get().contains("--ignore-rules"));
        assertFalse(command.get().contains("--search"));
        assertEquals("local-mcp-token", environment.get().get("FLOWSCOPE_MCP_TOKEN"));
        assertFalse(process.prompt().contains("local-mcp-token"));
        assertTrue(process.prompt().contains("Primary entry target: https://api.example.test/v1"));
        assertTrue(process.prompt().contains("run_id=" + started.runId()));
        assertTrue(process.prompt().contains("first target operation must be `flowscope_target_read method=GET`"));
        assertTrue(process.prompt().contains("BROWSER_DISCOVERY_RECOMMENDED"));
        assertTrue(process.prompt().contains("pending_concrete_paths"));

        complete(Source.LLM, started.runId());
        process.release();
        LocalLlmRunner.State completed = awaitFinished();

        assertEquals(LocalLlmRunner.Status.SUCCEEDED, completed.status(), completed.message());
        assertTrue(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void publishesSanitizedLiveCodexActivityWithoutReasoningOrToolPayloads() throws Exception {
        String output = """
                {"type":"thread.started","thread_id":"123e4567-e89b-12d3-a456-426614174000"}
                {"type":"turn.started"}
                {"type":"item.completed","item":{"type":"reasoning","text":"hidden chain of thought"}}
                {"type":"item.started","item":{"type":"mcp_tool_call","name":"flowscope_target_read","arguments":{"authorization":"Bearer secret-token"}}}
                {"type":"item.completed","item":{"type":"agent_message","text":"GET request completed and Evidence was recorded."}}
                {"type":"turn.completed"}
                """;
        FakeProcess process = new FakeProcess(0, output);
        runner = runner((provider, command, directory, environment) -> process);

        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));

        await(() -> runner.activities().stream().anyMatch(activity -> activity.kind().equals("MODEL")));
        await(() -> !runner.state().outputTail().isBlank());
        String activityText = runner.activities().toString();
        // 도구 호출은 원문 이름이 아니라 한국어 행동명으로 보인다. 호출 사실은 남고 인자 원문은 남지 않는다.
        assertTrue(activityText.contains("대상 읽기"), activityText);
        assertFalse(activityText.contains("flowscope_target_read"), activityText);
        assertTrue(activityText.contains("Evidence was recorded"));
        assertFalse(activityText.contains("hidden chain of thought"));
        assertFalse(activityText.contains("secret-token"));
        assertFalse(runner.state().outputTail().contains("secret-token"));
        assertTrue(runner.promptPreview().contains("Primary entry target: https://api.example.test/v1"));
        assertFalse(runner.promptPreview().contains("local-mcp-token"));

        complete(Source.LLM, started.runId());
        process.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
        assertTrue(runner.activities().stream().anyMatch(activity -> activity.kind().equals("EVIDENCE")));
    }

    @Test
    void 도구_호출_실패는_한국어_행동명과_사유와_소요시간으로_피드에_남고_성공으로_찍히지_않는다() throws Exception {
        // 실환경 재현: item.completed 이벤트 안의 item.status="failed"를 무시해 실패가 COMPLETED로 표시됐다.
        String output = """
                {"type":"thread.started","thread_id":"123e4567-e89b-12d3-a456-426614174000"}
                {"type":"turn.started"}
                {"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"flowscope","tool":"flowscope_target_read","arguments":{"method":"GET","target":"/chatbot/genai/state","headers":{"authorization":"Bearer secret-token"}},"status":"in_progress"}}
                {"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"flowscope","tool":"flowscope_target_read","arguments":{"method":"GET","target":"/chatbot/genai/state"},"result":{"content":[{"type":"text","text":"{\\"error\\":\\"target is outside configured scope\\"}"}]},"error":null,"status":"failed"}}
                {"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"flowscope","tool":"flowscope_target_read","arguments":{"method":"GET","target":"https://api.example.test/v1/orders/8"},"status":"in_progress"}}
                {"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"flowscope","tool":"flowscope_target_read","arguments":{"method":"GET","target":"https://api.example.test/v1/orders/8"},"result":{"content":[{"type":"text","text":"{\\"evidence_id\\":\\"ev-1\\",\\"status\\":200}"}]},"error":null,"status":"completed"}}
                {"type":"item.completed","item":{"type":"agent_message","text":"탐색을 마쳤습니다."}}
                {"type":"turn.completed"}
                """;
        FakeProcess process = new FakeProcess(0, output);
        runner = runner((provider, command, directory, environment) -> process);

        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));

        await(() -> runner.activities().stream().anyMatch(activity -> activity.kind().equals("MODEL")));
        List<LocalLlmRunner.Activity> tools = runner.activities().stream()
                .filter(activity -> activity.kind().equals("TOOL")).toList();
        LocalLlmRunner.Activity failed = tools.stream()
                .filter(activity -> activity.title().contains("/chatbot/genai/state") && !activity.status().equals("RUNNING"))
                .findFirst().orElseThrow();
        assertEquals("FAILED", failed.status(), failed.toString());
        assertEquals("대상 읽기 · GET /chatbot/genai/state", failed.title());
        assertTrue(failed.detail().contains("target is outside configured scope"), failed.detail());
        assertFalse(runner.activities().toString().contains("secret-token"));
        LocalLlmRunner.Activity ok = tools.stream()
                .filter(activity -> activity.title().contains("/v1/orders/8") && activity.status().equals("COMPLETED"))
                .findFirst().orElseThrow();
        assertEquals("완료", ok.detail());
        assertTrue(ok.durationMillis() != null && ok.durationMillis() >= 0, "소요시간 없음: " + ok);
        assertTrue(ok.elapsedMillis() >= 0);
        assertTrue(runner.promptPreview().contains("in Korean"));
        // 익명 run에 "ANONYMOUS"를 계정 이름처럼 알려 주면 모델이 그 값을 인자로 보내 거부당한다.
        assertTrue(runner.promptPreview().contains("Never pass account_id"), runner.promptPreview());
        assertFalse(runner.promptPreview().contains("Selected Explorer account_id: ANONYMOUS"));

        complete(Source.LLM, started.runId());
        process.release();
        assertEquals(LocalLlmRunner.Status.SUCCEEDED, awaitFinished().status());
    }

    @Test
    void isolatedCodexHomeExposesLoginButNotUserSkillsOrPlugins() throws Exception {
        Path sourceHome = Files.createDirectories(tempDirectory.resolve("source-codex-home"));
        Files.writeString(sourceHome.resolve("auth.json"), "test-login");
        Files.createDirectories(sourceHome.resolve("skills/ctf-goal"));
        Files.writeString(sourceHome.resolve("skills/ctf-goal/SKILL.md"), "must not be inherited");
        Path workspace = Files.createDirectories(tempDirectory.resolve("workspace"));

        Path isolated = LocalLlmRunner.prepareIsolatedCodexHome(workspace, sourceHome);

        assertEquals("test-login", Files.readString(isolated.resolve("auth.json")));
        assertFalse(Files.exists(isolated.resolve("skills")));
        assertFalse(Files.exists(isolated.resolve("plugins")));
        assertTrue(Files.exists(sourceHome.resolve("skills/ctf-goal/SKILL.md")));
    }

    @Test
    void isolatedCodexHomeFailsClearlyWhenSubscriptionLoginIsMissing() throws Exception {
        Path sourceHome = Files.createDirectories(tempDirectory.resolve("empty-codex-home"));
        Path workspace = Files.createDirectories(tempDirectory.resolve("empty-workspace"));

        IOException error = assertThrows(IOException.class,
                () -> LocalLlmRunner.prepareIsolatedCodexHome(workspace, sourceHome));

        assertTrue(error.getMessage().contains("codex login"));
    }

    @Test
    void distinguishesInstalledCodexFromItsSubscriptionLoginFile() throws Exception {
        Path home = Files.createDirectories(tempDirectory.resolve("codex-readiness"));

        assertFalse(LocalLlmRunner.codexLoginAvailable(home));
        Files.writeString(home.resolve("auth.json"), "test-login");
        assertTrue(LocalLlmRunner.codexLoginAvailable(home));
    }

    @Test
    void failsAndAbortsExplorerWhenCliDoesNotEndItsRun() throws Exception {
        FakeProcess process = new FakeProcess(0, "finished without MCP end\n");
        AtomicReference<String> cleanedRun = new AtomicReference<>();
        runner = runner((provider, command, directory, environment) -> process, ignored -> true,
                cleanedRun::set);

        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        process.release();
        LocalLlmRunner.State completed = awaitFinished();

        assertEquals(LocalLlmRunner.Status.FAILED, completed.status());
        assertTrue(completed.message().contains("정상 종료하지 않았습니다"));
        assertNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
        assertEquals(started.runId(), cleanedRun.get());
    }

    @Test
    void failsClosedWhenRunWasMarkedCompleteWithoutExactResponseEvidence() throws Exception {
        FakeProcess process = new FakeProcess(0, "client claimed completion\n");
        runner = runner((provider, command, directory, environment) -> process, ignored -> false);

        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        complete(Source.LLM, started.runId());
        process.release();

        LocalLlmRunner.State completed = awaitFinished();
        assertEquals(LocalLlmRunner.Status.FAILED, completed.status());
        assertTrue(completed.message().contains("응답 Evidence"));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void cancellationBeforeProcessRegistrationStillStopsTheChild() throws Exception {
        ResistantProcess process = new ResistantProcess();
        CountDownLatch launcherEntered = new CountDownLatch(1);
        CountDownLatch returnProcess = new CountDownLatch(1);
        runner = runner((provider, command, directory, environment) -> {
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
        assertEquals(1, process.gracefulDestroyCount);
        assertEquals(1, process.forcedDestroyCount);
        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.state().status());
        assertNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void cancellationRevokesCompletionWhenClientEndedJustBeforeExit() throws Exception {
        FakeProcess process = new FakeProcess(0, "client ended but process is still running\n");
        runner = runner((provider, command, directory, environment) -> process);
        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        complete(Source.LLM, started.runId());
        assertTrue(contexts.completedExplorations().contains(Source.LLM));

        runner.cancel();

        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.state().status());
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void cancellationForciblyTerminatesChildThatIgnoresGracefulDestroy() throws Exception {
        ResistantProcess process = new ResistantProcess();
        runner = runner((provider, command, directory, environment) -> process);

        runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        await(() -> !process.prompt().isBlank());

        LocalLlmRunner.State cancelled = runner.cancel();

        assertEquals(LocalLlmRunner.Status.CANCELLED, cancelled.status(), cancelled.message());
        assertEquals(1, process.gracefulDestroyCount);
        assertEquals(1, process.forcedDestroyCount);
        assertFalse(process.isAlive());
        assertNull(contexts.current(Source.LLM));
        assertFalse(contexts.completedExplorations().contains(Source.LLM));
    }

    @Test
    void cancellationTerminatesProviderDescendantsBeforeReportingCancelled() throws Exception {
        FakeProcessHandle descendant = new FakeProcessHandle(91_001);
        ResistantProcess process = new ResistantProcess(List.of(descendant));
        runner = runner((provider, command, directory, environment) -> process);

        runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CODEX,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        await(() -> !process.prompt().isBlank());

        LocalLlmRunner.State cancelled = runner.cancel();

        assertEquals(LocalLlmRunner.Status.CANCELLED, cancelled.status(), cancelled.message());
        assertEquals(1, descendant.gracefulDestroyCount);
        assertEquals(1, descendant.forcedDestroyCount);
        assertFalse(descendant.isAlive());
        assertFalse(process.isAlive());
    }

    @Test
    void closeBeforeProcessRegistrationStopsTheChildAndRejectsNewRuns() throws Exception {
        ResistantProcess process = new ResistantProcess();
        CountDownLatch launcherEntered = new CountDownLatch(1);
        CountDownLatch returnProcess = new CountDownLatch(1);
        runner = runner((provider, command, directory, environment) -> {
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
        assertEquals(1, process.gracefulDestroyCount);
        assertEquals(1, process.forcedDestroyCount);
        assertEquals(LocalLlmRunner.Status.CANCELLED, runner.state().status());
        assertThrows(IllegalStateException.class, () -> runner.start(request));
    }

    @Test
    void claudeExplorerUsesNoPersistenceButJudgeKeepsSeparateNamedSession() throws Exception {
        FakeProcess explorer = new FakeProcess(0, "ok\n");
        AtomicReference<List<String>> explorerCommand = new AtomicReference<>();
        AtomicReference<Map<String, String>> explorerEnvironment = new AtomicReference<>();
        runner = runner((provider, command, directory, environment) -> {
            explorerCommand.set(command);
            explorerEnvironment.set(environment);
            return explorer;
        });
        LocalLlmRunner.State started = runner.start(new LocalLlmRunner.Request(LocalLlmRunner.Provider.CLAUDE,
                LocalLlmRunner.Role.EXPLORER, "https://api.example.test/v1",
                List.of("https://api.example.test/v1"), ""));
        complete(Source.LLM, started.runId());
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
        runner = runner((provider, command, directory, environment) -> {
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
        runner = runner((provider, command, directory, environment) -> new FakeProcess(0, ""));

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
        complete(Source.LLM, "llm-run");
        String sessionId = "123e4567-e89b-12d3-a456-426614174000";
        String output = "{\"type\":\"thread.started\",\"thread_id\":\"" + sessionId + "\"}\n"
                + "x".repeat(96 * 1024);
        FakeProcess process = new FakeProcess(0, output);
        FakeProcess followup = new FakeProcess(0, "follow-up complete\n");
        AtomicReference<List<String>> command = new AtomicReference<>();
        java.util.concurrent.atomic.AtomicInteger launches = new java.util.concurrent.atomic.AtomicInteger();
        runner = runner((provider, value, directory, environment) -> {
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
        return runner(launcher, ignored -> true);
    }

    private LocalLlmRunner runner(LocalLlmRunner.ProcessLauncher launcher, Predicate<String> evidence) {
        return runner(launcher, evidence, ignored -> {});
    }

    private LocalLlmRunner runner(LocalLlmRunner.ProcessLauncher launcher, Predicate<String> evidence,
                                  java.util.function.Consumer<String> explorerCleanup) {
        return new LocalLlmRunner("http://127.0.0.1:8787/mcp", "local-mcp-token", contexts, sessions,
                datasetLocked::get, launcher, ignored -> {}, Map.of(LocalLlmRunner.Provider.CODEX, "/bin/sh",
                        LocalLlmRunner.Provider.CLAUDE, "/bin/sh"), evidence, explorerCleanup);
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
            complete(source, runId);
        }
    }

    private void complete(Source source, String runId) {
        SourceDetail detail = switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.ZAP_SPIDER;
            case LLM -> SourceDetail.LLM_EXPLORER;
            default -> SourceDetail.UNKNOWN;
        };
        RequestRecord evidence = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/health-" + source.name().toLowerCase(java.util.Locale.ROOT), 200, "test");
        evidence.hasResponse = true;
        evidence.body = "{\"ok\":true}";
        evidence.sourceDetail = detail;
        evidence.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.SYSTEM;
        evidence.tool = source == Source.LLM ? ToolKind.CODEX
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.BROWSER;
        evidence.phase = RunPhase.EXPLORATION;
        evidence.runId = runId;
        evidence.executionTrust = source == Source.HUMAN
                ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        assertNotNull(LaneCompletionPolicy.complete(contexts, source, runId,
                Pipeline.run(List.of(evidence))));
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

    private static final class ResistantProcess extends Process {
        private final ByteArrayOutputStream prompt = new ByteArrayOutputStream();
        private final CountDownLatch release = new CountDownLatch(1);
        private final List<ProcessHandle> descendants;
        private volatile boolean alive = true;
        private volatile int gracefulDestroyCount;
        private volatile int forcedDestroyCount;

        ResistantProcess() { this(List.of()); }
        ResistantProcess(List<ProcessHandle> descendants) { this.descendants = List.copyOf(descendants); }
        String prompt() { return prompt.toString(java.nio.charset.StandardCharsets.UTF_8); }
        @Override public OutputStream getOutputStream() { return prompt; }
        @Override public InputStream getInputStream() { return InputStream.nullInputStream(); }
        @Override public InputStream getErrorStream() { return InputStream.nullInputStream(); }
        @Override public int waitFor() throws InterruptedException { release.await(); return 0; }
        @Override public boolean waitFor(long timeout, TimeUnit unit) { return !alive; }
        @Override public int exitValue() {
            if (alive) throw new IllegalThreadStateException();
            return 0;
        }
        @Override public void destroy() { gracefulDestroyCount++; }
        @Override public Process destroyForcibly() {
            forcedDestroyCount++;
            alive = false;
            release.countDown();
            return this;
        }
        @Override public boolean isAlive() { return alive; }
        @Override public java.util.stream.Stream<ProcessHandle> descendants() { return descendants.stream(); }
    }

    private static final class FakeProcessHandle implements ProcessHandle {
        private final long pid;
        private final java.util.concurrent.CompletableFuture<ProcessHandle> exit =
                new java.util.concurrent.CompletableFuture<>();
        private volatile boolean alive = true;
        private volatile int gracefulDestroyCount;
        private volatile int forcedDestroyCount;

        FakeProcessHandle(long pid) { this.pid = pid; }
        @Override public long pid() { return pid; }
        @Override public java.util.Optional<ProcessHandle> parent() { return java.util.Optional.empty(); }
        @Override public java.util.stream.Stream<ProcessHandle> children() { return java.util.stream.Stream.empty(); }
        @Override public java.util.stream.Stream<ProcessHandle> descendants() { return java.util.stream.Stream.empty(); }
        @Override public Info info() { return ProcessHandle.current().info(); }
        @Override public java.util.concurrent.CompletableFuture<ProcessHandle> onExit() { return exit; }
        @Override public boolean supportsNormalTermination() { return true; }
        @Override public boolean destroy() { gracefulDestroyCount++; return true; }
        @Override public boolean destroyForcibly() {
            forcedDestroyCount++;
            alive = false;
            exit.complete(this);
            return true;
        }
        @Override public boolean isAlive() { return alive; }
        @Override public int compareTo(ProcessHandle other) { return Long.compare(pid, other.pid()); }
    }
}
