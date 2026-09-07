package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;
import io.flowscope.integration.LoopbackHttpServer;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.LinkedHashSet;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;

/** Codex dynamic tool을 exact-scope Burp 전송과 Evidence 저장으로 연결하는 loopback gateway. */
public final class ExplorerHttpGateway implements AutoCloseable {
    public record Event(Instant at, String status, String accountId, String method, String url,
                        int httpStatus, String evidenceId, long durationMillis, String message) {}

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> FORBIDDEN_HEADERS = Set.of(
            "authorization", "cookie", "proxy-authorization", "host", "content-length");
    private static final Set<String> METHODS = Set.of("GET", "HEAD", "OPTIONS", "POST");
    private static final int REQUEST_LIMIT = 1024 * 1024;
    private static final int INLINE_BODY_LIMIT = 512 * 1024;
    private static final int ARTIFACT_BODY_LIMIT = 4 * 1024 * 1024;
    private static final int MAX_REQUESTS = Integer.getInteger("flowscope.explorer.maxRequests", 500);
    private static final int MAX_ARTIFACTS = 24;

    private final ExplorerAccountVault vault;
    private final ExplorerTransport transport;
    private final Predicate<String> exactScope;
    private final String runId;
    private final String token = generateToken();
    private final Consumer<Event> events;
    private final LoopbackHttpServer server;
    private final Set<String> requestKeys = new LinkedHashSet<>();
    private final Map<String, byte[]> artifacts = new LinkedHashMap<>();

    public ExplorerHttpGateway(ExplorerAccountVault vault, ExplorerTransport transport,
                               Predicate<String> exactScope, String runId,
                               Consumer<Event> events) throws java.io.IOException {
        this.vault = vault;
        this.transport = transport;
        this.exactScope = exactScope;
        this.runId = runId;
        this.events = events == null ? ignored -> {} : events;
        this.server = new LoopbackHttpServer(0, REQUEST_LIMIT, this::handle);
        this.server.start();
    }

    public String url() { return "http://127.0.0.1:" + server.port() + "/request"; }
    public String token() { return token; }

    private LoopbackHttpServer.Response handle(LoopbackHttpServer.Request request) throws Exception {
        if (!request.remoteAddress().isLoopbackAddress()) return error(403, "loopback 요청만 허용됩니다.");
        URI requestUri = URI.create(request.path());
        if (request.method().equals("GET") && requestUri.getPath().startsWith("/artifact/")) {
            if (!authorized(request.header("Authorization"))) return error(403, "run capability가 올바르지 않습니다.");
            String id = requestUri.getPath().substring("/artifact/".length());
            byte[] value;
            synchronized (this) { value = artifacts.get(id); }
            if (value == null) return error(404, "artifact를 찾을 수 없습니다.");
            return new LoopbackHttpServer.Response(200,
                    Map.of("Content-Type", "text/plain; charset=utf-8", "Cache-Control", "no-store"), value);
        }
        if (!request.method().equals("POST") || !requestUri.getPath().equals("/request")) {
            return error(405, "POST /request만 허용됩니다.");
        }
        if (!authorized(request.header("Authorization"))) return error(403, "run capability가 올바르지 않습니다.");
        JsonNode body;
        try { body = JSON.readTree(request.body()); }
        catch (Exception error) { return error(400, "요청 JSON을 읽을 수 없습니다."); }
        String method = body.path("method").asText("GET").toUpperCase(Locale.ROOT);
        String target = body.path("url").asText("");
        String accountId = body.path("account").asText("").trim();
        if (!METHODS.contains(method)) return error(400, "지원하지 않는 HTTP method입니다.");
        URI uri;
        try { uri = URI.create(target); }
        catch (RuntimeException error) { return error(400, "대상 URL이 올바르지 않습니다."); }
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
            return error(400, "대상은 절대 HTTP(S) URL이어야 합니다.");
        }
        if (!exactScope.test(target)) {
            emit("SCOPE_BLOCKED", accountId, method, target, 0, "", 0, "exact scope 밖 요청 차단");
            return error(403, "현재 FlowScope exact scope 밖입니다.");
        }

