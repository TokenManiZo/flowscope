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
import io.flowscope.explorer.ExplorerAccountVault;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.explorer.ExplorerProvider;
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

    @Test void onlyTheActiveRawListenerProducesControlledLlmEvidence() throws Exception {
        try (var f = new Fixture()) {
            ExplorerProvider provider = new ExplorerProvider() {
                @Override public String readiness() { return "READY"; }
                @Override public Handle start(Request request, Listener listener) {
                    return new Handle() {
                        @Override public void steer(String message) { }
                        @Override public void cancel() { }
                    };
                }
                @Override public void close() { }
            };
            var coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                    request -> { throw new AssertionError("raw proxy must not use Explorer HTTP transport"); },
                    provider, (RunContextRegistry) get(f.extension, "runContexts"),
                    url -> ScopePolicy.parse("https://app.test/").allows(url),
                    () -> Pipeline.run(java.util.List.of()), ignored -> { });
            set(f.extension, "rawChat", coordinator);
            set(f.extension, "rawProxyPort", 19417);
            var started = coordinator.start(new ExplorerCoordinator.StartRequest(TARGET,
                    java.util.List.of(), true, "", "", "Inspect", true, 19417, "/tmp"));
            set(f.extension, "rawProxyRunId", started.runId());
            var credentialed = request(301, 19417, TARGET, Map.of("Cookie", "session=a",
                    "Authorization", "Bearer a"), "");
            var accepted = f.requests.handleRequestReceived(credentialed);
            assertEquals(MessageReceivedAction.CONTINUE, accepted.action());
            assertEquals("session=a", accepted.request().headerValue("Cookie"));
            assertEquals("Bearer a", accepted.request().headerValue("Authorization"));
            assertTrue(f.tracker.get(301).rawControlled());
            f.responses.handleResponseReceived(response(301, credentialed));
            @SuppressWarnings("unchecked")
            var records = (java.util.List<RequestRecord>) get(f.extension, "records");
            assertEquals(1, records.size());
            assertEquals(Source.LLM, records.getFirst().source);
            assertEquals(ExecutionTrust.CONTROLLED, records.getFirst().executionTrust);
            assertEquals(started.runId(), records.getFirst().runId);
            assertNull(records.getFirst().collectionAccountId,
                    "credentialed raw requests must not be mislabeled anonymous");
            assertEquals(1, Pipeline.run(records).coverageRecords.size(),
                    "an in-scope JSON response should enter the same API graph input as other LLM traffic");
            var ordinaryLlm = request(304, 8082, TARGET, Map.of(), "");
            f.requests.handleRequestReceived(ordinaryLlm);
            f.responses.handleResponseReceived(response(304, ordinaryLlm));
            assertEquals(ExecutionTrust.UNVERIFIED_RUNTIME, records.getLast().executionTrust,
                    "the shared 8082 listener must not inherit the raw run's trust");
            assertEquals(1, Pipeline.run(records).coverageRecords.size());
            assertEquals(MessageReceivedAction.DROP, f.requests.handleRequestReceived(
                    request(302, 19417, "https://outside.test/api", Map.of(), "")).action());
            coordinator.cancel();
            assertEquals(MessageReceivedAction.DROP, f.requests.handleRequestReceived(
                    request(303, 19417, TARGET, Map.of(), "")).action());
            coordinator.close();
        }
    }

    @Test void selectedRawAccountUsesItsExplorerSessionForShellEvidence() throws Exception {
        try (var f = new Fixture()) {
            ExplorerAccountVault vault = new ExplorerAccountVault();
            vault.register("user-a", "USER A", "USER");
            var adopt = ExplorerAccountVault.class.getDeclaredMethod("adoptSession", String.class, URI.class,
                    java.util.List.class, java.util.Map.class);
            adopt.setAccessible(true);
            adopt.invoke(vault, "user-a", URI.create(TARGET), java.util.List.of(),
                    Map.of("Authorization", "Bearer account-a"));
            ExplorerProvider provider = new ExplorerProvider() {
                @Override public String readiness() { return "READY"; }
                @Override public Handle start(Request request, Listener listener) {
                    return new Handle() {
                        @Override public void steer(String message) { }
                        @Override public void cancel() { }
                    };
                }
                @Override public void close() { }
            };
            var contexts = (RunContextRegistry) get(f.extension, "runContexts");
            var coordinator = new ExplorerCoordinator(vault,
                    request -> { throw new AssertionError("raw proxy must not use Explorer HTTP transport"); },
                    provider, contexts, url -> ScopePolicy.parse("https://app.test/").allows(url),
                    () -> Pipeline.run(java.util.List.of()), ignored -> { });
            installAliveLoginWindow(coordinator, "user-a");
            set(f.extension, "rawChat", coordinator);
            set(f.extension, "rawProxyPort", 19418);
            var started = coordinator.start(new ExplorerCoordinator.StartRequest(TARGET,
                    java.util.List.of("user-a"), false, "", "", "Inspect", true, 19418, "/tmp"));
            set(f.extension, "rawProxyRunId", started.runId());
            var shell = request(311, 19418, TARGET, Map.of(), "");
            var accepted = f.requests.handleRequestReceived(shell);
            assertEquals(MessageReceivedAction.CONTINUE, accepted.action());
            assertEquals("Bearer account-a", accepted.request().headerValue("Authorization"));
            assertNull(accepted.request().headerValue("Proxy-Authorization"));
            f.responses.handleResponseReceived(response(311, (InterceptedRequest) accepted.request()));
            @SuppressWarnings("unchecked")
            var records = (java.util.List<RequestRecord>) get(f.extension, "records");
            assertEquals("user-a", records.getFirst().collectionAccountId);
            assertEquals("user-a", records.getFirst().laneAccountId);
            assertEquals(AuthState.ACCOUNT_BOUND, Pipeline.run(records).records.getFirst().authState);
            coordinator.cancel();
            coordinator.close();
        }
    }

    @Test void browserSubdomainResponseIsRetainedUnderItsOwnServiceWithoutScopeRegistration() throws Exception {
        try (var f = new Fixture()) {
            var child = request(201, 8080, "https://api.app.test/orders", Map.of(), "");
            f.requests.handleRequestReceived(child);
            f.responses.handleResponseReceived(response(201, child));
            @SuppressWarnings("unchecked")
            var records = (java.util.List<RequestRecord>) get(f.extension, "records");
            assertEquals(1, records.size());
            assertEquals("https://api.app.test:443", records.getFirst().service);
            assertTrue(records.getFirst().passiveSubdomainTraffic);
            assertTrue(Pipeline.run(records).coverageRecords.isEmpty());
            assertFalse(((ScopePolicy) get(f.extension, "scope")).allows(child.url()));
            f.responses.handleResponseReceived(response(201, child));
            assertEquals(1, records.size(), "one response is retained once");
            var unrelated = request(202, 8080, "https://unrelated.test/orders", Map.of(), "");
            f.requests.handleRequestReceived(unrelated);
            f.responses.handleResponseReceived(response(202, unrelated));
            assertEquals(1, records.size());
        }
    }

    @Test void browserRequestDiscoversRelatedHostWithoutExpandingActiveScope() throws Exception {
        try (var f = new Fixture()) {
            String api = "https://api.app.test/orders?token=secret";
            assertEquals(MessageReceivedAction.CONTINUE,
                    f.requests.handleRequestReceived(request(100, 8080, api, Map.of(), "")).action());
            var discovery = (PassiveHostDiscovery) get(f.extension, "hostDiscovery");
            var scope = (ScopePolicy) get(f.extension, "scope");
            assertEquals(java.util.List.of("https://api.app.test:443"), discovery.candidates(0, scope));
            assertFalse(scope.allows(api));
            assertFalse(ActiveTrafficGuard.allowsCapture(scope, api));
            assertEquals(MessageReceivedAction.DROP,
                    f.requests.handleRequestReceived(request(101, 8082, "https://llm.app.test/orders", Map.of(), "")).action());
            assertEquals(java.util.List.of("https://api.app.test:443"), discovery.candidates(0, scope));
        }
    }

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
            case "query" -> uri.getRawQuery();
            case "toByteArray" -> bytes("GET " + uri.getPath() + " HTTP/1.1\r\nHost: " + uri.getHost() + "\r\n\r\n");
            case "bodyOffset" -> ("GET " + uri.getPath() + " HTTP/1.1\r\nHost: " + uri.getHost() + "\r\n\r\n").length();
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
            case "withHeader" -> {
                var copy = new LinkedHashMap<>(headers);
                copy.keySet().removeIf(name -> name.equalsIgnoreCase((String) args[0]));
                copy.put((String) args[0], (String) args[1]);
                yield request(id, port, url, copy, notes);
            }
            case "withRemovedHeader" -> {
                var copy = new LinkedHashMap<>(headers);
                copy.keySet().removeIf(name -> name.equalsIgnoreCase((String) args[0]));
                yield request(id, port, url, copy, notes);
            }
            default -> throw new AssertionError(method.getName());
        });
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static void installAliveLoginWindow(ExplorerCoordinator coordinator, String accountId) throws Exception {
        Class<?> sessionType = Class.forName("io.flowscope.explorer.LoginBrowser$Session");
        Object session = Proxy.newProxyInstance(sessionType.getClassLoader(), new Class<?>[] { sessionType },
                (unused, method, args) -> switch (method.getName()) {
                    case "alive" -> true;
                    case "cookies" -> java.util.List.of();
                    case "authHeaders" -> Map.of("Authorization", "Bearer account-a");
                    case "recording", "close" -> null;
                    default -> throw new AssertionError(method.getName());
                });
        var field = ExplorerCoordinator.class.getDeclaredField("loginWindows");
        field.setAccessible(true);
        ((Map) field.get(coordinator)).put(accountId, session);
    }

    private static Annotations annotations(String notes) {
        return proxy(Annotations.class, (unused, method, args) -> switch (method.getName()) {
            case "notes" -> notes;
            case "withNotes" -> annotations((String) args[0]);
            default -> throw new AssertionError(method.getName());
        });
    }

    private static burp.api.montoya.core.ByteArray bytes(String text) {
        byte[] data = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return proxy(burp.api.montoya.core.ByteArray.class, (self, method, args) -> switch (method.getName()) {
            case "length" -> data.length;
            case "getBytes" -> data.clone();
            default -> throw new AssertionError(method.getName());
        });
    }

    private static InterceptedResponse response(int id, InterceptedRequest request) {
        String header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n";
        return proxy(InterceptedResponse.class, (self, method, args) -> switch (method.getName()) {
            case "messageId" -> id;
            case "initiatingRequest" -> request;
            case "annotations" -> annotations("");
            case "statusCode" -> (short) 200;
            case "headerValue" -> "Content-Type".equalsIgnoreCase((String) args[0]) ? "application/json" : null;
            case "headers" -> java.util.List.of();
            case "toByteArray" -> bytes(header + "{}");
            case "body" -> bytes("{}");
            case "bodyOffset" -> header.length();
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
