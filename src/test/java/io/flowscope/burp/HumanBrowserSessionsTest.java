package io.flowscope.burp;

import burp.api.montoya.burpsuite.BurpSuite;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import io.flowscope.explorer.HumanChromiumBrowser;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Proxy;
import java.net.BindException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class HumanBrowserSessionsTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static RunContextRegistry.Context context(String run, String account) {
        return new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, run, account);
    }

    @Test void automaticallyBindsThreeAccountsAndStopsOnlyTheSelectedWindow() throws Exception {
        try (var burp = new FakeBurp()) {
            Map<Integer, FakeWindow> windows = new HashMap<>();
            try (var sessions = new HumanBrowserSessions(new HumanProxyListeners(burp.api, Set.of(8080, 8081, 8082)),
                    (target, port) -> { var window = new FakeWindow(); windows.put(port, window); return window; })) {
                URI target = URI.create("http://127.0.0.1:9999/");
                sessions.start(context("a", "A"), target);
                sessions.start(context("b", "B"), target);
                sessions.start(context("anon", null), target);
                int a = sessions.port("a"), b = sessions.port("b"), anon = sessions.port("anon");
                assertEquals(3, Set.of(a, b, anon).size());
                assertTrue(a >= 18080 && b > a && anon > b);
                assertEquals("A", sessions.context(a).accountId());
                assertEquals("B", sessions.context(b).accountId());
                assertNull(sessions.context(anon).accountId());
                assertNull(sessions.context(8080));
                assertEquals(4, burp.entries().size());
                sessions.stop("a");
                assertFalse(windows.get(a).alive());
                assertNull(sessions.context(a));
                assertFalse(sessions.ownsPort(a)); // A user may reuse the retired listener port.
                assertTrue(sessions.alive("b"));
                assertTrue(sessions.alive("anon"));
                assertEquals(3, burp.entries().size());
            }
            assertEquals(1, burp.entries().size());
            assertTrue(windows.values().stream().noneMatch(FakeWindow::alive));
            assertEquals("original", burp.config.path("unrelated").asText());
            assertEquals(8080, burp.entries().get(0).path("listener_port").asInt());
        }
    }

    @Test void reusesTheSameAccountPortAfterRestartWithoutChangingAnotherAccount() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            URI target = URI.create("http://localhost/");
            sessions.start(context("a", "A"), target);
            sessions.start(context("b", "B"), target);
            int a = sessions.port("a"), b = sessions.port("b");
            sessions.stop("a");
            sessions.start(context("a-restarted", "A"), target);
            assertEquals(a, sessions.port("a-restarted"));
            assertEquals(b, sessions.port("b"));
            assertEquals("a-restarted", sessions.context(a).runId());
            assertTrue(sessions.alive("b"));
        }
    }

    @Test void releasesOwnershipWhilePreservingAUserModifiedListener() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            sessions.start(context("a", "A"), URI.create("http://localhost/"));
            int port = sessions.port("a");
            var entry = (ObjectNode) burp.entries().get(1);
            entry.put("certificate_mode", "user_modified");
            sessions.stop("a");
            assertFalse(sessions.ownsPort(port));
            assertEquals(2, burp.entries().size());
            assertEquals("user_modified", burp.entries().get(1).path("certificate_mode").asText());
        }
    }

    @Test void listenerCleanupDoesNotHoldLocksNeededByProxyCallbacks() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            URI target = URI.create("http://localhost/");
            sessions.start(context("a", "A"), target);
            sessions.start(context("b", "B"), target);
            int a = sessions.port("a"), b = sessions.port("b");
            burp.beforeImport = () -> assertTimeoutPreemptively(java.time.Duration.ofSeconds(2), () -> {
                assertNull(sessions.context(a));
                assertEquals("B", sessions.context(b).accountId());
                assertTrue(sessions.ownsPort(b));
            });
            try { sessions.stop("a"); }
            finally { burp.beforeImport = () -> {}; }
            assertTrue(sessions.alive("b"));
            assertFalse(sessions.ownsPort(a));
        }
    }

    @Test void restartingAnAccountSkipsItsPortWhenTheOperatorKeptTheListener() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            URI target = URI.create("http://localhost/");
            sessions.start(context("a", "A"), target);
            int original = sessions.port("a");
            ((ObjectNode) burp.entries().get(1)).put("certificate_mode", "user_modified");
            sessions.stop("a");
            sessions.start(context("again", "A"), target);
            assertNotEquals(original, sessions.port("again"));
            assertEquals("user_modified", burp.entries().get(1).path("certificate_mode").asText());
            assertEquals(original, burp.entries().get(1).path("listener_port").asInt());
        }
    }

    @Test void restartingAnAccountSkipsItsPortWhenAnotherProcessUsesIt() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            URI target = URI.create("http://localhost/");
            sessions.start(context("a", "A"), target);
            int original = sessions.port("a");
            sessions.stop("a");
            try (var occupied = new ServerSocket(original, 1, InetAddress.getByName("127.0.0.1"))) {
                sessions.start(context("again", "A"), target);
                int replacement = sessions.port("again");
                assertNotEquals(original, replacement);
                sessions.stop("again");
                sessions.start(context("third", "A"), target);
                assertEquals(replacement, sessions.port("third"));
                assertFalse(occupied.isClosed());
            }
        }
    }

    @Test void browserFailureRemovesItsListenerAndKeepsExistingSettings() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> { throw new IOException("launch failed"); })) {
            assertThrows(IOException.class, () -> sessions.start(context("a", "A"), URI.create("http://localhost/")));
            assertEquals(-1, sessions.port("a"));
            assertFalse(sessions.alive("a"));
            assertEquals(1, burp.entries().size());
        }
    }

    @Test void failedListenerRemovalRetainsOnlyCleanupStateAndCanBeRetried() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new FakeWindow())) {
            sessions.start(context("a", "A"), URI.create("http://localhost/"));
            int port = sessions.port("a");
            burp.failNextImport = true;
            assertThrows(IllegalStateException.class, () -> sessions.stop("a"));
            assertTrue(sessions.contains("a"));
            assertFalse(sessions.alive("a"));
            assertNull(sessions.context(port), "A closing listener must not collect more requests");
            assertEquals(2, burp.entries().size());
            sessions.stop("a");
            assertFalse(sessions.contains("a"));
            assertEquals(1, burp.entries().size());
        }
    }

    @Test void windowCloseFailureStillRemovesTheListenerAndRetainsARetry() throws Exception {
        var failClose = new java.util.concurrent.atomic.AtomicBoolean(true);
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> new HumanChromiumBrowser.Window() {
                    @Override public boolean alive() { return true; }
                    @Override public void close() { if (failClose.getAndSet(false)) throw new IllegalStateException("close failed"); }
                })) {
            sessions.start(context("a", "A"), URI.create("http://localhost/"));
            assertThrows(IllegalStateException.class, () -> sessions.stop("a"));
            assertTrue(sessions.contains("a"));
            assertFalse(sessions.alive("a"));
            assertEquals(1, burp.entries().size());
            sessions.stop("a");
            assertFalse(sessions.contains("a"));
        }
    }

    @Test void launchAndCleanupFailureKeepTheListenerForALaterRetry() throws Exception {
        try (var burp = new FakeBurp(); var sessions = new HumanBrowserSessions(
                new HumanProxyListeners(burp.api, Set.of(8080)), (target, port) -> {
                    burp.failNextImport = true;
                    throw new IOException("launch failed");
                })) {
            IOException failure = assertThrows(IOException.class,
                    () -> sessions.start(context("a", "A"), URI.create("http://localhost/")));
            assertEquals(1, failure.getSuppressed().length);
            assertTrue(sessions.contains("a"));
            assertFalse(sessions.alive("a"));
            assertNull(sessions.context(sessions.port("a")));
            sessions.stop("a");
            assertFalse(sessions.contains("a"));
            assertEquals(1, burp.entries().size());
        }
    }

    @Test void listenerBindFailureIsRetriedBeforeLaunchingTheBrowser() throws Exception {
        try (var burp = new FakeBurp(); var listeners = new HumanProxyListeners(burp.api, Set.of(8080))) {
            burp.failNextBind = true;
            int port = listeners.open();
            assertTrue(port > 0);
            assertEquals(2, burp.entries().size());
            assertTrue(burp.sockets.containsKey(port));
        }
    }

    @Test void supportsTheUnwrappedProjectConfigurationReturnedByActualBurp() throws Exception {
        try (var burp = new FakeBurp(true); var listeners = new HumanProxyListeners(burp.api, Set.of(8080))) {
            int port = listeners.open();
            assertTrue(burp.sockets.containsKey(port));
            listeners.remove(port);
            assertEquals(1, burp.entries().size());
        }
    }

    @Test void cleanupPreservesAnOwnedListenerTheOperatorChanged() throws Exception {
        try (var burp = new FakeBurp(); var listeners = new HumanProxyListeners(burp.api, Set.of(8080))) {
            int port = listeners.open();
            for (JsonNode entry : burp.entries()) {
                if (entry.path("listener_port").asInt() == port) ((ObjectNode) entry).put("listen_mode", "all_interfaces");
            }
            listeners.remove(port);
            assertEquals(2, burp.entries().size());
            assertEquals("all_interfaces", burp.entries().get(1).path("listen_mode").asText());
        }
    }

    @Test void allocatesIncreasingPortsFrom18080SkippingReservedOccupiedAndConfiguredPorts() throws Exception {
        try (var burp = new FakeBurp(); var occupied = firstAvailableSocket(18081)) {
            int configuredPort;
            try (var available = firstAvailableSocket(occupied.getLocalPort() + 1)) {
                configuredPort = available.getLocalPort();
            }
            ((com.fasterxml.jackson.databind.node.ArrayNode) burp.entries()).addObject()
                    .put("listener_port", configuredPort).put("running", false).put("listen_mode", "loopback_only");
            int expected;
            try (var available = firstAvailableSocket(configuredPort + 1)) { expected = available.getLocalPort(); }
            try (var listeners = new HumanProxyListeners(burp.api, Set.of(18080))) {
                int first = listeners.open();
                assertEquals(expected, first);
                int next;
                try (var available = firstAvailableSocket(first + 1)) { next = available.getLocalPort(); }
                int second = listeners.open();
                assertEquals(next, second);
                listeners.remove(first);
                int third = listeners.open();
                assertTrue(third > second, "Retired ports must not receive another account's late requests");
                assertFalse(occupied.isClosed());
                assertEquals(2, burp.entries().size() - burp.sockets.size());
            }
        }
    }

    private static ServerSocket firstAvailableSocket(int start) throws IOException {
        for (int port = start; port <= 65535; port++) {
            try { return new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1")); }
            catch (BindException occupied) { /* Try the next port. */ }
        }
        throw new IOException("No available test port");
    }

    private static final class FakeWindow implements HumanChromiumBrowser.Window {
        boolean alive = true;
        @Override public boolean alive() { return alive; }
        @Override public void close() { alive = false; }
    }

    /** Models configuration import plus actual loopback binding, including normalized fields and a failed bind. */
    private static final class FakeBurp implements AutoCloseable {
        ObjectNode config = JSON.createObjectNode();
        Map<Integer, ServerSocket> sockets = new HashMap<>();
        boolean failNextBind;
        boolean failNextImport;
        Runnable beforeImport = () -> {};
        final BurpSuite api;
        FakeBurp() { this(false); }
        FakeBurp(boolean modern) {
            config.put("unrelated", "original");
            config.putObject("project_options").putObject("proxy").putArray("request_listeners")
                    .addObject().put("listener_port", 8080).put("running", false).put("listen_mode", "loopback_only");
            api = (BurpSuite) Proxy.newProxyInstance(BurpSuite.class.getClassLoader(), new Class<?>[]{BurpSuite.class},
                    (proxy, method, args) -> {
                        if (method.getName().equals("exportProjectOptionsAsJson")) {
                            if (modern) {
                                assertEquals("proxy.request_listeners", ((String[]) args[0])[0]);
                                return config.path("project_options").toString();
                            }
                            return config.toString();
                        }
                        if (method.getName().equals("importProjectOptionsFromJson")) {
                            beforeImport.run();
                            if (failNextImport) { failNextImport = false; throw new IllegalStateException("import failed"); }
                            var importedConfig = JSON.readTree((String) args[0]);
                            var imported = (modern ? importedConfig : importedConfig.path("project_options"))
                                    .path("proxy").path("request_listeners");
                            for (int port : Set.copyOf(sockets.keySet())) {
                                boolean keep = false;
                                for (JsonNode entry : imported) if (entry.path("listener_port").asInt() == port) keep = true;
                                if (!keep) sockets.remove(port).close();
                            }
                            for (JsonNode entry : imported) {
                                ((ObjectNode) entry).put("use_custom_tls_protocols", false);
                                int port = entry.path("listener_port").asInt();
                                if (entry.path("running").asBoolean() && !sockets.containsKey(port)) {
                                    if (failNextBind) { ((ObjectNode) entry).put("running", false); failNextBind = false; }
                                    else sockets.put(port, new ServerSocket(port, 50, InetAddress.getByName("127.0.0.1")));
                                }
                            }
                            ((ObjectNode) config.path("project_options").path("proxy")).set("request_listeners", imported);
                            return null;
                        }
                        throw new UnsupportedOperationException(method.getName());
                    });
        }
        JsonNode entries() { return config.path("project_options").path("proxy").path("request_listeners"); }
        @Override public void close() throws IOException { for (var socket : sockets.values()) socket.close(); }
    }
}
