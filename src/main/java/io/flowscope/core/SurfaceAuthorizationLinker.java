package io.flowscope.core;

import io.flowscope.core.SurfaceAnalysis.AuthorizationTargetLink;
import io.flowscope.core.SurfaceAnalysis.Confidence;
import io.flowscope.core.SurfaceAnalysis.EndpointKey;
import io.flowscope.core.SurfaceAnalysis.ParameterGap;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterValidationCell;
import io.flowscope.core.SurfaceAnalysis.SubjectClass;
import io.flowscope.core.SurfaceAnalyzer.Row;
import io.flowscope.core.parameter.ParameterObservation;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * PR#11 ParameterAuthorizationAnalyzer 의미의 수동 additive projection: 입력→권한 대상 link, subject×source 검증 cell,
 * AUTH_VARIANT_UNTESTED gap. 기존 AuthorizationAnalysis cell/finding이 판정 정본이며 여기서는 재판정하지 않는다(D-050).
 * status만으로 ALLOW를 만들지 않고 응답 근거·Evidence에 결박된 정본 판정만 재사용한다(D-004).
 * 중첩 PATH는 구조 슬롯에 대응하는 리소스 prefix에 연결하고, 단일 동시출현(INFERRED)은 확인된 인가 경계로 승격하지 않으며, 공개된 독립 증인 2건의 CORROBORATED는 확정 소유자와 함께 PR #11 원본대로 승격한다(D-146 ①②, D-154).
 */
final class SurfaceAuthorizationLinker {
    private static final int EVIDENCE_PREVIEW = AuthorizationTargetLink.MAX_EVIDENCE_IDS;
    private static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

    /** link 대상 파라미터의 machine key. */
    record Parameter(EndpointKey endpoint, ParameterLocation location, String canonicalPath) {
        String mapKey() { return location + ":" + canonicalPath; }
        String stableKey() {
            return "pk:v1:" + SurfaceAnalyzer.frame(endpoint.service()) + SurfaceAnalyzer.frame(endpoint.method())
                    + SurfaceAnalyzer.frame(endpoint.operation()) + SurfaceAnalyzer.frame(location.name())
                    + SurfaceAnalyzer.frame(canonicalPath);
        }
    }

    record Result(List<AuthorizationTargetLink> links, List<ParameterValidationCell> cells, List<ParameterGap> gaps) {}

    private record Relation(Row row, String resource, Confidence confidence) {}
    private record RoleKey(String operation, String resource, String identity) {}
    private record SemanticKey(String parameterKey, String service, String method, String path, String evidence) {}
    private record DecisionKey(AuthorizationAnalysis.CellKey cell, String evidence, Source source) {}

    private final AuthorizationAnalysis authorization;
    private final Map<RoleKey, Set<AccessRole>> roles = new HashMap<>();
    private final Map<Row, Map<String, List<ResourceReference>>> references = new IdentityHashMap<>();
    private final Map<Row, TreeSet<String>> resources = new IdentityHashMap<>();
    private final Map<SemanticKey, TreeSet<String>> semantic = new HashMap<>();
    private final Map<DecisionKey, AuthorizationAnalysis.Decision> decisions = new HashMap<>();

