package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

import static io.flowscope.core.AuthorizationMatrix.*;

/**
 * 수집된 Evidence로 판정 매트릭스(P/E/O)를 만든다. 새 요청을 보내지 않는다(PR#12 이식, D-144).
 *
 * <p>인가 판정 정본은 {@link AuthorizationAnalysis}다(D-050). 이 projection은 기대 정책(P)·실행 결과(E)·소유권(O)을
 * 독립 축으로 나란히 놓고 수동 테스트 조합을 추천할 뿐, BOLA/BFLA 후보 여부는 정본 cell의 SUSPICIOUS 판정만 따른다.
 * 과거 LLM 검증(ValidationDecision)은 읽기 전용 이력으로만 표시하고 신뢰도·상태를 올리지 않는다. 계정 조합은
 * 등록 서비스 또는 실제 관측 서비스 경계 안에서만 만든다(D-146).</p>
 */
public final class AuthorizationMatrixAnalyzer {
    private static final long BASELINE_OBSERVATION_WINDOW_MS = 30L * 60L * 1_000L;
    private static final double MIN_STRUCTURE_SIMILARITY = 0.85d;
    private static final double MIN_NORMALIZED_LENGTH_RATIO = 0.80d;
    private static final Pattern DYNAMIC_FIELD = Pattern.compile(
            "(?i)(?:created|updated|modified|requested|generated)?(?:at|time|timestamp)|"
                    + "(?:access|refresh|csrf|session)?token|nonce|requestid|traceid|correlationid");

    private AuthorizationMatrixAnalyzer() {}

    public static AuthorizationMatrix analyze(Pipeline.Result result, AnalysisConfig config,
                                              List<ValidationDecision> validations) {
        Objects.requireNonNull(result, "result");
        AnalysisConfig policy = config == null ? new AnalysisConfig() : config.snapshotCopy();
        List<ValidationDecision> history = validations == null ? List.of() : List.copyOf(validations);

        Map<String, AuthorizationAnalysis.CoverageCell> cells = new LinkedHashMap<>();
        for (AuthorizationAnalysis.CoverageCell cell : result.analysis.cells()) {
            cells.put(key(cell.key().identity(), cell.key().operation(), cell.key().resource()), cell);
        }
        Map<String, RequestRecord> recordsByEvidence = new LinkedHashMap<>();
        for (RequestRecord record : result.records) recordsByEvidence.put(record.evidenceId, record);

        Map<String, ValidationDecision> validationByCell = validationsByCell(result.analysis, history);
        Set<String> operations = new LinkedHashSet<>(policy.endpointRequirements().keySet());
        result.analysis.cells().forEach(cell -> operations.add(cell.key().operation()));
        Map<String, Set<String>> identityServices = identityServices(result, policy);
        Set<String> matrixServices = operations.stream().map(AuthorizationMatrixAnalyzer::operationService)
                .filter(value -> !value.isBlank()).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        List<ConfigurationWarning> configurationWarnings = configurationWarnings(policy, matrixServices);
        List<Identity> identities = identities(result, policy).stream()
                .filter(identity -> identityServices.getOrDefault(identity.id(), Set.of()).stream()
                        .anyMatch(matrixServices::contains))
                .toList();

        List<FunctionCell> functions = new ArrayList<>();
        for (String operation : operations.stream().sorted().toList()) {
            for (Identity identity : identities) {
                if (!identityServices.getOrDefault(identity.id(), Set.of()).contains(operationService(operation))) continue;
                AuthorizationAnalysis.CoverageCell cell = cells.get(key(identity.id(), operation, null));
                // 기능 인가는 객체와 무관하다. 객체 없는 cell이 없으면 같은 신원·operation의 관측 객체 cell을 모아
                // 원 Evidence를 바꾸지 않고 집계한다. BFLA 여부는 정본 Decision의 roleViolation만 쓴다(BOLA 의심이 섞이지 않게).
                List<AuthorizationAnalysis.CoverageCell> sameOperation = result.analysis.cells().stream()
                        .filter(value -> value.key().identity().equals(identity.id())
                                && value.key().operation().equals(operation)).toList();
                if (cell == null && !sameOperation.isEmpty()) cell = aggregate(identity.id(), operation, sameOperation);
                boolean roleViolation = sameOperation.stream().flatMap(value -> value.perSource().values().stream())
                        .anyMatch(AuthorizationAnalysis.Decision::roleViolation);
                functions.add(functionCell(identity, operation, cell, roleViolation, result, policy,
                        validationByCell.get(key(identity.id(), operation, cell == null ? null : cell.key().resource())),
                        recordsByEvidence));
            }
        }

        Set<OperationResource> objectRows = new LinkedHashSet<>();
        result.analysis.cells().stream().filter(cell -> cell.key().resource() != null)
                .forEach(cell -> objectRows.add(new OperationResource(cell.key().operation(), cell.key().resource())));
        List<ObjectCell> objects = new ArrayList<>();
        objectRows.stream().sorted(Comparator.comparing(OperationResource::operation)
                        .thenComparing(OperationResource::resource))
                .forEach(row -> identities.stream()
                        .filter(identity -> identityServices.getOrDefault(identity.id(), Set.of())
                                .contains(operationService(row.operation())))
                        .forEach(identity -> objects.add(objectCell(identity, row,
                                cells.get(key(identity.id(), row.operation(), row.resource())), result, policy,
                                validationByCell.get(key(identity.id(), row.operation(), row.resource())), recordsByEvidence))));

        List<EvidenceRow> evidence = evidenceRows(result, functions, objects);
        Summary summary = summary(functions, objects);
        return new AuthorizationMatrix(summary, List.copyOf(identities), configurationWarnings, List.copyOf(functions),
                List.copyOf(objects), List.copyOf(evidence), policyLegend(), evidenceLegend(), ownershipLegend());
    }

    private static List<ConfigurationWarning> configurationWarnings(AnalysisConfig config,
                                                                     Set<String> matrixServices) {
        if (matrixServices.isEmpty()) return List.of();
        return config.accounts().values().stream()
                .filter(account -> !matrixServices.contains(account.service()))
                .sorted(Comparator.comparing(AccountProfile::label)
                        .thenComparing(AccountProfile::service)
                        .thenComparing(AccountProfile::id))
                .map(account -> new ConfigurationWarning(
                        "ACCOUNT_SERVICE_NOT_IN_MATRIX",
                        account.id(),
                        account.label(),
                        account.service(),
                        "현재 판정 매트릭스의 관측·정책 작업 중 설정 서비스와 일치하는 작업이 없어 판정 조합에서 제외했습니다."))
                .toList();
    }

    private static List<Identity> identities(Pipeline.Result result, AnalysisConfig config) {
        Set<String> ids = new LinkedHashSet<>(config.accounts().keySet());
        result.analysis.cells().forEach(cell -> ids.add(cell.key().identity()));
        return ids.stream().map(id -> {
            AccountProfile account = config.account(id).orElse(null);
            AccessRole role = config.identityRole(id);
            String label = account == null ? identityLabel(id) : account.label();
            String kind = account != null ? "REGISTERED"
                    : Fingerprints.ANONYMOUS.equals(id) ? "ANONYMOUS"
                    : id != null && id.startsWith("unresolved-") ? "UNRESOLVED" : "OBSERVED";
            return new Identity(id, label, role.label(), kind);
        }).sorted(Comparator.comparingInt((Identity value) -> roleRank(value.role()))
                .thenComparing(Identity::label)).toList();
    }

