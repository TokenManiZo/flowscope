package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.integration.LoopbackHttpServer;
import org.junit.jupiter.api.Test;

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
import java.util.List;
import java.util.Map;
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
                                    + "\"displayName\":\"GPT-6.1 Sol\",\"isDefault\":true},"
                                    + "{\"id\":\"gpt-5.6-sol\",\"model\":\"gpt-5.6-sol\","
                                    + "\"displayName\":\"GPT-5.6 Sol\",\"isDefault\":false}],\"nextCursor\":null}");
                            case "thread/start" -> reply(message, "{\"thread\":{\"id\":\"t1\"}}");
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
            JsonNode discovery = null;
            for (JsonNode tool : thread.path("params").path("dynamicTools")) {
                if ("flowscope_record_discoveries".equals(tool.path("name").asText())) discovery = tool;
            }
            assertNotNull(discovery);
            String fieldPathHelp = discovery.path("inputSchema").path("properties").path("discoveries")
                    .path("items").path("properties").path("parameters").path("items")
                    .path("properties").path("field_path").path("description").asText();
            assertTrue(fieldPathHelp.contains("/segments/2"), fieldPathHelp);
            assertTrue(fieldPathHelp.contains("{orderId}"), fieldPathHelp);
            assertTrue(capture.done().await(10, TimeUnit.SECONDS));
        }
    }

    private record Capture(CountDownLatch done, AtomicReference<ExplorerProvider.Result> result,
                           AtomicReference<String> failure) {}

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

    @Test
    void partialDiscoveryIsVisibleToTheOperatorForCorrection() throws Exception {
        List<ExplorerProvider.Activity> activities = new CopyOnWriteArrayList<>();
        Capture capture = new Capture(new CountDownLatch(1), new AtomicReference<>(), new AtomicReference<>());
        ExplorerProvider.Listener listener = new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity value) { activities.add(value); }
            @Override public void completed(ExplorerProvider.Result value) { capture.done().countDown(); }
            @Override public void failed(String message) { capture.done().countDown(); }
        };
        try (LoopbackHttpServer gateway = new LoopbackHttpServer(0, request -> new LoopbackHttpServer.Response(
                200, Map.of("Content-Type", "application/json"),
                "{\"success\":true,\"accepted_endpoints\":2,\"rejected_discoveries\":[{\"index\":1,\"reason\":\"Evidence ID invalid\"}],\"rejected_parameters\":[{\"discovery_index\":2,\"parameter_index\":0,\"reason\":\"PATH field_path invalid\"}]}"
                        .getBytes(StandardCharsets.UTF_8)))) {
            gateway.start();
            try (CodexAppServerProvider provider = new CodexAppServerProvider(
                    (command, cwd, environment) -> new FakeCodex((self, turn) -> {
                        try {
                            self.emit("{\"id\":78,\"method\":\"item/tool/call\",\"params\":{"
                                    + "\"tool\":\"flowscope_record_discoveries\",\"arguments\":{}}}");
                            self.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
                        } catch (IOException ignored) { }
                    }), ignored -> { })) {
                ExplorerProvider.Request base = request();
                provider.start(new ExplorerProvider.Request(base.runId(), base.target(), base.exactScope(),
                        base.accountHandles(), "http://127.0.0.1:" + gateway.port() + "/request",
                        "http://127.0.0.1:" + gateway.port() + "/discoveries", base.gatewayToken(),
                        base.prompt()), listener);
                assertTrue(capture.done().await(10, TimeUnit.SECONDS));
                assertNull(capture.failure().get(), capture.failure().get());
            }
        }
        assertTrue(activities.stream().anyMatch(value -> "WARNING".equals(value.kind())
                && value.detail().contains("거부 2건")), activities.toString());
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
