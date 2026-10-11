package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.io.Writer;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Drives the real app-server protocol code against a scripted process. These three behaviours are invisible from
 * the outside — a stalled turn, a discarded diagnostic and an oversized final event all look like "it did nothing".
 */
final class CodexAppServerProtocolTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    /** A scripted `codex app-server`: answers the handshake, then plays whatever the test wants. */
    private static final class FakeCodex extends Process {
        private final PipedOutputStream stdin = new PipedOutputStream();
        private final PipedInputStream stdinRead = new PipedInputStream(1 << 16);
        private final PipedOutputStream stdoutWrite = new PipedOutputStream();
        private final PipedInputStream stdout = new PipedInputStream(1 << 16);
        private final PipedOutputStream stderrWrite = new PipedOutputStream();
        private final PipedInputStream stderr = new PipedInputStream(1 << 16);
        private final BlockingQueue<JsonNode> written = new LinkedBlockingQueue<>();
        private final Writer out;
        private final Writer errors;
        private volatile boolean alive = true;

        private FakeCodex(java.util.function.BiConsumer<FakeCodex, JsonNode> onTurnStart) throws IOException {
            stdin.connect(stdinRead);
            stdoutWrite.connect(stdout);
            stderrWrite.connect(stderr);
            out = new OutputStreamWriter(stdoutWrite, StandardCharsets.UTF_8);
            errors = new OutputStreamWriter(stderrWrite, StandardCharsets.UTF_8);
            Thread responder = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(stdinRead, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        JsonNode message = JSON.readTree(line);
                        written.add(message);
                        String method = message.path("method").asText("");
                        switch (method) {
                            case "initialize" -> reply(message, "{}");
                            case "config/read" -> reply(message, "{\"config\":{\"model\":\"gpt-5.6-sol\"}}");
                            case "model/list" -> reply(message, "{\"data\":["
                                    + "{\"id\":\"gpt-6.1-sol\",\"model\":\"gpt-6.1-sol\","
                                    + "\"displayName\":\"GPT-6.1 Sol\",\"isDefault\":true,"
                                    + "\"defaultReasoningEffort\":\"medium\",\"supportedReasoningEfforts\":["
                                    + "{\"reasoningEffort\":\"medium\",\"description\":\"Balanced\"},"
                                    + "{\"reasoningEffort\":\"high\",\"description\":\"Deeper\"}]},"
                                    + "{\"id\":\"gpt-5.6-sol\",\"model\":\"gpt-5.6-sol\","
                                    + "\"displayName\":\"GPT-5.6 Sol\",\"isDefault\":false,"
                                    + "\"defaultReasoningEffort\":\"low\",\"supportedReasoningEfforts\":["
                                    + "{\"reasoningEffort\":\"low\",\"description\":\"Fast\"}]}],\"nextCursor\":null}");
                            case "thread/start" -> reply(message, "{\"thread\":{\"id\":\"t1\"}}");
                            case "thread/resume" -> reply(message, "{\"thread\":{\"id\":\"t1\"}}");
                            case "thread/delete" -> reply(message, "{}");
                            case "turn/start" -> {
                                // The provider waits for this response before it starts reading turn events.
                                reply(message, "{\"turn\":{\"id\":\"turn-1\"}}");
                                onTurnStart.accept(this, message);
                            }
                            default -> { }
                        }
                    }
                } catch (IOException ignored) {
                    // The provider closed its end; the script is over.
                }
            }, "fake-codex");
            responder.setDaemon(true);
            responder.start();
        }

        private void reply(JsonNode request, String result) throws IOException {
            emit("{\"id\":" + request.path("id").asLong() + ",\"result\":" + result + "}");
        }

        void emit(String line) throws IOException {
            synchronized (out) {
                out.write(line);
                out.write("\n");
                out.flush();
            }
        }

        void emitDiagnostic(String line) throws IOException {
            synchronized (errors) {
                errors.write(line);
                errors.write("\n");
                errors.flush();
            }
        }

        /** What the provider sent back, waited for by method name. */
        JsonNode awaitWritten(java.util.function.Predicate<JsonNode> match) throws InterruptedException {
            List<JsonNode> seen = new java.util.ArrayList<>();
            for (int tries = 0; tries < 200; tries++) {
                JsonNode message = written.poll(50, TimeUnit.MILLISECONDS);
                if (message == null) continue;
                seen.add(message);
                if (match.test(message)) return message;
            }
            throw new AssertionError("no matching message; saw " + seen);
        }

        @Override public OutputStream getOutputStream() { return stdin; }
        @Override public InputStream getInputStream() { return stdout; }
        @Override public InputStream getErrorStream() { return stderr; }
        @Override public int waitFor() { return 0; }
        @Override public int exitValue() { return 0; }
        @Override public boolean isAlive() { return alive; }
        @Override public void destroy() {
            alive = false;
            try { stdoutWrite.close(); } catch (IOException ignored) { }
            try { stderrWrite.close(); } catch (IOException ignored) { }
        }
    }

    private static ExplorerProvider.Request request() {
        return new ExplorerProvider.Request("run-1", "https://app.example.test/",
                List.of("https://app.example.test/"), List.of(),
                "http://127.0.0.1:1/request", "http://127.0.0.1:1/discoveries", "token", "prompt");
    }

    @Test
    void listsAccountModelsAndSendsTheChosenModelWithoutChangingCodexDefaults() throws Exception {
        AtomicReference<FakeCodex> runProcess = new AtomicReference<>();
        java.util.concurrent.atomic.AtomicInteger launches = new java.util.concurrent.atomic.AtomicInteger();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    launches.incrementAndGet();
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try { self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}"); }
                        catch (IOException ignored) { }
                    });
                    runProcess.set(fake);
                    return fake;
                }, ignored -> { })) {
            ExplorerProvider.ModelCatalog catalog = provider.models();
            assertEquals("gpt-5.6-sol", catalog.configuredModel());
            assertEquals(List.of("gpt-6.1-sol", "gpt-5.6-sol"),
                    catalog.models().stream().map(ExplorerProvider.ModelOption::id).toList());
            assertTrue(catalog.models().getFirst().recommended());
            assertEquals("medium", catalog.models().getFirst().defaultEffort());
            assertEquals(List.of("medium", "high"), catalog.models().getFirst().efforts().stream()
                    .map(ExplorerProvider.ReasoningOption::effort).toList());
            assertEquals(catalog, provider.models());
            assertEquals(1, launches.get(), "polling must not start another app-server process");

            ExplorerProvider.Request base = request();
            FakeCodex catalogProcess = runProcess.get();
            provider.start(new ExplorerProvider.Request(base.runId(), base.target(), base.exactScope(),
                    base.accountHandles(), base.gatewayUrl(), base.discoveryUrl(), base.gatewayToken(),
                    base.prompt(), "gpt-6.1-sol"), listener(capture));
            for (int tries = 0; tries < 100 && runProcess.get() == catalogProcess; tries++) Thread.sleep(20);
            FakeCodex active = runProcess.get();
            assertNotSame(catalogProcess, active);
            JsonNode thread = active.awaitWritten(value -> "thread/start".equals(value.path("method").asText()));
            assertEquals("gpt-6.1-sol", thread.path("params").path("model").asText());
            assertTrue(capture.done().await(10, TimeUnit.SECONDS));
            assertTrue(thread.path("params").path("ephemeral").asBoolean(false),
                    "the existing one-shot UI must not leave a persistent chat behind");
            assertNotNull(active.awaitWritten(value -> "thread/delete".equals(value.path("method").asText())));
        }
    }

    private record Capture(CountDownLatch done, AtomicReference<ExplorerProvider.Result> result,
                           AtomicReference<String> failure) {}

    @Test
    void chatMessagesUseNewTurnsOnTheSamePersistedThread() throws Exception {
        AtomicReference<FakeCodex> process = new AtomicReference<>();
        List<String> deltas = new CopyOnWriteArrayList<>();
        Capture first = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        Capture second = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try {
                            self.emit("{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"first \"}}");
                            self.emit("{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"answer\"}}");
                            self.emit("{\"method\":\"item/completed\",\"params\":{\"item\":{"
                                    + "\"type\":\"agentMessage\",\"text\":\"first answer\"}}}");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    });
                    process.set(fake);
                    return fake;
                }, ignored -> { })) {
            ExplorerProvider.Request base = request();
            provider.start(new ExplorerProvider.Request(base.runId(), base.target(), base.exactScope(),
                    base.accountHandles(), base.gatewayUrl(), base.discoveryUrl(), base.gatewayToken(),
                    base.prompt(), "gpt-6.1-sol", "high", "", "Find the API"), new ExplorerProvider.Listener() {
                @Override public void activity(ExplorerProvider.Activity activity) { }
                @Override public void assistantDelta(String delta) { deltas.add(delta); }
                @Override public void completed(ExplorerProvider.Result value) {
                    first.result().set(value);
                    first.done().countDown();
                }
                @Override public void failed(String message) {
                    first.failure().set(message);
                    first.done().countDown();
                }
            });
            assertTrue(first.done().await(10, TimeUnit.SECONDS));
            assertNull(first.failure().get());
            assertEquals("first answer", first.result().get().summary());
            assertEquals(List.of("first ", "answer"), deltas);
            assertEquals("t1", first.result().get().threadId());
            FakeCodex firstProcess = process.get();
            JsonNode started = firstProcess.awaitWritten(value -> "thread/start".equals(value.path("method").asText()));
            assertFalse(started.path("params").path("ephemeral").asBoolean(true));
            JsonNode firstTurn = firstProcess.awaitWritten(value -> "turn/start".equals(value.path("method").asText()));
            assertEquals("Find the API", firstTurn.path("params").path("input").get(0).path("text").asText());
            assertEquals("gpt-6.1-sol", firstTurn.path("params").path("model").asText());
            assertEquals("high", firstTurn.path("params").path("effort").asText());
            assertFalse(firstTurn.path("params").has("outputSchema"));

            provider.start(new ExplorerProvider.Request("run-2", base.target(), base.exactScope(),
                    base.accountHandles(), base.gatewayUrl(), base.discoveryUrl(), base.gatewayToken(),
                    base.prompt(), "gpt-6.1-sol", "medium", "t1", "Continue with account B"), listener(second));
            assertTrue(second.done().await(10, TimeUnit.SECONDS));
            assertNull(second.failure().get());
            FakeCodex secondProcess = process.get();
            assertNotSame(firstProcess, secondProcess);
            JsonNode resumed = secondProcess.awaitWritten(value -> "thread/resume".equals(value.path("method").asText()));
            assertEquals("t1", resumed.path("params").path("threadId").asText());
            assertTrue(resumed.path("params").path("dynamicTools").isArray(),
                    "the resumed conversation must bind tools to the new gateway");
            JsonNode nextTurn = secondProcess.awaitWritten(value -> "turn/start".equals(value.path("method").asText()));
            assertEquals("Continue with account B", nextTurn.path("params").path("input").get(0).path("text").asText());
            assertEquals("medium", nextTurn.path("params").path("effort").asText());
        }
    }

    private static ExplorerProvider.Listener listener(Capture capture) {
        return new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity activity) { }
            @Override public void completed(ExplorerProvider.Result value) {
                capture.result().set(value);
                capture.done().countDown();
            }
            @Override public void failed(String message) {
                capture.failure().set(message);
                capture.done().countDown();
            }
        };
    }

    @Test
    void rawCodexThreadKeepsNativeToolsWithoutFlowScopeInstructionsOrTools(@TempDir Path temp) throws Exception {
        AtomicReference<FakeCodex> process = new AtomicReference<>();
        Capture first = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        Capture second = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try {
                            self.emit("{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"agentMessage\",\"text\":\"raw answer\"}}}");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    });
                    process.set(fake);
                    return fake;
                }, ignored -> { })) {
            ExplorerProvider.Request base = request();
            provider.start(new ExplorerProvider.Request(base.runId(), base.target(), base.exactScope(),
                    List.of(), "", "", "", "", "gpt-6.1-sol", "high", "", "Inspect freely",
                    true, 19417, temp.resolve("raw").toString()), listener(first));
            assertTrue(first.done().await(10, TimeUnit.SECONDS));
            assertNull(first.failure().get());
            assertEquals("raw answer", first.result().get().summary());
            FakeCodex firstProcess = process.get();
            JsonNode started = firstProcess.awaitWritten(value -> "thread/start".equals(value.path("method").asText()));
            JsonNode params = started.path("params");
            assertFalse(params.path("ephemeral").asBoolean(true));
            assertFalse(params.has("developerInstructions"));
            assertFalse(params.has("dynamicTools"));
            assertEquals("workspace-write", params.path("sandbox").asText());
            assertEquals("on-request", params.path("approvalPolicy").asText());
            assertEquals("http://127.0.0.1:19417", params.at("/config/shell_environment_policy/set/HTTPS_PROXY").asText());
            assertTrue(params.at("/config/shell_environment_policy/set/ALL_PROXY").isMissingNode());
            JsonNode turn = firstProcess.awaitWritten(value -> "turn/start".equals(value.path("method").asText()));
            assertEquals("Inspect freely",
                    turn.path("params").path("input").get(0).path("text").asText());
            assertFalse(turn.path("params").has("outputSchema"));
            assertTrue(turn.at("/params/sandboxPolicy/networkAccess").asBoolean(false));

            provider.start(new ExplorerProvider.Request("raw-2", base.target(), base.exactScope(),
                    List.of(), "", "", "", "", "gpt-6.1-sol", "high", "t1", "Continue",
                    true, 19418, temp.resolve("raw").toString()), listener(second));
            assertTrue(second.done().await(10, TimeUnit.SECONDS));
            assertNull(second.failure().get());
            JsonNode resumed = process.get().awaitWritten(value -> "thread/resume".equals(value.path("method").asText()));
            assertEquals("t1", resumed.path("params").path("threadId").asText());
            assertFalse(resumed.path("params").has("dynamicTools"));
            assertEquals("http://127.0.0.1:19418", resumed.at("/params/config/shell_environment_policy/set/HTTP_PROXY").asText());
            JsonNode nextTurn = process.get().awaitWritten(value -> "turn/start".equals(value.path("method").asText()));
            assertEquals("Continue", nextTurn.at("/params/input/0/text").asText());
        }
    }

    /** Codex explains itself on stderr. Merging that into the JSONL stream and dropping it leaves no evidence. */
    @Test
    void codexDiagnosticsReachTheLogger() throws Exception {
        List<String> logged = new CopyOnWriteArrayList<>();
        AtomicReference<FakeCodex> codex = new AtomicReference<>();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try {
                            self.emitDiagnostic("WARN skipping prompt hook: not supported yet");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    });
                    codex.set(fake);
                    return fake;
                }, logged::add)) {
            provider.start(request(), listener(capture));
            assertTrue(capture.done().await(10, TimeUnit.SECONDS), "turn never finished");
        }
        assertTrue(logged.stream().anyMatch(line -> line.contains("skipping prompt hook")),
                "stderr diagnostics were lost: " + logged);
    }

    /** An unanswered server request blocks the turn forever, and nothing in this client has a deadline. */
    @Test
    void unsupportedServerRequestsAreRefusedInsteadOfIgnored() throws Exception {
        AtomicReference<FakeCodex> codex = new AtomicReference<>();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try {
                            self.emit("{\"id\":9001,\"method\":\"currentTime/read\",\"params\":{}}");
                            self.emit("{\"id\":9002,\"method\":\"execCommandApproval\",\"params\":{}}");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    });
                    codex.set(fake);
                    return fake;
                }, ignored -> { })) {
            provider.start(request(), listener(capture));
            for (int tries = 0; tries < 100 && codex.get() == null; tries++) Thread.sleep(20);
            assertNotNull(codex.get(), "the provider never launched its process");

            JsonNode refusal = codex.get().awaitWritten(value -> value.path("id").asLong() == 9001);
            assertTrue(refusal.has("error"), "unsupported request must be answered: " + refusal);
            assertEquals(-32601, refusal.path("error").path("code").asInt());

            // The legacy name carries no "requestApproval" substring; a contains() check used to drop it.
            JsonNode legacy = codex.get().awaitWritten(value -> value.path("id").asLong() == 9002);
            assertEquals("acceptForSession", legacy.path("result").path("decision").asText());

            assertTrue(capture.done().await(10, TimeUnit.SECONDS), "turn never finished");
        }
    }

    @Test
    void rawCodexCommandApprovalFollowsTheOperatorDecision(@TempDir Path temp) throws Exception {
        AtomicReference<FakeCodex> codex = new AtomicReference<>();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        List<String> approvals = new CopyOnWriteArrayList<>();
        List<ExplorerProvider.Activity> activities = new CopyOnWriteArrayList<>();
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> {
                    FakeCodex fake = new FakeCodex((self, turn) -> {
                        try {
                            self.emit("{\"id\":9010,\"method\":\"item/commandExecution/requestApproval\","
                                    + "\"params\":{\"command\":\"curl https://app.example.test/\","
                                    + "\"reason\":\"network request\"}}");
                            self.emit("{\"id\":9011,\"method\":\"item/commandExecution/requestApproval\","
                                    + "\"params\":{\"command\":\"curl https://outside.test/\","
                                    + "\"networkApprovalContext\":{}}}");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    });
                    codex.set(fake);
                    return fake;
                }, ignored -> { }, (action, reason) -> {
                    approvals.add(action + " | " + reason);
                    return action.contains("https://app.example.test/");
                })) {
            ExplorerProvider.Request base = request();
            provider.start(new ExplorerProvider.Request("raw-approval", base.target(), base.exactScope(),
                    List.of(), "", "", "", "", "", "", "", "Inspect", true,
                    19417, temp.resolve("raw").toString()), new ExplorerProvider.Listener() {
                @Override public void activity(ExplorerProvider.Activity value) { activities.add(value); }
                @Override public void completed(ExplorerProvider.Result value) { capture.done().countDown(); }
                @Override public void failed(String value) {
                    capture.failure().set(value);
                    capture.done().countDown();
                }
            });
            assertTrue(capture.done().await(10, TimeUnit.SECONDS));
            JsonNode response = codex.get().awaitWritten(value -> value.path("id").asInt() == 9010);
            assertEquals("accept", response.at("/result/decision").asText());
            JsonNode network = codex.get().awaitWritten(value -> value.path("id").asInt() == 9011);
            assertEquals("decline", network.at("/result/decision").asText());
            assertEquals(List.of("curl https://app.example.test/ | network request",
                    "curl https://outside.test/ | 네트워크 권한 요청 · "), approvals);
            assertTrue(activities.stream().anyMatch(item -> item.kind().equals("APPROVAL")
                    && item.status().equals("WAITING")));
            assertTrue(activities.stream().noneMatch(item -> item.detail().contains("outside.test")),
                    "command text must not be duplicated into the persisted activity feed");
        }
    }

    /** A refusal the operator cannot read is no better than silence: it must name the tool and the reason. */
    @Test
    void aRejectedToolCallSaysWhichToolAndWhy() throws Exception {
        List<ExplorerProvider.Activity> activities = new CopyOnWriteArrayList<>();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        ExplorerProvider.Listener listener = new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity value) { activities.add(value); }
            @Override public void completed(ExplorerProvider.Result value) { capture.done().countDown(); }
            @Override public void failed(String message) { capture.done().countDown(); }
        };
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> new FakeCodex((self, turn) -> {
                    try {
                        // The gateway URL points nowhere, so the call fails the way a refused call does.
                        self.emit("{\"id\":77,\"method\":\"item/tool/call\",\"params\":{"
                                + "\"tool\":\"flowscope_browser\",\"arguments\":{}}}");
                        self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                    } catch (IOException ignored) { }
                }), ignored -> { })) {
            provider.start(request(), listener);
            assertTrue(capture.done().await(15, TimeUnit.SECONDS), "turn never finished");
        }
        ExplorerProvider.Activity refusal = activities.stream()
                .filter(value -> "TOOL".equals(value.kind()) && "FAILED".equals(value.status()))
                .findFirst().orElseThrow(() -> new AssertionError("no refusal in " + activities));
        assertTrue(refusal.title().contains("브라우저 조작"), refusal.title());
        assertFalse(refusal.detail().isBlank(), "the reason must reach the operator");
    }

    /** turn/completed carries every item of the turn, so a long run can overflow after all its work is done. */
    @Test
    void anOversizedTurnCompletedEndsTheRunInsteadOfFailingIt() throws Exception {
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        try (CodexAppServerProvider provider = new CodexAppServerProvider(
                (command, cwd, environment) -> new FakeCodex((self, turn) -> {
                    try {
                        self.emit("{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"agentMessage\","
                                + "\"text\":\"{\\\"summary\\\":\\\"탐색 요약\\\",\\\"unresolved\\\":[]}\"}}}");
                        self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\","
                                + "\"items\":\"" + "x".repeat(1024 * 1024 + 64) + "\"}}}");
                    } catch (IOException ignored) { }
                }), ignored -> { })) {
            provider.start(request(), listener(capture));
            assertTrue(capture.done().await(15, TimeUnit.SECONDS), "turn never finished");
        }
        assertNull(capture.failure().get(), "oversized final event must not fail the run");
        assertNotNull(capture.result().get());
        // The summary arrived on its own event earlier, so it survives the oversized envelope.
        assertEquals("탐색 요약", capture.result().get().summary());
    }
}
