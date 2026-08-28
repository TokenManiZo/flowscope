package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.Source;
import io.flowscope.core.StoredPayload;
import io.flowscope.core.ValidationDecision;
import io.flowscope.integration.McpServer;
import io.flowscope.integration.LocalLlmRunner;
import io.flowscope.integration.SessionBroker;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

final class FlowScopeWebServerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final TestState state = new TestState();
    private FlowScopeWebServer server;
    private String token;

    @AfterEach void stop() {
        if (server != null) server.close();
        state.sessions.close();
    }

    @Test
    void servesBrandedUiAndProtectsApiWithCapabilityAndOrigin() throws Exception {
        start();
        HttpResponse<String> index = get("/", null, null);
        assertEquals(200, index.statusCode());
        assertTrue(index.body().contains("<h1>FlowScope</h1>"));
        assertTrue(index.body().contains("HUMAN pass 시작"));
        assertTrue(index.body().contains("Evidence 표시"));
        assertTrue(index.body().contains("--human:#2563EB; --scanner:#DC2626; --llm:#111827;"));
        assertTrue(index.body().contains("human:{n:'사람',c:'--human',ab:'H'}"));
        assertTrue(index.body().contains("scanner:{n:'스캐너',c:'--scanner',ab:'S'}"));
        assertTrue(index.body().contains("llm:{n:'LLM',c:'--llm',ab:'L'}"));
        assertTrue(index.body().contains("사람 H (파랑·실선)"));
        assertTrue(index.body().contains("스캐너 S (빨강·파선)"));
        assertTrue(index.body().contains("LLM L (검정·점선)"));
        assertTrue(index.body().contains("검토 대기"));
        assertTrue(index.body().contains("인증·화면·반복 보조 흐름 표시"));
        assertTrue(index.body().contains("저장 상한으로 유실"));
        assertTrue(index.body().contains("샘플 데이터 · 실제 HUMAN/ZAP/LLM 점검 결과가 아님"));
        assertTrue(index.body().contains("activeDispositions={INCLUDE:true,REVIEW:true,EXCLUDE:false}"));
        assertTrue(index.body().contains("첫 점검을 시작하세요"));
        assertTrue(index.body().contains("Burp exact scope → 로그인/HUMAN pass → ZAP 기준선 → 독립 LLM Explorer/Judge"));
        assertTrue(index.body().contains("LLM Explorer 시작"));
        assertTrue(index.body().contains("Judge 시작"));
        assertTrue(index.body().contains("LLM_COMPLETED.includes(lane)"));
        assertTrue(index.body().contains("/api/llm-run"));
        assertTrue(index.body().contains("classList.toggle('empty-state',!EVENTS.length&&!SERVER_ROUTE_CANDIDATES.length)"));
        assertTrue(index.body().contains("v1.2.0-beta.13 · 3소스"));
        assertTrue(index.body().contains("item.evidenceId,item.applicability,item.reason].map(esc)"));
        assertTrue(index.body().contains("· 로그인 필요"));
        assertTrue(index.body().contains("등록 계정과 로그인 상태"));
        assertTrue(index.body().contains("쿠키·토큰·subject 단서는 같은 로그인 세션의 내부 근거로 묶"));
        assertTrue(index.body().contains("고급 세션 진단"));
        assertTrue(index.body().contains("사용 가능"));
        assertTrue(index.body().contains("다시 로그인 필요"));
        assertTrue(index.body().contains("동일 인증정보 충돌"));
        assertTrue(index.body().contains("SERVER_MANAGED_SESSIONS.filter(session=>session.status==='ACTIVE'"));
        assertTrue(index.body().contains("let HUMAN_RUN={active:false,completed:false,runId:''}"));
        assertTrue(index.body().contains("HUMAN_RUN.active||HUMAN_RUN.completed"));
        assertTrue(index.body().contains("syncHumanRun();syncExtension();syncScannerRun();syncLlmRun();"));
        assertTrue(index.body().contains("setInterval(()=>{syncHumanRun();syncExtension();syncScannerRun();syncLlmRun();},1000)"));
        assertFalse(index.body().contains("counts.human+'건 완료'"));
        assertTrue(index.body().contains("data-source-count=\"human\""));
        assertTrue(index.body().contains("EVENTS.filter(event=>event.coverageEligible)"));
        assertTrue(index.body().contains("cb.addEventListener('change',()=>{activeSources[cb.value]=cb.checked;renderGraph();})"));
        assertTrue(index.body().contains("if(view==='source')cy.edges('[src]').forEach"));
        assertTrue(index.body().contains("accessByRelation=new Map()"));
        assertTrue(index.body().contains("function showAccessEdge(edge)"));
        assertTrue(index.body().contains("taxiTurn:accessTurn(c.idn,s)"));
        assertTrue(index.body().contains("'label':'data(label)'"));
        assertTrue(index.body().contains("wrapGraphLabel"));
        assertTrue(index.body().contains("nodeHeight"));
        assertFalse(index.body().contains("shortLabel(value.slice(p+1),36)"));
        assertTrue(index.body().contains("API 요구 권한 0개 · BFLA 비교 비활성"));
        assertTrue(index.body().contains("응답 ID가 다음 요청으로 전달된 관계는 메인 접근 그래프와 섞지 않고"));
        assertFalse(index.body().contains("etype:'flow'"));
        assertFalse(index.body().contains("cycleRole("));
        assertFalse(index.body().contains("__FLOWSCOPE_CAPABILITY__"));

        assertEquals(403, get("/api/snapshot", null, null).statusCode());
        assertEquals(403, get("/api/snapshot", token, "https://evil.example").statusCode());

        HttpResponse<String> snapshot = get("/api/snapshot", token, origin());
        assertEquals(200, snapshot.statusCode(), snapshot.body());
        assertEquals("no-store", snapshot.headers().firstValue("Cache-Control").orElse(""));
        JsonNode body = JSON.readTree(snapshot.body());
        assertEquals(1, body.path("events").size());
        assertEquals(1, body.path("cells").size());
        assertEquals("untested", body.at("/cells/0/overall").asText());
        assertEquals("untested", body.at("/cells/0/perSource/human").asText());
        assertEquals("human", body.at("/activeSources/0").asText());
        assertEquals(1, body.at("/trafficStats/captured").asInt());
        assertEquals(0, body.at("/trafficStats/dropped").asInt());
        assertEquals(0, body.at("/trafficStats/payloadMetadataOnly").asInt());
        assertFalse(body.path("sampleMode").asBoolean());
        assertTrue(body.at("/events/0/coverageEligible").asBoolean());
        assertEquals("API", body.at("/events/0/trafficClass").asText());
        assertFalse(body.at("/events/0/classificationReasons").isEmpty());
        assertEquals("CORROBORATED", body.at("/events/0/pathTemplateStatus").asText());
        assertEquals("RESPONSE_ID_MATCH", body.at("/events/0/pathTemplateReasons/0").asText());
        assertEquals(1, body.at("/events/0/repeatCount").asInt());
        assertEquals("PATH_ID", body.at("/events/0/objects/0/evidence").asText());
        assertEquals(1, body.path("routeCandidates").size());
        assertFalse(body.at("/routeCandidates/0/observed").asBoolean());
        assertEquals(List.of("REVIEW"), JSON.convertValue(
                body.at("/routeCandidates/0/priorityReasons"),
                new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}));

        JsonNode evidence = json(get("/api/evidence?operation="
                + encode(body.at("/events/0/op").asText()), token, origin()));
        assertEquals("FULL", evidence.at("/records/0/requestPayload/retention").asText());
        assertTrue(evidence.at("/records/0/requestPayload/bytes").asInt() > 0);
        assertEquals(64, evidence.at("/records/0/requestPayload/digest").asText().length());
        assertTrue(index.body().contains("압축 전문 총량 상한 초과"));
    }

    @Test
    void snapshotSeparatesMainComparisonReviewAndExcludedEvidence() throws Exception {
        RequestRecord review = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/status", 200, "anon");
        review.body = "ok";
        review.hasResponse = true;
        RequestRecord excluded = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/static/app.js", 200, "anon");
        excluded.hasResponse = true;
        excluded.secFetchDest = "script";
        excluded.responseContentType = "application/javascript";
        state.records.add(review);
        state.records.add(excluded);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));

        assertEquals(3, snapshot.at("/trafficStats/captured").asInt());
        assertEquals(1, snapshot.at("/trafficStats/coverage").asInt());
        assertEquals(1, snapshot.at("/trafficStats/review").asInt());
        assertEquals(1, snapshot.at("/trafficStats/excluded").asInt());
        JsonNode reviewEvent = java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                .filter(value -> value.path("path").asText().equals("/status")).findFirst().orElseThrow();
        assertEquals("REVIEW", reviewEvent.path("trafficDisposition").asText());
        assertFalse(reviewEvent.path("coverageEligible").asBoolean());
    }

    @Test
    void startsAndEndsExactHumanRunWithoutOverlap() throws Exception {
        start();
        JsonNode idle = json(get("/api/human-run", token, origin()));
        assertFalse(idle.path("active").asBoolean());
        assertFalse(idle.path("completed").asBoolean());

        JsonNode began = json(post("/api/human-run", "action=begin&runId=human-p5-1", token));
        assertTrue(began.path("active").asBoolean());
        assertFalse(began.path("completed").asBoolean());
        assertEquals("human-p5-1", began.path("runId").asText());
        assertEquals("human-p5-1", state.contexts.current(Source.HUMAN).runId());

        assertEquals(400, post("/api/human-run", "action=begin&runId=human-p5-2", token).statusCode());
        assertEquals(400, post("/api/human-run", "action=end&runId=wrong", token).statusCode());
        assertEquals("human-p5-1", state.contexts.current(Source.HUMAN).runId());

        JsonNode ended = json(post("/api/human-run", "action=end&runId=human-p5-1", token));
        assertFalse(ended.path("active").asBoolean());
        assertTrue(ended.path("completed").asBoolean());
        assertNull(state.contexts.current(Source.HUMAN));

        JsonNode restarted = json(post("/api/human-run", "action=begin&runId=human-p5-3", token));
        assertTrue(restarted.path("active").asBoolean());
        assertFalse(restarted.path("completed").asBoolean());
    }

    @Test
    void startsHumanRunWithAnExplicitRegisteredAccount() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();

        assertEquals(400, post("/api/human-run", "action=begin&runId=human-before-login&account=user-a", token).statusCode());
        activateSession("user-a", "token-a");
        JsonNode began = json(post("/api/human-run", "action=begin&runId=human-a&account=user-a", token));

        assertEquals("user-a", began.path("accountId").asText());
        assertEquals("user-a", state.contexts.current(Source.HUMAN).accountId());
        assertEquals(200, post("/api/human-run", "action=end&runId=human-a", token).statusCode());
        assertEquals(400, post("/api/human-run", "action=begin&runId=human-b&account=missing", token).statusCode());
    }

    @Test
    void capturesManagedSessionWithoutReturningRawCredentials() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.rebuild();
        start();

        assertEquals(200, post("/api/session-capture", "action=begin&account=user-a", token).statusCode());
        String handle = state.sessions.handleForAccount("user-a");
        state.sessions.observeRequest(handle, URI.create(state.record.service + "/login"),
                Map.of("Authorization", "Bearer raw-access-token", "Cookie", "sid=raw-cookie"),
                java.time.Instant.now());
        state.sessions.observeResponse(handle, URI.create(state.record.service + "/account"), 200,
                null, "{\"id\":\"user-a\"}", List.of(), java.time.Instant.now());
        assertEquals(200, post("/api/session-capture", "action=end&account=user-a", token).statusCode());

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        assertEquals("ACTIVE", snapshot.at("/managedSessions/0/status").asText());
        assertEquals("user-a", snapshot.at("/managedSessions/0/accountId").asText());
        assertFalse(snapshot.toString().contains("raw-access-token"));
        assertFalse(snapshot.toString().contains("raw-cookie"));
        JsonNode broker = json(get("/api/session-capture", token, origin()));
        assertFalse(broker.toString().contains("raw-access-token"));
        assertFalse(broker.toString().contains("raw-cookie"));
    }

    @Test
    void projectsCookieTokenAndSubjectArtifactsAsOneRegisteredAccount() throws Exception {
        state.records.clear();
        AccountProfile account = new AccountProfile("test1", "test1", state.record.service, AccessRole.USER);
        state.config.upsertAccount(account);
        List<String> fingerprints = List.of("ck:d1acd57ee88d", "tok:710e0dbdd422", "sub:test1@example.test");
        for (int i = 0; i < fingerprints.size(); i++) {
            RequestRecord record = new RequestRecord(Source.HUMAN, state.record.service,
                    "GET", "/account/" + i, 200, fingerprints.get(i));
            record.hasResponse = true;
            record.timestamp = i + 1L;
            state.records.add(record);
            state.config.bindSession(record.service, record.fp, account.id());
        }
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        assertEquals(1, snapshot.path("accounts").size());
        assertEquals("test1", snapshot.at("/accounts/0/label").asText());
        assertEquals(3, snapshot.path("sessions").size());
        for (JsonNode session : snapshot.path("sessions")) {
            assertEquals("test1", session.path("accountId").asText());
            assertTrue(session.path("registered").asBoolean());
        }
        assertEquals(Set.of("COOKIE", "AUTHORIZATION", "SUBJECT_HINT"),
                java.util.stream.StreamSupport.stream(snapshot.path("sessions").spliterator(), false)
                        .map(value -> value.path("artifactKind").asText()).collect(java.util.stream.Collectors.toSet()));
    }

    @Test
    void startsOneServerOwnedScannerCampaignForAnonymousAndSelectedAccounts() throws Exception {
        state.config.upsertAccount(new AccountProfile("user-a", "USER A", state.record.service, AccessRole.USER));
        state.config.upsertAccount(new AccountProfile("user-b", "USER B", state.record.service, AccessRole.USER));
        activateSession("user-a", "token-a");
        activateSession("user-b", "token-b");
        state.rebuild();
        start();

        JsonNode initial = json(get("/api/scanner-run", token, origin()));
        assertEquals("NOT_STARTED", initial.at("/run/status").asText());
        assertEquals(state.record.service + "/", initial.at("/scope/0").asText());

        HttpResponse<String> started = post("/api/scanner-run", "target=" + encode(state.record.service + "/")
                + "&anonymous=true&accounts=user-a%2Cuser-b", token);
        assertEquals(202, started.statusCode(), started.body());
        JsonNode body = JSON.readTree(started.body());
        assertEquals("RUNNING", body.at("/run/status").asText());
        assertEquals(state.record.service + "/", state.scannerTarget);
        assertEquals(List.of("user-a", "user-b"), state.scannerAccounts);
        assertTrue(state.scannerAnonymous);
    }

    @Test
    void excludesItsOwnLoopbackControlPlaneFromScannerTargets() throws Exception {
        start();
        state.scannerScope = List.of(server.url());

        JsonNode listed = json(get("/api/scanner-run", token, origin()));
        assertEquals(0, listed.path("scope").size());
        HttpResponse<String> rejected = post("/api/scanner-run",
                "target=" + encode(server.url()) + "&anonymous=true", token);
        assertEquals(400, rejected.statusCode());
        assertTrue(rejected.body().contains("Web 제어면"));
    }

    @Test
    void startsSubscriptionLlmExplorerAndExposesOneUnifiedStatusEndpoint() throws Exception {
        start();

        JsonNode initial = json(get("/api/llm-run", token, origin()));
        assertEquals("IDLE", initial.at("/run/status").asText());
        assertTrue(initial.at("/run/providers/CODEX").asBoolean());
        assertEquals(state.record.service + "/", initial.at("/scope/0").asText());
        assertEquals(0, initial.path("completed_lanes").size());

        HttpResponse<String> started = post("/api/llm-run", "action=start&provider=CODEX&role=EXPLORER&target="
                + encode(state.record.service + "/") + "&account=", token);
        assertEquals(202, started.statusCode(), started.body());
        assertEquals(LocalLlmRunner.Provider.CODEX, state.llmProvider);
        assertEquals(LocalLlmRunner.Role.EXPLORER, state.llmRole);
        assertEquals(state.record.service + "/", state.llmTarget);

        HttpResponse<String> followup = post("/api/llm-run", "action=followup&message=explain+evidence", token);
        assertEquals(202, followup.statusCode(), followup.body());
        assertEquals("explain evidence", state.llmFollowup);

        JsonNode cancelled = json(post("/api/llm-run", "action=cancel", token));
        assertEquals("CANCELLED", cancelled.at("/run/status").asText());
        assertTrue(state.llmCancelled);
    }

    @Test
    void editsServiceBoundAccountPolicyAndHumanReview() throws Exception {
        start();
        JsonNode account = json(post("/api/account-save", "label=USER+A&role=User&target=https%3A%2F%2Fapi.example.test", token));
        String accountId = account.path("id").asText();
        assertFalse(accountId.isBlank());

        assertEquals(400, post("/api/session-bind", "fingerprint=" + encode(state.record.fp)
                + "&account=" + encode(accountId), token).statusCode());
        JsonNode bound = json(post("/api/session-bind", "service=" + encode(state.record.service)
                + "&fingerprint=" + encode(state.record.fp) + "&account=" + encode(accountId), token));
        assertTrue(bound.path("success").asBoolean());
        assertEquals(accountId, state.config.boundAccount(state.record.service, state.record.fp).orElseThrow().id());
        JsonNode accountSnapshot = json(get("/api/snapshot", token, origin()));
        assertEquals(accountId, accountSnapshot.at("/sessions/0/accountId").asText());
        assertEquals("COOKIE", accountSnapshot.at("/sessions/0/artifactKind").asText());

        String operation = state.snapshot().records.getFirst().op;
        assertEquals(200, post("/api/requirement", "operation=" + encode(operation) + "&role=Admin", token).statusCode());
        assertEquals("Admin", state.config.endpointRequirement(operation).label());
        assertEquals(200, post("/api/traffic-override", "operation=" + encode(operation)
                + "&value=EXCLUDE", token).statusCode());
        assertEquals(io.flowscope.core.TrafficOverride.EXCLUDE, state.config.trafficOverride(operation));
        assertEquals(0, state.snapshot().coverageRecords.size());
        assertEquals(1, state.snapshot().records.size());
        assertEquals(200, post("/api/traffic-override", "operation=" + encode(operation)
                + "&value=AUTO", token).statusCode());

        state.config.upsertAccount(new AccountProfile("owner", "OWNER", state.record.service, AccessRole.USER));
        state.config.withResourceOwner(state.snapshot().records.getFirst().resource, "owner");
        state.rebuild();
        String findingId = state.snapshot().analysis.findings().getFirst().id();
        assertEquals(200, post("/api/review", "itemId=" + encode(findingId)
                + "&status=CONFIRMED&note=manual+reproduction", token).statusCode());
        assertEquals("CONFIRMED", state.config.reviews().get(findingId).status().name());
    }

    @Test
    void opensOnlyStoredEvidenceAsAnUnsentRepeaterDraft() throws Exception {
        start();
        String evidenceId = state.snapshot().records.getFirst().evidenceId;
        JsonNode response = json(post("/api/replay", "eventId=" + encode(evidenceId), token));
        assertTrue(response.path("openedDraft").asBoolean());
        assertTrue(state.opened.get());
        assertEquals("", response.path("replayId").asText());
    }

    @Test
    void snapshotIsLightweightAndObjectlessEvidenceLoadsMaskedOnDemand() throws Exception {
        RequestRecord health = new RequestRecord(Source.HUMAN, state.record.service,
                "GET", "/health", 200, "sess:health");
        health.reqText = "GET /health HTTP/1.1\r\nHost: api.example.test\r\nCookie: session=raw-secret";
        health.respText = "HTTP/1.1 200 OK\r\nSet-Cookie: session=response-secret\r\n\r\n{\"token\":\"body-secret\"}";
        health.body = "{\"token\":\"body-secret\"}";
        health.hasResponse = true;
        state.records.add(health);
        state.rebuild();
        start();

        JsonNode snapshot = json(get("/api/snapshot", token, origin()));
        JsonNode event = snapshot.path("events").findValuesAsText("path").contains("/health")
                ? java.util.stream.StreamSupport.stream(snapshot.path("events").spliterator(), false)
                        .filter(value -> value.path("path").asText().equals("/health")).findFirst().orElseThrow()
                : fail("objectless event missing");
        assertTrue(event.path("resource").isNull());
        assertFalse(event.has("reqText"));
        assertFalse(event.has("respText"));
        assertFalse(snapshot.toString().contains("raw-secret"));

        JsonNode evidence = json(get("/api/evidence?operation=" + encode(event.path("op").asText()), token, origin()));
        assertEquals(1, evidence.path("total").asInt());
        assertFalse(evidence.path("hasMore").asBoolean());
        assertTrue(evidence.at("/records/0/request").asText().contains("session=***"));
        assertTrue(evidence.at("/records/0/response").asText().contains("session=***"));
        assertFalse(evidence.toString().contains("body-secret"));
    }

    @Test
    void boundsEvidenceDetailAndReportsPaginationHonestly() throws Exception {
        for (int i = 0; i < 205; i++) {
            RequestRecord copy = new RequestRecord(Source.HUMAN, state.record.service,
                    "GET", "/v1/orders/7", 200, "sess:page-" + i);
            copy.reqText = "GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test";
            copy.respText = "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}";
            copy.body = "{\"id\":7}";
            copy.hasResponse = true;
            copy.timestamp = i + 2L;
            state.records.add(copy);
        }
        state.rebuild();
        start();

        JsonNode first = json(get("/api/evidence?operation=" + encode(state.record.op), token, origin()));
        assertEquals(206, first.path("total").asInt());
        assertEquals(200, first.path("records").size());
        assertTrue(first.path("hasMore").asBoolean());

        JsonNode second = json(get("/api/evidence?operation=" + encode(state.record.op)
                + "&offset=200&limit=200", token, origin()));
        assertEquals(6, second.path("records").size());
        assertFalse(second.path("hasMore").asBoolean());
    }

    private void start() throws Exception {
        server = new FlowScopeWebServer(state, 0);
        server.start();
        String html = get("/", null, null).body();
        var matcher = Pattern.compile("name=\"flowscope-capability\" content=\"([0-9a-f]{64})\"").matcher(html);
        assertTrue(matcher.find());
        token = matcher.group(1);
    }

    private void activateSession(String accountId, String token) {
        AccountProfile account = state.config.account(accountId).orElseThrow();
        String handle = state.sessions.beginCapture(account, java.time.Instant.EPOCH);
        state.sessions.observeRequest(handle, URI.create(state.record.service + "/login"),
                Map.of("Authorization", "Bearer " + token), java.time.Instant.EPOCH);
        state.sessions.observeResponse(handle, URI.create(state.record.service + "/me"), 200, null,
                "{\"id\":\"" + accountId + "\"}", List.of(), java.time.Instant.EPOCH);
        state.sessions.endCapture(handle);
    }

    private HttpResponse<String> get(String path, String capability, String origin) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path)).GET();
        if (capability != null) request.header("X-FlowScope-Token", capability);
        if (origin != null) request.header("Origin", origin);
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String body, String capability) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(server.url().substring(0, server.url().length() - 1) + path))
                .header("X-FlowScope-Token", capability)
                .header("Origin", origin())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String origin() { return server.url().substring(0, server.url().length() - 1); }
    private static JsonNode json(HttpResponse<String> response) throws Exception {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private static final class TestState implements FlowScopeWebServer.State {
        private final AnalysisConfig config = new AnalysisConfig();
        private final List<RequestRecord> records = new ArrayList<>();
        private final AtomicLong revision = new AtomicLong();
        private final AtomicBoolean opened = new AtomicBoolean();
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final SessionBroker sessions = new SessionBroker();
        private final RequestRecord record;
        private volatile String scannerTarget = "";
        private volatile List<String> scannerScope;
        private volatile List<String> scannerAccounts = List.of();
        private volatile boolean scannerAnonymous;
        private volatile LocalLlmRunner.Provider llmProvider;
        private volatile LocalLlmRunner.Role llmRole;
        private volatile String llmTarget = "";
        private volatile boolean llmCancelled;
        private volatile String llmFollowup = "";
        private volatile Pipeline.Result result;
        private final List<RouteCandidate> routeCandidates = List.of(new RouteCandidate(
                "https://api.example.test:443", "UNKNOWN", "/v1/admin", false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.HTML_LINK,
                        "ev-route", Source.HUMAN, "human-run", "html-dom")),
                RouteCandidate.Applicability.REVIEW, "HTML 링크는 method를 증명하지 않음"));

        TestState() {
            record = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                    "GET", "/v1/orders/7", 200, "sess:abcdef123456");
            record.reqText = "GET /v1/orders/7 HTTP/1.1\r\nHost: api.example.test\r\nCookie: [masked]";
            record.respText = "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}";
            record.requestPayload = StoredPayload.capture(record.reqText, "", 1024 * 1024);
            record.responsePayload = StoredPayload.capture(record.respText, "", 1024 * 1024);
            record.body = "{\"id\":7}";
            record.hasResponse = true;
            record.timestamp = 1;
            records.add(record);
            scannerScope = List.of(record.service + "/");
            rebuild();
        }

        @Override public Pipeline.Result snapshot() { return result; }
        @Override public long revision() { return revision.get(); }
        @Override public AnalysisConfig config() { return config; }
        @Override public List<McpServer.Assessment> assessments() { return List.of(); }
        @Override public List<ValidationDecision> validations() { return List.of(); }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public SessionBroker sessions() { return sessions; }
        @Override public List<String> scopeEntries() { return scannerScope; }
        @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
        @Override public JsonNode startScanner(String target, List<String> accountIds, boolean includeAnonymous) {
            scannerTarget = target;
            scannerAccounts = List.copyOf(accountIds);
            scannerAnonymous = includeAnonymous;
            return JSON.createObjectNode().put("status", "RUNNING").put("stage", "TRADITIONAL_SPIDER");
        }
        @Override public JsonNode scannerStatus() {
            return JSON.createObjectNode().put("status", "NOT_STARTED");
        }
        @Override public JsonNode startLlm(LocalLlmRunner.Provider provider, LocalLlmRunner.Role role,
                                           String target, String accountId) {
            llmProvider = provider;
            llmRole = role;
            llmTarget = target;
            return JSON.createObjectNode().put("status", "RUNNING").put("provider", provider.name())
                    .put("role", role.name()).set("providers", JSON.createObjectNode()
                            .put("CODEX", true).put("CLAUDE", true));
        }
        @Override public JsonNode llmStatus() {
            return JSON.createObjectNode().put("status", "IDLE").set("providers", JSON.createObjectNode()
                    .put("CODEX", true).put("CLAUDE", true));
        }
        @Override public JsonNode cancelLlm() {
            llmCancelled = true;
            return JSON.createObjectNode().put("status", "CANCELLED").set("providers", JSON.createObjectNode()
                    .put("CODEX", true).put("CLAUDE", true));
        }
        @Override public JsonNode followUpJudge(String message) {
            llmFollowup = message;
            return JSON.createObjectNode().put("status", "RUNNING").put("role", "JUDGE")
                    .set("providers", JSON.createObjectNode().put("CODEX", true).put("CLAUDE", true));
        }
        @Override public void rebuild() { result = Pipeline.run(new ArrayList<>(records), config); revision.incrementAndGet(); }
        @Override public void clearTraffic() { records.clear(); rebuild(); }
        @Override public void loadSample() { }
        @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
            BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
            records.addAll(parsed.records);
            rebuild();
            return parsed;
        }
        @Override public RequestRecord openInRepeater(String evidenceId) {
            RequestRecord value = result.records.stream().filter(item -> item.evidenceId.equals(evidenceId)).findFirst().orElseThrow();
            opened.set(true);
            return value;
        }
    }
}
