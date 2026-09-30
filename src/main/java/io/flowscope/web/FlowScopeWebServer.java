package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AccountVerificationRule;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationMatrix;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.LaneCompletionPolicy;
import io.flowscope.core.Masking;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ResourcePolicy;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.ReviewDecision;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.ToolKind;
import io.flowscope.core.TrafficOverride;
import io.flowscope.core.ValidationDecision;
import io.flowscope.integration.LoopbackHttpServer;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.integration.ZapCampaign;
import io.flowscope.integration.ZapAccountVault;
import io.flowscope.explorer.ExplorerAccountVault;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import io.flowscope.integration.LiveCrossIdentityReplayCoordinator;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.SessionBroker;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

/** Burp의 축소 JRE에서도 동작하는 localhost 전용 Web 작업면 서버. */
public final class FlowScopeWebServer implements AutoCloseable {
    public interface State {
        Pipeline.Result snapshot();
        default Pipeline.Result completionSnapshot() { return snapshot(); }
        long revision();
        default long datasetRevision() { return revision(); }
        AnalysisConfig config();
        List<LegacyAssessment> assessments();
        List<ValidationDecision> validations();
        RunContextRegistry contexts();
        default void humanRunStarted(String runId) {}
        default int humanListenerPort(String runId) { return -1; }
        default int otherHumanListenerPort(String runId) { return -1; }
        default long otherHumanListenerRequests(String runId) { return 0; }
        void rebuild();
        void loadSample();
        BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception;
        BurpXmlParser.ParseResult importHar(byte[] har) throws Exception;
        RequestRecord openInRepeater(String evidenceId, String request,
                                     CredentialMode credentialMode, String accountId);
        default RequestLabDraft requestLabDraft(String evidenceId) {
            throw new UnsupportedOperationException("request lab is unavailable");
        }
        default RequestLabResult sendRequestLab(String evidenceId, String request,
                                                CredentialMode credentialMode, String accountId) {
            throw new UnsupportedOperationException("request lab is unavailable");
        }
        default CrossIdentityReplayOrchestrator.RunResult runAuthorizationReplay(String itemId, boolean armed) {
            throw new UnsupportedOperationException("authorization replay is unavailable");
        }
        default void killAuthorizationReplay() {
            throw new UnsupportedOperationException("authorization replay is unavailable");
        }
        default String draftAuthorizationReplay(String itemId) {
            throw new UnsupportedOperationException("authorization replay is unavailable");
        }
        default LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                List<String> accountIds, boolean anonymous, boolean armed) {
            throw new UnsupportedOperationException("live authorization replay is unavailable");
        }
        default LiveCrossIdentityReplayCoordinator.Snapshot startLiveAuthorizationReplay(
                List<String> accountIds, boolean anonymous, List<Source> basisSources, boolean armed) {
            return startLiveAuthorizationReplay(accountIds, anonymous, armed);
        }
        default LiveCrossIdentityReplayCoordinator.Snapshot liveAuthorizationReplayStatus() {
            return new LiveCrossIdentityReplayCoordinator.Snapshot("",
                    LiveCrossIdentityReplayCoordinator.State.STOPPED, false, List.of(), false,
                    0, 0, 0, 0, 0, 0, "NOT_AVAILABLE");
        }
        default LiveCrossIdentityReplayCoordinator.Snapshot stopLiveAuthorizationReplay() {
            throw new UnsupportedOperationException("live authorization replay is unavailable");
        }
        default SessionBroker sessions() { return null; }
        default List<AccountRequestCandidate> accountRequestCandidates(String accountId) { return List.of(); }
        default void linkAccountRequestCandidate(String accountId, String evidenceId) {
            throw new UnsupportedOperationException("HUMAN request linking is unavailable");
        }
        default List<ZapAccountVault.View> zapAccounts() { return List.of(); }
        default ZapAccountVault.View saveZapAccount(ZapAccountVault.Input input) {
            throw new UnsupportedOperationException("ZAP account workflow is unavailable");
        }
        default void removeZapAccount(String id) {
            throw new UnsupportedOperationException("ZAP account workflow is unavailable");
        }
        default JsonNode refreshAccountSession(String id) {
            throw new UnsupportedOperationException("ZAP account session refresh is unavailable");
        }
        default List<String> scopeEntries() { return List.of(); }
        default ProjectWorkspace.Status projectStatus() {
            return new ProjectWorkspace.Status("", null, List.of());
        }
        default ProjectWorkspace.Status startProject(String name, String scope) {
            throw new UnsupportedOperationException("project workflow is unavailable");
        }
        default ProjectWorkspace.Status openProject(String id) {
            throw new UnsupportedOperationException("project workflow is unavailable");
        }
        default ProjectWorkspace.Status resetProjectTraffic() {
            throw new UnsupportedOperationException("project workflow is unavailable");
        }
        default ProjectWorkspace.Status deleteProject(String id) {
            throw new UnsupportedOperationException("project workflow is unavailable");
        }
        default List<RouteCandidate> routeCandidates() { return List.of(); }
        default List<RunExecutionLedger.Summary> executionSummaries() { return List.of(); }
        default List<RunExecutionLedger.Attempt> manualAttempts() { return List.of(); }
        default long droppedRecords() { return 0; }
        default com.fasterxml.jackson.databind.JsonNode startScanner(String target, List<String> accountIds,
                                                                     boolean includeAnonymous) {
            throw new UnsupportedOperationException("scanner workflow is unavailable");
        }
        default com.fasterxml.jackson.databind.JsonNode startScanner(String target, List<String> accountIds,
                                                                     boolean includeAnonymous,
                                                                     List<ZapCampaign.ZapDefinition> definitions) {
            return startScanner(target, accountIds, includeAnonymous);
        }
        default com.fasterxml.jackson.databind.JsonNode scannerStatus() {
            return new ObjectMapper().createObjectNode().put("status", "NOT_STARTED");
        }
        default com.fasterxml.jackson.databind.JsonNode cancelScanner() {
            throw new UnsupportedOperationException("scanner workflow is unavailable");
        }
        default ObjectNode zapStatus() {
            return new ObjectMapper().createObjectNode()
                    .put("connected", false)
                    .put("state", "UNAVAILABLE")
                    .put("message", "ZAP 연결 확인 기능을 사용할 수 없습니다.");
        }
        default ExplorerCoordinator.Snapshot explorerStatus() {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
        default List<ExplorerAccountVault.View> explorerAccounts() { return List.of(); }
        default ExplorerAccountVault.View saveExplorerAccount(ExplorerAccountVault.Input input) {
            throw new UnsupportedOperationException("Explorer account workflow is unavailable");
        }
        default void removeExplorerAccount(String id) {
            throw new UnsupportedOperationException("Explorer account workflow is unavailable");
        }
        default ExplorerAccountVault.View verifyExplorerAccount(String id) {
            throw new UnsupportedOperationException("Explorer account verification is unavailable");
        }
        default ExplorerCoordinator.Snapshot startExplorer(ExplorerCoordinator.StartRequest request) {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
        default ExplorerCoordinator.Snapshot steerExplorer(String message) {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
        default ExplorerCoordinator.Snapshot cancelExplorer() {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
        default ExplorerCoordinator.Snapshot clearExplorer() {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
        default ExplorerCoordinator.Snapshot recheckExplorerProvider() {
            throw new UnsupportedOperationException("Explorer workflow is unavailable");
        }
    }

    public enum CredentialMode { ORIGINAL, ANONYMOUS, ACCOUNT }

    /** Safe metadata only. Raw request headers and credential values never cross the local API. */
    public record AccountRequestCandidate(String id, int status, String method, String path, String mime,
                                          boolean hasCookie, boolean hasAuthorization, boolean markMatched,
                                          boolean eligible, String reason) {}

    public record RequestLabDraft(String eventId, String service, String request, String response,
                                  boolean rawRequestRetained, boolean rawResponseRetained, boolean requestEditable,
                                  String requestCharset, String responseCharset, String observedIdentity,
                                  String reusableSession, String reusableAccountId, String message) {}

    public record RequestLabResult(String eventId, int status, String response, long durationMs,
                                   int requestBytes, int responseBytes) {}

    private static final int FORM_LIMIT = 4 * 1024 * 1024;
    private static final int REQUEST_LAB_REQUEST_LIMIT = 1024 * 1024;
    private static final int WEB_BODY_LIMIT = 25 * 1024 * 1024;
    private static final int EVIDENCE_PAGE_LIMIT = 200;
    private static final int REQUEST_LAB_OPERATION_LIMIT = 256;
    private final State state;
    private final String capabilityToken = randomCapabilityToken();
    private final ObjectMapper json = new ObjectMapper();
    private final SnapshotJsonWriter snapshots = new SnapshotJsonWriter();
    private final ClasspathWebAssets webAssets = new ClasspathWebAssets(ClasspathWebAssets.DefaultUi.REACT);
    private final Map<String, RequestLabOperation> requestLabOperations = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<String> requestLabOperationOrder = new ConcurrentLinkedDeque<>();
    private final LoopbackHttpServer server;

    public FlowScopeWebServer(State state, int requestedPort) throws IOException {
        this.state = state;
        this.server = bindAvailable(requestedPort);
    }

    public void start() { server.start(); }
    public int port() { return server.port(); }
    public String url() { return "http://127.0.0.1:" + port() + "/"; }

    private LoopbackHttpServer bindAvailable(int requestedPort) throws IOException {
        IOException last = null;
        int attempts = requestedPort == 0 ? 1 : 20;
        for (int offset = 0; offset < attempts; offset++) {
            try {
                return new LoopbackHttpServer(requestedPort + offset, WEB_BODY_LIMIT, this::handle);
            } catch (IOException error) {
                last = error;
            }
        }
        throw last == null ? new IOException("no local web port available") : last;
    }

    private LoopbackHttpServer.Response handle(LoopbackHttpServer.Request request) throws Exception {
        URI target;
        try { target = URI.create(request.path()); }
        catch (RuntimeException error) {
            return staticPath(request.path()) ? staticError(request, 400, "잘못된 요청 경로입니다.")
                    : error(400, "잘못된 요청 경로입니다.");
        }
        String path = target.getPath();
        if (!request.remoteAddress().isLoopbackAddress() || !validHost(request.header("Host"))) {
            return error(403, "localhost 요청만 허용됩니다.");
        }
        if (path.equals("/app")) return appRedirect(request);
        Optional<ClasspathWebAssets.Asset> asset = webAssets.resolve(target.getRawPath());
        if (asset.isPresent()) return staticAsset(request, asset.orElseThrow());
        if (path.equals("/vendor/cytoscape-3.26.0.min.js")) return cytoscape(request);
        if (staticPath(target.getRawPath())) return staticError(request, 404, "Not found");
        if (!path.startsWith("/api/")) return error(404, "Not found");
        if (!authorized(request)) return error(403, "FlowScope 로컬 API 인증에 실패했습니다. UI를 다시 여세요.");
        return switch (path) {
            case "/api/snapshot" -> snapshot(request);
            case "/api/evidence" -> evidence(request, target);
            case "/api/manual-attempts" -> request.method().equals("GET")
                    ? response(200, "application/json; charset=utf-8", json.writeValueAsBytes(state.manualAttempts()))
                    : method("GET");
            case "/api/cluster-evidence" -> clusterEvidence(request, target);
            case "/api/replay" -> replay(request);
            case "/api/request-lab" -> requestLab(request, target);
            case "/api/authorization-replay" -> authorizationReplay(request);
            case "/api/clear" -> clear(request);
            case "/api/projects" -> projects(request);
            case "/api/human-run" -> humanRun(request);
            case "/api/sample" -> sample(request);
            case "/api/role" -> role(request);
            case "/api/requirement" -> requirement(request);
            case "/api/resource-policy" -> resourcePolicy(request);
            case "/api/review" -> review(request);
            case "/api/traffic-override" -> trafficOverride(request);
            case "/api/identity-merge" -> identityMerge(request);
            case "/api/account-save" -> accountSave(request);
            case "/api/account-settings" -> accountSettings(request, target);
            case "/api/account-delete" -> accountDelete(request);
            case "/api/session-bind" -> sessionBind(request);
            case "/api/session-unbind" -> sessionUnbind(request);
            case "/api/session-capture" -> sessionCapture(request);
            case "/api/zap-status" -> zapStatus(request);
            case "/api/zap-accounts" -> zapAccounts(request);
            case "/api/scanner-run" -> scannerRun(request);
            case "/api/explorer-run" -> explorerRun(request);
            case "/api/explorer-accounts" -> explorerAccounts(request);
            case "/api/identity-reset" -> identityReset(request);
            case "/api/import-xml" -> importXml(request, target);
            case "/api/import-har" -> importHar(request, target);
            case "/api/owner" -> owner(request);
            case "/api/verdict", "/api/replay-verdict" -> error(409,
                    "Repeater 결과는 자동 확정하지 않습니다. 새 Evidence를 확인한 뒤 후보 검토에서 판정하세요.");
            default -> error(404, "Not found");
        };
    }

    private LoopbackHttpServer.Response appRedirect(LoopbackHttpServer.Request request) {
        if (!staticMethod(request)) return method("GET, HEAD");
        return new LoopbackHttpServer.Response(308,
                headers("text/plain; charset=utf-8", Map.of("Location", "/app/")), new byte[0]);
    }

    private LoopbackHttpServer.Response staticAsset(LoopbackHttpServer.Request request,
                                                     ClasspathWebAssets.Asset asset) throws IOException {
        if (!staticMethod(request)) return method("GET, HEAD");
        try (var input = FlowScopeWebServer.class.getResourceAsStream(asset.resource())) {
            if (input == null) return staticError(request, 404, "Not found");
            byte[] body = input.readAllBytes();
            if (asset.html()) {
                body = new String(body, StandardCharsets.UTF_8)
                        .replace("__FLOWSCOPE_CAPABILITY__", capabilityToken)
                        .getBytes(StandardCharsets.UTF_8);
            }
            return new LoopbackHttpServer.Response(200, headers(asset.contentType(), Map.of()),
                    request.method().equals("HEAD") ? new byte[0] : body, body.length);
        }
    }

    private LoopbackHttpServer.Response staticError(LoopbackHttpServer.Request request,
                                                     int status, String message) throws IOException {
        return staticResponse(request, error(status, message));
    }

    private static LoopbackHttpServer.Response staticResponse(LoopbackHttpServer.Request request,
                                                               LoopbackHttpServer.Response response) {
        if (!request.method().equals("HEAD")) return response;
        return new LoopbackHttpServer.Response(response.status(), response.headers(), new byte[0],
                response.contentLength());
    }

    private static boolean staticMethod(LoopbackHttpServer.Request request) {
        return request.method().equals("GET") || request.method().equals("HEAD");
    }

    private static boolean staticPath(String rawPath) {
        return rawPath != null && (rawPath.equals("/") || rawPath.startsWith("/app/")
                || rawPath.startsWith("/legacy/") || rawPath.startsWith("/assets/")
                || rawPath.startsWith("/vendor/"));
    }

    private LoopbackHttpServer.Response cytoscape(LoopbackHttpServer.Request request) throws IOException {
        if (!staticMethod(request)) return method("GET, HEAD");
        try (var input = FlowScopeWebServer.class.getResourceAsStream("/web/vendor/cytoscape-3.26.0.min.js")) {
            if (input == null) return staticError(request, 500, "Graph library missing");
            byte[] body = input.readAllBytes();
            return new LoopbackHttpServer.Response(200,
                    headers("application/javascript; charset=utf-8", Map.of()),
                    request.method().equals("HEAD") ? new byte[0] : body, body.length);
        }
    }

    private LoopbackHttpServer.Response snapshot(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        return response(200, "application/json; charset=utf-8",
                snapshots.write(state.revision(), state.datasetRevision(), state.snapshot(), state.config(), state.assessments(), state.validations(),
                        state.sessions() == null ? List.of() : state.sessions().views(), state.routeCandidates(),
                        state.droppedRecords(), state.executionSummaries()));
    }

    private LoopbackHttpServer.Response evidence(LoopbackHttpServer.Request request, URI target) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        try {
            Map<String, String> query = form(target.getRawQuery());
            String operation = required(query, "operation");
            int offset = boundedInteger(query.get("offset"), 0, 0, 20_000, "offset");
            int limit = boundedInteger(query.get("limit"), EVIDENCE_PAGE_LIMIT,
                    1, EVIDENCE_PAGE_LIMIT, "limit");
            return response(200, "application/json; charset=utf-8",
                    snapshots.evidence(state.snapshot(), operation, offset, limit));
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response clusterEvidence(LoopbackHttpServer.Request request, URI target)
            throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        try {
            Map<String, String> query = form(target.getRawQuery());
            String clusterId = required(query, "clusterId");
            int offset = boundedInteger(query.get("offset"), 0, 0, 20_000, "offset");
            int limit = boundedInteger(query.get("limit"), EVIDENCE_PAGE_LIMIT,
                    1, EVIDENCE_PAGE_LIMIT, "limit");
            return response(200, "application/json; charset=utf-8",
                    snapshots.clusterEvidence(state.snapshot(), clusterId, offset, limit));
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private static int boundedInteger(String raw, int defaultValue, int minimum, int maximum, String name) {
        if (raw == null || raw.isBlank()) return defaultValue;
        try {
            int value = Integer.parseInt(raw);
            if (value < minimum || value > maximum) throw new IllegalArgumentException();
            return value;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(name + " 값의 범위가 올바르지 않습니다.");
        }
    }



    private LoopbackHttpServer.Response replay(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String rawRequest = requiredRaw(form, "request");
            if (rawRequest.getBytes(StandardCharsets.UTF_8).length > REQUEST_LAB_REQUEST_LIMIT) {
                throw new IllegalArgumentException("편집 요청은 1MB 이하만 전송할 수 있습니다.");
            }
            CredentialMode mode = CredentialMode.valueOf(required(form, "credentialMode")
                    .toUpperCase(Locale.ROOT));
            if (mode == CredentialMode.ORIGINAL) {
                throw new IllegalArgumentException("Repeater는 현재 세션 또는 비로그인 모드만 지원합니다.");
            }
            String accountId = form.getOrDefault("accountId", "").trim();
            if (mode == CredentialMode.ACCOUNT && accountId.isBlank()) {
                throw new IllegalArgumentException("등록 계정 모드에는 계정 선택이 필요합니다.");
            }
            RequestRecord record = state.openInRepeater(required(form, "eventId"), rawRequest, mode, accountId);
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("status", record.status);
            body.put("message", "선택한 요청을 Burp Repeater 초안으로 열었습니다. 자동 전송하지 않았습니다.");
            body.put("replayId", "");
            body.put("openedDraft", true);
            return json(200, body);
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response requestLab(LoopbackHttpServer.Request request, URI target) throws IOException {
        try {
            if (request.method().equals("GET")) {
                RequestLabDraft draft = state.requestLabDraft(required(form(target.getRawQuery()), "eventId"));
                ObjectNode body = json.createObjectNode();
                body.put("eventId", draft.eventId());
                body.put("service", draft.service());
                putNullable(body, "request", draft.request());
                putNullable(body, "response", draft.response());
                body.put("rawRequestRetained", draft.rawRequestRetained());
                body.put("rawResponseRetained", draft.rawResponseRetained());
                body.put("requestEditable", draft.requestEditable());
                putNullable(body, "requestCharset", draft.requestCharset());
                putNullable(body, "responseCharset", draft.responseCharset());
                body.put("observedIdentity", draft.observedIdentity());
                body.put("reusableSession", draft.reusableSession());
                body.put("reusableAccountId", draft.reusableAccountId());
                body.put("message", draft.message());
                return json(200, body);
            }
            Map<String, String> values = postForm(request);
            if (values == null) return invalidForm(request);
            if (!"send".equalsIgnoreCase(required(values, "action"))) {
                throw new IllegalArgumentException("action은 send여야 합니다.");
            }
            String rawRequest = requiredRaw(values, "request");
            if (rawRequest.getBytes(StandardCharsets.UTF_8).length > REQUEST_LAB_REQUEST_LIMIT) {
                throw new IllegalArgumentException("편집 요청은 1MB 이하만 전송할 수 있습니다.");
            }
            CredentialMode mode = CredentialMode.valueOf(required(values, "credentialMode")
                    .toUpperCase(Locale.ROOT));
            String accountId = values.getOrDefault("accountId", "").trim();
            if (mode == CredentialMode.ACCOUNT && accountId.isBlank()) {
                throw new IllegalArgumentException("등록 계정 모드에는 계정 선택이 필요합니다.");
            }
            String eventId = required(values, "eventId");
            String operationId = required(values, "operationId");
            if (!operationId.matches("[A-Za-z0-9_-]{16,120}")) {
                throw new IllegalArgumentException("operationId 형식이 올바르지 않습니다.");
            }
            RequestLabResult result = executeRequestLabOnce(operationId, eventId, rawRequest, mode, accountId);
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("eventId", result.eventId());
            body.put("status", result.status());
            body.put("response", result.response());
            body.put("durationMs", result.durationMs());
            body.put("requestBytes", result.requestBytes());
            body.put("responseBytes", result.responseBytes());
            body.put("message", "응답을 받았으며 HUMAN 검증 Evidence로 분리 기록했습니다.");
            return json(200, body);
        } catch (IllegalArgumentException | IllegalStateException | UnsupportedOperationException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response authorizationReplay(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            return liveAuthorizationReplay(state.liveAuthorizationReplayStatus(),
                    "라이브 교차 재전송 상태입니다.");
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = form.getOrDefault("action", "run").trim().toLowerCase(Locale.ROOT);
            if (action.equals("start-live")) {
                return liveAuthorizationReplay(state.startLiveAuthorizationReplay(
                        commaSeparated(form.get("accounts")),
                        Boolean.parseBoolean(form.getOrDefault("anonymous", "false")),
                        replaySources(form.get("sources")),
                        Boolean.parseBoolean(form.getOrDefault("armed", "false"))),
                        "라이브 교차 재전송을 시작했습니다.");
            }
            if (action.equals("stop-live")) {
                return liveAuthorizationReplay(state.stopLiveAuthorizationReplay(),
                        "라이브 교차 재전송을 중지했습니다.");
            }
            if (action.equals("kill")) {
                state.killAuthorizationReplay();
                return success("현재 안전 재전송 런에 중지 요청을 적용했습니다.");
            }
            if (action.equals("draft")) {
                return success(state.draftAuthorizationReplay(required(form, "itemId")));
            }
            if (!action.equals("run")) throw new IllegalArgumentException("지원하지 않는 재전송 동작입니다.");
            boolean armed = Boolean.parseBoolean(form.getOrDefault("armed", "false"));
            CrossIdentityReplayOrchestrator.RunResult result = state.runAuthorizationReplay(
                    required(form, "itemId"), armed);
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("message", result.sent() > 0
                    ? "안전 재전송 응답을 CONTROLLED Evidence로 기록했습니다."
                    : result.drafted() > 0
                    ? "상태 변경 요청을 Burp Repeater 초안으로 열었습니다. 자동 전송하지 않았습니다."
                    : "자동 전송 없이 재전송 런을 종료했습니다.");
            ObjectNode run = body.putObject("run");
            run.put("runId", result.runId());
            run.put("armed", result.armed());
            run.put("sent", result.sent());
            run.put("drafted", result.drafted());
            run.put("skipped", result.skipped());
            var items = run.putArray("items");
            for (CrossIdentityReplayOrchestrator.Item item : result.items()) {
                ObjectNode value = items.addObject();
                value.put("operation", item.operation());
                value.put("targetIdentity", item.targetIdentity());
                value.put("basisIdentity", item.basisIdentity());
                value.put("basisEvidenceId", item.basisEvidenceId());
                value.put("outcome", item.outcome().name());
                value.put("reason", item.reason());
            }
            return json(200, body);
        } catch (RuntimeException error) {
            return error(error instanceof IllegalStateException ? 409 : 400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response liveAuthorizationReplay(
            LiveCrossIdentityReplayCoordinator.Snapshot status, String message) throws IOException {
        ObjectNode body = json.createObjectNode();
        body.put("success", true);
        body.put("message", message);
        ObjectNode live = body.putObject("live");
        live.put("runId", status.runId());
        live.put("state", status.state().name());
        live.put("armed", status.armed());
        var targets = live.putArray("targetAccountIds");
        status.targetAccountIds().forEach(targets::add);
        live.put("includeAnonymous", status.includeAnonymous());
        var basisSources = live.putArray("basisSources");
        status.basisSources().forEach(source -> basisSources.add(source.name()));
        live.put("observed", status.observed());
        live.put("eligible", status.eligible());
        live.put("queued", status.queued());
        live.put("sent", status.sent());
        live.put("drafted", status.drafted());
        live.put("skipped", status.skipped());
        live.put("lastReason", status.lastReason());
        return json(200, body);
    }

    private static List<String> commaSeparated(String value) {
        if (value == null || value.isBlank()) return List.of();
        return java.util.Arrays.stream(value.split(","))
                .map(String::trim).filter(item -> !item.isBlank()).distinct().toList();
    }

    private static List<Source> replaySources(String value) {
        if (value == null) return List.of(Source.HUMAN);
        List<Source> sources = commaSeparated(value).stream().map(item -> {
            String normalized = item.equalsIgnoreCase("ZAP") ? "SCANNER" : item.toUpperCase(Locale.ROOT);
            try {
                Source source = Source.valueOf(normalized);
                if (source != Source.HUMAN && source != Source.SCANNER && source != Source.LLM) {
                    throw new IllegalArgumentException("지원하지 않는 기준 요청 출처입니다: " + item);
                }
                return source;
            }
            catch (IllegalArgumentException error) {
                throw new IllegalArgumentException("지원하지 않는 기준 요청 출처입니다: " + item);
            }
        }).distinct().toList();
        if (sources.isEmpty()) throw new IllegalArgumentException("기준 요청 출처를 하나 이상 선택하세요.");
        return sources;
    }

    private RequestLabResult executeRequestLabOnce(String operationId, String eventId, String request,
                                                   CredentialMode mode, String accountId) {
        String signature = requestLabSignature(eventId, request, mode.name(), accountId);
        RequestLabOperation proposed = new RequestLabOperation(signature, new CompletableFuture<>());
        RequestLabOperation operation = requestLabOperations.putIfAbsent(operationId, proposed);
        if (operation == null) {
            try {
                RequestLabResult result = state.sendRequestLab(eventId, request, mode, accountId);
                proposed.result().complete(result);
                RequestLabResult compact = new RequestLabResult(result.eventId(), result.status(),
                        "동일 operationId의 중복 전송을 차단하고 최초 실행 결과를 재사용했습니다.",
                        result.durationMs(), result.requestBytes(), result.responseBytes());
                requestLabOperations.replace(operationId, proposed,
                        new RequestLabOperation(signature, CompletableFuture.completedFuture(compact)));
                requestLabOperationOrder.addLast(operationId);
                trimRequestLabOperations();
                return result;
            } catch (RuntimeException error) {
                proposed.result().completeExceptionally(error);
                requestLabOperations.remove(operationId, proposed);
                throw error;
            }
        }
        if (!operation.signature().equals(signature)) {
            throw new IllegalArgumentException("같은 operationId에 다른 요청을 사용할 수 없습니다.");
        }
        try {
            return operation.result().join();
        } catch (CompletionException error) {
            if (error.getCause() instanceof RuntimeException runtime) throw runtime;
            throw error;
        }
    }

    private void trimRequestLabOperations() {
        while (requestLabOperations.size() > REQUEST_LAB_OPERATION_LIMIT) {
            String oldest = requestLabOperationOrder.pollFirst();
            if (oldest == null) return;
            RequestLabOperation operation = requestLabOperations.get(oldest);
            if (operation != null && operation.result().isDone()) requestLabOperations.remove(oldest, operation);
        }
    }

    private static String requestLabSignature(String... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                byte[] bytes = (value == null ? "" : value).getBytes(StandardCharsets.UTF_8);
                digest.update((byte) (bytes.length >>> 24));
                digest.update((byte) (bytes.length >>> 16));
                digest.update((byte) (bytes.length >>> 8));
                digest.update((byte) bytes.length);
                digest.update(bytes);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private record RequestLabOperation(String signature, CompletableFuture<RequestLabResult> result) {}

    private static void putNullable(ObjectNode node, String name, String value) {
        if (value == null) node.putNull(name);
        else node.put(name, value);
    }

    private LoopbackHttpServer.Response clear(LoopbackHttpServer.Request request) throws IOException {
        if (postForm(request) == null) return invalidForm(request);
        return error(409, "Evidence 삭제형 초기화는 지원하지 않습니다. 새 진단 시작으로 현재 프로젝트를 보존하세요.");
    }

    private LoopbackHttpServer.Response projects(LoopbackHttpServer.Request request) throws IOException {
        try {
            if (request.method().equals("GET")) return projectStatus(state.projectStatus());
            Map<String, String> form = postForm(request);
            if (form == null) return invalidForm(request);
            String action = required(form, "action").toLowerCase(Locale.ROOT);
            ProjectWorkspace.Status status = switch (action) {
                case "start" -> state.startProject(form.getOrDefault("name", ""), required(form, "scope"));
                case "open" -> state.openProject(required(form, "id"));
                case "reset" -> state.resetProjectTraffic();
                case "delete" -> state.deleteProject(required(form, "id"));
                default -> throw new IllegalArgumentException("지원하지 않는 프로젝트 작업입니다.");
            };
            return projectStatus(status);
        } catch (UnsupportedOperationException error) {
            return error(501, error.getMessage());
        } catch (IllegalStateException error) {
            return error(409, error.getMessage());
        } catch (IllegalArgumentException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response projectStatus(ProjectWorkspace.Status status) throws IOException {
        ObjectNode body = json.createObjectNode();
        body.put("directory", status.directory());
        body.put("saveState", status.saveState());
        body.put("lastSavedAt", status.lastSavedAt());
        body.put("saveError", Masking.maskSecrets(status.saveError()));
        if (status.active() == null) body.putNull("active");
        else body.set("active", projectEntry(status.active()));
        var projects = body.putArray("projects");
        status.projects().forEach(entry -> projects.add(projectEntry(entry)));
        return json(200, body);
    }

    private ObjectNode projectEntry(ProjectWorkspace.Entry entry) {
        ObjectNode body = json.createObjectNode();
        body.put("id", entry.id());
        body.put("name", entry.name());
        body.set("scope", json.valueToTree(entry.scope()));
        body.put("createdAt", entry.createdAt());
        body.put("modifiedAtMillis", entry.modifiedAtMillis());
        body.put("sizeBytes", entry.sizeBytes());
        body.put("active", entry.active());
        body.put("readable", entry.readable());
        body.put("managed", entry.managed());
        return body;
    }

    private LoopbackHttpServer.Response humanRun(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) return humanRunState();
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = required(form, "action").toLowerCase(Locale.ROOT);
            if (action.equals("begin")) {
                String runId = validatedRunId(form.getOrDefault("runId", "human-" + System.currentTimeMillis()));
                String accountId = form.getOrDefault("account", "").trim();
                if (!accountId.isBlank()) {
                    state.config().account(accountId)
                            .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 HUMAN 계정입니다."));
                    SessionBroker broker = state.sessions();
                    if (broker == null) throw new IllegalStateException("세션 브로커를 사용할 수 없습니다.");
                    SessionBroker.SessionView session = broker.viewForAccount(accountId)
                            .orElseThrow(() -> new IllegalArgumentException("HUMAN 계정의 로그인 세션을 먼저 캡처하세요."));
                    if (session.status() != SessionBroker.Status.ACTIVE) {
                        throw new IllegalStateException("HUMAN 계정 세션이 ACTIVE가 아닙니다: " + session.status());
                    }
                }
                state.contexts().activate(Source.HUMAN, new RunContextRegistry.Context(SourceDetail.BROWSER,
                        Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, runId,
                        accountId.isBlank() ? null : accountId));
                state.humanRunStarted(runId);
            } else if (action.equals("end")) {
                String runId = validatedRunId(required(form, "runId"));
                LaneCompletionPolicy.complete(state.contexts(), Source.HUMAN, runId,
                        state.completionSnapshot());
            } else {
                throw new IllegalArgumentException("action은 begin 또는 end여야 합니다.");
            }
            return humanRunState();
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response humanRunState() throws IOException {
        RunContextRegistry.Context context = state.contexts().current(Source.HUMAN);
        ObjectNode body = json.createObjectNode();
        body.put("active", context != null);
        body.put("completed", state.contexts().completedExplorations().contains(Source.HUMAN));
        body.put("runId", context == null ? "" : context.runId());
        body.put("accountId", context == null || context.accountId() == null ? "" : context.accountId());
        int port = context == null ? -1 : state.humanListenerPort(context.runId());
        body.put("proxy", port > 0 ? "http://127.0.0.1:" + port : "실제 리스너 감지 대기");
        body.put("listenerPort", port);
        body.put("otherListenerPort", context == null ? -1 : state.otherHumanListenerPort(context.runId()));
        body.put("otherListenerRequests", context == null ? 0 : state.otherHumanListenerRequests(context.runId()));
        return json(200, body);
    }

    private static String validatedRunId(String value) {
        String runId = value == null ? "" : value.trim();
        if (!runId.matches("[A-Za-z0-9._:-]{1,120}")) {
            throw new IllegalArgumentException("runId는 영문·숫자와 ._:-만 사용해 120자 이하로 입력하세요.");
        }
        return runId;
    }

    private LoopbackHttpServer.Response sample(LoopbackHttpServer.Request request) throws IOException {
        if (postForm(request) == null) return invalidForm(request);
        state.loadSample();
        return success("네트워크 요청 없이 FlowScope 샘플 프로젝트를 열었습니다.");
    }

    private LoopbackHttpServer.Response role(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            state.config().withIdentityRole(required(form, "identity"), parseRole(form.get("role")));
            state.rebuild();
            return success("권한을 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response requirement(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            state.config().withEndpointRequirement(required(form, "operation"), parseRole(form.get("role")));
            state.rebuild();
            return success("엔드포인트 요구 권한을 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response resourcePolicy(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            // operation+resource를 주면 그 쌍에만 적용한다. 키 형식은 서버 한 곳(AnalysisConfig)에서 만든다.
            String operation = form.getOrDefault("operation", "").trim();
            String resource = form.getOrDefault("resource", "").trim();
            String target = !operation.isEmpty() && !resource.isEmpty()
                    ? AnalysisConfig.operationObjectPolicyKey(operation, resource) : required(form, "target");
            ResourcePolicy policy = ResourcePolicy.valueOf(required(form, "policy").toUpperCase(Locale.ROOT));
            state.config().withResourcePolicy(target, policy);
            state.rebuild();
            return success(policy == ResourcePolicy.UNKNOWN
                    ? "객체 정책을 미정으로 되돌렸습니다." : "객체 접근 정책을 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response review(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String itemId = required(form, "itemId");
            List<String> evidenceIds = evidenceForReview(itemId);
            List<String> validationIds = reviewValidation(itemId, evidenceIds, form.getOrDefault("validationEvidenceIds", ""));
            ReviewDecision.Status status;
            try { status = ReviewDecision.Status.valueOf(required(form, "status").toUpperCase(Locale.ROOT)); }
            catch (IllegalArgumentException error) { throw new IllegalArgumentException("지원하지 않는 최종 판정입니다."); }
            state.config().reviewItem(itemId, status, form.getOrDefault("note", ""), evidenceIds);
            bindReviewPolicy(itemId, evidenceIds);
            state.config().attachReviewValidation(itemId, validationIds);
            state.rebuild();
            return success("Evidence에 묶인 사람 감사·오버라이드 기록을 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    /** 검토 대상의 Evidence는 서버가 정한다: 규칙 후보(finding) 또는 판정 매트릭스 cell(대상+기준 Evidence). 클라이언트 목록은 받지 않는다. */
    private List<String> evidenceForReview(String itemId) {
        return state.snapshot().analysis.findings().stream().filter(finding -> finding.id().equals(itemId))
                .map(finding -> finding.evidenceIds()).findFirst()
                .or(() -> matrixReviewEvidence(itemId))
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 후보입니다."));
    }

    private java.util.Optional<List<String>> matrixReviewEvidence(String itemId) {
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(state.snapshot(), state.config(), state.validations());
        return java.util.stream.Stream.concat(
                        matrix.functions().stream().filter(cell -> cell.id().equals(itemId)).map(AuthorizationMatrix.FunctionCell::reviewEvidenceIds),
                        matrix.objects().stream().filter(cell -> cell.id().equals(itemId)).map(AuthorizationMatrix.ObjectCell::reviewEvidenceIds))
                .findFirst();
    }

    private void bindReviewPolicy(String itemId, List<String> evidenceIds) {
        state.snapshot().records.stream().filter(record -> evidenceIds.contains(record.evidenceId))
                .forEach(record -> state.config().bindReviewPolicy(itemId, record.idn, record.op, record.resource));
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(state.snapshot(), state.config(), state.validations());
        matrix.functions().stream().filter(cell -> cell.id().equals(itemId)).forEach(cell ->
                state.config().bindReviewPolicy(itemId, cell.identity(), cell.operation(), null));
        matrix.objects().stream().filter(cell -> cell.id().equals(itemId)).forEach(cell ->
                state.config().bindReviewPolicy(itemId, cell.identity(), cell.operation(), cell.resource()));
    }

    /** Attach only explicitly selected, stored manual responses for this exact matrix target. */
    private List<String> reviewValidation(String itemId, List<String> basisIds, String requested) {
        if (requested.isBlank()) return List.of();
        List<String> ids = requested.lines().filter(id -> !id.isBlank()).distinct().toList();
        if (ids.size() > 20) throw new IllegalArgumentException("검증 Evidence는 최대 20건까지 연결할 수 있습니다.");
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(state.snapshot(), state.config(), state.validations());
        for (String id : ids) {
            RequestRecord record = state.snapshot().records.stream().filter(value -> id.equals(value.evidenceId))
                    .findFirst().orElseThrow(() -> new IllegalArgumentException("저장된 검증 Evidence가 아닙니다."));
            boolean target = matrix.functions().stream().anyMatch(cell -> cell.id().equals(itemId)
                    && cell.identity().equals(record.idn) && cell.operation().equals(record.op))
                    || matrix.objects().stream().anyMatch(cell -> cell.id().equals(itemId)
                    && cell.identity().equals(record.idn) && cell.operation().equals(record.op)
                    && cell.resource().equals(record.resource));
            if (!target || record.source != io.flowscope.core.Source.HUMAN
                    || record.phase != io.flowscope.core.RunPhase.VALIDATION
                    || record.executionTrust != io.flowscope.core.ExecutionTrust.CONTROLLED
                    || !record.hasResponse || !basisIds.contains(record.originEvidenceId)) {
                throw new IllegalArgumentException("선택 판정 대상·기준 요청에 연결된 수동 검증 결과만 첨부할 수 있습니다.");
            }
        }
        return ids;
    }

    private LoopbackHttpServer.Response identityMerge(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String from = required(form, "from");
            String into = required(form, "into");
            if (from.equals(into)) throw new IllegalArgumentException("서로 다른 두 신원을 선택하세요.");
            AccountProfile target = state.config().account(into)
                    .orElseThrow(() -> new IllegalArgumentException("유지할 대상을 먼저 테스트 계정으로 등록하세요."));
            List<RequestRecord> matching = state.snapshot().records.stream().filter(r -> from.equals(r.idn))
                    .filter(r -> target.service().equals(r.service)).toList();
            if (matching.isEmpty()) throw new IllegalArgumentException("같은 대상 서비스에서 병합할 세션이 없습니다.");
            matching.forEach(record -> state.config().bindSession(record.service, record.fp, target.id()));
            state.rebuild();
            return success(from + "의 세션을 " + target.label() + "에 연결했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response accountSave(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String label = required(form, "label");
            String service = normalizeService(required(form, "target"));
            String id = form.getOrDefault("id", "").trim();
            if (id.isBlank()) id = uniqueAccountId(label);
            state.config().upsertAccount(new AccountProfile(id, label, service, parseRole(form.get("role"))));
            state.rebuild();
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("id", id);
            body.put("rebound", 0);
            body.put("message", "계정을 저장했습니다. 로그인 연결을 눌러 HUMAN 8080 브라우저에서 로그인하세요.");
            return json(200, body);
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response accountSettings(LoopbackHttpServer.Request request, URI target) throws IOException {
        try {
            if (request.method().equals("GET")) {
                String accountId = required(form(target.getRawQuery()), "account");
                return json(200, accountSettingsBody(accountId));
            }
            Map<String, String> values = postForm(request);
            if (values == null) return invalidForm(request);
            String accountId = required(values, "account");
            AccountProfile account = state.config().account(accountId)
                    .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 계정입니다."));
            String action = required(values, "action").toLowerCase(Locale.ROOT);
            if (action.equals("save-proof")) {
                String method = values.getOrDefault("method", "").trim();
                String path = values.getOrDefault("path", "").trim();
                String subject = values.getOrDefault("subject", "").trim();
                if (method.isBlank() && path.isBlank() && subject.isBlank()) {
                    state.config().removeAccountVerificationRule(accountId);
                } else {
                    state.config().withAccountVerificationRule(new AccountVerificationRule(
                            accountId, method, account.service(), path, subject));
                }
                state.rebuild();
            } else if (action.equals("link-candidate")) {
                state.linkAccountRequestCandidate(accountId, required(values, "candidate"));
            } else {
                throw new IllegalArgumentException("지원하지 않는 계정 설정 동작입니다.");
            }
            return json(200, accountSettingsBody(accountId));
        } catch (UnsupportedOperationException error) {
            return error(501, error.getMessage());
        } catch (IllegalStateException error) {
            return error(409, error.getMessage());
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private ObjectNode accountSettingsBody(String accountId) {
        AccountProfile account = state.config().account(accountId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 계정입니다."));
        ObjectNode body = json.createObjectNode();
        body.put("id", account.id());
        body.put("label", account.label());
        body.put("role", account.role().label());
        body.put("target", account.service());

        SessionBroker.SessionView session = state.sessions() == null ? null
                : state.sessions().viewForAccount(accountId).orElse(null);
        ObjectNode human = body.putObject("human");
        human.put("status", session == null ? "UNVERIFIED" : session.status().name());
        human.put("verificationSource", session == null ? "NONE" : session.verificationSource().name());
        human.put("lastCheckedLabel", session == null ? "기록 없음"
                : (session.lastUsedAt() == null ? session.createdAt() : session.lastUsedAt()).toString());
        human.put("credentialConflict", session != null && session.credentialConflict());

        ObjectNode proof = body.putObject("proofRule");
        AccountVerificationRule rule = state.config().verificationRule(accountId).orElse(null);
        proof.put("method", rule == null ? "GET" : rule.method());
        proof.put("path", rule == null ? "" : rule.path());
        proof.put("responseMark", rule == null ? "" : rule.expectedSubject());
        List<AccountRequestCandidate> candidates = state.accountRequestCandidates(accountId);
        body.set("candidates", json.valueToTree(candidates));
        var reasons = body.putArray("candidateBlockReasons");
        if (candidates.isEmpty()) {
            reasons.add("같은 대상 서비스에서 자격이 포함된 HUMAN 응답을 먼저 관측하세요.");
        }

        ZapAccountVault.View zap = state.zapAccounts().stream().filter(value -> value.id().equals(accountId))
                .findFirst().orElse(null);
        ObjectNode zapNode = body.putObject("zap");
        zapNode.put("enabled", zap != null);
        zapNode.put("status", zap == null ? "UNVERIFIED" : zap.status().name());
        zapNode.put("loginUrl", zap == null ? "" : zap.loginUrl());
        zapNode.put("loginId", "");
        zapNode.put("hasPassword", zap != null && zap.hasPassword());
        zapNode.put("connectionLabel", state.zapStatus().path("message").asText(""));
        zapNode.put("failureReason", zap == null ? "" : zap.message());

        ExplorerAccountVault.View explorer = state.explorerAccounts().stream()
                .filter(value -> value.id().equals(accountId)).findFirst().orElse(null);
        ObjectNode llm = body.putObject("llm");
        llm.put("enabled", explorer != null);
        llm.put("status", explorer == null ? "UNVERIFIED" : explorer.status().name());
        llm.put("loginMode", explorer != null && explorer.loginMode() == ExplorerAccountVault.LoginMode.JSON
                ? "JSON_API" : "HTML_FORM");
        llm.put("loginUrl", explorer == null ? "" : explorer.loginUrl());
        llm.put("loginId", "");
        llm.put("hasPassword", explorer != null && explorer.hasPassword());
        llm.put("failureReason", explorer == null ? "" : explorer.message());
        ObjectNode advanced = llm.putObject("advanced");
        advanced.put("idField", "");
        advanced.put("passwordField", "");
        advanced.put("tokenJsonPath", "");
        advanced.put("authHeaderName", "");
        advanced.put("authPrefix", "");
        advanced.put("validationUrl", explorer == null || explorer.validationUrl() == null ? "" : explorer.validationUrl());
        return body;
    }

    private LoopbackHttpServer.Response accountDelete(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String id = required(form, "id");
            if (state.config().sessionBindings().containsValue(id)) throw new IllegalArgumentException("연결된 세션을 먼저 해제하세요.");
            if (state.config().account(id).isEmpty()) throw new IllegalArgumentException("존재하지 않는 계정입니다.");
            if (state.sessions() != null) state.sessions().viewForAccount(id)
                    .ifPresent(view -> state.sessions().revoke(view.handle()));
            if (state.zapAccounts().stream().anyMatch(account -> account.id().equals(id))) {
                state.removeZapAccount(id);
            }
            if (state.explorerAccounts().stream().anyMatch(account -> account.id().equals(id))) {
                state.removeExplorerAccount(id);
            }
            state.config().removeAccount(id);
            state.rebuild();
            return success("계정을 삭제했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response sessionBind(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String service = normalizeService(required(form, "service"));
            String fingerprint = required(form, "fingerprint");
            String accountId = required(form, "account");
            AccountProfile account = state.config().account(accountId)
                    .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 계정입니다."));
            boolean observed = state.snapshot().records.stream()
                    .anyMatch(record -> fingerprint.equals(record.fp) && service.equals(record.service));
            if (!observed || !service.equals(account.service())) {
                throw new IllegalArgumentException("세션과 계정의 대상 서비스가 일치하지 않습니다.");
            }
            state.config().bindSession(service, fingerprint, account.id());
            state.rebuild();
            return success("선택한 인증 기록을 " + account.label() + " 계정에 연결했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response sessionUnbind(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String service = normalizeService(required(form, "service"));
            String fingerprint = required(form, "fingerprint");
            state.config().unbindSession(service, fingerprint);
            state.rebuild();
            return success("인증 기록의 계정 연결을 해제했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response sessionCapture(LoopbackHttpServer.Request request) throws IOException {
        SessionBroker broker = state.sessions();
        if (broker == null) return error(503, "세션 브로커를 사용할 수 없습니다.");
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("sessions", snapshots.managedSessions(broker.views()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = required(form, "action").toLowerCase(Locale.ROOT);
            String accountId = required(form, "account");
            AccountProfile account = state.config().account(accountId)
                    .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 계정입니다."));
            if (action.equals("begin")) {
                broker.beginCapture(account, java.time.Instant.now());
                state.rebuild();
                return success(account.label() + " 로그인 캡처를 시작했습니다. HUMAN 8080 브라우저에서 로그인하세요.");
            }
            if (action.equals("credential")) {
                // Operator-typed reusable credential (memory only, never persisted/logged/snapshotted).
                broker.registerAssertedSession(account, form.getOrDefault("cookie", ""),
                        form.getOrDefault("authorization", ""), java.time.Instant.now());
                state.rebuild();
                return success(account.label() + " 세션 자격을 메모리에 등록했습니다(ACTIVE · 운영자 확인).");
            }
            String handle = broker.handleForAccount(accountId);
            if (action.equals("end")) {
                broker.endCapture(handle);
                state.rebuild();
                SessionBroker.Status status = broker.viewForAccount(accountId).orElseThrow().status();
                String message = status == SessionBroker.Status.ACTIVE
                        ? account.label() + " 로그인이 연결됐습니다. HUMAN pass와 요청 실험실에서 사용할 수 있습니다."
                        : account.label() + " 로그인 확인이 끝나지 않았습니다. HUMAN 8080에서 다시 로그인하고 "
                        + "인증된 페이지가 열린 뒤 캡처를 종료하세요.";
                return success(message);
            }
            if (action.equals("revoke")) {
                broker.revoke(handle);
                state.rebuild();
                return success(account.label() + " 메모리 세션을 폐기했습니다.");
            }
            throw new IllegalArgumentException("action은 begin, end 또는 revoke여야 합니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response scannerRun(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("run", state.scannerStatus());
            body.set("accounts", json.valueToTree(state.zapAccounts()));
            body.set("scope", json.valueToTree(state.scopeEntries().stream()
                    .filter(entry -> !isOwnControlPlane(entry)).toList()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            if ("cancel".equalsIgnoreCase(form.getOrDefault("action", ""))) {
                ObjectNode body = json.createObjectNode();
                body.set("run", state.cancelScanner());
                return json(200, body);
            }
            String target = required(form, "target");
            if (isOwnControlPlane(target)) {
                throw new IllegalArgumentException("FlowScope Web 제어면은 스캐너 대상이 될 수 없습니다.");
            }
            String rawAccounts = form.getOrDefault("accounts", form.getOrDefault("account", ""));
            List<String> accounts = java.util.Arrays.stream(rawAccounts.split(","))
                    .map(String::trim).filter(value -> !value.isBlank()).distinct().toList();
            boolean anonymous = form.containsKey("anonymous")
                    ? Boolean.parseBoolean(form.get("anonymous")) : accounts.isEmpty();
            if (!anonymous && accounts.isEmpty()) {
                throw new IllegalArgumentException("비로그인 또는 하나 이상의 활성 계정을 선택하세요.");
            }
            ObjectNode body = json.createObjectNode();
            body.set("run", state.startScanner(target, accounts, anonymous,
                    parseZapDefinitions(form.getOrDefault("definitions", ""))));
            return json(202, body);
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    static List<ZapCampaign.ZapDefinition> parseZapDefinitions(String value) {
        if (value == null || value.isBlank()) return List.of();
        List<ZapCampaign.ZapDefinition> definitions = new java.util.ArrayList<>();
        for (String rawLine : value.lines().toList()) {
            String line = rawLine.trim();
            if (line.isBlank()) continue;
            if (definitions.size() >= 20) throw new IllegalArgumentException("API 정의는 최대 20개까지 입력할 수 있습니다.");
            String[] parts = line.split("\\s+", 3);
            ZapCampaign.ZapDefinitionType type;
            try { type = ZapCampaign.ZapDefinitionType.valueOf(parts[0].toUpperCase(Locale.ROOT)); }
            catch (RuntimeException error) {
                throw new IllegalArgumentException("API 정의 형식: OPENAPI|GRAPHQL|POSTMAN|SOAP URL [GraphQL schema URL]");
            }
            if (parts.length < 2) throw new IllegalArgumentException(type + " URL이 필요합니다.");
            if (type == ZapCampaign.ZapDefinitionType.GRAPHQL) {
                definitions.add(new ZapCampaign.ZapDefinition(type, parts.length == 3 ? parts[2] : "", parts[1]));
            } else {
                if (parts.length != 2) throw new IllegalArgumentException(type + "은 URL 하나만 입력합니다.");
                definitions.add(new ZapCampaign.ZapDefinition(type, parts[1], ""));
            }
        }
        return List.copyOf(new java.util.LinkedHashSet<>(definitions));
    }

    private LoopbackHttpServer.Response zapStatus(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        return json(200, state.zapStatus());
    }

    private LoopbackHttpServer.Response zapAccounts(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("accounts", json.valueToTree(state.zapAccounts()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            if ("RUNNING".equals(state.scannerStatus().path("status").asText())) {
                throw new IllegalStateException("실행 중인 ZAP 캠페인을 종료한 뒤 계정을 변경하세요.");
            }
            String action = form.getOrDefault("action", "save").trim().toLowerCase(Locale.ROOT);
            if (action.equals("delete")) {
                state.removeZapAccount(required(form, "id"));
                return success("ZAP 로그인 계정의 메모리 자격증명을 폐기했습니다.");
            }
            if (action.equals("refresh-session")) {
                return json(202, state.refreshAccountSession(required(form, "id")));
            }
            if (!action.equals("save")) {
                throw new IllegalArgumentException("action은 save, refresh-session 또는 delete여야 합니다.");
            }
            ZapAccountVault.View saved = state.saveZapAccount(new ZapAccountVault.Input(
                    form.getOrDefault("id", ""), required(form, "label"),
                    form.getOrDefault("role", "UNKNOWN"), required(form, "service"),
                    required(form, "loginUrl"), requiredRaw(form, "username"), requiredRaw(form, "password"),
                    form.getOrDefault("loggedInIndicator", ""),
                    form.getOrDefault("loggedOutIndicator", "")));
            ObjectNode body = json.createObjectNode().put("success", true)
                    .put("message", "ZAP 로그인 계정을 현재 프로세스 메모리에 등록했습니다.");
            body.set("account", json.valueToTree(saved));
            return json(200, body);
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response explorerRun(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("run", explorerSnapshot(state.explorerStatus()));
            body.set("accounts", json.valueToTree(state.explorerAccounts()));
            body.set("scope", json.valueToTree(state.scopeEntries()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = form.getOrDefault("action", "start").trim().toLowerCase(Locale.ROOT);
            ExplorerCoordinator.Snapshot snapshot;
            int status = 200;
            switch (action) {
                case "start" -> {
                    String target = required(form, "target");
                    if (isOwnControlPlane(target)) throw new IllegalArgumentException("FlowScope 제어면은 Explorer 대상이 될 수 없습니다.");
                    List<String> accounts = java.util.Arrays.stream(form.getOrDefault("accounts", "").split(","))
                            .map(String::trim).filter(value -> !value.isBlank()).distinct().toList();
                    boolean anonymous = Boolean.parseBoolean(form.getOrDefault("anonymous", "true"));
                    snapshot = state.startExplorer(new ExplorerCoordinator.StartRequest(target, accounts, anonymous));
                    status = 202;
                }
                case "steer" -> snapshot = state.steerExplorer(required(form, "message"));
                case "cancel" -> snapshot = state.cancelExplorer();
                case "clear" -> snapshot = state.clearExplorer();
                case "recheck" -> snapshot = state.recheckExplorerProvider();
                default -> throw new IllegalArgumentException("지원하지 않는 Explorer 동작입니다.");
            }
            ObjectNode body = json.createObjectNode();
            body.set("run", explorerSnapshot(snapshot));
            return json(status, body);
        } catch (RuntimeException error) {
            return error(error instanceof IllegalStateException ? 409 : 400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response explorerAccounts(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("accounts", json.valueToTree(state.explorerAccounts()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = form.getOrDefault("action", "save").trim().toLowerCase(Locale.ROOT);
            if (action.equals("delete")) {
                state.removeExplorerAccount(required(form, "id"));
                return success("Explorer 메모리 계정과 인증값을 폐기했습니다.");
            }
            if (action.equals("verify")) {
                ObjectNode body = json.createObjectNode().put("success", true)
                        .put("message", "Explorer 로그인을 확인했습니다.");
                body.set("account", json.valueToTree(state.verifyExplorerAccount(required(form, "id"))));
                return json(200, body);
            }
            if (!action.equals("save")) throw new IllegalArgumentException("지원하지 않는 계정 동작입니다.");
            ExplorerAccountVault.LoginMode mode;
            try { mode = ExplorerAccountVault.LoginMode.valueOf(
                    form.getOrDefault("loginMode", "AUTO_FORM").toUpperCase(Locale.ROOT)); }
            catch (RuntimeException error) { throw new IllegalArgumentException("로그인 방식은 AUTO_FORM 또는 JSON이어야 합니다."); }
            ExplorerAccountVault.View account = state.saveExplorerAccount(new ExplorerAccountVault.Input(
                    form.getOrDefault("id", ""), required(form, "label"), form.getOrDefault("role", "UNKNOWN"),
                    required(form, "loginUrl"), required(form, "username"), required(form, "password"), mode,
                    form.getOrDefault("usernameField", ""), form.getOrDefault("passwordField", ""),
                    form.getOrDefault("tokenJsonPath", ""), form.getOrDefault("authHeader", ""),
                    form.getOrDefault("authPrefix", ""), form.getOrDefault("validationUrl", "")));
            ObjectNode body = json.createObjectNode().put("success", true)
                    .put("message", "Explorer 계정을 현재 프로세스 메모리에 등록했습니다.");
            body.set("account", json.valueToTree(account));
            return json(200, body);
        } catch (RuntimeException error) {
            return error(error instanceof IllegalStateException ? 409 : 400, error.getMessage());
        }
    }

    private ObjectNode explorerSnapshot(ExplorerCoordinator.Snapshot value) {
        ObjectNode body = json.createObjectNode();
        body.put("status", value.status().name());
        body.put("runId", value.runId());
        body.put("target", value.target());
        if (value.startedAt() == null) body.putNull("startedAt");
        else body.put("startedAt", value.startedAt().toString());
        if (value.endedAt() == null) body.putNull("endedAt");
        else body.put("endedAt", value.endedAt().toString());
        body.put("elapsedMillis", value.elapsedMillis());
        body.put("message", value.message());
        body.put("providerReadiness", value.providerReadiness());
        body.set("accountIds", json.valueToTree(value.accountIds()));
        body.put("anonymous", value.anonymous());
        body.put("attempts", value.attempts());
        body.put("responses", value.responses());
        body.put("endpointDeclarations", value.endpointDeclarations());
        body.put("parameterDeclarations", value.parameterDeclarations());
        body.put("capabilityProbes", value.capabilityProbes());
        body.set("unresolved", json.valueToTree(value.unresolved()));
        var activities = body.putArray("activities");
        value.activities().forEach(activity -> {
            ObjectNode item = activities.addObject();
            item.put("sequence", activity.sequence());
            item.put("at", activity.at().toString());
            item.put("kind", activity.kind());
            item.put("title", activity.title());
            item.put("detail", activity.detail());
            item.put("status", activity.status());
            if (activity.durationMillis() == null) item.putNull("durationMillis");
            else item.put("durationMillis", activity.durationMillis());
        });
        return body;
    }

    private boolean isOwnControlPlane(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (host != null && host.startsWith("[") && host.endsWith("]")) {
                host = host.substring(1, host.length() - 1);
            }
            int targetPort = uri.getPort() >= 0 ? uri.getPort()
                    : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
            return targetPort == port() && host != null && (host.equalsIgnoreCase("localhost")
                    || host.equals("127.0.0.1") || host.equals("::1"));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private LoopbackHttpServer.Response identityReset(LoopbackHttpServer.Request request) throws IOException {
        if (postForm(request) == null) return invalidForm(request);
        if (state.sessions() != null) state.sessions().close();
        state.config().clearSessionBindings();
        state.rebuild();
        return success("계정 카드와 Evidence는 유지하고 메모리 세션과 신원 매핑만 초기화했습니다.");
    }

    private LoopbackHttpServer.Response importXml(LoopbackHttpServer.Request request, URI target) throws IOException {
        if (!request.method().equals("POST")) return method("POST");
        try {
            Map<String, String> query = form(target.getRawQuery());
            Source source = switch (query.getOrDefault("source", "").toLowerCase(Locale.ROOT)) {
                case "human" -> Source.HUMAN;
                case "scanner" -> Source.SCANNER;
                case "llm" -> Source.LLM;
                default -> throw new IllegalArgumentException("Human, Scanner, LLM 소스 중 하나를 선택하세요.");
            };
            BurpXmlParser.ParseResult result = state.importXml(request.body(), source);
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("imported", result.records.size());
            body.put("candidates", result.records.stream().filter(record -> !record.hasResponse).count());
            body.put("failed", result.skipped.size());
            return json(200, body);
        } catch (Exception error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response importHar(LoopbackHttpServer.Request request, URI target) throws IOException {
        if (!request.method().equals("POST")) return method("POST");
        try {
            Map<String, String> query = form(target.getRawQuery());
            if (!"scanner".equalsIgnoreCase(query.getOrDefault("source", ""))) {
                throw new IllegalArgumentException("HAR 가져오기는 SCANNER 소스에서만 사용할 수 있습니다.");
            }
            BurpXmlParser.ParseResult result = state.importHar(request.body());
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("imported", result.records.size());
            body.put("candidates", result.records.stream().filter(record -> !record.hasResponse).count());
            body.put("failed", result.skipped.size());
            return json(200, body);
        } catch (Exception error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response owner(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String resource = required(form, "resource");
            String identity = form.getOrDefault("identity", "").trim();
            if (!identity.isEmpty()) {
                RequestRecord target = state.snapshot().records.stream().filter(record -> resource.equals(record.resource)
                                || record.resourceReferences.stream().anyMatch(reference -> resource.equals(reference.resource())))
                        .findFirst().orElseThrow(() -> new IllegalArgumentException("관측된 리소스를 선택하세요."));
                boolean sameService = state.config().account(identity).map(account -> account.service().equals(target.service))
                        .orElseGet(() -> state.snapshot().records.stream().anyMatch(record -> identity.equals(record.idn)
                                && target.service.equals(record.service) && record.authState != io.flowscope.core.AuthState.UNRESOLVED
                                && record.authState != io.flowscope.core.AuthState.ANONYMOUS));
                if (!sameService) throw new IllegalArgumentException("같은 서비스의 확인된 계정·신원을 선택하세요.");
            }
            state.config().withResourceOwner(resource, identity);
            state.rebuild();
            return success("소유자를 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response trafficOverride(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String operation = required(form, "operation");
            TrafficOverride value = TrafficOverride.valueOf(required(form, "value").toUpperCase(Locale.ROOT));
            state.config().withTrafficOverride(operation, value);
            state.rebuild();
            return success(value == TrafficOverride.AUTO ? "자동 분류로 복귀했습니다."
                    : value == TrafficOverride.INCLUDE
                    ? "자동 보조 트래픽을 분석에 포함했습니다. discovery 신뢰 경계는 유지됩니다."
                    : "기본 분석에서 숨겼습니다. Evidence는 보존됩니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private Map<String, String> postForm(LoopbackHttpServer.Request request) {
        if (!request.method().equals("POST") || request.body().length > FORM_LIMIT) return null;
        return form(new String(request.body(), StandardCharsets.UTF_8));
    }

    private LoopbackHttpServer.Response invalidForm(LoopbackHttpServer.Request request) throws IOException {
        return !request.method().equals("POST") ? method("POST") : error(413, "요청 본문은 4MB 이하만 허용됩니다.");
    }

    private boolean authorized(LoopbackHttpServer.Request request) {
        String origin = request.header("Origin");
        if (origin != null && !origin.isBlank()) {
            try {
                URI value = URI.create(origin);
                int originPort = value.getPort() < 0 ? 80 : value.getPort();
                if (!"http".equalsIgnoreCase(value.getScheme()) || !isLoopbackHost(value.getHost()) || originPort != port()) return false;
            } catch (RuntimeException error) { return false; }
        }
        String supplied = request.header("X-FlowScope-Token");
        return supplied != null && MessageDigest.isEqual(capabilityToken.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
    }

    private boolean validHost(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            URI host = URI.create("http://" + value);
            return isLoopbackHost(host.getHost()) && (host.getPort() < 0 || host.getPort() == port());
        } catch (RuntimeException error) { return false; }
    }

    private static boolean isLoopbackHost(String value) {
        return value != null && (value.equalsIgnoreCase("localhost") || value.equals("127.0.0.1") || value.equals("::1"));
    }

    private String uniqueAccountId(String label) {
        String base = label.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (base.isBlank()) base = "account";
        String candidate = base;
        int suffix = 2;
        while (state.config().account(candidate).isPresent()) candidate = base + "-" + suffix++;
        return candidate;
    }

    private static String normalizeService(String value) {
        String candidate = value.contains("://") ? value : "https://" + value;
        URI uri = URI.create(candidate);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ((!scheme.equals("http") && !scheme.equals("https")) || uri.getHost() == null
                || (uri.getPath() != null && !uri.getPath().isBlank() && !uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("대상은 http(s)://host[:port] 형식이어야 합니다.");
        }
        int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }

    private static AccessRole parseRole(String value) {
        if (value == null) return AccessRole.UNKNOWN;
        try { return AccessRole.valueOf(value.trim().toUpperCase(Locale.ROOT)); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("지원하지 않는 권한입니다: " + value); }
    }

    private static String required(Map<String, String> form, String key) {
        String value = form.getOrDefault(key, "").trim();
        if (value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return Masking.truncate(Masking.maskSecrets(value), 2_000);
    }

    private static String requiredRaw(Map<String, String> form, String key) {
        String value = form.getOrDefault(key, "");
        if (value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private static Map<String, String> form(String value) {
        Map<String, String> values = new LinkedHashMap<>();
        if (value == null || value.isBlank()) return values;
        for (String pair : value.split("&")) {
            String[] parts = pair.split("=", 2);
            values.put(decode(parts[0]), parts.length == 2 ? decode(parts[1]) : "");
        }
        return values;
    }

    private static String decode(String value) { return URLDecoder.decode(value, StandardCharsets.UTF_8); }

    private LoopbackHttpServer.Response success(String message) throws IOException {
        return json(200, json.createObjectNode().put("success", true).put("message", message));
    }

    private LoopbackHttpServer.Response error(int status, String message) throws IOException {
        return json(status, json.createObjectNode().put("success", false)
                .put("message", message == null || message.isBlank() ? "요청을 처리할 수 없습니다." : message));
    }

    private LoopbackHttpServer.Response json(int status, JsonNode body) throws IOException {
        return response(status, "application/json; charset=utf-8", json.writeValueAsBytes(body));
    }

    private LoopbackHttpServer.Response method(String allowed) {
        return new LoopbackHttpServer.Response(405, headers("text/plain; charset=utf-8", Map.of("Allow", allowed)),
                (allowed + " required").getBytes(StandardCharsets.UTF_8));
    }

    private LoopbackHttpServer.Response response(int status, String type, byte[] body) {
        return new LoopbackHttpServer.Response(status, headers(type, Map.of()), body);
    }

    private static Map<String, String> headers(String contentType, Map<String, String> extra) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("Content-Type", contentType);
        values.put("Cache-Control", "no-store");
        values.put("X-Frame-Options", "DENY");
        values.put("Referrer-Policy", "no-referrer");
        values.put("Cross-Origin-Resource-Policy", "same-origin");
        values.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                + "base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        values.putAll(extra);
        return Map.copyOf(values);
    }

    private static String randomCapabilityToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    @Override public void close() { server.close(); }
}
