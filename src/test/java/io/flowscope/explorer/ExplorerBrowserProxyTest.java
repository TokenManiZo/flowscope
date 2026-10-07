package io.flowscope.explorer;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class ExplorerBrowserProxyTest {
    @Test void onlyThisBrowsersTagIsRecognizedAndOriginalAgentIsRestored() {
        var proxy = new ExplorerBrowserProxy(8082);
        var other = new ExplorerBrowserProxy(8082);
        String original = "Mozilla/5.0 Chrome/150.0 Safari/537.36";
        String tagged = proxy.tagUserAgent(original);
        assertEquals(original, proxy.originalUserAgent(tagged));
        assertNull(proxy.originalUserAgent(original));
        assertNull(other.originalUserAgent(tagged));
        assertNull(proxy.originalUserAgent(null));
        assertThrows(IllegalArgumentException.class, () -> new ExplorerBrowserProxy(0));
    }

    /** No target network: the local fixture answers all proxied HTTP requests itself. */
    @Test void realChromiumRoutesLoginFetchAndWorkerWithoutCorsOrIdentityChanges() throws Exception {
        assumeTrue(Boolean.getBoolean("flowscope.explorer.runtime"), "Actual Chromium runtime test is opt-in");
        var executable = ChromiumLoginBrowser.resolveExecutable(Path.of(System.getProperty("java.home")));
        assertNotNull(executable);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newCachedThreadPool();
        server.setExecutor(executor);
        var proxy = new ExplorerBrowserProxy(server.getAddress().getPort());
        var seen = new CopyOnWriteArrayList<String>();
        var agents = new CopyOnWriteArrayList<String>();
        var recorded = new CopyOnWriteArrayList<LoginBrowser.Exchange>();
        try (var origin = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))) {
            int targetPort = origin.getLocalPort();
            server.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                if (List.of("/start", "/check", "/cross", "/worker.js", "/worker-check").contains(path)) {
                    seen.add(exchange.getRequestMethod() + " " + path);
                    agents.add(exchange.getRequestHeaders().getFirst("User-Agent"));
                }
                String body = switch (path) {
                    case "/start" -> """
                            <body>loading<script>
                            Promise.all([fetch('/check').then(r=>r.text()),
                              fetch('http://127.0.0.2:%d/cross').then(r=>r.text()),
                              new Promise(resolve=>{let w=new Worker('/worker.js');w.onmessage=e=>resolve(e.data);})])
                              .then(values=>document.body.innerText='done '+values.join(' ')+' '+navigator.userAgent)
                              .catch(e=>document.body.innerText='error '+e);
                            </script></body>
                            """.formatted(targetPort);
                    case "/worker.js" -> "fetch('/worker-check').then(r=>r.text()).then(v=>postMessage(v));";
                    default -> "ok";
                };
                exchange.getResponseHeaders().add("Content-Type", path.equals("/worker.js")
                        ? "application/javascript" : "text/html; charset=utf-8");
                exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                if (path.equals("/start")) exchange.getResponseHeaders().add("Set-Cookie", "session=account-a; Path=/");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
            var browser = new ChromiumLoginBrowser(proxy);
            URI target = URI.create("http://127.0.0.1:" + targetPort + "/start");
            try (var window = browser.open(executable, target, recorded::add, true)) {
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                LoginBrowser.Page page;
                do { Thread.sleep(50); page = window.snapshot(); }
                while (!page.text().startsWith("done") && System.nanoTime() < deadline);
                assertTrue(page.text().startsWith("done ok ok ok"), page.text());
                assertFalse(page.text().contains("FlowScope/"), "The browser's JS-visible agent must stay unchanged");
                assertTrue(page.text().endsWith(proxy.originalUserAgent(agents.getFirst())), "The target must receive the JS-visible original agent");
                assertTrue(seen.containsAll(List.of("GET /start", "GET /check", "GET /cross", "GET /worker.js", "GET /worker-check")), seen.toString());
                assertFalse(seen.stream().anyMatch(value -> value.startsWith("OPTIONS ")), seen.toString());
                assertTrue(agents.stream().allMatch(agent -> proxy.originalUserAgent(agent) != null), agents.toString());
                assertTrue(recorded.isEmpty(), "Login requests must never become FlowScope Evidence");
                assertEquals("account-a", window.cookies(target).stream().filter(cookie -> cookie.getName().equals("session"))
                        .findFirst().orElseThrow().getValue());
                window.recording(true);
                window.navigate(target.toString());
                deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
                while (recorded.size() < 5 && System.nanoTime() < deadline) Thread.sleep(50);
                assertTrue(recorded.stream().anyMatch(value -> value.url().endsWith("/check")), recorded.toString());
                assertTrue(recorded.stream().flatMap(value -> value.requestHeaders().entrySet().stream())
                        .filter(header -> header.getKey().equalsIgnoreCase("User-Agent"))
                        .noneMatch(header -> header.getValue().contains("FlowScope/")), "Internal tags must not enter Evidence");
            }
        } finally { server.stop(0); executor.shutdownNow(); }
    }
}
