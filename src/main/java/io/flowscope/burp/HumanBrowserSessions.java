package io.flowscope.burp;

import io.flowscope.core.RunContextRegistry;
import io.flowscope.explorer.HumanChromiumBrowser;

import java.io.IOException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Owns each account's listener and browser together; source remains HUMAN for every account. */
final class HumanBrowserSessions implements AutoCloseable {
    @FunctionalInterface interface Launcher {
        HumanChromiumBrowser.Window open(URI target, int port) throws IOException;
    }
    private record Session(RunContextRegistry.Context context, int port, HumanChromiumBrowser.Window window, boolean stopping) {}
    private final HumanProxyListeners listeners;
    private final Launcher launcher;
    private final Map<String, Session> sessions = new LinkedHashMap<>();
    private final Map<String, Integer> accountPorts = new LinkedHashMap<>();

    HumanBrowserSessions(HumanProxyListeners listeners, Launcher launcher) {
        this.listeners = listeners;
        this.launcher = launcher;
    }

    synchronized void start(RunContextRegistry.Context context, URI target) throws IOException {
        String account = context.accountId() == null ? "" : context.accountId();
        int port = listeners.open(accountPorts.getOrDefault(account, -1));
        accountPorts.put(account, port);
        sessions.put(context.runId(), new Session(context, port, null, false));
        try {
            var window = launcher.open(target, port);
            sessions.put(context.runId(), new Session(context, port, window, false));
            if (!window.alive()) throw new IOException("수집 브라우저가 시작 전에 종료되었습니다.");
        } catch (IOException | RuntimeException failure) {
            try { stop(context.runId()); }
            catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }

    synchronized RunContextRegistry.Context context(int port) {
        return sessions.values().stream().filter(session -> session.port() == port && !session.stopping())
                .map(Session::context).findFirst().orElse(null);
    }
    boolean ownsPort(int port) { return listeners.owns(port); }
    synchronized boolean contains(String runId) { return sessions.containsKey(runId); }
    synchronized int port(String runId) {
        Session session = sessions.get(runId);
        return session == null ? -1 : session.port();
    }
    synchronized boolean alive(String runId) {
        Session session = sessions.get(runId);
        return session != null && !session.stopping() && session.window() != null && session.window().alive();
    }
    void stop(String runId) {
        Session session;
        Session stopping;
        synchronized (this) {
            session = sessions.get(runId);
            if (session == null) return;
            stopping = new Session(session.context(), session.port(), session.window(), true);
            sessions.put(runId, stopping);
        }
        RuntimeException failure = null;
        try { if (session.window() != null) session.window().close(); }
        catch (RuntimeException error) { failure = error; }
        try { listeners.remove(session.port()); }
        catch (IOException | RuntimeException error) {
            if (failure == null) failure = new IllegalStateException("수집 프록시 정리를 완료하지 못했습니다.", error);
            else failure.addSuppressed(error);
        }
        if (failure != null) throw failure;
        synchronized (this) { sessions.remove(runId, stopping); }
    }
    @Override public synchronized void close() {
        for (String runId : Set.copyOf(sessions.keySet())) {
            try { stop(runId); }
            catch (RuntimeException ignored) { /* Continue disposing every browser; retry listeners below. */ }
        }
        listeners.close();
        accountPorts.clear();
    }
}
