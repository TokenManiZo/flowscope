package io.flowscope.burp;

import burp.api.montoya.burpsuite.BurpSuite;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Set;

/** Edits only the listener list, preserving existing entries and removing only unmodified owned entries. */
final class HumanProxyListeners implements AutoCloseable {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PATH = "proxy.request_listeners";
    private boolean wrappedProjectOptions;
    private int nextPort = 18080;
    private final BurpSuite burp;
    private final Set<Integer> reserved;
    private final Map<Integer, JsonNode> owned = new ConcurrentHashMap<>();

    HumanProxyListeners(BurpSuite burp, Set<Integer> reserved) {
        this.burp = burp;
        this.reserved = Set.copyOf(reserved);
    }

    synchronized int open() throws IOException { return open(-1); }

    synchronized int open(int preferredPort) throws IOException {
        for (int attempt = 0; attempt < 8; attempt++) {
            ArrayNode listeners = listeners();
            int port = attempt == 0 && preferredPort >= 18080 && portAvailable(preferredPort, listeners)
                    ? preferredPort : availablePort(listeners);
            ObjectNode entry = JSON.createObjectNode().put("listen_mode", "loopback_only")
                    .put("listener_port", port).put("running", true).put("certificate_mode", "per_host")
                    .put("enable_http2", true);
            listeners.add(entry);
            owned.put(port, entry);
            try {
                apply(listeners);
                JsonNode actual = find(listeners(), port);
                if (actual != null) owned.put(port, actual.deepCopy());
                if (actual != null && actual.path("running").asBoolean() && reachable(port)) return port;
            } catch (IOException | RuntimeException failure) {
                try { remove(port); }
                catch (IOException | RuntimeException cleanup) { failure.addSuppressed(cleanup); }
                throw new IOException("Burp 수집용 프록시 설정을 적용하지 못했습니다.", failure);
            }
            remove(port);
        }
        throw new IOException("수집용 프록시 포트를 열지 못했습니다. Burp 리스너 상태를 확인하세요.");
    }

    enum Ensured { ALREADY_RUNNING, STARTED_EXISTING, CREATED }

    /**
     * 고정 포트 리스너(ZAP용 스캐너 8081 등)를 켜 둔다. 사용자가 만든 리스너가 있으면 켜기만 하고 소유하지 않으며,
     * 없을 때만 Loopback only로 만들어 소유한다(close에서 이것만 지운다). 다른 프로그램이 포트를 쓰면 IOException.
     */
    synchronized Ensured ensure(int port) throws IOException {
        ArrayNode listeners = listeners();
        JsonNode existing = find(listeners, port);
        if (existing != null) {
            if (existing.path("running").asBoolean()) return Ensured.ALREADY_RUNNING;
            ((ObjectNode) existing).put("running", true);
            apply(listeners);
            JsonNode actual = find(listeners(), port);
            if (actual == null || !actual.path("running").asBoolean() || !reachable(port)) {
                throw new IOException("Burp 프록시 리스너 " + port + "을(를) 켜지 못했습니다. 다른 프로그램이 이 포트를 쓰는지 확인하세요.");
            }
            return Ensured.STARTED_EXISTING;
        }
        try (var candidate = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"))) {
            // 비어 있는 포트다. 바로 닫고 Burp가 쓰게 한다.
        } catch (BindException occupied) {
            throw new IOException("포트 " + port + "을(를) 다른 프로그램이 쓰고 있어 Burp 프록시 리스너를 만들지 못했습니다.", occupied);
        }
        ObjectNode entry = JSON.createObjectNode().put("listen_mode", "loopback_only")
                .put("listener_port", port).put("running", true).put("certificate_mode", "per_host")
                .put("enable_http2", true);
        listeners.add(entry);
        owned.put(port, entry);
        try {
            apply(listeners);
            JsonNode actual = find(listeners(), port);
            if (actual != null) owned.put(port, actual.deepCopy());
            if (actual != null && actual.path("running").asBoolean() && reachable(port)) return Ensured.CREATED;
        } catch (IOException | RuntimeException failure) {
            try { remove(port); }
            catch (IOException | RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw new IOException("Burp 프록시 리스너 " + port + " 설정을 적용하지 못했습니다.", failure);
        }
        remove(port);
        throw new IOException("Burp 프록시 리스너 " + port + "을(를) 열지 못했습니다. Burp 리스너 상태를 확인하세요.");
    }

    private boolean portAvailable(int port, ArrayNode listeners) throws IOException {
        if (reserved.contains(port) || contains(listeners, port)) return false;
        try (var candidate = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"))) {
            return true;
        } catch (BindException occupied) { return false; }
    }

    private int availablePort(ArrayNode listeners) throws IOException {
        while (nextPort <= 65535) {
            int port = nextPort++;
            if (reserved.contains(port) || contains(listeners, port)) continue;
            try (var candidate = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"))) {
                return candidate.getLocalPort();
            } catch (BindException occupied) {
                // Another process owns this port; continue through the sequence.
            }
        }
        throw new IOException("18080 이상에서 사용할 수 있는 수집 프록시 포트가 없습니다.");
    }

    boolean owns(int port) { return owned.containsKey(port); }

    synchronized void remove(int port) throws IOException {
        JsonNode entry = owned.get(port);
        if (entry == null) return;
        ArrayNode listeners = listeners();
        ArrayNode remaining = JSON.createArrayNode();
        for (JsonNode current : listeners) {
            if (!entry.equals(current)) remaining.add(current);
        }
        apply(remaining);
        owned.remove(port);
    }

    private ArrayNode listeners() throws IOException {
        JsonNode config = JSON.readTree(burp.exportProjectOptionsAsJson(PATH));
        JsonNode value = config.path("proxy").path("request_listeners");
        wrappedProjectOptions = false;
        if (!value.isArray()) {
            config = JSON.readTree(burp.exportProjectOptionsAsJson("project_options." + PATH));
            value = config.path("project_options").path("proxy").path("request_listeners");
            wrappedProjectOptions = true;
        }
        if (!value.isArray()) throw new IOException("Burp 프록시 리스너 설정 형식을 읽지 못했습니다.");
        return ((ArrayNode) value).deepCopy();
    }

    private void apply(ArrayNode listeners) {
        ObjectNode config = JSON.createObjectNode();
        (wrappedProjectOptions ? config.putObject("project_options") : config)
                .putObject("proxy").set("request_listeners", listeners);
        burp.importProjectOptionsFromJson(config.toString());
    }

    private static boolean contains(ArrayNode listeners, int port) { return find(listeners, port) != null; }
    private static JsonNode find(ArrayNode listeners, int port) {
        for (JsonNode value : listeners) if (value.path("listener_port").asInt() == port) return value;
        return null;
    }

    private static boolean reachable(int port) {
        for (int attempt = 0; attempt < 10; attempt++) {
            try (var socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", port), 100);
                return true;
            } catch (IOException ignored) {
                try { Thread.sleep(100); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); return false; }
            }
        }
        return false;
    }

    @Override public synchronized void close() {
        for (int port : Set.copyOf(owned.keySet())) {
            try { remove(port); }
            catch (IOException | RuntimeException ignored) { /* Keep ownership so a later cleanup can retry. */ }
        }
        if (owned.isEmpty()) nextPort = 18080;
    }
}
