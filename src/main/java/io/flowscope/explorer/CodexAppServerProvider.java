package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.UUID;

/** 공식 Codex app-server JSONL 프로토콜을 사용하는 구독 로그인 기반 Explorer 공급자. */
public final class CodexAppServerProvider implements ExplorerProvider {
    interface ProcessLauncher { Process start(List<String> command, Path cwd, Map<String, String> environment) throws IOException; }

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int LINE_LIMIT = 1024 * 1024;
    private static final int DETAIL_LIMIT = 4_000;
    private static final long STOP_TIMEOUT_MS = 2_000;
    private final ProcessLauncher launcher;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-codex-app-server");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile Session active;
    private volatile String cachedReadiness = "확인 전";
    private volatile long readinessCheckedAt;

    public CodexAppServerProvider() { this(CodexAppServerProvider::launch); }
    CodexAppServerProvider(ProcessLauncher launcher) { this.launcher = launcher; }

    @Override public synchronized String readiness() {
        long now = System.currentTimeMillis();
        if (now - readinessCheckedAt < 15_000 && !"확인 전".equals(cachedReadiness)) {
            return cachedReadiness;
        }
        String executable = resolveExecutable();
        if (executable == null) return cacheReadiness(
                "Codex CLI를 찾지 못했습니다. 공식 Codex CLI 설치와 로그인이 필요합니다.", now);
        Process process = null;
        try {
            process = launch(List.of(executable, "login", "status"), Path.of(System.getProperty("java.io.tmpdir")), Map.of());
            if (!process.waitFor(6, TimeUnit.SECONDS)) return cacheReadiness("Codex 로그인 확인 시간이 초과됐습니다.", now);
            return cacheReadiness(process.exitValue() == 0 ? "READY" : "Codex CLI 로그인이 필요합니다.", now);
        } catch (Exception error) {
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            return cacheReadiness("Codex 준비 상태 확인 실패: " + safe(error.getMessage()), now);
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
        }
    }

    private String cacheReadiness(String value, long checkedAt) {
        cachedReadiness = value;
        readinessCheckedAt = checkedAt;
        return value;
    }

    @Override public synchronized void invalidateReadiness() {
        cachedReadiness = "확인 전";
        readinessCheckedAt = 0;
    }

    @Override public synchronized Handle start(Request request, Listener listener) {
        if (closed.get()) throw new IllegalStateException("Codex 공급자가 종료됐습니다.");
        if (active != null) throw new IllegalStateException("Codex Explorer가 이미 실행 중입니다.");
        String executable = resolveExecutable();
        if (executable == null) throw new IllegalStateException(readiness());
        Session session = new Session(request, listener, executable);
        active = session;
        worker.execute(session::run);
        return session;
    }

    @Override public synchronized void close() {
        closed.set(true);
        Session session = active;
        if (session != null) session.cancel();
        worker.shutdownNow();
    }

    private final class Session implements Handle {
        private final Request request;
        private final Listener listener;
        private final String executable;
        private final AtomicLong nextId = new AtomicLong(1);
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final Object writeLock = new Object();
        private volatile Process process;
        private volatile BufferedWriter writer;
        private volatile String threadId = "";
        private volatile String turnId = "";
        private volatile String finalMessage = "";
        private Path workspace;

        private Session(Request request, Listener listener, String executable) {
            this.request = request;
            this.listener = listener;
            this.executable = executable;
        }

        private void run() {
            try {
                workspace = Files.createTempDirectory("flowscope-explorer-");
                // The model receives only the dynamic tool schema. The gateway capability stays in this
                // Java process and is never inherited by the provider process as an environment variable.
                process = launcher.start(List.of(executable, "app-server"), workspace, Map.of());
                writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
                listener.activity(activity("SYSTEM", "Codex 연결", "app-server 프로세스를 시작했습니다.", "RUNNING", null));
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                    long initializeId = send("initialize", initializeParams());
                    waitForResponse(reader, initializeId);
                    notify("initialized", JSON.createObjectNode());
                    long threadIdRequest = send("thread/start", threadParams());
                    JsonNode threadResponse = waitForResponse(reader, threadIdRequest);
                    threadId = threadResponse.path("result").path("thread").path("id").asText("");
                    if (threadId.isBlank()) throw new IOException("Codex thread ID를 받지 못했습니다.");
                    long turnRequest = send("turn/start", turnParams());
                    JsonNode turnResponse = waitForResponse(reader, turnRequest);
                    turnId = turnResponse.path("result").path("turn").path("id").asText("");
                    readTurn(reader);
                    if (cancelled.get()) return;
                    Result result = parseResult(finalMessage, threadId);
                    deleteThread(reader);
                    listener.completed(result);
                }
            } catch (Exception error) {
                if (!cancelled.get()) listener.failed("Codex Explorer 실패: " + safe(error.getMessage()));
            } finally {
                terminate(process);
                deleteWorkspace(workspace);
                synchronized (CodexAppServerProvider.this) {
                    if (active == this) active = null;
                }
            }
        }

