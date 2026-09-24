package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.AuthorizationMatrix;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ReviewDecision;
import io.flowscope.core.ResourcePolicy;
import io.flowscope.core.RunPhase;
import io.flowscope.core.SampleProject;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.Verdict;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * PR#12 AuthorizationMatrixAnalyzerTest 이식 + D-050/D-004 guard(D-144). 인가 판정 정본은 AuthorizationAnalysis이며
 * 매트릭스는 후보 여부를 다시 판정하지 않고 과거 검증 이력으로 승격하지 않는다.
 */
class AuthorizationMatrixAnalyzerTest {
    private static final String SERVICE = "https://matrix.test:443";

    @Test
    void 한_계정이_관측한_객체는_다른_동일역할_계정의_BOLA_IDOR_수동테스트로_추천한다() {
        AnalysisConfig config = users();
        Pipeline.Result result = Pipeline.run(List.of(record(Source.HUMAN, "tok:user-a",
                "GET", "/api/orders/24", 200, "{\"id\":24}")), config);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.ObjectCell recommendation = matrix.objects().stream()
                .filter(cell -> cell.identity().equals("user-b"))
                .findFirst().orElseThrow();

        assertEquals(AuthorizationMatrix.Status.BOLA_IDOR_TEST_RECOMMENDED, recommendation.status());
        assertEquals("BOLA/IDOR", recommendation.recommendation().type());
        assertEquals("user-a", recommendation.recommendation().basisIdentity());
        assertEquals("user-b", recommendation.recommendation().testIdentity());
        assertTrue(recommendation.ownership().level() < 2);
        assertFalse(recommendation.recommendation().basisEvidenceIds().isEmpty());
        assertTrue(matrix.summary().bolaIdorTestRecommendations() >= 1);

        config.reviewItem(recommendation.id(), ReviewDecision.Status.CONFIRMED,
                "Burp Repeater에서 다른 계정으로 재현", recommendation.reviewEvidenceIds());
        AuthorizationMatrix reviewed = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.ObjectCell confirmed = reviewed.objects().stream()
                .filter(cell -> cell.id().equals(recommendation.id())).findFirst().orElseThrow();
        assertEquals("CONFIRMED", confirmed.reviewStatus());
        assertEquals(1, reviewed.summary().humanConfirmed());
        assertEquals(0, reviewed.summary().bolaIdorTestRecommendations(), "사람이 판정한 추천은 열린 추천에서 빠진다");
    }

    @Test
    void 상위역할에서만_관측한_기능은_하위역할의_BFLA_수동테스트로_추천한다() {
        AnalysisConfig config = userAndAdmin();
        Pipeline.Result result = Pipeline.run(List.of(record(Source.HUMAN, "tok:admin",
                "GET", "/api/admin/export", 200, "{\"rows\":1}")), config);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.FunctionCell recommendation = matrix.functions().stream()
                .filter(cell -> cell.identity().equals("user-a"))
                .findFirst().orElseThrow();

        assertEquals(AuthorizationMatrix.Status.BFLA_TEST_RECOMMENDED, recommendation.status());
        assertEquals("BFLA", recommendation.recommendation().type());
        assertEquals("admin", recommendation.recommendation().basisIdentity());
        assertEquals("user-a", recommendation.recommendation().testIdentity());
        assertEquals("P0", recommendation.policy().code(), "성공 관측 하나만으로 요구 역할을 추론하지 않는다");
        assertTrue(matrix.summary().bflaTestRecommendations() >= 1);
    }

