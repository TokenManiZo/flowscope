package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/** 실제 ZAP/Chromium 전용 opt-in. upstream은 외부로 전달하지 않고 이 fixture만 제공한다. */
@EnabledIfSystemProperty(named = "flowscope.zap.harness", matches = "true")
final class ZapChromiumRuntimeHarnessTest {
    private static final String TARGET = "http://flowscope-runtime.test/";

    @Test
    void clientSpiderLoadsExternalScriptAndObservesItsInScopeApiCall() throws Exception {
        try (Fixture fixture = new Fixture(); ZapCampaign campaign = new ZapCampaign(fixture)) {
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);
            assertTrue(result.path("status").asText().startsWith("COMPLETED"), result.toString());
            assertTrue(fixture.assetHits.get() > 0, "Client Spider must load the page-linked external script");
            assertTrue(fixture.observations.stream().anyMatch(value -> value.path().equals("/api/public-probe")
                    && value.detail() == SourceDetail.ZAP_CLIENT_SPIDER),
                    "the external script must be able to call the in-scope API: " + fixture.observations);
        }
    }

    @Test
    void crawlsAnonymousAndTwoAuthenticatedUsersAndRejectsWrongPassword() throws Exception {
        try (Fixture fixture = new Fixture(); ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.account("zap-a", "alice", "test-password-a");
            fixture.account("zap-b", "bob", "test-password-b");
            campaign.startDeterministicZapCampaign(TARGET, List.of("zap-a", "zap-b"), true);
            JsonNode result = awaitTerminal(campaign);
            assertTrue(result.path("status").asText().startsWith("COMPLETED"), result.toString());
            for (String user : List.of("alice", "bob")) {
                String account = user.equals("alice") ? "zap-a" : "zap-b";
                assertTrue(fixture.observations.stream().anyMatch(value ->
                        account.equals(value.account()) && user.equals(value.user())
                                && value.path().equals("/api/me")
                                && value.detail() == SourceDetail.ZAP_CLIENT_SPIDER),
                        "Client must actually receive the logged-in API for " + account + ": " + fixture.observations);
            }
            assertTrue(fixture.observations.stream().noneMatch(value ->
                    value.detail() == SourceDetail.ZAP_CLIENT_SPIDER && value.account() != null
                            && !value.user().equals("anonymous")
                            && !value.user().equals(value.account().equals("zap-a") ? "alice" : "bob")),
                    "one account must not receive the other account's session");
            assertEquals(0, fixture.rejections.get(), "every scoped crawler/auth request needs capability");
            assertNull(fixture.contexts.current(Source.SCANNER));
            System.out.println("Real ZAP Chromium: anonymous + two authenticated Client lanes completed; requests="
                    + fixture.observations.size());

            campaign.resetWorkflow();
            fixture.account("zap-wrong", "alice", "incorrect-test-password");
            campaign.startDeterministicZapCampaign(TARGET, List.of("zap-wrong"), false);
            JsonNode rejected = awaitTerminal(campaign);
            assertEquals("FAILED", rejected.path("status").asText(), rejected.toString());
            assertFalse(fixture.observations.stream().anyMatch(value ->
                    "zap-wrong".equals(value.account()) && value.detail() == SourceDetail.ZAP_CLIENT_SPIDER));
            assertNull(fixture.contexts.current(Source.SCANNER));
            System.out.println("Real ZAP Chromium: wrong password rejected before authenticated Client crawl");
        }
    }

    private static JsonNode awaitTerminal(ZapCampaign campaign) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(8);
        String previous = "";
        while (System.nanoTime() < deadline) {
            JsonNode status = campaign.deterministicZapBaselineStatus();
            String progress = status.path("stage").asText();
            if (!progress.equals(previous)) {
                System.out.println("Real ZAP stage: " + progress);
                previous = progress;
            }
            if (!"RUNNING".equals(status.path("status").asText())) return status;
            Thread.sleep(500);
        }
        campaign.cancelDeterministicZapBaseline();
        throw new AssertionError("real ZAP campaign exceeded eight minutes");
    }

    private record Observation(String path, String account, String user, SourceDetail detail) {}

    private static final class Fixture implements ZapCampaign.State, AutoCloseable {
        private final HttpServer proxy;
        private final ExecutorService executor = Executors.newCachedThreadPool();
        private final ZapClient client;
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final ZapAccountVault accounts = new ZapAccountVault();
        private final List<RequestRecord> records = new CopyOnWriteArrayList<>();
        private final List<Observation> observations = new CopyOnWriteArrayList<>();
        private final Map<String, String> sessions = new ConcurrentHashMap<>();
        private final AtomicLong rejections = new AtomicLong();
        private final AtomicLong assetHits = new AtomicLong();
        private volatile String capability = "";

        Fixture() throws IOException {
            int apiPort = Integer.getInteger("flowscope.zap.harness.apiPort", 18889);
            int proxyPort = Integer.getInteger("flowscope.zap.harness.proxyPort", 18881);
            if (apiPort == 8089 || proxyPort == 8081) {
                throw new IllegalArgumentException("the harness must use dedicated ports, not the user's ZAP/Burp");
            }
            String key = LocalZapApiKey.resolve(null, null,
                    System.getProperty("flowscope.zap.harness.keyFile"),
                    Path.of(System.getProperty("user.home"), ".flowscope", "zap-api-key"));
            client = new ZapClient("http://127.0.0.1:" + apiPort, key);
            proxy = HttpServer.create(new InetSocketAddress("127.0.0.1", proxyPort), 0);
            proxy.createContext("/", this::serve);
            proxy.setExecutor(executor);
            proxy.start();
        }

        void account(String id, String username, String password) {
            accounts.save(new ZapAccountVault.Input(id, id, "USER", TARGET, TARGET + "login",
                    username, password, "Signed in", "Invalid username or password"));
        }

        private void serve(HttpExchange exchange) throws IOException {
            URI uri = exchange.getRequestURI();
            if ("flowscope-assets.test".equals(uri.getHost()) && uri.getPath().equals("/main.js")) {
                assetHits.incrementAndGet();
                reply(exchange, 200, "application/javascript", "fetch('/api/public-probe')");
                return;
            }
            if (!"flowscope-runtime.test".equals(uri.getHost())) {
                reply(exchange, 403, "text/plain", "fixture origin only");
                return;
            }
            RunContextRegistry.Context current = contexts.current(Source.SCANNER);
            if (current != null && !capability.equals(exchange.getRequestHeaders()
                    .getFirst("X-FlowScope-Scanner-Capability"))) {
                rejections.incrementAndGet();
                reply(exchange, 403, "text/plain", "missing campaign capability");
                return;
            }
            String cookie = Optional.ofNullable(exchange.getRequestHeaders().getFirst("Cookie")).orElse("");
            String user = Arrays.stream(cookie.split(";"))
                    .map(String::trim).filter(value -> value.startsWith("runtime_session="))
                    .map(value -> sessions.getOrDefault(value.substring("runtime_session=".length()), "anonymous"))
                    .findFirst().orElse("anonymous");
            String path = uri.getPath();
            int status = 200;
            String type = "text/html; charset=UTF-8";
            String body;
            if (path.equals("/login") && exchange.getRequestMethod().equals("POST")) {
                Map<String, String> form = new HashMap<>();
                for (String pair : new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8).split("&")) {
                    String[] parts = pair.split("=", 2);
                    if (parts.length == 2) form.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                            URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
                }
                String name = form.get("username");
                String expected = "alice".equals(name) ? "test-password-a" : "bob".equals(name) ? "test-password-b" : null;
                if (expected != null && expected.equals(form.get("password"))) {
                    String token = UUID.randomUUID().toString();
                    sessions.put(token, name);
                    exchange.getResponseHeaders().add("Set-Cookie", "runtime_session=" + token + "; Path=/; HttpOnly; SameSite=Lax");
                    exchange.getResponseHeaders().add("Location", "/dashboard");
                    status = 302;
                    body = "Signed in";
                } else {
                    status = 401;
                    body = loginPage("Invalid username or password");
                }
            } else if (path.equals("/login")) {
                body = loginPage("");
            } else if (path.equals("/api/me")) {
                status = user.equals("anonymous") ? 401 : 200;
                type = "application/json";
                body = "{\"username\":\"" + user + "\"}";
            } else if (path.equals("/api/public-probe")) {
                type = "application/json";
                body = "{\"available\":true}";
            } else if (path.equals("/dashboard") || path.equals("/details")) {
                if (user.equals("anonymous")) {
                    exchange.getResponseHeaders().add("Location", "/login");
                    status = 302;
                    body = "Login required";
                } else {
                    body = "<!doctype html><title>Account</title><h1>Welcome " + user
                            + "</h1><p>Logged in</p><a href='/details'>Account details</a>"
                            + "<script>fetch('/api/me').then(r=>r.json()).then(u=>document.title=u.username)</script>";
                }
            } else {
                body = "<!doctype html><title>Runtime fixture</title><a href='/login'>Log in</a>"
                        + "<a href='/public'>Public page</a>"
                        + "<script src='http://flowscope-assets.test/main.js'></script>";
            }
            if (current != null) {
                observations.add(new Observation(path, current.accountId(), user, current.detail()));
                RequestRecord record = new RequestRecord(Source.SCANNER, TARGET.substring(0, TARGET.length()-1) + ":80",
                        exchange.getRequestMethod(), path, status, "anon");
                record.hasResponse = true;
                record.responseContentType = type;
                record.body = body;
                record.sourceDetail = current.detail();
                record.orchestrator = current.orchestrator();
                record.tool = current.tool();
                record.phase = current.phase();
                record.runId = current.runId();
                record.laneAccountId = current.accountId();
                record.executionTrust = ExecutionTrust.CONTROLLED;
                records.add(record);
            }
            reply(exchange, status, type, body);
        }

        private static String loginPage(String message) {
            return "<!doctype html><title>Login</title><h1>Log in</h1><p>" + message
                    + "</p><form method='post' action='/login'><label>Username<input name='username' autocomplete='username'></label>"
                    + "<label>Password<input name='password' type='password' autocomplete='current-password'></label>"
                    + "<button type='submit'>Log in</button></form>";
        }

        private static void reply(HttpExchange exchange, int status, String type, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", type);
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        }

        @Override public Pipeline.Result snapshot() { return Pipeline.run(List.copyOf(records)); }
        @Override public List<RequestRecord> authenticationEvidence(String runId, String accountId) {
            return records.stream()
                    .filter(record -> runId.equals(record.runId)
                            && accountId.equals(record.laneAccountId))
                    .toList();
        }
        @Override public ScopePolicy scope() { return ScopePolicy.parse(TARGET); }
        @Override public ZapClient zap() { return client; }
        @Override public int scannerProxyPort() { return proxy.getAddress().getPort(); }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public ZapAccountVault zapAccounts() { return accounts; }
        @Override public boolean approve(String action, String target) { return false; }
        @Override public void scannerCapability(String runId, String value) { capability = value; }
        @Override public void clearScannerCapability(String runId) { capability = ""; }
        @Override public long scannerCapabilityRejections(String runId) { return rejections.get(); }
        @Override public void close() { proxy.stop(0); executor.shutdownNow(); accounts.close(); }
    }
}
