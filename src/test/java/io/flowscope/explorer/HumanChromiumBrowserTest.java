package io.flowscope.explorer;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class HumanChromiumBrowserTest {
    @Test void launchRoutesLocalhostThroughOnlyItsOwnProxy() {
        var args = HumanChromiumBrowser.arguments(Path.of("/chrome"), Path.of("/profile-A"), 18080);
        assertTrue(args.contains("--proxy-server=http://127.0.0.1:18080"));
        assertTrue(args.contains("--proxy-bypass-list=<-loopback>"));
        assertTrue(args.contains("--incognito"));
        assertTrue(args.contains("--user-data-dir=/profile-A"));
        assertFalse(args.contains("--no-proxy-server"));
        assertEquals("about:blank", args.getLast());
    }

    /** Opt-in actual Chromium test. Same origin and three proxies, with separate cookies/localStorage in each. */
    @Test void realChromiumKeepsThreeSameOriginAccountsIsolated() throws Exception {
        assumeTrue(Boolean.getBoolean("flowscope.human.runtime"), "Actual Chromium runtime test is opt-in");
        Path executable = ChromiumLoginBrowser.resolveExecutable(Path.of(System.getProperty("java.home")));
        assertNotNull(executable, "Chromium/Chrome is required for the requested runtime test");
        var browser = new HumanChromiumBrowser();
        try (var origin = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
             var a = new LocalProxy("A"); var b = new LocalProxy("B"); var anon = new LocalProxy("anon")) {
            URI target = URI.create("http://127.0.0.1:" + origin.getLocalPort() + "/start"); // No direct response: proxy bypass would fail.
            try (var aw = browser.open(executable, target, a.port(), true);
                 var bw = browser.open(executable, target, b.port(), true);
                 var nw = browser.open(executable, target, anon.port(), true)) {
                for (var proxy : List.of(a, b, anon)) {
                    String check = proxy.checked.get(20, TimeUnit.SECONDS);
                    assertTrue(check.startsWith("GET " + target.resolve("/check?stored=" + proxy.account)), check);
                    if (proxy.account.equals("anon")) assertFalse(check.contains("Cookie:"), check);
                    else assertTrue(check.contains("Cookie: session=" + proxy.account), check);
                    assertFalse(proxy.firstRequest.get(5, TimeUnit.SECONDS).contains("Cookie:"));
                }
                var aWindow = (HumanChromiumBrowser.BrowserWindow) aw;
                for (String page : List.copyOf(aWindow.pages())) {
                    aWindow.connection().call("Target.closeTarget", new com.fasterxml.jackson.databind.ObjectMapper()
                            .createObjectNode().put("targetId", page));
                }
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
                while (aw.alive() && System.nanoTime() < deadline) Thread.sleep(25);
                assertFalse(aw.alive(), "Closing the last page must end collection even when Chromium stays running");
                assertTrue(bw.alive());
                assertTrue(nw.alive());
            }
        }
    }

    private static final class LocalProxy implements AutoCloseable {
        final String account;
        final ServerSocket listener;
        final java.util.concurrent.ExecutorService worker = Executors.newCachedThreadPool();
        final CompletableFuture<String> firstRequest = new CompletableFuture<>();
        final CompletableFuture<String> checked = new CompletableFuture<>();
        LocalProxy(String account) throws Exception {
            this.account = account;
            listener = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            worker.submit(() -> {
                while (!listener.isClosed()) {
                    try { var socket = listener.accept(); worker.submit(() -> {
                        try (socket; var reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))) {
                            socket.setSoTimeout(5000);
                            String line = reader.readLine();
                            if (line == null) return;
                            StringBuilder request = new StringBuilder(line);
                            String header;
                            while ((header = reader.readLine()) != null && !header.isBlank()) request.append('\n').append(header);
                            boolean start = line.contains("/start");
                            if (start) firstRequest.complete(request.toString());
                            if (line.contains("/check?")) checked.complete(request.toString());
                            String body = start ? "<script>localStorage.setItem('account','" + account
                                    + "');fetch('/check?stored='+localStorage.getItem('account'));</script>" : "ok";
                            String cookie = start && !account.equals("anon") ? "Set-Cookie: session=" + account + "; Path=/\r\n" : "";
                            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                            socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n"
                                    + cookie + "Content-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n")
                                    .getBytes(StandardCharsets.UTF_8));
                            socket.getOutputStream().write(bytes);
                        } catch (Exception error) { checked.completeExceptionally(error); }
                    }); } catch (Exception error) { if (!listener.isClosed()) checked.completeExceptionally(error); }
                }
            });
        }
        int port() { return listener.getLocalPort(); }
        @Override public void close() throws Exception { listener.close(); worker.shutdownNow(); }
    }
}
