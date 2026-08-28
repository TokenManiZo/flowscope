package io.flowscope.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.Masking;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
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
import io.flowscope.integration.LocalLlmRunner;
import io.flowscope.integration.McpServer;
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

/** Burp의 축소 JRE에서도 동작하는 localhost 전용 Web 작업면 서버. */
public final class FlowScopeWebServer implements AutoCloseable {
    public interface State {
        Pipeline.Result snapshot();
        long revision();
        AnalysisConfig config();
        List<McpServer.Assessment> assessments();
        List<ValidationDecision> validations();
        RunContextRegistry contexts();
        void rebuild();
        void clearTraffic();
        void loadSample();
        BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception;
        RequestRecord openInRepeater(String evidenceId);
        default SessionBroker sessions() { return null; }
        default List<String> scopeEntries() { return List.of(); }
        default List<RouteCandidate> routeCandidates() { return List.of(); }
        default long droppedRecords() { return 0; }
        default com.fasterxml.jackson.databind.JsonNode startScanner(String target, List<String> accountIds,
                                                                     boolean includeAnonymous) {
            throw new UnsupportedOperationException("scanner workflow is unavailable");
        }
        default com.fasterxml.jackson.databind.JsonNode scannerStatus() {
            return new ObjectMapper().createObjectNode().put("status", "NOT_STARTED");
        }
        default com.fasterxml.jackson.databind.JsonNode startLlm(LocalLlmRunner.Provider provider,
                                                                  LocalLlmRunner.Role role,
                                                                  String target, String accountId) {
            throw new UnsupportedOperationException("LLM CLI workflow is unavailable");
        }
        default com.fasterxml.jackson.databind.JsonNode llmStatus() {
            return new ObjectMapper().createObjectNode().put("status", "UNAVAILABLE");
        }
        default com.fasterxml.jackson.databind.JsonNode cancelLlm() {
            throw new UnsupportedOperationException("LLM CLI workflow is unavailable");
        }
        default com.fasterxml.jackson.databind.JsonNode followUpJudge(String message) {
            throw new UnsupportedOperationException("Judge continuation is unavailable");
        }
    }