        private JsonNode waitForResponse(BufferedReader reader, long expectedId) throws IOException {
            while (!cancelled.get()) {
                JsonNode message = readMessage(reader);
                handleServerRequest(message);
                if (message.path("id").asLong(-1) != expectedId) {
                    handleNotification(message);
                    continue;
                }
                if (message.has("error")) {
                    throw new IOException(message.path("error").path("message").asText("Codex JSON-RPC 오류"));
                }
                return message;
            }
            throw new IOException("Codex 실행이 취소됐습니다.");
        }

        private void readTurn(BufferedReader reader) throws IOException {
            while (!cancelled.get()) {
                JsonNode message = readMessage(reader);
                handleServerRequest(message);
                handleNotification(message);
                if ("turn/completed".equals(message.path("method").asText())) {
                    JsonNode turn = message.path("params").path("turn");
                    String status = turn.path("status").asText("");
                    if (!"completed".equalsIgnoreCase(status)) {
                        throw new IOException(turn.path("error").path("message")
                                .asText("Codex turn이 " + status + " 상태로 끝났습니다."));
                    }
                    return;
                }
            }
        }

        private JsonNode readMessage(BufferedReader reader) throws IOException {
            for (int skipped = 0; skipped < 100; skipped++) {
                String line = reader.readLine();
                if (line == null) throw new IOException("Codex app-server 연결이 종료됐습니다.");
                if (line.length() > LINE_LIMIT) throw new IOException("Codex 이벤트가 크기 상한을 초과했습니다.");
                try { return JSON.readTree(line); }
                catch (Exception ignored) {
                    // app-server가 stderr 진단을 stdout과 함께 내보내도 원문을 UI·로그에 노출하지 않는다.
                }
            }
            throw new IOException("Codex JSONL 이벤트를 연속해서 받지 못했습니다.");
        }

        private void handleNotification(JsonNode message) {
            String method = message.path("method").asText("");
            JsonNode item = message.path("params").path("item");
            if (method.equals("turn/started")) {
                listener.activity(activity("SYSTEM", "탐색 시작", "독립 Explorer turn이 시작됐습니다.", "RUNNING", null));
            } else if (method.equals("item/started") && item.path("type").asText("").equals("commandExecution")) {
                listener.activity(activity("TOOL", "응답 산출물 분석", "격리 workspace에서 읽기 전용 분석을 실행 중입니다.", "RUNNING", null));
            } else if (method.equals("item/started") && item.path("type").asText("").equals("dynamicToolCall")) {
                listener.activity(activity("TOOL", "FlowScope 도구 호출",
                        "exact-scope 요청 또는 Evidence 결박 선언을 처리 중입니다.", "RUNNING", null));
            } else if (method.equals("item/completed")) {
                String type = item.path("type").asText("");
                if (type.equals("commandExecution")) {
                    String status = item.path("status").asText("");
                    Long duration = item.has("durationMs") ? item.path("durationMs").asLong() : null;
                    listener.activity(activity("TOOL", "응답 산출물 분석",
                            "completed".equalsIgnoreCase(status) ? "명령 완료" : "명령 " + status,
                            "completed".equalsIgnoreCase(status) ? "COMPLETED" : "FAILED", duration));
                } else if (type.equals("dynamicToolCall")) {
                    String status = item.path("status").asText("");
                    Long duration = item.has("durationMs") ? item.path("durationMs").asLong() : null;
                    listener.activity(activity("TOOL", "FlowScope 도구 호출",
                            "completed".equalsIgnoreCase(status) ? "도구 처리 완료" : "도구 처리 " + status,
                            "completed".equalsIgnoreCase(status) ? "COMPLETED" : "FAILED", duration));
                } else if (type.equals("agentMessage")) {
                    finalMessage = item.path("text").asText(finalMessage);
                    listener.activity(activity("MODEL", "Explorer 모델 메모 (비집계)",
                            displaySummary(finalMessage), "COMPLETED", null));
                }
            } else if (method.equals("warning") || method.equals("configWarning")) {
                listener.activity(activity("WARNING", "Codex 경고",
                        firstText(message.path("params"), "message", "summary"), "WARNING", null));
            } else if (method.equals("error")) {
                listener.activity(activity("ERROR", "Codex 오류",
                        message.path("params").path("error").path("message").asText("오류"), "FAILED", null));
            }
        }

