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
    void selectedModelIsValidatedBeforeTheRunAndPreservedInRunStatus() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider,
                contexts, value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.loginBrowser(new FakeWindow());
            assertThrows(IllegalArgumentException.class, () -> coordinator.start(
                    new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true, "unlisted-model")));
            assertNull(contexts.current(Source.LLM));

            ExplorerCoordinator.Snapshot started = coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true, "gpt-6.1-sol"));
            assertEquals("gpt-6.1-sol", started.model());
            await(() -> provider.request.get() != null);
            assertEquals("gpt-6.1-sol", provider.request.get().model());
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
            coordinator.loginBrowser(new FakeWindow());
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

    /** Fake login window holding whatever the "operator" put in it. */
    private static final class FakeWindow implements LoginBrowser {
        final List<java.net.HttpCookie> cookies = new java.util.ArrayList<>();
        final java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();
        int opened;
        int acted;
        boolean closed;
        boolean recording;
        String recordingRunId;
        java.util.function.Consumer<Exchange> sink = exchange -> { };

        /** Replays what the page itself fetched, without the Explorer having asked for it. */
        void emit(String url) {
            if (recording) sink.accept(new Exchange(recordingRunId, "GET", url, java.util.Map.of(), "", 200,
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
                @Override public void recording(String runId,
                        java.util.function.Predicate<BrowserRequest> requestAllowed) {
                    recordingRunId = runId;
                    recording = runId != null;
                }
                @Override public Page navigate(java.lang.String url) { return page(url); }
                @Override public Page snapshot() { return page("https://app.example.test/"); }
                @Override public Page click(java.lang.String ref) { return page("https://app.example.test/" + ref); }
                @Override public Page type(java.lang.String ref, java.lang.String text) {
                    return page("https://app.example.test/" + ref);
                }
                @Override public Page back() { return page("https://app.example.test/"); }
                private Page page(java.lang.String url) {
                    acted++;
                    if (recording) recorder.accept(new Exchange(recordingRunId, "GET", url, java.util.Map.of(), "", 200,
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
            coordinator.loginBrowser(new FakeWindow());
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
                "https://app.example.test/", List.of("usera"), false));
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

    @Test
    void aReusedLoginWindowRecordsOnlyTheNewRunAfterCancellation() throws Exception {
        FakeWindow window = new FakeWindow();
        FakeProvider provider = new FakeProvider();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = running(window, provider, recorded)) {
            String firstRun = coordinator.current().runId();
            window.emit("https://app.example.test/api/first");
            assertEquals(1, recorded.size());
            assertEquals(firstRun, recorded.getFirst().runId());

            coordinator.cancel();
            assertFalse(window.recording);
            window.emit("https://app.example.test/api/between");
            assertEquals(1, recorded.size(), "idle browsing is not LLM run Evidence");

            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of("usera"), false));
            await(() -> coordinator.current().status() == ExplorerCoordinator.Status.RUNNING);
            String secondRun = coordinator.current().runId();
            assertNotEquals(firstRun, secondRun);
            assertTrue(window.recording, "the selected window must resume CDP recording for the new run");
            window.emit("https://app.example.test/api/second");
            assertEquals(2, recorded.size());
            assertEquals(secondRun, recorded.get(1).runId());
        }
    }

    @Test
    void loginControlsCannotTurnOffRecordingDuringAnActiveRun() throws Exception {
        FakeWindow window = new FakeWindow();
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), null)) {
            assertThrows(IllegalStateException.class, () -> coordinator.openBrowserLogin(
                    "usera", "USER A", "USER", "https://app.example.test/"));
            assertThrows(IllegalStateException.class, () -> coordinator.completeBrowserLogin("usera"));
            assertTrue(window.recording);
        }
    }

    @Test
    void anonymousRunOpensGuardedBrowserAndClosesItWhenCancelled() throws Exception {
        FakeWindow window = new FakeWindow();
        FakeProvider provider = new FakeProvider();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no gateway transport in this test"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.loginBrowser(window);
            coordinator.browserRecorder(recorded::add);
            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            assertEquals(1, window.opened);
            assertTrue(window.recording);
            assertEquals(1, recorded.size(), "anonymous browser must load the target before the model starts");
            assertEquals("https://app.example.test/", recorded.getFirst().url());
            coordinator.browserAction("", "navigate", "https://app.example.test/area", "", "");
            assertEquals(2, recorded.size());
            assertEquals("", recorded.getLast().accountId());
            assertEquals(coordinator.current().runId(), recorded.getLast().runId());
            coordinator.cancel();
            assertTrue(window.closed);
            assertFalse(window.recording);
        }
    }

    @Test
    void rejectedDiscoveryCannotFinishUntilReviewedAndExplicitlyReported() throws Exception {
        FakeProvider provider = new FakeProvider();
        AtomicReference<Pipeline.Result> published = new AtomicReference<>(Pipeline.run(List.of()));
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> new ExplorerTransport.Response(200, request.url(), "", "application/javascript",
                        java.util.Map.of(), "const route='/api/{id}/{id}'", false,
                        "ev-artifact", 1, java.time.Instant.now()),
                provider, new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                published::get, ignored -> {})) {
            coordinator.loginBrowser(new FakeWindow());
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            ExplorerProvider.Request run = provider.request.get();
            String response = explorerPost(run.gatewayUrl(), run.gatewayToken(),
                    "{\"account\":\"\",\"method\":\"GET\",\"url\":\"https://app.example.test/main.js\",\"headers\":{},\"body\":\"\"}");
            assertTrue(response.contains("ev-artifact"));
            String issue = explorerPost(run.discoveryUrl(), run.gatewayToken(), """
                    {"discoveries":[{"method":"GET","url":"https://app.example.test/api/{id}/{id}",
                      "evidence_ids":["ev-artifact"],"artifact_kind":"JAVASCRIPT","locator":"main.js:1",
                      "reason":"route","parameters":[{"location":"PATH","field_path":"id",
                      "display_name":"id","requirement":"UNKNOWN"}]}]}
                    """);
            String issueId = new com.fasterxml.jackson.databind.ObjectMapper().readTree(issue)
                    .path("rejected_parameters").get(0).path("issue_id").asText();
            assertFalse(issueId.isBlank());
            ExplorerProvider.Result ignored = new ExplorerProvider.Result("done", List.of(), "t1");
            assertFalse(provider.listener.get().review(ignored, 1).isBlank());
            explorerPost(run.gatewayUrl().replace("/request", "/worklist"), run.gatewayToken(), "{}");
            ExplorerProvider.Result blocked = new ExplorerProvider.Result("limited",
                    List.of(new ExplorerProvider.Unresolved("DISCOVERY_BLOCKED", issueId,
                            "같은 이름의 두 PATH 위치를 산출물에서 구별할 근거가 없습니다.")), "t1");
            assertEquals("", provider.listener.get().review(blocked, 2));
            RequestRecord evidence = new RequestRecord(Source.LLM, "https://app.example.test:443",
                    "GET", "/main.js", 200, "anon");
            evidence.hasResponse = true;
            evidence.phase = RunPhase.EXPLORATION;
            evidence.runId = run.runId();
            evidence.executionTrust = ExecutionTrust.CONTROLLED;
            published.set(Pipeline.run(List.of(evidence)));
            provider.listener.get().completed(blocked);
            assertEquals(ExplorerCoordinator.Status.COMPLETED_WITH_LIMITATIONS, coordinator.current().status());
        }
    }

    @Test
    void ignoredDiscoveryRejectionFailsTheCompletionGate() throws Exception {
        FakeProvider provider = new FakeProvider();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("no HTTP request expected"); }, provider,
                new RunContextRegistry(), value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.loginBrowser(new FakeWindow());
            coordinator.start(new ExplorerCoordinator.StartRequest("https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            ExplorerProvider.Request run = provider.request.get();
            String rejected = explorerPost(run.discoveryUrl(), run.gatewayToken(), """
                    {"discoveries":[{"method":"GET","url":"https://app.example.test/api/hidden",
                      "evidence_ids":["ev-invented"],"artifact_kind":"JAVASCRIPT","locator":"main.js:1",
                      "reason":"route","parameters":[]}]}
                    """);
            assertTrue(rejected.contains("issue_id"));
            provider.listener.get().completed(new ExplorerProvider.Result("done", List.of(), "t1"));
            assertEquals(ExplorerCoordinator.Status.FAILED, coordinator.current().status());
            assertTrue(coordinator.current().message().contains("저장 거부"));
        }
    }

    private static String explorerPost(String url, String token, String body) throws Exception {
        java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(url))
                .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build();
        return java.net.http.HttpClient.newHttpClient()
                .send(request, java.net.http.HttpResponse.BodyHandlers.ofString()).body();
    }

    /** One page load fires dozens of requests; without a ceiling a single run can eat the whole project. */
    @Test
    void browserExchangesStopAtTheRunCeiling() throws Exception {
        FakeWindow window = new FakeWindow();
        java.util.List<ExplorerCoordinator.BrowserExchange> recorded =
                java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        System.setProperty("flowscope.explorer.browserExchanges", "3");
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), recorded)) {
            assertEquals(ExplorerCoordinator.Status.RUNNING, coordinator.current().status());
            for (int count = 0; count < 10; count++) window.emit("https://app.example.test/api/" + count);
            assertEquals(3, recorded.size(), recorded.toString());
        } finally {
            System.clearProperty("flowscope.explorer.browserExchanges");
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

    /** The action ceiling stops the run; the clock is a ceiling too, never a duration the run has to serve out. */
    @Test
    void budgetReportsACeilingAndRefusesActionsBeyondIt() throws Exception {
        FakeWindow window = new FakeWindow();
        System.setProperty("flowscope.explorer.browserActions", "2");
        try (ExplorerCoordinator coordinator = running(window, new FakeProvider(), null)) {
            ExplorerCoordinator.BrowserBudget budget = coordinator.browserBudget();
            assertEquals(2, budget.maxActions());
            assertEquals(15, budget.minutes());
            assertEquals(0, budget.snapshots());
            assertTrue(budget.elapsedMillis() >= 0 && budget.elapsedMillis() < 60_000, budget.toString());

            coordinator.browserAction("usera", "navigate", "https://app.example.test/a", "", "");
            coordinator.browserAction("usera", "navigate", "https://app.example.test/b", "", "");
            assertThrows(IllegalStateException.class,
                    () -> coordinator.browserAction("usera", "navigate", "https://app.example.test/c", "", ""));
            // snapshot is free: the model must always be able to see where it already is.
            assertNotNull(coordinator.browserAction("usera", "snapshot", "", "", ""));
        } finally {
            System.clearProperty("flowscope.explorer.browserActions");
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
                    new ModelOption("gpt-6.1-sol", "GPT-6.1 Sol", true)));
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
