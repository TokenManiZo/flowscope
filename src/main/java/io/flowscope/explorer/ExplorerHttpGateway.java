package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;
import io.flowscope.core.Normalizer;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.integration.LoopbackHttpServer;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
    private static final Set<String> DECLARATION_METHODS = Set.of(
            "GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE");
    private static final Set<String> DISCOVERY_FIELDS = Set.of(
            "method", "url", "evidence_ids", "artifact_kind", "locator", "reason", "parameters");
    private static final Set<String> PARAMETER_FIELDS = Set.of(
            "location", "field_path", "display_name", "requirement");
    private static final int REQUEST_LIMIT = 1024 * 1024;
    private static final int INLINE_BODY_LIMIT = 64 * 1024;
    private static final int ARTIFACT_BODY_LIMIT = 4 * 1024 * 1024;
    private static final int MAX_REQUESTS = Integer.getInteger("flowscope.explorer.maxRequests", 500);
    private static final int MAX_ARTIFACTS = 24;
    private static final int MAX_DISCOVERIES_PER_CALL = 200;
    private static final int MAX_DISCOVERIES = 5_000;
    private static final int MAX_PARAMETERS_PER_DISCOVERY = 256;
    private static final int MAX_DECLARED_PARAMETERS = 50_000;

    private final ExplorerAccountVault vault;
    private final ExplorerTransport transport;
    private final Predicate<String> exactScope;
    private final String runId;
    private final String token = generateToken();
    private final Consumer<Event> events;
    private final Consumer<List<RouteCandidate>> discoveries;
    private final LoopbackHttpServer server;
    private final Set<String> requestKeys = new LinkedHashSet<>();
    private final Set<String> responseEvidenceIds = new LinkedHashSet<>();
    private final Set<String> discoveryProvenanceKeys = new LinkedHashSet<>();
    private final Set<String> declaredEndpointKeys = new LinkedHashSet<>();
    private final Set<String> declaredParameterKeys = new LinkedHashSet<>();
    private final Set<String> declaredParameterProvenanceKeys = new LinkedHashSet<>();
    private final Map<String, byte[]> artifacts = new LinkedHashMap<>();

    public ExplorerHttpGateway(ExplorerAccountVault vault, ExplorerTransport transport,
                               Predicate<String> exactScope, String runId,
                               Consumer<Event> events) throws java.io.IOException {
        this(vault, transport, exactScope, runId, events, ignored -> {});
    }

    public ExplorerHttpGateway(ExplorerAccountVault vault, ExplorerTransport transport,
                               Predicate<String> exactScope, String runId,
                               Consumer<Event> events,
                               Consumer<List<RouteCandidate>> discoveries) throws java.io.IOException {
        this.vault = vault;
        this.transport = transport;
        this.exactScope = exactScope;
        this.runId = runId;
        this.events = events == null ? ignored -> {} : events;
        this.discoveries = discoveries == null ? ignored -> {} : discoveries;
        this.server = new LoopbackHttpServer(0, REQUEST_LIMIT, this::handle);
        this.server.start();
    }

    public String url() { return "http://127.0.0.1:" + server.port() + "/request"; }
    public String discoveriesUrl() { return "http://127.0.0.1:" + server.port() + "/discoveries"; }
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
        if (!request.method().equals("POST")
                || !(requestUri.getPath().equals("/request") || requestUri.getPath().equals("/discoveries"))) {
            return error(405, "POST /request 또는 POST /discoveries만 허용됩니다.");
        }
        if (!authorized(request.header("Authorization"))) return error(403, "run capability가 올바르지 않습니다.");
        JsonNode body;
        try { body = JSON.readTree(request.body()); }
        catch (Exception error) { return error(400, "요청 JSON을 읽을 수 없습니다."); }
        if (requestUri.getPath().equals("/discoveries")) return handleDiscoveries(body);
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
            if (response.evidenceId() != null && !response.evidenceId().isBlank()) {
                synchronized (this) { responseEvidenceIds.add(response.evidenceId()); }
            }
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
            byte[] encoded = safeBody.getBytes(StandardCharsets.UTF_8);
            if (encoded.length > INLINE_BODY_LIMIT) {
                String retainedText = utf8Prefix(safeBody, ARTIFACT_BODY_LIMIT);
                byte[] retained = retainedText.getBytes(StandardCharsets.UTF_8);
                String artifactId = UUID.randomUUID().toString();
                synchronized (this) {
                    if (artifacts.size() >= MAX_ARTIFACTS) artifacts.remove(artifacts.keySet().iterator().next());
                    artifacts.put(artifactId, retained);
                }
                result.put("body", utf8Prefix(safeBody, INLINE_BODY_LIMIT));
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

    private synchronized LoopbackHttpServer.Response handleDiscoveries(JsonNode root) {
        JsonNode values = root.path("discoveries");
        if (!root.isObject() || !values.isArray() || values.isEmpty()
                || values.size() > MAX_DISCOVERIES_PER_CALL) {
            return error(400, "discoveries는 1~" + MAX_DISCOVERIES_PER_CALL + "개 배열이어야 합니다.");
        }
        List<RouteCandidate> accepted = new ArrayList<>();
        Set<String> newProvenanceKeys = new LinkedHashSet<>();
        Set<String> newEndpointKeys = new LinkedHashSet<>();
        Set<String> newParameterKeys = new LinkedHashSet<>();
        Set<String> newParameterProvenanceKeys = new LinkedHashSet<>();
        int duplicateEndpoints = 0;
        int duplicateParameters = 0;
        try {
            requireOnlyFields(root, Set.of("discoveries"), "요청 본문");
            for (JsonNode value : values) {
                requireOnlyFields(value, DISCOVERY_FIELDS, "discovery");
                String method = requiredToken(value, "method", 16).toUpperCase(Locale.ROOT);
                if (!DECLARATION_METHODS.contains(method)) {
                    throw new IllegalArgumentException("지원하지 않는 선언 HTTP method입니다: " + method);
                }
                String target = requiredText(value, "url", 4_096);
                String scopeTarget = target.replaceAll("\\{[^/{}]+}", "1");
                URI uri = absoluteHttpUri(scopeTarget);
                if (!exactScope.test(scopeTarget)) {
                    throw new IllegalArgumentException("선언 URL이 현재 FlowScope exact scope 밖입니다.");
                }
                URI templateUri = absoluteHttpUri(target.replace("{", "%7B").replace("}", "%7D"));
                String path = templateUri.getRawPath() == null || templateUri.getRawPath().isBlank()
                        ? "/" : templateUri.getRawPath().replace("%7B", "{").replace("%7D", "}")
                        .replace("%7b", "{").replace("%7d", "}");
                String pathTemplate = path.matches(".*\\{[^/{}]+}.*")
                        ? path.replaceAll("\\{[^/{}]+}", "{id}")
                        : operationPath(method, path);
                String service = service(uri);
                String endpointKey = service + "\0" + method + "\0" + pathTemplate;
                String artifactKind = requiredToken(value, "artifact_kind", 32).toUpperCase(Locale.ROOT);
                if (!Set.of("JAVASCRIPT", "HTML", "OPENAPI", "GRAPHQL", "SOURCE_MAP", "MANIFEST", "OTHER")
                        .contains(artifactKind)) {
                    throw new IllegalArgumentException("artifact_kind가 지원 목록에 없습니다.");
                }
                String locator = optionalText(value, "locator", 1_000);
                String suppliedReason = optionalText(value, "reason", 1_000);
                String reason = Masking.truncate(Masking.maskSecrets((locator.isBlank() ? "" : locator + " · ")
                        + (suppliedReason.isBlank() ? "Explorer 산출물 분석" : suppliedReason)), 1_500);
                String adapter = "llm-" + artifactKind.toLowerCase(Locale.ROOT).replace('_', '-');
                List<String> evidenceIds = evidenceIds(value.path("evidence_ids"));
                JsonNode parameterValues = value.path("parameters");
                if (!parameterValues.isMissingNode() && (!parameterValues.isArray()
                        || parameterValues.size() > MAX_PARAMETERS_PER_DISCOVERY)) {
                    throw new IllegalArgumentException("parameters는 최대 " + MAX_PARAMETERS_PER_DISCOVERY + "개 배열이어야 합니다.");
                }

                List<RouteCandidate.Provenance> provenance = new ArrayList<>();
                List<RouteCandidate.DeclaredParameter> parameters = new ArrayList<>();
                boolean endpointWasKnown = declaredEndpointKeys.contains(endpointKey)
                        || newEndpointKeys.contains(endpointKey);
                for (String evidenceId : evidenceIds) {
                    String provenanceKey = endpointKey + "\0" + evidenceId;
                    boolean newProvenance = !discoveryProvenanceKeys.contains(provenanceKey)
                            && newProvenanceKeys.add(provenanceKey);
                    if (newProvenance) provenance.add(new RouteCandidate.Provenance(
                            RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS, evidenceId, Source.LLM,
                            runId, adapter, RouteCandidate.Applicability.REVIEW, reason));
                    if (parameterValues.isArray()) for (JsonNode parameter : parameterValues) {
                        requireOnlyFields(parameter, PARAMETER_FIELDS, "parameter");
                        SurfaceAnalysis.ParameterLocation location = enumValue(
                                SurfaceAnalysis.ParameterLocation.class,
                                requiredToken(parameter, "location", 32));
                        String fieldPath = requiredText(parameter, "field_path", 512);
                        if (location == SurfaceAnalysis.ParameterLocation.HEADER
                                && FORBIDDEN_HEADERS.contains(fieldPath.toLowerCase(Locale.ROOT))) {
                            throw new IllegalArgumentException("인증·세션 header는 parameter 선언으로 저장하지 않습니다.");
                        }
                        String displayName = optionalText(parameter, "display_name", 512);
                        SurfaceAnalysis.Requirement requirement = enumValue(SurfaceAnalysis.Requirement.class,
                                parameter.path("requirement").asText("UNKNOWN"));
                        String parameterKey = endpointKey + "\0" + location + "\0" + fieldPath;
                        String parameterProvenanceKey = parameterKey + "\0" + evidenceId;
                        if (declaredParameterProvenanceKeys.contains(parameterProvenanceKey)
                                || !newParameterProvenanceKeys.add(parameterProvenanceKey)) {
                            duplicateParameters++;
                            continue;
                        }
                        if (!declaredParameterKeys.contains(parameterKey)) newParameterKeys.add(parameterKey);
                        parameters.add(new RouteCandidate.DeclaredParameter(location, fieldPath,
                                displayName, requirement, evidenceId, Source.LLM, runId, adapter, reason));
                    }
                }
                if (provenance.isEmpty() && parameters.isEmpty()) {
                    duplicateEndpoints++;
                    continue;
                }
                if (!endpointWasKnown) newEndpointKeys.add(endpointKey);
                if (provenance.isEmpty()) {
                    String evidenceId = evidenceIds.getFirst();
                    provenance.add(new RouteCandidate.Provenance(
                            RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS, evidenceId, Source.LLM,
                            runId, adapter, RouteCandidate.Applicability.REVIEW, reason));
                }
                List<String> concretePaths = path.contains("{") ? List.of() : List.of(path);
                accepted.add(new RouteCandidate(service, method, pathTemplate, concretePaths, false, false,
                        provenance, RouteCandidate.Applicability.REVIEW, reason, parameters));
            }
            if (discoveryProvenanceKeys.size() + newProvenanceKeys.size() > MAX_DISCOVERIES) {
                return error(429, "Explorer run 선언 상한에 도달했습니다.");
            }
            if (declaredParameterProvenanceKeys.size() + newParameterProvenanceKeys.size()
                    > MAX_DECLARED_PARAMETERS) {
                return error(429, "Explorer run parameter 선언 상한에 도달했습니다.");
            }
            if (!accepted.isEmpty()) discoveries.accept(List.copyOf(accepted));
            discoveryProvenanceKeys.addAll(newProvenanceKeys);
            declaredEndpointKeys.addAll(newEndpointKeys);
            declaredParameterKeys.addAll(newParameterKeys);
            declaredParameterProvenanceKeys.addAll(newParameterProvenanceKeys);
            ObjectNode result = JSON.createObjectNode().put("success", true)
                    .put("accepted_endpoints", newEndpointKeys.size())
                    .put("accepted_parameters", newParameterKeys.size())
                    .put("duplicate_endpoints", duplicateEndpoints)
                    .put("duplicate_parameters", duplicateParameters)
                    .put("run_endpoint_total", declaredEndpointKeys.size())
                    .put("run_parameter_total", declaredParameterKeys.size());
            return json(200, result);
        } catch (IllegalArgumentException error) {
            return error(400, Masking.truncate(Masking.maskSecrets(error.getMessage()), 1_000));
        } catch (RuntimeException error) {
            return error(500, "Explorer 선언 저장 중 오류가 발생했습니다.");
        }
    }

    private List<String> evidenceIds(JsonNode values) {
        if (!values.isArray() || values.isEmpty() || values.size() > 8) {
            throw new IllegalArgumentException("evidence_ids는 현재 run의 Evidence ID 1~8개여야 합니다.");
        }
        List<String> result = new ArrayList<>();
        for (JsonNode value : values) {
            String evidenceId = value.asText("").trim();
            if (evidenceId.isBlank() || !responseEvidenceIds.contains(evidenceId)) {
                throw new IllegalArgumentException("현재 Explorer run에서 생성되지 않은 Evidence ID입니다.");
            }
            if (!result.contains(evidenceId)) result.add(evidenceId);
        }
        return result;
    }

    private static URI absoluteHttpUri(String value) {
        URI uri;
        try { uri = URI.create(value); }
        catch (RuntimeException error) { throw new IllegalArgumentException("선언 URL이 올바르지 않습니다."); }
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
            throw new IllegalArgumentException("선언은 절대 HTTP(S) URL이어야 합니다.");
        }
        return uri;
    }

    private static String operationPath(String method, String path) {
        String operation = Normalizer.normalize(method, path).op;
        int separator = operation.indexOf(' ');
        return separator < 0 ? path : operation.substring(separator + 1);
    }

    private static String service(URI uri) {
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }

    private static void requireOnlyFields(JsonNode value, Set<String> allowed, String label) {
        if (!value.isObject()) throw new IllegalArgumentException(label + "는 객체여야 합니다.");
        value.fieldNames().forEachRemaining(name -> {
            if (!allowed.contains(name)) throw new IllegalArgumentException(label + "의 알 수 없는 필드입니다: " + name);
        });
    }

    private static String requiredToken(JsonNode value, String field, int limit) {
        String text = requiredText(value, field, limit);
        if (!text.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException(field + " 형식이 올바르지 않습니다.");
        return text;
    }

    private static String requiredText(JsonNode value, String field, int limit) {
        String text = value.path(field).asText("").trim();
        if (text.isBlank() || text.length() > limit || text.chars().anyMatch(character -> character < 0x20)) {
            throw new IllegalArgumentException(field + " 값이 없거나 허용 길이를 벗어났습니다.");
        }
        return text;
    }

    private static String optionalText(JsonNode value, String field, int limit) {
        if (!value.has(field)) return "";
        String text = value.path(field).asText("").trim();
        if (text.length() > limit || text.chars().anyMatch(character -> character < 0x20)) {
            throw new IllegalArgumentException(field + " 값이 허용 길이를 벗어났습니다.");
        }
        return text;
    }

    private static <E extends Enum<E>> E enumValue(Class<E> type, String value) {
        try { return Enum.valueOf(type, value.toUpperCase(Locale.ROOT)); }
        catch (RuntimeException error) { throw new IllegalArgumentException(type.getSimpleName() + " 값이 올바르지 않습니다."); }
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

    private static String utf8Prefix(String value, int maxBytes) {
        int bytes = 0;
        int end = 0;
        while (end < value.length()) {
            int codePoint = value.codePointAt(end);
            int codePointBytes = codePoint <= 0x7f ? 1
                    : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
            if (bytes + codePointBytes > maxBytes) break;
            bytes += codePointBytes;
            end += Character.charCount(codePoint);
        }
        return value.substring(0, end);
    }

    @Override public synchronized void close() {
        artifacts.clear();
        requestKeys.clear();
        responseEvidenceIds.clear();
        discoveryProvenanceKeys.clear();
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        declaredParameterProvenanceKeys.clear();
        server.close();
    }
}
