package io.flowscope.explorer;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerCoordinatorTest {
    @Test
    void humanAccountsDoNotBlockExplorerAndRemainActiveAfterCancellation() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        for (String account : List.of("A", "B")) {
            contexts.activateHuman(new RunContextRegistry.Context(io.flowscope.core.SourceDetail.BROWSER,
                    io.flowscope.core.Orchestrator.HUMAN, io.flowscope.core.ToolKind.BROWSER,
                    RunPhase.EXPLORATION, "human-" + account, account));
        }
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider,
                contexts, value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            assertNotNull(contexts.current(Source.LLM));
            contexts.activateHuman(new RunContextRegistry.Context(io.flowscope.core.SourceDetail.BROWSER,
                    io.flowscope.core.Orchestrator.HUMAN, io.flowscope.core.ToolKind.BROWSER,
                    RunPhase.EXPLORATION, "human-anon", null));
            coordinator.cancel();
            assertNull(contexts.current(Source.LLM));
            assertEquals(3, contexts.activeHumanRuns().size());
        }
    }

    @Test
    void scannerBlocksExplorerBeforeTheProviderStarts() {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.SCANNER, new RunContextRegistry.Context(io.flowscope.core.SourceDetail.ZAP_CLIENT_SPIDER,
                io.flowscope.core.Orchestrator.SYSTEM, io.flowscope.core.ToolKind.ZAP, RunPhase.EXPLORATION, "scanner"));
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider,
                contexts, value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            assertThrows(IllegalStateException.class, () -> coordinator.start(
                    new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true)));
            assertNull(provider.request.get());
            assertNull(contexts.current(Source.LLM));
            assertEquals("scanner", contexts.current(Source.SCANNER).runId());
        }
    }

    @Test
    void selectedModelIsValidatedBeforeTheRunAndPreservedInRunStatus() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider,
                contexts, value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            assertThrows(IllegalArgumentException.class, () -> coordinator.start(
                    new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true, "unlisted-model")));
            assertNull(contexts.current(Source.LLM));

            ExplorerCoordinator.Snapshot started = coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true, "gpt-6.1-sol"));
            assertEquals("gpt-6.1-sol", started.model());
            await(() -> provider.request.get() != null);
            assertEquals("gpt-6.1-sol", provider.request.get().model());
            assertTrue(provider.request.get().prompt().contains("규칙:"),
                    "the unchanged UI keeps its original one-shot instructions");
        }
    }

    @Test
    void completesOnlyAfterTrustedResponseEvidenceExists() throws Exception {
        FakeProvider provider = new FakeProvider();
        AtomicReference<Pipeline.Result> published = new AtomicReference<>(Pipeline.run(List.of()));
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"), published::get, ignored -> {})) {
            ExplorerCoordinator.Snapshot started = coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            String runId = provider.request.get().runId();
            RequestRecord evidence = new RequestRecord(Source.LLM, "https://app.example.test:443",
                    "GET", "/api/orders/1", 200, "anon");
            evidence.hasResponse = true;
            evidence.body = "{\"id\":1}";
            evidence.phase = RunPhase.EXPLORATION;
            evidence.runId = runId;
            evidence.executionTrust = ExecutionTrust.CONTROLLED;
            published.set(Pipeline.run(List.of(evidence)));

            provider.listener.get().completed(new ExplorerProvider.Result("탐색 완료", List.of(), "thread-1"));

            await(() -> coordinator.current().status() == ExplorerCoordinator.Status.COMPLETED);
            assertEquals(ExplorerCoordinator.Status.COMPLETED, coordinator.current().status());
            assertTrue(coordinator.current().message().startsWith("Explorer 완료 · HTTP 시도 0건"));
            assertFalse(coordinator.current().message().contains("탐색 완료"),
                    "provider free text must not become the authoritative count summary");
            assertNull(contexts.current(Source.LLM));
        }
    }

    @Test
    void aReplyWithoutTrafficKeepsTheConversationAvailableForTheNextMessage() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no target request was made"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true, "gpt-6.1-sol", "What can you inspect?"));
            await(() -> provider.listener.get() != null);
            assertTrue(provider.request.get().prompt().contains("사용자의 현재 요청"));
            provider.listener.get().assistantDelta("I can inspect");
            assertEquals("I can inspect", coordinator.chatMessages().getLast().text());
            provider.listener.get().completed(new ExplorerProvider.Result("I can inspect the selected site.",
                    List.of(), "persistent-thread"));
            await(() -> !activeStatus(coordinator));
            assertEquals(ExplorerCoordinator.Status.COMPLETED, coordinator.current().status());
            assertNull(contexts.current(Source.LLM));
            assertEquals(List.of("What can you inspect?", "I can inspect the selected site."),
                    coordinator.chatMessages().stream().map(ExplorerCoordinator.ChatMessage::text).toList());

            coordinator.clear();
            assertEquals(2, coordinator.chatMessages().size(),
                    "clearing the old run display must not delete a persisted conversation");

            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true, "gpt-6.1-sol", "Now inspect the API"));
            await(() -> provider.request.get() != null
                    && "Now inspect the API".equals(provider.request.get().userMessage()));
            assertEquals("persistent-thread", provider.request.get().threadId());
            assertEquals("Now inspect the API", provider.request.get().userMessage());
            assertEquals(3, coordinator.chatMessages().size());
            coordinator.steer("Also inspect the profile page");
            assertEquals("Also inspect the profile page", coordinator.chatMessages().getLast().text(),
                    "a message sent during a turn must remain visible in the chat transcript");
        }
    }

    @Test
    void rejectsUnsupportedEffortAndSendsTheChosenEffortWithTheTurn() throws Exception {
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no target request was made"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            assertThrows(IllegalArgumentException.class, () -> coordinator.start(
                    new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true,
                            "gpt-6.1-sol", "ultra", "Inspect the API")));
            assertEquals(ExplorerCoordinator.Status.IDLE, coordinator.current().status());
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true,
                    "gpt-6.1-sol", "high", "Inspect the API"));
            await(() -> provider.request.get() != null);
            assertEquals("high", provider.request.get().effort());
            assertEquals("high", coordinator.current().effort());
        }
    }

    @Test
    void restoredProjectChatResumesItsOwnThreadWithoutReusingCredentials() throws Exception {
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no target request was made"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            ExplorerChatState restored = new ExplorerChatState("saved-thread", "https://app.example.test/",
                    List.of(new ExplorerChatState.Message("user", "Earlier question", "old-run",
                            "2026-10-10T00:00:00Z")), "gpt-6.1-sol", "high");
            coordinator.restoreChatState(restored);
            assertEquals(restored, coordinator.chatState());
            assertTrue(coordinator.accounts().isEmpty(), "project chat must not restore live login credentials");
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(),
                    true, "gpt-6.1-sol", "Follow up"));
            await(() -> provider.request.get() != null);
            assertEquals("saved-thread", provider.request.get().threadId());
            assertEquals(2, coordinator.chatMessages().size());
        }
    }

    @Test
    void untrustedTargetResponseDoesNotEraseTheChatOrClaimLaneCompletion() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<Pipeline.Result> published = new AtomicReference<>(Pipeline.run(List.of()));
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("the fake supplies the record"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"), published::get, ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(),
                    true, "gpt-6.1-sol", "Inspect the API"));
            await(() -> provider.request.get() != null);
            String runId = provider.request.get().runId();
            RequestRecord untrusted = new RequestRecord(Source.LLM, "https://app.example.test:443",
                    "GET", "/api/orders", 200, "anon");
            untrusted.hasResponse = true;
            untrusted.phase = RunPhase.EXPLORATION;
            untrusted.runId = runId;
            untrusted.executionTrust = ExecutionTrust.UNVERIFIED_RUNTIME;
            published.set(Pipeline.run(List.of(untrusted)));
            provider.listener.get().completed(new ExplorerProvider.Result("I received a response, but its Evidence is incomplete.",
                    List.of(), "thread-after-error"));
            await(() -> !activeStatus(coordinator));
            assertEquals(ExplorerCoordinator.Status.COMPLETED_WITH_LIMITATIONS, coordinator.current().status());
            assertTrue(coordinator.current().unresolved().stream().anyMatch(item -> item.kind().equals("EVIDENCE_INCOMPLETE")));
            assertEquals("I received a response, but its Evidence is incomplete.", coordinator.chatMessages().getLast().text());
            assertEquals("thread-after-error", coordinator.chatState().threadId());
            assertNull(contexts.completedRun(Source.LLM));
        }
    }

    @Test
    void aFailedChatTurnRetainsTheStartedThreadForAUserFollowUp() throws Exception {
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no request"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(),
                    true, "gpt-6.1-sol", "Inspect this target"));
            await(() -> provider.listener.get() != null);
            provider.listener.get().threadReady("thread-survives-failure");
            provider.listener.get().failed("temporary model failure");
            await(() -> !activeStatus(coordinator));
            assertEquals("thread-survives-failure", coordinator.chatState().threadId());
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(),
                    true, "gpt-6.1-sol", "Continue after the failure"));
            await(() -> provider.request.get() != null && provider.request.get().runId()
                    .equals(coordinator.current().runId()));
            assertEquals("thread-survives-failure", provider.request.get().threadId());
        }
    }

    /** Fake login window holding whatever the "operator" put in it. */
    private static final class FakeWindow implements LoginBrowser {
        final List<java.net.HttpCookie> cookies = new java.util.ArrayList<>();
        final java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();
        int opened;
        int acted;
        boolean closed;
        boolean recording;
        java.util.function.Consumer<Exchange> sink = exchange -> { };

        /** Replays what the page itself fetched, without the Explorer having asked for it. */
        void emit(String url) { emit(url, java.util.Map.of("Cookie", "session=abc")); }
        void emit(String url, java.util.Map<String, String> requestHeaders) {
            sink.accept(new Exchange("GET", url, requestHeaders, "", 200,
                    java.util.Map.of("Content-Type", "application/json"), "{}"));
        }
        @Override public Session open(java.net.URI loginUrl,
                java.util.function.Consumer<Exchange> recorder) {
            opened++;
            sink = recorder;
            return new Session() {
                @Override public List<java.net.HttpCookie> cookies(java.net.URI target) { return List.copyOf(cookies); }
                @Override public java.util.Map<java.lang.String, java.lang.String> authHeaders(java.net.URI target) {
                    return java.util.Map.copyOf(headers);
                }
                @Override public void recording(boolean on) { recording = on; }
                @Override public Page navigate(java.lang.String url) { return page(url); }
                @Override public Page snapshot() { return page("https://app.example.test/"); }
                @Override public Page click(java.lang.String ref) { return page("https://app.example.test/" + ref); }
                @Override public Page type(java.lang.String ref, java.lang.String text) {
                    return page("https://app.example.test/" + ref);
                }
                @Override public Page back() { return page("https://app.example.test/"); }
                private Page page(java.lang.String url) {
                    acted++;
                    recorder.accept(new Exchange("GET", url, java.util.Map.of("Cookie", "session=abc"), "", 200,
                            java.util.Map.of("Content-Type", "text/html"), "<html></html>"));
                    return new Page(url, "title", List.of(new Element("e1", "button", "열기")), "text");
                }
                @Override public boolean alive() { return !closed; }
                @Override public void close() { closed = true; }
            };
        }
    }

    @Test
    void browserLoginAdoptsTheWindowSessionOnlyWhenTheOperatorCompletes() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        FakeWindow window = new FakeWindow();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(vault,
                request -> { throw new AssertionError("no HTTP during login"); }, new FakeProvider(),
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.loginBrowser(window);
            assertThrows(IllegalArgumentException.class, () -> coordinator.openBrowserLogin(
                    "human-a", "USER A", "USER", "https://evil.example.test/"));

            ExplorerAccountVault.View waiting = coordinator.openBrowserLogin(
                    "human-a", "USER A", "USER", "https://app.example.test/");
            assertEquals(ExplorerAccountVault.AuthStatus.NEEDS_INPUT, waiting.status());
            assertTrue(waiting.browserOpen());
            // Nothing in the window yet: completing early must not create an empty session.
            assertThrows(IllegalStateException.class, () -> coordinator.completeBrowserLogin("human-a"));

            java.net.HttpCookie cookie = new java.net.HttpCookie("session-id", "s1");
            cookie.setPath("/");
            window.cookies.add(cookie);
            window.headers.put("X-CSRFToken", "c1");
            ExplorerAccountVault.View ready = coordinator.completeBrowserLogin("human-a");

            assertEquals(ExplorerAccountVault.AuthStatus.READY, ready.status());
            assertTrue(ready.browserOpen(), "the window stays open for a later re-login");
            java.util.Map<String, String> sent = vault.authenticationHeaders("human-a",
                    java.net.URI.create("https://app.example.test/api/users/me/"));
            assertEquals("session-id=s1", sent.get("Cookie"));
            assertEquals("c1", sent.get("X-CSRFToken"));
            // Reopening while the window lives reuses it instead of launching another browser.
            coordinator.openBrowserLogin("human-a", "USER A", "USER", "https://app.example.test/");
            assertEquals(1, window.opened);

            coordinator.removeAccount("human-a");
            assertTrue(window.closed);
            assertThrows(IllegalStateException.class, () -> coordinator.completeBrowserLogin("human-a"));
        }
    }

    @Test
    void runWithAnAccountThatNeverCompletedLoginFailsInsteadOfExploringAnonymously() throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(vault,
                request -> { throw new AssertionError("no HTTP"); }, provider, new RunContextRegistry(),
                value -> value.startsWith("https://app.example.test/"), () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.loginBrowser(new FakeWindow());
            coordinator.openBrowserLogin("human-a", "USER A", "USER", "https://app.example.test/");
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of("human-a"), false));

            await(() -> coordinator.current().status() == ExplorerCoordinator.Status.FAILED);
            assertNull(provider.request.get());
            assertTrue(coordinator.current().unresolved().stream()
                    .anyMatch(item -> item.reason().contains("[로그인 완료]")));
        }
    }

    @Test
    void lateProviderCompletionCannotOverwriteCancellation() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true));
            await(() -> provider.listener.get() != null);

            coordinator.cancel();
            provider.listener.get().completed(new ExplorerProvider.Result("late", List.of(), "thread-late"));

            assertEquals(ExplorerCoordinator.Status.CANCELLED, coordinator.current().status());
            assertNull(contexts.current(Source.LLM));
        }
    }

    @Test
    void recheckInvalidatesProviderReadinessCache() {
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider,
                new RunContextRegistry(), value -> true, () -> Pipeline.run(List.of()), ignored -> {})) {
            assertEquals("READY", coordinator.recheckProvider().providerReadiness());
            assertEquals(1, provider.invalidations);
        }
    }

    private static void await(java.util.function.BooleanSupplier ready) throws InterruptedException {
        await(ready, 100);
    }

    private static void await(java.util.function.BooleanSupplier ready, int tries) throws InterruptedException {
        for (int count = 0; count < tries && !ready.getAsBoolean(); count++) Thread.sleep(10);
        assertTrue(ready.getAsBoolean());
    }

    /** Drives one account to a RUNNING run whose window is already adopted, so browser behaviour can be exercised. */
    private static ExplorerCoordinator running(FakeWindow window, FakeProvider provider,
                                               java.util.List<ExplorerCoordinator.BrowserExchange> recorded)
            throws Exception {
        ExplorerAccountVault vault = new ExplorerAccountVault();
        ExplorerCoordinator coordinator = new ExplorerCoordinator(vault,
                request -> { throw new AssertionError("no gateway transport in this test"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {});
        coordinator.loginBrowser(window);
        if (recorded != null) coordinator.browserRecorder(recorded::add);
        window.cookies.add(cookie("session", "abc"));
        coordinator.openBrowserLogin("usera", "USER A", "USER", "https://app.example.test/");
        coordinator.completeBrowserLogin("usera");
        coordinator.start(new ExplorerCoordinator.StartRequest(
                "https://app.example.test/", List.of("usera"), false, "", "Explore the selected site"));
        await(() -> coordinator.current().status() == ExplorerCoordinator.Status.RUNNING);
        return coordinator;
    }

    private static java.net.HttpCookie cookie(String name, String value) {
        java.net.HttpCookie cookie = new java.net.HttpCookie(name, value);
        cookie.setPath("/");
        cookie.setVersion(0);
        return cookie;
    }

    /** The operator's stop switch: closing the window ends the run, whatever the model was about to do next. */
    @Test
    void closingTheWindowCancelsTheRunAndStopsCollection() throws Exception {
        FakeWindow window = new FakeWindow();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), recorded)) {
            coordinator.browserAction("usera", "navigate", "https://app.example.test/a", "", "");
            assertEquals(1, recorded.size());

            window.closed = true;
            await(() -> coordinator.current().status() == ExplorerCoordinator.Status.CANCELLED, 600);
            assertEquals(ExplorerCoordinator.Status.CANCELLED, coordinator.current().status());
            assertTrue(coordinator.current().activities().stream()
                            .anyMatch(value -> value.title().contains("브라우저 창 종료")),
                    coordinator.current().activities().toString());

            // Nothing more may be driven or collected once the operator has pulled the switch.
            assertThrows(IllegalStateException.class,
                    () -> coordinator.browserAction("usera", "click", "", "e1", ""));
            assertEquals(1, recorded.size());
        }
    }

    @Test
    void accountBrowserDoesNotCollectAnonymousResourcesOrPendingLoginTraffic() throws Exception {
        FakeWindow window = new FakeWindow();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded = new java.util.ArrayList<>();
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), recorded)) {
            window.emit("https://app.example.test/site.webmanifest.json", java.util.Map.of());
            window.emit("https://app.example.test/api/public", java.util.Map.of("Authorization", " "));
            assertTrue(recorded.isEmpty(), "Account exploration must not create anon Evidence");
            window.emit("https://app.example.test/api/me");
            assertEquals(1, recorded.size());
            assertEquals("usera", recorded.getFirst().accountId());

            coordinator.openBrowserLogin("usera", "USER A", "USER", "https://app.example.test/");
            window.emit("https://app.example.test/login");
            assertEquals(1, recorded.size(), "Re-login traffic must wait for explicit login completion");
            coordinator.completeBrowserLogin("usera");
            window.emit("https://app.example.test/api/after-login");
            assertEquals(2, recorded.size());
        }
    }

    /** The window outlives the run; what the operator does in it afterwards is theirs, not this run's Evidence. */
    @Test
    void collectionStopsWhenTheRunEnds() throws Exception {
        FakeWindow window = new FakeWindow();
        FakeProvider provider = new FakeProvider();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = running(window, provider, recorded)) {
            window.emit("https://app.example.test/api/during");
            assertEquals(1, recorded.size());

            provider.listener.get().completed(new ExplorerProvider.Result("\ub05d", List.of(), "thread-1"));
            await(() -> !activeStatus(coordinator));
            assertFalse(window.recording, "the window must stop recording when the run ends");

            // The operator keeps using the window: none of it belongs to the finished run.
            window.emit("https://app.example.test/api/after");
            assertEquals(1, recorded.size(), recorded.toString());
        }
    }

    /** Captured browser traffic must not silently disappear after an arbitrary per-run count. */
    @Test
    void browserExchangesContinueBeyondTheFormerRunCeiling() throws Exception {
        FakeWindow window = new FakeWindow();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), recorded)) {
            assertEquals(ExplorerCoordinator.Status.RUNNING, coordinator.current().status());
            for (int count = 0; count < 3_001; count++) window.emit("https://app.example.test/api/" + count);
            assertEquals(3_001, recorded.size());
            assertEquals(3_001, coordinator.browserBudget().endpoints());
        }
    }

    /** A run that only looks around must not read as a run that did nothing. */
    @Test
    void snapshotsAreCountedAndLoggedWhileStayingFreeOfTheBudget() throws Exception {
        FakeWindow window = new FakeWindow();
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), null)) {
            coordinator.browserAction("usera", "snapshot", "", "", "");
            coordinator.browserAction("usera", "snapshot", "", "", "");

            ExplorerCoordinator.BrowserBudget spent = coordinator.browserBudget();
            assertEquals(2, spent.snapshots());
            assertEquals(0, spent.actions(), "snapshots must not spend the action budget");
            assertTrue(coordinator.current().activities().stream()
                            .anyMatch(value -> "BROWSER".equals(value.kind()) && "snapshot".equals(value.title())),
                    coordinator.current().activities().toString());
        }
    }

    private static boolean activeStatus(ExplorerCoordinator coordinator) {
        ExplorerCoordinator.Status status = coordinator.current().status();
        return status == ExplorerCoordinator.Status.RUNNING
                || status == ExplorerCoordinator.Status.AUTHENTICATING;
    }

    /** Repeated actions that surface nothing new are the model's business, not a reason to end collection. */
    @Test
    void repeatedActionsOnTheSamePageDoNotEndTheRun() throws Exception {
        FakeWindow window = new FakeWindow();
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), null)) {
            for (int count = 0; count < 8; count++) {
                coordinator.browserAction("usera", "navigate", "https://app.example.test/same", "", "");
            }
            assertEquals(ExplorerCoordinator.Status.RUNNING, coordinator.current().status());
            assertEquals(8, coordinator.browserBudget().actions());
            assertEquals(1, coordinator.browserBudget().endpoints());
        }
    }

    /** The old 300-action/15-minute defaults must not stop an operator-directed chat. */
    @Test
    void browserActionsContinueBeyondTheFormerRunCeiling() throws Exception {
        FakeWindow window = new FakeWindow();
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), null)) {
            ExplorerCoordinator.BrowserBudget budget = coordinator.browserBudget();
            assertEquals(0, budget.maxActions());
            assertEquals(0, budget.minutes());
            assertEquals(0, budget.snapshots());
            assertTrue(budget.elapsedMillis() >= 0 && budget.elapsedMillis() < 60_000, budget.toString());

            for (int count = 0; count < 301; count++) {
                coordinator.browserAction("usera", "navigate", "https://app.example.test/" + count, "", "");
            }
            assertEquals(301, coordinator.browserBudget().actions());
            assertNotNull(coordinator.browserAction("usera", "snapshot", "", "", ""));
        }
    }

    /** Out-of-scope traffic the page pulls in is not this run's Evidence. */
    @Test
    void offScopeBrowserTrafficIsNotCollected() throws Exception {
        FakeWindow window = new FakeWindow();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), recorded)) {
            assertThrows(IllegalArgumentException.class,
                    () -> coordinator.browserAction("usera", "navigate", "https://cdn.example.test/x.js", "", ""));
            window.emit("https://cdn.example.test/analytics.js");
            assertTrue(recorded.isEmpty(), recorded.toString());

            window.emit("https://app.example.test/api/me");
            assertEquals(1, recorded.size());
            assertEquals("usera", recorded.get(0).accountId());
            assertEquals(coordinator.current().runId(), recorded.get(0).runId());
        }
    }

    private static final class FakeProvider implements ExplorerProvider {
        private final AtomicReference<Request> request = new AtomicReference<>();
        private final AtomicReference<Listener> listener = new AtomicReference<>();
        private int invalidations;
        @Override public String readiness() { return "READY"; }
        @Override public ModelCatalog models() {
            return new ModelCatalog("gpt-5.6-sol", List.of(
                    new ModelOption("gpt-5.6-sol", "GPT-5.6 Sol", false),
                    new ModelOption("gpt-6.1-sol", "GPT-6.1 Sol", true, "medium", List.of(
                            new ReasoningOption("medium", "Balanced"),
                            new ReasoningOption("high", "Deeper")))));
        }
        @Override public void invalidateReadiness() { invalidations++; }
        @Override public Handle start(Request request, Listener listener) {
            this.request.set(request);
            this.listener.set(listener);
            return new Handle() { @Override public void steer(String message) { } @Override public void cancel() { } };
        }
        @Override public void close() { }
    }
}
