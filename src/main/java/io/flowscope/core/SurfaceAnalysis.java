package io.flowscope.core;

import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 실제 HTTP 관측과 대상이 제공한 선언을 분리한 endpoint/parameter surface 사실 모델.
 * 값은 보존하지 않고 위치, 필드 경로, 형태, Evidence 역참조만 보존한다.
 */
public record SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions,
                              List<ProbeObservation> probes, List<ParameterDiagnostic> parameterDiagnostics,
                              List<ParameterGap> parameterGaps, List<ParameterValidationCell> validationCells) {
    public enum ParameterLocation { PATH, QUERY, JSON_BODY, FORM_BODY, MULTIPART_BODY, HEADER, GRAPHQL_VARIABLE, XML_PATH }
    public enum ValueShape { EMPTY, STRING, INTEGER, DECIMAL, BOOLEAN, UUID, ARRAY, OBJECT, NULL, BINARY, UNKNOWN }
    public enum Requirement { REQUIRED, OPTIONAL, CONDITIONAL, UNKNOWN }
    /** 근거 신뢰도(PR#11): 실제 관측=OBSERVED, 독립 근거 2개 이상=CORROBORATED, 정의·추론=INFERRED, 부족=UNKNOWN. */
    public enum Confidence { OBSERVED, CORROBORATED, INFERRED, UNKNOWN }
    public enum Presence { PRESENT, EXPLICIT_NULL }
    public enum ValueType { STRING, INTEGER, NUMBER, BOOLEAN, UUID, DATE_TIME, BINARY, UNKNOWN }
    public enum ExtractionStatus { PARSED, PARTIAL, FAILED, LIMIT_EXCEEDED }
    public enum ExtractionFailure {
        NONE,
        SYNTAX_RECOVERY,
        PARSE_FAILED,
        INPUT_SIZE_LIMIT,
        AST_NODE_LIMIT,
        WORKER_TIMEOUT,
        WORKER_OUTPUT_LIMIT,
        WORKER_FAILURE
    }
    public enum ExtractionIssueKind {
        DYNAMIC_URL,
        UNRESOLVED_MEMBER_REFERENCE,
        UNRESOLVED_AXIOS_BASE_URL,
        UNRECOGNIZED_APPLICATION_WRAPPER,
        UNSUPPORTED_INTERPROCEDURAL_FLOW
    }
    public enum DeltaState {
        DECLARED_NOT_OBSERVED,
        ONE_SOURCE_OBSERVED,
        MULTI_SOURCE_OBSERVED,
        ALL_SOURCES_OBSERVED,
        OBSERVED_NOT_DECLARED,
        /** 선언 좌표를 canonical로 확정할 수 없어(모호한 dot 경로 등) 관측 join·Gap 승격 대상이 아니다(D-143). */
        UNRESOLVED_COORDINATE
    }
    /** 요청 단위 문맥(contextSignature)별 파라미터 존재 상태(PR#11 ParameterProfile.ContextPresence). */
    public enum ContextPresence { PRESENT, EXPLICIT_NULL, ABSENT_OBSERVED_CONTEXT }
    /** PR#11 discovery Gap 종류. AUTH_VARIANT_UNTESTED는 권한 대상 연결(4단계)이 만든다. */
    public enum GapType {
        DEFINED_NOT_OBSERVED, SOURCE_MISSED, IDENTITY_MISSED, AUTH_VARIANT_UNTESTED,
        CONDITION_COMBINATION_UNOBSERVED, TYPE_VARIANT_UNOBSERVED
    }
    /** 분석기는 OPEN만 만든다. VERIFIED/DISMISSED는 사람 검토 기록용이다. */
    public enum GapStatus { OPEN, VERIFIED, DISMISSED }
    /** 검증 cell의 주체 부류(PR#11): 소유자 자신·다른 소유자·미인증·다른 역할. */
    public enum SubjectClass { SELF, OTHER_OWNER, ANONYMOUS, OTHER_ROLE }
    public enum EndpointKind {
        OBSERVED_API,
        ARTIFACT_API,
        NAVIGATION,
        STATIC_ASSET,
        DISCOVERY_DOCUMENT,
        FORM_ACTION,
        UNVERIFIED
    }

    public record EndpointKey(String service, String method, String pathTemplate) {
        public String operation() { return service + " " + method + " " + pathTemplate; }
        public String stableKey() { return service + "\u0000" + method + "\u0000" + pathTemplate; }
    }

    public record Observation(String evidenceId, Source source, String runId, String identity, int status,
                              TrafficClassification.TrafficClass trafficClass) {
        public Observation(String evidenceId, Source source, String runId, String identity, int status) {
            this(evidenceId, source, runId, identity, status, TrafficClassification.TrafficClass.UNKNOWN);
        }
    }

    /** OPTIONS는 API 기능 관측과 분리해 보존하는 capability/preflight 근거다. */
    public record ProbeObservation(EndpointKey key, String evidenceId, Source source,
                                   String runId, String identity, int status) {}

    public record ParameterObservation(String evidenceId, Source source, String runId, String identity,
                                       int status, ValueShape shape, AccessRole role, RunPhase phase,
                                       Presence presence, ValueType valueType, int byteLength, boolean masked,
                                       String contextSignature, Confidence confidence) {}

    /**
     * 선언 근거. declaredType/declaredShape/conditionText는 OpenAPI·JS 정의가 밝힌 타입·형태·조건(oneOf[i]/anyOf[i]/enum[i] 인덱스,
     * 값은 복사하지 않음)이며 없으면 null/빈 문자열. confidence는 정의·추론이면 INFERRED(PR#11 ParameterDefinition 의미).
     */
    public record Declaration(String evidenceId, Source source, String runId, String type,
                              String adapter, String reason,
                              io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion coordinateVersion,
                              boolean coordinateResolved, ValueType declaredType, ValueShape declaredShape,
                              String conditionText, Confidence confidence) {
        public Declaration {
            conditionText = conditionText == null ? "" : conditionText;
            confidence = confidence == null ? Confidence.INFERRED : confidence;
        }
        /** endpoint 수준 선언·좌표가 확정된 파라미터 선언용(FLOW_V2, resolved). */
        public Declaration(String evidenceId, Source source, String runId, String type,
                           String adapter, String reason) {
            this(evidenceId, source, runId, type, adapter, reason,
                    io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion.FLOW_V2, true,
                    null, null, "", Confidence.INFERRED);
        }
        public Declaration(String evidenceId, Source source, String runId, String type,
                           String adapter, String reason,
                           io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion coordinateVersion,
                           boolean coordinateResolved) {
            this(evidenceId, source, runId, type, adapter, reason, coordinateVersion, coordinateResolved,
                    null, null, "", Confidence.INFERRED);
        }
    }

    public record ExtractionIssue(ExtractionIssueKind kind, String adapter, String detail,
                                  int line, int column) {}

    public record ExtractionReport(String evidenceId, Source source, String runId, String artifactKind,
                                   String adapter, ExtractionStatus status, ExtractionFailure failure, String detail,
                                   int endpointCallSites, int assetReferences, List<ExtractionIssue> issues) {
        public ExtractionReport {
            issues = issues == null ? List.of() : List.copyOf(issues);
        }

        public ExtractionReport(String evidenceId, Source source, String runId, String artifactKind,
                                String adapter, ExtractionStatus status, ExtractionFailure failure, String detail,
                                int endpointCallSites, int assetReferences) {
            this(evidenceId, source, runId, artifactKind, adapter, status, failure, detail,
                    endpointCallSites, assetReferences, List.of());
        }
    }

    /**
     * discovery 프로파일(PR#11 ParameterProfile). 분모는 coverage-eligible·discovery phase(VALIDATION/COACH_PROBE 제외)의
     * 완전한 요청 행이며, 서버가 입력을 읽는다는 증명은 아니다(serverUsageConfirmed는 항상 false).
     * contextPresence는 요청 단위 contextSignature별 존재/명시 null/관측된 문맥에서의 부재(상한 64).
     */
    public record ParameterProfile(long observationCount, Map<Source, Long> sourceCounts,
                                   Map<String, Long> identityCounts, Map<AccessRole, Long> roleCounts,
                                   Map<String, Long> runCounts, Map<RunPhase, Long> phaseCounts,
                                   Set<Presence> observedPresence, boolean typeConflict,
                                   long absentObservedContextCount,
                                   Map<String, Set<ContextPresence>> contextPresence,
                                   boolean serverUsageConfirmed) {
        public static final ParameterProfile EMPTY = new ParameterProfile(0, Map.of(), Map.of(), Map.of(), Map.of(),
                Map.of(), Set.of(), false, 0, Map.of(), false);

        public ParameterProfile {
            sourceCounts = immutableMap(sourceCounts);
            identityCounts = immutableMap(identityCounts);
            roleCounts = immutableMap(roleCounts);
            runCounts = immutableMap(runCounts);
            phaseCounts = immutableMap(phaseCounts);
            observedPresence = immutableSet(observedPresence);
            Map<String, Set<ContextPresence>> contexts = new LinkedHashMap<>();
            if (contextPresence != null) contextPresence.forEach((signature, states) -> contexts.put(signature, immutableSet(states)));
            contextPresence = Collections.unmodifiableMap(contexts);
        }

        private static <K, V> Map<K, V> immutableMap(Map<K, V> values) {
            return Collections.unmodifiableMap(new LinkedHashMap<>(values == null ? Map.of() : values));
        }

        private static <T> Set<T> immutableSet(Set<T> values) {
            return Collections.unmodifiableSet(new LinkedHashSet<>(values == null ? Set.of() : values));
        }
    }

    /**
     * 입력→권한 대상(resource) 관계 근거(PR#11 AuthorizationTargetLink). 소유권·서버 사용 증명이 아니다.
     * OBSERVED=정확한 스칼라 리소스 참조, CORROBORATED=독립 완전 증인 2건 이상의 리소스 동시출현(공개된 증인 안에서만),
     * INFERRED=단일 리소스 동시출현, UNKNOWN=관계 없음/충돌. evidenceIds는 정렬·32개 상한, evidenceCount는 전체 수.
     */
    public record AuthorizationTargetLink(String resource, Confidence confidence, String basis,
                                          List<String> evidenceIds, long evidenceCount) {
        public static final int MAX_EVIDENCE_IDS = 32;

        public AuthorizationTargetLink(String resource, Confidence confidence, String basis, List<String> evidenceIds) {
            this(resource, confidence, basis, evidenceIds, evidenceIds.stream().distinct().count());
        }

        public AuthorizationTargetLink {
            evidenceIds = evidenceIds.stream().distinct().sorted().toList();
            if (evidenceCount < evidenceIds.size()
                    || evidenceIds.size() != MAX_EVIDENCE_IDS && evidenceCount != evidenceIds.size()) {
                throw new IllegalArgumentException("evidence count must match independent evidence or its bounded preview");
            }
            evidenceIds = evidenceIds.stream().limit(MAX_EVIDENCE_IDS).toList();
        }
    }

    /**
     * 입력 지점 × 권한 대상 × subject × source의 검증 좌표(PR#11 ParameterValidationCell). verdict는 기존 wire Verdict이며
     * UNTESTED는 basis Evidence(관계 근거)만 갖고 실제 실행 Evidence는 비어 있다. applicable=false는 관계·소유자 근거가
     * 없어 검증 좌표 자체가 성립하지 않는 경우다. 판정은 AuthorizationAnalysis 정본을 재사용한다(D-050).
     */
    public record ParameterValidationCell(EndpointKey endpoint, ParameterLocation location, String canonicalPath,
                                          String targetResource, SubjectClass subjectClass, Source source,
                                          String identity, AccessRole role, Verdict verdict, String reason,
                                          boolean applicable, List<String> evidenceIds, List<String> basisEvidenceIds,
                                          long evidenceCount, long basisEvidenceCount) {
        public static final int MAX_EVIDENCE_IDS = 32;

        public ParameterValidationCell(EndpointKey endpoint, ParameterLocation location, String canonicalPath,
                                       String targetResource, SubjectClass subjectClass, Source source,
                                       String identity, AccessRole role, Verdict verdict, String reason,
                                       boolean applicable, List<String> evidenceIds, List<String> basisEvidenceIds,
                                       long evidenceCount) {
            this(endpoint, location, canonicalPath, targetResource, subjectClass, source, identity, role, verdict,
                    reason, applicable, evidenceIds, basisEvidenceIds, evidenceCount, normalizedIds(basisEvidenceIds).size());
        }

        public ParameterValidationCell {
            evidenceIds = normalizedIds(evidenceIds);
            basisEvidenceIds = normalizedIds(basisEvidenceIds);
            int disclosed = evidenceIds.size();
            if (basisEvidenceCount < basisEvidenceIds.size()
                    || basisEvidenceIds.size() != MAX_EVIDENCE_IDS && basisEvidenceCount != basisEvidenceIds.size()) {
                throw new IllegalArgumentException("basis count must match independent evidence or its bounded preview");
            }
            // 32개 미리보기는 더 큰 전체 수를 round-trip할 수 있다. 잘리지 않은 목록은 정확한 독립 수와 일치해야 한다.
            if (evidenceCount < 0 || evidenceCount < disclosed || disclosed != MAX_EVIDENCE_IDS && evidenceCount != disclosed) {
                throw new IllegalArgumentException("evidence count must match independent actual evidence or its bounded preview");
            }
            if (verdict == null || !applicable && verdict != Verdict.UNTESTED) {
                throw new IllegalArgumentException("non-applicable coordinates must be untested");
            }
            if (verdict == Verdict.UNTESTED) {
                if (!evidenceIds.isEmpty() || applicable && basisEvidenceIds.isEmpty()) {
                    throw new IllegalArgumentException("applicable untested variants require basis-only evidence");
                }
            } else if (evidenceIds.isEmpty()) {
                throw new IllegalArgumentException("tested verdicts require actual evidence");
            }
            evidenceIds = evidenceIds.stream().limit(MAX_EVIDENCE_IDS).toList();
            basisEvidenceIds = basisEvidenceIds.stream().limit(MAX_EVIDENCE_IDS).toList();
        }

        private static List<String> normalizedIds(List<String> ids) {
            if (ids == null) return List.of();
            if (ids.stream().anyMatch(id -> id == null || id.isBlank())) {
                throw new IllegalArgumentException("evidence IDs must be nonblank");
            }
            return ids.stream().distinct().sorted().toList();
        }
    }

    public record ParameterFact(ParameterLocation location, String fieldPath, String displayName,
                                Requirement requirement, Set<ValueShape> observedShapes,
                                Set<Source> observedSources, List<String> observationEvidenceIds,
                                List<ParameterObservation> observations,
                                List<Declaration> declarations, DeltaState deltaState,
                                String canonicalPath, Set<ValueType> observedValueTypes, int distinctValueCount,
                                boolean coordinateResolved, boolean distinctValueTruncated,
                                ParameterProfile profile, List<AuthorizationTargetLink> authorizationTargets) {
        public ParameterFact {
            profile = profile == null ? ParameterProfile.EMPTY : profile;
            authorizationTargets = authorizationTargets == null ? List.of() : List.copyOf(authorizationTargets);
        }
    }

    /**
     * Evidence 근거가 있는 우선순위 후보(PR#11 ParameterGap). 취약점·완전성 주장이 아니다.
     * 파라미터는 machine key(endpoint + location + canonicalPath)로만 가리키고 표시 라벨은 ParameterFact에서 찾는다.
     * evidenceIds는 독립 관측/선언 증인을 앞에 두며 32개로 잘리고 evidenceCount는 전체 distinct 수를 보존한다.
     */
    public record ParameterGap(String id, GapType type, EndpointKey endpoint, ParameterLocation location,
                               String canonicalPath, String identity, AccessRole role, Source source,
                               GapStatus status, List<String> priorityReasons, String summary,
                               List<String> evidenceIds, long evidenceCount) {
        public static final int MAX_EVIDENCE_IDS = 32;
        /** 명세 순서. 앞선 사유가 있는 gap이 먼저 오고, 같으면 안정 ID로 정렬한다. */
        public static final List<String> REASON_ORDER = List.of("CONFIRMED_AUTH_BOUNDARY", "AUTH_VARIANT_UNTESTED",
                "WRITE_METHOD", "CORROBORATED_EVIDENCE", "SOURCE_DISCREPANCY", "HUMAN_REVIEW_REQUIRED");
        public static final Comparator<ParameterGap> PRIORITY_ORDER = (a, b) -> {
            for (String reason : REASON_ORDER) {
                int comparison = Boolean.compare(b.priorityReasons.contains(reason), a.priorityReasons.contains(reason));
                if (comparison != 0) return comparison;
            }
            return a.id.compareTo(b.id);
        };

        public ParameterGap(String id, GapType type, EndpointKey endpoint, ParameterLocation location,
                            String canonicalPath, String identity, AccessRole role, Source source, GapStatus status,
                            List<String> priorityReasons, String summary, List<String> evidenceIds) {
            this(id, type, endpoint, location, canonicalPath, identity, role, source, status, priorityReasons, summary,
                    evidenceIds, evidenceIds.stream().distinct().count());
        }

        public ParameterGap {
            priorityReasons = List.copyOf(priorityReasons);
            evidenceIds = evidenceIds.stream().distinct().toList();
            if (evidenceCount < evidenceIds.size()
                    || evidenceIds.size() != MAX_EVIDENCE_IDS && evidenceCount != evidenceIds.size()) {
                throw new IllegalArgumentException("evidence count must match independent evidence or its bounded preview");
            }
            evidenceIds = evidenceIds.stream().limit(MAX_EVIDENCE_IDS).toList();
        }
    }

    /** 최상위 요청 파라미터 추출 진단(파라미터마다 복제하지 않는다). */
    public record ParameterDiagnostic(String evidenceId, String operation, String reasonCode, int droppedCount) {}

    public record EndpointFact(EndpointKey key, Set<Source> observedSources,
                               List<Observation> observations, List<Declaration> declarations,
                               List<ParameterFact> parameters, DeltaState deltaState,
                               Set<EndpointKind> kinds) {
        public EndpointFact(EndpointKey key, Set<Source> observedSources,
                            List<Observation> observations, List<Declaration> declarations,
                            List<ParameterFact> parameters, DeltaState deltaState) {
            this(key, observedSources, observations, declarations, parameters, deltaState,
                    Set.of(EndpointKind.UNVERIFIED));
        }
    }

    public SurfaceAnalysis {
        endpoints = endpoints == null ? List.of() : List.copyOf(endpoints);
        extractions = extractions == null ? List.of() : List.copyOf(extractions);
        probes = probes == null ? List.of() : List.copyOf(probes);
        parameterDiagnostics = parameterDiagnostics == null ? List.of() : List.copyOf(parameterDiagnostics);
        parameterGaps = parameterGaps == null ? List.of() : List.copyOf(parameterGaps);
        validationCells = validationCells == null ? List.of() : List.copyOf(validationCells);
    }

    public SurfaceAnalysis(List<EndpointFact> endpoints) { this(endpoints, List.of(), List.of(), List.of(), List.of(), List.of()); }

    public SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions) {
        this(endpoints, extractions, List.of(), List.of(), List.of(), List.of());
    }

    public SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions,
                           List<ProbeObservation> probes) {
        this(endpoints, extractions, probes, List.of(), List.of(), List.of());
    }

    public SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions,
                           List<ProbeObservation> probes, List<ParameterDiagnostic> parameterDiagnostics) {
        this(endpoints, extractions, probes, parameterDiagnostics, List.of(), List.of());
    }

    public SurfaceAnalysis(List<EndpointFact> endpoints, List<ExtractionReport> extractions,
                           List<ProbeObservation> probes, List<ParameterDiagnostic> parameterDiagnostics,
                           List<ParameterGap> parameterGaps) {
        this(endpoints, extractions, probes, parameterDiagnostics, parameterGaps, List.of());
    }
}
