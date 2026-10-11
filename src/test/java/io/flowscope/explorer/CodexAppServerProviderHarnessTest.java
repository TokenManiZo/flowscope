package io.flowscope.explorer;

import io.flowscope.core.RouteCandidate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;

import java.time.Instant;
import java.nio.file.Path;
import java.net.InetSocketAddress;
import com.sun.net.httpserver.HttpServer;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real-provider gate. Normal unit/CI runs never consume a model turn. */
@EnabledIfSystemProperty(named = "flowscope.harness", matches = "true")
final class CodexAppServerProviderHarnessTest {
    @Test
    void rawCodexReadsTheCurrentProjectEvidenceWithoutAFileOrMcp(@TempDir Path temp) throws Exception {
        io.flowscope.core.RequestRecord record = new io.flowscope.core.RequestRecord(
                io.flowscope.core.Source.HUMAN, "https://provider-harness.invalid:443",
                "GET", "/api/example", 200, "anon");
        record.evidenceId = "ev-harness-current-project";
        record.hasResponse = true;
        java.util.concurrent.atomic.AtomicInteger reads = new java.util.concurrent.atomic.AtomicInteger();
        try (CodexAppServerProvider provider = new CodexAppServerProvider(ignored -> { },
                (action, reason) -> false, new ProjectEvidenceReader((run, workspace) -> {
                    reads.incrementAndGet();
                    assertEquals("raw-evidence-harness", run);
                    return List.of(record);
                }))) {
            assertEquals("READY", provider.readiness());
            String model = provider.models().configuredModel();
            if (model.isBlank()) model = provider.models().models().getFirst().id();
            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<ExplorerProvider.Result> result = new AtomicReference<>();
            AtomicReference<String> failure = new AtomicReference<>();
            provider.start(new ExplorerProvider.Request("raw-evidence-harness", "https://provider-harness.invalid/",
                    List.of("https://provider-harness.invalid/"), List.of(), "", "", "", "",
                    model, "", "", "Use flowscope_evidence_list to inspect the current FlowScope project's records. "
                    + "Report the exact Evidence ID you find. Do not run shell commands or access any URL.",
                    true, 0, temp.resolve("raw").toString()), new ExplorerProvider.Listener() {
                @Override public void activity(ExplorerProvider.Activity activity) { }
                @Override public void completed(ExplorerProvider.Result value) { result.set(value); done.countDown(); }
                @Override public void failed(String value) { failure.set(value); done.countDown(); }
            });
            assertTrue(done.await(3, TimeUnit.MINUTES), "real Codex evidence-read turn timed out");
            assertNull(failure.get(), failure.get());
            assertTrue(reads.get() > 0, "Codex did not call the current-project Evidence tool");
            assertTrue(result.get().summary().contains("ev-harness-current-project"), result.get().summary());
        }
    }