    private static final int FORM_LIMIT = 1024 * 1024;
    private static final int WEB_BODY_LIMIT = 25 * 1024 * 1024;
    private static final int EVIDENCE_PAGE_LIMIT = 200;
    private final State state;
    private final String capabilityToken = randomCapabilityToken();
    private final ObjectMapper json = new ObjectMapper();
    private final SnapshotJsonWriter snapshots = new SnapshotJsonWriter();
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
        catch (RuntimeException error) { return error(400, "잘못된 요청 경로입니다."); }
        String path = target.getPath();
        if (!request.remoteAddress().isLoopbackAddress() || !validHost(request.header("Host"))) {
            return error(403, "localhost 요청만 허용됩니다.");
        }
        if (path.equals("/")) return index(request);
        if (path.equals("/vendor/cytoscape-3.26.0.min.js")) return cytoscape(request);
        if (!path.startsWith("/api/")) return error(404, "Not found");
        if (!authorized(request)) return error(403, "FlowScope 로컬 API 인증에 실패했습니다. UI를 다시 여세요.");
        return switch (path) {
            case "/api/snapshot" -> snapshot(request);
            case "/api/evidence" -> evidence(request, target);
            case "/api/ai-preview" -> preview(request);
            case "/api/ai-scenarios" -> scenarios(request);
            case "/api/replay" -> replay(request);
            case "/api/clear" -> clear(request);
            case "/api/human-run" -> humanRun(request);
            case "/api/sample" -> sample(request);
            case "/api/role" -> role(request);
            case "/api/requirement" -> requirement(request);
            case "/api/review" -> review(request);
            case "/api/traffic-override" -> trafficOverride(request);
            case "/api/identity-merge" -> identityMerge(request);
            case "/api/account-save" -> accountSave(request);
            case "/api/account-delete" -> accountDelete(request);
            case "/api/session-bind" -> sessionBind(request);
            case "/api/session-unbind" -> sessionUnbind(request);
            case "/api/session-capture" -> sessionCapture(request);
            case "/api/scanner-run" -> scannerRun(request);
            case "/api/llm-run" -> llmRun(request);
            case "/api/identity-reset" -> identityReset(request);
            case "/api/import-xml" -> importXml(request, target);
            case "/api/owner" -> owner(request);
            case "/api/verdict", "/api/replay-verdict" -> error(409,
                    "Repeater 결과는 자동 확정하지 않습니다. 새 Evidence를 확인한 뒤 후보 검토에서 판정하세요.");
            default -> error(404, "Not found");
        };
    }

    private LoopbackHttpServer.Response index(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        try (var input = FlowScopeWebServer.class.getResourceAsStream("/web/index.html")) {
            if (input == null) return error(500, "UI resource missing");
            byte[] body = new String(input.readAllBytes(), StandardCharsets.UTF_8)
                    .replace("__FLOWSCOPE_CAPABILITY__", capabilityToken)
                    .getBytes(StandardCharsets.UTF_8);
            return response(200, "text/html; charset=utf-8", body);
        }
    }

    private LoopbackHttpServer.Response cytoscape(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        try (var input = FlowScopeWebServer.class.getResourceAsStream("/web/vendor/cytoscape-3.26.0.min.js")) {
            if (input == null) return error(500, "Graph library missing");
            return response(200, "application/javascript; charset=utf-8", input.readAllBytes());
        }
    }

    private LoopbackHttpServer.Response snapshot(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        return response(200, "application/json; charset=utf-8",
                snapshots.write(state.revision(), state.snapshot(), state.config(), state.assessments(), state.validations(),
                        state.sessions() == null ? List.of() : state.sessions().views(), state.routeCandidates(),
                        state.droppedRecords()));
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

    private LoopbackHttpServer.Response preview(LoopbackHttpServer.Request request) throws IOException {
        if (!request.method().equals("GET")) return method("GET");
        return response(200, "application/json; charset=utf-8", snapshots.preview(state.snapshot()));
    }

    private LoopbackHttpServer.Response scenarios(LoopbackHttpServer.Request request) throws IOException {
        if (postForm(request) == null) return invalidForm(request);
        ObjectNode result = json.createObjectNode();
        result.set("scenarios", json.readTree(snapshots.write(state.revision(), state.snapshot(),
                state.config(), state.assessments(), state.validations(),
                state.sessions() == null ? List.of() : state.sessions().views(), state.routeCandidates())).path("scenarios"));
        ObjectNode body = json.createObjectNode();
        body.put("usedLlm", !state.assessments().isEmpty() || !state.validations().isEmpty());
        body.put("message", state.assessments().isEmpty() && state.validations().isEmpty()
                ? "MCP LLM 평가가 아직 없어 결정론적 후보만 표시합니다."
                : "MCP LLM 평가·검증 판정과 결정론적 후보를 함께 표시합니다.");
        body.set("result", result);
        return json(200, body);
    }

    private LoopbackHttpServer.Response replay(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            RequestRecord record = state.openInRepeater(form.getOrDefault("eventId", ""));
            ObjectNode body = json.createObjectNode();
            body.put("success", true);
            body.put("status", record.status);
            body.put("message", "마스킹된 요청을 Burp Repeater 초안으로 열었습니다. 자동 전송하지 않았습니다.");
            body.put("replayId", "");
            body.put("openedDraft", true);
            return json(200, body);
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private LoopbackHttpServer.Response clear(LoopbackHttpServer.Request request) throws IOException {
        if (postForm(request) == null) return invalidForm(request);
        state.clearTraffic();
        return success("수집 트래픽을 초기화했습니다.");
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
            } else if (action.equals("end")) {
                String runId = validatedRunId(required(form, "runId"));
                if (!state.contexts().clear(Source.HUMAN, runId)) {
                    throw new IllegalArgumentException("현재 HUMAN run ID와 일치하지 않습니다.");
                }
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
        body.put("proxy", "http://127.0.0.1:8080");
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

    private LoopbackHttpServer.Response review(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String itemId = required(form, "itemId");
            List<String> evidenceIds = evidenceForReview(itemId);
            ReviewDecision.Status status;
            try { status = ReviewDecision.Status.valueOf(required(form, "status").toUpperCase(Locale.ROOT)); }
            catch (IllegalArgumentException error) { throw new IllegalArgumentException("지원하지 않는 최종 판정입니다."); }
            state.config().reviewItem(itemId, status, form.getOrDefault("note", ""), evidenceIds);
            state.rebuild();
            return success("Evidence에 묶인 사람 감사·오버라이드 기록을 저장했습니다.");
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private List<String> evidenceForReview(String itemId) {
        return state.snapshot().analysis.findings().stream().filter(finding -> finding.id().equals(itemId))
                .map(finding -> finding.evidenceIds()).findFirst()
                .or(() -> state.assessments().stream().filter(value -> value.id().equals(itemId))
                        .map(value -> value.evidenceIds()).findFirst())
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 후보입니다."));
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

    private LoopbackHttpServer.Response accountDelete(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String id = required(form, "id");
            if (state.config().sessionBindings().containsValue(id)) throw new IllegalArgumentException("연결된 세션을 먼저 해제하세요.");
            if (state.config().account(id).isEmpty()) throw new IllegalArgumentException("존재하지 않는 계정입니다.");
            if (state.sessions() != null) state.sessions().viewForAccount(id)
                    .ifPresent(view -> state.sessions().revoke(view.handle()));
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
            String handle = broker.handleForAccount(accountId);
            if (action.equals("end")) {
                broker.endCapture(handle);
                state.rebuild();
                SessionBroker.Status status = broker.viewForAccount(accountId).orElseThrow().status();
                String message = status == SessionBroker.Status.ACTIVE
                        ? account.label() + " 로그인이 연결됐습니다. HUMAN pass, ZAP, LLM에서 사용할 수 있습니다."
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
            body.set("scope", json.valueToTree(state.scopeEntries().stream()
                    .filter(entry -> !isOwnControlPlane(entry)).toList()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
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
            body.set("run", state.startScanner(target, accounts, anonymous));
            return json(202, body);
        } catch (RuntimeException error) { return error(400, error.getMessage()); }
    }

    private LoopbackHttpServer.Response llmRun(LoopbackHttpServer.Request request) throws IOException {
        if (request.method().equals("GET")) {
            ObjectNode body = json.createObjectNode();
            body.set("run", state.llmStatus());
            body.set("scope", json.valueToTree(state.scopeEntries().stream()
                    .filter(entry -> !isOwnControlPlane(entry)).toList()));
            body.set("completed_lanes", json.valueToTree(state.contexts().completedExplorations().stream()
                    .map(Source::name).sorted().toList()));
            return json(200, body);
        }
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            String action = required(form, "action").toLowerCase(Locale.ROOT);
            ObjectNode body = json.createObjectNode();
            if (action.equals("cancel")) {
                body.set("run", state.cancelLlm());
                return json(200, body);
            }
            if (action.equals("followup")) {
                body.set("run", state.followUpJudge(required(form, "message")));
                return json(202, body);
            }
            if (!action.equals("start")) {
                throw new IllegalArgumentException("action은 start, cancel 또는 followup이어야 합니다.");
            }
            LocalLlmRunner.Provider provider;
            LocalLlmRunner.Role role;
            try { provider = LocalLlmRunner.Provider.valueOf(required(form, "provider").toUpperCase(Locale.ROOT)); }
            catch (IllegalArgumentException error) { throw new IllegalArgumentException("provider는 CODEX 또는 CLAUDE여야 합니다."); }
            try { role = LocalLlmRunner.Role.valueOf(required(form, "role").toUpperCase(Locale.ROOT)); }
            catch (IllegalArgumentException error) { throw new IllegalArgumentException("role은 EXPLORER 또는 JUDGE여야 합니다."); }
            String target = required(form, "target");
            if (isOwnControlPlane(target)) throw new IllegalArgumentException("FlowScope Web 제어면은 LLM 대상이 될 수 없습니다.");
            body.set("run", state.startLlm(provider, role, target, form.getOrDefault("account", "")));
            return json(202, body);
        } catch (RuntimeException error) {
            return error(400, error.getMessage());
        }
    }

    private boolean isOwnControlPlane(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
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
        state.clearTraffic();
        return success("계정 카드는 유지하고 세션 매핑과 수집 트래픽을 초기화했습니다.");
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

    private LoopbackHttpServer.Response owner(LoopbackHttpServer.Request request) throws IOException {
        Map<String, String> form = postForm(request);
        if (form == null) return invalidForm(request);
        try {
            state.config().withResourceOwner(required(form, "resource"), form.getOrDefault("identity", ""));
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
        return !request.method().equals("POST") ? method("POST") : error(413, "요청 본문은 1MB 이하만 허용됩니다.");
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

    private LoopbackHttpServer.Response json(int status, ObjectNode body) throws IOException {
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
