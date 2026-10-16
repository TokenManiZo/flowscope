package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.McpActivityLog;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class McpDiagnosisRunnerTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void usesMcpAndSteersQuestionsWithoutStoppingTheActiveTurn() throws Exception {
        McpActivityLog activity = new McpActivityLog();
        AtomicLong dataset = new AtomicLong(4);
        AtomicReference<List<String>> command = new AtomicReference<>();
        FakeCodex fake = new FakeCodex();
        try (McpDiagnosisRunner runner = new McpDiagnosisRunner("http://127.0.0.1:17777/mcp",
                () -> "test-key", dataset::get, activity, (args, directory, environment) -> {
                    command.set(args);
                    assertEquals("test-key", environment.get("FLOWSCOPE_MCP_TOKEN"));
                    return fake;
                }, () -> "codex-test")) {
            assertEquals("RUNNING", runner.start("", List.of("GET", "POST"), 4).status());
            JsonNode turn = fake.await("turn/start");
            assertTrue(turn.path("params").path("input").get(0).path("text").asText().contains("재전송 허용 메서드: GET, POST"));
            assertEquals("never", turn.path("params").path("approvalPolicy").asText());
            assertTrue(command.get().contains("app-server"));
            assertTrue(command.get().stream().anyMatch(value -> value.contains("mcp_servers.flowscope.url")));
            assertEquals("gpt-5.6-sol", fake.threadModel());

            assertEquals("USER", runner.steer("지금 어떤 근거를 보고 있어?", 4).role());
            JsonNode steer = fake.await("turn/steer");
            assertEquals("turn-1", steer.path("params").path("expectedTurnId").asText());
            assertEquals("지금 어떤 근거를 보고 있어?", steer.path("params").path("input").get(0).path("text").asText());
            await(() -> runner.chat().stream().anyMatch(item -> "DELIVERED".equals(item.status())));
            assertEquals("RUNNING", runner.state().status());

            fake.emit("{\"id\":900,\"method\":\"item/commandExecution/requestApproval\",\"params\":{}}");
            JsonNode decline = fake.awaitReply(900);
            assertEquals("decline", decline.path("result").path("decision").asText());
            fake.emit("{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"agentMessage\",\"text\":\"현재 B 계정 응답을 비교하고 있습니다.\"}}}");
            await(() -> runner.chat().stream().anyMatch(item -> item.text().contains("B 계정 응답")));
            assertEquals("RUNNING", runner.state().status());

            activity.record("read", "수집 근거 조회", false);
            fake.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
            await(() -> !"RUNNING".equals(runner.state().status()));
            assertEquals("SUCCEEDED", runner.state().status());
            assertTrue(fake.isAlive(), "completed diagnosis keeps the project conversation connected");
            assertEquals("USER", runner.steer("이 근거로 추가 검증해줘", 4).role());
            JsonNode nextTurn = fake.await("turn/start");
            assertEquals("t1", nextTurn.path("params").path("threadId").asText());
            assertEquals("이 근거로 추가 검증해줘", nextTurn.path("params").path("input").get(0).path("text").asText());
            await(() -> "CHATTING".equals(runner.state().status()));
            fake.emit("{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"agentMessage\",\"text\":\"추가 검증을 완료했습니다.\"}}}");
            fake.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"completed\"}}}");
            await(() -> "SUCCEEDED".equals(runner.state().status()));
            assertTrue(runner.chat().stream().anyMatch(item -> item.text().contains("추가 검증을 완료")));
        }
    }

    @Test
    void refusesStaleDatasetBeforeLaunchingCodex() {
        AtomicLong dataset = new AtomicLong(8);
        try (McpDiagnosisRunner runner = new McpDiagnosisRunner("http://127.0.0.1:17777/mcp",
                () -> "test-key", dataset::get, new McpActivityLog(),
                (command, directory, environment) -> { throw new AssertionError("must not launch"); },
                () -> "codex-test")) {
            assertThrows(IllegalStateException.class, () -> runner.start("", List.of("GET"), 7));
        }
    }

    @Test
    void reportsActualCodexFailureInsteadOfClaimingMcpEvidenceWasUnavailable() throws Exception {
        McpActivityLog activity = new McpActivityLog();
        FakeCodex fake = new FakeCodex();
        try (McpDiagnosisRunner runner = new McpDiagnosisRunner("http://127.0.0.1:17777/mcp",
                () -> "test-key", () -> 4, activity, (args, directory, environment) -> fake,
                () -> "codex-test")) {
            runner.start("", List.of("GET"), 4);
            fake.await("turn/start");
            runner.steer("진행 상태를 알려줘", 4);
            fake.await("turn/steer");
            fake.emit("{\"method\":\"error\",\"params\":{\"error\":{\"message\":\"{\\\"error\\\":{\\\"message\\\":\\\"Model is not supported for this account\\\"}}\"}}}");
            fake.emit("{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"status\":\"failed\"}}}");
            await(() -> "FAILED".equals(runner.state().status()));
            assertTrue(runner.state().message().contains("Model is not supported"));
            assertTrue(activity.entriesAfter(0).stream().anyMatch(item -> "error".equals(item.type())
                    && item.summary().contains("Model is not supported")));
        }
    }

    private static void await(java.util.function.BooleanSupplier done) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (!done.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(10);
        assertTrue(done.getAsBoolean(), "diagnosis did not progress");
    }

    private static final class FakeCodex extends Process {
        private final PipedOutputStream stdin = new PipedOutputStream();
        private final PipedInputStream input = new PipedInputStream(1 << 16);
        private final PipedOutputStream stdout = new PipedOutputStream();
        private final PipedInputStream output = new PipedInputStream(1 << 16);
        private final PipedOutputStream stderr = new PipedOutputStream();
        private final PipedInputStream errors = new PipedInputStream(1 << 16);
        private final BlockingQueue<JsonNode> written = new LinkedBlockingQueue<>();
        private final Writer response;
        private volatile boolean alive = true;
        private int turns;
        private volatile String threadModel = "";

        FakeCodex() throws IOException {
            stdin.connect(input);
            stdout.connect(output);
            stderr.connect(errors);
            response = new OutputStreamWriter(stdout, StandardCharsets.UTF_8);
            Thread.ofVirtual().start(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        JsonNode message = JSON.readTree(line);
                        written.add(message);
                        String method = message.path("method").asText();
                        if (method.equals("initialize")) reply(message, "{}");
                        if (method.equals("model/list")) reply(message, "{\"data\":[{\"model\":\"gpt-5.6-sol\",\"isDefault\":true}]}");
                        if (method.equals("thread/start")) {
                            threadModel = message.path("params").path("model").asText("");
                            reply(message, "{\"thread\":{\"id\":\"t1\"}}");
                        }
                        if (method.equals("turn/start")) reply(message, "{\"turn\":{\"id\":\"turn-" + ++turns + "\"}}");
                        if (method.equals("turn/steer")) reply(message, "{}");
                    }
                } catch (IOException ignored) { }
            });
        }

        String threadModel() { return threadModel; }

        void emit(String line) throws IOException {
            synchronized (response) { response.write(line + "\n"); response.flush(); }
        }
        private void reply(JsonNode request, String result) throws IOException {
            emit("{\"id\":" + request.path("id").asLong() + ",\"result\":" + result + "}");
        }
        JsonNode await(String method) throws InterruptedException {
            long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
            while (System.nanoTime() < deadline) {
                JsonNode event = written.poll(100, TimeUnit.MILLISECONDS);
                if (event != null && method.equals(event.path("method").asText())) return event;
            }
            fail("missing " + method);
            return null;
        }
        JsonNode awaitReply(long id) throws InterruptedException {
            long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
            while (System.nanoTime() < deadline) {
                JsonNode event = written.poll(100, TimeUnit.MILLISECONDS);
                if (event != null && event.path("id").asLong(-1) == id && !event.has("method")) return event;
            }
            fail("missing reply " + id);
            return null;
        }
        @Override public OutputStream getOutputStream() { return stdin; }
        @Override public InputStream getInputStream() { return output; }
        @Override public InputStream getErrorStream() { return errors; }
        @Override public int waitFor() { return 0; }
        @Override public boolean waitFor(long timeout, TimeUnit unit) { return !alive; }
        @Override public int exitValue() { if (alive) throw new IllegalThreadStateException(); return 0; }
        @Override public void destroy() {
            alive = false;
            try { stdin.close(); stdout.close(); stderr.close(); } catch (IOException ignored) { }
        }
        @Override public boolean isAlive() { return alive; }
    }
}
