package io.flowscope.explorer;

import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.integration.LoopbackHttpServer;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real Chromium gate; ordinary CI uses the deterministic CDP and policy tests. */
final class ChromiumScopeRuntimeHarnessTest {
    @Test
    void scrollingRevealsInScopeLazyApiWithoutGuessingItsUrl() throws Exception {
        Assumptions.assumeTrue(Boolean.getBoolean("flowscope.harness"));
        AtomicInteger lazyRequests = new AtomicInteger();
        String html = "<div style='height:3000px'>scroll</div><script>let seen=false;"
                + "addEventListener('scroll',()=>{if(!seen){seen=true;fetch('/api/lazy')}})</script>";
        try (LoopbackHttpServer target = new LoopbackHttpServer(0, request -> {
            if ("/api/lazy".equals(URI.create(request.path()).getPath())) {
                lazyRequests.incrementAndGet();
                return new LoopbackHttpServer.Response(200, Map.of("Content-Type", "application/json"),
                        "{\"id\":481}".getBytes(StandardCharsets.UTF_8));
            }
            return new LoopbackHttpServer.Response(200, Map.of("Content-Type", "text/html"),
                    html.getBytes(StandardCharsets.UTF_8));
        })) {
            target.start();
            String start = "http://127.0.0.1:" + target.port() + "/";
            BrowserScopePolicy policy = new BrowserScopePolicy(ScopePolicy.parse(start)::allows);
            List<LoginBrowser.Exchange> recorded = new CopyOnWriteArrayList<>();
            try (LoginBrowser.Session browser = new ChromiumLoginBrowser().open(
                    URI.create("about:blank"), recorded::add)) {
                browser.recording("run-scroll", policy::allows);
                browser.navigate(start);
                assertEquals(0, lazyRequests.get());
                browser.scroll("", "down");
                long deadline = System.currentTimeMillis() + 3_000;
                while (lazyRequests.get() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(25);
                assertEquals(1, lazyRequests.get());
            }
        }
    }

    @Test
    void coordinatorLoadsAnonymousStartPageBeforeStartingTheModel() throws Exception {
        Assumptions.assumeTrue(Boolean.getBoolean("flowscope.harness"));
        try (LoopbackHttpServer target = new LoopbackHttpServer(0, request ->
                new LoopbackHttpServer.Response(200, Map.of("Content-Type", "text/html"),
                        "<h1>ready</h1>".getBytes(StandardCharsets.UTF_8)))) {
            target.start();
            String start = "http://127.0.0.1:" + target.port() + "/";
            AtomicReference<ExplorerProvider.Request> started = new AtomicReference<>();
            ExplorerProvider provider = new ExplorerProvider() {
                @Override public String readiness() { return "READY"; }
                @Override public Handle start(Request request, Listener listener) {
                    started.set(request);
                    return new Handle() {
                        @Override public void steer(String message) { }
                        @Override public void cancel() { }
                    };
                }
                @Override public void close() { }
            };
            List<ExplorerCoordinator.BrowserExchange> captured = new CopyOnWriteArrayList<>();
            try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                    request -> { throw new AssertionError("the browser should fetch this page"); }, provider,
                    new RunContextRegistry(), ScopePolicy.parse(start)::allows,
                    () -> Pipeline.run(List.of()), ignored -> {})) {
                coordinator.browserRecorder(captured::add);
                coordinator.start(new ExplorerCoordinator.StartRequest(start, List.of(), true));
                long deadline = System.currentTimeMillis() + 20_000;
                while (started.get() == null && System.currentTimeMillis() < deadline) Thread.sleep(50);
                assertNotNull(started.get(), coordinator.current().message());
                while (captured.stream().noneMatch(exchange -> start.equals(exchange.url()))
                        && System.currentTimeMillis() < deadline) Thread.sleep(50);
                assertTrue(captured.stream().anyMatch(exchange -> start.equals(exchange.url())
                        && exchange.runId().equals(started.get().runId())), captured.toString());
                coordinator.cancel();
                assertEquals(ExplorerCoordinator.Status.CANCELLED, coordinator.current().status());
            }
        }
    }

    @Test
    void clickCannotDispatchOutOfScopeDocumentOrXhrButPageLinkedScriptStillLoads() throws Exception {
        Assumptions.assumeTrue(Boolean.getBoolean("flowscope.harness"));
        AtomicInteger externalDocuments = new AtomicInteger();
        AtomicInteger externalApi = new AtomicInteger();
        AtomicInteger externalScript = new AtomicInteger();
        try (LoopbackHttpServer external = new LoopbackHttpServer(0, request -> {
            String path = URI.create(request.path()).getPath();
            if ("/app.js".equals(path)) externalScript.incrementAndGet();
            else if ("/api".equals(path)) externalApi.incrementAndGet();
            else externalDocuments.incrementAndGet();
            byte[] body = ("/app.js".equals(path) ? "window.loadedExternalScript=true;" : "ok")
                    .getBytes(StandardCharsets.UTF_8);
            return new LoopbackHttpServer.Response(200,
                    Map.of("Content-Type", "/app.js".equals(path) ? "application/javascript" : "text/plain"), body);
        })) {
            external.start();
            String externalBase = "http://127.0.0.1:" + external.port();
            String html = "<a href='" + externalBase + "/' id='outside'>outside</a>"
                    + "<a href='" + externalBase + "/popup' target='_blank'>popup</a>"
                    + "<button onclick=\"fetch('" + externalBase + "/api')\">api</button>"
                    + "<script src='" + externalBase + "/app.js'></script>";
            try (LoopbackHttpServer target = new LoopbackHttpServer(0, request ->
                    new LoopbackHttpServer.Response(200, Map.of("Content-Type", "text/html"),
                            html.getBytes(StandardCharsets.UTF_8)))) {
                target.start();
                String start = "http://127.0.0.1:" + target.port() + "/";
                BrowserScopePolicy policy = new BrowserScopePolicy(ScopePolicy.parse(start)::allows);
                List<LoginBrowser.Exchange> recorded = new CopyOnWriteArrayList<>();
                try (LoginBrowser.Session browser = new ChromiumLoginBrowser().open(
                        URI.create("about:blank"), recorded::add)) {
                    browser.recording("run-real-browser", policy::allows);
                    LoginBrowser.Page page = browser.navigate(start);
                    assertTrue(externalScript.get() > 0, "page-linked script should still render");
                    String link = ref(page.elements(), "outside");
                    String popup = ref(page.elements(), "popup");
                    String button = ref(page.elements(), "api");
                    browser.click(button);
                    browser.click(popup);
                    browser.click(link);
                    Thread.sleep(300);
                    assertEquals(0, externalApi.get(), "XHR escaped exact scope");
                    assertEquals(0, externalDocuments.get(), "navigation escaped exact scope");
                    assertTrue(recorded.stream().anyMatch(exchange -> exchange.url().equals(start)
                            && exchange.runId().equals("run-real-browser")), "anonymous page response was not recorded");
                    browser.recording(null, null);
                }
            }
        }
    }

    private static String ref(List<LoginBrowser.Element> elements, String name) {
        return elements.stream().filter(element -> name.equals(element.name()))
                .map(LoginBrowser.Element::ref).findFirst().orElseThrow();
    }
}
