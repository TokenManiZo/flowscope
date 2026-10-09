package io.flowscope.burp;

import burp.api.montoya.core.ByteArray;
import burp.api.montoya.http.HttpService;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.internal.MontoyaObjectFactory;
import burp.api.montoya.internal.ObjectFactoryLocator;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.integration.SessionBroker;
import io.flowscope.web.FlowScopeWebServer.CredentialMode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Real prepareHumanRequest + SessionBroker + loopback receipt; Montoya value objects are test doubles. */
@ResourceLock("MontoyaObjectFactory")
class FlowScopeRequestLabCredentialsTest {
    @Test
    void loopbackReceivesOnlyTheExplicitAccountCredentialsOrNoCredentialsForAnonymous() throws Exception {
        var received = new LinkedBlockingQueue<Map<String, String>>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth-check", exchange -> {
            var headers = new java.util.TreeMap<String, String>(String.CASE_INSENSITIVE_ORDER);
            exchange.getRequestHeaders().forEach((key, values) -> headers.put(key, String.join("; ", values)));
            headers.put("body", new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            received.add(headers);
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        MontoyaObjectFactory previous = ObjectFactoryLocator.FACTORY;
        try {
            ObjectFactoryLocator.FACTORY = valueObjectFactory();
            server.start();
            String service = "http://127.0.0.1:" + server.getAddress().getPort();
            var extension = new FlowScopeExtension();
            field("scope").set(extension, ScopePolicy.parse(service + "/"));
            var broker = (SessionBroker) field("sessionBroker").get(extension);
            for (String id : List.of("account-a", "account-b")) {
                broker.registerAssertedSession(new AccountProfile(id, id, service, AccessRole.USER),
                        Map.of("Cookie", "session=" + id, "Authorization", "Bearer " + id,
                                "X-CSRF-Token", "csrf-" + id), Instant.now());
            }
            var seed = new RequestRecord(Source.HUMAN, service, "POST", "/auth-check", 200, "test");
            String original = "POST /auth-check HTTP/1.1\r\nHost: 127.0.0.1:" + server.getAddress().getPort()
                    + "\r\nCookie: session=original\r\nAuthorization: Bearer original\r\n"
                    + "X-CSRF-Token: csrf-original\r\nProxy-Authorization: old-proxy\r\n"
                    + "X-Test: keep\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload";
            var prepare = FlowScopeExtension.class.getDeclaredMethod("prepareHumanRequest", String.class,
                    RequestRecord.class, String.class, CredentialMode.class, String.class);
            prepare.setAccessible(true);
            for (String id : List.of("original", "account-a", "account-b", "anonymous")) {
                CredentialMode mode = id.equals("original") ? CredentialMode.ORIGINAL
                        : id.equals("anonymous") ? CredentialMode.ANONYMOUS : CredentialMode.ACCOUNT;
                // Feed the previously prepared request back in: switching accounts must remove the old identity.
                HttpRequest prepared = (HttpRequest) prepare.invoke(extension, seed.service, seed, original, mode,
                        mode == CredentialMode.ACCOUNT ? id : "");
                original = prepared.toString();
                try (var socket = new Socket("127.0.0.1", server.getAddress().getPort())) {
                    socket.setSoTimeout(5000);
                    socket.getOutputStream().write(original.getBytes(StandardCharsets.UTF_8));
                    socket.getOutputStream().flush();
                    assertTrue(socket.getInputStream().read() >= 0);
                }
                Map<String, String> actual = received.poll(5, TimeUnit.SECONDS);
                assertNotNull(actual);
                assertEquals("keep", actual.get("X-Test"));
                assertEquals("payload", actual.get("body"));
                if (mode == CredentialMode.ANONYMOUS) {
                    for (String name : SessionBroker.managedHeaderNames()) assertFalse(actual.containsKey(name), name);
                } else {
                    assertEquals("session=" + id, actual.get("Cookie"));
                    assertEquals("Bearer " + id, actual.get("Authorization"));
                    assertEquals("csrf-" + id, actual.get("X-CSRF-Token"));
                    if (mode == CredentialMode.ACCOUNT) assertFalse(actual.containsKey("Proxy-Authorization"));
                }
            }
        } finally {
            ObjectFactoryLocator.FACTORY = previous;
            server.stop(0);
        }
    }

    @Test
    void requestLabResponsesNeverChangeTheAccountSessionOrCredentialOwnership() throws Exception {
        String service = "https://api.example.test:443";
        var extension = new FlowScopeExtension();
        try {
            var broker = (SessionBroker) field("sessionBroker").get(extension);
            var config = (AnalysisConfig) field("analysisConfig").get(extension);
            var user = new AccountProfile("user-1", "USER 1", service, AccessRole.USER);
            config.upsertAccount(user);
            broker.registerAssertedSession(user, Map.of("Authorization", "Bearer user-1"), Instant.now());
            // 값을 바꿔 보낸 요청이 401을 받아도 점검 중인 세션은 그대로 쓸 수 있어야 한다.
            var denied = new RequestRecord(Source.HUMAN, service, "GET", "/orders/7", 401, "sub:user-1");
            denied.collectionAccountId = "anon";
            denied.hasResponse = true;
            denied.phase = RunPhase.VALIDATION;
            extension.recordRequestLabResponse(denied, "user-1", 0, () -> {});

            assertEquals(SessionBroker.Status.ACTIVE, broker.views().get(0).status());
            assertTrue(config.boundAccount(service, "sub:user-1").isEmpty());
            assertEquals("user-1", extension.analyzedRecord(denied).idn);
            assertEquals("user-1", denied.collectionAccountId);
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void rawModeSendsTheEditedAuthenticationHeaderVerbatim() throws Exception {
        String service = "http://target.test:80";
        MontoyaObjectFactory previous = ObjectFactoryLocator.FACTORY;
        var extension = new FlowScopeExtension();
        try {
            ObjectFactoryLocator.FACTORY = valueObjectFactory();
            field("scope").set(extension, ScopePolicy.parse(service + "/"));
            var seed = new RequestRecord(Source.HUMAN, service, "GET", "/orders/7", 200, "test");
            String edited = "GET /orders/7 HTTP/1.1\r\nHost: target.test\r\n"
                    + "Authorization: Bearer typed-by-hand\r\nCookie: sid=keep\r\nConnection: close\r\n\r\n";
            var prepare = FlowScopeExtension.class.getDeclaredMethod("prepareHumanRequest", String.class,
                    RequestRecord.class, String.class, CredentialMode.class, String.class);
            prepare.setAccessible(true);
            // 직접 입력: 손으로 쓴 인증 헤더가 지워지거나 교체되지 않고 그대로 나가야 한다(계정 모드와 다름).
            HttpRequest prepared = (HttpRequest) prepare.invoke(extension, seed.service, seed, edited, CredentialMode.RAW, "");
            assertEquals("Bearer typed-by-hand", prepared.headerValue("Authorization"));
            assertEquals("sid=keep", prepared.headerValue("Cookie"));
        } finally {
            ObjectFactoryLocator.FACTORY = previous;
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    private static Field field(String name) throws Exception {
        Field field = FlowScopeExtension.class.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    // Minimal Montoya value objects only; credential selection and replacement run in production code above.
    private static MontoyaObjectFactory valueObjectFactory() {
        return proxy(MontoyaObjectFactory.class, (unused, method, args) -> switch (method.getName()) {
            case "httpService" -> proxy(HttpService.class, (self, operation, values) -> switch (operation.getName()) {
                case "host" -> args[0];
                case "port" -> args[1];
                case "secure" -> args[2];
                default -> throw new UnsupportedOperationException(operation.getName());
            });
            case "byteArray" -> bytes((byte[]) args[0]);
            case "httpRequest" -> request((HttpService) args[0], args[1].toString());
            default -> throw new UnsupportedOperationException(method.getName());
        });
    }

    private static ByteArray bytes(byte[] value) {
        return proxy(ByteArray.class, (unused, method, args) -> switch (method.getName()) {
            case "toString" -> new String(value, StandardCharsets.UTF_8);
            case "getBytes" -> value.clone();
            case "length" -> value.length;
            default -> throw new UnsupportedOperationException(method.getName());
        });
    }

    private static HttpRequest request(HttpService service, String text) {
        int boundary = text.indexOf("\r\n\r\n");
        List<String> head = Arrays.asList(text.substring(0, boundary).split("\r\n"));
        String body = text.substring(boundary + 4);
        return proxy(HttpRequest.class, (unused, method, args) -> switch (method.getName()) {
            case "toString" -> text;
            case "url" -> (service.secure() ? "https://" : "http://") + service.host() + ":" + service.port() + head.getFirst().split(" ")[1];
            case "body" -> bytes(body.getBytes(StandardCharsets.UTF_8));
            case "hasHeader" -> header(head, (String) args[0]) != null;
            case "headerValue" -> header(head, (String) args[0]);
            case "withRemovedHeader", "withHeader", "withUpdatedHeader" -> {
                var updated = new ArrayList<String>();
                updated.add(head.getFirst());
                for (String line : head.subList(1, head.size())) {
                    if (!line.substring(0, line.indexOf(':')).equalsIgnoreCase((String) args[0])) updated.add(line);
                }
                if (!method.getName().equals("withRemovedHeader")) updated.add(args[0] + ": " + args[1]);
                yield request(service, String.join("\r\n", updated) + "\r\n\r\n" + body);
            }
            default -> throw new UnsupportedOperationException(method.getName());
        });
    }

    private static String header(List<String> head, String name) {
        return head.stream().skip(1).filter(line -> line.substring(0, line.indexOf(':')).equalsIgnoreCase(name))
                .map(line -> line.substring(line.indexOf(':') + 1).trim()).findFirst().orElse(null);
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
}