    /** Registered accounts belong to their configured service; observed-only identities belong to services they actually used. */
    private static Map<String, Set<String>> identityServices(Pipeline.Result result, AnalysisConfig config) {
        Map<String, Set<String>> services = new LinkedHashMap<>();
        config.accounts().forEach((id, account) -> services.put(id, Set.of(account.service())));
        for (RequestRecord record : result.records) {
            if (record.idn == null || record.service == null || config.account(record.idn).isPresent()) continue;
            services.computeIfAbsent(record.idn, ignored -> new LinkedHashSet<>()).add(record.service);
        }
        return services;
    }

    private static String operationService(String operation) {
        if (operation == null) return "";
        int separator = operation.indexOf(' ');
        return separator > 0 ? operation.substring(0, separator) : "";
    }

    private static FunctionCell functionCell(Identity identity, String operation,
                                             AuthorizationAnalysis.CoverageCell cell, boolean roleViolation,
                                             Pipeline.Result result, AnalysisConfig config,
                                             ValidationDecision validation,
                                             Map<String, RequestRecord> recordsByEvidence) {
        EndpointRequirementInference.Requirement requirement = EndpointRequirementInference.resolve(
                operation, identity.id(), result.coverageRecords, config);
        AccessRole required = requirement.role();
        Confidence policy = switch (requirement.provenance()) {
            case EXPLICIT -> p3(required);
            case OBSERVED_DISTRIBUTION -> p2(required, requirement.basis());
            case UNKNOWN -> p0();
        };
        AuthorizationPolicy.LayerDecision functionExpected = AuthorizationPolicy.function(
                config.identityRole(identity.id()), required);
        Expected expected = expected(functionExpected);
        List<String> blockingLayers = functionExpected == AuthorizationPolicy.LayerDecision.DENY
                ? List.of("BFLA") : List.of();
        List<RequestRecord> records = records(cell, recordsByEvidence);
        Actual actual = actual(cell, records);
        Oracle oracle = oracle(operation, records, false, null, null);
        BaselineComparison baseline = baselineComparison(cell, records, result, config, oracle, false, null, required);
        Confidence evidence = evidenceConfidence(cell, records, baseline);
        List<Gate> gates = gates(identity, operation, records, oracle, baseline);
        Status status = functionStatus(expected, actual, policy, gates, roleViolation);
        TestRecommendation recommendation = functionRecommendation(identity, operation, actual, result, config,
                recordsByEvidence, required);
        if (recommendation != null && status == Status.COVERAGE_GAP) status = Status.BFLA_TEST_RECOMMENDED;
        else if (recommendation != null && actual == Actual.SUCCESS
                && (status == Status.UNKNOWN_POLICY || status == Status.POLICY_CONFIRMATION_REQUIRED)) {
            status = Status.BFLA_REVIEW_REQUIRED;
        }
        String id = stableId("function", identity.id(), operation, null);
        List<String> reviewEvidence = reviewEvidence(evidenceIds(cell), recommendation);
        ReviewDecision review = config.review(id, reviewEvidence).orElse(null);
        return new FunctionCell(id, identity.id(), identity.label(),
                identity.role(), operation, expected, blockingLayers, actual, status, label(status), policy, evidence, oracle,
                gates, sourceVerdicts(cell), statusCodes(records), evidenceIds(cell), validationName(validation),
                recommendation, reviewStatus(review), reviewNote(review), reviewEvidence);
    }

    private static ObjectCell objectCell(Identity identity, OperationResource row,
                                         AuthorizationAnalysis.CoverageCell cell,
                                         Pipeline.Result result, AnalysisConfig config,
                                         ValidationDecision validation,
                                         Map<String, RequestRecord> recordsByEvidence) {
        AuthorizationAnalysis.OwnerInfo owner = result.analysis.owners().get(row.resource());
        Confidence ownership = ownership(owner);
        String ownerId = owner == null ? null : owner.identity();
        String relation = relation(identity.id(), config.identityRole(identity.id()), ownerId, config);
        ResourcePolicy resourcePolicy = config.resourcePolicy(row.operation(), row.resource());
        Confidence policy = objectPolicy(resourcePolicy, relation, ownership);
        AccessRole actualRole = config.identityRole(identity.id());
        AccessRole ownerRole = ownerId == null ? AccessRole.UNKNOWN : config.identityRole(ownerId);
        AuthorizationPolicy.Evaluation expectation = AuthorizationPolicy.evaluate(actualRole,
                config.endpointRequirement(row.operation()), resourcePolicy, identity.id(), ownerId, ownerRole,
                owner != null && owner.decisionGrade());
        Expected expected = expected(expectation.combined());
        List<RequestRecord> records = records(cell, recordsByEvidence);
        Actual actual = actual(cell, records);
        Oracle oracle = oracle(row.operation(), records, true, row.resource(), ownerId);
        BaselineComparison baseline = baselineComparison(cell, records, result, config, oracle, true, ownerId,
                config.endpointRequirement(row.operation()));
        Confidence evidence = evidenceConfidence(cell, records, baseline);
        List<Gate> gates = gates(identity, row.operation(), records, oracle, baseline);
        // 객체 권한 우회 후보는 정본 cell의 SUSPICIOUS(roleViolation 아님)만 인정한다(D-050·D-004: 본문 오라클은 정본이 판단).
        boolean authoritySuspicious = cell != null && cell.perSource().values().stream()
                .anyMatch(decision -> decision.verdict() == Verdict.SUSPICIOUS && !decision.roleViolation());
        boolean authorityRoleViolation = cell != null && cell.perSource().values().stream()
                .anyMatch(decision -> decision.verdict() == Verdict.SUSPICIOUS && decision.roleViolation());
        Status status = objectStatus(expected, actual, policy, ownership, gates,
                authoritySuspicious, authorityRoleViolation, resourcePolicy);
        TestRecommendation recommendation = objectRecommendation(identity, row, actual, result, config,
                recordsByEvidence);
        if (recommendation != null && status == Status.COVERAGE_GAP) status = Status.BOLA_IDOR_TEST_RECOMMENDED;
        else if (recommendation != null && actual == Actual.SUCCESS && status == Status.OWNERSHIP_UNKNOWN) {
            status = Status.BOLA_IDOR_REVIEW_REQUIRED;
        }
        List<RequestRecord> techniqueRecords = recommendation == null ? records
                : recommendation.basisEvidenceIds().stream().map(recordsByEvidence::get).filter(Objects::nonNull).toList();
        List<String> techniques = techniques(techniqueRecords, row.resource());
        String id = stableId("object", identity.id(), row.operation(), row.resource());
        List<String> reviewEvidence = reviewEvidence(evidenceIds(cell), recommendation);
        ReviewDecision review = config.review(id, reviewEvidence).orElse(null);
        return new ObjectCell(id, identity.id(),
                identity.label(), identity.role(), row.operation(), row.resource(), ownerId,
                ownerId == null ? "미확정" : config.identityLabel(ownerId), relation, techniques,
                resourcePolicy.name(), expected, expectation.blockingLayers(), actual, status, label(status), policy,
                evidence, ownership, oracle, gates,
                sourceVerdicts(cell), statusCodes(records), evidenceIds(cell), validationName(validation),
                recommendation, reviewStatus(review), reviewNote(review), reviewEvidence);
    }

