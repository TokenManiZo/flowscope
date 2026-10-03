package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Launches Burp's bundled Chromium (or a system Chrome) with a throwaway profile and DevTools enabled: the operator
 * logs in, then the Explorer drives the same visible window. No Playwright or other dependency — Java's WebSocket
 * client speaks the DevTools protocol directly.
 */
final class ChromiumLoginBrowser implements LoginBrowser {
    private static final ObjectMapper JSON = new ObjectMapper();
    /** Burp's Chromium build prints a token that must accompany every DevTools connection. */
    static final Pattern DEVTOOLS_LINE = Pattern.compile("DevTools listening on (ws://\\S+)(?: with token (\\S+))?");
    private static final long STARTUP_SECONDS = 20;
    private static final long LOAD_TIMEOUT_MILLIS = 15_000;
    private static final int PAGE_TEXT_LIMIT = 4_000;

    /** Visible for tests: the launch arguments decide what the target can detect and what the window trusts. */
    static List<String> arguments(String executable, Path profile, URI loginUrl) {
        List<String> command = new ArrayList<>(List.of(executable,
                "--user-data-dir=" + profile, "--remote-debugging-port=0",
                "--no-first-run", "--no-default-browser-check",
                // Lab targets commonly use self-signed or private-CA certificates (same stance as Repeater).
                "--ignore-certificate-errors",
                // Without this the page sees navigator.webdriver === true and a target with bot detection
                // behaves differently for the Explorer than it did for the operator who just logged in.
                "--disable-blink-features=AutomationControlled"));
        // No Burp listener is involved: FlowScope records this window from DevTools, so its traffic can never be
        // attributed to HUMAN collection and the operator needs no proxy configuration.
        command.add("--no-proxy-server");
        command.add("--new-window");
        command.add(loginUrl.toString());
        return command;
    }

    @Override public Session open(URI loginUrl, Consumer<Exchange> recorder) throws IOException {
        Path executable = resolveExecutable(Path.of(System.getProperty("java.home", ".")));
        if (executable == null) {
            throw new IOException("Chromium/Chrome 실행 파일을 찾지 못했습니다. -Dflowscope.browser.path로 지정하세요.");
        }
        Path profile = Files.createTempDirectory("flowscope-login-browser-");
        List<String> command = arguments(executable.toString(), profile, loginUrl);
        Process process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        try {
            CompletableFuture<Matcher> devtools = new CompletableFuture<>();
            Thread reader = new Thread(() -> drainStderr(process, devtools), "flowscope-login-browser-stderr");
            reader.setDaemon(true);
            reader.start();
            Matcher line = devtools.get(STARTUP_SECONDS, TimeUnit.SECONDS);
            Cdp cdp = Cdp.connect(URI.create(line.group(1)), line.group(2), recorder);
            // Discover every tab (including ones the operator opens) to watch requests and to drive the page.
            cdp.call("Target.setDiscoverTargets", JSON.createObjectNode().put("discover", true));
            return new ChromiumSession(process, profile, cdp);
        } catch (Exception error) {
            stop(process, profile);
            throw new IOException("로그인 브라우저를 시작하지 못했습니다: " + error.getClass().getSimpleName(), error);
        }
    }

