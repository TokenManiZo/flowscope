package io.flowscope.explorer;

import io.flowscope.core.LaneCompletionPolicy;
import io.flowscope.core.TextLimits;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;

/** 계정 준비 → loopback HTTP gateway → Codex turn → Evidence 완료 gate를 소유한다. */
public final class ExplorerCoordinator implements AutoCloseable {
    public enum Status {
        IDLE, AUTHENTICATING, RUNNING, COMPLETED, COMPLETED_WITH_LIMITATIONS,
        FAILED, CANCELLED, FAILED_CLEANUP
    }

    public record StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model) {
        public StartRequest {
            accountIds = List.copyOf(accountIds == null ? List.of() : accountIds);
            model = model == null ? "" : model.trim();
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous) {
            this(target, accountIds, includeAnonymous, "");
        }
    }

    public record Activity(long sequence, Instant at, String kind, String title, String detail,
                           String status, Long durationMillis) {}

    public record Snapshot(Status status, String runId, String target, Instant startedAt, Instant endedAt,
                           long elapsedMillis, String message, String providerReadiness,
                           List<String> accountIds, boolean anonymous, long attempts, long responses,
                           long endpointDeclarations, long parameterDeclarations, long capabilityProbes,
                           List<ExplorerProvider.Unresolved> unresolved, List<Activity> activities, String model) {
        public Snapshot {
            accountIds = List.copyOf(accountIds == null ? List.of() : accountIds);
            unresolved = List.copyOf(unresolved == null ? List.of() : unresolved);
            activities = List.copyOf(activities == null ? List.of() : activities);
            model = model == null ? "" : model;
        }
        public Snapshot(Status status, String runId, String target, Instant startedAt, Instant endedAt,
                        long elapsedMillis, String message, String providerReadiness,
                        List<String> accountIds, boolean anonymous, long attempts, long responses,
                        long endpointDeclarations, long parameterDeclarations, long capabilityProbes,
                        List<ExplorerProvider.Unresolved> unresolved, List<Activity> activities) {
            this(status, runId, target, startedAt, endedAt, elapsedMillis, message, providerReadiness,
                    accountIds, anonymous, attempts, responses, endpointDeclarations, parameterDeclarations,
                    capabilityProbes, unresolved, activities, "");
        }
    }

    private static final int ACTIVITY_LIMIT = 300;
    private final ExplorerAccountVault vault;
    private final ExplorerTransport transport;
    private final ExplorerProvider provider;
    private final RunContextRegistry contexts;
    private final Predicate<String> exactScope;
    private final Supplier<Pipeline.Result> completionSnapshot;
    private final Consumer<List<RouteCandidate>> discoverySink;
    private final Consumer<String> logger;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-explorer-coordinator");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicLong activitySequence = new AtomicLong();
    private final Set<String> declaredEndpointKeys = new LinkedHashSet<>();
    private final Set<String> declaredParameterKeys = new LinkedHashSet<>();
    private volatile Snapshot snapshot = idle();
    private volatile ExplorerHttpGateway gateway;
    private volatile ExplorerProvider.Handle providerHandle;
    private volatile boolean closed;
    private LoginBrowser loginBrowser = new ChromiumLoginBrowser();
    /** Login windows stay open after [로그인 완료]: the Explorer drives the same window the operator logged in to. */
    private final Map<String, LoginBrowser.Session> loginWindows = new ConcurrentHashMap<>();
    private volatile Consumer<BrowserExchange> browserSink = exchange -> { };
    /** Distinct method+url the window produced this run, shown as the operator's endpoint counter. */
    private final Set<String> browserEndpoints = ConcurrentHashMap.newKeySet();
    private final AtomicInteger browserActions = new AtomicInteger();
    /** Snapshots cost no budget, but counting them is what separates "idle" from "looking around". */
    private final AtomicInteger browserSnapshots = new AtomicInteger();
    /** One page load fires dozens of requests, so this run-level ceiling is far above the gateway's 500. */
    private final AtomicInteger browserExchanges = new AtomicInteger();
    private volatile long browserDeadline;
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-explorer-browser-watchdog");
        thread.setDaemon(true);
        return thread;
    });
    private volatile java.util.concurrent.ScheduledFuture<?> browserWatch;

    public ExplorerCoordinator(ExplorerAccountVault vault, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<String> logger) {
        this(vault, transport, provider, contexts, exactScope, completionSnapshot, ignored -> {}, logger);
    }

    public ExplorerCoordinator(ExplorerAccountVault vault, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<List<RouteCandidate>> discoverySink,
                               Consumer<String> logger) {
        this.vault = vault;
        this.transport = transport;
        this.provider = provider;
        this.contexts = contexts;
        this.exactScope = exactScope;
        this.completionSnapshot = completionSnapshot;
        this.discoverySink = discoverySink == null ? ignored -> {} : discoverySink;
        this.logger = logger == null ? ignored -> {} : logger;
    }

    public synchronized Snapshot start(StartRequest request) {
        if (closed) throw new IllegalStateException("Explorer가 종료됐습니다.");
        if (active(snapshot.status())) throw new IllegalStateException("Explorer가 이미 실행 중입니다.");
        if (request == null || request.target() == null || request.target().isBlank()) {
            throw new IllegalArgumentException("Explorer 대상이 필요합니다.");
        }
        if (!exactScope.test(request.target())) throw new IllegalArgumentException("대상이 현재 exact scope 밖입니다.");
        if (!request.includeAnonymous() && request.accountIds().isEmpty()) {
            throw new IllegalArgumentException("비로그인 또는 하나 이상의 Explorer 계정을 선택하세요.");
        }
        request.accountIds().forEach(vault::view);
        String readiness = provider.readiness();
        if (!"READY".equals(readiness)) throw new IllegalStateException(readiness);
        if (contexts.current(Source.SCANNER) != null) throw new IllegalStateException("활성 ZAP 실행을 먼저 종료하세요.");
        if (!request.model().isBlank() && provider.models().models().stream()
                .noneMatch(option -> option.id().equals(request.model()))) {
            throw new IllegalArgumentException("선택한 Codex 모델은 현재 계정의 사용 가능 목록에 없습니다.");
        }
        String runId = "llm-explorer-" + System.currentTimeMillis() + "-"
                + UUID.randomUUID().toString().substring(0, 8);
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId));
        activitySequence.set(0);
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        browserActions.set(0);
        browserSnapshots.set(0);
        browserExchanges.set(0);
        browserEndpoints.clear();
        browserDeadline = 0;
        snapshot = new Snapshot(Status.AUTHENTICATING, runId, request.target(), Instant.now(), null,
                0, "Explorer 계정과 세션을 준비하는 중입니다.", readiness,
                request.accountIds(), request.includeAnonymous(), 0, 0, 0, 0, 0, List.of(), List.of(), request.model());
        addActivity("SYSTEM", "Explorer 준비", "exact scope와 Codex 로그인을 확인했습니다.", "RUNNING", null);
        worker.execute(() -> prepareAndStart(request, runId));
        return current();
    }

    public synchronized Snapshot current() {
        Snapshot value = snapshot;
        long elapsed = value.startedAt() == null ? 0 : Math.max(0,
                (value.endedAt() == null ? Instant.now() : value.endedAt()).toEpochMilli()
                        - value.startedAt().toEpochMilli());
        return new Snapshot(value.status(), value.runId(), value.target(), value.startedAt(), value.endedAt(),
                elapsed, value.message(), provider.readiness(), value.accountIds(), value.anonymous(),
                value.attempts(), value.responses(), value.endpointDeclarations(),
                value.parameterDeclarations(), value.capabilityProbes(), value.unresolved(), value.activities(), value.model());
    }

    public ExplorerProvider.ModelCatalog models() { return provider.models(); }

    public List<ExplorerAccountVault.View> accounts() { return vault.views(); }

    void loginBrowser(LoginBrowser browser) { this.loginBrowser = browser; }

    public void browserProxy(ExplorerBrowserProxy proxy) {
        if (!loginWindows.isEmpty()) throw new IllegalStateException("로그인 브라우저를 닫은 뒤 프록시를 변경하세요.");
        loginBrowser = new ChromiumLoginBrowser(proxy);
    }

    /** One request/response the driven window performed, handed to FlowScope to store as LLM Evidence. */
    public record BrowserExchange(String runId, String accountId, String method, String url,
                                  Map<String, String> requestHeaders, String requestBody,
                                  int status, Map<String, String> responseHeaders, String responseBody) {}

    /** FlowScope stores what the window does; without a sink the window is driven but nothing is recorded. */
    public void browserRecorder(Consumer<BrowserExchange> sink) {
        this.browserSink = sink == null ? exchange -> { } : sink;
    }

    /**
     * What the operator sees while the window is driven. {@code minutes} is a ceiling, not a duration: a run that
     * finishes exploring stops well before it, and closing the window stops it at once.
     */
    public record BrowserBudget(int actions, int maxActions, int snapshots, int endpoints,
                                long elapsedMillis, long minutes) {}

    public BrowserBudget browserBudget() {
        long started = browserDeadline == 0 ? 0 : browserDeadline - browserMinutes() * 60_000;
        long elapsed = started == 0 ? 0 : Math.max(0, System.currentTimeMillis() - started);
        return new BrowserBudget(browserActions.get(), maxBrowserActions(), browserSnapshots.get(),
                browserEndpoints.size(), elapsed, browserMinutes());
    }

    private static int maxBrowserActions() { return Integer.getInteger("flowscope.explorer.browserActions", 300); }

    private static long browserMinutes() { return Long.getLong("flowscope.explorer.browserMinutes", 15); }

    /** The endpoint counter is display state; past this many distinct URLs the number stops being informative. */
    private static final int MAX_BROWSER_ENDPOINTS = 2_000;

    private static int maxBrowserExchanges() {
        return Integer.getInteger("flowscope.explorer.browserExchanges", 3_000);
    }

    /** True when any selected account is explored through its own window. */
    public boolean browserDriven() {
        return snapshot.accountIds().stream().anyMatch(loginWindows::containsKey);
    }

    /**
     * Opens a login window for a registered account at an exact-scope URL. The operator logs in there and then calls
     * {@link #completeBrowserLogin}. Burp uses a dedicated LLM listener; CDP retains account/run attribution.
     */
    public ExplorerAccountVault.View openBrowserLogin(String accountId, String label, String role, String url)
            throws IOException {
        if (closed) throw new IllegalStateException("Explorer가 종료됐습니다.");
        URI target;
        try { target = URI.create(url == null ? "" : url.trim()); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("로그인 URL이 올바르지 않습니다."); }
        if (target.getHost() == null || !exactScope.test(target.toString())) {
            throw new IllegalArgumentException("로그인 URL이 현재 exact scope 밖입니다.");
        }
        vault.register(accountId, label, role);
        LoginBrowser.Session window = loginWindows.get(accountId);
        if (window == null || !window.alive()) {
            if (window != null) window.close();
            window = loginBrowser.open(target, exchange -> record(accountId, exchange));
            loginWindows.put(accountId, window);
        }
        // Nothing is recorded until the operator says the login is done, so the password never becomes Evidence.
        window.recording(false);
        vault.awaitBrowserLogin(accountId, target);
        return vault.view(accountId);
    }

    /** The operator says the login is done: adopt the window's cookies and auth headers for the login URL's origin. */
    public ExplorerAccountVault.View completeBrowserLogin(String accountId) throws IOException {
        LoginBrowser.Session window = loginWindows.get(accountId);
        if (window == null || !window.alive()) {
            closeLoginWindow(accountId);
            throw new IllegalStateException("로그인 브라우저가 열려 있지 않습니다. [브라우저 로그인]으로 다시 여세요.");
        }
        ExplorerAccountVault.View adopted = adoptWindowSession(accountId, window);
        window.recording(true);
        return adopted;
    }

    private void record(String accountId, LoginBrowser.Exchange exchange) {
        Snapshot current = snapshot;
        String runId = current.runId();
        // The window outlives the run and keeps its runId, so without the status check everything the operator
        // does in it afterwards would be filed as this run's LLM Evidence.
        if (!active(current.status()) || runId == null || runId.isBlank()) return;
        // Account browser traffic is collected only after explicit login completion, for this run's account.
        if (!current.accountIds().contains(accountId)
                || vault.view(accountId).status() != ExplorerAccountVault.AuthStatus.READY) return;
        // A public resource fetched in an account window is not an anonymous exploration run.
        if (exchange.requestHeaders().entrySet().stream().noneMatch(header ->
                (header.getKey().equalsIgnoreCase("Cookie") || header.getKey().equalsIgnoreCase("Authorization"))
                        && header.getValue() != null && !header.getValue().isBlank())) return;
        if (!exactScope.test(exchange.url())) return;
        if (browserExchanges.incrementAndGet() > maxBrowserExchanges()) return;
        browserSink.accept(new BrowserExchange(runId, accountId, exchange.method(), exchange.url(),
                exchange.requestHeaders(), exchange.requestBody(), exchange.status(),
                exchange.responseHeaders(), exchange.responseBody()));
        if (browserEndpoints.size() < MAX_BROWSER_ENDPOINTS) {
            browserEndpoints.add(exchange.method() + " " + exchange.url());
        }
    }

    /** What the Explorer may do to the window, with the run's scope and budget enforced here. */
    public LoginBrowser.Page browserAction(String accountId, String action, String url, String ref, String text)
            throws IOException {
        LoginBrowser.Session window = loginWindows.get(accountId);
        if (window == null) throw new IllegalArgumentException("이 계정은 브라우저 로그인으로 준비되지 않았습니다.");
        if (!window.alive()) throw new IllegalStateException("브라우저 창이 닫혀 탐색을 계속할 수 없습니다.");
        if (!active(snapshot.status())) throw new IllegalStateException("진행 중인 Explorer가 없습니다.");
        if (!"snapshot".equals(action)) {
            if (browserActions.incrementAndGet() > maxBrowserActions()) {
                throw new IllegalStateException("브라우저 행동 상한에 도달했습니다. 지금까지의 관측으로 마무리하세요.");
            }
            if (browserDeadline > 0 && System.currentTimeMillis() > browserDeadline) {
                throw new IllegalStateException("브라우저 탐색 시간 상한에 도달했습니다. 지금까지의 관측으로 마무리하세요.");
            }
        }
        long started = System.nanoTime();
        LoginBrowser.Page page = switch (action) {
            case "navigate" -> {
                if (!exactScope.test(url)) throw new IllegalArgumentException("이동할 URL이 exact scope 밖입니다.");
                yield window.navigate(url);
            }
            case "click" -> window.click(ref);
            case "type" -> window.type(ref, text);
            case "back" -> window.back();
            case "snapshot" -> window.snapshot();
            default -> throw new IllegalArgumentException("지원하지 않는 브라우저 동작입니다.");
        };
        // Every action is logged, snapshots included: a run that only looks around must not read as a run
        // that did nothing. The budget still ignores snapshots.
        if ("snapshot".equals(action)) browserSnapshots.incrementAndGet();
        addActivity("BROWSER", action, safe(page.url()), "COMPLETED",
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        return page;
    }

    private ExplorerAccountVault.View adoptWindowSession(String accountId, LoginBrowser.Session window)
            throws IOException {
        URI target = URI.create(vault.view(accountId).loginUrl());
        var cookies = window.cookies(target);
        Map<String, String> headers = window.authHeaders(target);
        if (cookies.isEmpty() && headers.isEmpty()) {
            throw new IllegalStateException("브라우저에 이 대상의 쿠키·인증 헤더가 없습니다. 로그인을 마쳤는지 확인하세요.");
        }
        return vault.adoptSession(accountId, target, cookies, headers);
    }

    public void removeAccount(String id) {
        closeLoginWindow(id);
        if (vault.contains(id)) vault.remove(id);
    }

    public void clearAccounts() {
        List.copyOf(loginWindows.keySet()).forEach(this::closeLoginWindow);
        vault.clear();
    }

    private void closeLoginWindow(String accountId) {
        LoginBrowser.Session window = loginWindows.remove(accountId);
        if (window != null) window.close();
        vault.browserClosed(accountId);
    }

    public synchronized Snapshot steer(String message) {
        if (snapshot.status() != Status.RUNNING || providerHandle == null) {
            throw new IllegalStateException("진행 중인 Explorer가 없습니다.");
        }
        providerHandle.steer(message);
        return current();
    }

    public synchronized Snapshot cancel() {
        if (!active(snapshot.status())) return current();
        if (providerHandle != null) providerHandle.cancel();
        stopBrowserWatch();
        stopBrowserRecording();
        contexts.abort(Source.LLM, snapshot.runId());
        closeGateway();
        snapshot = terminal(Status.CANCELLED, "사용자가 Explorer를 중단했습니다.", snapshot.unresolved());
        addActivity("SYSTEM", "Explorer 중단", "실행과 gateway를 종료했습니다.", "CANCELLED", null);
        return current();
    }

    public synchronized Snapshot clear() {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 상태를 지울 수 없습니다.");
        snapshot = idle();
        activitySequence.set(0);
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        return snapshot;
    }

    public synchronized Snapshot recheckProvider() {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 Codex 준비 상태를 다시 확인할 수 없습니다.");
        provider.invalidateReadiness();
        return current();
    }

    private void prepareAndStart(StartRequest request, String runId) {
        List<String> readyAccounts = new ArrayList<>();
        List<ExplorerProvider.Unresolved> limitations = new ArrayList<>();
        try {
            ExplorerHttpGateway created = new ExplorerHttpGateway(
                    vault, transport, exactScope, runId, this::gatewayEvent,
                    candidates -> acceptDiscoveries(runId, candidates));
            created.browserDriver(this::browserAction);
            synchronized (this) {
                if (!sameActiveRun(runId)) {
                    created.close();
                    return;
                }
                gateway = created;
            }
            for (String accountId : request.accountIds()) {
                if (!sameActiveRun(runId)) return;
                ExplorerAccountVault.View view = vault.view(accountId);
                LoginBrowser.Session window = loginWindows.get(accountId);
                if (view.status() == ExplorerAccountVault.AuthStatus.READY && window != null && window.alive()) {
                    // The window is still open: start from its latest session, which may have been refreshed.
                    try { view = adoptWindowSession(accountId, window); }
                    catch (IOException | IllegalStateException ignored) { /* keep the session adopted earlier */ }
                }
                if (view.status() != ExplorerAccountVault.AuthStatus.READY) {
                    vault.status(accountId, view.status(), "브라우저 로그인 후 [로그인 완료]가 필요합니다.");
                    view = vault.view(accountId);
                }
                if (view.status() == ExplorerAccountVault.AuthStatus.READY) {
                    readyAccounts.add(accountId);
                    addActivity("AUTH", "계정 로그인", view.label() + " READY", "COMPLETED", null);
                } else {
                    limitations.add(new ExplorerProvider.Unresolved("authentication", view.label(), view.message()));
                    addActivity("AUTH", "계정 로그인", view.label() + " · " + view.message(), "FAILED", null);
                }
            }
            if (readyAccounts.isEmpty() && !request.includeAnonymous()) {
                fail(runId, "선택한 계정 중 로그인 가능한 계정이 없습니다.", limitations);
                return;
            }
            List<String> browserHandles = readyAccounts.stream().filter(loginWindows::containsKey).toList();
            String prompt = prompt(request.target(), readyAccounts, request.includeAnonymous(), browserHandles);
            synchronized (this) {
                if (!sameActiveRun(runId)) return;
                if (!browserHandles.isEmpty()) {
                    browserDeadline = System.currentTimeMillis() + browserMinutes() * 60_000;
                    startBrowserWatch(runId);
                }
                snapshot = update(Status.RUNNING, "Codex Explorer가 독립적으로 대상 산출물과 API를 탐색 중입니다.",
                        limitations, null);
                providerHandle = provider.start(new ExplorerProvider.Request(runId, request.target(),
                        List.of(request.target()), readyAccounts, gateway.url(), gateway.discoveriesUrl(),
                        gateway.token(), prompt, request.model()),
                        providerListener(runId, limitations));
            }
        } catch (Exception error) {
            fail(runId, "Explorer 시작 실패: " + safe(error.getMessage()), limitations);
        }
    }

    /**
     * The operator's stop switch: closing the window ends the run. Polling beats a CDP disconnect callback here,
     * because a window killed from the Dock never sends one.
     */
    private void startBrowserWatch(String runId) {
        stopBrowserWatch();
        browserWatch = watchdog.scheduleWithFixedDelay(() -> {
            try {
                if (!sameActiveRun(runId)) { stopBrowserWatch(); return; }
                boolean closedWindow = snapshot.accountIds().stream()
                        .map(loginWindows::get).filter(java.util.Objects::nonNull)
                        .anyMatch(window -> !window.alive());
                if (!closedWindow) return;
                addActivity("SYSTEM", "브라우저 창 종료", "사용자가 창을 닫아 탐색과 수집을 끝냈습니다.", "CANCELLED", null);
                cancel();
            } catch (RuntimeException error) {
                logger.accept("FlowScope Explorer 브라우저 감시 실패: " + safe(error.getMessage()));
            }
        }, 2, 2, TimeUnit.SECONDS);
    }

    /** The run is over: the window stays open for the next run, but nothing it does now is this run's Evidence. */
    private void stopBrowserRecording() {
        loginWindows.values().forEach(window -> {
            try { window.recording(false); }
            catch (RuntimeException ignored) { /* a dead window records nothing anyway */ }
        });
    }

    private void stopBrowserWatch() {
        java.util.concurrent.ScheduledFuture<?> watch = browserWatch;
        browserWatch = null;
        if (watch != null) watch.cancel(false);
    }

    private ExplorerProvider.Listener providerListener(String runId,
                                                        List<ExplorerProvider.Unresolved> initialLimitations) {
        return new ExplorerProvider.Listener() {
            @Override public void activity(ExplorerProvider.Activity event) {
                if (sameActiveRun(runId)) addActivity(event.kind(), event.title(), event.detail(),
                        event.status(), event.durationMillis());
            }

            @Override public void completed(ExplorerProvider.Result result) {
                List<ExplorerProvider.Unresolved> limitations = new ArrayList<>(initialLimitations);
                limitations.addAll(result.unresolved());
                finish(runId, result.summary(), limitations);
            }

            @Override public void failed(String message) { fail(runId, message, initialLimitations); }
        };
    }

    private synchronized void finish(String runId, String message,
                                     List<ExplorerProvider.Unresolved> limitations) {
        if (!sameActiveRun(runId)) return;
        stopBrowserWatch();
        stopBrowserRecording();
        try {
            LaneCompletionPolicy.complete(contexts, Source.LLM, runId, completionSnapshot.get());
            closeGateway();
            Status status = limitations.isEmpty() ? Status.COMPLETED : Status.COMPLETED_WITH_LIMITATIONS;
            String summary = "Explorer 완료 · HTTP 시도 " + snapshot.attempts()
                    + "건 · 응답 기록 " + snapshot.responses()
                    + "건 · 선언 endpoint " + snapshot.endpointDeclarations()
                    + "건 · 선언 parameter " + snapshot.parameterDeclarations()
                    + "건 · OPTIONS probe " + snapshot.capabilityProbes() + "건";
            snapshot = terminal(status, summary, limitations);
            addActivity("SYSTEM", "Explorer 완료", status == Status.COMPLETED
                    ? "응답 기록과 종료 조건을 확인했습니다."
                    : "응답 기록을 남기고 미해결 항목도 함께 남겼습니다.", status.name(), null);
        } catch (Exception error) {
            contexts.abort(Source.LLM, runId);
            closeGateway();
            snapshot = terminal(Status.FAILED,
                    "Explorer 완료 gate 실패: " + safe(error.getMessage()), limitations);
            addActivity("ERROR", "완료 gate 실패", snapshot.message(), "FAILED", null);
        }
    }

    private synchronized void fail(String runId, String message,
                                   List<ExplorerProvider.Unresolved> limitations) {
        if (!sameActiveRun(runId)) return;
        stopBrowserWatch();
        stopBrowserRecording();
        contexts.abort(Source.LLM, runId);
        closeGateway();
        snapshot = terminal(Status.FAILED, safe(message), limitations);
        addActivity("ERROR", "Explorer 실패", snapshot.message(), "FAILED", null);
        logger.accept("FlowScope Explorer 실패: " + snapshot.message());
    }

    private synchronized void gatewayEvent(ExplorerHttpGateway.Event event) {
        if (!active(snapshot.status())) return;
        long attempts = snapshot.attempts() + 1;
        boolean evidenceStored = event.httpStatus() > 0
                && event.evidenceId() != null && !event.evidenceId().isBlank();
        long responses = snapshot.responses() + (evidenceStored ? 1 : 0);
        long probes = snapshot.capabilityProbes()
                + (evidenceStored && event.method().equals("OPTIONS") ? 1 : 0);
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), attempts, responses,
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), probes,
                snapshot.unresolved(), snapshot.activities(), snapshot.model());
        String account = event.accountId() == null || event.accountId().isBlank() ? "비로그인" : event.accountId();
        addActivity("HTTP", event.method() + " " + event.url(),
                account + (event.httpStatus() > 0 ? " · HTTP " + event.httpStatus() + " · " + event.evidenceId()
                        : " · " + event.message()), event.status(), event.durationMillis());
    }

    private synchronized void acceptDiscoveries(String runId, List<RouteCandidate> candidates) {
        if (!sameActiveRun(runId) || candidates == null || candidates.isEmpty()) return;
        discoverySink.accept(List.copyOf(candidates));
        long newEndpoints = 0;
        long newParameters = 0;
        for (RouteCandidate candidate : candidates) {
            String endpointKey = candidate.service() + "\0" + candidate.method() + "\0" + candidate.pathTemplate();
            if (declaredEndpointKeys.add(endpointKey)) newEndpoints++;
            for (RouteCandidate.DeclaredParameter parameter : candidate.declaredParameters()) {
                if (declaredParameterKeys.add(endpointKey + "\0" + parameter.location()
                        + "\0" + parameter.fieldPath())) newParameters++;
            }
        }
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations() + newEndpoints,
                snapshot.parameterDeclarations() + newParameters, snapshot.capabilityProbes(),
                snapshot.unresolved(), snapshot.activities(), snapshot.model());
        addActivity("DISCOVERY", "산출물 선언 저장",
                "endpoint " + newEndpoints + "건 · parameter " + newParameters
                        + "건을 현재 실행의 요청 기록에 연결했습니다.", "COMPLETED", null);
    }

    private synchronized void addActivity(String kind, String title, String detail,
                                          String status, Long durationMillis) {
        if (snapshot == null) return;
        List<Activity> next = new ArrayList<>(snapshot.activities());
        next.add(new Activity(activitySequence.incrementAndGet(), Instant.now(), kind,
                TextLimits.truncate(title == null ? "" : title, 2_048),
                safe(detail), status, durationMillis));
        if (next.size() > ACTIVITY_LIMIT) next = new ArrayList<>(next.subList(next.size() - ACTIVITY_LIMIT, next.size()));
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                snapshot.unresolved(), List.copyOf(next), snapshot.model());
    }

    private Snapshot update(Status status, String message, List<ExplorerProvider.Unresolved> unresolved,
                            Instant endedAt) {
        return new Snapshot(status, snapshot.runId(), snapshot.target(), snapshot.startedAt(), endedAt,
                snapshot.elapsedMillis(), message, snapshot.providerReadiness(), snapshot.accountIds(),
                snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                unresolved, snapshot.activities(), snapshot.model());
    }

    private Snapshot terminal(Status status, String message, List<ExplorerProvider.Unresolved> unresolved) {
        return update(status, message, List.copyOf(unresolved), Instant.now());
    }

    private boolean sameRun(String runId) { return runId != null && runId.equals(snapshot.runId()); }

    private boolean sameActiveRun(String runId) { return sameRun(runId) && active(snapshot.status()); }

    private static boolean active(Status status) {
        return status == Status.AUTHENTICATING || status == Status.RUNNING;
    }

    private void closeGateway() {
        ExplorerHttpGateway value = gateway;
        gateway = null;
        providerHandle = null;
        if (value != null) value.close();
    }

    private static Snapshot idle() {
        return new Snapshot(Status.IDLE, "", "", null, null, 0, "Explorer 실행 대기", "확인 전",
                List.of(), false, 0, 0, 0, 0, 0, List.of(), List.of());
    }

    private static String prompt(String target, List<String> accounts, boolean anonymous,
                                 List<String> browserHandles) throws IOException {
        String instructions;
        try (InputStream input = ExplorerCoordinator.class.getResourceAsStream("/explorer/explorer-system.md")) {
            if (input == null) throw new IOException("Explorer 지침 리소스가 없습니다.");
            instructions = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        String handles = accounts.isEmpty() ? "- 없음" : String.join("\n", accounts.stream().map(value -> "- " + value).toList());
        String windows = browserHandles.isEmpty() ? "- 없음"
                : String.join("\n", browserHandles.stream().map(value -> "- " + value).toList());
        return instructions + "\n\n# 실행 입력\n"
                + "대상 시작 URL: " + target + "\n"
                + "사용 가능한 인증 계정 handle:\n" + handles + "\n"
                + "비로그인 handle: " + (anonymous ? "빈 문자열로 사용 가능" : "사용 금지") + "\n"
                + "브라우저 창이 열려 있는 handle:\n" + windows + "\n"
                + "브라우저 행동 상한: " + maxBrowserActions() + "회 · 시간 상한: " + browserMinutes() + "분\n";
    }

    private static String safe(String value) {
        return TextLimits.truncate(value == null ? "" : value, 4_000);
    }

    @Override public synchronized void close() {
        closed = true;
        if (active(snapshot.status())) cancel();
        closeGateway();
        provider.close();
        List.copyOf(loginWindows.keySet()).forEach(this::closeLoginWindow);
        vault.close();
        stopBrowserWatch();
        stopBrowserRecording();
        watchdog.shutdownNow();
        worker.shutdownNow();
    }
}
