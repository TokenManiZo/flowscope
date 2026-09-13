package io.flowscope.diag;

import io.flowscope.core.Fingerprints;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.graph.FlowGraph;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 정직한 스트레스 진단 (짜고치기 방지). 큐레이션 안 한 '지저분한' 트래픽을 만들어
 * 현재 L0 파이프라인(정규화+그래프)을 그대로 돌리고, 무너지는 지점을 수치로 뱉는다.
 * 실행: java -cp target/classes io.flowscope.diag.StressDiagnostic
 */
public final class StressDiagnostic {

    public static void main(String[] args) {
        List<RequestRecord> recs = messyCapture();
        Pipeline.Result res = Pipeline.run(recs);
        FlowGraph g = res.graph;

        long scopeRes = g.nodes().stream()
                .filter(n -> n.type == FlowGraph.NodeType.RESOURCE && n.label.startsWith("scope:"))
                .count();
        long identities = g.nodeCount(FlowGraph.NodeType.IDENTITY);
        long resources = g.nodeCount(FlowGraph.NodeType.RESOURCE);
        long operations = g.nodeCount(FlowGraph.NodeType.OPERATION);

        p("=== 입력 ===");
        p("총 요청 레코드            : " + recs.size());
        p("커버리지 제외(원본 보존)  : " + res.excludedCount + "  -> 분석 대상 " + res.kept() + "건");
        p("");
        p("=== 그래프 규모 (털뭉치 여부) ===");
        p("노드 총합                 : " + g.nodeCount());
        p("  - 신원(identity)        : " + identities);
        p("  - 자원(resource)        : " + resources);
        p("  - 오퍼레이션(operation) : " + operations);
        p("엣지                      : " + g.edgeCount());
        p("");
        p("=== 무너지는 지점 (숫자로) ===");
        p("미식별 자원 'scope:' 노드 : " + scopeRes + " / " + resources
                + "  (" + pct(scopeRes, resources) + "% — 정적자산·쿼리ID·GraphQL이 여기로 뭉침)");
        p("신원 수                   : " + identities + "  (안정 사용자 4명 + JWT회전 1명이 묶여야, 불투명회전 ~5는 물려받는 한계)");
        p("GraphQL                   : 아래 참조");
        graphqlCollapse(recs, g);
        p("");
        p("=== 판정 ===");
        boolean hairball = g.nodeCount() > 60;
        boolean noiseHeavy = scopeRes * 100 / Math.max(resources, 1) > 40;
        boolean idExplosion = identities > 10;
        p("털뭉치(노드>60)           : " + hairball);
        p("노이즈 과다(scope>40%)    : " + noiseHeavy);
        p("신원 폭발(>10)            : " + idExplosion);
        p((hairball || noiseHeavy || idExplosion)
                ? ">>> 실데이터에서 L0는 아직 제품으로 부적합. 노이즈필터·정규화(쿼리/GraphQL)·신원정규화·스케일 필요."
                : ">>> 의외로 버팀.");
    }