    private static void drainStderr(Process process, CompletableFuture<Matcher> devtools) {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                Matcher matcher = DEVTOOLS_LINE.matcher(line);
                if (!devtools.isDone() && matcher.find()) devtools.complete(matcher);
            }
        } catch (IOException ignored) {
            // The process ended; open() times out if DevTools never came up.
        }
        devtools.completeExceptionally(new IOException("browser exited before DevTools started"));
    }

    /** Explicit path, then Burp's bundled Chromium next to Burp's JRE, then a system Chrome/Chromium. */
    static Path resolveExecutable(Path javaHome) {
        String configured = System.getProperty("flowscope.browser.path", "").trim();
        if (!configured.isBlank()) return Files.isExecutable(Path.of(configured)) ? Path.of(configured) : null;
        for (Path dir = javaHome; dir != null; dir = dir.getParent()) {
            for (Path root : List.of(dir.resolve("burpbrowser"), dir.resolve("app").resolve("burpbrowser"))) {
                Path found = newestBurpBrowser(root);
                if (found != null) return found;
            }
        }
        for (String candidate : List.of(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
                System.getenv().getOrDefault("ProgramFiles", "C:\\Program Files") + "\\Google\\Chrome\\Application\\chrome.exe",
                "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser")) {
            Path path = Path.of(candidate);
            if (Files.isExecutable(path)) return path;
        }
        return null;
    }

    private static Path newestBurpBrowser(Path root) {
        if (!Files.isDirectory(root)) return null;
        try (Stream<Path> versions = Files.list(root)) {
            return versions.filter(Files::isDirectory).sorted(Comparator.reverseOrder())
                    .flatMap(version -> Stream.of(
                            version.resolve("Burp Browser.app/Contents/MacOS/Burp Browser"),
                            version.resolve("chrome.exe"), version.resolve("chrome")))
                    .filter(Files::isExecutable).findFirst().orElse(null);
        } catch (IOException error) {
            return null;
        }
    }

    private static void stop(Process process, Path profile) {
        process.descendants().forEach(ProcessHandle::destroyForcibly);
        process.destroyForcibly();
        try { process.waitFor(3, TimeUnit.SECONDS); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        try (Stream<Path> paths = Files.walk(profile)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
        } catch (IOException ignored) {
            // Nothing else can be done here. The directory holds the target's session cookies, not FlowScope
            // state, so an abnormal exit can leave a live session behind in the system temp directory.
        }
    }

    /** Cookie domains from DevTools: a leading dot means "and subdomains"; otherwise host-only. */
    static boolean appliesTo(String cookieDomain, String host) {
        String domain = cookieDomain.toLowerCase(Locale.ROOT);
        String target = host.toLowerCase(Locale.ROOT);
        if (domain.startsWith(".")) return target.equals(domain.substring(1)) || target.endsWith(domain);
        return target.equals(domain);
    }

    /**
     * Lists the interactive elements the Explorer may act on and the visible text. Input values are never read, so a
     * password the operator typed cannot reach the model through a snapshot.
     */
    private static final String SNAPSHOT_SCRIPT = """
            (() => {
              const out = [];
              let n = 0;
              const selector = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],'
                + '[role=menuitem],[role=checkbox],[contenteditable=true]';
              for (const el of document.querySelectorAll(selector)) {
                if (out.length >= 120) break;
                if (el.disabled) continue;
                const box = el.getBoundingClientRect();
                if (box.width < 1 || box.height < 1) continue;
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none') continue;
                const ref = 'e' + (++n);
                el.setAttribute('data-flowscope-ref', ref);
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role')
                  || (tag === 'input' ? 'input:' + (el.getAttribute('type') || 'text') : tag);
                const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder')
                  || el.getAttribute('name') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
                out.push({ ref: ref, role: role, name: name });
              }
              return JSON.stringify({ url: location.href, title: document.title, elements: out,
                text: (document.body ? document.body.innerText : '').slice(0, %d) });
            })()
            """.formatted(PAGE_TEXT_LIMIT);

    private record ChromiumSession(Process process, Path profile, Cdp cdp) implements Session {
        @Override public List<HttpCookie> cookies(URI target) throws IOException {
            JsonNode result = cdp.call("Storage.getCookies");
            List<HttpCookie> cookies = new ArrayList<>();
            long now = System.currentTimeMillis() / 1000;
            for (JsonNode value : result.path("cookies")) {
                if (!appliesTo(value.path("domain").asText(""), target.getHost())) continue;
                HttpCookie cookie = new HttpCookie(value.path("name").asText(), value.path("value").asText());
                cookie.setPath(value.path("path").asText("/"));
                cookie.setSecure(value.path("secure").asBoolean(false));
                cookie.setHttpOnly(value.path("httpOnly").asBoolean(false));
                // Host-only cookies are matched through the store's URI index; only shared domains keep a domain.
                if (value.path("domain").asText("").startsWith(".")) cookie.setDomain(value.path("domain").asText());
                long expires = (long) value.path("expires").asDouble(-1);
                cookie.setMaxAge(expires > 0 ? Math.max(0, expires - now) : -1);
                cookies.add(cookie);
            }
            return cookies;
        }

        @Override public Map<String, String> authHeaders(URI target) {
            return Map.copyOf(cdp.authHeaders.getOrDefault(origin(target), Map.of()));
        }

        @Override public void recording(String runId) { cdp.setRecording(runId); }

        @Override public Page navigate(String url) throws IOException {
            cdp.onPage("Page.navigate", JSON.createObjectNode().put("url", url));
            return settle();
        }

        @Override public Page back() throws IOException {
            evaluate("window.history.back()");
            return settle();
        }

        @Override public Page click(String ref) throws IOException {
            require(evaluate("""
                    (() => { const el = document.querySelector('[data-flowscope-ref=%s]');
                      if (!el) return 'missing';
                      el.scrollIntoView({ block: 'center' });
                      el.click();
                      return 'ok'; })()""".formatted(quote(ref))), ref);
            return settle();
        }

        @Override public Page type(String ref, String text) throws IOException {
            require(evaluate("""
                    (() => { const el = document.querySelector('[data-flowscope-ref=%s]');
                      if (!el) return 'missing';
                      el.focus();
                      const proto = el.tagName === 'TEXTAREA'
                        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
                      if (setter && setter.set) setter.set.call(el, %s); else el.value = %s;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      return 'ok'; })()""".formatted(quote(ref), quote(text), quote(text))), ref);
            return settle();
        }

        @Override public Page snapshot() throws IOException {
            String raw = evaluate(SNAPSHOT_SCRIPT);
            JsonNode page = JSON.readTree(raw == null ? "{}" : raw);
            List<Element> elements = new ArrayList<>();
            for (JsonNode value : page.path("elements")) {
                elements.add(new Element(value.path("ref").asText(), value.path("role").asText(),
                        Masking.maskSecrets(value.path("name").asText())));
            }
            return new Page(page.path("url").asText(""), Masking.maskSecrets(page.path("title").asText("")),
                    elements, Masking.maskBody(page.path("text").asText(""), "text/plain"));
        }

        /** Waits for the document to finish loading so the snapshot shows the page the action produced. */
        private Page settle() throws IOException {
            long deadline = System.currentTimeMillis() + LOAD_TIMEOUT_MILLIS;
            while (System.currentTimeMillis() < deadline) {
                try { Thread.sleep(250); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
                if ("complete".equals(evaluate("document.readyState"))) break;
            }
            return snapshot();
        }

        private static void require(String result, String ref) throws IOException {
            if (!"ok".equals(result)) throw new IOException("화면에서 " + ref + " 요소를 찾지 못했습니다. 다시 snapshot하세요.");
        }

        private String evaluate(String expression) throws IOException {
            JsonNode result = cdp.onPage("Runtime.evaluate", JSON.createObjectNode()
                    .put("expression", expression).put("returnByValue", true));
            if (result.path("exceptionDetails").has("text")) {
                throw new IOException("브라우저에서 동작을 실행하지 못했습니다.");
            }
            JsonNode value = result.path("result").path("value");
            return value.isNull() || value.isMissingNode() ? null : value.asText();
        }

        private static String quote(String value) {
            return JSON.getNodeFactory().textNode(value == null ? "" : value).toString();
        }

        @Override public boolean alive() { return process.isAlive(); }

        @Override public void close() {
            cdp.close();
            stop(process, profile);
        }
    }

    /** Session headers a page's JavaScript attaches itself; same set FlowScope manages for HUMAN sessions. */
    static final java.util.Set<String> AUTH_HEADERS = java.util.Set.of(
            "authorization", "x-csrf-token", "x-xsrf-token", "x-csrftoken");

    static String origin(URI uri) {
        int port = uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        return uri.getScheme().toLowerCase(Locale.ROOT) + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }

    /** Minimal DevTools client: request/response by id over one WebSocket, plus the few events it needs. */
    static final class Cdp implements WebSocket.Listener {
        private final Map<Integer, CompletableFuture<JsonNode>> pending = new ConcurrentHashMap<>();
        /** origin → header name (as sent) → latest value. */
        final Map<String, Map<String, String>> authHeaders = new ConcurrentHashMap<>();
        private final java.util.Set<String> attached = ConcurrentHashMap.newKeySet();
        /** The page the Explorer drives: the most recently attached tab. */
        private final AtomicReference<String> pageSession = new AtomicReference<>();
        private final AtomicInteger ids = new AtomicInteger();
        private final StringBuilder frame = new StringBuilder();
        /** requestId → what the browser has told us so far about that exchange. */
        final Map<String, PendingExchange> inFlight = new ConcurrentHashMap<>();
        /**
         * requestId → headers from {@code requestWillBeSentExtraInfo}, which is the only event carrying Cookie.
         * It may arrive before or after {@code requestWillBeSent}, so what arrives first waits here.
         */
        private final Map<String, Map<String, String>> extraRequestHeaders = new ConcurrentHashMap<>();
        private final AtomicReference<String> recordingRunId = new AtomicReference<>();
        /** Response bodies are fetched off the WebSocket thread; replying there would deadlock the read loop. */
        private final ExecutorService bodies = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "flowscope-browser-bodies");
            thread.setDaemon(true);
            return thread;
        });
        private Consumer<Exchange> recorder = exchange -> { };
        private WebSocket socket;

        /** Event handling without a socket, so the recording rules can be tested against raw CDP frames. */
        static Cdp forEvents(Consumer<Exchange> recorder) {
            Cdp cdp = new Cdp();
            if (recorder != null) cdp.recorder = recorder;
            cdp.setRecording("test-run");
            return cdp;
        }

        void event(JsonNode message) { onEvent(message); }

        void setRecording(String runId) {
            recordingRunId.set(runId);
            inFlight.clear();
            extraRequestHeaders.clear();
        }

        int pendingCookieHeaders() { return extraRequestHeaders.size(); }

        static Cdp connect(URI endpoint, String token, Consumer<Exchange> recorder) throws Exception {
            Cdp cdp = new Cdp();
            if (recorder != null) cdp.recorder = recorder;
            WebSocket.Builder builder = HttpClient.newHttpClient().newWebSocketBuilder();
            if (token != null && !token.isBlank()) builder.header("x-burp-authorization", token);
            cdp.socket = builder.buildAsync(endpoint, cdp).get(10, TimeUnit.SECONDS);
            return cdp;
        }

        JsonNode call(String method) throws IOException {
            return call(method, JSON.createObjectNode());
        }

        JsonNode call(String method, ObjectNode params) throws IOException {
            return send(null, method, params);
        }

        /** Same call, addressed to the page tab rather than the browser. */
        JsonNode onPage(String method, ObjectNode params) throws IOException {
            String session = pageSession.get();
            if (session == null) throw new IOException("브라우저에 열린 페이지가 없습니다.");
            return send(session, method, params);
        }

        private JsonNode send(String sessionId, String method, ObjectNode params) throws IOException {
            int id = ids.incrementAndGet();
            CompletableFuture<JsonNode> response = new CompletableFuture<>();
            pending.put(id, response);
            try {
                ObjectNode request = JSON.createObjectNode().put("id", id).put("method", method);
                request.set("params", params);
                if (sessionId != null) request.put("sessionId", sessionId);
                sendText(request);
                JsonNode message = response.get(30, TimeUnit.SECONDS);
                if (message.has("error")) throw new IOException("DevTools " + method + " failed");
                return message.path("result");
            } catch (IOException error) {
                throw error;
            } catch (Exception error) {
                throw new IOException("DevTools " + method + " unavailable", error);
            } finally {
                pending.remove(id);
            }
        }

        /** One send at a time: Java's WebSocket rejects a send while the previous one is still in flight. */
        private synchronized void sendText(ObjectNode message) {
            socket.sendText(message.toString(), true).join();
        }

        @Override public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            frame.append(data);
            if (last) {
                try {
                    JsonNode message = JSON.readTree(frame.toString());
                    CompletableFuture<JsonNode> waiter = pending.get(message.path("id").asInt(-1));
                    if (waiter != null) waiter.complete(message);
                    else onEvent(message);
                } catch (IOException ignored) {
                    // A malformed frame only loses that event.
                }
                frame.setLength(0);
            }
            webSocket.request(1);
            return null;
        }

        private void onEvent(JsonNode message) {
            String method = message.path("method").asText("");
            JsonNode params = message.path("params");
            switch (method) {
                case "Target.targetCreated", "Target.targetInfoChanged" -> {
                    JsonNode info = params.path("targetInfo");
                    String targetId = info.path("targetId").asText("");
                    if ("page".equals(info.path("type").asText()) && attached.add(targetId)) {
                        fireAndForget(null, "Target.attachToTarget",
                                JSON.createObjectNode().put("targetId", targetId).put("flatten", true));
                    }
                }
                case "Target.attachedToTarget" -> {
                    String session = params.path("sessionId").asText();
                    if (!"page".equals(params.path("targetInfo").path("type").asText())) return;
                    pageSession.set(session);
                    fireAndForget(session, "Network.enable", JSON.createObjectNode());
                    fireAndForget(session, "Page.enable", JSON.createObjectNode());
                }
                case "Target.detachedFromSession" -> pageSession.compareAndSet(params.path("sessionId").asText(), null);
                case "Network.requestWillBeSentExtraInfo" -> {
                    // The only event carrying Cookie: requestWillBeSent reports the headers the page asked for,
                    // not the ones the network stack added. Without this merge every record loses its identity.
                    if (recordingRunId.get() == null) return;
                    String requestId = params.path("requestId").asText();
                    Map<String, String> extra = headers(params.path("headers"));
                    PendingExchange pending = inFlight.get(requestId);
                    if (pending != null) pending.requestHeaders.putAll(extra);
                    else if (extraRequestHeaders.size() < MAX_IN_FLIGHT) extraRequestHeaders.put(requestId, extra);
                }
                case "Network.requestWillBeSent" -> {
                    JsonNode request = params.path("request");
                    URI url;
                    try { url = URI.create(request.path("url").asText("")); }
                    catch (IllegalArgumentException error) { return; }
                    if (url.getHost() == null || url.getScheme() == null) return;
                    request.path("headers").fields().forEachRemaining(header -> {
                        if (AUTH_HEADERS.contains(header.getKey().toLowerCase(Locale.ROOT))) {
                            authHeaders.computeIfAbsent(origin(url), ignored -> new ConcurrentHashMap<>())
                                    .put(header.getKey(), header.getValue().asText());
                        }
                    });
                    String requestId = params.path("requestId").asText();
                    // A redirect reuses the requestId and reports the previous hop here. Overwriting would drop
                    // the 3xx and its Location, which a verdict must never be built without (D-015).
                    JsonNode redirect = params.path("redirectResponse");
                    PendingExchange previous = redirect.isMissingNode() ? null : inFlight.remove(requestId);
                    if (previous != null) {
                        previous.status = redirect.path("status").asInt();
                        previous.responseHeaders = headers(redirect.path("headers"));
                        emitExchange(previous, "");
                    }
                    String runId = recordingRunId.get();
                    if (runId == null || inFlight.size() >= MAX_IN_FLIGHT) return;
                    PendingExchange hop = new PendingExchange(
                            message.path("sessionId").asText(null),
                            request.path("method").asText("GET"), url.toString(),
                            headers(request.path("headers")), request.path("postData").asText(""), runId);
                    Map<String, String> waiting = extraRequestHeaders.remove(requestId);
                    if (waiting != null) hop.requestHeaders.putAll(waiting);
                    inFlight.put(requestId, hop);
                }
                case "Network.responseReceived" -> {
                    PendingExchange pending = inFlight.get(params.path("requestId").asText());
                    if (pending == null) return;
                    pending.status = params.path("response").path("status").asInt();
                    pending.responseHeaders = headers(params.path("response").path("headers"));
                }
                case "Network.loadingFinished" -> {
                    String requestId = params.path("requestId").asText();
                    extraRequestHeaders.remove(requestId);
                    PendingExchange pending = inFlight.remove(requestId);
                    if (pending == null || pending.status == 0) return;
                    bodies.execute(() -> emit(requestId, pending));
                }
                case "Network.loadingFailed" -> {
                    String requestId = params.path("requestId").asText();
                    extraRequestHeaders.remove(requestId);
                    inFlight.remove(requestId);
                }
                default -> { }
            }
        }

        private void emit(String requestId, PendingExchange pending) {
            String body = "";
            try {
                JsonNode result = send(pending.sessionId, "Network.getResponseBody",
                        JSON.createObjectNode().put("requestId", requestId));
                // Binary bodies come back base64; FlowScope analyses text, so they are recorded as empty.
                if (!result.path("base64Encoded").asBoolean(false)) body = result.path("body").asText("");
            } catch (IOException ignored) {
                // Chromium evicts bodies it no longer holds; the exchange is still worth recording without one.
            }
            emitExchange(pending, body);
        }

        /**
         * {@code Network.getResponseBody} hands back the decoded body, so the hop's own Content-Encoding and
         * Content-Length describe bytes FlowScope never sees. Keeping them makes every consumer decode garbage.
         */
        void emitExchange(PendingExchange pending, String body) {
            if (pending == null || !pending.runId.equals(recordingRunId.get())) return;
            Map<String, String> responseHeaders = new java.util.LinkedHashMap<>();
            pending.responseHeaders.forEach((name, value) -> {
                if (!DECODED_AWAY.contains(name.toLowerCase(Locale.ROOT))) responseHeaders.put(name, value);
            });
            try {
                recorder.accept(new Exchange(pending.runId, pending.method, pending.url,
                        Map.copyOf(pending.requestHeaders),
                        pending.requestBody, pending.status, responseHeaders, body));
            } catch (RuntimeException ignored) {
                // One bad record must not stop the browser from being driven.
            }
        }

        private static Map<String, String> headers(JsonNode node) {
            Map<String, String> headers = new java.util.LinkedHashMap<>();
            node.fields().forEachRemaining(entry -> headers.put(entry.getKey(), entry.getValue().asText()));
            return headers;
        }

        /** Command issued from the listener thread; its reply is ignored. */
        private void fireAndForget(String sessionId, String method, ObjectNode params) {
            ObjectNode message = JSON.createObjectNode().put("id", ids.incrementAndGet()).put("method", method);
            message.set("params", params);
            if (sessionId != null) message.put("sessionId", sessionId);
            sendText(message);
        }

        void close() {
            bodies.shutdownNow();
            if (socket != null) socket.abort();
        }
    }

    private static final int MAX_IN_FLIGHT = 512;
    /** Response headers that describe the encoded bytes CDP already decoded away. */
    private static final java.util.Set<String> DECODED_AWAY =
            java.util.Set.of("content-encoding", "content-length", "transfer-encoding");

    /** Mutable while the browser reports a request, a response, and finally the end of the body. */
    static final class PendingExchange {
        private final String sessionId;
        private final String method;
        private final String url;
        /** Mutable: Cookie arrives in a separate event and is merged in after construction. */
        private final Map<String, String> requestHeaders;
        private final String requestBody;
        private final String runId;
        private volatile int status;
        private volatile Map<String, String> responseHeaders = Map.of();

        private PendingExchange(String sessionId, String method, String url,
                                Map<String, String> requestHeaders, String requestBody, String runId) {
            this.sessionId = sessionId;
            this.method = method;
            this.url = url;
            this.requestHeaders = new java.util.concurrent.ConcurrentHashMap<>(requestHeaders);
            this.requestBody = requestBody;
            this.runId = runId;
        }
    }
}
