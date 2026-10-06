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
import io.flowscope.explorer.ExplorerBrowserProxy;
import io.flowscope.integration.SessionBroker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;

import static org.junit.jupiter.api.Assertions.*;

@ResourceLock("MontoyaObjectFactory")
class FlowScopeProxyRoutingTest {
    private static final String TARGET = "https://app.test:443/api";

    @Test void ownedLlmBrowserPreservesAuthAndRestoresAgentWithoutProxyEvidence() throws Exception {
        try (var f = new Fixture()) {
            var browserProxy = new ExplorerBrowserProxy(8082);
            set(f.extension, "explorerBrowserProxy", browserProxy);
            var tag = ExplorerBrowserProxy.class.getDeclaredMethod("tagUserAgent", String.class);
            tag.setAccessible(true);
            String agent = (String) tag.invoke(browserProxy, "Chrome/original");
            var request = request(1, 8082, TARGET, Map.of("User-Agent", agent, "Cookie", "session=a",
                    "Authorization", "Bearer a"), "operator note");
            var received = f.requests.handleRequestReceived(request);
            assertEquals(MessageReceivedAction.DO_NOT_INTERCEPT, received.action());
            assertEquals("Chrome/original", received.request().headerValue("User-Agent"));
            assertEquals("session=a", received.request().headerValue("Cookie"));
            assertEquals("Bearer a", received.request().headerValue("Authorization"));
            assertTrue(received.annotations().notes().contains("operator note"));
            assertTrue(received.annotations().notes().contains(ExplorerBrowserProxy.HISTORY_NOTE));
            assertNull(f.tracker.get(1), "CDP alone must record the account/run Evidence");
            var sent = f.requests.handleRequestToBeSent(request(1, 8082, TARGET,
                    Map.of("User-Agent", "Chrome/original", "Cookie", "session=a"), received.annotations().notes()));
            assertEquals(MessageToBeSentAction.CONTINUE, sent.action());
            var response = proxy(InterceptedResponse.class, (unused, method, args) -> switch (method.getName()) {
                case "annotations" -> received.annotations();
                default -> throw new AssertionError("Owned response must bypass generic capture: " + method.getName());
            });
            assertEquals(MessageReceivedAction.DO_NOT_INTERCEPT, f.responses.handleResponseReceived(response).action());
        }
    }

    @Test void untaggedLlmClientOnSamePortStillUsesExistingCaptureAndScopeGate() throws Exception {
        try (var f = new Fixture()) {
            set(f.extension, "explorerBrowserProxy", new ExplorerBrowserProxy(8082));
            var action = f.requests.handleRequestReceived(request(2, 8082, TARGET, Map.of("User-Agent", "external"), ""));
            assertEquals(MessageReceivedAction.CONTINUE, action.action());
            assertEquals(Source.LLM, f.tracker.get(2).source());
            assertEquals(MessageReceivedAction.DROP, f.requests.handleRequestReceived(request(3, 8082,
                    "https://outside.test/api", Map.of(), "")).action());
            assertNull(f.tracker.get(3));
        }
    }

    private static final class Fixture implements AutoCloseable {
        final FlowScopeExtension extension = new FlowScopeExtension();
        final MontoyaObjectFactory previous = ObjectFactoryLocator.FACTORY;
        final HumanBrowserSessions sessions;
        final ProxyRequestHandler requests;
        final ProxyResponseHandler responses;
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
            responses = handler("ProxyHandler", ProxyResponseHandler.class);
            broker = (SessionBroker) get(extension, "sessionBroker");
            tracker = (InFlightRequestTracker) get(extension, "proxyObservations");
        }

        <T> T handler(String name, Class<T> type) throws Exception {
            var constructor = Class.forName(FlowScopeExtension.class.getName() + "$" + name)
                    .getDeclaredConstructor(FlowScopeExtension.class);
            constructor.setAccessible(true);
            return type.cast(constructor.newInstance(extension));
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
            case "withUpdatedHeader" -> {
                var copy = new LinkedHashMap<>(headers);
                copy.keySet().removeIf(name -> name.equalsIgnoreCase((String) args[0]));
                copy.put((String) args[0], (String) args[1]);
                yield request(id, port, url, copy, notes);
            }
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
