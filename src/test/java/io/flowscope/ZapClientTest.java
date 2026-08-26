package io.flowscope;

import com.sun.net.httpserver.HttpServer;
import io.flowscope.integration.ZapClient;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ZapClientTest {
    @Test
    void ajaxSpiderUsesOnlyParametersSupportedByZap217() throws Exception {
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

            assertEquals("{\"Result\":\"OK\"}", client.ajaxSpider("http://127.0.0.1:8888/"));
            assertEquals("url=http%3A%2F%2F127.0.0.1%3A8888%2F", query.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void clientSpiderUsesStrictSubtreeAndPassiveAndAlertApisAreAvailable() throws Exception {
        AtomicReference<String> clientQuery = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientQuery.set(exchange.getRequestURI().getRawQuery());
            reply(exchange, "{\"scan\":\"3\"}");
        });
        server.createContext("/JSON/pscan/view/recordsToScan/", exchange -> reply(exchange, "{\"recordsToScan\":\"0\"}"));
        server.createContext("/JSON/alert/view/alerts/", exchange -> reply(exchange, "{\"alerts\":[]}"));
        server.start();
        try {
            ZapClient client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
            assertEquals("{\"scan\":\"3\"}", client.clientSpider("http://127.0.0.1:8888/app"));
            assertTrue(clientQuery.get().contains("subtreeOnly=true"));
            assertTrue(clientQuery.get().contains("scopeCheck=STRICT"));
            assertEquals("{\"recordsToScan\":\"0\"}", client.passiveRecordsToScan());
            assertEquals("{\"alerts\":[]}", client.alerts("http://127.0.0.1:8888/", 0, 100));
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

    private static void reply(com.sun.net.httpserver.HttpExchange exchange, String value) throws java.io.IOException {
        byte[] body = value.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