    /** 호출당 입력 범위의 색인. 레코드·원문 projection 입력은 결과로 새지 않는다. */
    SurfaceAuthorizationLinker(Collection<List<Row>> endpointRows, AuthorizationAnalysis authorization) {
        this.authorization = authorization == null ? AuthorizationAnalysis.empty() : authorization;
        Map<String, Row> byEvidence = new HashMap<>();
        for (List<Row> rows : endpointRows) {
            for (Row row : rows) {
                RequestRecord r = row.record();
                byEvidence.put(r.evidenceId, row);
                if (knownRole(r.role)) {
                    roles.computeIfAbsent(new RoleKey(r.op, r.resource, null), ignored -> new TreeSet<>()).add(r.role);
                    roles.computeIfAbsent(new RoleKey(r.op, r.resource, r.idn), ignored -> new TreeSet<>()).add(r.role);
                }
                Map<String, List<ResourceReference>> refs = new HashMap<>();
                TreeSet<String> targets = new TreeSet<>();
                if (r.resource != null) targets.add(r.resource);
                for (ResourceReference ref : r.resourceReferences == null ? List.<ResourceReference>of() : r.resourceReferences) {
                    if (ref.resource() == null) continue;
                    targets.add(ref.resource());
                    for (ResourceReference indexed : resourcePrefixes(ref)) {
                        int colon = indexed.resource().lastIndexOf(':');
                        if (colon >= 0) {
                            refs.computeIfAbsent(SurfaceAnalyzer.digest(indexed.resource().substring(colon + 1)),
                                    ignored -> new ArrayList<>()).add(indexed);
                        }
                    }
                }
                references.put(row, refs);
                resources.put(row, targets);
                for (Map.Entry<String, ParameterObservation> entry : row.observed().entrySet()) {
                    ParameterObservation observation = entry.getValue();
                    if (!row.complete() || observation.shape() != ParameterObservation.Shape.SCALAR
                            || observation.value() == null || observation.value().digest() == null) continue;
                    for (ResourceReference ref : refs.getOrDefault(observation.value().digest(), List.of())) {
                        if (ref.evidence() == null || !ref.evidence().endsWith("SEMANTIC_FIELD_CORROBORATED")) continue;
                        String id = ref.resource().substring(ref.resource().lastIndexOf(':') + 1);
                        if (id.isBlank() || id.contains("***") || id.length() > 256) continue;
                        TreeSet<String> witnesses = semantic.computeIfAbsent(
                                new SemanticKey(r.op + "\0" + entry.getKey(), r.service, r.method, r.path, ref.evidence()),
                                ignored -> new TreeSet<>());
                        // Normalizer.SemanticFieldCatalog는 실제 값 2개가 다를 때 정확히 승격한다.
                        witnesses.add(id);
                        if (witnesses.size() > 2) witnesses.pollLast();
                    }
                }
            }
        }
        for (AuthorizationAnalysis.CoverageCell cell : this.authorization.cells()) {
            Set<String> ids = new LinkedHashSet<>(cell.evidenceIds());
            Map<Source, RequestRecord> representatives = new EnumMap<>(Source.class);
            EnumSet<Source> conflicting = EnumSet.noneOf(Source.class);
            boolean complete = true;
            for (String id : ids) {
                Row witness = byEvidence.get(id);
                if (witness == null) { complete = false; continue; }
                RequestRecord r = witness.record();
                RequestRecord prior = representatives.putIfAbsent(r.source, r);
                if (prior != null && !sameDecisionInputs(prior, r)) conflicting.add(r.source);
            }
            if (!complete) continue;
            for (String id : ids) {
                RequestRecord r = byEvidence.get(id).record();
                AuthorizationAnalysis.Decision decision = cell.perSource().get(r.source);
                if (!conflicting.contains(r.source) && decision != null && decision.verdict() != Verdict.UNTESTED) {
                    decisions.putIfAbsent(new DecisionKey(cell.key(), id, r.source), decision);
                }
            }
        }
    }

