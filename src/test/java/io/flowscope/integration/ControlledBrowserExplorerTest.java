package io.flowscope.integration;

import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.ScopePolicy;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ControlledBrowserExplorerTest {
    @Test
    void launchesInstalledBrowserAndReturnsBoundedExactScopeDiscovery() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(ControlledBrowserExplorer.locateBrowser().isPresent());
        HttpServer target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        HttpServer secondService = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> observedCookie = new AtomicReference<>("");
        AtomicReference<String> leakedCookie = new AtomicReference<>("");
        secondService.createContext("/asset", exchange -> {
            leakedCookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
            byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        secondService.start();
        String secondBase = "http://127.0.0.1:" + secondService.getAddress().getPort() + "/";
        target.createContext("/", exchange -> {
            observedCookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
            byte[] body = ("<html><head><title>FlowScope Smoke</title></head><body>"
                    + "<a href='/orders/7'>Orders</a><a href='https://outside.example/'>Outside</a>"
                    + "<a href='/reset?access_token=secret-browser-token'>Reset</a>"
                    + "<img src='" + secondBase + "asset'>"
                    + "</body></html>").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        target.start();
        String base = "http://127.0.0.1:" + target.getAddress().getPort() + "/";
        System.setProperty("flowscope.browser.headless", "true");
        try (ControlledBrowserExplorer browser = new ControlledBrowserExplorer(
                () -> ScopePolicy.parse(base + "\n" + secondBase), 0)) {
            ControlledBrowserExplorer.Snapshot snapshot = browser.navigate("smoke-run", base,
                    Map.of("Cookie", "session=browser-smoke"));

            assertEquals("smoke-run", snapshot.runId());
            assertEquals("FlowScope Smoke", snapshot.title());
            assertTrue(snapshot.visibleText().contains("Orders"));
            assertEquals(2, snapshot.elements().size(), "out-of-scope link must be removed");
            assertEquals(base + "orders/7", snapshot.elements().getFirst().target());
            assertFalse(snapshot.elements().get(1).target().contains("secret-browser-token"));
            assertTrue(snapshot.elements().get(1).target().contains("***MASKED***"));
            assertFalse(snapshot.network().isEmpty());
            assertEquals("session=browser-smoke", observedCookie.get());
            assertTrue(snapshot.network().stream().anyMatch(route -> route.url().equals(secondBase + "asset")));
            assertTrue(leakedCookie.get() == null || leakedCookie.get().isBlank(),
                    "session header must not cross to a different in-scope service");
            ControlledBrowserExplorer.Snapshot clicked = browser.interact("smoke-run", "CLICK", "a", null);
            assertEquals(base + "orders/7", clicked.currentUrl());
            assertThrows(IllegalArgumentException.class,
                    () -> browser.navigate("smoke-run", "https://outside.example/", Map.of()));
        } finally {
            System.clearProperty("flowscope.browser.headless");
            target.stop(0);
            secondService.stop(0);
        }
    }

    @Test
    void blocksBrowserStateChangeUntilTheConcreteRequestIsApproved() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(ControlledBrowserExplorer.locateBrowser().isPresent());
        HttpServer target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger writes = new AtomicInteger();
        AtomicReference<ControlledBrowserExplorer.WriteRequest> approval = new AtomicReference<>();
        target.createContext("/", exchange -> {
            byte[] body = ("<button id='write'>write</button><script>"
                    + "document.querySelector('#write').onclick=()=>fetch('/mutate',{method:'POST',"
                    + "headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'secret'})});"
                    + "</script>").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        target.createContext("/mutate", exchange -> {
            writes.incrementAndGet();
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        target.start();
        String base = "http://127.0.0.1:" + target.getAddress().getPort() + "/";
        System.setProperty("flowscope.browser.headless", "true");
        try (ControlledBrowserExplorer browser = new ControlledBrowserExplorer(
                () -> ScopePolicy.parse(base), 0, request -> {
                    approval.set(request);
                    return false;
                })) {
            browser.navigate("write-run", base, Map.of());
            browser.interact("write-run", "CLICK", "#write", null);
            assertEquals(0, writes.get());
            assertEquals("POST", approval.get().method());
            assertEquals(base + "mutate", approval.get().url());
            assertFalse(approval.get().bodyPreview().contains("secret"));
        } finally {
            System.clearProperty("flowscope.browser.headless");
            target.stop(0);
        }
    }
}
