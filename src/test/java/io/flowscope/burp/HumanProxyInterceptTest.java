package io.flowscope.burp;

import burp.api.montoya.MontoyaApi;
import burp.api.montoya.burpsuite.BurpSuite;
import burp.api.montoya.core.Annotations;
import burp.api.montoya.http.HttpService;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.internal.MontoyaObjectFactory;
import burp.api.montoya.internal.ObjectFactoryLocator;
import burp.api.montoya.logging.Logging;
import burp.api.montoya.proxy.MessageReceivedAction;
import burp.api.montoya.proxy.MessageToBeSentAction;
import burp.api.montoya.proxy.http.*;
import io.flowscope.core.*;
import io.flowscope.integration.SessionBroker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;

import static org.junit.jupiter.api.Assertions.*;

@ResourceLock("MontoyaObjectFactory")
class HumanProxyInterceptTest {
    private static final String TARGET = "https://app.test:443/api";

    @Test void editedForwardLearnsOnlyFinalCredentials() throws Exception {
        try (var f = new Fixture()) {
            f.startHuman();
            var held = request(1, 18080, TARGET, Map.of("Cookie", "session=old"), "");
            assertEquals(MessageReceivedAction.CONTINUE, f.requests.handleRequestReceived(held).action());
            assertTrue(f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=old"), Instant.now()).isEmpty());
            assertNull(f.broker.viewForAccount("a").orElseThrow().lastRecordedApi());
            assertEquals(MessageToBeSentAction.CONTINUE, f.requests.handleRequestToBeSent(
                    request(1, 18080, TARGET, Map.of("Cookie", "session=edited"), "")).action());
            assertEquals("a", f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=edited"), Instant.now()).orElseThrow());
            assertTrue(f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=old"), Instant.now()).isEmpty());
            assertEquals("a", f.tracker.get(1).humanCaptureAccountId());
            assertFalse(f.tracker.get(1).humanCaptureSuppressed());
        }
    }

    @Test void removingOrAddingCredentialsUpdatesResponseContext() throws Exception {
        try (var f = new Fixture()) {
            f.startHuman();
            f.requests.handleRequestReceived(request(2, 18080, TARGET, Map.of("Cookie", "session=removed"), ""));
            f.requests.handleRequestToBeSent(request(2, 18080, TARGET, Map.of(), ""));
            assertNull(f.tracker.get(2).humanCaptureAccountId());
            assertTrue(f.tracker.get(2).humanCaptureSuppressed());
            assertTrue(f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=removed"), Instant.now()).isEmpty());
            f.requests.handleRequestReceived(request(3, 18080, TARGET, Map.of(), ""));
            f.requests.handleRequestToBeSent(request(3, 18080, TARGET, Map.of("Authorization", "Bearer added"), ""));
            assertEquals("a", f.tracker.get(3).humanCaptureAccountId());
            assertFalse(f.tracker.get(3).humanCaptureSuppressed());
            assertEquals("a", f.broker.accountForRequest(URI.create(TARGET), Map.of("Authorization", "Bearer added"), Instant.now()).orElseThrow());
        }
    }

    @Test void closedWindowDropsHeldRequestWhileItsRunIsStillAnalyzing() throws Exception {
        try (var f = new Fixture()) {
            f.startHuman();
            var held = request(4, 18080, TARGET, Map.of("Cookie", "session=held"), "");
            f.requests.handleRequestReceived(held);
            ((Map<?, ?>) get(f.sessions, "sessions")).clear();
            assertEquals(MessageToBeSentAction.DROP, f.requests.handleRequestToBeSent(held).action());
            assertNull(f.tracker.get(4));
            assertTrue(f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=held"), Instant.now()).isEmpty());
        }
    }

    @Test void pausedHumanStillUsesInterceptRulesWithoutLearningCredentials() throws Exception {
        try (var f = new Fixture()) {
            f.startHuman();
            ((RunContextRegistry) get(f.extension, "runContexts")).pauseHuman("human-a", true);
            var request = request(5, 18080, TARGET, Map.of("Cookie", "session=paused"), "");
            assertEquals(MessageReceivedAction.CONTINUE, f.requests.handleRequestReceived(request).action());
            assertEquals(MessageToBeSentAction.CONTINUE, f.requests.handleRequestToBeSent(request).action());
            assertTrue(f.broker.accountForRequest(URI.create(TARGET), Map.of("Cookie", "session=paused"), Instant.now()).isEmpty());
        }
    }

    @Test void scannerAndLlmKeepTheirExistingActionsAndScopeGate() throws Exception {
        try (var f = new Fixture()) {
            for (int port : new int[]{8081, 8082}) {
                var request = request(port, port, TARGET, Map.of(), "");
                assertEquals(MessageReceivedAction.CONTINUE, f.requests.handleRequestReceived(request).action());
                assertEquals(MessageToBeSentAction.CONTINUE, f.requests.handleRequestToBeSent(request).action());
                assertEquals(port == 8081 ? Source.SCANNER : Source.LLM, f.tracker.get(port).source());
                assertEquals(MessageReceivedAction.DROP, f.requests.handleRequestReceived(
                        request(port + 10, port, "https://outside.test/api", Map.of(), "")).action());
            }
        }
    }

    private static final class Fixture implements AutoCloseable {
        final FlowScopeExtension extension = new FlowScopeExtension();
        final MontoyaObjectFactory previous = ObjectFactoryLocator.FACTORY;
        final HumanBrowserSessions sessions;
        final ProxyRequestHandler requests;
        final SessionBroker broker;
        final InFlightRequestTracker tracker;

        Fixture() throws Exception {
            ObjectFactoryLocator.FACTORY = proxy(MontoyaObjectFactory.class, (unused, method, args) -> {
                if (!method.getName().contains("InterceptResult")) {
                    throw new AssertionError(method.getName());
                }
                String name = method.getName();
                Object action = name.contains("Final")
                        ? name.endsWith("Drop") ? MessageToBeSentAction.DROP : MessageToBeSentAction.CONTINUE
                        : name.endsWith("Drop") ? MessageReceivedAction.DROP
                        : name.endsWith("DoNotIntercept") ? MessageReceivedAction.DO_NOT_INTERCEPT : MessageReceivedAction.CONTINUE;
                return proxy(method.getReturnType(), (self, actionMethod, actionArgs) -> switch (actionMethod.getName()) {
                    case "request", "response" -> args == null ? null : args[0];
                    case "annotations" -> args != null && args.length > 1 ? args[1] : annotations("");
                    case "action" -> action;
                    default -> throw new AssertionError(actionMethod.getName());
                });
            });
            set(extension, "api", proxy(MontoyaApi.class, (unused, method, args) -> {
                if (method.getName().equals("logging")) return proxy(Logging.class, (self, operation, values) -> null);
                throw new AssertionError(method.getName());
            }));
            set(extension, "scope", ScopePolicy.parse("https://app.test/"));
            var burp = proxy(BurpSuite.class, (unused, method, args) -> { throw new AssertionError(method.getName()); });
            sessions = new HumanBrowserSessions(new HumanProxyListeners(burp, Set.of(8080, 8081, 8082)),
                    (target, port) -> { throw new AssertionError("No browser needed for handler tests"); });
            set(extension, "humanBrowsers", sessions);
            requests = handler("ProxyScopeHandler", ProxyRequestHandler.class);
            broker = (SessionBroker) get(extension, "sessionBroker");
            tracker = (InFlightRequestTracker) get(extension, "proxyObservations");
        }

        <T> T handler(String name, Class<T> type) throws Exception {
            var constructor = Class.forName(FlowScopeExtension.class.getName() + "$" + name)
                    .getDeclaredConstructor(FlowScopeExtension.class);
            constructor.setAccessible(true);
            return type.cast(constructor.newInstance(extension));
        }

        void startHuman() throws Exception {
            var context = new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                    ToolKind.BROWSER, RunPhase.EXPLORATION, "human-a", "a");
            ((RunContextRegistry) get(extension, "runContexts")).activateHuman(context);
            broker.beginCapture(new AccountProfile("a", "A", "https://app.test", AccessRole.USER), Instant.now());
            var constructor = Class.forName(HumanBrowserSessions.class.getName() + "$Session").getDeclaredConstructors()[0];
            constructor.setAccessible(true);
            @SuppressWarnings("unchecked") var windows = (Map<String, Object>) get(sessions, "sessions");
            windows.put("human-a", constructor.newInstance(context, 18080, null, false));
        }

        @Override public void close() throws Exception {
            ObjectFactoryLocator.FACTORY = previous;
            broker.close();
            ((ExecutorService) get(extension, "worker")).shutdownNow();
            ((ExecutorService) get(extension, "authorizationReplayWorker")).shutdownNow();
        }
    }

    private static InterceptedRequest request(int id, int port, String url, Map<String, String> headers, String notes) {
        URI uri = URI.create(url);
        return proxy(InterceptedRequest.class, (unused, method, args) -> switch (method.getName()) {
            case "messageId" -> id;
            case "listenerInterface" -> "127.0.0.1:" + port;
            case "url" -> url;
            case "method" -> "GET";
            case "pathWithoutQuery" -> uri.getPath();
            case "annotations" -> annotations(notes);
            case "headerValue" -> headers.entrySet().stream().filter(value -> value.getKey().equalsIgnoreCase((String) args[0]))
                    .map(Map.Entry::getValue).findFirst().orElse(null);
            case "headers" -> headers.entrySet().stream().map(value -> proxy(HttpHeader.class, (self, operation, values) ->
                    operation.getName().equals("name") ? value.getKey() : value.getValue())).toList();
            case "httpService" -> proxy(HttpService.class, (self, operation, values) -> switch (operation.getName()) {
                case "host" -> uri.getHost();
                case "port" -> uri.getPort() < 0 ? 443 : uri.getPort();
                case "secure" -> true;
                default -> throw new AssertionError(operation.getName());
            });
            default -> throw new AssertionError(method.getName());
        });
    }

    private static Annotations annotations(String notes) {
        return proxy(Annotations.class, (unused, method, args) -> switch (method.getName()) {
            case "notes" -> notes;
            case "withNotes" -> annotations((String) args[0]);
            default -> throw new AssertionError(method.getName());
        });
    }

    private static Object get(Object instance, String name) throws Exception {
        var field = instance.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(instance);
    }

    private static void set(Object instance, String name, Object value) throws Exception {
        var field = instance.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(instance, value);
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
}
