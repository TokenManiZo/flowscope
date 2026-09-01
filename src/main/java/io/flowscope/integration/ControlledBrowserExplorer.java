package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;
import io.flowscope.core.ScopePolicy;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

/**
 * 설치된 Chromium 계열 브라우저를 임시 프로필과 CDP로 제어하는 Explorer 전용 작업기.
 * 모델에는 DOM 요약과 URL만 반환하며 쿠키·Authorization·CDP 원문은 반환하지 않는다.
 */
public final class ControlledBrowserExplorer implements AutoCloseable {
    public record Route(String method, String url, String type, Integer status) {}
    public record Element(String kind, String text, String target, String method) {}
    public record WriteRequest(String method, String url, String resourceType, String bodyPreview) {}
    @FunctionalInterface
    public interface WriteApproval {
        boolean approve(WriteRequest request);
    }
    public record Snapshot(String runId, String currentUrl, String title, String visibleText,
                           List<Element> elements, List<Route> network, boolean running) {}

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int TEXT_LIMIT = 24_000;
    private static final int ELEMENT_LIMIT = 300;
    private static final int NETWORK_LIMIT = 1_000;
    private static final int CDP_MESSAGE_LIMIT = 2 * 1024 * 1024;
    private static final Duration START_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration COMMAND_TIMEOUT = Duration.ofSeconds(15);
    private static final String SNAPSHOT_EXPRESSION = """
            (() => {
              const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
              const elements = [];
              for (const a of document.querySelectorAll('a[href]')) {
                elements.push({kind:'link', text:clean(a.innerText || a.getAttribute('aria-label')),
                  target:new URL(a.getAttribute('href'), document.baseURI).href, method:'GET'});
                if (elements.length >= 300) break;
              }
              if (elements.length < 300) for (const f of document.querySelectorAll('form')) {
                elements.push({kind:'form', text:clean(f.innerText || f.getAttribute('aria-label')),
                  target:new URL(f.getAttribute('action') || location.href, document.baseURI).href,
                  method:(f.getAttribute('method') || 'GET').toUpperCase()});
                if (elements.length >= 300) break;
              }
              if (elements.length < 300) for (const b of document.querySelectorAll('button,[role=button]')) {
                elements.push({kind:'button', text:clean(b.innerText || b.getAttribute('aria-label')),
                  target:'', method:''});
                if (elements.length >= 300) break;
              }
              return {url:location.href, title:document.title, text:clean(document.body?.innerText).slice(0,24000), elements};
            })()
            """;

    private final Supplier<ScopePolicy> scope;
    private final int proxyPort;
    private final WriteApproval writeApproval;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Object sendLock = new Object();
    private final Map<Long, CompletableFuture<JsonNode>> pending = new ConcurrentHashMap<>();
    private final Map<String, MutableRoute> routes = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();
    private final AtomicReference<String> currentUrl = new AtomicReference<>("about:blank");
    private volatile Process process;
    private volatile Path profile;
    private volatile WebSocket socket;
    private volatile String runId = "";
    private volatile URI sessionService;
    private volatile Map<String, String> sessionHeaders = Map.of();

    public ControlledBrowserExplorer(Supplier<ScopePolicy> scope, int proxyPort) {
        this(scope, proxyPort, request -> false);
    }

    public ControlledBrowserExplorer(Supplier<ScopePolicy> scope, int proxyPort,
                                     WriteApproval writeApproval) {
        this.scope = scope;
        this.proxyPort = proxyPort;
        this.writeApproval = java.util.Objects.requireNonNull(writeApproval);
    }

    public synchronized Snapshot navigate(String requestedRunId, String target,
                                          Map<String, String> sessionHeaders) throws Exception {
        requireExactScope(target);
        ensureStarted(requestedRunId);
        configureSession(target, sessionHeaders == null ? Map.of() : sessionHeaders);
        JsonNode navigated = command("Page.navigate", JSON.createObjectNode().put("url", target));
        String error = navigated.path("errorText").asText("");
        if (!error.isBlank()) throw new IOException("browser navigation failed: " + error);
        currentUrl.set(target);
        waitForDocumentReady();
        return snapshot(requestedRunId);
    }