        private void handleServerRequest(JsonNode message) {
            if (!message.has("id") || !message.has("method")) return;
            String method = message.path("method").asText("");
            if (method.equals("item/tool/call")) {
                handleDynamicTool(message);
                return;
            }
            if (method.equals("item/permissions/requestApproval")) {
                ObjectNode response = JSON.createObjectNode();
                response.set("id", message.get("id"));
                response.putObject("result").putObject("permissions");
                write(response);
                return;
            }
            if (!method.contains("requestApproval")) return;
            JsonNode params = message.path("params");
            JsonNode network = params.path("networkApprovalContext");
            boolean networkRequest = !network.isMissingNode() && !network.isNull();
            ObjectNode response = JSON.createObjectNode();
            response.set("id", message.get("id"));
            boolean command = method.equals("item/commandExecution/requestApproval");
            response.putObject("result").put("decision", command && !networkRequest ? "acceptForSession" : "decline");
            write(response);
        }

        private void handleDynamicTool(JsonNode message) {
            ObjectNode response = JSON.createObjectNode();
            response.set("id", message.get("id"));
            ObjectNode result = response.putObject("result");
            try {
                JsonNode params = message.path("params");
                String tool = params.path("tool").asText();
                String endpoint = switch (tool) {
                    case "flowscope_http_request" -> request.gatewayUrl();
                    case "flowscope_record_discoveries" -> request.discoveryUrl();
                    default -> throw new IllegalArgumentException("지원하지 않는 Explorer 도구입니다.");
                };
                String gatewayResponse = callGateway(endpoint, params.path("arguments"),
                        tool.equals("flowscope_http_request"));
                result.put("success", true).putArray("contentItems").addObject()
                        .put("type", "inputText").put("text", gatewayResponse);
            } catch (Exception error) {
                result.put("success", false).putArray("contentItems").addObject()
                        .put("type", "inputText").put("text", safe(error.getMessage()));
            }
            write(response);
        }

        private String callGateway(String endpoint, JsonNode arguments, boolean downloadArtifact) throws Exception {
            HttpRequest gatewayRequest = HttpRequest.newBuilder(URI.create(endpoint))
                    .header("Authorization", "Bearer " + request.gatewayToken())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(arguments.toString(), StandardCharsets.UTF_8)).build();
            HttpResponse<String> gatewayResponse = HttpClient.newHttpClient().send(
                    gatewayRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode parsed = JSON.readTree(gatewayResponse.body());
            if (gatewayResponse.statusCode() >= 400) {
                throw new IOException(parsed.path("error").asText("FlowScope HTTP 요청이 거부됐습니다."));
            }
            if (downloadArtifact && parsed.hasNonNull("artifact_url")
                    && !parsed.path("artifact_url").asText().isBlank()) {
                HttpRequest artifactRequest = HttpRequest.newBuilder(URI.create(parsed.path("artifact_url").asText()))
                        .header("Authorization", "Bearer " + request.gatewayToken()).GET().build();
                HttpResponse<byte[]> artifactResponse = HttpClient.newHttpClient().send(
                        artifactRequest, HttpResponse.BodyHandlers.ofByteArray());
                if (artifactResponse.statusCode() != 200) throw new IOException("큰 응답 artifact를 보존하지 못했습니다.");
                Path artifactPath = workspace.resolve("response-" + UUID.randomUUID() + ".txt");
                Files.write(artifactPath, artifactResponse.body());
                ObjectNode mutable = (ObjectNode) parsed;
                mutable.put("artifact_path", artifactPath.toString());
                mutable.remove("artifact_url");
            }
            return parsed.toString();
        }

