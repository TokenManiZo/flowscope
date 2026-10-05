package io.flowscope.explorer;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;

/** A human-controlled, non-persistent browser context routed to one Burp listener. */
public final class HumanChromiumBrowser {
    private static final ObjectMapper JSON = new ObjectMapper();

    public interface Window extends AutoCloseable {
        boolean alive();
        @Override void close();
    }

    static List<String> arguments(Path executable, Path profile, int port) {
        return new ArrayList<>(List.of(executable.toString(), "--user-data-dir=" + profile,
                "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
                "--disable-background-networking", "--disable-sync", "--disable-breakpad",
                "--incognito", "--proxy-server=http://127.0.0.1:" + port, "--proxy-bypass-list=<-loopback>",
                // Dedicated inspection browser: accepts Burp's interception certificate without OS trust changes.
                "--ignore-certificate-errors", "--disable-blink-features=AutomationControlled", "about:blank"));
    }

    public Window open(URI target, int port) throws IOException {
        Path executable = ChromiumLoginBrowser.resolveExecutable(Path.of(System.getProperty("java.home", ".")));
        if (executable == null) throw new IOException("Chromium/Chrome을 찾지 못했습니다. Chrome을 설치한 뒤 다시 시작하세요.");
        return open(executable, target, port, false);
    }

    /** The runtime test uses the same launch/context code, with only headless rendering added. */
    Window open(Path executable, URI target, int port, boolean headless) throws IOException {
        Path profile = Files.createTempDirectory("flowscope-human-browser-");
        Process process = null;
        ChromiumLoginBrowser.Cdp cdp = null;
        try {
            List<String> command = arguments(executable, profile, port);
            if (headless) command.add(1, "--headless=new");
            process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            Process running = process;
            CompletableFuture<Matcher> endpoint = new CompletableFuture<>();
            Thread reader = new Thread(() -> {
                try (var lines = new BufferedReader(new InputStreamReader(running.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = lines.readLine()) != null) {
                        Matcher match = ChromiumLoginBrowser.DEVTOOLS_LINE.matcher(line);
                        if (!endpoint.isDone() && match.find()) endpoint.complete(match);
                    }
                } catch (IOException ignored) { /* No browser output is logged or stored. */ }
                endpoint.completeExceptionally(new IOException("Chromium exited"));
            }, "flowscope-human-browser-start");
            reader.setDaemon(true);
            reader.start();
            Matcher line = endpoint.get(20, TimeUnit.SECONDS);
            cdp = ChromiumLoginBrowser.Cdp.connect(URI.create(line.group(1)), line.group(2), null);
            String context = cdp.call("Target.createBrowserContext", JSON.createObjectNode()
                    .put("disposeOnDetach", true).put("proxyServer", "http://127.0.0.1:" + port)
                    .put("proxyBypassList", "<-loopback>")).path("browserContextId").asText();
            if (context.isBlank()) throw new IOException("Chromium did not create an isolated context");
            var pages = java.util.concurrent.ConcurrentHashMap.<String>newKeySet();
            cdp.watchTargets(message -> {
                var params = message.path("params");
                var info = params.path("targetInfo");
                if (context.equals(info.path("browserContextId").asText()) && "page".equals(info.path("type").asText())) {
                    pages.add(info.path("targetId").asText());
                }
                if ("Target.targetDestroyed".equals(message.path("method").asText())) pages.remove(params.path("targetId").asText());
            });
            cdp.call("Target.createTarget", JSON.createObjectNode().put("url", target.toString())
                    .put("browserContextId", context).put("newWindow", true));
            // Remove the bootstrap window; closing the operator's last window now ends this browser process.
            for (var info : cdp.call("Target.getTargets").path("targetInfos")) {
                if ("page".equals(info.path("type").asText()) && !context.equals(info.path("browserContextId").asText())) {
                    cdp.call("Target.closeTarget", JSON.createObjectNode().put("targetId", info.path("targetId").asText()));
                }
            }
            return new BrowserWindow(running, profile, cdp, pages);
        } catch (Exception error) {
            if (cdp != null) cdp.close();
            stop(process, profile);
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IOException("수집 브라우저를 열지 못했습니다. Chromium/Chrome 실행 상태를 확인하세요.", error);
        }
    }

    record BrowserWindow(Process process, Path profile, ChromiumLoginBrowser.Cdp connection,
                         java.util.Set<String> pages) implements Window {
        @Override public boolean alive() { return process.isAlive() && !pages.isEmpty(); }
        @Override public void close() { connection.close(); stop(process, profile); }
    }

    private static void stop(Process process, Path profile) {
        if (process != null) {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
            try { process.waitFor(3, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
        try (var paths = Files.walk(profile)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
        } catch (IOException ignored) { /* Context credentials never reach this bootstrap profile. */ }
    }
}