    /** endpointRows는 Evidence ID 순으로 정렬된 그 operation의 모든 행(discovery + VALIDATION)이다. */
    Result link(Parameter parameter, List<Row> endpointRows) {
        String mapKey = parameter.mapKey();
        boolean completeComparison = endpointRows.stream().allMatch(Row::complete);
        Map<String, List<Relation>> groups = new TreeMap<>();
        for (Row row : endpointRows) {
            ParameterObservation observation = row.observed().get(mapKey);
            if (observation == null) continue;
            Relation relation = relation(row, observation, parameter);
            groups.computeIfAbsent(SurfaceAnalyzer.frame(relation.resource), ignored -> new ArrayList<>()).add(relation);
        }
        List<AuthorizationTargetLink> links = new ArrayList<>();
        List<ParameterValidationCell> cells = new ArrayList<>();
        List<ParameterGap> gaps = new ArrayList<>();
        // 선언만 있는 파라미터는 대상 리소스나 subject 분모를 만들지 않는다(관계 행이 없으면 groups가 비어 있다).
        for (List<Relation> relations : groups.values()) {
            String resource = relations.getFirst().resource;
            List<String> ids = relations.stream().map(r -> r.row.record().evidenceId).distinct().sorted().toList();
            Confidence confidence = relations.stream().anyMatch(r -> r.confidence == Confidence.UNKNOWN)
                    ? Confidence.UNKNOWN : relations.stream().allMatch(r -> r.confidence == Confidence.OBSERVED)
                    ? Confidence.OBSERVED : corroborated(relations, ids) ? Confidence.CORROBORATED : Confidence.INFERRED;
            AuthorizationTargetLink link = new AuthorizationTargetLink(resource, confidence, switch (confidence) {
                case OBSERVED -> "EXACT_SCALAR_RESOURCE_REFERENCE";
                case CORROBORATED -> "INDEPENDENT_RESOURCE_TYPE_COOCCURRENCE";
                case INFERRED -> "SINGLE_RESOURCE_COOCCURRENCE";
                case UNKNOWN -> "MISSING_OR_CONFLICTING_RESOURCE_RELATION";
            }, ids);
            links.add(link);
            AuthorizationAnalysis.OwnerInfo owner = resource == null ? null : authorization.owners().get(resource);
            boolean confirmedOwner = owner != null && owner.confirmed() && owner.identity() != null;
            String operation = parameter.endpoint().operation();
            Set<AccessRole> knownRoles = roles.getOrDefault(new RoleKey(operation, resource, null), Set.of());
            Set<AccessRole> ownerRoles = confirmedOwner
                    ? roles.getOrDefault(new RoleKey(operation, resource, owner.identity()), Set.of()) : Set.of();
            boolean knownRelation = resource != null && confidence != Confidence.UNKNOWN;
            TreeSet<Source> sources = new TreeSet<>();
            relations.forEach(r -> sources.add(r.row.record().source));
            for (Source source : sources) {
                for (SubjectClass subject : SubjectClass.values()) {
                    boolean applicable = source != Source.UNKNOWN && knownRelation && switch (subject) {
                        case SELF, OTHER_OWNER -> confirmedOwner;
                        case ANONYMOUS -> true;
                        case OTHER_ROLE -> ownerRoles.size() == 1 || knownRoles.size() > 1;
                    };
                    Map<String, List<RequestRecord>> tested = new TreeMap<>();
                    Map<String, AuthorizationAnalysis.Decision> testedDecisions = new TreeMap<>();
                    if (applicable) for (Relation relation : relations) {
                        RequestRecord r = relation.row.record();
                        if (r.source != source || !r.hasResponse || !matches(subject, r, owner, ownerRoles, knownRoles)) continue;
                        AuthorizationAnalysis.Decision decision = decision(r, resource);
                        String key = SurfaceAnalyzer.frame(r.idn) + SurfaceAnalyzer.frame(String.valueOf(r.role))
                                + SurfaceAnalyzer.frame(decision.verdict().name()) + SurfaceAnalyzer.frame(decision.reason());
                        tested.computeIfAbsent(key, ignored -> new ArrayList<>()).add(r);
                        testedDecisions.put(key, decision);
                    }
                    if (tested.isEmpty()) {
                        String identity = subject == SubjectClass.SELF && confirmedOwner ? owner.identity()
                                : subject == SubjectClass.ANONYMOUS ? Fingerprints.ANONYMOUS : null;
                        ParameterValidationCell cell = new ParameterValidationCell(parameter.endpoint(), parameter.location(),
                                parameter.canonicalPath(), resource, subject, source, identity,
                                subject == SubjectClass.ANONYMOUS ? AccessRole.ANONYMOUS : AccessRole.UNKNOWN,
                                Verdict.UNTESTED, applicable ? "AUTH_VARIANT_NOT_OBSERVED" : "SUBJECT_RELATION_NOT_ESTABLISHED",
                                applicable, List.of(), ids, 0);
                        cells.add(cell);
                        if (applicable && completeComparison) gaps.add(gap(parameter, cell, link, confirmedOwner));
                    } else for (Map.Entry<String, List<RequestRecord>> entry : tested.entrySet()) {
                        List<RequestRecord> evidence = entry.getValue();
                        RequestRecord r = evidence.getFirst();
                        AuthorizationAnalysis.Decision decision = testedDecisions.get(entry.getKey());
                        List<String> actual = evidence.stream().map(v -> v.evidenceId).distinct().sorted().toList();
                        cells.add(new ParameterValidationCell(parameter.endpoint(), parameter.location(), parameter.canonicalPath(),
                                resource, subject, source, r.idn, r.role, decision.verdict(), decision.reason(), true,
                                actual, ids, actual.size()));
                    }
                }
            }
        }
        return new Result(links, cells, gaps);
    }