    private static TestRecommendation functionRecommendation(Identity target, String operation, Actual actual,
                                                             Pipeline.Result result, AnalysisConfig config,
                                                             Map<String, RequestRecord> recordsByEvidence,
                                                             AccessRole required) {
        if ("UNRESOLVED".equals(target.kind()) || actual == Actual.DENIED || actual == Actual.CONFLICT) return null;
        AccessRole targetRole = config.identityRole(target.id());
        if (targetRole == AccessRole.UNKNOWN || targetRole == AccessRole.ADMIN) return null;
        boolean strongPolicyMismatch = required != AccessRole.UNKNOWN && !targetRole.isKnownAndAtLeast(required);
        if (actual == Actual.SUCCESS && !strongPolicyMismatch && !looksPrivileged(operation)) return null;

        return result.analysis.cells().stream()
                .filter(cell -> !cell.key().identity().equals(target.id()) && cell.key().operation().equals(operation))
                // BFLA 기준 신원은 접근 계층에서 대상보다 엄격히 높은 KNOWN 역할이어야 한다. UNKNOWN은 제외한다.
                .filter(cell -> {
                    AccessRole basisRole = config.identityRole(cell.key().identity());
                    return basisRole != AccessRole.UNKNOWN && basisRole != targetRole
                            && basisRole.isKnownAndAtLeast(targetRole);
                })
                .map(cell -> new Basis(cell, records(cell, recordsByEvidence)))
                .filter(basis -> basis.records().stream().anyMatch(ResponseEvidence::successful))
                .sorted(Comparator.comparingInt((Basis basis) ->
                        roleRank(config.identityRole(basis.cell().key().identity()).label())).reversed())
                .map(basis -> {
                    String basisId = basis.cell().key().identity();
                    String reason = strongPolicyMismatch
                            ? "명시된 요구 역할보다 낮은 신원의 실행 결과를 확인해야 합니다."
                            : "상위 역할에서 관측된 기능이 이 신원에서는 충분히 비교되지 않았습니다.";
                    return new TestRecommendation("BFLA", basisId, config.identityLabel(basisId),
                            target.id(), target.label(), reason,
                            target.label() + " 세션으로 같은 기능 요청을 Burp Repeater에서 수동 실행하세요.",
                            isStateChanging(operation), basis.cell().evidenceIds());
                }).findFirst().orElse(null);
    }

    private static TestRecommendation objectRecommendation(Identity target, OperationResource row, Actual actual,
                                                           Pipeline.Result result, AnalysisConfig config,
                                                           Map<String, RequestRecord> recordsByEvidence) {
        if ("UNRESOLVED".equals(target.kind()) || config.identityRole(target.id()) == AccessRole.ADMIN
                || actual == Actual.DENIED || actual == Actual.CONFLICT) return null;
        // 판정 가능한 O2/O3 소유자 자신은 자기 객체의 교차 테스트 대상이 아니다(D-166·D-167).
        AuthorizationAnalysis.OwnerInfo owner = result.analysis.owners().get(row.resource());
        ResourcePolicy resourcePolicy = config.resourcePolicy(row.operation(), row.resource());
        String ownerId = owner == null ? null : owner.identity();
        if (AuthorizationPolicy.object(resourcePolicy, target.id(), config.identityRole(target.id()), ownerId,
                ownerId == null ? AccessRole.UNKNOWN : config.identityRole(ownerId),
                owner != null && owner.decisionGrade()) == AuthorizationPolicy.LayerDecision.ALLOW) return null;
        if (owner != null && owner.decisionGrade() && target.id().equals(owner.identity())) return null;
        AccessRole targetRole = config.identityRole(target.id());
        return result.analysis.cells().stream()
                .filter(cell -> !cell.key().identity().equals(target.id()))
                .filter(cell -> cell.key().operation().equals(row.operation())
                        && Objects.equals(cell.key().resource(), row.resource()))
                .filter(cell -> !Fingerprints.ANONYMOUS.equals(cell.key().identity()))
                .filter(cell -> Fingerprints.ANONYMOUS.equals(target.id())
                        || targetRole != AccessRole.UNKNOWN
                        && targetRole == config.identityRole(cell.key().identity()))
                .map(cell -> new Basis(cell, records(cell, recordsByEvidence)))
                .filter(basis -> basis.records().stream().anyMatch(ResponseEvidence::successful))
                .map(basis -> {
                    String basisId = basis.cell().key().identity();
                    boolean direct = basis.records().stream().anyMatch(
                            AuthorizationMatrixAnalyzer::hasDirectObjectReference);
                    String type = direct ? "BOLA/IDOR" : "BOLA";
                    String reason = config.resourceOwner(row.resource()) != null
                            ? "다른 신원에 연결된 객체를 교차 접근하는 조합입니다."
                            : "이 객체의 최초 관측 신원을 소유자 가설로 두고 교차 접근을 확인해야 합니다.";
                    return new TestRecommendation(type, basisId, config.identityLabel(basisId),
                            target.id(), target.label(), reason,
                            target.label() + " 세션으로 객체 " + row.resource()
                                    + " 요청을 Burp Repeater에서 수동 실행하세요.",
                            isStateChanging(row.operation()), basis.cell().evidenceIds());
                }).findFirst().orElse(null);
    }

    private static boolean looksPrivileged(String operation) {
        String value = operation == null ? "" : operation.toLowerCase(Locale.ROOT);
        return isStateChanging(operation) || List.of("admin", "manage", "export", "audit", "role", "permission",
                "disable", "approve", "refund").stream().anyMatch(value::contains);
    }

    private static boolean isStateChanging(String operation) {
        return Set.of("POST", "PUT", "PATCH", "DELETE").contains(method(operation));
    }

    private static List<String> reviewEvidence(List<String> targetEvidence, TestRecommendation recommendation) {
        Set<String> values = new LinkedHashSet<>(targetEvidence == null ? List.of() : targetEvidence);
        if (recommendation != null) values.addAll(recommendation.basisEvidenceIds());
        return values.stream().sorted().toList();
    }

    private static String reviewStatus(ReviewDecision review) {
        return review == null ? ReviewDecision.Status.UNRESOLVED.name() : review.status().name();
    }

    private static String reviewNote(ReviewDecision review) {
        return review == null ? "" : review.note();
    }

    /** 과거 검증 이력은 정확히 같은 cell 좌표에만 붙인다(교차 객체 fallback 없음). 표시 전용이다. */
    private static Map<String, ValidationDecision> validationsByCell(AuthorizationAnalysis analysis,
                                                                      List<ValidationDecision> validations) {
        Map<String, AuthorizationAnalysis.Finding> findings = new LinkedHashMap<>();
        analysis.findings().forEach(finding -> findings.put(finding.id(), finding));
        Map<String, ValidationDecision> out = new LinkedHashMap<>();
        for (ValidationDecision validation : validations) {
            AuthorizationAnalysis.Finding finding = findings.get(validation.candidateId());
            if (finding == null) continue;
            var cell = finding.cell();
            out.put(key(cell.identity(), cell.operation(), cell.resource()), validation);
        }
        return out;
    }

