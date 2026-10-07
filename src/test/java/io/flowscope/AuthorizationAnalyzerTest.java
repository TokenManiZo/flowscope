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
        AuthorizationAnalysis.OwnerInfo owner = a.owners().get(r.resource);

        assertEquals(20, owner.confidence());
        assertFalse(owner.confirmed(), "첫 성공 접근자 O1은 판정 가능한 소유자가 아니다");
        assertFalse(owner.decisionGrade(), "첫 성공 접근자 O1은 confidence 게이트를 통과하면 안 된다");
        assertEquals(Verdict.UNTESTED, a.cells().get(0).overall());
        assertTrue(a.findings().isEmpty());
    }

    @Test
    void 단일_신원_컬렉션_멤버십은_O2이고_타신원_ID일치_응답은_BOLA다() {
        RequestRecord ownerCollection = rec(Source.HUMAN, "A", "GET", "/api/orders", 200,
                "{\"orders\":[{\"id\":701}]}");
        ownerCollection.responseContentType = "application/json";
        RequestRecord crossRead = rec(Source.SCANNER, "B", "GET", "/api/orders/701", 200,
                "{\"id\":701}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(ownerCollection, crossRead)).analysis;
        AuthorizationAnalysis.OwnerInfo owner = analysis.owners().get(crossRead.resource);
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(cell -> cell.key().identity().equals("user-b")
                        && cell.key().resource().equals(crossRead.resource))
                .findFirst().orElseThrow();

        assertEquals("user-a", owner.identity());
        assertEquals(60, owner.confidence());
        assertFalse(owner.confirmed(), "O2는 명시 소유필드 O3와 구분한다");
        assertTrue(owner.decisionGrade(), "단일 신원 컬렉션 멤버십 O2는 정본 판정 게이트를 통과한다");
        assertTrue(owner.basis().contains("컬렉션 멤버십"));
        assertEquals(Verdict.SUSPICIOUS, cross.overall());
        assertTrue(analysis.findings().stream().anyMatch(finding ->
                finding.type() == AuthorizationAnalysis.FindingType.BOLA
                        && finding.cell().equals(cross.key())));
    }

    @Test
    void 생성_응답이_ID를_돌려준_POST_요청자는_O2_소유자이고_타신원_조회는_BOLA다() {
        RequestRecord create = rec(Source.HUMAN, "A", "POST", "/api/orders", 201, "{\"id\":801,\"status\":\"CREATED\"}");
        create.responseContentType = "application/json";
        RequestRecord crossRead = rec(Source.SCANNER, "B", "GET", "/api/orders/801", 200, "{\"id\":801}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(create, crossRead)).analysis;
        AuthorizationAnalysis.OwnerInfo owner = analysis.owners().get(crossRead.resource);
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(cell -> cell.key().identity().equals("user-b") && crossRead.resource.equals(cell.key().resource()))
                .findFirst().orElseThrow();

        assertEquals("user-a", owner.identity());
        assertEquals(80, owner.confidence());
        assertFalse(owner.confirmed(), "생성 요청자는 명시 소유필드 O3가 아니라 O2다");
        assertTrue(owner.decisionGrade());
        assertTrue(owner.basis().contains("생성 요청자"));
        assertEquals(Verdict.SUSPICIOUS, cross.overall());
    }

    @Test
    void 중첩_컬렉션_생성과_한_단계_아래_id도_생성자로_잇는다() {
        RequestRecord create = rec(Source.HUMAN, "A", "POST", "/api/users/5/orders", 200, "{\"order\":{\"id\":\"ab12\"}}");
        create.responseContentType = "application/json";
        RequestRecord read = rec(Source.HUMAN, "B", "GET", "/api/users/5/orders/ab12", 200, "{\"id\":\"ab12\"}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(create, read)).analysis;

        assertEquals("user-a", analysis.owners().get(read.resource).identity());
    }

    @Test
    void 비로그인_생성과_두_신원이_같은_ID를_돌려받은_생성은_소유_근거가_아니다() {
        RequestRecord anonymousCreate = rec(Source.HUMAN, Fingerprints.ANONYMOUS, "POST", "/api/tickets", 201, "{\"id\":901}");
        anonymousCreate.responseContentType = "application/json";
        RequestRecord ticketRead = rec(Source.HUMAN, "B", "GET", "/api/tickets/901", 200, "{\"id\":901}");
        RequestRecord firstCreate = rec(Source.HUMAN, "A", "POST", "/api/carts", 201, "{\"id\":902}");
        firstCreate.responseContentType = "application/json";
        RequestRecord secondCreate = rec(Source.HUMAN, "B", "POST", "/api/carts", 201, "{\"id\":902}");
        secondCreate.responseContentType = "application/json";
        RequestRecord cartRead = rec(Source.SCANNER, "C", "GET", "/api/carts/902", 200, "{\"id\":902}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(anonymousCreate, ticketRead, firstCreate, secondCreate, cartRead)).analysis;

        assertFalse(analysis.owners().get(ticketRead.resource).basis().contains("생성 요청자"));
        AuthorizationAnalysis.OwnerInfo cart = analysis.owners().get(cartRead.resource);
        assertNull(cart.identity());
        assertFalse(cart.decisionGrade());
        assertTrue(cart.basis().contains("생성 응답 충돌"));
    }

    @Test
    void 응답의_명시적_소유필드는_생성_요청자보다_우선한다() {
        RequestRecord create = rec(Source.HUMAN, "A", "POST", "/api/notes", 201, "{\"id\":903}");
        create.responseContentType = "application/json";
        RequestRecord ownerRead = rec(Source.HUMAN, "B", "GET", "/api/notes/903", 200, "{\"id\":903,\"owner\":\"user-b\"}");
        ownerRead.responseContentType = "application/json";

        AuthorizationAnalysis analysis = Pipeline.run(List.of(create, ownerRead)).analysis;
        AuthorizationAnalysis.OwnerInfo owner = analysis.owners().get(ownerRead.resource);

        assertEquals("user-b", owner.identity());
        assertTrue(owner.confirmed(), "명시 소유필드 O3가 생성 요청자 O2를 이긴다");
    }

    @Test
    void 둘_이상_신원_컬렉션에_등장한_객체는_O0이며_후보가_아니다() {
        RequestRecord firstCollection = rec(Source.HUMAN, "A", "GET", "/api/orders", 200,
                "{\"orders\":[{\"id\":702}]}");
        firstCollection.responseContentType = "application/json";
        RequestRecord secondCollection = rec(Source.HUMAN, "B", "GET", "/api/orders", 200,
                "{\"orders\":[{\"id\":702}]}");
        secondCollection.responseContentType = "application/json";
        RequestRecord crossRead = rec(Source.SCANNER, "C", "GET", "/api/orders/702", 200,
                "{\"id\":702}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(firstCollection, secondCollection, crossRead)).analysis;
        AuthorizationAnalysis.OwnerInfo owner = analysis.owners().get(crossRead.resource);
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(cell -> cell.key().identity().equals("user-c")
                        && cell.key().resource().equals(crossRead.resource))
                .findFirst().orElseThrow();

        assertNull(owner.identity());
        assertEquals(0, owner.confidence());
        assertFalse(owner.confirmed());
        assertFalse(owner.decisionGrade());
        assertTrue(owner.basis().contains("공유/공개"));
        assertEquals(Verdict.UNTESTED, cross.overall());
        assertTrue(analysis.findings().stream().noneMatch(finding -> finding.cell().equals(cross.key())));
        assertTrue(analysis.gaps().stream().noneMatch(gap ->
                        gap.type() == AuthorizationAnalysis.GapType.UNCROSSED
                                && gap.resource().equals(crossRead.resource)),
                "공유/공개 O0 객체는 교차 추천도 만들면 안 된다");
    }

    @Test
    void 다른_operation_family의_동일_ID는_컬렉션_소유근거가_아니다() {
        RequestRecord unrelatedCollection = rec(Source.HUMAN, "A", "GET", "/api/customers", 200,
                "{\"customers\":[{\"id\":703}]}");
        unrelatedCollection.responseContentType = "application/json";
        RequestRecord orderRead = rec(Source.SCANNER, "B", "GET", "/api/orders/703", 200,
                "{\"id\":703}");

        AuthorizationAnalysis analysis = Pipeline.run(List.of(unrelatedCollection, orderRead)).analysis;
        AuthorizationAnalysis.OwnerInfo owner = analysis.owners().get(orderRead.resource);

        assertEquals("user-b", owner.identity());
        assertEquals(20, owner.confidence());
        assertFalse(owner.decisionGrade());
        assertTrue(analysis.findings().isEmpty());
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
    void PUBLIC_자원정책은_타소유자_읽기성공을_BOLA로_승격하지_않는다() {
        RequestRecord owner = rec(Source.HUMAN, "A", "GET", "/api/catalog/801", 200,
                "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}");
        RequestRecord reader = rec(Source.SCANNER, "B", "GET", "/api/catalog/801", 200,
                "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}");
        Normalizer.normalizeAll(List.of(owner, reader));
        AnalysisConfig config = new AnalysisConfig()
                .withIdentityRole("user-a", AccessRole.USER)
                .withIdentityRole("user-b", AccessRole.USER)
                .withEndpointRequirement(reader.op, AccessRole.USER)
                .withResourcePolicy(reader.resource, ResourcePolicy.PUBLIC);

        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(List.of(owner, reader), config);
        AuthorizationAnalysis.CoverageCell cross = analysis.cells().stream()
                .filter(cell -> cell.key().identity().equals("user-b")).findFirst().orElseThrow();

        assertEquals(Verdict.ALLOW, cross.overall());
        assertTrue(analysis.findings().stream().noneMatch(finding -> finding.cell().equals(cross.key())));
    }

    @Test
    void 소유자라도_ADMIN_요구_DELETE에_성공하면_기능층_BFLA다() {
        RequestRecord ownerRead = rec(Source.HUMAN, "A", "GET", "/api/orders/901", 200,
                "{\"id\":901,\"ownerId\":\"user-a\"}");
        RequestRecord ownerDelete = rec(Source.HUMAN, "A", "DELETE", "/api/orders/901", 204, "");
        Normalizer.normalizeAll(List.of(ownerRead, ownerDelete));
        AnalysisConfig config = new AnalysisConfig()
                .withIdentityRole("user-a", AccessRole.USER)
                .withEndpointRequirement(ownerDelete.op, AccessRole.ADMIN)
                .withResourcePolicy(ownerDelete.resource, ResourcePolicy.OWNER_ONLY);

        AuthorizationAnalysis analysis = AuthorizationAnalyzer.analyze(List.of(ownerRead, ownerDelete), config);
        AuthorizationAnalysis.CoverageCell delete = analysis.cells().stream()
                .filter(cell -> cell.key().operation().equals(ownerDelete.op)).findFirst().orElseThrow();

        assertEquals(Verdict.SUSPICIOUS, delete.overall());
        assertTrue(delete.perSource().values().stream().anyMatch(AuthorizationAnalysis.Decision::roleViolation));
        assertTrue(analysis.findings().stream().anyMatch(finding ->
                finding.type() == AuthorizationAnalysis.FindingType.BFLA && finding.cell().equals(delete.key())));
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
        serviceA.collectionAccountId = "user-a";
        serviceA.body = "{\"ownerId\":\"42\"}";
        serviceA.hasResponse = true;
        RequestRecord serviceB = new RequestRecord(Source.HUMAN, "https://b.test:443",
                "GET", "/orders/1", 200, "jwt:issuer:sub:42");
        serviceB.collectionAccountId = "user-b";
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
        owner.collectionAccountId = "user-a";
        owner.body = "{\"order\":{\"id\":7,\"user\":{\"email\":\"owner@example.test\"}}}";
        owner.hasResponse = true;
        RequestRecord attacker = new RequestRecord(Source.LLM, "https://t:443",
                "GET", "/api/orders/7", 200, "jwt:local:sub:attacker@example.test");
        attacker.collectionAccountId = "user-b";
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

    @Test
    void stableKey는_구분자가_포함돼도_서로_다른_셀을_구분한다() {
        AuthorizationAnalysis.CellKey left = new AuthorizationAnalysis.CellKey("a|b", "c", null);
        AuthorizationAnalysis.CellKey right = new AuthorizationAnalysis.CellKey("a", "b|c", null);

        assertNotEquals(left.stableKey(), right.stableKey());
        assertEquals("a|b|<none>", new AuthorizationAnalysis.CellKey("a", "b", null).stableKey(),
                "구분자가 없는 기존 셀의 finding/review ID는 유지한다");
    }

    @Test
    void 미확정권한은_요구권한을_충족한_제어계정이_아니다() {
        assertFalse(AccessRole.UNKNOWN.isKnownAndAtLeast(AccessRole.ADMIN));
        assertFalse(AccessRole.USER.isKnownAndAtLeast(AccessRole.UNKNOWN));
        assertTrue(AccessRole.ADMIN.isKnownAndAtLeast(AccessRole.USER));
    }

    @Test
    void 과도하게_중첩되거나_큰_응답은_소유자분석도_중단하고_파이프라인을_유지한다() {
        String deep = "{\"order\":".repeat(200) + "{\"owner\":\"user-a\"}" + "}".repeat(200);
        String huge = "{\"owner\":\"user-a\",\"padding\":\"" + "x".repeat(1_100_000) + "\"}";
        RequestRecord deepRecord = rec(Source.HUMAN, "A", "GET", "/api/orders/7", 200, deep);
        RequestRecord hugeRecord = rec(Source.HUMAN, "A", "GET", "/api/orders/8", 200, huge);

        Pipeline.Result result = assertDoesNotThrow(() -> Pipeline.run(List.of(deepRecord, hugeRecord)));

        assertTrue(result.analysis.owners().values().stream().noneMatch(AuthorizationAnalysis.OwnerInfo::confirmed));
    }

    private static RequestRecord rec(Source source, String fp, String method, String path, int status, String body) {
        RequestRecord r = new RequestRecord(source, "https://t:443", method, path, status, fp);
        r.collectionAccountId = switch (fp) {
            case "A" -> "user-a";
            case "B" -> "user-b";
            case "C" -> "user-c";
            case "anon" -> "anon";
            default -> "user-a";
        };
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