    private Relation relation(Row row, ParameterObservation observation, Parameter parameter) {
        List<ResourceReference> matching = observation.value() == null || observation.value().digest() == null
                ? List.of() : references.get(row).getOrDefault(observation.value().digest(), List.of());
        List<String> exact = matching.stream().filter(ref -> exact(row.record(), observation, parameter, ref))
                .map(ResourceReference::resource).distinct().toList();
        if (exact.size() == 1) return new Relation(row, exact.getFirst(), Confidence.OBSERVED);
        TreeSet<String> targets = resources.get(row);
        if (exact.isEmpty() && targets.size() == 1) return new Relation(row, targets.first(), Confidence.INFERRED);
        return new Relation(row, null, Confidence.UNKNOWN);
    }

    private boolean exact(RequestRecord original, ParameterObservation observation, Parameter parameter,
                          ResourceReference reference) {
        if (observation.shape() != ParameterObservation.Shape.SCALAR || observation.value() == null
                || reference.resource() == null) return false;
        String resource = reference.resource();
        int colon = resource.lastIndexOf(':');
        if (colon < 0) return false;
        String id = resource.substring(colon + 1);
        if (!SurfaceAnalyzer.digest(id).equals(observation.value().digest())) return false;
        if (parameter.location() == ParameterLocation.PATH) {
            String pathResource = pathResourceForSlot(original, parameter);
            return pathResource != null && resource.equals(pathResource);
        }
        // 값이 같다는 것만으로는 부족하다: 정확한 의미 leaf가 이 참조를 만들어야 한다(정본 field→resource 규칙 재사용).
        String path = observation.key().canonicalPath();
        String field = path.substring(path.lastIndexOf('/') + 1).replace("~1", "/").replace("~2", "*").replace("~0", "~");
        RequestRecord probe = scalarProjection(original, field, id);
        List<RequestRecord> projections = new ArrayList<>();
        projections.add(probe);
        boolean semanticReference = reference.evidence() != null && reference.evidence().endsWith("SEMANTIC_FIELD_CORROBORATED");
        if (semanticReference) {
            for (String otherId : semantic.getOrDefault(new SemanticKey(original.op + "\0" + parameter.mapKey(),
                    original.service, original.method, original.path, reference.evidence()), new TreeSet<>())) {
                projections.add(scalarProjection(original, field, otherId));
            }
        }
        // 실제 캡처된 스칼라 값만 재생한다. 조작된 레코드로 corroboration을 증명하지 않는다.
        Normalizer.normalizeAll(projections);
        return probe.resourceReferences.stream().anyMatch(ref -> resource.equals(ref.resource())
                && ("QUERY_ID".equals(ref.evidence())
                || semanticReference && "QUERY_SEMANTIC_FIELD_CORROBORATED".equals(ref.evidence())));
    }

