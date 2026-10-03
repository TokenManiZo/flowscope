package io.flowscope.explorer;

import io.flowscope.core.ScopePolicy;
import io.flowscope.integration.LoopbackHttpServer;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real Chromium gate; ordinary CI uses the deterministic CDP and policy tests. */
final class ChromiumScopeRuntimeHarnessTest {
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
