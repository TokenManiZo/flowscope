package io.flowscope;

import com.sun.net.httpserver.HttpServer;
import io.flowscope.integration.ZapClient;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ZapClientTest {
    @Test
    void capabilityReplacerUsesPostAndOnlyCampaignInitiators() throws Exception {
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> form = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/replacer/action/addRule/", exchange -> {
            method.set(exchange.getRequestMethod());
            form.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");

            client.addRequestHeaderRule("run", "^https://app\\.test/", "X-Run", "capability",
                    java.util.List.of(3, 5, 6, 10, 14, 15, 18));

            assertEquals("POST", method.get());
            Map<String, String> values = form(form.get());
            assertEquals("3,5,6,10,14,15,18", values.get("initiators"));
            assertEquals("capability", values.get("replacement"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void probeUsesTheSameLoopbackApiForDesktopOrDockerWithoutGuessingDeployment() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/core/view/version/", exchange -> reply(exchange, "{\"version\":\"2.17.0\"}"));
        server.start();
        try {
            String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
            ZapClient client = new ZapClient(endpoint, "local-test-key-local-test-key-1234");

            assertEquals(endpoint, client.endpoint());
            assertTrue(client.apiKeyConfigured());
            assertEquals("{\"version\":\"2.17.0\"}", client.probeVersion());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void clientSpiderPassesSupportingResourcesWithoutCrawlingOutsideSubtree() throws Exception {
        AtomicReference<String> clientQuery = new AtomicReference<>();
        AtomicReference<String> stoppedClient = new AtomicReference<>();
        AtomicReference<String> scopeQuery = new AtomicReference<>();
        AtomicReference<String> alertCountQuery = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"scan\":\"3\"}");
        });
        server.createContext("/JSON/clientSpider/action/stop/", exchange -> {
            stoppedClient.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/pscan/view/recordsToScan/", exchange -> reply(exchange, "{\"recordsToScan\":\"0\"}"));
        server.createContext("/JSON/pscan/action/clearQueue/", exchange -> reply(exchange, "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/view/scanners/", exchange -> reply(exchange, "{\"scanners\":[]}"));
        server.createContext("/JSON/pscan/action/setEnabled/", exchange -> reply(exchange, "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/enableAllScanners/", exchange -> reply(exchange, "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/setScanOnlyInScope/", exchange -> {
            scopeQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/alert/view/alerts/", exchange -> reply(exchange, "{\"alerts\":[]}"));
        server.createContext("/JSON/alert/view/numberOfAlerts/", exchange -> {
            alertCountQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"numberOfAlerts\":\"0\"}");
        });
        server.createContext("/JSON/network/view/isHttpProxyEnabled/", exchange ->
                reply(exchange, "{\"isHttpProxyEnabled\":\"true\"}"));
        server.createContext("/JSON/network/view/getHttpProxy/", exchange ->
                reply(exchange, "{\"getHttpProxy\":{\"host\":\"127.0.0.1\",\"port\":8081}}"));
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            assertEquals("{\"scan\":\"3\"}", client.clientSpider("http://127.0.0.1:8888/app"));
            assertTrue(clientQuery.get().contains("browser=chrome-headless"));
            assertTrue(clientQuery.get().contains("subtreeOnly=true"));
            assertTrue(clientQuery.get().contains("scopeCheck=FLEXIBLE"));
            assertTrue(clientQuery.get().contains("maxCrawlDepth=5"));
            assertTrue(clientQuery.get().contains("numberOfBrowsers=1"));
            assertTrue(clientQuery.get().contains("logoutAvoidance=true"));
            assertEquals("{\"recordsToScan\":\"0\"}", client.passiveRecordsToScan());
            assertEquals("{\"scanners\":[]}", client.passiveScanners());
            assertEquals("{\"Result\":\"OK\"}", client.enablePassiveScan());
            assertEquals("{\"Result\":\"OK\"}", client.enableAllPassiveScanners());
            assertEquals("{\"Result\":\"OK\"}", client.restrictPassiveScanToScope());
            assertEquals("{\"Result\":\"OK\"}", client.stopClientSpider("12"));
            assertEquals("scanId=12", stoppedClient.get());
            assertEquals("{\"Result\":\"OK\"}", client.clearPassiveQueue());
            assertEquals("onlyInScope=true", scopeQuery.get());
            assertEquals("{\"alerts\":[]}", client.alerts("http://127.0.0.1:8888/", 0, 100));
            assertEquals("{\"numberOfAlerts\":\"0\"}",
                    client.numberOfAlerts("http://127.0.0.1:8888/"));
            assertTrue(alertCountQuery.get().contains("baseurl=http%3A%2F%2F127.0.0.1%3A8888%2F"));
            assertEquals("{\"isHttpProxyEnabled\":\"true\"}", client.httpProxyEnabled());
            assertTrue(client.httpProxy().contains("127.0.0.1"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void exactContextRegexMatchesOnlyTheSelectedOriginAndPathSubtree() {
        Pattern pattern = Pattern.compile(ZapClient.exactSubtreeRegex("https://Api.Example.test/v1"));

        assertTrue(pattern.matcher("https://api.example.test/v1").matches());
        assertTrue(pattern.matcher("https://API.EXAMPLE.TEST:443/v1/users?id=1").matches());
        assertFalse(pattern.matcher("https://api.example.test/v10").matches());
        assertFalse(pattern.matcher("https://sub.api.example.test/v1").matches());
        assertFalse(pattern.matcher("http://api.example.test/v1").matches());
        assertFalse(pattern.matcher("https://api.example.test:444/v1").matches());
    }

    @Test
    void exactSubtreeRegexUnionCoversEveryScopeEntryAndRejectsOutsiders() {
        // 다중 항목 scope: capability 헤더가 target 하위뿐 아니라 모든 in-scope 항목 요청에 붙어야 한다.
        Pattern pattern = Pattern.compile(ZapClient.exactSubtreeRegex(
                java.util.List.of("https://api.example.test/v1", "https://api.example.test/admin")));

        assertTrue(pattern.matcher("https://api.example.test/v1/users").matches());
        assertTrue(pattern.matcher("https://api.example.test/admin/reset").matches());
        assertFalse(pattern.matcher("https://api.example.test/other").matches());
        assertFalse(pattern.matcher("https://evil.example.test/v1").matches());
    }

    @Test
    void exactSubtreeRegexUnionOfOneEqualsSingleTargetRegex() {
        // 단일 항목이면 기존 단일 target 동작과 완전히 동일해야 한다(회귀 방지).
        assertEquals(ZapClient.exactSubtreeRegex("https://api.example.test/v1"),
                ZapClient.exactSubtreeRegex(java.util.List.of("https://api.example.test/v1")));
    }

    @Test
    void exactContextRegexSupportsBracketedIpv6AndOptionalDefaultPort() {
        Pattern pattern = Pattern.compile(ZapClient.exactSubtreeRegex("http://[::1]:80/api"));

        assertTrue(pattern.matcher("http://[::1]/api").matches());
        assertTrue(pattern.matcher("http://[::1]:80/api/items").matches());
        assertFalse(pattern.matcher("http://[::1]:8080/api").matches());
    }

    @Test
    void apiKeyUsesAHeaderAndIsNotPlacedInTheRequestUri() throws Exception {
        AtomicReference<String> query = new AtomicReference<>();
        AtomicReference<String> header = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/core/view/version/", exchange -> {
            query.set(exchange.getRequestURI().getRawQuery());
            header.set(exchange.getRequestHeaders().getFirst("X-ZAP-API-Key"));
            reply(exchange, "{\"version\":\"2.17.0\"}");
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "secret-key");
            client.version();
            assertTrue(query.get() == null || !query.get().contains("secret-key"));
            assertEquals("secret-key", header.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void createsAFreshZapSessionForEachIsolatedIdentityRun() throws Exception {
        AtomicReference<String> query = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/core/action/newSession/", exchange -> {
            query.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");

            assertEquals("{\"Result\":\"OK\"}", client.newSession("flowscope-campaign-user-a"));
            assertTrue(query.get().contains("name=flowscope-campaign-user-a"));
            assertTrue(query.get().contains("overwrite=true"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void readsTheZapRuntimeHomeUsedForTemporarySessionFiles() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/core/view/zapHomePath/", exchange ->
                reply(exchange, "{\"zapHomePath\":\"/run/flowscope-zap/runtime.123/home/\"}"));
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");

            assertEquals("{\"zapHomePath\":\"/run/flowscope-zap/runtime.123/home/\"}",
                    client.zapHomePath());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void browserAuthenticationCredentialsUsePostBodiesAndNeverTheRequestUri() throws Exception {
        Map<String, String> methods = new LinkedHashMap<>();
        Map<String, String> queries = new LinkedHashMap<>();
        Map<String, String> bodies = new LinkedHashMap<>();
        Map<String, String> keys = new LinkedHashMap<>();
        Map<String, String> contentTypes = new LinkedHashMap<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (String path : java.util.List.of(
                "/JSON/authentication/action/setAuthenticationMethod/",
                "/JSON/sessionManagement/action/setSessionManagementMethod/",
                "/JSON/users/action/newUser/",
                "/JSON/users/action/setAuthenticationCredentials/",
                "/JSON/users/action/setUserEnabled/",
                "/JSON/users/action/authenticateAsUser/")) {
            server.createContext(path, exchange -> {
                methods.put(path, exchange.getRequestMethod());
                queries.put(path, exchange.getRequestURI().getRawQuery());
                bodies.put(path, new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                keys.put(path, exchange.getRequestHeaders().getFirst("X-ZAP-API-Key"));
                contentTypes.put(path, exchange.getRequestHeaders().getFirst("Content-Type"));
                reply(exchange, path.contains("newUser") ? "{\"userId\":\"7\"}"
                        : path.contains("authenticateAsUser") ? "{\"authSuccessful\":\"true\"}"
                        : "{\"Result\":\"OK\"}");
            });
        }
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "api-secret");
            client.setBrowserAuthentication("3", "https://app.test/login", "firefox-headless");
            client.setAutoDetectSessionManagement("3");
            client.newUser("3", "FlowScope user A");
            client.setUserCredentials("3", "7", "alice@example.test", "password-secret");
            client.setUserEnabled("3", "7");
            client.authenticateAsUser("3", "7");

            methods.forEach((path, method) -> assertEquals("POST", method, path));
            queries.forEach((path, query) -> assertTrue(query == null || query.isBlank(), path));
            keys.forEach((path, key) -> assertEquals("api-secret", key, path));
            contentTypes.forEach((path, contentType) ->
                    assertEquals("application/x-www-form-urlencoded", contentType, path));
            String credentialBody = URLDecoder.decode(URLDecoder.decode(
                    bodies.get("/JSON/users/action/setAuthenticationCredentials/"), StandardCharsets.UTF_8),
                    StandardCharsets.UTF_8);
            assertTrue(credentialBody.contains("username=alice@example.test"));
            assertTrue(credentialBody.contains("password=password-secret"));
            assertFalse(server.getAddress().toString().contains("password-secret"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void credentialApiFailureDoesNotEchoThePostedSecret() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/users/action/setAuthenticationCredentials/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] body = "rejected password-secret".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(400, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            IllegalStateException error = assertThrows(IllegalStateException.class,
                    () -> client.setUserCredentials("3", "7", "alice@example.test", "password-secret"));
            assertEquals("ZAP API HTTP 400", error.getMessage());
            assertFalse(error.getMessage().contains("password-secret"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void authenticatedClientSpiderCarriesTheExactZapContextAndUser() throws Exception {
        AtomicReference<String> clientSpider = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientSpider.set(exchange.getRequestURI().getRawQuery()); reply(exchange, "{\"scan\":\"2\"}");
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            client.clientSpider("https://app.test/", "ctx", "FlowScope user A", "chrome-headless");

            assertTrue(clientSpider.get().contains("contextName=ctx"));
            assertTrue(clientSpider.get().contains("userName=FlowScope+user+A"));
            assertTrue(clientSpider.get().contains("browser=chrome-headless"));
            assertTrue(clientSpider.get().contains("scopeCheck=FLEXIBLE"));
            assertTrue(clientSpider.get().contains("maxCrawlDepth=5"));
            assertTrue(clientSpider.get().contains("numberOfBrowsers=1"));
            assertTrue(clientSpider.get().contains("logoutAvoidance=true"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void importsOnlyExplicitDefinitionsWithBoundedMessageCounts() throws Exception {
        AtomicReference<String> openApi = new AtomicReference<>();
        AtomicReference<String> graphQl = new AtomicReference<>();
        AtomicReference<String> postman = new AtomicReference<>();
        AtomicReference<String> soap = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/openapi/action/importUrl/", exchange -> {
            openApi.set(exchange.getRequestURI().getRawQuery()); reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/graphql/action/importUrl/", exchange -> {
            graphQl.set(exchange.getRequestURI().getRawQuery()); reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/postman/action/importUrl/", exchange -> {
            postman.set(exchange.getRequestURI().getRawQuery()); reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/soap/action/importUrl/", exchange -> {
            soap.set(exchange.getRequestURI().getRawQuery()); reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");

            client.importOpenApi("http://127.0.0.1:8888/openapi.json",
                    "http://127.0.0.1:8888/", "7", 10_000);
            client.importGraphQl("http://127.0.0.1:8888/graphql", "", 250);
            client.importPostman("http://127.0.0.1:8888/collection.json", 0);
            client.importSoap("http://127.0.0.1:8888/service.wsdl", 500);

            assertTrue(openApi.get().contains("contextId=7"));
            assertTrue(openApi.get().contains("hostOverride=http%3A%2F%2F127.0.0.1%3A8888%2F"));
            assertTrue(openApi.get().contains("maxMessages=1000"));
            assertTrue(graphQl.get().contains("endurl=http%3A%2F%2F127.0.0.1%3A8888%2Fgraphql"));
            assertTrue(graphQl.get().contains("url="));
            assertTrue(graphQl.get().contains("maxMessages=250"));
            assertTrue(postman.get().contains("maxMessages=1"));
            assertTrue(soap.get().contains("maxMessages=500"));
        } finally {
            server.stop(0);
        }
    }

    private static void reply(com.sun.net.httpserver.HttpExchange exchange, String value) throws java.io.IOException {
        byte[] body = value.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static Map<String, String> form(String body) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String field : body.split("&")) {
            String[] parts = field.split("=", 2);
            values.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    URLDecoder.decode(parts.length == 2 ? parts[1] : "", StandardCharsets.UTF_8));
        }
        return values;
    }
}
