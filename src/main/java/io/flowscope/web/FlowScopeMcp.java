package io.flowscope.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import io.flowscope.core.AuthorizationMatrix;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
import io.flowscope.core.LlmFinding;
import io.flowscope.integration.LoopbackHttpServer;
import io.flowscope.integration.SessionBroker;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 기존 FlowScope 로컬 웹 서버(127.0.0.1:17777)에 얹는 MCP Streamable HTTP(JSON-RPC) 엔드포인트(`/mcp`).
 * 점검이 끝난 뒤 구독형 LLM(Codex)이 접속해, 판정 매트릭스의 GET 추천을 Request Lab으로 재전송하고 소견을 남긴다.
 * 모델 제공자 토큰은 취급하지 않으며, 재전송은 GET만·exact scope 안에서만 허용한다.
 */
final class FlowScopeMcp {
    private static final String LATEST_PROTOCOL = "2025-11-25";
    private static final List<String> SUPPORTED_PROTOCOLS = List.of(LATEST_PROTOCOL, "2025-06-18", "2025-03-26");
    private static final int MAX_BODY = 1_000_000;

    private final FlowScopeWebServer.State state;
    private final String token;
    private final int port;
    private final ObjectMapper json = new ObjectMapper();

    FlowScopeMcp(FlowScopeWebServer.State state, String token, int port) {
        this.state = state;
        this.token = token == null ? "" : token;
        this.port = port;
    }

