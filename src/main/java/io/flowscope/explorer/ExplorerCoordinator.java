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

    public record StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model,
                               String effort, String userMessage, boolean rawCodex,
                               int rawProxyPort, String rawWorkspace) {
        public StartRequest {
            accountIds = List.copyOf(accountIds == null ? List.of() : accountIds);
            model = model == null ? "" : model.trim();
            effort = effort == null ? "" : effort.trim();
            userMessage = userMessage == null ? "" : userMessage.trim();
            rawWorkspace = rawWorkspace == null ? "" : rawWorkspace;
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model,
                            String effort, String userMessage) {
            this(target, accountIds, includeAnonymous, model, effort, userMessage, false, 0, "");
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model,
                            String effort, String userMessage, boolean rawCodex) {
            this(target, accountIds, includeAnonymous, model, effort, userMessage, rawCodex, 0, "");
        }
        public StartRequest withRawRuntime(int proxyPort, String workspace) {
            return new StartRequest(target, accountIds, includeAnonymous, model, effort, userMessage,
                    rawCodex, proxyPort, workspace);
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model,
                            String userMessage) {
            this(target, accountIds, includeAnonymous, model, "", userMessage);
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous, String model) {
            this(target, accountIds, includeAnonymous, model, "", "");
        }
        public StartRequest(String target, List<String> accountIds, boolean includeAnonymous) {
            this(target, accountIds, includeAnonymous, "", "", "");
        }
    }

    public record ChatMessage(String role, String text, String runId, Instant at) {}

    public record Activity(long sequence, Instant at, String kind, String title, String detail,
                           String status, Long durationMillis) {}

    public record Snapshot(Status status, String runId, String target, Instant startedAt, Instant endedAt,
                           long elapsedMillis, String message, String providerReadiness,
                           List<String> accountIds, boolean anonymous, long attempts, long responses,
                           long endpointDeclarations, long parameterDeclarations, long capabilityProbes,
                           List<ExplorerProvider.Unresolved> unresolved, List<Activity> activities,
                           String model, String effort) {
        public Snapshot {
            accountIds = List.copyOf(accountIds == null ? List.of() : accountIds);
            unresolved = List.copyOf(unresolved == null ? List.of() : unresolved);
            activities = List.copyOf(activities == null ? List.of() : activities);
            model = model == null ? "" : model;
            effort = effort == null ? "" : effort;
        }
        public Snapshot(Status status, String runId, String target, Instant startedAt, Instant endedAt,
                        long elapsedMillis, String message, String providerReadiness,
                        List<String> accountIds, boolean anonymous, long attempts, long responses,
                        long endpointDeclarations, long parameterDeclarations, long capabilityProbes,
                        List<ExplorerProvider.Unresolved> unresolved, List<Activity> activities, String model) {
            this(status, runId, target, startedAt, endedAt, elapsedMillis, message, providerReadiness,
                    accountIds, anonymous, attempts, responses, endpointDeclarations, parameterDeclarations,
                    capabilityProbes, unresolved, activities, model, "");
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
    private final Runnable chatChanged;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "flowscope-explorer-coordinator");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicLong activitySequence = new AtomicLong();
    private final Set<String> declaredEndpointKeys = new LinkedHashSet<>();
    private final Set<String> declaredParameterKeys = new LinkedHashSet<>();
    private final List<ChatMessage> chatMessages = new ArrayList<>();
    private String conversationThreadId = "";
    private String conversationTarget = "";
    private String conversationModel = "";
    private String conversationEffort = "";
    private boolean conversationRaw;
    private int conversationRawProtocolVersion;
    private volatile boolean chatModeActive;
    private volatile boolean rawModeActive;
    private volatile Consumer<String> rawRunEnded = ignored -> { };
    private volatile Consumer<String> rawRunStarted = ignored -> { };
    private volatile Snapshot snapshot = idle();
    private volatile ExplorerHttpGateway gateway;
    private ExplorerArtifactStore conversationArtifacts;
    private volatile ExplorerProvider.Handle providerHandle;
    private volatile boolean closed;
    private final ExplorerLoginSessions loginSessions;
    /** Login windows stay open after [로그인 완료]: the Explorer drives the same window the operator logged in to. */
    private final Map<String, LoginBrowser.Session> loginWindows;
    private final AutoCloseable loginAttachment;
    private volatile Consumer<BrowserExchange> browserSink = exchange -> { };
    /** Distinct method+url the window produced this run, shown as the operator's endpoint counter. */
    private final Set<String> browserEndpoints = ConcurrentHashMap.newKeySet();
    private final AtomicInteger browserActions = new AtomicInteger();
    /** Snapshots cost no budget, but counting them is what separates "idle" from "looking around". */
    private final AtomicInteger browserSnapshots = new AtomicInteger();
    private volatile long browserStartedAt;
    private volatile long browserEndedAt;
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
        this(vault, transport, provider, contexts, exactScope, completionSnapshot,
                discoverySink, logger, () -> {});
    }

    public ExplorerCoordinator(ExplorerAccountVault vault, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<List<RouteCandidate>> discoverySink,
                               Consumer<String> logger, Runnable chatChanged) {
        this(new ExplorerLoginSessions(vault), transport, provider, contexts, exactScope,
                completionSnapshot, discoverySink, logger, chatChanged);
    }

    public ExplorerCoordinator(ExplorerLoginSessions loginSessions, ExplorerTransport transport,
                               ExplorerProvider provider, RunContextRegistry contexts,
                               Predicate<String> exactScope,
                               Supplier<Pipeline.Result> completionSnapshot,
                               Consumer<List<RouteCandidate>> discoverySink,
                               Consumer<String> logger, Runnable chatChanged) {
        this.loginSessions = java.util.Objects.requireNonNull(loginSessions);
        this.vault = loginSessions.vault();
        this.loginWindows = loginSessions.windows();
        this.loginAttachment = loginSessions.attach(this::record);
        this.transport = transport;
        this.provider = provider;
        this.contexts = contexts;
        this.exactScope = exactScope;
        this.completionSnapshot = completionSnapshot;
        this.discoverySink = discoverySink == null ? ignored -> {} : discoverySink;
        this.logger = logger == null ? ignored -> {} : logger;
        this.chatChanged = chatChanged == null ? () -> {} : chatChanged;
    }

    public synchronized Snapshot start(StartRequest request) {
        if (closed) throw new IllegalStateException("Explorer가 종료됐습니다.");
        if (active(snapshot.status())) throw new IllegalStateException("Explorer가 이미 실행 중입니다.");
        if (request == null || request.target() == null || request.target().isBlank()) {
            throw new IllegalArgumentException("Explorer 대상이 필요합니다.");
        }
        if (!exactScope.test(request.target())) throw new IllegalArgumentException("대상이 현재 exact scope 밖입니다.");
        if (request.rawCodex() && request.userMessage().isBlank()) {
            throw new IllegalArgumentException("raw Codex 메시지가 필요합니다.");
        }
        if (!request.userMessage().isBlank() && !conversationThreadId.isBlank()
                && conversationRaw != request.rawCodex()) {
            throw new IllegalStateException("다른 대화 방식에서는 새 채팅을 시작하세요.");
        }
        if (request.rawCodex() && !conversationThreadId.isBlank() && conversationRawProtocolVersion < 1) {
            throw new IllegalStateException("이전 자유 대화에는 자동 Explorer 도구 문맥이 남아 있습니다. 현재 자유 대화로 시작하려면 새 채팅을 선택하세요.");
        }
        if (!request.userMessage().isBlank() && !conversationTarget.isBlank()
                && !conversationTarget.equals(request.target())) {
            throw new IllegalStateException("다른 대상에서는 새 LLM 대화를 시작하세요.");
        }
        if (request.rawCodex() && (request.includeAnonymous() == !request.accountIds().isEmpty()
                || request.accountIds().size() > 1)) {
            throw new IllegalStateException("Codex 자유 대화는 비로그인 또는 로그인 완료 계정 하나를 선택하세요.");
        }
        if (!request.rawCodex() && !request.includeAnonymous() && request.accountIds().isEmpty()) {
            throw new IllegalArgumentException("비로그인 또는 하나 이상의 Explorer 계정을 선택하세요.");
        }
        request.accountIds().forEach(vault::view);
        String readiness = provider.readiness();
        if (!"READY".equals(readiness)) throw new IllegalStateException(readiness);
        if (!request.rawCodex() && contexts.current(Source.SCANNER) != null) {
            throw new IllegalStateException("활성 ZAP 실행을 먼저 종료하세요.");
        }
        ExplorerProvider.ModelCatalog catalog = request.model().isBlank() && request.effort().isBlank()
                ? null : provider.models();
        if (!request.model().isBlank() && catalog.models().stream()
                .noneMatch(option -> option.id().equals(request.model()))) {
            throw new IllegalArgumentException("선택한 Codex 모델은 현재 계정의 사용 가능 목록에 없습니다.");
        }
        if (!request.effort().isBlank()) {
            String modelId = request.model().isBlank() ? catalog.configuredModel() : request.model();
            ExplorerProvider.ModelOption selected = catalog.models().stream()
                    .filter(option -> option.id().equals(modelId)).findFirst().orElseThrow(() ->
                            new IllegalArgumentException("추론 강도를 지정하려면 목록에 있는 모델을 선택하세요."));
            if (selected.efforts().stream().noneMatch(option -> option.effort().equals(request.effort()))) {
                throw new IllegalArgumentException("선택한 모델이 해당 추론 강도를 지원하지 않습니다.");
            }
        }
        String runId = (request.rawCodex() ? "llm-raw-" : "llm-explorer-") + System.currentTimeMillis() + "-"
                + UUID.randomUUID().toString().substring(0, 8);
        String runAccountId = request.rawCodex() && !request.includeAnonymous()
                ? request.accountIds().getFirst() : null;
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, runId, runAccountId));
        activitySequence.set(0);
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        browserActions.set(0);
        browserSnapshots.set(0);
        browserEndpoints.clear();
        chatModeActive = !request.userMessage().isBlank();
        rawModeActive = request.rawCodex();
        browserStartedAt = 0;
        browserEndedAt = 0;
        browserDeadline = 0;
        snapshot = new Snapshot(Status.AUTHENTICATING, runId, request.target(), Instant.now(), null,
                0, request.rawCodex() ? "Codex 대화를 준비하는 중입니다." : "Explorer 계정과 세션을 준비하는 중입니다.", readiness,
                request.accountIds(),
                request.includeAnonymous(), 0, 0, 0, 0, 0, List.of(), List.of(),
                request.model(), request.effort());
        if (!request.userMessage().isBlank()) {
            conversationTarget = request.target();
            conversationRaw = request.rawCodex();
            conversationRawProtocolVersion = request.rawCodex() ? 1 : 0;
            if (!request.model().isBlank()) conversationModel = request.model();
            if (!request.effort().isBlank()) conversationEffort = request.effort();
            chatMessages.add(new ChatMessage("user", request.userMessage(), runId, Instant.now()));
            chatChanged.run();
        }
        if (!request.rawCodex()) addActivity("SYSTEM", "Explorer 준비",
                "exact scope와 Codex 로그인을 확인했습니다.", "RUNNING", null);
        if (request.rawCodex()) rawRunStarted.accept(runId);
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
                value.parameterDeclarations(), value.capabilityProbes(), value.unresolved(), value.activities(),
                value.model(), value.effort());
    }

    public ExplorerProvider.ModelCatalog models() { return provider.models(); }

    public List<ExplorerAccountVault.View> accounts() { return vault.views(); }

    public boolean rawActiveRun(String runId) {
        Snapshot value = snapshot;
        return rawModeActive && runId != null && runId.equals(value.runId()) && active(value.status());
    }

    public boolean rawActive() { return rawModeActive && active(snapshot.status()); }

    public boolean rawRun() { return rawModeActive && snapshot.status() != Status.IDLE; }

    public Map<String, String> authenticationHeaders(String accountId, URI target) {
        return vault.authenticationHeaders(accountId, target);
    }

    public void rawRunEnded(Consumer<String> handler) {
        rawRunEnded = handler == null ? ignored -> { } : handler;
    }

    public void rawRunStarted(Consumer<String> handler) {
        rawRunStarted = handler == null ? ignored -> { } : handler;
    }

    public synchronized void rawResponse(String runId, String method, String url, int status) {
        if (!rawActiveRun(runId)) return;
        snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(), snapshot.startedAt(),
                snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(), snapshot.providerReadiness(),
                snapshot.accountIds(), snapshot.anonymous(), snapshot.attempts() + 1, snapshot.responses() + 1,
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                snapshot.unresolved(), snapshot.activities(), snapshot.model(), snapshot.effort());
        addActivity("HTTP", method + " " + url, "자유 대화 · HTTP " + status + " · 요청 기록 분석 중",
                "COMPLETED", null);
    }

    public synchronized List<ChatMessage> chatMessages() { return List.copyOf(chatMessages); }

    public synchronized ExplorerChatState chatState() {
        return new ExplorerChatState(conversationThreadId, conversationTarget,
                chatMessages.stream().map(item -> new ExplorerChatState.Message(
                        item.role(), item.text(), item.runId(), item.at().toString())).toList(),
                conversationModel, conversationEffort, conversationRaw, conversationRawProtocolVersion);
    }

    public synchronized void restoreChatState(ExplorerChatState restored) {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 LLM 대화를 복원할 수 없습니다.");
        ExplorerChatState state = restored == null ? ExplorerChatState.empty() : restored;
        List<ChatMessage> parsed = new ArrayList<>();
        for (ExplorerChatState.Message item : state.messages()) {
            if (!item.role().equals("user") && !item.role().equals("assistant")) {
                throw new IllegalArgumentException("저장된 LLM 대화의 역할이 올바르지 않습니다.");
            }
            parsed.add(new ChatMessage(item.role(), item.text(), item.runId(), Instant.parse(item.at())));
        }
        conversationThreadId = state.threadId();
        conversationTarget = state.target();
        conversationModel = state.model();
        conversationEffort = state.effort();
        conversationRaw = state.rawCodex();
        conversationRawProtocolVersion = state.rawProtocolVersion();
        chatMessages.clear();
        chatMessages.addAll(parsed);
    }

    void loginBrowser(LoginBrowser browser) { loginSessions.browser(browser); }

    public void browserProxy(ExplorerBrowserProxy proxy) {
        loginSessions.browserProxy(proxy);
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
        long end = browserEndedAt == 0 ? System.currentTimeMillis() : browserEndedAt;
        long elapsed = browserStartedAt == 0 ? 0 : Math.max(0, end - browserStartedAt);
        return new BrowserBudget(browserActions.get(), maxBrowserActions(), browserSnapshots.get(),
                browserEndpoints.size(), elapsed, browserMinutes());
    }

    private int maxBrowserActions() {
        return chatModeActive ? 0 : Math.max(0, Integer.getInteger("flowscope.explorer.browserActions", 300));
    }

    private long browserMinutes() {
        return chatModeActive ? 0 : Math.max(0, Long.getLong("flowscope.explorer.browserMinutes", 15));
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
        LoginBrowser.Session window = loginSessions.open(accountId, target);
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
        boolean authenticatedRequest = exchange.requestHeaders().entrySet().stream().anyMatch(header ->
                (header.getKey().equalsIgnoreCase("Cookie") || header.getKey().equalsIgnoreCase("Authorization"))
                        && header.getValue() != null && !header.getValue().isBlank());
        if (!authenticatedRequest && !rawModeActive) return;
        if (!exactScope.test(exchange.url())) return;
        browserSink.accept(new BrowserExchange(runId, authenticatedRequest ? accountId : null,
                exchange.method(), exchange.url(),
                exchange.requestHeaders(), exchange.requestBody(), exchange.status(),
                exchange.responseHeaders(), exchange.responseBody()));
        browserEndpoints.add(exchange.method() + " " + exchange.url());
    }

    /** What the Explorer may do to the window, with the run's scope and budget enforced here. */
    public LoginBrowser.Page browserAction(String accountId, String action, String url, String ref, String text)
            throws IOException {
        LoginBrowser.Session window = loginWindows.get(accountId);
        if (window == null) throw new IllegalArgumentException("이 계정은 브라우저 로그인으로 준비되지 않았습니다.");
        if (!window.alive()) throw new IllegalStateException("브라우저 창이 닫혀 탐색을 계속할 수 없습니다.");
        if (!active(snapshot.status())) throw new IllegalStateException("진행 중인 Explorer가 없습니다.");
        if (!"snapshot".equals(action)) {
            int count = browserActions.incrementAndGet();
            int limit = maxBrowserActions();
            if (limit > 0 && count > limit) {
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
        loginSessions.remove(id);
    }

    public void clearAccounts() {
        loginSessions.clear();
    }

    private void closeLoginWindow(String accountId) {
        loginSessions.closeWindow(accountId);
    }

    public synchronized Snapshot steer(String message) {
        if (snapshot.status() != Status.RUNNING || providerHandle == null) {
            throw new IllegalStateException("진행 중인 Explorer가 없습니다.");
        }
        String instruction = message == null ? "" : message.trim();
        if (instruction.isEmpty()) throw new IllegalArgumentException("메시지가 필요합니다.");
        providerHandle.steer(instruction);
        if (chatModeActive) {
            chatMessages.add(new ChatMessage("user", instruction, snapshot.runId(), Instant.now()));
            chatChanged.run();
        }
        return current();
    }

    public synchronized Snapshot cancel() {
        if (!active(snapshot.status())) return current();
        if (providerHandle != null) providerHandle.cancel();
        stopBrowserWatch();
        stopBrowserRecording();
        contexts.abort(Source.LLM, snapshot.runId());
        closeGateway();
        snapshot = terminal(Status.CANCELLED, rawModeActive
                ? "사용자가 Codex 대화를 중단했습니다." : "사용자가 Explorer를 중단했습니다.", snapshot.unresolved());
        if (rawModeActive) rawRunEnded.accept(snapshot.runId());
        if (!rawModeActive) addActivity("SYSTEM", "Explorer 중단",
                "실행과 gateway를 종료했습니다.", "CANCELLED", null);
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

    /** Project replacement, not the UI's clear-run-display action. */
    public synchronized void resetChatState() {
        if (active(snapshot.status())) throw new IllegalStateException("실행 중에는 대화를 지울 수 없습니다.");
        if (conversationArtifacts != null) conversationArtifacts.close();
        conversationArtifacts = null;
        chatMessages.clear();
        conversationThreadId = "";
        conversationTarget = "";
        conversationModel = "";
        conversationEffort = "";
        conversationRaw = false;
        conversationRawProtocolVersion = 0;
    }

    public synchronized Snapshot newChat() {
        clear();
        resetChatState();
        chatChanged.run();
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
            if (request.rawCodex()) {
                List<String> ready = new ArrayList<>();
                for (String accountId : request.accountIds()) {
                    ExplorerAccountVault.View view = vault.view(accountId);
                    LoginBrowser.Session window = loginWindows.get(accountId);
                    if (view.status() != ExplorerAccountVault.AuthStatus.READY || window == null || !window.alive()) {
                        throw new IllegalStateException("자유 대화 계정 " + view.label() + "의 브라우저 로그인을 완료해 주세요.");
                    }
                    try { adoptWindowSession(accountId, window); }
                    catch (IOException | IllegalStateException ignored) { /* keep the session adopted earlier */ }
                    ready.add(accountId);
                }
                synchronized (this) {
                    if (conversationArtifacts == null) conversationArtifacts = new ExplorerArtifactStore("llm-chat-" + runId);
                }
                ExplorerHttpGateway created = new ExplorerHttpGateway(vault, transport, exactScope, runId,
                        this::gatewayEvent, candidates -> acceptDiscoveries(runId, candidates), true,
                        conversationArtifacts, ready.isEmpty() ? "" : ready.getFirst());
                created.browserDriver(this::browserAction);
                synchronized (this) {
                    if (!sameActiveRun(runId)) { created.close(); return; }
                    gateway = created;
                    if (!ready.isEmpty()) {
                        browserStartedAt = System.currentTimeMillis();
                        ready.forEach(accountId -> loginWindows.get(accountId).recording(true));
                    }
                    snapshot = update(Status.RUNNING, "Codex 자유 대화가 진행 중입니다.", limitations, null);
                    providerHandle = provider.start(new ExplorerProvider.Request(runId, request.target(),
                            List.of(request.target()), ready, created.url(), created.discoveriesUrl(),
                            created.token(), "", request.model(),
                            request.effort(), conversationThreadId, request.userMessage(), true,
                            request.rawProxyPort(), request.rawWorkspace()), providerListener(runId, limitations, true));
                }
                return;
            }
            ExplorerArtifactStore sharedArtifacts = null;
            if (!request.userMessage().isBlank()) {
                synchronized (this) {
                    if (conversationArtifacts == null) {
                        conversationArtifacts = new ExplorerArtifactStore("llm-chat-" + runId);
                    }
                    sharedArtifacts = conversationArtifacts;
                }
            }
            ExplorerHttpGateway created = new ExplorerHttpGateway(
                    vault, transport, exactScope, runId, this::gatewayEvent,
                    candidates -> acceptDiscoveries(runId, candidates), !request.userMessage().isBlank(),
                    sharedArtifacts);
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
            String prompt = prompt(request.target(), readyAccounts, request.includeAnonymous(),
                    browserHandles, !request.userMessage().isBlank());
            synchronized (this) {
                if (!sameActiveRun(runId)) return;
                if (!browserHandles.isEmpty()) {
                    browserStartedAt = System.currentTimeMillis();
                    browserDeadline = browserMinutes() == 0 ? 0 : browserStartedAt + browserMinutes() * 60_000;
                    startBrowserWatch(runId);
                }
                snapshot = update(Status.RUNNING, "Codex Explorer가 독립적으로 대상 산출물과 API를 탐색 중입니다.",
                        limitations, null);
                providerHandle = provider.start(new ExplorerProvider.Request(runId, request.target(),
                        List.of(request.target()), readyAccounts, gateway.url(), gateway.discoveriesUrl(),
                        gateway.token(), prompt, request.model(), request.effort(),
                        request.userMessage().isBlank() ? "" : conversationThreadId, request.userMessage()),
                        providerListener(runId, limitations, !request.userMessage().isBlank()));
            }
        } catch (Exception error) {
            fail(runId, (request.rawCodex() ? "Codex 대화 시작 실패: " : "Explorer 시작 실패: ")
                    + safe(error.getMessage()), limitations);
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
        if (browserStartedAt > 0 && browserEndedAt == 0) browserEndedAt = System.currentTimeMillis();
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
                                                        List<ExplorerProvider.Unresolved> initialLimitations,
                                                        boolean chatTurn) {
        return new ExplorerProvider.Listener() {
            @Override public void threadReady(String threadId) {
                if (!chatTurn || threadId == null || threadId.isBlank()) return;
                synchronized (ExplorerCoordinator.this) {
                    if (!sameActiveRun(runId)) return;
                    conversationThreadId = threadId;
                    chatChanged.run();
                }
            }

            @Override public void activity(ExplorerProvider.Activity event) {
                if (rawModeActive && ("SYSTEM".equals(event.kind()) || "MODEL".equals(event.kind()))) return;
                if (sameActiveRun(runId)) addActivity(event.kind(), event.title(), event.detail(),
                        event.status(), event.durationMillis());
            }

            @Override public void assistantDelta(String delta) {
                if (chatTurn) appendAssistantDelta(runId, delta);
            }

            @Override public void completed(ExplorerProvider.Result result) {
                List<ExplorerProvider.Unresolved> limitations = new ArrayList<>(initialLimitations);
                limitations.addAll(result.unresolved());
                finish(runId, result.summary(), result.threadId(), limitations, chatTurn);
            }

            @Override public void failed(String message) { fail(runId, message, initialLimitations); }
        };
    }

    private synchronized void finish(String runId, String message, String threadId,
                                     List<ExplorerProvider.Unresolved> limitations, boolean chatTurn) {
        if (!sameActiveRun(runId)) return;
        stopBrowserWatch();
        stopBrowserRecording();
        if (chatTurn) {
            if (threadId != null && !threadId.isBlank()) conversationThreadId = threadId;
            int last = chatMessages.size() - 1;
            if (last >= 0 && chatMessages.get(last).role().equals("assistant")
                    && chatMessages.get(last).runId().equals(runId)) {
                chatMessages.set(last, new ChatMessage("assistant", message, runId, Instant.now()));
            } else {
                chatMessages.add(new ChatMessage("assistant", message, runId, Instant.now()));
            }
            chatChanged.run();
        }
        try {
            Pipeline.Result finalSnapshot = completionSnapshot.get();
            if (rawModeActive) {
                long storedResponses = finalSnapshot.records.stream()
                        .filter(record -> record.source == Source.LLM && runId.equals(record.runId)
                                && record.hasResponse).count();
                if (storedResponses > snapshot.responses()) {
                    snapshot = new Snapshot(snapshot.status(), snapshot.runId(), snapshot.target(),
                            snapshot.startedAt(), snapshot.endedAt(), snapshot.elapsedMillis(), snapshot.message(),
                            snapshot.providerReadiness(), snapshot.accountIds(), snapshot.anonymous(),
                            Math.max(snapshot.attempts(), storedResponses), storedResponses,
                            snapshot.endpointDeclarations(), snapshot.parameterDeclarations(),
                            snapshot.capabilityProbes(), snapshot.unresolved(), snapshot.activities(),
                            snapshot.model(), snapshot.effort());
                }
            }
            LaneCompletionPolicy.Decision gate = LaneCompletionPolicy.evaluate(Source.LLM, runId, finalSnapshot);
            if (gate.eligible()) {
                LaneCompletionPolicy.complete(contexts, Source.LLM, runId, finalSnapshot);
            } else if (chatTurn) {
                // A conversation can answer a question without sending a target request. This is not a
                // completed evidence lane, and it must not erase the user's chat or fabricate coverage.
                contexts.abort(Source.LLM, runId);
                if (finalSnapshot.records.stream().anyMatch(record -> record.source == Source.LLM
                        && runId.equals(record.runId) && record.hasResponse)) {
                    limitations.add(new ExplorerProvider.Unresolved("EVIDENCE_INCOMPLETE", snapshot.target(),
                            gate.reason()));
                }
            } else {
                throw new IllegalStateException(gate.reason());
            }
            closeGateway();
            Status status = limitations.isEmpty() ? Status.COMPLETED : Status.COMPLETED_WITH_LIMITATIONS;
            String summary = rawModeActive
                    ? snapshot.responses() == 0
                    ? "Codex 답변 완료 · 이번 대화 신규 HTTP 응답 0건 (기존 기록 조회 가능)"
                    : "Codex 답변 완료 · 이번 대화 신규 HTTP 응답 " + snapshot.responses() + "건"
                    : "Explorer 완료 · HTTP 시도 " + snapshot.attempts()
                    + "건 · 응답 기록 " + snapshot.responses()
                    + "건 · 선언 endpoint " + snapshot.endpointDeclarations()
                    + "건 · 선언 parameter " + snapshot.parameterDeclarations()
                    + "건 · OPTIONS probe " + snapshot.capabilityProbes() + "건";
            snapshot = terminal(status, summary, limitations);
            if (!rawModeActive) addActivity("SYSTEM", "Explorer 완료",
                    status == Status.COMPLETED ? "응답 기록과 종료 조건을 확인했습니다."
                            : "응답 기록을 남기고 미해결 항목도 함께 남겼습니다.", status.name(), null);
        } catch (Exception error) {
            contexts.abort(Source.LLM, runId);
            closeGateway();
            snapshot = terminal(Status.FAILED, (rawModeActive
                    ? "Codex 대화 종료 확인 실패: " : "Explorer 완료 gate 실패: ") + safe(error.getMessage()), limitations);
            addActivity("ERROR", rawModeActive ? "대화 종료 확인 실패" : "완료 gate 실패",
                    snapshot.message(), "FAILED", null);
        }
        if (rawModeActive) rawRunEnded.accept(runId);
    }

    private synchronized void fail(String runId, String message,
                                   List<ExplorerProvider.Unresolved> limitations) {
        if (!sameActiveRun(runId)) return;
        stopBrowserWatch();
        stopBrowserRecording();
        contexts.abort(Source.LLM, runId);
        closeGateway();
        snapshot = terminal(Status.FAILED, safe(message), limitations);
        if (rawModeActive) rawRunEnded.accept(runId);
        addActivity("ERROR", rawModeActive ? "Codex 대화 실패" : "Explorer 실패",
                snapshot.message(), "FAILED", null);
        logger.accept((rawModeActive ? "FlowScope Codex 대화 실패: " : "FlowScope Explorer 실패: ")
                + snapshot.message());
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
                snapshot.unresolved(), snapshot.activities(), snapshot.model(), snapshot.effort());
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
                snapshot.unresolved(), snapshot.activities(), snapshot.model(), snapshot.effort());
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
                snapshot.unresolved(), List.copyOf(next), snapshot.model(), snapshot.effort());
    }

    private synchronized void appendAssistantDelta(String runId, String delta) {
        if (!sameActiveRun(runId) || delta == null || delta.isEmpty()) return;
        int last = chatMessages.size() - 1;
        if (last >= 0 && chatMessages.get(last).role().equals("assistant")
                && chatMessages.get(last).runId().equals(runId)) {
            ChatMessage previous = chatMessages.get(last);
            chatMessages.set(last, new ChatMessage("assistant", previous.text() + delta, runId, previous.at()));
        } else {
            chatMessages.add(new ChatMessage("assistant", delta, runId, Instant.now()));
        }
    }

    private Snapshot update(Status status, String message, List<ExplorerProvider.Unresolved> unresolved,
                            Instant endedAt) {
        return new Snapshot(status, snapshot.runId(), snapshot.target(), snapshot.startedAt(), endedAt,
                snapshot.elapsedMillis(), message, snapshot.providerReadiness(), snapshot.accountIds(),
                snapshot.anonymous(), snapshot.attempts(), snapshot.responses(),
                snapshot.endpointDeclarations(), snapshot.parameterDeclarations(), snapshot.capabilityProbes(),
                unresolved, snapshot.activities(), snapshot.model(), snapshot.effort());
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

    private String prompt(String target, List<String> accounts, boolean anonymous,
                          List<String> browserHandles, boolean chatTurn) throws IOException {
        String instructions;
        String resource = chatTurn ? "/explorer/llm-chat-system.md" : "/explorer/explorer-system.md";
        try (InputStream input = ExplorerCoordinator.class.getResourceAsStream(resource)) {
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
                + "브라우저 행동 상한: " + (maxBrowserActions() == 0 ? "없음" : maxBrowserActions() + "회")
                + " · 시간 상한: " + (browserMinutes() == 0 ? "없음" : browserMinutes() + "분") + "\n";
    }

    private static String safe(String value) {
        return TextLimits.truncate(value == null ? "" : value, 4_000);
    }

    @Override public synchronized void close() {
        closed = true;
        if (active(snapshot.status())) cancel();
        closeGateway();
        if (conversationArtifacts != null) conversationArtifacts.close();
        conversationArtifacts = null;
        provider.close();
        stopBrowserWatch();
        stopBrowserRecording();
        try { loginAttachment.close(); } catch (Exception ignored) { }
        watchdog.shutdownNow();
        worker.shutdownNow();
    }
}
