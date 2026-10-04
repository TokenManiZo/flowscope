package io.flowscope.explorer;

import io.flowscope.core.RouteCandidate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.time.Instant;
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
                        @Override public void paused(ExplorerProvider.Result value) {
                            result.set(value);
                            completed.countDown();
                        }
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

    @Test
    void loggedInCodexAcceptsAFollowUpInTheSameThreadBeforeExplicitFinish() throws Exception {
        try (CodexAppServerProvider provider = new CodexAppServerProvider()) {
            assertEquals("READY", provider.readiness());
            CountDownLatch first = new CountDownLatch(1);
            CountDownLatch second = new CountDownLatch(1);
            CountDownLatch finished = new CountDownLatch(1);
            List<ExplorerProvider.Result> turns = new CopyOnWriteArrayList<>();
            AtomicReference<String> failure = new AtomicReference<>();
            ExplorerProvider.Handle handle = provider.start(new ExplorerProvider.Request("run-follow-up",
                    "https://provider-harness.invalid/", List.of("https://provider-harness.invalid/"),
                    List.of(), "http://127.0.0.1:1/request", "http://127.0.0.1:1/discoveries", "token",
                    "Do not call tools or access any target. Return a short JSON result, then wait for a follow-up."),
                    new ExplorerProvider.Listener() {
                        @Override public void activity(ExplorerProvider.Activity value) { }
                        @Override public void paused(ExplorerProvider.Result value) {
                            turns.add(value);
                            if (turns.size() == 1) first.countDown();
                            else second.countDown();
                        }
                        @Override public void completed(ExplorerProvider.Result value) { finished.countDown(); }
                        @Override public void failed(String message) { failure.set(message); finished.countDown(); }
                    });
            assertTrue(first.await(3, TimeUnit.MINUTES), "first Codex turn did not pause");
            assertEquals(1, finished.getCount(), "a completed turn must not end the run");
            handle.steer("Return a second short JSON result in the same conversation; do not call tools.");
            assertTrue(second.await(3, TimeUnit.MINUTES), "follow-up Codex turn did not pause");
            assertEquals(turns.get(0).threadId(), turns.get(1).threadId());
            handle.finish();
            assertTrue(finished.await(10, TimeUnit.SECONDS));
            assertNull(failure.get(), failure.get());
        }
    }
}
