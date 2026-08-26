package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AuthorizationAnalyzerTest {

    @Test
    void 소유자와_타인접근을_본문근거로_BOLA_판정한다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"owner\":\"user-a\"}"));
        records.add(rec(Source.SCANNER, "B", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"owner\":\"user-a\"}"));
        records.add(rec(Source.LLM, "B", "GET", "/api/orders/101", 403,
                "{\"error\":\"forbidden\"}"));

        Pipeline.Result result = Pipeline.run(records);
        AuthorizationAnalysis analysis = result.analysis;

        assertEquals("user-a", analysis.owners().values().iterator().next().identity());
        assertTrue(analysis.findings().stream().anyMatch(f -> f.type() == AuthorizationAnalysis.FindingType.BOLA));
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(c -> c.key().identity().equals("user-b")).findFirst().orElseThrow();
        assertEquals(Verdict.SUSPICIOUS, cross.perSource().get(Source.SCANNER).verdict());
        assertEquals(Verdict.DENY, cross.perSource().get(Source.LLM).verdict());
        assertTrue(cross.conflict(), "같은 조합의 소스별 판정 차이를 보존");
        assertTrue(cross.evidenceIds().stream().allMatch(id -> id.startsWith("ev-")));
    }

    @Test
    void 쓰기_204는_빈본문이어도_타인객체면_의심이다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"owner\":\"user-a\"}"));
        records.add(rec(Source.LLM, "B", "DELETE", "/api/orders/101", 204, ""));

        AuthorizationAnalysis a = Pipeline.run(records).analysis;
        AuthorizationAnalysis.CoverageCell cell = a.cells().stream()
                .filter(c -> c.key().operation().contains("DELETE")).findFirst().orElseThrow();
        assertEquals(Verdict.SUSPICIOUS, cell.overall());
    }

    @Test
    void 소유자_근거가_없으면_취약으로_단정하지_않는다() {
        RequestRecord r = rec(Source.LLM, "A", "GET", "/api/orders/101", 200, "{\"id\":101}");
        AuthorizationAnalysis a = Pipeline.run(List.of(r)).analysis;
        assertEquals(Verdict.UNTESTED, a.cells().get(0).overall());
        assertTrue(a.findings().isEmpty());
    }

    @Test
    void 요청본문의_owner는_서버가_확인한_소유권_근거가_아니다() {
        RequestRecord r = rec(Source.HUMAN, "A", "PUT", "/api/orders/101", 200, "{\"ok\":true}");
        r.reqBody = "{\"owner\":\"user-a\"}";

        AuthorizationAnalysis analysis = Pipeline.run(List.of(r)).analysis;

        assertFalse(analysis.owners().get(r.resource).confirmed());
        assertEquals(Verdict.UNTESTED, analysis.cells().get(0).overall());
        assertTrue(analysis.findings().isEmpty());
    }

    @Test
    void 응답의_부분문자열만_일치하면_타인객체_노출로_보지_않는다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"owner\":\"user-a\"}"));
        records.add(rec(Source.SCANNER, "B", "GET", "/api/orders/101", 200,
                "{\"count\":1010,\"message\":\"owner-user-a-disabled\"}"));

        AuthorizationAnalysis analysis = Pipeline.run(records).analysis;
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(c -> c.key().identity().equals("user-b")).findFirst().orElseThrow();

        assertEquals(Verdict.UNDECIDED, cross.overall());
        assertTrue(analysis.findings().stream().noneMatch(f -> f.cell().equals(cross.key())));
    }

    @Test
    void 명시된_요구권한보다_낮은_신원의_성공은_BFLA다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "POST", "/api/admin/invites", 200, "{\"ok\":true}"));
        Normalizer.normalizeAll(records);
        String op = records.get(0).op;
        AnalysisConfig config = new AnalysisConfig()
                .withIdentityRole("user-a", AccessRole.USER)
                .withEndpointRequirement(op, AccessRole.ADMIN);

        AuthorizationAnalysis a = AuthorizationAnalyzer.analyze(records, config);
        assertEquals(Verdict.SUSPICIOUS, a.cells().get(0).overall());
        assertTrue(a.findings().stream().anyMatch(f -> f.type() == AuthorizationAnalysis.FindingType.BFLA));
    }

    @Test
    void 미교차는_확정소유자와_관측신원_안에서만_생성한다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"owner\":\"user-a\"}"));
        records.add(rec(Source.SCANNER, "B", "GET", "/api/profile/2", 200,
                "{\"id\":2,\"owner\":\"user-b\"}"));

        AuthorizationAnalysis a = Pipeline.run(records).analysis;
        assertTrue(a.gaps().stream().anyMatch(g -> g.type() == AuthorizationAnalysis.GapType.UNCROSSED
                && g.identity().equals("user-b") && g.operation().contains("orders")));
    }

    @Test
    void jwt_subject_소유자별칭은_서비스경계를_넘지_않는다() {
        RequestRecord serviceA = new RequestRecord(Source.HUMAN, "https://a.test:443",
                "GET", "/orders/1", 200, "jwt:issuer:sub:42");
        serviceA.body = "{\"ownerId\":\"42\"}";
        serviceA.hasResponse = true;
        RequestRecord serviceB = new RequestRecord(Source.HUMAN, "https://b.test:443",
                "GET", "/orders/1", 200, "jwt:issuer:sub:42");
        serviceB.body = "{\"ownerId\":\"42\"}";
        serviceB.hasResponse = true;

        AuthorizationAnalysis analysis = Pipeline.run(List.of(serviceA, serviceB)).analysis;
        assertEquals("user-a", analysis.owners().get(serviceA.resource).identity());
        assertEquals("user-b", analysis.owners().get(serviceB.resource).identity());
    }

    @Test
    void 사용자_소유자확정이_자동추정보다_우선하고_unknown은_기존role을_지운다() {
        List<RequestRecord> records = new ArrayList<>();
        records.add(rec(Source.HUMAN, "A", "GET", "/api/orders/101", 200, "{\"id\":101}"));
        records.add(rec(Source.HUMAN, "B", "GET", "/api/profile/2", 200, "{\"id\":2}"));
        Normalizer.normalizeAll(records);
        String resource = records.get(0).resource;
        AnalysisConfig configured = new AnalysisConfig()
                .withIdentityRole("user-a", AccessRole.USER)
                .withResourceOwner(resource, "user-b");

        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(records, configured);
        assertEquals("user-b", analysis.owners().get(resource).identity());
        assertEquals("사용자 명시 소유자", analysis.owners().get(resource).basis());
        assertEquals(AccessRole.USER, records.get(0).role);

        AuthorizationAnalyzer.analyze(records, new AnalysisConfig());
        assertEquals(AccessRole.UNKNOWN, records.get(0).role);
    }

    @Test
    void 중첩된_user_객체의_명시적_식별값으로_소유자를_연결한다() {
        RequestRecord owner = new RequestRecord(Source.HUMAN, "https://t:443",
                "GET", "/api/orders/7", 200, "jwt:local:sub:owner@example.test");
        owner.body = "{\"order\":{\"id\":7,\"user\":{\"email\":\"owner@example.test\"}}}";
        owner.hasResponse = true;
        RequestRecord attacker = new RequestRecord(Source.LLM, "https://t:443",
                "GET", "/api/orders/7", 200, "jwt:local:sub:attacker@example.test");
        attacker.body = owner.body;
        attacker.hasResponse = true;

        AuthorizationAnalysis analysis = Pipeline.run(List.of(owner, attacker)).analysis;

        AuthorizationAnalysis.OwnerInfo resolved = analysis.owners().values().iterator().next();
        assertTrue(resolved.confirmed());
        assertEquals(owner.idn, resolved.identity());
        assertTrue(analysis.findings().stream().anyMatch(finding ->
                finding.type() == AuthorizationAnalysis.FindingType.BOLA
                        && finding.cell().identity().equals(attacker.idn)));
    }

    @Test
    void 거부응답과_HEAD의_owner필드는_소유자확정에_쓰지_않는다() {
        RequestRecord denied = rec(Source.HUMAN, "A", "GET", "/api/orders/7", 403,
                "{\"owner\":\"user-a\"}");
        RequestRecord metadata = rec(Source.HUMAN, "A", "HEAD", "/api/orders/8", 200,
                "{\"owner\":\"user-a\"}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(denied, metadata)).analysis;

        assertFalse(analysis.owners().containsKey(denied.resource));
        assertFalse(analysis.owners().containsKey(metadata.resource));
        assertTrue(analysis.findings().isEmpty());
    }

    @Test
    void auth와_비슷한_정상_리다이렉트_경로를_로그인거부로_오인하지_않는다() {
        RequestRecord normalRedirect = rec(Source.HUMAN, "A", "GET", "/api/orders/7", 302, "");
        normalRedirect.location = "/authority/profile";
        RequestRecord loginRedirect = rec(Source.HUMAN, "A", "GET", "/api/orders/8", 302, "");
        loginRedirect.location = "/auth/login?next=/api/orders/8";

        AuthorizationAnalysis analysis = Pipeline.run(List.of(normalRedirect, loginRedirect)).analysis;

        AuthorizationAnalysis.CoverageCell normal = analysis.cells().stream()
                .filter(cell -> cell.key().resource().equals(normalRedirect.resource)).findFirst().orElseThrow();
        AuthorizationAnalysis.CoverageCell login = analysis.cells().stream()
                .filter(cell -> cell.key().resource().equals(loginRedirect.resource)).findFirst().orElseThrow();
        assertEquals(Verdict.UNDECIDED, normal.overall());
        assertEquals(Verdict.DENY, login.overall());
    }

    private static RequestRecord rec(Source source, String fp, String method, String path, int status, String body) {
        RequestRecord r = new RequestRecord(source, "https://t:443", method, path, status, fp);
        r.body = body;
        r.hasResponse = true;
        r.sourceDetail = switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.ZAP_ACTIVE_SCAN;
            case LLM -> SourceDetail.LLM_EXPLORER;
            case UNKNOWN -> SourceDetail.UNKNOWN;
        };
        return r;
    }
}