    /** Index every parent prefix without changing the RequestRecord's stored resource references. */
    private static List<ResourceReference> resourcePrefixes(ResourceReference reference) {
        String resource = reference.resource();
        int serviceEnd = resource == null ? -1 : resource.indexOf(' ');
        if (serviceEnd < 0 || serviceEnd + 1 >= resource.length()) return List.of(reference);
        String service = resource.substring(0, serviceEnd + 1);
        String[] chain = resource.substring(serviceEnd + 1).split("/", -1);
        List<ResourceReference> prefixes = new ArrayList<>();
        StringBuilder prefix = new StringBuilder(service);
        for (int i = 0; i < chain.length; i++) {
            if (chain[i].isBlank() || chain[i].lastIndexOf(':') <= 0) return List.of(reference);
            if (i > 0) prefix.append('/');
            prefix.append(chain[i]);
            prefixes.add(new ResourceReference(prefix.toString(), reference.evidence()));
        }
        return List.copyOf(prefixes);
    }

    /** Map a structural PATH coordinate to the corresponding prefix of the normalized resource chain. */
    private static String pathResourceForSlot(RequestRecord original, Parameter parameter) {
        List<io.flowscope.core.parameter.PathSlotCanonicalizer.Slot> slots =
                io.flowscope.core.parameter.ParameterCoordinates.pathSlots(parameter.endpoint().pathTemplate());
        int ordinal = -1;
        for (int i = 0; i < slots.size(); i++) {
            if (slots.get(i).canonicalPath().equals(parameter.canonicalPath())) { ordinal = i; break; }
        }
        if (ordinal < 0) return null;
        String chain = Normalizer.normalize(original.method, original.path).resource;
        if (chain == null) return null;
        String[] resources = chain.split("/", -1);
        if (ordinal >= resources.length) return null;
        return original.service + " " + String.join("/", java.util.Arrays.copyOf(resources, ordinal + 1));
    }