        Map<String, String> headers = new LinkedHashMap<>();
        JsonNode supplied = body.path("headers");
        if (supplied.isObject()) supplied.fields().forEachRemaining(entry -> {
            String name = entry.getKey().trim();
            if (!name.isBlank() && !FORBIDDEN_HEADERS.contains(name.toLowerCase(Locale.ROOT))
                    && entry.getValue().isValueNode()) {
                headers.put(name, entry.getValue().asText());
            }
        });
        if (!accountId.isBlank()) {
            try { headers.putAll(vault.authenticationHeaders(accountId, uri)); }
            catch (IllegalArgumentException error) { return error(400, error.getMessage()); }
            catch (IllegalStateException error) { return error(409, error.getMessage()); }
        }
        String contentType = headers.entrySet().stream()
                .filter(value -> value.getKey().equalsIgnoreCase("Content-Type"))
                .map(Map.Entry::getValue).findFirst().orElse("");
        byte[] requestBody = body.path("body").asText("").getBytes(StandardCharsets.UTF_8);
        String requestKey = accountId + "\0" + method + "\0" + target + "\0" + sha256(requestBody);
        synchronized (this) {
            if (requestKeys.size() >= MAX_REQUESTS) return error(429, "Explorer run 요청 상한에 도달했습니다.");
            if (!requestKeys.add(requestKey)) return error(409, "같은 account·method·URL·body 요청은 이미 실행했습니다.");
        }
        long started = System.nanoTime();
        try {
            ExplorerTransport.Response response = transport.send(new ExplorerTransport.Request(
                    accountId, method, target, headers, requestBody, contentType, runId, false));
            if (!accountId.isBlank()) vault.acceptResponse(accountId, uri, response.headers());
            emit("HTTP_RESPONSE", accountId, method, target, response.status(), response.evidenceId(),
                    response.durationMillis(), "응답 Evidence 저장");
            ObjectNode result = JSON.createObjectNode();
            result.put("status", response.status());
            result.put("url", response.url());
            result.put("location", response.location() == null ? "" : response.location());
            result.put("content_type", response.contentType() == null ? "" : response.contentType());
            result.put("evidence_id", response.evidenceId());
            result.put("duration_ms", response.durationMillis());
            String safeBody = Masking.maskSecrets(response.body());
            if (safeBody.length() > INLINE_BODY_LIMIT) {
                byte[] encoded = safeBody.getBytes(StandardCharsets.UTF_8);
                byte[] retained = java.util.Arrays.copyOf(encoded, Math.min(encoded.length, ARTIFACT_BODY_LIMIT));
                String artifactId = UUID.randomUUID().toString();
                synchronized (this) {
                    if (artifacts.size() >= MAX_ARTIFACTS) artifacts.remove(artifacts.keySet().iterator().next());
                    artifacts.put(artifactId, retained);
                }
                result.put("body", safeBody.substring(0, Math.min(safeBody.length(), 64 * 1024)));
                result.put("body_truncated", response.bodyTruncated() || encoded.length > ARTIFACT_BODY_LIMIT);
                result.put("artifact_url", "http://127.0.0.1:" + server.port() + "/artifact/" + artifactId);
                result.put("artifact_bytes", retained.length);
            } else {
                result.put("body", safeBody);
                result.put("body_truncated", response.bodyTruncated());
                result.put("artifact_url", "");
                result.put("artifact_bytes", 0);
            }
            return json(200, result);
        } catch (Exception error) {
            synchronized (this) { requestKeys.remove(requestKey); }
            long duration = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
            String safe = Masking.truncate(Masking.maskSecrets(error.getMessage() == null
                    ? error.getClass().getSimpleName() : error.getMessage()), 500);
            emit("FAILED", accountId, method, target, 0, "", duration, safe);
            return error(502, safe);
        }
    }

    private void emit(String status, String accountId, String method, String url, int httpStatus,
                      String evidenceId, long duration, String message) {
        events.accept(new Event(Instant.now(), status, accountId, method,
                Masking.truncate(Masking.maskSecrets(url), 2_048), httpStatus,
                evidenceId == null ? "" : evidenceId, duration,
                Masking.truncate(Masking.maskSecrets(message), 500)));
    }

    private boolean authorized(String header) {
        String value = header == null ? "" : header;
        String supplied = value.regionMatches(true, 0, "Bearer ", 0, 7) ? value.substring(7) : "";
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8));
    }

    private static LoopbackHttpServer.Response error(int status, String message) {
        ObjectNode body = JSON.createObjectNode().put("success", false).put("error", message);
        return json(status, body);
    }

    private static LoopbackHttpServer.Response json(int status, JsonNode body) {
        return new LoopbackHttpServer.Response(status,
                Map.of("Content-Type", "application/json; charset=utf-8", "Cache-Control", "no-store"),
                body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String generateToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    @Override public synchronized void close() {
        artifacts.clear();
        requestKeys.clear();
        server.close();
    }
}