        @Override public void steer(String message) {
            String safe = Masking.truncate(Masking.maskSecrets(message == null ? "" : message.trim()), 4_000);
            if (safe.isBlank() || threadId.isBlank() || turnId.isBlank() || cancelled.get()) {
                throw new IllegalStateException("진행 중인 Explorer turn이 없습니다.");
            }
            ObjectNode params = JSON.createObjectNode();
            params.put("threadId", threadId);
            params.put("expectedTurnId", turnId);
            params.putArray("input").addObject().put("type", "text").put("text", safe);
            send("turn/steer", params);
            listener.activity(activity("OPERATOR", "사용자 메시지", safe, "SENT", null));
        }

        @Override public void cancel() {
            cancelled.set(true);
            try {
                if (!threadId.isBlank() && !turnId.isBlank()) {
                    ObjectNode params = JSON.createObjectNode().put("threadId", threadId).put("turnId", turnId);
                    send("turn/interrupt", params);
                }
            } catch (RuntimeException ignored) { }
            terminate(process);
        }

        private void deleteThread(BufferedReader reader) {
            if (threadId.isBlank()) return;
            try {
                long id = send("thread/delete", JSON.createObjectNode().put("threadId", threadId));
                waitForResponse(reader, id);
            } catch (Exception ignored) { /* process-local history cleanup failure is reported as a limitation elsewhere */ }
        }

        private long send(String method, JsonNode params) {
            long id = nextId.getAndIncrement();
            ObjectNode message = JSON.createObjectNode().put("method", method).put("id", id);
            message.set("params", params);
            write(message);
            return id;
        }

        private void notify(String method, JsonNode params) {
            ObjectNode message = JSON.createObjectNode().put("method", method);
            message.set("params", params);
            write(message);
        }

        private void write(JsonNode message) {
            synchronized (writeLock) {
                try {
                    if (writer == null) throw new IOException("Codex stdin이 준비되지 않았습니다.");
                    writer.write(message.toString());
                    writer.newLine();
                    writer.flush();
                } catch (IOException error) {
                    throw new IllegalStateException("Codex 요청 전송 실패", error);
                }
            }
        }

        private ObjectNode initializeParams() {
            ObjectNode params = JSON.createObjectNode();
            params.putObject("clientInfo").put("name", "flowscope")
                    .put("title", "FlowScope Explorer").put("version", "1.2.0");
            params.putObject("capabilities").put("experimentalApi", true);
            return params;
        }

        private ObjectNode threadParams() {
            ObjectNode params = JSON.createObjectNode().put("cwd", workspace.toString())
                    .put("approvalPolicy", "on-request").put("sandbox", "workspace-write")
                    .put("serviceName", "flowscope_explorer").put("ephemeral", true)
                    .put("developerInstructions", request.prompt());
            params.putArray("dynamicTools").add(httpTool()).add(discoveryTool());
            return params;
        }

        private ObjectNode turnParams() {
            ObjectNode params = JSON.createObjectNode();
            params.put("threadId", threadId).put("cwd", workspace.toString()).put("approvalPolicy", "on-request");
            params.putArray("input").addObject().put("type", "text")
                    .put("text", "지정된 FlowScope Explorer 탐색을 지금 시작하고 결과를 스키마에 맞춰 보고하세요.");
            ObjectNode sandbox = params.putObject("sandboxPolicy").put("type", "workspaceWrite")
                    .put("networkAccess", false);
            sandbox.putArray("writableRoots").add(workspace.toString());
            params.set("outputSchema", outputSchema());
            return params;
        }

        private ObjectNode httpTool() {
            ObjectNode tool = JSON.createObjectNode().put("type", "function")
                    .put("name", "flowscope_http_request")
                    .put("description", "Send one exact-scope HTTP request through FlowScope and store its response as LLM Evidence.");
            ObjectNode schema = tool.putObject("inputSchema").put("type", "object").put("additionalProperties", false);
            ObjectNode properties = schema.putObject("properties");
            properties.putObject("account").put("type", "string")
                    .put("description", "Opaque account handle, or an empty string for anonymous.");
            properties.putObject("method").put("type", "string").putArray("enum")
                    .add("GET").add("HEAD").add("OPTIONS").add("POST");
            properties.putObject("url").put("type", "string");
            properties.putObject("headers").put("type", "object").put("additionalProperties", true);
            properties.putObject("body").put("type", "string");
            schema.putArray("required").add("account").add("method").add("url").add("headers").add("body");
            return tool;
        }