    private static RequestRecord scalarProjection(RequestRecord original, String field, String id) {
        String template = Normalizer.normalize(original.method, original.path).op;
        RequestRecord probe = new RequestRecord(Source.UNKNOWN, original.service, original.method,
                template.substring(template.indexOf(' ') + 1), 0, Fingerprints.UNRESOLVED);
        probe.query = URLEncoder.encode(field, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(id, StandardCharsets.UTF_8);
        return probe;
    }

    /** 리소스별 link는 자기 confidence를 정당화하는 완전한 독립 증인을 공개 목록 안에서 보여야 한다. */
    private static boolean corroborated(List<Relation> relations, List<String> ids) {
        Set<String> disclosed = new TreeSet<>(ids.stream().limit(EVIDENCE_PREVIEW).toList());
        return relations.stream().filter(r -> r.row.complete() && r.confidence != Confidence.UNKNOWN
                        && disclosed.contains(r.row.record().evidenceId))
                .map(r -> r.row.record().evidenceId).distinct().limit(2).count() == 2;
    }

    private static boolean matches(SubjectClass subject, RequestRecord r, AuthorizationAnalysis.OwnerInfo owner,
                                   Set<AccessRole> ownerRoles, Set<AccessRole> knownRoles) {
        boolean anonymous = Fingerprints.ANONYMOUS.equals(r.idn);
        boolean knownIdentity = r.idn != null && !r.idn.startsWith("unresolved");
        return switch (subject) {
            case SELF -> knownIdentity && owner.identity().equals(r.idn);
            case OTHER_OWNER -> knownIdentity && !anonymous && !owner.identity().equals(r.idn);
            case ANONYMOUS -> anonymous;
            case OTHER_ROLE -> knownRole(r.role) && (ownerRoles.size() == 1
                    ? !ownerRoles.contains(r.role) : knownRoles.stream().anyMatch(role -> role != r.role));
        };
    }

    /** 응답 근거로 DENY/UNDECIDED만 직접 읽고, 성공 응답의 ALLOW/SUSPICIOUS는 Evidence에 결박된 정본 판정만 재사용한다. */
    private AuthorizationAnalysis.Decision decision(RequestRecord r, String resource) {
        if ("HEAD".equals(r.method) || "OPTIONS".equals(r.method)) {
            return new AuthorizationAnalysis.Decision(Verdict.UNDECIDED, "METADATA_METHOD_NOT_AUTHORIZATION_PROOF", false);
        }
        if (ResponseEvidence.denied(r)) return new AuthorizationAnalysis.Decision(Verdict.DENY, "RESPONSE_DENIAL_EVIDENCE", false);
        if (!ResponseEvidence.successful(r)) return new AuthorizationAnalysis.Decision(Verdict.UNDECIDED, "AMBIGUOUS_RESPONSE_EVIDENCE", false);
        AuthorizationAnalysis.Decision decision = decisions.get(new DecisionKey(
                new AuthorizationAnalysis.CellKey(r.idn, r.op, resource), r.evidenceId, r.source));
        if (decision != null) return decision;
        return new AuthorizationAnalysis.Decision(Verdict.UNDECIDED, "NO_EVIDENCE_BOUND_POLICY_DECISION", false);
    }

    private static boolean sameDecisionInputs(RequestRecord a, RequestRecord b) {
        return Objects.equals(a.idn, b.idn) && Objects.equals(a.op, b.op) && Objects.equals(a.resource, b.resource)
                && a.method.equals(b.method) && a.role == b.role && a.hasResponse == b.hasResponse && a.status == b.status
                && Objects.equals(a.location, b.location) && Objects.equals(a.responseBodyForAnalysis(), b.responseBodyForAnalysis());
    }

    private static ParameterGap gap(Parameter parameter, ParameterValidationCell cell, AuthorizationTargetLink link,
                                    boolean confirmedOwner) {
        List<String> reasons = new ArrayList<>();
        if (confirmedOwner && (link.confidence() == Confidence.OBSERVED || link.confidence() == Confidence.CORROBORATED)) {
            reasons.add("CONFIRMED_AUTH_BOUNDARY");
        }
        reasons.add("AUTH_VARIANT_UNTESTED");
        if (WRITE_METHODS.contains(parameter.endpoint().method())) reasons.add("WRITE_METHOD");
        if (link.confidence() == Confidence.CORROBORATED) reasons.add("CORROBORATED_EVIDENCE");
        if (link.confidence() == Confidence.INFERRED || link.confidence() == Confidence.UNKNOWN) reasons.add("HUMAN_REVIEW_REQUIRED");
        return new ParameterGap("pg:auth:" + SurfaceAnalyzer.digest(cellKey(parameter, cell)),
                SurfaceAnalysis.GapType.AUTH_VARIANT_UNTESTED, parameter.endpoint(), parameter.location(),
                parameter.canonicalPath(), cell.identity(), cell.role(), cell.source(), SurfaceAnalysis.GapStatus.OPEN,
                reasons, cell.subjectClass() + ": 권한 변형이 아직 검증되지 않았다", cell.basisEvidenceIds(),
                cell.basisEvidenceCount());
    }

    static String cellKey(Parameter parameter, ParameterValidationCell c) {
        return parameter.stableKey() + SurfaceAnalyzer.frame(c.targetResource()) + c.subjectClass() + ":" + c.source()
                + SurfaceAnalyzer.frame(c.identity()) + c.role() + ":" + c.verdict() + SurfaceAnalyzer.frame(c.reason());
    }

    static String cellKey(ParameterValidationCell c) {
        return cellKey(new Parameter(c.endpoint(), c.location(), c.canonicalPath()), c);
    }

    private static boolean knownRole(AccessRole role) {
        return role != null && role != AccessRole.UNKNOWN && role != AccessRole.ANONYMOUS;
    }
}