    @Test
    void rawCodexNativeCurlUsesThePerRunProxyWithoutFlowScopeTools(@TempDir Path temp) throws Exception {
        AtomicReference<String> captured = new AtomicReference<>();
        HttpServer proxy = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        proxy.createContext("/", exchange -> {
            captured.set(exchange.getRequestURI().toString());
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        proxy.start();
        try (CodexAppServerProvider provider = new CodexAppServerProvider()) {
            assertEquals("READY", provider.readiness());
            String model = provider.models().configuredModel();
            if (model.isBlank()) model = provider.models().models().getFirst().id();
            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<String> failure = new AtomicReference<>();
            provider.start(new ExplorerProvider.Request("raw-harness", "https://provider-harness.invalid/",
                    List.of("https://provider-harness.invalid/"), List.of(), "", "", "", "",
                    model, "", "", "Run exactly one shell command: curl -sS -o /dev/null -w '%{http_code}' "
                            + "http://provider-harness.invalid/probe. Do not access any other URL or write files. "
                            + "Report the exact command output.", true, proxy.getAddress().getPort(),
                    temp.resolve("raw").toString()), new ExplorerProvider.Listener() {
                @Override public void activity(ExplorerProvider.Activity activity) { }
                @Override public void completed(ExplorerProvider.Result result) { done.countDown(); }
                @Override public void failed(String message) { failure.set(message); done.countDown(); }
            });
            assertTrue(done.await(3, TimeUnit.MINUTES), "raw Codex turn timed out");
            assertNull(failure.get(), failure.get());
            assertEquals("http://provider-harness.invalid/probe", captured.get(),
                    "native curl did not pass through the configured local proxy");
        } finally {
            proxy.stop(0);
        }
    }

    @Test
    void realCodexResumesAChatOnTheSameThreadWithFreshGatewayTools() throws Exception {
        try (CodexAppServerProvider provider = new CodexAppServerProvider()) {
            assertEquals("READY", provider.readiness());
            ExplorerProvider.ModelCatalog catalog = provider.models();
            String model = catalog.configuredModel();
            if (model.isBlank()) model = catalog.models().getFirst().id();
            String selectedModel = model;
            ExplorerProvider.ModelOption option = catalog.models().stream()
                    .filter(item -> item.id().equals(selectedModel)).findFirst().orElseThrow();
            String effort = option.efforts().stream().filter(item -> item.effort().equals("low"))
                    .map(ExplorerProvider.ReasoningOption::effort).findFirst()
                    .orElse(option.defaultEffort());
            String threadId;
            try (ExplorerHttpGateway first = new ExplorerHttpGateway(new ExplorerAccountVault(),
                    request -> { throw new AssertionError("the chat question needs no target request"); },
                    value -> value.startsWith("https://provider-harness.invalid/"), "chat-run-1", ignored -> {})) {
                ExplorerProvider.Result answer = chatTurn(provider, first, model, effort, "",
                        "In one short sentence, say you can continue this conversation later.");
                assertFalse(answer.summary().isBlank());
                threadId = answer.threadId();
                assertFalse(threadId.isBlank());
            }
            try (ExplorerHttpGateway second = new ExplorerHttpGateway(new ExplorerAccountVault(),
                    request -> { throw new AssertionError("the follow-up needs no target request"); },
                    value -> value.startsWith("https://provider-harness.invalid/"), "chat-run-2", ignored -> {})) {
                ExplorerProvider.Result answer = chatTurn(provider, second, model, effort, threadId,
                        "In one short sentence, acknowledge this is a follow-up in the same conversation.");
                assertEquals(threadId, answer.threadId());
                assertFalse(answer.summary().isBlank());
            }
        }
    }

    private static ExplorerProvider.Result chatTurn(CodexAppServerProvider provider,
                                                    ExplorerHttpGateway gateway, String model, String effort,
                                                    String threadId, String message) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<ExplorerProvider.Result> result = new AtomicReference<>();
        AtomicReference<String> failure = new AtomicReference<>();
        provider.start(new ExplorerProvider.Request("chat-run", "https://provider-harness.invalid/",
                List.of("https://provider-harness.invalid/"), List.of(), gateway.url(),
                gateway.discoveriesUrl(), gateway.token(), "Use the user's message and FlowScope tools if needed.",
                model, effort, threadId, message), new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity activity) {}
            @Override public void completed(ExplorerProvider.Result value) { result.set(value); done.countDown(); }
            @Override public void failed(String value) { failure.set(value); done.countDown(); }
        });
        assertTrue(done.await(3, TimeUnit.MINUTES), "real Codex chat turn timed out");
        assertNull(failure.get(), failure.get());
        return result.get();
    }

    @Test
    void loggedInCodexListsItsOwnSelectableModels() {
        try (CodexAppServerProvider provider = new CodexAppServerProvider()) {
            assertEquals("READY", provider.readiness());
            ExplorerProvider.ModelCatalog catalog = provider.models();
            assertFalse(catalog.models().isEmpty());
            if (!catalog.configuredModel().isBlank()) {
                assertTrue(catalog.models().stream().anyMatch(model -> model.id().equals(catalog.configuredModel())));
            }
        }
    }

    @Test
    void loggedInCodexInvokesDynamicHttpToolAndReturnsStructuredResult() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        AtomicReference<ExplorerTransport.Request> requestSeen = new AtomicReference<>();
        ExplorerTransport transport = request -> {
            requestSeen.set(request);
            return new ExplorerTransport.Response(200, request.url(), "", "application/json", Map.of(),
                    "{\"service\":\"provider-harness\"}", false, "ev-provider-harness", 1, Instant.now());
        };
        AtomicReference<List<RouteCandidate>> discoveries = new AtomicReference<>(List.of());
        try (ExplorerHttpGateway gateway = new ExplorerHttpGateway(vault, transport,
                value -> value.startsWith("https://provider-harness.invalid/"), "run-provider-harness", ignored -> {},
                discoveries::set);
             CodexAppServerProvider provider = new CodexAppServerProvider()) {
            assertEquals("READY", provider.readiness());
            String selectedModel = "gpt-6.1-sol";
            org.junit.jupiter.api.Assumptions.assumeTrue(provider.models().models().stream()
                    .anyMatch(model -> model.id().equals(selectedModel)), "non-default test model unavailable");
            CountDownLatch completed = new CountDownLatch(1);
            AtomicReference<ExplorerProvider.Result> result = new AtomicReference<>();
            AtomicReference<String> failure = new AtomicReference<>();
            List<ExplorerProvider.Activity> activities = new CopyOnWriteArrayList<>();
            String prompt = "대상 서버에 직접 연결하지 마세요. flowscope_http_request 도구를 정확히 한 번 호출하세요. "
                    + "method GET, url https://provider-harness.invalid/, account 빈 문자열, headers 빈 객체, body 빈 문자열입니다. "
                    + "응답의 Evidence ID를 사용하여 flowscope_record_discoveries를 정확히 한 번 호출하세요. "
                    + "GET https://provider-harness.invalid/api/check, artifact_kind OTHER, locator response:service, "
                    + "reason provider harness, parameters 빈 배열입니다. 그 뒤 summary와 빈 unresolved 배열로 끝내세요.";
            provider.start(new ExplorerProvider.Request("run-provider-harness",
                            "https://provider-harness.invalid/", List.of("https://provider-harness.invalid/"),
                            List.of(), gateway.url(), gateway.discoveriesUrl(), gateway.token(), prompt,
                            selectedModel),
                    new ExplorerProvider.Listener() {
                        @Override public void activity(ExplorerProvider.Activity activity) { activities.add(activity); }
                        @Override public void completed(ExplorerProvider.Result value) {
                            result.set(value);
                            completed.countDown();
                        }
                        @Override public void failed(String message) {
                            failure.set(message);
                            completed.countDown();
                        }
                    });

            assertTrue(completed.await(3, TimeUnit.MINUTES), "Codex app-server harness timed out");
            assertNull(failure.get(), failure.get());
            assertNotNull(result.get());
            assertNotNull(requestSeen.get(), "model did not invoke the loopback HTTP gateway; result="
                    + result.get() + "; activities=" + activities);
            assertEquals("https://provider-harness.invalid/", requestSeen.get().url());
            assertEquals("/api/check", discoveries.get().getFirst().pathTemplate(),
                    "model did not persist the Evidence-bound discovery; activities=" + activities);
        }
    }
}