    public synchronized Snapshot snapshot(String requestedRunId) throws Exception {
        requireRun(requestedRunId);
        ObjectNode params = JSON.createObjectNode();
        params.put("expression", SNAPSHOT_EXPRESSION);
        params.put("returnByValue", true);
        params.put("awaitPromise", true);
        JsonNode response = command("Runtime.evaluate", params);
        JsonNode value = response.path("result").path("value");
        if (!value.isObject()) throw new IOException("browser DOM snapshot is unavailable");
        String pageUrl = value.path("url").asText(currentUrl.get());
        if (!"about:blank".equals(pageUrl)) requireExactScope(pageUrl);
        currentUrl.set(pageUrl);
        List<Element> elements = new ArrayList<>();
        for (JsonNode item : value.path("elements")) {
            if (elements.size() >= ELEMENT_LIMIT) break;
            String target = item.path("target").asText("");
            if (!target.isBlank() && !scope.get().allows(target)) continue;
            elements.add(new Element(bounded(item.path("kind").asText("unknown"), 32),
                    bounded(Masking.maskSecrets(item.path("text").asText("")), 500),
                    bounded(Masking.maskSecrets(target), 4_096),
                    bounded(item.path("method").asText(""), 16)));
        }
        return new Snapshot(runId, bounded(Masking.maskSecrets(pageUrl), 4_096),
                bounded(Masking.maskSecrets(value.path("title").asText("")), 1_000),
                bounded(Masking.maskSecrets(value.path("text").asText("")), TEXT_LIMIT),
                List.copyOf(elements), routeSnapshot(), true);
    }

    public synchronized Snapshot status(String requestedRunId) throws Exception {
        requireRun(requestedRunId);
        return snapshot(requestedRunId);
    }

