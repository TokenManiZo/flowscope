package io.flowscope.core;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** 네트워크 요청을 보내지 않는 제품 온보딩용 샘플 프로젝트. */
public final class SampleProject {
    public record Data(List<RequestRecord> records, AnalysisConfig config) {}

    private static final String SERVICE = "https://demo.flowscope.test:443";
    private static final long START = Instant.parse("2026-08-24T00:00:00Z").toEpochMilli();

    private SampleProject() {}

    public static Data create() {
        AnalysisConfig config = new AnalysisConfig();
        AccountProfile userA = new AccountProfile("acct-demo-user-a", "USER A", SERVICE, AccessRole.USER);
        AccountProfile userB = new AccountProfile("acct-demo-user-b", "USER B", SERVICE, AccessRole.USER);
        AccountProfile admin = new AccountProfile("acct-demo-admin", "ADMIN", SERVICE, AccessRole.ADMIN);
        config.upsertAccount(userA).upsertAccount(userB).upsertAccount(admin)
                .bindSession(SERVICE, "sess:demo-a", userA.id())
                .bindSession(SERVICE, "sess:demo-a-rotated", userA.id())
                .bindSession(SERVICE, "sess:demo-b", userB.id())
                .bindSession(SERVICE, "sess:demo-admin", admin.id())
                .withResourceOwner(SERVICE + " orders:101", userA.id())
                .withResourceOwner(SERVICE + " orders:202", userB.id())
                .withResourceOwner(SERVICE + " posts:301", userA.id())
                .withResourceOwner(SERVICE + " posts:302", userB.id())
                .withEndpointRequirement(SERVICE + " GET /api/admin/users", AccessRole.ADMIN)
                .withEndpointRequirement(SERVICE + " POST /api/admin/invites", AccessRole.ADMIN);

        List<RequestRecord> records = new ArrayList<>();
        records.add(record(Source.HUMAN, userA.id(), "sess:demo-a", "GET", "/api/orders/101", 200, null,
                "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"total\":12000}", 0));
        records.add(record(Source.HUMAN, userA.id(), "sess:demo-a-rotated", "PATCH", "/api/orders/101", 200,
                "{\"status\":\"READY\"}", "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"status\":\"READY\"}", 1));
        records.add(record(Source.HUMAN, userB.id(), "sess:demo-b", "GET", "/api/orders/202", 200, null,
                "{\"id\":202,\"ownerId\":\"acct-demo-user-b\",\"total\":8300}", 2));
        records.add(record(Source.HUMAN, userA.id(), "sess:demo-a", "POST", "/api/admin/invites", 403,
                "{\"email\":\"user-b@example.test\"}", "{\"error\":\"forbidden\"}", 3));
        records.add(record(Source.HUMAN, admin.id(), "sess:demo-admin", "GET", "/api/admin/users", 200, null,
                "[{\"id\":\"acct-demo-user-a\"},{\"id\":\"acct-demo-user-b\"}]", 4));

        records.add(record(Source.SCANNER, userB.id(), "sess:demo-b", "GET", "/api/orders/101", 403, null,
                "{\"error\":\"forbidden\"}", 5));
        records.add(record(Source.SCANNER, userB.id(), "sess:demo-b", "OPTIONS", "/api/orders/101", 200, null, "", 6));

        records.add(record(Source.LLM, userB.id(), "sess:demo-b", "GET", "/api/orders/101", 200, null,
                "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"total\":12000}", 7));
        records.add(record(Source.LLM, userA.id(), "sess:demo-a", "POST", "/api/admin/invites", 200,
                "{\"email\":\"user-b@example.test\"}", "{\"created\":true}", 8));
        records.add(record(Source.LLM, userA.id(), "sess:demo-a", "GET", "/api/orders/202", 404, null,
                "{\"error\":\"not found\"}", 9));

        // API group drill-down examples (PR #11): identity-bound APIs intentionally have no dummy Object.
        records.add(record(Source.HUMAN, userA.id(), "sess:demo-a", "GET", "/api/profile", 200, null,
                "{\"displayName\":\"USER A\"}", 10));
        records.add(record(Source.LLM, userB.id(), "sess:demo-b", "GET", "/api/profile", 200, null,
                "{\"displayName\":\"USER B\"}", 11));
        records.add(record(Source.HUMAN, userB.id(), "sess:demo-b", "GET", "/api/account", 200, null,
                "{\"plan\":\"demo\"}", 12));
        records.add(record(Source.LLM, userA.id(), "sess:demo-a", "GET", "/api/account", 200, null,
                "{\"plan\":\"demo\"}", 13));

        // Object-backed group example with two owners and a denied cross-owner scanner request.
        records.add(record(Source.HUMAN, userA.id(), "sess:demo-a", "GET", "/api/posts/301", 200, null,
                "{\"id\":301,\"ownerId\":\"acct-demo-user-a\",\"title\":\"First post\"}", 14));
        records.add(record(Source.HUMAN, userB.id(), "sess:demo-b", "GET", "/api/posts/302", 200, null,
                "{\"id\":302,\"ownerId\":\"acct-demo-user-b\",\"title\":\"Second post\"}", 15));
        records.add(record(Source.SCANNER, userB.id(), "sess:demo-b", "GET", "/api/posts/301", 403, null,
                "{\"error\":\"forbidden\"}", 16));

        RequestRecord login = record(Source.HUMAN, userA.id(), "sess:demo-a", "POST", "/login", 302,
                "{\"username\":\"demo\",\"password\":\"demo-password\"}", "", 17);
        login.phase = RunPhase.SESSION_SETUP;
        records.add(login);
        for (int i = 0; i < 3; i++) {
            RequestRecord polling = record(Source.HUMAN, userA.id(), "sess:demo-a", "GET", "/session/state", 200,
                    null, "ready", 18 + i);
            polling.responseContentType = "text/plain";
            records.add(polling);
        }
        return new Data(List.copyOf(records), config);
    }