    private static AuthorizationAnalysis.CoverageCell aggregate(String identity, String operation,
                                                                 List<AuthorizationAnalysis.CoverageCell> cells) {
        Map<Source, AuthorizationAnalysis.Decision> perSource = new EnumMap<>(Source.class);
        Set<Source> missed = new LinkedHashSet<>();
        Set<String> evidence = new LinkedHashSet<>();
        boolean conflict = false;
        for (var cell : cells) {
            cell.perSource().forEach((source, decision) -> perSource.merge(source, decision,
                    (left, right) -> verdictRank(right.verdict()) > verdictRank(left.verdict()) ? right : left));
            missed.addAll(cell.missedBy());
            evidence.addAll(cell.evidenceIds());
            conflict |= cell.conflict();
        }
        Set<Verdict> verdicts = new LinkedHashSet<>();
        perSource.values().forEach(value -> verdicts.add(value.verdict()));
        conflict |= verdicts.size() > 1;
        Verdict overall = perSource.values().stream().map(AuthorizationAnalysis.Decision::verdict)
                .max(Comparator.comparingInt(AuthorizationMatrixAnalyzer::verdictRank)).orElse(Verdict.UNTESTED);
        return new AuthorizationAnalysis.CoverageCell(new AuthorizationAnalysis.CellKey(identity, operation, null),
                Map.copyOf(perSource), overall, conflict, Set.copyOf(missed), List.copyOf(evidence));
    }

    private static int verdictRank(Verdict verdict) {
        return switch (verdict) {
            case SUSPICIOUS -> 5;
            case UNDECIDED -> 4;
            case DENY -> 3;
            case ALLOW -> 2;
            case UNTESTED -> 1;
        };
    }

    private static Expected expected(AuthorizationPolicy.LayerDecision value) {
        return switch (value) {
            case ALLOW -> Expected.ALLOW;
            case DENY -> Expected.DENY;
            case UNKNOWN -> Expected.UNKNOWN;
        };
    }

    /** 실행 결과 축. 정본과 같은 응답 taxonomy(D-004/013/015)를 쓰며 인가 판정이 아니다. */
    private static Actual actual(AuthorizationAnalysis.CoverageCell cell, List<RequestRecord> records) {
        if (cell == null || records.isEmpty()) return Actual.UNTESTED;
        boolean success = records.stream().anyMatch(ResponseEvidence::successful);
        boolean denied = records.stream().anyMatch(ResponseEvidence::denied);
        if (success && denied || cell.conflict()) return Actual.CONFLICT;
        if (success) return Actual.SUCCESS;
        if (denied) return Actual.DENIED;
        return Actual.AMBIGUOUS;
    }

    /** E3(통제 재현)은 자동으로 부여하지 않는다: 현재 통제 재현 실행기가 없고 과거 검증 이력은 승격 근거가 아니다. */
    private static Confidence evidenceConfidence(AuthorizationAnalysis.CoverageCell cell,
                                                 List<RequestRecord> records,
                                                 BaselineComparison baseline) {
        if (cell == null || records.isEmpty()) return e(0, "미실행", "대상 조합의 응답 Evidence가 없음");
        if (baseline.matched()) return e(2, "비통제 관측 차등", baseline.basis());
        return e(1, "단일 관측", baseline.basis());
    }

    private static List<Gate> gates(Identity identity, String operation, List<RequestRecord> records,
                                    Oracle oracle, BaselineComparison baseline) {
        List<Gate> out = new ArrayList<>();
        boolean unresolved = "UNRESOLVED".equals(identity.kind())
                || records.stream().anyMatch(record -> record.authState == AuthState.UNRESOLVED);
        out.add(new Gate("session", "테스트 신원 유효", unresolved ? GateState.FAIL : GateState.PASS,
                unresolved ? "등록 계정 또는 비로그인 상태로 귀속되지 않은 세션" : "요청이 등록 계정 또는 비로그인 상태로 귀속됨"));

        out.add(new Gate("baseline", "정상 기준선", baseline.matched() ? GateState.PASS : GateState.UNKNOWN,
                baseline.basis()));
        out.add(new Gate("controlled", "통제·최소 변경", GateState.UNKNOWN,
                "비통제 관측 차등이며 인증/객체 외 변경 여부는 사람이 Repeater에서 통제 재현해야 함"));
        out.add(new Gate("repeat", "독립 반복", GateState.UNKNOWN, "자동 통제 반복 묶음이 없음"));
        boolean read = Set.of("GET", "HEAD", "OPTIONS").contains(method(operation));
        out.add(new Gate("prerequisite", "동적 전제조건", read ? GateState.NOT_APPLICABLE : GateState.UNKNOWN,
                read ? "읽기 요청에는 쓰기 상태 전제조건을 적용하지 않음"
                        : "CSRF·nonce·선행 상태 준비 여부를 자동 증명하지 않음"));
        out.add(new Gate("oracle", "결과 오라클", oracle.satisfied() ? GateState.PASS : GateState.UNKNOWN,
                oracle.satisfied() ? oracle.requirement() : "후속 상태 또는 의미 응답 증거가 더 필요함"));
        return List.copyOf(out);
    }

    private static BaselineComparison baselineComparison(AuthorizationAnalysis.CoverageCell cell,
                                                         List<RequestRecord> targets,
                                                         Pipeline.Result result,
                                                         AnalysisConfig config,
                                                         Oracle oracle,
                                                         boolean objectMatrix,
                                                         String ownerId,
                                                         AccessRole effectiveRequirement) {
        if (cell == null || targets.isEmpty()) return BaselineComparison.missing("대상 조합의 응답 Evidence가 없음");
        if (!oracle.satisfied()) {
            return BaselineComparison.missing("대상 응답의 의미 오라클이 충족되지 않아 정상 기준선과 차등 비교하지 않음");
        }

        String provenance;
        List<RequestRecord> baselines;
        if (objectMatrix) {
            AuthorizationAnalysis.OwnerInfo owner = result.analysis.owners().get(cell.key().resource());
            if (owner == null || !owner.decisionGrade() || ownerId == null) {
                String grade = owner == null ? "O0" : owner.confidence() <= 20 ? "O1" : "저신뢰 O";
                return BaselineComparison.missing("정상 기준선 소유권이 " + grade
                        + "이며 O2/O3 판정 등급에 미달함");
            }
            if (ownerId.equals(cell.key().identity())) {
                return BaselineComparison.missing("소유자 자신의 응답은 교차 신원 차등 기준선으로 중복 사용하지 않음");
            }
            provenance = owner.confidence() >= 100 ? "O3 명시 소유자" : "O2 " + owner.basis();
            baselines = result.coverageRecords.stream().filter(record -> ownerId.equals(record.idn)
                    && cell.key().operation().equals(record.op)
                    && Objects.equals(cell.key().resource(), record.resource)
                    && ResponseEvidence.successful(record)).toList();
        } else {
            AccessRole required = effectiveRequirement == null ? AccessRole.UNKNOWN : effectiveRequirement;
            if (required == AccessRole.UNKNOWN) {
                return BaselineComparison.missing("요구 역할이 미정이라 권한 보유자 기준선을 선택할 수 없음");
            }
            provenance = required.label() + " 이상 권한 보유자";
            baselines = result.coverageRecords.stream().filter(record -> !cell.key().identity().equals(record.idn)
                    && cell.key().operation().equals(record.op)
                    && config.identityRole(record.idn).isKnownAndAtLeast(required)
                    && ResponseEvidence.successful(record)).toList();
        }
        if (baselines.isEmpty()) {
            return BaselineComparison.missing(provenance + "의 동일 작업 성공 Evidence가 없음");
        }

        List<RequestRecord> successfulTargets = targets.stream().filter(ResponseEvidence::successful).toList();
        boolean hasCurrentPair = false;
        boolean hasTimedPair = false;
        for (RequestRecord target : successfulTargets) {
            for (RequestRecord baseline : baselines) {
                if (!currentlyAttributed(List.of(target, baseline), config)) continue;
                hasCurrentPair = true;
                if (target.timestamp <= 0 || baseline.timestamp <= 0) continue;
                hasTimedPair = true;
                long delta = Math.abs(target.timestamp - baseline.timestamp);
                if (delta > BASELINE_OBSERVATION_WINDOW_MS) continue;
                ResponseComparison comparison = compareResponses(target, baseline, objectMatrix,
                        cell.key().resource(), ownerId);
                if (comparison.matched()) {
                    return BaselineComparison.matched("비통제 관측 차등 · " + provenance
                            + " · 현재 계정 결박 및 관측 시각 확인 · 대상 ID·응답 구조·정규화 길이 일치"
                            + " (구조 " + Math.round(comparison.structureSimilarity() * 100) + "%, 길이 "
                            + Math.round(comparison.lengthRatio() * 100) + "%)");
                }
            }
        }
        if (!hasCurrentPair) {
            return BaselineComparison.missing(provenance + " 기준선의 현재 계정 결박을 확인할 수 없어 강등함");
        }
        if (!hasTimedPair) {
            return BaselineComparison.missing(provenance + " 기준선의 관측 시각이 없어 상대 신선도를 확인할 수 없음");
        }
        return BaselineComparison.missing(provenance
                + " 기준선은 있으나 30분 이내 대상 ID·응답 구조·정규화 길이 차등이 일치하지 않음");
    }