        private ObjectNode discoveryTool() {
            ObjectNode tool = JSON.createObjectNode().put("type", "function")
                    .put("name", "flowscope_record_discoveries")
                    .put("description", "Store Evidence-bound endpoint and parameter declarations found in a response artifact. This records declarations, not HTTP observations or vulnerability verdicts.");
            ObjectNode schema = tool.putObject("inputSchema").put("type", "object")
                    .put("additionalProperties", false);
            ObjectNode discoveries = schema.putObject("properties").putObject("discoveries")
                    .put("type", "array").put("minItems", 1).put("maxItems", 200);
            ObjectNode item = discoveries.putObject("items").put("type", "object")
                    .put("additionalProperties", false);
            ObjectNode properties = item.putObject("properties");
            properties.putObject("method").put("type", "string").putArray("enum")
                    .add("GET").add("HEAD").add("OPTIONS").add("POST").add("PUT").add("PATCH").add("DELETE");
            properties.putObject("url").put("type", "string")
                    .put("description", "Absolute exact-scope URL or URL template. Path placeholders may use {name}.");
            properties.putObject("evidence_ids").put("type", "array").put("minItems", 1).put("maxItems", 8)
                    .putObject("items").put("type", "string");
            properties.putObject("artifact_kind").put("type", "string").putArray("enum")
                    .add("JAVASCRIPT").add("HTML").add("OPENAPI").add("GRAPHQL")
                    .add("SOURCE_MAP").add("MANIFEST").add("OTHER");
            properties.putObject("locator").put("type", "string")
                    .put("description", "Non-secret location such as artifact file and line or JSON pointer.");
            properties.putObject("reason").put("type", "string");
            ObjectNode parameters = properties.putObject("parameters").put("type", "array")
                    .put("maxItems", 256);
            ObjectNode parameter = parameters.putObject("items").put("type", "object")
                    .put("additionalProperties", false);
            ObjectNode parameterProperties = parameter.putObject("properties");
            parameterProperties.putObject("location").put("type", "string").putArray("enum")
                    .add("PATH").add("QUERY").add("JSON_BODY").add("FORM_BODY")
                    .add("MULTIPART_BODY").add("HEADER").add("GRAPHQL_VARIABLE");
            parameterProperties.putObject("field_path").put("type", "string");
            parameterProperties.putObject("display_name").put("type", "string");
            parameterProperties.putObject("requirement").put("type", "string").putArray("enum")
                    .add("REQUIRED").add("OPTIONAL").add("UNKNOWN");
            parameter.putArray("required").add("location").add("field_path")
                    .add("display_name").add("requirement");
            item.putArray("required").add("method").add("url").add("evidence_ids")
                    .add("artifact_kind").add("locator").add("reason").add("parameters");
            schema.putArray("required").add("discoveries");
            return tool;
        }
    }

    private static ObjectNode outputSchema() {
        ObjectNode root = JSON.createObjectNode().put("type", "object").put("additionalProperties", false);
        ObjectNode properties = root.putObject("properties");
        properties.putObject("summary").put("type", "string");
        ObjectNode unresolved = properties.putObject("unresolved").put("type", "array");
        ObjectNode item = unresolved.putObject("items").put("type", "object").put("additionalProperties", false);
        ObjectNode fields = item.putObject("properties");
        fields.putObject("kind").put("type", "string");
        fields.putObject("target").put("type", "string");
        fields.putObject("reason").put("type", "string");
        item.putArray("required").add("kind").add("target").add("reason");
        root.putArray("required").add("summary").add("unresolved");
        return root;
    }

    private static Result parseResult(String text, String threadId) {
        try {
            JsonNode root = JSON.readTree(text == null ? "" : text);
            List<Unresolved> unresolved = new ArrayList<>();
            for (JsonNode item : root.path("unresolved")) {
                unresolved.add(new Unresolved(safe(item.path("kind").asText("unknown")),
                        safe(item.path("target").asText("")), safe(item.path("reason").asText(""))));
            }
            return new Result(safe(root.path("summary").asText("탐색 완료")), unresolved, threadId);
        } catch (Exception error) {
            return new Result("Explorer가 구조화된 최종 보고를 남기지 못했습니다.",
                    List.of(new Unresolved("provider_output", "", "최종 JSON 보고 해석 실패")), threadId);
        }
    }

    private static Activity activity(String kind, String title, String detail, String status, Long duration) {
        return new Activity(Instant.now(), kind, title, safe(detail), status, duration);
    }

    private static String displaySummary(String value) {
        try { return safe(JSON.readTree(value).path("summary").asText("Explorer 최종 보고")); }
        catch (Exception ignored) { return "Explorer 최종 보고"; }
    }

    private static String firstText(JsonNode node, String... names) {
        for (String name : names) {
            String value = node.path(name).asText("");
            if (!value.isBlank()) return safe(value);
        }
        return "";
    }

    private static String safe(String value) {
        return Masking.truncate(Masking.maskSecrets(value == null ? "" : value), DETAIL_LIMIT);
    }

    static String resolveExecutable() {
        String configured = System.getProperty("flowscope.llm.codex.path", "").trim();
        if (!configured.isBlank() && executable(configured)) return configured;
        for (Path directory : candidateDirectories()) {
            for (String name : windows() ? List.of("codex.exe", "codex.cmd", "codex.bat", "codex") : List.of("codex")) {
                Path candidate = directory.resolve(name);
                if (executable(candidate.toString())) return candidate.toString();
            }
        }
        return null;
    }

    private static List<Path> candidateDirectories() {
        LinkedHashSet<Path> result = new LinkedHashSet<>();
        String path = System.getenv().entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase("PATH"))
                .map(Map.Entry::getValue).findFirst().orElse("");
        Arrays.stream(path.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator)))
                .filter(value -> !value.isBlank()).map(Path::of).forEach(result::add);
        String home = System.getProperty("user.home", "");
        if (!home.isBlank()) result.add(Path.of(home, ".local", "bin"));
        if (windows()) {
            addEnvPath(result, "LOCALAPPDATA", "Microsoft", "WinGet", "Links");
            addEnvPath(result, "APPDATA", "npm");
        } else {
            result.add(Path.of("/opt/homebrew/bin"));
            result.add(Path.of("/usr/local/bin"));
            result.add(Path.of("/usr/bin"));
        }
        return List.copyOf(result);
    }

    private static void addEnvPath(Set<Path> paths, String key, String... parts) {
        String root = System.getenv(key);
        if (root == null || root.isBlank()) return;
        Path path = Path.of(root);
        for (String part : parts) path = path.resolve(part);
        paths.add(path);
    }

    private static boolean executable(String value) {
        try { return Files.isRegularFile(Path.of(value)) && Files.isExecutable(Path.of(value)); }
        catch (RuntimeException ignored) { return false; }
    }

    private static boolean windows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private static Process launch(List<String> command, Path cwd, Map<String, String> required) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command).directory(cwd.toFile()).redirectErrorStream(true);
        Map<String, String> environment = builder.environment();
        environment.remove("OPENAI_API_KEY");
        environment.remove("ANTHROPIC_API_KEY");
        environment.putAll(required);
        Path executable = Path.of(command.getFirst()).toAbsolutePath().normalize();
        String key = environment.keySet().stream().filter(name -> name.equalsIgnoreCase("PATH"))
                .findFirst().orElse("PATH");
        LinkedHashSet<String> entries = new LinkedHashSet<>();
        if (executable.getParent() != null) entries.add(executable.getParent().toString());
        entries.add("/opt/homebrew/bin");
        entries.add("/usr/local/bin");
        String previous = environment.getOrDefault(key, "");
        if (!previous.isBlank()) entries.addAll(Arrays.asList(previous.split(java.io.File.pathSeparator)));
        environment.put(key, String.join(java.io.File.pathSeparator, entries));
        return builder.start();
    }

    private static void terminate(Process process) {
        if (process == null || !process.isAlive()) return;
        process.destroy();
        try {
            if (!process.waitFor(STOP_TIMEOUT_MS, TimeUnit.MILLISECONDS)) process.destroyForcibly();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    private static void deleteWorkspace(Path workspace) {
        if (workspace == null) return;
        try (var paths = Files.walk(workspace)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) { }
    }
}
