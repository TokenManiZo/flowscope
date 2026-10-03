package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.Masking;
import io.flowscope.core.Normalizer;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SupportingAssetScope;
import io.flowscope.core.parameter.ParameterCoordinates;
import io.flowscope.core.parameter.PathSlotCanonicalizer;
import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
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
import java.util.function.Consumer;
import java.util.function.Predicate;

/** Codex dynamic tool을 exact-scope Burp 전송과 Evidence 저장으로 연결하는 loopback gateway. */
public final class ExplorerHttpGateway implements AutoCloseable {
    public record Event(Instant at, String status, String accountId, String method, String url,
                        int httpStatus, String evidenceId, long durationMillis, String message) {}

    private record DiscoveryParameter(SurfaceAnalysis.ParameterLocation location, String fieldPath,
                                      String displayName, SurfaceAnalysis.Requirement requirement) {}

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
    private static final int MAX_REQUESTS = Integer.getInteger("flowscope.explorer.maxRequests", 500);
    private static final long MAX_INDEX_BYTES = Long.getLong(
            "flowscope.javascript.indexBytes", 128L * 1024 * 1024);
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
    private final ExplorerArtifactStore artifacts;
    private final SupportingAssetScope supportingAssets = new SupportingAssetScope();
    private volatile BrowserDriver browser;

    /** Drives the window the operator logged in to. Scope, budget and the stop switch live on the coordinator. */
    public interface BrowserDriver {
        LoginBrowser.Page act(String accountId, String action, String url, String ref, String text) throws Exception;
    }

    /** Wired right after construction; until then /browser answers 409 instead of driving nothing. */
    public void browserDriver(BrowserDriver driver) { this.browser = driver; }