    /** 큐레이션하지 않은 현실적 노이즈 캡처. */
    static List<RequestRecord> messyCapture() {
        List<RequestRecord> r = new ArrayList<>();
        Random rnd = new Random(42);
        String uA = "session=AAA", uB = "session=BBB", admin = "session=ADM";

        // 1) 정적 자산·노이즈 (SPA 로딩) — 해시 파일명 포함
        String[] assets = {"/static/app", "/static/vendor", "/assets/main", "/assets/chunk"};
        for (int i = 0; i < 60; i++) {
            String hash = Integer.toHexString(rnd.nextInt());
            String path = assets[rnd.nextInt(assets.length)] + "." + hash + ".js";
            r.add(rec(Source.HUMAN, "GET", path, 200, uA));
        }
        r.add(rec(Source.HUMAN, "GET", "/favicon.ico", 200, uA));
        r.add(rec(Source.HUMAN, "GET", "/robots.txt", 200, uA));
        for (int i = 0; i < 8; i++) r.add(rec(Source.HUMAN, "GET", "/images/thumb/" + rnd.nextInt(500) + ".png", 200, uA));

        // 2) 애널리틱스/텔레메트리
        for (int i = 0; i < 10; i++) r.add(rec(Source.HUMAN, "POST", "/collect", 204, uA));
        r.add(rec(Source.HUMAN, "GET", "/gtag/js", 200, uA));

        // 3) 진짜 REST API — 숫자 id 다수 (여기가 값어치)
        for (int i = 0; i < 25; i++) {
            int oid = 100 + rnd.nextInt(40);
            r.add(rec(rnd.nextBoolean() ? Source.HUMAN : Source.SCANNER, "GET", "/api/orders/" + oid, 200, rnd.nextBoolean() ? uA : uB));
        }
        for (int i = 0; i < 10; i++) {
            int oid = 100 + rnd.nextInt(10), item = rnd.nextInt(5);
            r.add(rec(Source.HUMAN, "GET", "/api/orders/" + oid + "/items/" + item, 200, uA));
        }
        for (int i = 0; i < 8; i++) r.add(rec(Source.SCANNER, "GET", "/api/users/" + (1 + rnd.nextInt(5)), 200, admin));

        // 4) 쿼리파라미터로 객체 지시 (파이프라인이 ? 를 버림 → 자원 소실)
        for (int i = 0; i < 12; i++) r.add(rec(Source.HUMAN, "GET", "/api/search?userId=" + rnd.nextInt(9), 200, uA));
        for (int i = 0; i < 6; i++) r.add(rec(Source.SCANNER, "GET", "/api/invoice?id=" + rnd.nextInt(99), 200, uB));

        // 5) GraphQL — 전부 POST /graphql (operation 이 본문에 있어 한 노드로 붕괴)
        for (int i = 0; i < 15; i++) r.add(rec(Source.HUMAN, "POST", "/graphql", 200, uA));

        // 6a) JWT 사용자 — 세션쿠키는 매 요청 회전하지만 논리적으로 1명. JWT sub 로 묶여야 한다.
        String jwt = "h." + b64url("{\"sub\":\"roamer\"}") + ".s";
        for (int i = 0; i < 20; i++) r.add(rec(Source.HUMAN, "GET", "/api/profile/" + (1 + rnd.nextInt(3)), 200,
                "Bearer " + jwt, "session=" + Integer.toHexString(rnd.nextInt())));

        // 6b) 순수 불투명 회전 토큰 — 안정 신호 전무. 못 묶는다(물려받는 한계 Q5).
        for (int i = 0; i < 5; i++) r.add(rec(Source.HUMAN, "GET", "/api/opaque/" + (1 + rnd.nextInt(2)), 200,
                null, "session=" + Integer.toHexString(rnd.nextInt())));

        return r;
    }

    static void graphqlCollapse(List<RequestRecord> recs, FlowGraph g) {
        long gqlReqs = recs.stream().filter(x -> x.path.equals("/graphql")).count();
        long gqlNodes = g.nodes().stream().filter(n -> n.label.contains("/graphql")).count();
        p("  GraphQL 요청 " + gqlReqs + "건 -> operation 노드 " + gqlNodes
                + "개 (서로 다른 쿼리가 1노드로 붕괴 — 객체 구분 불가)");
    }

    private static RequestRecord rec(Source s, String m, String p, int st, String cookie) {
        return rec(s, m, p, st, null, cookie);
    }

    /** 실제 fp 로직(Fingerprints)을 그대로 태운다. 쿼리스트링은 파서처럼 버려진다. */
    private static RequestRecord rec(Source s, String m, String p, int st, String auth, String cookie) {
        String path = p.split("\\?")[0];
        return new RequestRecord(s, "https://api.shop.test:443", m, path, st, Fingerprints.of(auth, cookie));
    }

    private static String b64url(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private static String pct(long a, long b) { return b == 0 ? "0" : String.valueOf(a * 100 / b); }
    private static void p(String s) { System.out.println(s); }
}