    @Test
    void 다른_신원들의_성공차단_분포로_대상신원의_요구역할을_P2로_추론한다() {
        AnalysisConfig config = userAndAdmin()
                .upsertAccount(new AccountProfile("user-b", "USER B", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, "tok:user-b", "user-b");
        List<RequestRecord> records = List.of(
                record(Source.HUMAN, "tok:admin", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"),
                record(Source.HUMAN, "tok:user-a", "GET", "/api/reports/quarterly", 403,
                        "{\"error\":\"forbidden\"}"),
                record(Source.SCANNER, "tok:user-b", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"));

        Pipeline.Result result = Pipeline.run(records, config);
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.FunctionCell target = matrix.functions().stream()
                .filter(cell -> cell.identity().equals("user-b") && !cell.evidenceIds().isEmpty())
                .findFirst().orElseThrow();

        assertEquals("P2", target.policy().code());
        assertEquals(AuthorizationMatrix.Expected.DENY, target.expected());
        assertEquals(AuthorizationMatrix.Status.BFLA_REVIEW_REQUIRED, target.status());
        assertNotNull(target.recommendation());
        assertTrue(target.policy().basis().contains("Admin"));
        assertEquals(0, matrix.summary().bflaCandidates(), "관측 분포 P2만으로 BFLA 후보를 확정하지 않는다");
        assertTrue(result.analysis.findings().stream().noneMatch(finding ->
                finding.type() == AuthorizationAnalysis.FindingType.BFLA),
                "P2 기대는 정본 finding이 아니라 정책 확인 추천으로 남는다");
    }

    @Test
    void 사람의_명시_P3는_관측분포_P2보다_우선한다() {
        AnalysisConfig config = userAndAdmin()
                .upsertAccount(new AccountProfile("user-b", "USER B", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, "tok:user-b", "user-b");
        List<RequestRecord> records = List.of(
                record(Source.HUMAN, "tok:admin", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"),
                record(Source.HUMAN, "tok:user-a", "GET", "/api/reports/quarterly", 403,
                        "{\"error\":\"forbidden\"}"),
                record(Source.SCANNER, "tok:user-b", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"));
        Pipeline.run(records, config);
        config.withEndpointRequirement(records.getFirst().op, AccessRole.USER);

        AuthorizationMatrix.FunctionCell target = AuthorizationMatrixAnalyzer.analyze(
                        Pipeline.run(records, config), config, List.of()).functions().stream()
                .filter(cell -> cell.identity().equals("user-b") && !cell.evidenceIds().isEmpty())
                .findFirst().orElseThrow();

        assertEquals("P3", target.policy().code());
        assertEquals(AuthorizationMatrix.Expected.ALLOW, target.expected());
        assertEquals(AuthorizationMatrix.Status.EXPECTED_ACCESS, target.status());
        assertNull(target.recommendation());
    }

    @Test
    void 애매한_응답이_섞인_분포는_P2_요구역할을_유도하지_않는다() {
        AnalysisConfig config = userAndAdmin()
                .upsertAccount(new AccountProfile("user-b", "USER B", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, "tok:user-b", "user-b");
        List<RequestRecord> records = List.of(
                record(Source.HUMAN, "tok:admin", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"),
                record(Source.HUMAN, "tok:user-a", "GET", "/api/reports/quarterly", 403,
                        "{\"error\":\"forbidden\"}"),
                record(Source.LLM, "tok:user-a", "GET", "/api/reports/quarterly", 500,
                        "{\"error\":\"temporary failure\"}"),
                record(Source.SCANNER, "tok:user-b", "GET", "/api/reports/quarterly", 200, "{\"rows\":1}"));

        AuthorizationMatrix.FunctionCell target = AuthorizationMatrixAnalyzer.analyze(
                        Pipeline.run(records, config), config, List.of()).functions().stream()
                .filter(cell -> cell.identity().equals("user-b") && !cell.evidenceIds().isEmpty())
                .findFirst().orElseThrow();

        assertEquals("P0", target.policy().code());
        assertEquals(AuthorizationMatrix.Expected.UNKNOWN, target.expected());
    }

    @Test
    void 명시_역할정책과_교차응답은_P3_E2_BFLA후보가_된다() {
        AnalysisConfig config = userAndAdmin();
        List<RequestRecord> records = new ArrayList<>();
        records.add(record(Source.HUMAN, "tok:admin", "GET", "/api/export", 200, "{\"rows\":1}"));
        records.add(record(Source.SCANNER, "tok:user-a", "GET", "/api/export", 200, "{\"rows\":1}"));
        Pipeline.Result preliminary = Pipeline.run(records, config);
        String operation = preliminary.records.getFirst().op;
        config.withEndpointRequirement(operation, AccessRole.ADMIN);

        Pipeline.Result result = Pipeline.run(records, config);
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.FunctionCell cell = matrix.functions().stream()
                .filter(value -> value.identity().equals("user-a") && value.operation().equals(operation))
                .findFirst().orElseThrow();

        assertEquals("P3", cell.policy().code());
        assertEquals("E2", cell.evidence().code());
        assertEquals(AuthorizationMatrix.Expected.DENY, cell.expected());
        assertEquals(AuthorizationMatrix.Status.BFLA_CANDIDATE, cell.status());
        assertTrue(result.analysis.cells().stream().filter(value -> value.key().identity().equals("user-a"))
                .flatMap(value -> value.perSource().values().stream()).anyMatch(AuthorizationAnalysis.Decision::roleViolation),
                "후보는 정본 Decision의 roleViolation과 같은 판단이다");
        assertTrue(matrix.summary().bflaCandidates() >= 1);
    }

    @Test
    void 확정소유자_타계정_직접식별자_접근은_O3_BOLA_IDOR후보가_된다() {
        AnalysisConfig config = users();
        RequestRecord owner = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"ownerId\":\"user-a\",\"updatedAt\":\"2026-09-16T01:00:00Z\",\"token\":\"masked-a\"}");
        RequestRecord attacker = record(Source.SCANNER, "tok:user-b", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"ownerId\":\"user-a\",\"updatedAt\":\"2026-09-16T01:00:01Z\",\"token\":\"masked-b\"}");

        Pipeline.Result result = Pipeline.run(List.of(owner, attacker), config);
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.ObjectCell cell = matrix.objects().stream()
                .filter(value -> value.identity().equals("user-b") && !value.evidenceIds().isEmpty())
                .findFirst().orElseThrow();

        assertEquals("O3", cell.ownership().code());
        assertEquals("E2", cell.evidence().code());
        assertTrue(cell.evidence().basis().contains("비통제 관측 차등"));
        assertTrue(cell.evidence().basis().contains("O3"));
        assertEquals("E1", matrix.objects().stream()
                .filter(value -> value.identity().equals("user-a") && !value.evidenceIds().isEmpty())
                .findFirst().orElseThrow().evidence().code(), "소유자 응답을 자기 자신과 비교해 E2로 올리면 안 된다");
        assertTrue(cell.techniques().contains("BOLA"));
        assertTrue(cell.techniques().contains("IDOR"));
        assertEquals(AuthorizationMatrix.Status.BOLA_IDOR_CANDIDATE, cell.status());
        assertEquals(Verdict.SUSPICIOUS, result.analysis.cells().stream()
                .filter(value -> value.key().identity().equals("user-b")).findFirst().orElseThrow().overall(),
                "후보는 정본 cell의 SUSPICIOUS와 같은 판단이다");
        assertEquals(0, matrix.summary().bflaCandidates(), "BOLA 의심은 BFLA 후보로 새지 않는다");
        assertTrue(matrix.functions().stream().noneMatch(value -> value.status() == AuthorizationMatrix.Status.BFLA_CANDIDATE));
    }

    @Test
    void PUBLIC_정책은_타소유자_성공의_BOLA후보와_추천을_억제한다() {
        AnalysisConfig config = users();
        RequestRecord owner = record(Source.HUMAN, "tok:user-a", "GET", "/api/catalog/801", 200,
                "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}");
        RequestRecord reader = record(Source.SCANNER, "tok:user-b", "GET", "/api/catalog/801", 200,
                "{\"id\":801,\"ownerId\":\"user-a\",\"published\":true}");
        Pipeline.run(List.of(owner, reader), config);
        config.withEndpointRequirement(reader.op, AccessRole.USER)
                .withResourcePolicy(reader.resource, ResourcePolicy.PUBLIC);

        Pipeline.Result result = Pipeline.run(List.of(owner, reader), config);
        AuthorizationMatrix.ObjectCell cell = AuthorizationMatrixAnalyzer.analyze(result, config, List.of())
                .objects().stream().filter(value -> value.identity().equals("user-b")
                        && value.resource().equals(reader.resource)).findFirst().orElseThrow();

        assertEquals("PUBLIC", cell.resourcePolicy());
        assertEquals(AuthorizationMatrix.Expected.ALLOW, cell.expected());
        assertEquals(AuthorizationMatrix.Status.EXPECTED_ACCESS, cell.status());
        assertTrue(cell.blockingLayers().isEmpty());
        assertNull(cell.recommendation());
        assertTrue(result.analysis.findings().stream().noneMatch(finding -> finding.cell().identity().equals("user-b")));
    }

    @Test
    void 객체소유자라도_ADMIN요구_DELETE는_기능층이_차단한다() {
        AnalysisConfig config = users();
        RequestRecord ownerRead = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/902", 200,
                "{\"id\":902,\"ownerId\":\"user-a\"}");
        RequestRecord ownerDelete = record(Source.HUMAN, "tok:user-a", "DELETE", "/api/orders/902", 204, "");
        Pipeline.run(List.of(ownerRead, ownerDelete), config);
        config.withEndpointRequirement(ownerDelete.op, AccessRole.ADMIN)
                .withResourcePolicy(ownerDelete.resource, ResourcePolicy.OWNER_ONLY);

        Pipeline.Result result = Pipeline.run(List.of(ownerRead, ownerDelete), config);
        AuthorizationMatrix.ObjectCell cell = AuthorizationMatrixAnalyzer.analyze(result, config, List.of())
                .objects().stream().filter(value -> value.identity().equals("user-a")
                        && value.operation().equals(ownerDelete.op)).findFirst().orElseThrow();

        assertEquals(AuthorizationMatrix.Expected.DENY, cell.expected());
        assertEquals(List.of("BFLA"), cell.blockingLayers());
        assertEquals(AuthorizationMatrix.Status.BFLA_CANDIDATE, cell.status());
        assertTrue(result.analysis.findings().stream().anyMatch(finding ->
                finding.type() == AuthorizationAnalysis.FindingType.BFLA
                        && finding.cell().operation().equals(ownerDelete.op)));
    }

    @Test
    void 확정소유자_객체의_타인_2xx라도_정본이_본문을_확인하지_못하면_후보가_아니라_수동_검토다() {
        AnalysisConfig config = users();
        RequestRecord owner = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/101", 200,
                "{\"id\":101,\"ownerId\":\"user-a\"}");
        RequestRecord attacker = record(Source.SCANNER, "tok:user-b", "GET", "/api/orders/101", 200,
                "{\"ok\":true}");

        Pipeline.Result result = Pipeline.run(List.of(owner, attacker), config);
        AuthorizationAnalysis.CoverageCell authority = result.analysis.cells().stream()
                .filter(value -> value.key().identity().equals("user-b")).findFirst().orElseThrow();
        assertEquals(Verdict.UNDECIDED, authority.overall(), "정본은 본문 오라클 없이 SUSPICIOUS를 만들지 않는다(D-004)");

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.ObjectCell cell = matrix.objects().stream()
                .filter(value -> value.identity().equals("user-b") && !value.evidenceIds().isEmpty())
                .findFirst().orElseThrow();
        assertEquals("O3", cell.ownership().code());
        assertEquals(AuthorizationMatrix.Actual.SUCCESS, cell.actual());
        assertEquals(AuthorizationMatrix.Expected.DENY, cell.expected());
        assertEquals(AuthorizationMatrix.Status.BOLA_IDOR_REVIEW_REQUIRED, cell.status());
        assertFalse(cell.oracle().satisfied());
        assertEquals("E1", cell.evidence().code(), "구조와 대상 ID가 다른 응답은 정상 기준선과 차등 일치가 아니다");
        assertEquals(0, matrix.summary().bolaIdorCandidates());
        assertTrue(matrix.summary().manualReviewPending() >= 1);
    }

    @Test
    void 소유자_미확정_객체의_타인_2xx는_소유권_미확정_검토이지_후보가_아니다() {
        AnalysisConfig config = users();
        RequestRecord first = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/24", 200, "{\"id\":24}");
        RequestRecord second = record(Source.SCANNER, "tok:user-b", "GET", "/api/orders/24", 200, "{\"id\":24}");

        Pipeline.Result result = Pipeline.run(List.of(first, second), config);
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        AuthorizationMatrix.ObjectCell cell = matrix.objects().stream()
                .filter(value -> value.identity().equals("user-b") && !value.evidenceIds().isEmpty())
                .findFirst().orElseThrow();
        assertEquals(1, cell.ownership().level(), "첫 성공 접근자는 저신뢰 추정(O1)이며 판정 근거가 아니다(D-012)");
        assertEquals("E1", cell.evidence().code(), "O1 첫 접근자만으로는 E2 정상 기준선을 만들지 않는다");
        assertEquals(AuthorizationMatrix.GateState.UNKNOWN, cell.gates().stream()
                .filter(gate -> gate.key().equals("baseline")).findFirst().orElseThrow().state());
        assertEquals(AuthorizationMatrix.Status.BOLA_IDOR_REVIEW_REQUIRED, cell.status());
        assertNotNull(cell.recommendation());
        assertEquals(0, matrix.summary().bolaIdorCandidates());
    }

    @Test
    void soft_deny_응답은_소유자_기준선이_있어도_E2_읽기차등으로_올리지_않는다() {
        AnalysisConfig config = users();
        RequestRecord owner = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/105", 200,
                "{\"id\":105,\"ownerId\":\"user-a\"}");
        RequestRecord denied = record(Source.SCANNER, "tok:user-b", "GET", "/api/orders/105", 200,
                "{\"error\":\"forbidden\"}");

        Pipeline.Result result = Pipeline.run(List.of(owner, denied), config);
        AuthorizationMatrix.ObjectCell cell = AuthorizationMatrixAnalyzer.analyze(result, config, List.of())
                .objects().stream().filter(value -> value.identity().equals("user-b")
                        && !value.evidenceIds().isEmpty()).findFirst().orElseThrow();

        assertEquals(AuthorizationMatrix.Actual.DENIED, cell.actual());
        assertEquals("E1", cell.evidence().code());
        assertFalse(cell.oracle().satisfied());
    }

    @Test
    void 관측시각이_없는_과거기준선은_응답이_같아도_E1로_강등한다() {
        AnalysisConfig config = users();
        RequestRecord owner = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/106", 200,
                "{\"id\":106,\"ownerId\":\"user-a\"}");
        RequestRecord attacker = record(Source.SCANNER, "tok:user-b", "GET", "/api/orders/106", 200,
                "{\"id\":106,\"ownerId\":\"user-a\"}");
        owner.timestamp = 0;

        Pipeline.Result result = Pipeline.run(List.of(owner, attacker), config);
        AuthorizationMatrix.ObjectCell cell = AuthorizationMatrixAnalyzer.analyze(result, config, List.of())
                .objects().stream().filter(value -> value.identity().equals("user-b")
                        && !value.evidenceIds().isEmpty()).findFirst().orElseThrow();

        assertEquals("E1", cell.evidence().code());
        assertTrue(cell.evidence().basis().contains("시각"));
    }

    @Test
    void 정책과_실행이_없으면_안전으로_표시하지_않고_P0_E0_공백으로_남긴다() {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, sample.config(), List.of());
        AuthorizationMatrix.FunctionCell cell = matrix.functions().stream()
                .filter(value -> value.policy().code().equals("P0") && value.actual() == AuthorizationMatrix.Actual.UNTESTED)
                .findFirst().orElseThrow();

        assertEquals("E0", cell.evidence().code());
        assertEquals(AuthorizationMatrix.Status.COVERAGE_GAP, cell.status());
        assertNotEquals(AuthorizationMatrix.Status.EXPECTED_ACCESS, cell.status());
    }

    @Test
    void 과거_검증_이력은_표시만_하고_E3나_재현_상태로_승격하지_않는다() {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());
        AuthorizationAnalysis.Finding finding = result.analysis.findings().stream()
                .filter(value -> value.type() == AuthorizationAnalysis.FindingType.BOLA)
                .findFirst().orElseThrow();
        ValidationDecision validation = new ValidationDecision(finding.id(),
                ValidationDecision.FinalVerdict.CONFIRMED, "legacy judge bundle",
                finding.evidenceIds(), List.of("validation-a", "validation-b"), List.of("control"),
                "validation-run", Instant.now());

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, sample.config(), List.of(validation));
        AuthorizationMatrix.ObjectCell cell = matrix.objects().stream()
                .filter(value -> value.identity().equals(finding.cell().identity())
                        && value.operation().equals(finding.cell().operation())
                        && value.resource().equals(finding.cell().resource()))
                .findFirst().orElseThrow();

        assertEquals("CONFIRMED", cell.validationVerdict(), "이력은 읽기 전용으로 표시한다");
        assertNotEquals("E3", cell.evidence().code());
        assertNotEquals(AuthorizationMatrix.Status.BOLA_REPRODUCED, cell.status());
        assertEquals(AuthorizationMatrix.Status.BOLA_IDOR_CANDIDATE, cell.status(), "정본 SUSPICIOUS만 후보다");
        for (String key : List.of("controlled", "repeat")) {
            assertEquals(AuthorizationMatrix.GateState.UNKNOWN, cell.gates().stream()
                    .filter(gate -> gate.key().equals(key)).findFirst().orElseThrow().state(), key);
        }
        assertTrue(matrix.objects().stream().noneMatch(value -> value.evidence().code().equals("E3")));
        assertTrue(matrix.objects().stream().filter(value -> !value.identity().equals(finding.cell().identity())
                        && value.operation().equals(finding.cell().operation()) && !value.resource().equals(finding.cell().resource()))
                .allMatch(value -> value.validationVerdict().equals("NONE")), "이력은 정확한 cell에만 붙는다(교차 객체 fallback 없음)");
    }

    @Test
    void 상태변경은_후속확인_없이는_오라클충족이나_E3가_아니다() {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());
        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, sample.config(), List.of());
        AuthorizationMatrix.EvidenceRow write = matrix.evidence().stream()
                .filter(value -> value.operation().contains(" PATCH ") || value.operation().contains(" POST "))
                .findFirst().orElseThrow();

        assertFalse(write.oracle().satisfied());
        assertTrue(write.oracle().type() == AuthorizationMatrix.OracleType.CREATE_FOLLOW_UP
                || write.oracle().type() == AuthorizationMatrix.OracleType.UPDATE_FOLLOW_UP);
        assertNotEquals("E3", write.evidence().code());
    }