    private static boolean currentlyAttributed(List<RequestRecord> records, AnalysisConfig config) {
        return !records.isEmpty() && records.stream().allMatch(record -> {
            if (record.authState == AuthState.ANONYMOUS) return Fingerprints.ANONYMOUS.equals(record.idn);
            if (record.authState != AuthState.ACCOUNT_BOUND || record.idn == null) return false;
            return config.boundAccount(record.service, record.fp)
                    .map(account -> account.id().equals(record.idn)).orElse(false);
        });
    }

    private static ResponseComparison compareResponses(RequestRecord target, RequestRecord baseline,
                                                       boolean objectMatrix, String resource, String ownerId) {
        String targetBody = target.responseBodyForAnalysis();
        String baselineBody = baseline.responseBodyForAnalysis();
        if (targetBody == null || baselineBody == null) return ResponseComparison.noMatch();
        if (objectMatrix && (!ResponseEvidence.showsObject(targetBody, resource, ownerId)
                || !ResponseEvidence.showsObject(baselineBody, resource, ownerId))) {
            return ResponseComparison.noMatch();
        }
        try {
            JsonNode targetJson = ResponseEvidence.parseBoundedJson(targetBody);
            JsonNode baselineJson = ResponseEvidence.parseBoundedJson(baselineBody);
            if (targetJson == null || baselineJson == null) return ResponseComparison.noMatch();
            Set<String> targetShape = responseShape(targetJson);
            Set<String> baselineShape = responseShape(baselineJson);
            Set<String> intersection = new LinkedHashSet<>(targetShape);
            intersection.retainAll(baselineShape);
            Set<String> union = new LinkedHashSet<>(targetShape);
            union.addAll(baselineShape);
            double structure = union.isEmpty() ? 0d : (double) intersection.size() / union.size();
            int targetLength = normalizedLength(targetJson, "");
            int baselineLength = normalizedLength(baselineJson, "");
            double length = Math.max(targetLength, baselineLength) == 0 ? 0d
                    : (double) Math.min(targetLength, baselineLength) / Math.max(targetLength, baselineLength);
            return new ResponseComparison(structure >= MIN_STRUCTURE_SIMILARITY
                    && length >= MIN_NORMALIZED_LENGTH_RATIO, structure, length);
        } catch (IOException ignored) {
            return ResponseComparison.noMatch();
        }
    }

    private static Set<String> responseShape(JsonNode root) {
        Set<String> shape = new LinkedHashSet<>();
        ArrayDeque<ShapeNode> pending = new ArrayDeque<>();
        pending.add(new ShapeNode(root, "$"));
        int visited = 0;
        while (!pending.isEmpty() && visited++ < ResponseEvidence.MAX_VISITED_NODES) {
            ShapeNode current = pending.removeFirst();
            JsonNode node = current.node();
            if (node.isObject()) {
                shape.add(current.path() + ":object");
                var fields = node.fields();
                while (fields.hasNext()) {
                    var field = fields.next();
                    String path = current.path() + "/" + field.getKey();
                    shape.add(path + ":" + nodeType(field.getValue()));
                    if (field.getValue().isContainerNode()) pending.addLast(new ShapeNode(field.getValue(), path));
                }
            } else if (node.isArray()) {
                shape.add(current.path() + ":array");
                node.elements().forEachRemaining(value -> pending.addLast(new ShapeNode(value, current.path() + "/*")));
            } else {
                shape.add(current.path() + ":" + nodeType(node));
            }
        }
        return Set.copyOf(shape);
    }

    private static String nodeType(JsonNode node) {
        if (node == null || node.isNull()) return "null";
        if (node.isObject()) return "object";
        if (node.isArray()) return "array";
        if (node.isTextual()) return "string";
        if (node.isNumber()) return "number";
        if (node.isBoolean()) return "boolean";
        return "value";
    }