    public synchronized Snapshot interact(String requestedRunId, String action, String selector,
                                          String value) throws Exception {
        requireRun(requestedRunId);
        String normalized = action == null ? "" : action.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("CLICK", "FILL").contains(normalized)) {
            throw new IllegalArgumentException("browser action must be CLICK or FILL");
        }
        if (selector == null || selector.isBlank() || selector.length() > 500) {
            throw new IllegalArgumentException("browser selector must contain 1 to 500 characters");
        }
        String selectorJson = JSON.writeValueAsString(selector);
        String expression;
        if ("CLICK".equals(normalized)) {
            expression = "(() => { const e=document.querySelector(" + selectorJson + ");"
                    + "if(!e) return {ok:false,error:'selector not found'};"
                    + "if(e.matches('input[type=password],input[type=file]')) return {ok:false,error:'sensitive input blocked'};"
                    + "e.click(); return {ok:true}; })()";
        } else {
            if (value == null || value.length() > 2_000) {
                throw new IllegalArgumentException("browser fill value must be at most 2000 characters");
            }
            expression = "(() => { const e=document.querySelector(" + selectorJson + ");"
                    + "if(!e) return {ok:false,error:'selector not found'};"
                    + "if(e.matches('input[type=password],input[type=file]')) return {ok:false,error:'sensitive input blocked'};"
                    + "e.value=" + JSON.writeValueAsString(value) + ";"
                    + "e.dispatchEvent(new Event('input',{bubbles:true}));"
                    + "e.dispatchEvent(new Event('change',{bubbles:true})); return {ok:true}; })()";
        }
        ObjectNode params = JSON.createObjectNode().put("expression", expression)
                .put("returnByValue", true).put("awaitPromise", true);
        JsonNode result = command("Runtime.evaluate", params).path("result").path("value");
        if (!result.path("ok").asBoolean(false)) {
            throw new IllegalArgumentException(result.path("error").asText("browser interaction failed"));
        }
        Thread.sleep(500);
        return snapshot(requestedRunId);
    }

    public synchronized void closeRun(String requestedRunId) {
        if (runId.equals(requestedRunId)) close();
    }

    private void ensureStarted(String requestedRunId) throws Exception {
        if (socket != null && process != null && process.isAlive() && runId.equals(requestedRunId)) return;
        close();
        String executable = locateBrowser().orElseThrow(() -> new IOException(
                "supported Chrome/Chromium/Edge executable was not found"));
        profile = Files.createTempDirectory("flowscope-browser-");
        List<String> command = new ArrayList<>(List.of(executable,
                "--remote-debugging-port=0",
                "--user-data-dir=" + profile,
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-sync",
                "--metrics-recording-only",
                "--no-first-run",
                "--no-default-browser-check",
                "--incognito",
                "--ignore-certificate-errors",
                "about:blank"));
        if (proxyPort > 0) command.addAll(command.size() - 1, List.of(
                "--proxy-server=http://127.0.0.1:" + proxyPort,
                "--proxy-bypass-list=<-loopback>"));
        if (Boolean.getBoolean("flowscope.browser.headless")) {
            command.add(command.size() - 1, "--headless=new");
        }
        process = new ProcessBuilder(command).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        Path activePort = profile.resolve("DevToolsActivePort");
        long deadline = System.nanoTime() + START_TIMEOUT.toNanos();
        while (!Files.isRegularFile(activePort) && process.isAlive() && System.nanoTime() < deadline) {
            Thread.sleep(50);
        }
        if (!Files.isRegularFile(activePort)) throw new IOException("browser DevTools endpoint did not start");
        List<String> lines = Files.readAllLines(activePort, StandardCharsets.UTF_8);
        if (lines.isEmpty()) throw new IOException("browser DevTools port is unavailable");
        int port = Integer.parseInt(lines.getFirst().trim());
        URI endpoint = URI.create("http://127.0.0.1:" + port + "/json/list");
        HttpResponse<String> targets = http.send(HttpRequest.newBuilder(endpoint).GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        JsonNode list = JSON.readTree(targets.body());
        String ws = "";
        for (JsonNode item : list) {
            if ("page".equals(item.path("type").asText())) {
                ws = item.path("webSocketDebuggerUrl").asText("");
                if (!ws.isBlank()) break;
            }
        }
        if (ws.isBlank()) throw new IOException("browser page target is unavailable");
        socket = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5))
                .buildAsync(URI.create(ws), new Listener()).get(5, TimeUnit.SECONDS);
        runId = requestedRunId;
        routes.clear();
        command("Page.enable", JSON.createObjectNode());
        command("Runtime.enable", JSON.createObjectNode());
        command("Network.enable", JSON.createObjectNode());
        ArrayNode patterns = JSON.createArrayNode();
        patterns.addObject().put("urlPattern", "*").put("requestStage", "Request");
        command("Fetch.enable", JSON.createObjectNode().set("patterns", patterns));
    }

    private void configureSession(String target, Map<String, String> sessionHeaders) throws Exception {
        sessionService = URI.create(target);
        LinkedHashMap<String, String> bounded = new LinkedHashMap<>();
        sessionHeaders.forEach((name, value) -> {
            if (!name.equalsIgnoreCase("Proxy-Authorization")) bounded.put(name, value);
        });
        this.sessionHeaders = Map.copyOf(bounded);
    }

    private void waitForDocumentReady() throws Exception {
        long deadline = System.nanoTime() + COMMAND_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            ObjectNode params = JSON.createObjectNode().put("expression", "document.readyState")
                    .put("returnByValue", true);
            String state = command("Runtime.evaluate", params).path("result").path("value").asText("");
            if (Set.of("interactive", "complete").contains(state)) return;
            Thread.sleep(100);
        }
        throw new TimeoutException("browser document did not become ready");
    }

    private JsonNode command(String method, JsonNode params) throws Exception {
        long id = sequence.incrementAndGet();
        CompletableFuture<JsonNode> future = new CompletableFuture<>();
        pending.put(id, future);
        ObjectNode request = JSON.createObjectNode().put("id", id).put("method", method);
        request.set("params", params == null ? JSON.createObjectNode() : params);
        sendText(JSON.writeValueAsString(request));
        try {
            JsonNode response = future.get(COMMAND_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            if (response.has("error")) throw new IOException(method + " failed: "
                    + response.path("error").path("message").asText("unknown CDP error"));
            return response.path("result");
        } finally {
            pending.remove(id);
        }
    }

    private void handleEvent(JsonNode message) {
        String method = message.path("method").asText();
        JsonNode params = message.path("params");
        if ("Fetch.requestPaused".equals(method)) {
            String requestId = params.path("requestId").asText();
            JsonNode request = params.path("request");
            String target = request.path("url").asText();
            String requestMethod = request.path("method").asText("GET").toUpperCase(Locale.ROOT);
            boolean allowed = target.startsWith("data:") || target.startsWith("about:")
                    || scope.get().allows(target);
            if (allowed && !isSafeMethod(requestMethod)) {
                String bodyPreview = bounded(Masking.maskSecrets(request.path("postData").asText("")), 2_000);
                allowed = writeApproval.approve(new WriteRequest(requestMethod,
                        bounded(Masking.maskSecrets(target), 4_096),
                        bounded(params.path("resourceType").asText("Other"), 64), bodyPreview));
            }
            ObjectNode action = JSON.createObjectNode().put("requestId", requestId);
            if (allowed && sameService(sessionService, target) && !sessionHeaders.isEmpty()) {
                LinkedHashMap<String, String> headers = new LinkedHashMap<>();
                request.path("headers").properties().forEach(entry ->
                        headers.put(entry.getKey(), entry.getValue().asText()));
                sessionHeaders.forEach((name, value) -> {
                    headers.keySet().removeIf(existing -> existing.equalsIgnoreCase(name));
                    headers.put(name, value);
                });
                ArrayNode replacement = action.putArray("headers");
                headers.forEach((name, value) -> replacement.addObject().put("name", name).put("value", value));
            }
            sendEventCommand(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
                    allowed ? action : action.put("errorReason", "BlockedByClient"));
            return;
        }
        if ("Network.requestWillBeSent".equals(method)) {
            String target = params.path("request").path("url").asText();
            if (!scope.get().allows(target)) return;
            String requestId = params.path("requestId").asText();
            routes.put(requestId, new MutableRoute(
                    params.path("request").path("method").asText("GET"), target,
                    params.path("type").asText("Other"), null));
            trimRoutes();
        } else if ("Network.responseReceived".equals(method)) {
            MutableRoute route = routes.get(params.path("requestId").asText());
            if (route != null) route.status = params.path("response").path("status").asInt();
        } else if ("Page.frameNavigated".equals(method)
                && params.path("frame").path("parentId").isMissingNode()) {
            String target = params.path("frame").path("url").asText();
            if (scope.get().allows(target)) currentUrl.set(target);
        }
    }

    private void sendEventCommand(String method, ObjectNode params) {
        WebSocket active = socket;
        if (active == null) return;
        ObjectNode request = JSON.createObjectNode().put("id", sequence.incrementAndGet()).put("method", method);
        request.set("params", params);
        try {
            sendText(request.toString());
        } catch (Exception error) {
            pending.values().forEach(future -> future.completeExceptionally(error));
        }
    }

    private void sendText(String text) throws Exception {
        synchronized (sendLock) {
            WebSocket active = socket;
            if (active == null) throw new IllegalStateException("controlled browser is closed");
            active.sendText(text, true).get(5, TimeUnit.SECONDS);
        }
    }

    private List<Route> routeSnapshot() {
        LinkedHashMap<String, Route> unique = new LinkedHashMap<>();
        routes.values().stream().sorted(Comparator.comparing(value -> value.url)).forEach(value -> {
            Route route = new Route(value.method, bounded(Masking.maskSecrets(value.url), 4_096),
                    value.type, value.status);
            unique.putIfAbsent(value.method + " " + value.url, route);
        });
        return List.copyOf(unique.values());
    }

    private void trimRoutes() {
        if (routes.size() <= NETWORK_LIMIT) return;
        Set<String> remove = new LinkedHashSet<>(routes.keySet());
        int count = routes.size() - NETWORK_LIMIT;
        for (String key : remove) {
            routes.remove(key);
            if (--count <= 0) break;
        }
    }

    private void requireRun(String requestedRunId) {
        if (requestedRunId == null || requestedRunId.isBlank() || !requestedRunId.equals(runId)
                || socket == null || process == null || !process.isAlive()) {
            throw new IllegalStateException("controlled browser is not active for this Explorer run");
        }
    }

    private void requireExactScope(String target) {
        if (target == null || target.isBlank() || !scope.get().allows(target)) {
            throw new IllegalArgumentException("browser target is outside configured exact scope");
        }
    }

    public static java.util.Optional<String> locateBrowser() {
        String override = System.getProperty("flowscope.browser.path", "").trim();
        if (!override.isBlank() && Files.isExecutable(Path.of(override))) return java.util.Optional.of(override);
        List<String> candidates = new ArrayList<>();
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        if (os.contains("mac")) candidates.addAll(List.of(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"));
        else if (os.contains("win")) {
            for (String root : List.of(System.getenv("PROGRAMFILES"), System.getenv("PROGRAMFILES(X86)"),
                    System.getenv("LOCALAPPDATA"))) {
                if (root != null) candidates.addAll(List.of(root + "\\Google\\Chrome\\Application\\chrome.exe",
                        root + "\\Microsoft\\Edge\\Application\\msedge.exe"));
            }
        } else candidates.addAll(List.of("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"));
        return candidates.stream().filter(value -> Files.isExecutable(Path.of(value))).findFirst();
    }

    private static String bounded(String value, int limit) {
        if (value == null) return "";
        return value.length() <= limit ? value : value.substring(0, limit);
    }

    private static boolean sameService(URI expected, String target) {
        if (expected == null) return false;
        try {
            URI actual = URI.create(target);
            return expected.getScheme().equalsIgnoreCase(actual.getScheme())
                    && expected.getHost().equalsIgnoreCase(actual.getHost())
                    && effectivePort(expected) == effectivePort(actual);
        } catch (IllegalArgumentException | NullPointerException ignored) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static boolean isSafeMethod(String method) {
        return Set.of("GET", "HEAD", "OPTIONS").contains(method);
    }

    @Override
    public synchronized void close() {
        WebSocket activeSocket = socket;
        socket = null;
        if (activeSocket != null) activeSocket.sendClose(WebSocket.NORMAL_CLOSURE, "FlowScope close");
        pending.values().forEach(future -> future.completeExceptionally(
                new IllegalStateException("controlled browser closed")));
        pending.clear();
        Process activeProcess = process;
        process = null;
        if (activeProcess != null) {
            activeProcess.destroy();
            try {
                if (!activeProcess.waitFor(2, TimeUnit.SECONDS)) activeProcess.destroyForcibly();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                activeProcess.destroyForcibly();
            }
        }
        Path activeProfile = profile;
        profile = null;
        if (activeProfile != null) deleteTree(activeProfile);
        routes.clear();
        currentUrl.set("about:blank");
        runId = "";
        sessionService = null;
        sessionHeaders = Map.of();
    }

    private static void deleteTree(Path root) {
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) { }
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder text = new StringBuilder();
        private boolean discarded;

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public java.util.concurrent.CompletionStage<?> onText(WebSocket webSocket, CharSequence data,
                                                               boolean last) {
            if (!discarded && text.length() + data.length() <= CDP_MESSAGE_LIMIT) text.append(data);
            else {
                discarded = true;
                text.setLength(0);
            }
            if (last && !discarded) {
                try {
                    JsonNode message = JSON.readTree(text.toString());
                    if (message.has("id")) {
                        CompletableFuture<JsonNode> future = pending.get(message.path("id").asLong());
                        if (future != null) future.complete(message);
                    } else handleEvent(message);
                } catch (Exception ignored) {
                    // 손상된 CDP 이벤트 하나가 전체 세션을 종료시키지 않는다.
                } finally {
                    text.setLength(0);
                }
            } else if (last) {
                discarded = false;
            }
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            pending.values().forEach(future -> future.completeExceptionally(error));
        }
    }

    private static final class MutableRoute {
        final String method;
        final String url;
        final String type;
        volatile Integer status;

        MutableRoute(String method, String url, String type, Integer status) {
            this.method = method;
            this.url = url;
            this.type = type;
            this.status = status;
        }
    }
}