    @Test
    void recommendationsStayWithinTheRegisteredAccountService() {
        AnalysisConfig config = users().upsertAccount(new AccountProfile("foreign-user", "Foreign user",
                "https://other.test:443", AccessRole.USER));
        Pipeline.Result result = Pipeline.run(List.of(record(Source.HUMAN, "tok:user-a",
                "GET", "/api/orders/24", 200, "{\"id\":24}")), config);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());

        assertTrue(matrix.objects().stream().anyMatch(cell -> cell.identity().equals("user-b")
                && cell.status() == AuthorizationMatrix.Status.BOLA_IDOR_TEST_RECOMMENDED));
        assertTrue(matrix.functions().stream().noneMatch(cell -> cell.identity().equals("foreign-user")));
        assertTrue(matrix.objects().stream().noneMatch(cell -> cell.identity().equals("foreign-user")));
        assertEquals(1, matrix.configurationWarnings().size());
        AuthorizationMatrix.ConfigurationWarning warning = matrix.configurationWarnings().getFirst();
        assertAll(
                () -> assertEquals("ACCOUNT_SERVICE_NOT_IN_MATRIX", warning.code()),
                () -> assertEquals("foreign-user", warning.accountId()),
                () -> assertEquals("Foreign user", warning.accountLabel()),
                () -> assertEquals("https://other.test:443", warning.configuredService()),
                () -> assertTrue(warning.message().contains("판정 조합에서 제외")));
        assertTrue(matrix.functions().stream().map(AuthorizationMatrix.FunctionCell::recommendation)
                .filter(java.util.Objects::nonNull)
                .noneMatch(value -> value.basisIdentity().equals("foreign-user")
                        || value.testIdentity().equals("foreign-user")));
        assertTrue(matrix.objects().stream().map(AuthorizationMatrix.ObjectCell::recommendation)
                .filter(java.util.Objects::nonNull)
                .noneMatch(value -> value.basisIdentity().equals("foreign-user")
                        || value.testIdentity().equals("foreign-user")));
    }

    @Test
    void noMatrixOperationsDoNotProduceAccountServiceWarnings() {
        AnalysisConfig config = new AnalysisConfig().upsertAccount(new AccountProfile(
                "unobserved", "Unobserved account", "https://unobserved.test:443", AccessRole.USER));

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(
                Pipeline.run(List.of(), config), config, List.of());

        assertTrue(matrix.configurationWarnings().isEmpty(),
                "비교할 관측·정책 서비스 자체가 없으면 서비스 오타나 불일치를 추론하지 않는다");
        assertTrue(matrix.identities().isEmpty());
        assertTrue(matrix.functions().isEmpty());
        assertTrue(matrix.objects().isEmpty());
    }

    @Test
    void policyOnlyOperationMatchesTheRegisteredAccountServiceWithoutWarning() {
        String operation = "https://policy-only.test:443 GET /api/admin/export";
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("policy-user", "Policy user",
                        "https://policy-only.test:443", AccessRole.USER))
                .withEndpointRequirement(operation, AccessRole.ADMIN);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(
                Pipeline.run(List.of(), config), config, List.of());

        assertTrue(matrix.configurationWarnings().isEmpty());
        assertTrue(matrix.identities().stream().anyMatch(identity -> identity.id().equals("policy-user")));
        assertTrue(matrix.functions().stream().anyMatch(cell -> cell.identity().equals("policy-user")
                && cell.operation().equals(operation)));
    }

    @Test
    void observedAccountsFromTwoServicesKeepOnlyTheirOwnServiceCells() {
        String otherService = "https://other.test:443";
        AnalysisConfig config = users().upsertAccount(new AccountProfile("foreign-user", "Foreign user",
                otherService, AccessRole.USER)).bindSession(otherService, "tok:foreign", "foreign-user");
        RequestRecord local = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/24", 200, "{\"id\":24}");
        RequestRecord foreign = record(otherService, Source.HUMAN, "tok:foreign",
                "GET", "/api/orders/24", 200, "{\"id\":24}");
        Pipeline.Result result = Pipeline.run(List.of(local, foreign), config);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());

        assertTrue(matrix.objects().stream().anyMatch(cell -> cell.identity().equals("foreign-user")
                && !cell.evidenceIds().isEmpty()));
        assertTrue(matrix.functions().stream().allMatch(cell -> cell.operation().startsWith(
                (cell.identity().equals("foreign-user") ? otherService : SERVICE) + " ")));
        assertTrue(matrix.objects().stream().allMatch(cell -> cell.operation().startsWith(
                (cell.identity().equals("foreign-user") ? otherService : SERVICE) + " ")));
    }

    @Test
    void unregisteredAnonymousIdentityUsesItsObservedServicesOnly() {
        RequestRecord local = record(Source.HUMAN, "tok:user-a", "GET", "/api/orders/24", 200, "{\"id\":24}");
        RequestRecord anonymous = record("https://public.test:443", Source.HUMAN, "anon",
                "GET", "/api/news", 200, "{\"news\":[]}");
        AnalysisConfig config = users();
        Pipeline.Result result = Pipeline.run(List.of(local, anonymous), config);

        AuthorizationMatrix matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());

        assertTrue(matrix.functions().stream().anyMatch(cell -> cell.identity().equals("anon")
                && !cell.evidenceIds().isEmpty()));
        assertTrue(matrix.functions().stream().filter(cell -> cell.identity().equals("anon"))
                .allMatch(cell -> cell.operation().startsWith(anonymous.service + " ")));
        assertTrue(matrix.objects().stream().noneMatch(cell -> cell.identity().equals("anon")));
    }

    private static AnalysisConfig users() {
        return new AnalysisConfig()
                .upsertAccount(new AccountProfile("user-a", "USER A", SERVICE, AccessRole.USER))
                .upsertAccount(new AccountProfile("user-b", "USER B", SERVICE, AccessRole.USER))
                .bindSession(SERVICE, "tok:user-a", "user-a")
                .bindSession(SERVICE, "tok:user-b", "user-b");
    }

    private static AnalysisConfig userAndAdmin() {
        return new AnalysisConfig()
                .upsertAccount(new AccountProfile("user-a", "USER A", SERVICE, AccessRole.USER))
                .upsertAccount(new AccountProfile("admin", "ADMIN", SERVICE, AccessRole.ADMIN))
                .bindSession(SERVICE, "tok:user-a", "user-a")
                .bindSession(SERVICE, "tok:admin", "admin");
    }

    private static RequestRecord record(Source source, String fingerprint,
                                        String method, String path, int status, String body) {
        return record(SERVICE, source, fingerprint, method, path, status, body);
    }

    private static RequestRecord record(String service, Source source, String fingerprint,
                                        String method, String path, int status, String body) {
        RequestRecord record = new RequestRecord(source, service, method, path, status, fingerprint);
        record.body = body;
        record.respText = "HTTP/1.1 " + status + " Test\r\nContent-Type: application/json\r\n\r\n" + body;
        record.responseContentType = "application/json";
        record.hasResponse = true;
        record.phase = RunPhase.EXPLORATION;
        record.executionTrust = ExecutionTrust.OBSERVED;
        record.sourceDetail = source == Source.HUMAN ? SourceDetail.BROWSER : SourceDetail.ZAP_SPIDER;
        record.timestamp = System.currentTimeMillis();
        return record;
    }
}
