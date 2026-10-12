package io.flowscope.explorer;

import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;

/** Account login windows and in-memory credentials shared by automatic Explorer and free chat. */
public final class ExplorerLoginSessions {
    private final ExplorerAccountVault vault;
    private final Map<String, LoginBrowser.Session> windows = new ConcurrentHashMap<>();
    private final List<BiConsumer<String, LoginBrowser.Exchange>> recorders = new CopyOnWriteArrayList<>();
    private LoginBrowser browser = new ChromiumLoginBrowser();
    private int clients;
    private boolean closed;

    public ExplorerLoginSessions(ExplorerAccountVault vault) {
        this.vault = java.util.Objects.requireNonNull(vault);
    }

    ExplorerAccountVault vault() { return vault; }

    Map<String, LoginBrowser.Session> windows() { return windows; }

    synchronized AutoCloseable attach(BiConsumer<String, LoginBrowser.Exchange> recorder) {
        if (closed) throw new IllegalStateException("LLM 로그인 세션이 종료됐습니다.");
        recorders.add(recorder);
        clients++;
        AtomicBoolean attached = new AtomicBoolean(true);
        return () -> {
            if (!attached.compareAndSet(true, false)) return;
            release(recorder);
        };
    }

    private synchronized void release(BiConsumer<String, LoginBrowser.Exchange> recorder) {
        recorders.remove(recorder);
        clients--;
        if (clients == 0) closeAll();
    }

    synchronized void browser(LoginBrowser value) {
        if (!windows.isEmpty()) throw new IllegalStateException("로그인 브라우저를 닫은 뒤 구현을 변경하세요.");
        browser = java.util.Objects.requireNonNull(value);
    }

    synchronized void browserProxy(ExplorerBrowserProxy proxy) {
        if (!windows.isEmpty()) throw new IllegalStateException("로그인 브라우저를 닫은 뒤 프록시를 변경하세요.");
        browser = new ChromiumLoginBrowser(proxy);
    }

    synchronized LoginBrowser.Session open(String accountId, URI target) throws IOException {
        if (closed) throw new IllegalStateException("LLM 로그인 세션이 종료됐습니다.");
        LoginBrowser.Session window = windows.get(accountId);
        if (window == null || !window.alive()) {
            if (window != null) window.close();
            window = browser.open(target, exchange -> recorders.forEach(recorder -> recorder.accept(accountId, exchange)));
            windows.put(accountId, window);
        }
        return window;
    }

    synchronized void closeWindow(String accountId) {
        LoginBrowser.Session window = windows.remove(accountId);
        if (window != null) window.close();
        vault.browserClosed(accountId);
    }

    synchronized void remove(String accountId) {
        closeWindow(accountId);
        if (vault.contains(accountId)) vault.remove(accountId);
    }

    synchronized void clear() {
        List.copyOf(windows.keySet()).forEach(this::closeWindow);
        vault.clear();
    }

    private void closeAll() {
        if (closed) return;
        closed = true;
        List.copyOf(windows.keySet()).forEach(this::closeWindow);
        vault.close();
        recorders.clear();
    }
}
