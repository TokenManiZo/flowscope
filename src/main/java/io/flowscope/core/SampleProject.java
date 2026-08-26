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
                .withEndpointRequirement(SERVICE + " GET /api/admin/users", AccessRole.ADMIN)
                .withEndpointRequirement(SERVICE + " POST /api/admin/invites", AccessRole.ADMIN);

        List<RequestRecord> records = new ArrayList<>();
        records.add(record(Source.HUMAN, "sess:demo-a", "GET", "/api/orders/101", 200, null,
                "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"total\":12000}", 0));
        records.add(record(Source.HUMAN, "sess:demo-a-rotated", "PATCH", "/api/orders/101", 200,
                "{\"status\":\"READY\"}", "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"status\":\"READY\"}", 1));
        records.add(record(Source.HUMAN, "sess:demo-b", "GET", "/api/orders/202", 200, null,
                "{\"id\":202,\"ownerId\":\"acct-demo-user-b\",\"total\":8300}", 2));
        records.add(record(Source.HUMAN, "sess:demo-a", "POST", "/api/admin/invites", 403,
                "{\"email\":\"masked@example.test\"}", "{\"error\":\"forbidden\"}", 3));
        records.add(record(Source.HUMAN, "sess:demo-admin", "GET", "/api/admin/users", 200, null,
                "[{\"id\":\"acct-demo-user-a\"},{\"id\":\"acct-demo-user-b\"}]", 4));

        records.add(record(Source.SCANNER, "sess:demo-b", "GET", "/api/orders/101", 403, null,
                "{\"error\":\"forbidden\"}", 5));
        records.add(record(Source.SCANNER, "sess:demo-b", "OPTIONS", "/api/orders/101", 200, null, "", 6));

        records.add(record(Source.LLM, "sess:demo-b", "GET", "/api/orders/101", 200, null,
                "{\"id\":101,\"ownerId\":\"acct-demo-user-a\",\"total\":12000}", 7));
        records.add(record(Source.LLM, "sess:demo-a", "POST", "/api/admin/invites", 200,
                "{\"email\":\"masked@example.test\"}", "{\"created\":true}", 8));
        records.add(record(Source.LLM, "sess:demo-a", "GET", "/api/orders/202", 404, null,
                "{\"error\":\"not found\"}", 9));
        return new Data(List.copyOf(records), config);
    }

    private static RequestRecord record(Source source, String fingerprint, String method, String path,
                                        int status, String requestBody, String responseBody, int offset) {
        RequestRecord record = new RequestRecord(source, SERVICE, method, path, status, fingerprint);
        record.reqBody = requestBody;
        record.query = null;
        record.reqText = method + " " + path + " HTTP/1.1\r\nHost: demo.flowscope.test\r\n"
                + "Authorization: ***MASKED***\r\n\r\n" + (requestBody == null ? "" : requestBody);
        record.body = responseBody;
        record.respText = "HTTP/1.1 " + status + " Demo\r\nContent-Type: application/json\r\n\r\n"
                + (responseBody == null ? "" : responseBody);
        record.hasResponse = true;
        record.timestamp = START + offset * 1_000L;
        record.runId = source == Source.HUMAN ? "demo-human"
                : source == Source.SCANNER ? "demo-zap" : "demo-llm-explorer";
        record.sourceDetail = source == Source.HUMAN ? SourceDetail.BROWSER
                : source == Source.SCANNER ? SourceDetail.ZAP_SPIDER : SourceDetail.LLM_EXPLORER;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        record.tool = source == Source.HUMAN ? ToolKind.BROWSER
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.CODEX;
        record.phase = RunPhase.EXPLORATION;
        return record;
    }
}