    LoopbackHttpServer.Response handle(LoopbackHttpServer.Request request) {
        try {
            if (!validHost(request.header("Host"))) return jsonRpc(403, error(null, -32002, "invalid Host"));
            String origin = request.header("Origin");
            if (origin != null && !origin.matches("(?i)^https?://(localhost|127\\.0\\.0\\.1|\\[::1])(?::\\d+)?$")) {
                return jsonRpc(403, error(null, -32002, "invalid Origin"));
            }
            if (!request.method().equalsIgnoreCase("POST")) {
                return new LoopbackHttpServer.Response(405, Map.of("Content-Type", "application/json; charset=utf-8",
                        "Allow", "POST", "MCP-Protocol-Version", LATEST_PROTOCOL),
                        bytes(error(null, -32600, "POST required")));
            }
            if (token.isBlank()) return jsonRpc(503, error(null, -32000, "MCP token unavailable"));
            String authorization = request.header("Authorization");
            byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
            byte[] provided = authorization == null ? new byte[0] : authorization.getBytes(StandardCharsets.UTF_8);
            if (expected.length != provided.length || !MessageDigest.isEqual(expected, provided)) {
                return jsonRpc(401, error(null, -32000, "invalid bearer token"));
            }
            byte[] body = request.body() == null ? new byte[0] : request.body();
            if (body.length > MAX_BODY) return jsonRpc(413, error(null, -32600, "request too large"));
            JsonNode message;
            try { message = json.readTree(body); }
            catch (JsonProcessingException parse) { return jsonRpc(400, error(null, -32700, "parse error")); }
            if (message == null || !message.isObject() || !"2.0".equals(message.path("jsonrpc").asText())
                    || !message.path("method").isTextual() || message.path("method").asText().isBlank()) {
                return jsonRpc(400, error(message == null ? null : message.get("id"), -32600, "invalid request"));
            }
            JsonNode id = message.get("id");
            String method = message.path("method").asText();
            if (id == null && method.startsWith("notifications/")) {
                return new LoopbackHttpServer.Response(202, Map.of(), new byte[0]);
            }
            ObjectNode result = switch (method) {
                case "initialize" -> success(id, initialize(message.path("params")));
                case "ping" -> success(id, json.createObjectNode());
                case "tools/list" -> success(id, toolsList());
                case "tools/call" -> success(id, callTool(message.path("params")));
                default -> error(id, -32601, "method not found: " + method);
            };
            return jsonRpc(200, result);
        } catch (Exception error) {
            return jsonRpc(500, error(null, -32603,
                    error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
        }
    }

    // ---- protocol ----

    private ObjectNode initialize(JsonNode params) {
        ObjectNode result = json.createObjectNode();
        result.put("protocolVersion", negotiate(params.path("protocolVersion").asText(LATEST_PROTOCOL)));
        result.putObject("capabilities").putObject("tools").put("listChanged", false);
        result.putObject("serverInfo").put("name", "flowscope").put("version", "1.0.2");
        result.put("instructions", "점검이 끝난 데이터에 대한 LLM 교차 계정 검증(추천)만 수행한다. "
                + "flowscope_list_recommendations로 GET 추천을 읽고, flowscope_cross_send_get으로 보내는 계정 세션으로 "
                + "GET만 재전송하며(쓰기·외부 네트워크·웹 검색 금지), flowscope_submit_finding으로 소견을 남긴다. "
                + "판정 확정은 사람이 한다. 범위는 서버 exact scope를 벗어날 수 없다.");
        return result;
    }

    private ObjectNode toolsList() {
        ArrayNode tools = json.createArrayNode();
        tools.add(tool("flowscope_get_status",
                "현재 점검 범위, 계정·역할·세션 상태 요약을 반환한다. 인증값(쿠키·토큰)은 반환하지 않는다.", schema()));
        tools.add(tool("flowscope_list_recommendations",
                "판정 매트릭스의 교차 테스트 추천 목록. GET만 자동 실행 대상이며 보내는 계정·근거 기록·사유를 포함한다.",
                schema()));
        tools.add(tool("flowscope_get_evidence",
                "요청 기록 하나의 요청/응답 원문과 메타데이터를 evidence_id로 읽는다.", evidenceSchema()));
        tools.add(tool("flowscope_cross_send_get",
                "근거 기록을 보내는 계정(account_id) 세션으로 GET만 재전송한다. GET이 아니면 거부한다. "
                        + "새 요청 기록 번호와 응답 요약을 반환한다.", crossSendSchema()));
        tools.add(tool("flowscope_submit_finding",
                "교차 재전송 결과를 해석한 LLM 소견(추천)을 남긴다. 판정 엔진 결과를 바꾸지 않으며 사람이 검토한다.",
                findingSchema()));
        ObjectNode result = json.createObjectNode();
        result.set("tools", tools);
        return result;
    }

    private ObjectNode callTool(JsonNode params) {
        String name = params.path("name").asText("");
        JsonNode args = params.path("arguments");
        try {
            return switch (name) {
                case "flowscope_get_status" -> toolResult(getStatus(), false);
                case "flowscope_list_recommendations" -> toolResult(listRecommendations(), false);
                case "flowscope_get_evidence" -> toolResult(getEvidence(args), false);
                case "flowscope_cross_send_get" -> toolResult(crossSendGet(args), false);
                case "flowscope_submit_finding" -> toolResult(submitFinding(args), false);
                default -> toolError("unknown tool: " + name);
            };
        } catch (IllegalArgumentException | IllegalStateException | UnsupportedOperationException error) {
            return toolError(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
        }
    }

    // ---- tools ----

    private ObjectNode getStatus() {
        ObjectNode result = json.createObjectNode();
        ArrayNode scope = result.putArray("scope");
        state.scopeEntries().forEach(scope::add);
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(state.snapshot(), state.config(), state.validations());
        ObjectNode summary = result.putObject("recommendationSummary");
        summary.put("bflaTest", matrix.summary().bflaTestRecommendations());
        summary.put("bolaIdorTest", matrix.summary().bolaIdorTestRecommendations());
        ArrayNode accounts = result.putArray("accounts");
        SessionBroker sessions = state.sessions();
        state.config().accounts().values().forEach(account -> {
            ObjectNode node = accounts.addObject();
            node.put("accountId", account.id());
            node.put("label", account.label());
            node.put("service", account.service());
            node.put("role", account.role().name());
            String sessionStatus = "NONE";
            if (sessions != null) {
                sessionStatus = sessions.viewForAccount(account.id())
                        .map(view -> view.status().name()).orElse("NONE");
            }
            node.put("sessionStatus", sessionStatus);
        });
        return result;
    }

    private ObjectNode listRecommendations() {
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(state.snapshot(), state.config(), state.validations());
        ObjectNode result = json.createObjectNode();
        ArrayNode list = result.putArray("recommendations");
        matrix.functions().forEach(cell -> addRecommendation(list, cell.recommendation(), cell.operation(), null, cell.identity()));
        matrix.objects().forEach(cell -> addRecommendation(list, cell.recommendation(), cell.operation(), cell.resource(), cell.identity()));
        return result;
    }

    private void addRecommendation(ArrayNode list, AuthorizationMatrix.TestRecommendation rec,
                                   String operation, String resource, String identity) {
        if (rec == null) return;
        boolean getOnly = !rec.stateChanging();
        String basisEvidence = rec.basisEvidenceIds().isEmpty() ? null : rec.basisEvidenceIds().get(0);
        if (basisEvidence == null) return;
        String method = evidenceMethod(basisEvidence);
        ObjectNode node = list.addObject();
        node.put("type", rec.type());
        node.put("operation", operation);
        if (resource != null) node.put("resource", resource);
        node.put("testIdentity", rec.testIdentity());
        node.put("testIdentityLabel", rec.testIdentityLabel());
        node.put("basisIdentity", rec.basisIdentity());
        node.put("basisEvidenceId", basisEvidence);
        node.put("method", method == null ? "" : method);
        node.put("getAutoRunnable", getOnly && "GET".equalsIgnoreCase(method));
        node.put("stateChanging", rec.stateChanging());
        node.put("reason", rec.reason());
        node.put("instruction", rec.instruction());
    }

    private ObjectNode getEvidence(JsonNode args) {
        String evidenceId = required(args, "evidence_id");
        FlowScopeWebServer.RequestLabDraft draft = state.requestLabDraft(evidenceId);
        ObjectNode result = json.createObjectNode();
        result.put("evidenceId", draft.eventId());
        result.put("service", draft.service());
        result.put("request", draft.request() == null ? "" : draft.request());
        result.put("response", draft.response() == null ? "" : draft.response());
        result.put("rawRequestRetained", draft.rawRequestRetained());
        result.put("requestEditable", draft.requestEditable());
        result.put("observedIdentity", draft.observedIdentity());
        return result;
    }

    private ObjectNode crossSendGet(JsonNode args) {
        String evidenceId = required(args, "evidence_id");
        String accountId = required(args, "account_id");
        FlowScopeWebServer.RequestLabDraft draft = state.requestLabDraft(evidenceId);
        String requestText = draft.request();
        if (requestText == null || requestText.isBlank()) {
            throw new IllegalStateException("이 기록은 재전송할 요청 원문이 없습니다.");
        }
        String method = firstToken(requestText);
        if (!"GET".equalsIgnoreCase(method)) {
            throw new IllegalArgumentException("flowscope_cross_send_get은 GET만 재전송합니다. 이 기록은 " + method + "입니다.");
        }
        FlowScopeWebServer.RequestLabResult sent = state.sendRequestLab(evidenceId, requestText,
                FlowScopeWebServer.CredentialMode.ACCOUNT, accountId);
        ObjectNode result = json.createObjectNode();
        result.put("newEvidenceId", sent.eventId());
        result.put("status", sent.status());
        result.put("responseBytes", sent.responseBytes());
        result.put("durationMs", sent.durationMs());
        String response = sent.response() == null ? "" : sent.response();
        result.put("responsePreview", response.length() > 4000 ? response.substring(0, 4000) : response);
        return result;
    }

    private ObjectNode submitFinding(JsonNode args) {
        String operation = required(args, "operation");
        String identity = required(args, "identity");
        String resource = args.path("resource").isTextual() ? args.get("resource").asText() : null;
        String verdict = args.path("verdict").asText("");
        String confidence = args.path("confidence").asText("");
        String note = args.path("note").asText("");
        java.util.List<String> evidenceIds = new java.util.ArrayList<>();
        if (args.path("evidence_ids").isArray()) {
            args.get("evidence_ids").forEach(value -> { if (value.isTextual()) evidenceIds.add(value.asText()); });
        }
        String id = "llm:" + operation + ":" + identity + ":" + (resource == null ? "" : resource);
        LlmFinding finding = new LlmFinding(id, operation, identity, resource, verdict, confidence, note,
                evidenceIds, System.currentTimeMillis());
        state.submitFinding(finding);
        ObjectNode result = json.createObjectNode();
        result.put("saved", true);
        result.put("id", id);
        return result;
    }

    // ---- evidence helpers ----

    private String evidenceMethod(String evidenceId) {
        try { return firstToken(state.requestLabDraft(evidenceId).request()); }
        catch (RuntimeException ignored) { return null; }
    }

    private static String firstToken(String requestText) {
        if (requestText == null) return null;
        String line = requestText.stripLeading();
        int space = line.indexOf(' ');
        return space > 0 ? line.substring(0, space) : line;
    }

    // ---- JSON-RPC framing ----

    private ObjectNode success(JsonNode id, ObjectNode result) {
        ObjectNode node = json.createObjectNode();
        node.put("jsonrpc", "2.0");
        if (id == null) node.putNull("id"); else node.set("id", id);
        node.set("result", result);
        return node;
    }

    private ObjectNode error(JsonNode id, int code, String message) {
        ObjectNode node = json.createObjectNode();
        node.put("jsonrpc", "2.0");
        if (id == null) node.putNull("id"); else node.set("id", id);
        ObjectNode err = node.putObject("error");
        err.put("code", code);
        err.put("message", message == null ? "error" : message);
        return node;
    }

    private ObjectNode toolResult(ObjectNode payload, boolean isError) {
        ObjectNode result = json.createObjectNode();
        ArrayNode content = result.putArray("content");
        ObjectNode text = content.addObject();
        text.put("type", "text");
        text.put("text", payload.toString());
        result.put("isError", isError);
        return result;
    }

    private ObjectNode toolError(String message) {
        ObjectNode payload = json.createObjectNode();
        payload.put("error", message == null ? "error" : message);
        return toolResult(payload, true);
    }

    private ObjectNode tool(String name, String description, ObjectNode schema) {
        ObjectNode node = json.createObjectNode();
        node.put("name", name);
        node.put("description", description);
        node.set("inputSchema", schema);
        return node;
    }

    private ObjectNode schema() {
        ObjectNode schema = json.createObjectNode();
        schema.put("type", "object");
        schema.putObject("properties");
        schema.putArray("required");
        return schema;
    }

    private ObjectNode evidenceSchema() {
        ObjectNode schema = schema();
        ((ObjectNode) schema.get("properties")).putObject("evidence_id").put("type", "string");
        ((ArrayNode) schema.get("required")).add("evidence_id");
        return schema;
    }

    private ObjectNode crossSendSchema() {
        ObjectNode schema = schema();
        ObjectNode props = (ObjectNode) schema.get("properties");
        props.putObject("evidence_id").put("type", "string");
        props.putObject("account_id").put("type", "string");
        ArrayNode required = (ArrayNode) schema.get("required");
        required.add("evidence_id");
        required.add("account_id");
        return schema;
    }

    private ObjectNode findingSchema() {
        ObjectNode schema = schema();
        ObjectNode props = (ObjectNode) schema.get("properties");
        props.putObject("operation").put("type", "string");
        props.putObject("identity").put("type", "string");
        props.putObject("resource").put("type", "string");
        props.putObject("verdict").put("type", "string");
        props.putObject("confidence").put("type", "string");
        props.putObject("note").put("type", "string");
        ObjectNode evidence = props.putObject("evidence_ids");
        evidence.put("type", "array");
        evidence.putObject("items").put("type", "string");
        ArrayNode required = (ArrayNode) schema.get("required");
        required.add("operation");
        required.add("identity");
        return schema;
    }

    private static String required(JsonNode args, String field) {
        JsonNode value = args == null ? null : args.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw new IllegalArgumentException(field + "이(가) 필요합니다.");
        }
        return value.asText();
    }

    // ---- HTTP framing ----

    private LoopbackHttpServer.Response jsonRpc(int status, ObjectNode body) {
        return new LoopbackHttpServer.Response(status, Map.of("Content-Type", "application/json; charset=utf-8",
                "MCP-Protocol-Version", LATEST_PROTOCOL), bytes(body));
    }

    private byte[] bytes(ObjectNode body) {
        return body.toString().getBytes(StandardCharsets.UTF_8);
    }

    private boolean validHost(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            URI uri = URI.create("http://" + value.trim());
            String host = uri.getHost();
            int hostPort = uri.getPort() < 0 ? 80 : uri.getPort();
            return host != null && (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("::1"))
                    && hostPort == port;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private String negotiate(String requested) {
        return SUPPORTED_PROTOCOLS.contains(requested) ? requested : LATEST_PROTOCOL;
    }
}