    private static RequestRecord record(Source source, String identity, String fingerprint, String method, String path,
                                        int status, String requestBody, String responseBody, int offset) {
        RequestRecord record = new RequestRecord(source, SERVICE, method, path, status, fingerprint);
        record.collectionAccountId = identity;
        record.reqBody = requestBody;
        record.query = null;
        record.reqText = method + " " + path + " HTTP/1.1\r\nHost: demo.flowscope.test\r\n"
                + "Authorization: Bearer " + fingerprint.substring(fingerprint.indexOf(':') + 1) + "-token\r\n\r\n"
                + (requestBody == null ? "" : requestBody);
        record.body = responseBody;
        record.respText = "HTTP/1.1 " + status + " Demo\r\nContent-Type: application/json\r\n\r\n"
                + (responseBody == null ? "" : responseBody);
        record.requestPayload = StoredPayload.capture(record.reqText, "", 1024 * 1024);
        record.responsePayload = StoredPayload.capture(record.respText, "", 1024 * 1024);
        // The demo responses are JSON API representations; record the media type the way a live capture would
        // so identity-bound APIs without an object signal still classify as API traffic.
        if (requestBody != null) record.requestContentType = "application/json";
        if (responseBody != null && !responseBody.isEmpty()) record.responseContentType = "application/json";
        record.hasResponse = true;
        record.timestamp = START + offset * 1_000L;
        record.runId = source == Source.HUMAN ? "demo-human"
                : source == Source.SCANNER ? "demo-zap" : "demo-llm-explorer";
        record.sourceDetail = source == Source.HUMAN ? SourceDetail.BROWSER
                : source == Source.SCANNER ? SourceDetail.ZAP_CLIENT_SPIDER : SourceDetail.LLM_EXPLORER;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        record.tool = source == Source.HUMAN ? ToolKind.BROWSER
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.CODEX;
        record.phase = RunPhase.EXPLORATION;
        return record;
    }
}