    private static int normalizedLength(JsonNode node, String fieldName) {
        if (node == null || node.isNull()) return 4;
        if (DYNAMIC_FIELD.matcher(fieldName.replace("_", "").replace("-", "")).matches()) return 9;
        if (node.isObject()) {
            int length = 2;
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                length += field.getKey().length() + 3 + normalizedLength(field.getValue(), field.getKey());
            }
            return length;
        }
        if (node.isArray()) {
            int length = 2;
            var values = node.elements();
            while (values.hasNext()) length += 1 + normalizedLength(values.next(), fieldName);
            return length;
        }
        return node.toString().length();
    }

    private static Oracle oracle(String operation, List<RequestRecord> records,
                                 boolean objectMatrix, String resource, String ownerId) {
        String method = method(operation);
        int successfulStatus = records.stream().filter(ResponseEvidence::successful)
                .mapToInt(record -> record.status).findFirst().orElse(0);
        if (successfulStatus == 202) {
            return new Oracle(OracleType.ASYNC_POLL, "비동기 작업 확인", false,
                    "job ID와 완료 상태 polling 또는 최종 리소스 확인 필요");
        }
        return switch (method) {
            case "GET" -> {
                boolean semantic = records.stream().anyMatch(record -> ResponseEvidence.successful(record)
                        && (!objectMatrix || ownerId != null && ResponseEvidence.showsObject(
                        record.responseBodyForAnalysis(), resource, ownerId)));
                yield new Oracle(OracleType.READ_SEMANTIC, "읽기 의미 응답", semantic,
                        objectMatrix ? "응답에 대상 객체 식별자가 포함되고 soft-deny가 아님"
                                : "2xx이며 로그인 HTML·soft-deny가 아닌 의미 응답");
            }
            case "POST" -> new Oracle(OracleType.CREATE_FOLLOW_UP, "생성 후 확인", false,
                    "응답 ID 또는 후속 GET/list에서 생성된 객체 확인 필요");
            case "PUT", "PATCH" -> new Oracle(OracleType.UPDATE_FOLLOW_UP, "수정 후 확인", false,
                    "후속 GET에서 변경 필드 확인 필요");
            case "DELETE" -> new Oracle(OracleType.DELETE_FOLLOW_UP, "삭제 후 확인", false,
                    "후속 GET/list에서 객체 소멸 확인 필요");
            case "HEAD", "OPTIONS" -> new Oracle(OracleType.METADATA_ONLY, "메타데이터 응답", false,
                    "HEAD/OPTIONS는 객체 접근 성공 오라클로 사용하지 않음");
            default -> new Oracle(OracleType.BLIND_EXTERNAL, "외부 관측 필요", false,
                    "테스트 메일·웹훅·감사 로그 등 독립 관측점이 구성된 경우만 사용");
        };
    }

    /** 기능 후보(BFLA)는 정본 Decision의 roleViolation만 인정한다. 기대 차단인데 정본이 위반으로 보지 않으면 정책 확인 요청이다. */
    private static Status functionStatus(Expected expected, Actual actual, Confidence policy,
                                         List<Gate> gates, boolean roleViolation) {
        if (gateFailed(gates)) return Status.INVALID_EXPERIMENT;
        if (actual == Actual.UNTESTED) return Status.COVERAGE_GAP;
        boolean success = actual == Actual.SUCCESS || actual == Actual.CONFLICT;
        boolean denied = actual == Actual.DENIED || actual == Actual.CONFLICT;
        if (expected == Expected.DENY && success) {
            return roleViolation && policy.level() >= 3 ? Status.BFLA_CANDIDATE : Status.POLICY_CONFIRMATION_REQUIRED;
        }
        if (expected == Expected.DENY && denied) return Status.POLICY_ENFORCED;
        if (expected == Expected.ALLOW && success) return Status.EXPECTED_ACCESS;
        if (expected == Expected.ALLOW && actual == Actual.DENIED) return Status.EXPECTED_ACCESS_DENIED;
        if (policy.level() < 2) return Status.UNKNOWN_POLICY;
        return Status.UNTESTED;
    }

    /**
     * 객체 후보(BOLA/IDOR)는 정본 cell이 SUSPICIOUS일 때만 인정한다. 확정 소유자의 객체에 타인이 성공했지만 정본이 본문
     * 오라클을 확인하지 못한 경우(UNDECIDED)는 후보가 아니라 수동 결과 검토다(D-004: 2xx 단독으로 승격하지 않음).
     */
    private static Status objectStatus(Expected expected, Actual actual,
                                       Confidence policy, Confidence ownership,
                                       List<Gate> gates, boolean authoritySuspicious,
                                       boolean authorityRoleViolation, ResourcePolicy resourcePolicy) {
        if (gateFailed(gates)) return Status.INVALID_EXPERIMENT;
        if (actual == Actual.UNTESTED) return Status.COVERAGE_GAP;
        boolean success = actual == Actual.SUCCESS || actual == Actual.CONFLICT;
        boolean denied = actual == Actual.DENIED || actual == Actual.CONFLICT;
        if (expected == Expected.DENY && success) {
            if (authorityRoleViolation) return Status.BFLA_CANDIDATE;
            return authoritySuspicious ? Status.BOLA_IDOR_CANDIDATE : Status.BOLA_IDOR_REVIEW_REQUIRED;
        }
        if (expected == Expected.DENY && denied) return Status.POLICY_ENFORCED;
        if (expected == Expected.ALLOW && success) return Status.EXPECTED_ACCESS;
        if (expected == Expected.ALLOW && actual == Actual.DENIED) return Status.EXPECTED_ACCESS_DENIED;
        if (resourcePolicy != ResourcePolicy.PUBLIC
                && resourcePolicy != ResourcePolicy.AUTHENTICATED_SHARED
                && resourcePolicy != ResourcePolicy.ADMIN_ONLY
                && ownership.level() < 2) return Status.OWNERSHIP_UNKNOWN;
        if (policy.level() < 2) return Status.POLICY_CONFIRMATION_REQUIRED;
        return Status.UNTESTED;
    }

    private static boolean gateFailed(List<Gate> gates) {
        return gates.stream().anyMatch(gate -> gate.state() == GateState.FAIL);
    }

    private static Confidence objectPolicy(ResourcePolicy resourcePolicy, String relation, Confidence ownership) {
        if (resourcePolicy != ResourcePolicy.UNKNOWN) {
            return new Confidence("P3", 3, "사람 확인 객체 정책", resourcePolicy.label());
        }
        if ("OWNER".equals(relation) || "ADMIN".equals(relation)) {
            return new Confidence("P2", 2, "소유관계 기반", "확정 소유자/관리자 정상 접근을 기대");
        }
        if (relation.contains("FOREIGN") && ownership.level() >= 2) {
            return new Confidence("P2", 2, "소유관계 기반", "비소유자 차단 기대는 공유·공개 정책 확인 전 추론");
        }
        return p0();
    }

    private static Confidence ownership(AuthorizationAnalysis.OwnerInfo owner) {
        if (owner == null) return o(0, "미확정", "소유자 근거 없음");
        if (owner.confirmed() && owner.identity() != null) return o(3, "확정", owner.basis());
        if (owner.confidence() >= 50) return o(2, "교차 확인", owner.basis());
        if (owner.identity() != null || owner.confidence() > 0) return o(1, "추정", owner.basis());
        return o(0, "미확정", owner.basis());
    }

    private static String relation(String identity, AccessRole role, String owner, AnalysisConfig config) {
        if (owner == null) return "UNKNOWN";
        if (owner.equals(identity)) return "OWNER";
        if (role == AccessRole.ADMIN) return "ADMIN";
        AccessRole ownerRole = config.identityRole(owner);
        if (Fingerprints.ANONYMOUS.equals(identity)) return "ANONYMOUS_FOREIGN";
        if (role != AccessRole.UNKNOWN && role == ownerRole) return "SAME_ROLE_FOREIGN";
        return "CROSS_ROLE_FOREIGN";
    }

    private static List<String> techniques(List<RequestRecord> records, String resource) {
        Set<String> out = new LinkedHashSet<>();
        for (RequestRecord record : records) {
            boolean direct = hasDirectObjectReference(record);
            if (direct) out.add("IDOR");
            if (resource != null) out.add("BOLA");
        }
        return out.isEmpty() ? List.of("BOLA") : List.copyOf(out);
    }

    /** 정규화된 경로·쿼리·본문에 직접 객체 참조 이름이 있는지만 본다. 값은 읽지 않는다. */
    private static boolean hasDirectObjectReference(RequestRecord record) {
        if (record == null) return false;
        if (record.resourceReferences != null && !record.resourceReferences.isEmpty()) return true;
        String operation = record.op == null ? "" : record.op;
        if (operation.matches("(?i).*\\{[^}]*?(?:^|[_-])?(?:id|uuid|guid)[^}]*}.*")) return true;
        return containsObjectReferenceName(record.query) || containsObjectReferenceName(record.requestBodyForAnalysis());
    }

    private static boolean containsObjectReferenceName(String value) {
        if (value == null || value.isBlank()) return false;
        return value.matches("(?is).*(?:^|[&{,\\s\"'])(?:[A-Za-z0-9_.-]*?(?:[_-]id|Id|UUID|Uuid|GUID|Guid)|id)"
                + "\\s*(?:=|:).*?");
    }

    private static List<EvidenceRow> evidenceRows(Pipeline.Result result,
                                                   List<FunctionCell> functions,
                                                   List<ObjectCell> objects) {
        Map<String, ObjectCell> objectByCell = new LinkedHashMap<>();
        for (ObjectCell cell : objects) if (!cell.evidenceIds().isEmpty()) {
            objectByCell.put(key(cell.identity(), cell.operation(), cell.resource()), cell);
        }
        List<EvidenceRow> out = new ArrayList<>();
        for (AuthorizationAnalysis.CoverageCell raw : result.analysis.cells()) {
            ObjectCell object = objectByCell.get(key(raw.key().identity(), raw.key().operation(), raw.key().resource()));
            if (object != null) {
                out.add(new EvidenceRow(object.id(), String.join("/", object.techniques()), object.identity(),
                        object.identityLabel(), object.operation(), object.resource(), object.resourcePolicy(),
                        object.blockingLayers(), object.status(),
                        object.statusLabel(), object.policy(), object.evidence(), object.ownership(), object.oracle(),
                        object.gates(), object.sourceVerdicts(), object.statusCodes(), object.evidenceIds(),
                        object.validationVerdict(), object.recommendation(), object.reviewStatus(),
                        object.reviewNote(), object.reviewEvidenceIds()));
                continue;
            }
            FunctionCell function = functions.stream().filter(cell -> cell.identity().equals(raw.key().identity())
                    && cell.operation().equals(raw.key().operation())).findFirst().orElse(null);
            if (function != null) out.add(new EvidenceRow(function.id(), "BFLA", function.identity(),
                    function.identityLabel(), function.operation(), raw.key().resource(), ResourcePolicy.UNKNOWN.name(),
                    function.blockingLayers(), function.status(),
                    function.statusLabel(), function.policy(), function.evidence(), o(0, "해당 없음", "기능 판정"),
                    function.oracle(), function.gates(), function.sourceVerdicts(), function.statusCodes(),
                    raw.evidenceIds(), function.validationVerdict(), function.recommendation(),
                    function.reviewStatus(), function.reviewNote(), function.reviewEvidenceIds()));
        }
        out.sort(Comparator.comparingInt((EvidenceRow row) -> statusRank(row.status())).reversed()
                .thenComparing(EvidenceRow::operation).thenComparing(EvidenceRow::identityLabel));
        return out;
    }

    private static Summary summary(List<FunctionCell> functions, List<ObjectCell> objects) {
        int policies = (int) java.util.stream.Stream.concat(
                        functions.stream().filter(cell -> cell.policy().level() >= 3)
                                .map(cell -> "function:" + cell.operation()),
                        objects.stream().filter(cell -> !ResourcePolicy.UNKNOWN.name().equals(cell.resourcePolicy()))
                                .map(cell -> "object:" + cell.resource()))
                .distinct().count();
        int policyReview = (int) java.util.stream.Stream.concat(
                        functions.stream().filter(cell -> cell.status() == Status.UNKNOWN_POLICY
                                || cell.status() == Status.POLICY_CONFIRMATION_REQUIRED).map(FunctionCell::id),
                        objects.stream().filter(cell -> cell.status() == Status.POLICY_CONFIRMATION_REQUIRED)
                                .map(ObjectCell::id)).distinct().count();
        int bfla = (int) functions.stream().filter(cell -> cell.status() == Status.BFLA_CANDIDATE
                || cell.status() == Status.BFLA_REPRODUCED).count();
        int bola = (int) objects.stream().filter(cell -> cell.status() == Status.BOLA_IDOR_CANDIDATE
                || cell.status() == Status.BOLA_REPRODUCED).count();
        int gaps = (int) java.util.stream.Stream.concat(
                        functions.stream().filter(cell -> cell.status() == Status.COVERAGE_GAP).map(FunctionCell::id),
                        objects.stream().filter(cell -> cell.status() == Status.COVERAGE_GAP).map(ObjectCell::id))
                .distinct().count();
        int invalid = (int) java.util.stream.Stream.concat(
                        functions.stream().filter(cell -> cell.status() == Status.INVALID_EXPERIMENT).map(FunctionCell::id),
                        objects.stream().filter(cell -> cell.status() == Status.INVALID_EXPERIMENT).map(ObjectCell::id))
                .distinct().count();
        // 추천은 상태가 *_REVIEW_REQUIRED로 올라가도 사람이 판정하기 전까지 열린 추천이다.
        int bflaRecommendations = (int) functions.stream()
                .filter(cell -> cell.recommendation() != null
                        && ReviewDecision.Status.UNRESOLVED.name().equals(cell.reviewStatus())).count();
        int bolaRecommendations = (int) objects.stream()
                .filter(cell -> cell.recommendation() != null
                        && ReviewDecision.Status.UNRESOLVED.name().equals(cell.reviewStatus())).count();
        int pending = (int) functions.stream().filter(cell -> reviewPending(cell.reviewStatus(), cell.recommendation(),
                        cell.status())).count()
                + (int) objects.stream().filter(cell -> reviewPending(cell.reviewStatus(), cell.recommendation(),
                        cell.status())).count();
        int confirmed = (int) functions.stream().filter(cell -> cell.reviewStatus()
                        .equals(ReviewDecision.Status.CONFIRMED.name())).count()
                + (int) objects.stream().filter(cell -> cell.reviewStatus()
                        .equals(ReviewDecision.Status.CONFIRMED.name())).count();
        int dismissed = (int) functions.stream().filter(cell -> cell.reviewStatus()
                        .equals(ReviewDecision.Status.DISMISSED.name())).count()
                + (int) objects.stream().filter(cell -> cell.reviewStatus()
                        .equals(ReviewDecision.Status.DISMISSED.name())).count();
        return new Summary(policies, policyReview, bfla, bola, gaps, invalid, bflaRecommendations,
                bolaRecommendations, pending, confirmed, dismissed);
    }

    private static boolean reviewPending(String reviewStatus, TestRecommendation recommendation, Status status) {
        return ReviewDecision.Status.UNRESOLVED.name().equals(reviewStatus)
                && (recommendation != null || Set.of(Status.BFLA_CANDIDATE, Status.BFLA_REVIEW_REQUIRED,
                Status.BOLA_IDOR_CANDIDATE, Status.BOLA_IDOR_REVIEW_REQUIRED).contains(status));
    }

    private static int statusRank(Status status) {
        return switch (status) {
            case BFLA_REPRODUCED, BOLA_REPRODUCED -> 6;
            case BFLA_CANDIDATE, BFLA_REVIEW_REQUIRED, BOLA_IDOR_CANDIDATE,
                    BOLA_IDOR_REVIEW_REQUIRED -> 5;
            case BFLA_TEST_RECOMMENDED, BOLA_IDOR_TEST_RECOMMENDED -> 4;
            case POLICY_CONFIRMATION_REQUIRED, INVALID_EXPERIMENT -> 3;
            case EXPECTED_ACCESS_DENIED, OWNERSHIP_UNKNOWN, UNKNOWN_POLICY -> 2;
            case POLICY_ENFORCED, EXPECTED_ACCESS -> 1;
            case COVERAGE_GAP, UNTESTED -> 0;
        };
    }

    private static String label(Status status) {
        return switch (status) {
            case BFLA_REPRODUCED -> "BFLA 재현";
            case BFLA_CANDIDATE -> "BFLA 후보 · 통제 재현 필요";
            case BFLA_TEST_RECOMMENDED -> "BFLA 수동 테스트 추천";
            case BFLA_REVIEW_REQUIRED -> "BFLA 수동 결과 검토";
            case BOLA_REPRODUCED -> "BOLA/IDOR 재현 · 공유 정책 확인";
            case BOLA_IDOR_CANDIDATE -> "BOLA/IDOR 후보";
            case BOLA_IDOR_TEST_RECOMMENDED -> "BOLA/IDOR 수동 테스트 추천";
            case BOLA_IDOR_REVIEW_REQUIRED -> "BOLA/IDOR 수동 결과 검토";
            case POLICY_CONFIRMATION_REQUIRED -> "기대 정책 확인 필요";
            case POLICY_ENFORCED -> "기대 차단 관측";
            case EXPECTED_ACCESS -> "기대 허용 관측";
            case EXPECTED_ACCESS_DENIED -> "기대 접근 차단 · 원인 확인";
            case UNKNOWN_POLICY -> "응답 관측 · 기대 정책 미정";
            case OWNERSHIP_UNKNOWN -> "소유권 미확정";
            case INVALID_EXPERIMENT -> "실험 무효";
            case COVERAGE_GAP -> "교차 실행 공백";
            case UNTESTED -> "미검증";
        };
    }

    private static List<RequestRecord> records(AuthorizationAnalysis.CoverageCell cell,
                                               Map<String, RequestRecord> recordsByEvidence) {
        if (cell == null) return List.of();
        return cell.evidenceIds().stream().map(recordsByEvidence::get).filter(Objects::nonNull).toList();
    }

    private static Map<String, String> sourceVerdicts(AuthorizationAnalysis.CoverageCell cell) {
        if (cell == null) return Map.of();
        Map<String, String> out = new LinkedHashMap<>();
        cell.perSource().entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry ->
                out.put(entry.getKey().name(), entry.getValue().verdict().name()));
        return Map.copyOf(out);
    }

    private static List<Integer> statusCodes(List<RequestRecord> records) {
        return records.stream().map(record -> record.status).distinct().sorted().toList();
    }

    private static List<String> evidenceIds(AuthorizationAnalysis.CoverageCell cell) {
        return cell == null ? List.of() : cell.evidenceIds();
    }

    private static String validationName(ValidationDecision validation) {
        return validation == null ? "NONE" : validation.verdict().name();
    }

    private static String method(String operation) {
        String value = operation == null ? "" : operation;
        if (value.startsWith("http://") || value.startsWith("https://")) {
            int separator = value.indexOf(' ');
            value = separator < 0 ? value : value.substring(separator + 1);
        }
        int separator = value.indexOf(' ');
        return (separator < 0 ? value : value.substring(0, separator)).toUpperCase(Locale.ROOT);
    }

    private static int roleRank(String role) {
        return switch (role) {
            case "Anonymous" -> 0;
            case "User" -> 1;
            case "LV1" -> 2;
            case "LV2" -> 3;
            case "Admin" -> 4;
            default -> 5;
        };
    }

    private static String identityLabel(String id) {
        if (Fingerprints.ANONYMOUS.equals(id)) return "ANONYMOUS";
        if (id != null && id.startsWith("unresolved-")) return "미확정 세션";
        return id == null || id.isBlank() ? "UNKNOWN" : id;
    }

    private static String stableId(String type, String identity, String operation, String resource) {
        return type + "-" + Fingerprints.hash(key(identity, operation, resource));
    }

    private static String key(String identity, String operation, String resource) {
        return String.valueOf(identity) + "\u0000" + operation + "\u0000" + String.valueOf(resource);
    }

    private static Confidence p0() { return new Confidence("P0", 0, "정책 미정", "명시 정책 근거 없음"); }
    private static Confidence p2(AccessRole required, String basis) {
        return new Confidence("P2", 2, "관측 분포 정책 후보",
                required.label() + " 요구 추론 · " + basis);
    }
    private static Confidence p3(AccessRole required) {
        return new Confidence("P3", 3, "사람 확인 정책", "사용자가 요구 권한 " + required.label() + "을 명시함");
    }
    private static Confidence e(int level, String label, String basis) {
        return new Confidence("E" + level, level, label, basis);
    }
    private static Confidence o(int level, String label, String basis) {
        return new Confidence("O" + level, level, label, basis);
    }

    private static List<LegendItem> policyLegend() {
        return List.of(
                new LegendItem("P4", "정본 정책", "버전이 고정된 코드·OPA·OpenFGA·설정 등 권위 있는 정책 원본"),
                new LegendItem("P3", "사람 확인", "제품·보안 담당자가 명시적으로 확인한 기대 역할"),
                new LegendItem("P2", "교차 추론", "서로 독립된 복수 근거가 일치하지만 정책 원본은 없음"),
                new LegendItem("P1", "단일 휴리스틱", "경로·메서드·UI 위치 등 하나의 약한 단서"),
                new LegendItem("P0", "미정", "기대 허용/차단을 결정할 근거 없음"));
    }

    private static List<LegendItem> evidenceLegend() {
        return List.of(
                new LegendItem("E3", "통제 재현", "정상 대조·유효 신원·의미 오라클·독립 반복이 검증된 상태. 현재는 자동 부여하지 않으며 사람 확정 검토로만 기록"),
                new LegendItem("E2", "차등 비교", "유효 신원의 동일 대상 비교와 의미 응답이 있음"),
                new LegendItem("E1", "단일 관측", "응답 한 건 또는 통제되지 않은 탐색 관측"),
                new LegendItem("E0", "미실행", "해당 신원·기능·객체 조합의 응답 없음"));
    }

    private static List<LegendItem> ownershipLegend() {
        return List.of(
                new LegendItem("O3", "확정", "사용자 확정 또는 응답의 명시적 소유 필드"),
                new LegendItem("O2", "교차 확인", "목록·상세·생성 흐름 등 복수 독립 근거가 일치"),
                new LegendItem("O1", "추정", "첫 성공 접근자 등 약한 단일 근거이며 판정 제외"),
                new LegendItem("O0", "미정", "소유자 근거 없음 또는 충돌"));
    }

    private record OperationResource(String operation, String resource) {}
    private record Basis(AuthorizationAnalysis.CoverageCell cell, List<RequestRecord> records) {}
    private record BaselineComparison(boolean matched, String basis) {
        private static BaselineComparison matched(String basis) { return new BaselineComparison(true, basis); }
        private static BaselineComparison missing(String basis) { return new BaselineComparison(false, basis); }
    }
    private record ResponseComparison(boolean matched, double structureSimilarity, double lengthRatio) {
        private static ResponseComparison noMatch() { return new ResponseComparison(false, 0d, 0d); }
    }
    private record ShapeNode(JsonNode node, String path) {}
}
