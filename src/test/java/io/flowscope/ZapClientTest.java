package io.flowscope;

import com.sun.net.httpserver.HttpServer;
import io.flowscope.integration.ZapClient;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ZapClientTest {
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
    void ajaxSpiderIsRestrictedToTheSelectedContextAndSubtree() throws Exception {
        AtomicReference<String> query = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            query.set(exchange.getRequestURI().getRawQuery());
            byte[] body = "{\"Result\":\"OK\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");

            assertEquals("{\"Result\":\"OK\"}", client.ajaxSpider("http://127.0.0.1:8888/", "flowscope-1"));
            assertTrue(query.get().contains("url=http%3A%2F%2F127.0.0.1%3A8888%2F"));
            assertTrue(query.get().contains("inScope=true"));
            assertTrue(query.get().contains("subtreeOnly=true"));
            assertTrue(query.get().contains("contextName=flowscope-1"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void clientSpiderUsesStrictSubtreeAndPassiveAndAlertApisAreAvailable() throws Exception {
        AtomicReference<String> clientQuery = new AtomicReference<>();
        AtomicReference<String> stoppedSpider = new AtomicReference<>();
        AtomicReference<String> stoppedClient = new AtomicReference<>();
        AtomicReference<String> scopeQuery = new AtomicReference<>();
        AtomicReference<String> alertCountQuery = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"scan\":\"3\"}");
        });
        server.createContext("/JSON/spider/action/stop/", exchange -> {
            stoppedSpider.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/clientSpider/action/stop/", exchange -> {
            stoppedClient.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/ajaxSpider/action/stop/", exchange -> reply(exchange, "{\"Result\":\"OK\"}"));
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
            assertTrue(clientQuery.get().contains("subtreeOnly=true"));
            assertTrue(clientQuery.get().contains("scopeCheck=STRICT"));
            assertEquals("{\"recordsToScan\":\"0\"}", client.passiveRecordsToScan());
            assertEquals("{\"scanners\":[]}", client.passiveScanners());
            assertEquals("{\"Result\":\"OK\"}", client.enablePassiveScan());
            assertEquals("{\"Result\":\"OK\"}", client.enableAllPassiveScanners());
            assertEquals("{\"Result\":\"OK\"}", client.restrictPassiveScanToScope());
            assertEquals("{\"Result\":\"OK\"}", client.stopSpider("11"));
            assertEquals("scanId=11", stoppedSpider.get());
            assertEquals("{\"Result\":\"OK\"}", client.stopClientSpider("12"));
            assertEquals("scanId=12", stoppedClient.get());
            assertEquals("{\"Result\":\"OK\"}", client.stopAjaxSpider());
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
}