    public String browserUrl() { return "http://127.0.0.1:" + server.port() + "/browser"; }

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
        this.artifacts = new ExplorerArtifactStore(runId);
        this.server = new LoopbackHttpServer(0, REQUEST_LIMIT, this::handle);
        this.server.start();
    }

    public String url() { return "http://127.0.0.1:" + server.port() + "/request"; }
    public String discoveriesUrl() { return "http://127.0.0.1:" + server.port() + "/discoveries"; }
    public String artifactsUrl() { return "http://127.0.0.1:" + server.port() + "/artifacts"; }
    public String token() { return token; }

    private LoopbackHttpServer.Response handle(LoopbackHttpServer.Request request) throws Exception {
        if (!request.remoteAddress().isLoopbackAddress()) return error(403, "loopback 요청만 허용됩니다.");
        URI requestUri = URI.create(request.path());
        if (request.method().equals("GET") && requestUri.getPath().startsWith("/artifact/")) {
            if (!authorized(request.header("Authorization"))) return error(403, "run capability가 올바르지 않습니다.");
            String id = requestUri.getPath().substring("/artifact/".length());
            ExplorerArtifactStore.Metadata metadata;
            String value;
            try {
                metadata = artifacts.metadata(id);
                value = artifacts.readAll(id, Integer.MAX_VALUE);
            } catch (IllegalArgumentException error) {
                return error(404, "artifact를 찾을 수 없습니다.");
            }
            return new LoopbackHttpServer.Response(200,
                    Map.of("Content-Type", "text/plain; charset=utf-8", "Cache-Control", "no-store"),
                    value.getBytes(StandardCharsets.UTF_8), metadata.bytes());
        }
        if (!request.method().equals("POST")
                || !(requestUri.getPath().equals("/request") || requestUri.getPath().equals("/discoveries")
                || requestUri.getPath().equals("/browser")
                || requestUri.getPath().startsWith("/artifacts/"))) {
            return error(405, "지원하지 않는 Explorer gateway 작업입니다.");
        }
        if (!authorized(request.header("Authorization"))) return error(403, "run capability가 올바르지 않습니다.");
        JsonNode body;
        try { body = JSON.readTree(request.body()); }
        catch (Exception error) { return error(400, "요청 JSON을 읽을 수 없습니다."); }
        if (requestUri.getPath().equals("/discoveries")) return handleDiscoveries(body);
        if (requestUri.getPath().equals("/browser")) return handleBrowser(body);
        if (requestUri.getPath().startsWith("/artifacts/")) {
            return handleArtifacts(requestUri.getPath().substring("/artifacts/".length()), body);
        }
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
        boolean inScope = exactScope.test(target);
        String supportingPage = inScope ? null : supportingAssets.pageUrlFor(
                Source.LLM, runId, exactScope, method, target, null, "");
        if (!inScope && supportingPage == null) {
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
        if (supportingPage != null && (!accountId.isBlank() || !headers.isEmpty()
                || requestBody.length > 0)) {
            return error(400, "외부 정적 자산은 비로그인 GET/HEAD와 빈 헤더·본문만 허용됩니다.");
        }
        String requestKey = accountId + "\0" + method + "\0" + target + "\0" + sha256(requestBody);
        synchronized (this) {
            if (requestKeys.size() >= MAX_REQUESTS) return error(429, "Explorer run 요청 상한에 도달했습니다.");
            if (!requestKeys.add(requestKey)) return error(409, "같은 account·method·URL·body 요청은 이미 실행했습니다.");
        }
        long started = System.nanoTime();
        try {
            ExplorerTransport.Response response = transport.send(new ExplorerTransport.Request(
                    accountId, method, target, headers, requestBody, contentType, runId, false, supportingPage));
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
            List<String> linkedAssets = List.of();
            if (response.status() >= 200 && response.status() < 300 && response.contentType() != null) {
                String mediaType = response.contentType().toLowerCase(Locale.ROOT);
                if (inScope && mediaType.contains("text/html")) {
                    linkedAssets = supportingAssets.observeHtml(Source.LLM, runId, exactScope,
                            response.url(), response.body());
                } else if ((mediaType.contains("javascript") || response.url().matches("(?i).*\\.(?:js|mjs|cjs)(?:\\?.*)?"))) {
                    linkedAssets = supportingAssets.observeJavascript(Source.LLM, runId, exactScope,
                            response.url(), supportingPage == null ? response.url() : supportingPage,
                            response.body());
                }
            }
            var supporting = result.putArray("supporting_assets");
            linkedAssets.forEach(supporting::add);
            String safeBody = Masking.maskBody(response.body(), response.contentType());
            byte[] encoded = safeBody.getBytes(StandardCharsets.UTF_8);
            if (encoded.length > INLINE_BODY_LIMIT) {
                result.put("body", utf8Prefix(safeBody, INLINE_BODY_LIMIT));
                result.put("body_truncated", true);
                try {
                    ExplorerArtifactStore.Metadata artifact = artifacts.store(response.evidenceId(), response.url(),
                            response.contentType(), safeBody, !response.bodyTruncated());
                    result.put("artifact_id", artifact.id());
                    result.put("artifact_complete", artifact.complete());
                    result.put("artifact_sha256", artifact.sha256());
                    result.put("artifact_url", "http://127.0.0.1:" + server.port() + "/artifact/" + artifact.id());
                    result.put("artifact_bytes", artifact.bytes());
                    result.put("artifact_error", "");
                } catch (ExplorerArtifactStore.CapacityExceededException error) {
                    String safe = Masking.truncate(Masking.maskSecrets(error.getMessage()), 500);
                    result.put("artifact_id", "");
                    result.put("artifact_complete", false);
                    result.put("artifact_sha256", sha256(encoded));
                    result.put("artifact_url", "");
                    result.put("artifact_bytes", 0);
                    result.put("artifact_error", safe);
                    emit("ARTIFACT_LIMIT", accountId, method, target, response.status(),
                            response.evidenceId(), response.durationMillis(), safe);
                }
            } else {
                result.put("body", safeBody);
                result.put("body_truncated", response.bodyTruncated());
                result.put("artifact_url", "");
                result.put("artifact_id", "");
                result.put("artifact_complete", !response.bodyTruncated());
                result.put("artifact_sha256", sha256(encoded));
                result.put("artifact_bytes", 0);
                result.put("artifact_error", "");
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

    private LoopbackHttpServer.Response handleBrowser(JsonNode body) {
        BrowserDriver driver = browser;
        if (driver == null) return error(409, "이 실행에는 브라우저 로그인으로 준비된 계정이 없습니다.");
        String account;
        String action;
        String url;
        String ref;
        String text;
        try {
            requireOnlyFields(body, Set.of("account", "action", "url", "ref", "text"), "browser 요청");
            account = requiredText(body, "account", 96);
            action = requiredText(body, "action", 32);
            url = body.path("url").asText("").trim();
            ref = body.path("ref").asText("").trim();
            text = body.path("text").asText("");
        } catch (IllegalArgumentException error) {
            return error(400, Masking.truncate(Masking.maskSecrets(error.getMessage()), 500));
        }
        try {
            LoginBrowser.Page page = driver.act(account, action, url, ref, text);
            ObjectNode result = JSON.createObjectNode().put("success", true)
                    .put("url", page.url()).put("title", page.title()).put("text", page.text());
            ArrayNode elements = result.putArray("elements");
            for (LoginBrowser.Element element : page.elements()) {
                elements.addObject().put("ref", element.ref()).put("role", element.role())
                        .put("name", element.name());
            }
            return json(200, result);
        } catch (IllegalArgumentException error) {
            return error(400, Masking.truncate(Masking.maskSecrets(error.getMessage()), 500));
        } catch (IllegalStateException error) {
            // Window closed, budget spent, run over: the turn must stop driving, not retry.
            return error(409, Masking.truncate(Masking.maskSecrets(error.getMessage()), 500));
        } catch (Exception error) {
            return error(502, Masking.truncate(Masking.maskSecrets(error.getMessage() == null
                    ? error.getClass().getSimpleName() : error.getMessage()), 500));
        }
    }

    private LoopbackHttpServer.Response handleArtifacts(String operation, JsonNode body) {
        try {
            return switch (operation) {
                case "list" -> artifactList(body);
                case "search" -> artifactSearch(body);
                case "read" -> artifactRead(body);
                case "index" -> artifactIndex(body);
                default -> error(404, "artifact 작업을 찾을 수 없습니다.");
            };
        } catch (ExplorerArtifactStore.CapacityExceededException error) {
            return error(413, error.getMessage());
        } catch (IllegalArgumentException error) {
            return error(400, Masking.truncate(Masking.maskSecrets(error.getMessage()), 1_000));
        } catch (Exception error) {
            return error(500, "artifact 처리 중 오류가 발생했습니다.");
        }
    }

    private LoopbackHttpServer.Response artifactList(JsonNode body) {
        requireOnlyFields(body, Set.of(), "artifact list 요청");
        ObjectNode result = JSON.createObjectNode().put("success", true);
        var values = result.putArray("artifacts");
        for (ExplorerArtifactStore.Metadata artifact : artifacts.list()) writeMetadata(values.addObject(), artifact);
        return json(200, result);
    }

    private LoopbackHttpServer.Response artifactSearch(JsonNode body) throws java.io.IOException {
        requireOnlyFields(body, Set.of("artifact_id", "query", "case_sensitive", "max_results"),
                "artifact search 요청");
        String artifactId = body.path("artifact_id").asText("").trim();
        String query = body.path("query").asText("");
        boolean caseSensitive = body.path("case_sensitive").asBoolean(true);
        int maxResults = body.path("max_results").asInt(50);
        ObjectNode result = JSON.createObjectNode().put("success", true).put("query", query);
        var values = result.putArray("matches");
        for (ExplorerArtifactStore.Match match : artifacts.search(
                artifactId, query, caseSensitive, maxResults)) {
            values.addObject().put("artifact_id", match.artifactId())
                    .put("char_offset", match.charOffset()).put("snippet", match.snippet());
        }
        result.put("limited", values.size() >= Math.max(1, Math.min(maxResults, 200)));
        return json(200, result);
    }

    private LoopbackHttpServer.Response artifactRead(JsonNode body) throws java.io.IOException {
        requireOnlyFields(body, Set.of("artifact_id", "char_offset", "max_chars"), "artifact read 요청");
        String artifactId = requiredText(body, "artifact_id", 128);
        ExplorerArtifactStore.Read value = artifacts.read(artifactId, body.path("char_offset").asLong(0),
                body.path("max_chars").asInt(64 * 1024));
        ObjectNode result = JSON.createObjectNode().put("success", true)
                .put("artifact_id", value.artifactId()).put("char_offset", value.charOffset())
                .put("text", value.text()).put("end_of_artifact", value.endOfArtifact());
        writeMetadata(result.putObject("metadata"), artifacts.metadata(artifactId));
        return json(200, result);
    }

    private LoopbackHttpServer.Response artifactIndex(JsonNode body) throws java.io.IOException {
        requireOnlyFields(body, Set.of("artifact_id", "offset", "max_items"), "artifact index 요청");
        String artifactId = requiredText(body, "artifact_id", 128);
        int offset = Math.max(0, body.path("offset").asInt(0));
        int maxItems = Math.max(1, Math.min(body.path("max_items").asInt(250), 500));
        ExplorerArtifactStore.Metadata metadata = artifacts.metadata(artifactId);
        if (!javascript(metadata.contentType(), metadata.url())) {
            return error(400, "JavaScript artifact만 AST index를 생성할 수 있습니다.");
        }
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(
                artifacts.readAll(artifactId, MAX_INDEX_BYTES));
        ObjectNode result = JSON.createObjectNode().put("success", true)
                .put("artifact_id", artifactId).put("status", analysis.status().name())
                .put("detail", analysis.detail()).put("offset", offset).put("max_items", maxItems)
                .put("call_site_total", analysis.callSites().size())
                .put("asset_total", analysis.assets().size()).put("issue_total", analysis.issues().size());
        var calls = result.putArray("call_sites");
        for (JavascriptAnalysis.CallSite call : slice(analysis.callSites(), offset, maxItems)) {
            ObjectNode value = calls.addObject().put("reference", call.reference()).put("method", call.method())
                    .put("adapter", call.adapter()).put("reason", call.reason())
                    .put("line", call.line()).put("column", call.column());
            var parameters = value.putArray("parameters");
            for (JavascriptAnalysis.Parameter parameter : call.parameters()) {
                parameters.addObject().put("name", parameter.name()).put("kind", parameter.kind().name());
            }
        }
        var assets = result.putArray("assets");
        for (JavascriptAnalysis.AssetReference asset : slice(analysis.assets(), offset, maxItems)) {
            assets.addObject().put("reference", asset.reference()).put("reason", asset.reason())
                    .put("line", asset.line()).put("column", asset.column());
        }
        var issues = result.putArray("issues");
        for (JavascriptAnalysis.ResolutionIssue issue : slice(analysis.issues(), offset, maxItems)) {
            issues.addObject().put("kind", issue.kind().name()).put("adapter", issue.adapter())
                    .put("detail", issue.detail()).put("line", issue.line()).put("column", issue.column());
        }
        boolean more = analysis.callSites().size() > offset + maxItems
                || analysis.assets().size() > offset + maxItems || analysis.issues().size() > offset + maxItems;
        result.put("next_offset", more ? offset + maxItems : -1);
        writeMetadata(result.putObject("metadata"), metadata);
        return json(200, result);
    }

    private static <T> List<T> slice(List<T> values, int offset, int limit) {
        if (offset >= values.size()) return List.of();
        return values.subList(offset, Math.min(values.size(), offset + limit));
    }

    private static void writeMetadata(ObjectNode value, ExplorerArtifactStore.Metadata artifact) {
        value.put("artifact_id", artifact.id()).put("evidence_id", artifact.evidenceId())
                .put("url", artifact.url()).put("content_type", artifact.contentType())
                .put("sha256", artifact.sha256()).put("bytes", artifact.bytes())
                .put("complete", artifact.complete()).put("created_at", artifact.createdAt().toString());
        var provenance = value.putArray("provenance");
        for (ExplorerArtifactStore.Provenance item : artifact.provenance()) {
            provenance.addObject().put("evidence_id", item.evidenceId()).put("url", item.url())
                    .put("content_type", item.contentType());
        }
    }

    private static boolean javascript(String contentType, String url) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        String path = url == null ? "" : url.toLowerCase(Locale.ROOT);
        return type.contains("javascript") || type.contains("ecmascript") || path.matches(".*\\.(?:js|mjs|cjs)(?:[?#].*)?$");
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
        ArrayNode rejected = JSON.createArrayNode();
        ArrayNode rejectedParameters = JSON.createArrayNode();
        int duplicateEndpoints = 0;
        int duplicateParameters = 0;
        try {
            requireOnlyFields(root, Set.of("discoveries"), "요청 본문");
            for (int index = 0; index < values.size(); index++) {
                JsonNode value = values.get(index);
                try {
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
                    List<DiscoveryParameter> validParameters = new ArrayList<>();
                    ArrayNode itemRejectedParameters = JSON.createArrayNode();
                    if (parameterValues.isArray()) for (int parameterIndex = 0;
                            parameterIndex < parameterValues.size(); parameterIndex++) {
                        JsonNode parameter = parameterValues.get(parameterIndex);
                        try {
                            requireOnlyFields(parameter, PARAMETER_FIELDS, "parameter");
                            SurfaceAnalysis.ParameterLocation location = enumValue(
                                    SurfaceAnalysis.ParameterLocation.class,
                                    requiredToken(parameter, "location", 32));
                            String rawFieldPath = requiredText(parameter, "field_path", 512);
                            String headerName = rawFieldPath.startsWith("/") ? rawFieldPath.substring(1) : rawFieldPath;
                            if (location == SurfaceAnalysis.ParameterLocation.HEADER
                                    && FORBIDDEN_HEADERS.contains(headerName.toLowerCase(Locale.ROOT))) {
                                throw new IllegalArgumentException("인증·세션 header는 parameter 선언으로 저장하지 않습니다.");
                            }
                            String fieldPath = canonicalFieldPath(location, rawFieldPath, pathTemplate, path);
                            validParameters.add(new DiscoveryParameter(location, fieldPath,
                                    optionalText(parameter, "display_name", 512),
                                    enumValue(SurfaceAnalysis.Requirement.class,
                                            parameter.path("requirement").asText("UNKNOWN"))));
                        } catch (IllegalArgumentException error) {
                            ObjectNode issue = itemRejectedParameters.addObject()
                                    .put("discovery_index", index).put("parameter_index", parameterIndex)
                                    .put("reason", Masking.truncate(Masking.maskSecrets(error.getMessage()), 1_000));
                            ArrayNode choices = issue.putArray("candidate_field_paths");
                            if ("PATH".equalsIgnoreCase(parameter.path("location").asText())) {
                                ParameterCoordinates.pathSlots(path).stream()
                                        .map(PathSlotCanonicalizer.Slot::canonicalPath).distinct()
                                        .forEach(choices::add);
                            }
                        }
                    }

                    List<RouteCandidate.Provenance> provenance = new ArrayList<>();
                    List<RouteCandidate.DeclaredParameter> parameters = new ArrayList<>();
                    Set<String> itemProvenanceKeys = new LinkedHashSet<>();
                    Set<String> itemEndpointKeys = new LinkedHashSet<>();
                    Set<String> itemParameterKeys = new LinkedHashSet<>();
                    Set<String> itemParameterProvenanceKeys = new LinkedHashSet<>();
                    int itemDuplicateParameters = 0;
                    boolean endpointWasKnown = declaredEndpointKeys.contains(endpointKey)
                            || newEndpointKeys.contains(endpointKey);
                    for (String evidenceId : evidenceIds) {
                        String provenanceKey = endpointKey + "\0" + evidenceId;
                        boolean newProvenance = !discoveryProvenanceKeys.contains(provenanceKey)
                                && !newProvenanceKeys.contains(provenanceKey)
                                && itemProvenanceKeys.add(provenanceKey);
                        if (newProvenance) provenance.add(new RouteCandidate.Provenance(
                                RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS, evidenceId, Source.LLM,
                                runId, adapter, RouteCandidate.Applicability.REVIEW, reason));
                        for (DiscoveryParameter parameter : validParameters) {
                            String parameterKey = endpointKey + "\0" + parameter.location() + "\0" + parameter.fieldPath();
                            String parameterProvenanceKey = parameterKey + "\0" + evidenceId;
                            if (declaredParameterProvenanceKeys.contains(parameterProvenanceKey)
                                    || newParameterProvenanceKeys.contains(parameterProvenanceKey)
                                    || !itemParameterProvenanceKeys.add(parameterProvenanceKey)) {
                                itemDuplicateParameters++;
                                continue;
                            }
                            if (!declaredParameterKeys.contains(parameterKey)
                                    && !newParameterKeys.contains(parameterKey)) itemParameterKeys.add(parameterKey);
                            parameters.add(new RouteCandidate.DeclaredParameter(parameter.location(),
                                    parameter.fieldPath(), parameter.displayName(), parameter.requirement(),
                                    evidenceId, Source.LLM, runId, adapter, reason,
                                    ParameterCoordinates.CoordinateVersion.FLOW_V2));
                        }
                    }
                    if (provenance.isEmpty() && parameters.isEmpty()) {
                        duplicateEndpoints++;
                        duplicateParameters += itemDuplicateParameters;
                        rejectedParameters.addAll(itemRejectedParameters);
                        continue;
                    }
                    if (!endpointWasKnown) itemEndpointKeys.add(endpointKey);
                    if (provenance.isEmpty()) {
                        String evidenceId = evidenceIds.getFirst();
                        provenance.add(new RouteCandidate.Provenance(
                                RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS, evidenceId, Source.LLM,
                                runId, adapter, RouteCandidate.Applicability.REVIEW, reason));
                    }
                    List<String> concretePaths = path.contains("{") ? List.of() : List.of(path);
                    accepted.add(new RouteCandidate(service, method, pathTemplate, concretePaths, false, false,
                            provenance, RouteCandidate.Applicability.REVIEW, reason, parameters));
                    newProvenanceKeys.addAll(itemProvenanceKeys);
                    newEndpointKeys.addAll(itemEndpointKeys);
                    newParameterKeys.addAll(itemParameterKeys);
                    newParameterProvenanceKeys.addAll(itemParameterProvenanceKeys);
                    duplicateParameters += itemDuplicateParameters;
                    rejectedParameters.addAll(itemRejectedParameters);
                } catch (IllegalArgumentException error) {
                    rejected.addObject().put("index", index).put("reason",
                            Masking.truncate(Masking.maskSecrets(error.getMessage()), 1_000));
                }
            }
            if (accepted.isEmpty() && !rejected.isEmpty()) {
                ObjectNode result = JSON.createObjectNode().put("success", false)
                        .put("error", "발견을 저장하지 못했습니다: 항목 " + rejected.get(0).path("index").asInt()
                                + " · " + rejected.get(0).path("reason").asText());
                result.set("rejected_discoveries", rejected);
                result.set("rejected_parameters", rejectedParameters);
                return json(400, result);
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
            result.set("rejected_discoveries", rejected);
            result.set("rejected_parameters", rejectedParameters);
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

    /**
     * D-143: Explorer 선언 좌표는 저장 전에 canonical FLOW_V2로 검증·정규화한다. 점·배열 표기 JSON처럼 구조를
     * 추정해야 하는 입력은 거부해 모델이 canonical pointer로 다시 보내게 한다(추정 join 없음).
     */
    private static String canonicalFieldPath(SurfaceAnalysis.ParameterLocation location, String raw,
                                             String pathTemplate, String declaredPath) {
        switch (location) {
            case PATH -> {
                if (raw.matches("/segments/\\d+")) {
                    if (!ParameterCoordinates.pathSlotPosition(pathTemplate, raw)) {
                        throw new IllegalArgumentException("PATH field_path " + raw + "은(는) 선언 URL template의 placeholder 위치가 아닙니다.");
                    }
                    return raw;
                }
                List<PathSlotCanonicalizer.Slot> namedSlots =
                        ParameterCoordinates.pathSlots(declaredPath).stream()
                                .filter(slot -> raw.equals(slot.declaredName())
                                        || raw.equals("{" + slot.declaredName() + "}"))
                                .toList();
                if (namedSlots.size() == 1
                        && ParameterCoordinates.pathSlotPosition(pathTemplate,
                        namedSlots.getFirst().canonicalPath())) {
                    return namedSlots.getFirst().canonicalPath();
                }
                if (namedSlots.size() > 1) {
                    throw new IllegalArgumentException("PATH 이름이 여러 위치에 있으므로 /segments/N 위치를 명시해야 합니다.");
                }
                return ParameterCoordinates.legacyToCanonical(location, raw, pathTemplate).orElseThrow(() ->
                        new IllegalArgumentException("PATH field_path는 선언 URL의 유일한 {이름}, "
                                + "/segments/N 또는 template 위치의 path[i]여야 합니다."));
            }
            case JSON_BODY, GRAPHQL_VARIABLE, XML_PATH -> {
                if (raw.startsWith("/")) {
                    if (!validPointer(raw)) {
                        throw new IllegalArgumentException("field_path pointer 형식이 올바르지 않습니다(빈 세그먼트·잘못된 ~ 이스케이프).");
                    }
                    return raw;
                }
                if (location != SurfaceAnalysis.ParameterLocation.XML_PATH
                        && ParameterCoordinates.legacyToCanonical(location, raw, pathTemplate).isPresent()) {
                    return ParameterCoordinates.jsonChild("", raw);
                }
                throw new IllegalArgumentException("점·배열 표기 " + location
                        + " field_path는 구조를 추정하지 않습니다. canonical pointer(/parent/child, 배열 원소 *)로 보내세요.");
            }
            case QUERY, FORM_BODY, MULTIPART_BODY -> {
                return raw.startsWith("/") && validPointer(raw) && raw.indexOf('/', 1) < 0
                        ? raw : ParameterCoordinates.nameToken(raw);
            }
            case HEADER -> {
                return raw.startsWith("/") && validPointer(raw) && raw.indexOf('/', 1) < 0
                        ? raw.toLowerCase(Locale.ROOT) : ParameterCoordinates.headerToken(raw);
            }
        }
        throw new IllegalArgumentException("지원하지 않는 parameter location입니다.");
    }

    private static boolean validPointer(String pointer) {
        if (!pointer.startsWith("/")) return false;
        for (String segment : pointer.substring(1).split("/", -1)) {
            for (int i = 0; i < segment.length(); i++) {
                if (segment.charAt(i) == '~'
                        && (i + 1 >= segment.length() || "012".indexOf(segment.charAt(i + 1)) < 0)) return false;
            }
        }
        return true;
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
        artifacts.close();
        requestKeys.clear();
        responseEvidenceIds.clear();
        discoveryProvenanceKeys.clear();
        declaredEndpointKeys.clear();
        declaredParameterKeys.clear();
        declaredParameterProvenanceKeys.clear();
        server.close();
    }
}
