package io.flowscope.burp;

import io.flowscope.core.RunContextRegistry;
import io.flowscope.explorer.HumanChromiumBrowser;

import java.io.IOException;
import java.net.URI;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Owns each account's listener and browser together; source remains HUMAN for every account. */
final class HumanBrowserSessions implements AutoCloseable {
    @FunctionalInterface interface Launcher {
        HumanChromiumBrowser.Window open(URI target, int port) throws IOException;
    }
    private record Session(RunContextRegistry.Context context, int port, HumanChromiumBrowser.Window window) {}
    private final HumanProxyListeners listeners;
    private final Launcher launcher;
    private final Map<String, Session> sessions = new LinkedHashMap<>();
    private final Set<Integer> usedPorts = new HashSet<>();

    HumanBrowserSessions(HumanProxyListeners listeners, Launcher launcher) {
        this.listeners = listeners;
        this.launcher = launcher;
    }

    synchronized void start(RunContextRegistry.Context context, URI target) throws IOException {
        int port = listeners.open();
        usedPorts.add(port);
        sessions.put(context.runId(), new Session(context, port, null));
        try {
            var window = launcher.open(target, port);
            sessions.put(context.runId(), new Session(context, port, window));
        } catch (IOException | RuntimeException failure) {
            sessions.remove(context.runId());
            try { listeners.remove(port); }
            catch (IOException | RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }

    synchronized RunContextRegistry.Context context(int port) {
        return sessions.values().stream().filter(session -> session.port() == port)
                .map(Session::context).findFirst().orElse(null);
    }
    synchronized boolean ownsPort(int port) { return usedPorts.contains(port); }
    synchronized boolean contains(String runId) { return sessions.containsKey(runId); }
    synchronized int port(String runId) {
        Session session = sessions.get(runId);
        return session == null ? -1 : session.port();
    }
    synchronized boolean alive(String runId) {
        Session session = sessions.get(runId);
        return session != null && session.window() != null && session.window().alive();
    }
    synchronized void stop(String runId) {
        Session session = sessions.remove(runId);
        if (session == null) return;
        if (session.window() != null) session.window().close();
        try { listeners.remove(session.port()); }
        catch (IOException error) { throw new IllegalStateException("수집 프록시 정리를 완료하지 못했습니다.", error); }
    }
    @Override public synchronized void close() {
        for (String runId : Set.copyOf(sessions.keySet())) {
            try { stop(runId); }
            catch (RuntimeException ignored) { /* Continue disposing every browser; retry listeners below. */ }
        }
        listeners.close();
    }
}
