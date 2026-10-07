package io.flowscope.core;

import com.fasterxml.jackson.core.exc.StreamConstraintsException;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static io.flowscope.core.AuthorizationAnalysis.*;

/**
 * 상태코드 + 소유자 + 응답본문을 결합하는 결정론적 인가 분석기.
 * LLM은 이 결과를 설명·우선순위화할 수 있지만 판정 자체를 바꾸지 않는다.
 */
public final class AuthorizationAnalyzer {

    private static final int COLLECTION_MEMBERSHIP_CONFIDENCE = 60;
    /** 생성 요청자: POST 성공 응답이 돌려준 새 객체 ID를 나중에 관측된 객체와 이어 붙인 O2 근거. 공격자가 먼저 만들 수 없는 신호다. */
    private static final int CREATION_CONFIDENCE = 80;
    private static final Set<String> OWNER_FIELDS = Set.of(
            "owner", "ownerid", "userid", "authorid", "accountid");
    private static final Set<String> PRINCIPAL_OBJECT_FIELDS = Set.of(
            "owner", "user", "author", "account", "customer");
    private static final Set<String> PRINCIPAL_ID_FIELDS = Set.of(
            "id", "email", "username", "sub", "subject");
    private static final Pattern OWNER_FIELD = Pattern.compile(
            "(?i)[\\\"']?(owner|ownerId|owner_id|userId|user_id|authorId|author_id|accountId|account_id)[\\\"']?"
                    + "\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:@/-]+)");

    private AuthorizationAnalyzer() {}

    public static AuthorizationAnalysis analyze(List<RequestRecord> records, AnalysisConfig config) {
        if (records == null || records.isEmpty()) return AuthorizationAnalysis.empty();
        if (records.stream().anyMatch(r -> r.op == null || r.idn == null)) Normalizer.normalizeAll(records);
        EvidenceIds.assign(records);
        applyRoles(records, config);

        List<RequestRecord> analyzable = records.stream()
                .filter(r -> r.source != Source.UNKNOWN)
                .filter(r -> r.hasResponse)
                .filter(r -> r.phase != RunPhase.VALIDATION && r.phase != RunPhase.COACH_PROBE)
                .toList();
        if (analyzable.isEmpty()) return AuthorizationAnalysis.empty();

        Map<String, OwnerInfo> owners = resolveOwners(analyzable, config);
        Set<Source> activeSources = EnumSet.noneOf(Source.class);
        analyzable.stream().map(r -> r.source).forEach(activeSources::add);

        Map<CellKey, List<RequestRecord>> grouped = new LinkedHashMap<>();
        for (RequestRecord r : analyzable) {
            CellKey key = new CellKey(r.idn, r.op, r.resource);
            grouped.computeIfAbsent(key, ignored -> new ArrayList<>()).add(r);
        }

        List<CoverageCell> cells = new ArrayList<>();
        List<Finding> findings = new ArrayList<>();
        List<Gap> gaps = new ArrayList<>();

        for (Map.Entry<CellKey, List<RequestRecord>> entry : grouped.entrySet()) {
            CellKey key = entry.getKey();
            List<RequestRecord> evidence = entry.getValue();
            Map<Source, List<RequestRecord>> bySource = new EnumMap<>(Source.class);
            for (RequestRecord r : evidence) bySource.computeIfAbsent(r.source, ignored -> new ArrayList<>()).add(r);

            Map<Source, Decision> decisions = new EnumMap<>(Source.class);
            for (Map.Entry<Source, List<RequestRecord>> sourceEntry : bySource.entrySet()) {
                decisions.put(sourceEntry.getKey(), decide(key, sourceEntry.getValue(), owners.get(key.resource()), config));
            }
            Set<Source> missed = EnumSet.noneOf(Source.class);
            missed.addAll(activeSources);
            missed.removeAll(decisions.keySet());
            Set<Verdict> distinct = new LinkedHashSet<>();
            decisions.entrySet().stream().filter(e -> e.getKey() != Source.UNKNOWN)
                    .map(e -> e.getValue().verdict()).forEach(distinct::add);
            boolean conflict = distinct.size() > 1;
            Verdict overall = overall(decisions.values());
            List<String> evidenceIds = evidence.stream().map(r -> r.evidenceId).toList();
            CoverageCell cell = new CoverageCell(key, Map.copyOf(decisions), overall, conflict,
                    Set.copyOf(missed), evidenceIds);
            cells.add(cell);

            if (conflict) {
                gaps.add(new Gap(gapId(GapType.CONFLICT, key), GapType.CONFLICT,
                        key.identity(), key.operation(), key.resource(), Set.of(), 90,
                        "같은 접근 조합의 소스별 판정이 다름"));
            }
            if (!missed.isEmpty() && activeSources.size() > 1) {
                gaps.add(new Gap(gapId(GapType.PARTIAL_DISCOVERY, key), GapType.PARTIAL_DISCOVERY,
                        key.identity(), key.operation(), key.resource(), Set.copyOf(missed), 50,
                        "일부 관측 소스만 이 조합을 실행함"));
            }
            addFindings(cell, findings, config);
        }

        addUncrossed(grouped.keySet(), analyzable, owners, gaps);
        gaps.sort(Comparator.comparingInt(Gap::risk).reversed().thenComparing(Gap::id));
        findings.sort(Comparator.comparingInt((Finding f) -> severityRank(f.severity())).reversed()
                .thenComparing(Finding::id));
        return new AuthorizationAnalysis(Map.copyOf(owners), List.copyOf(cells), List.copyOf(gaps),
                List.copyOf(findings), Set.copyOf(activeSources));
    }

    private static void applyRoles(List<RequestRecord> records, AnalysisConfig config) {
        for (RequestRecord r : records) {
            AccessRole configured = config.identityRole(r.idn);
            r.role = Fingerprints.ANONYMOUS.equals(r.idn) ? AccessRole.ANONYMOUS : configured;
        }
    }

    private static Map<String, OwnerInfo> resolveOwners(List<RequestRecord> records, AnalysisConfig config) {
        Map<String, Map<String, String>> aliasesByService = new LinkedHashMap<>();
        for (RequestRecord r : records) {
            Map<String, String> aliases = aliasesByService.computeIfAbsent(r.service, ignored -> new LinkedHashMap<>());
            aliases.put(r.idn.toLowerCase(Locale.ROOT), r.idn);
            String subject = subjectOf(r.fp);
            if (subject != null) aliases.put(subject.toLowerCase(Locale.ROOT), r.idn);
        }
        Map<String, Set<String>> explicit = new LinkedHashMap<>();
        Map<String, RequestRecord> firstSuccess = new LinkedHashMap<>();
        for (RequestRecord r : records) {
            if (r.resource == null) continue;
            if (isSuccessful(r) && !isMetadataMethod(r.method)) {
                firstSuccess.putIfAbsent(r.resource, r);
                for (String ownerValue : ownerValues(r.responseBodyForAnalysis())) {
                    String identity = aliasesByService.getOrDefault(r.service, Map.of())
                            .get(ownerValue.toLowerCase(Locale.ROOT));
                    if (identity != null) {
                        explicit.computeIfAbsent(r.resource, ignored -> new LinkedHashSet<>()).add(identity);
                    }
                }
            }
        }
        Map<String, Set<String>> collectionMembers = collectionMembers(records);
        Map<String, Set<String>> creators = creators(records);

        Map<String, OwnerInfo> result = new LinkedHashMap<>();
        Set<String> resources = new LinkedHashSet<>();
        records.stream().map(r -> r.resource).filter(java.util.Objects::nonNull).forEach(resources::add);
        for (String resource : resources) {
            String configured = config.resourceOwner(resource);
            if (configured != null) {
                result.put(resource, new OwnerInfo(resource, configured, 100,
                        "사용자 명시 소유자", true));
                continue;
            }
            Set<String> candidates = explicit.getOrDefault(resource, Set.of());
            if (candidates.size() == 1) {
                String identity = candidates.iterator().next();
                result.put(resource, new OwnerInfo(resource, identity, 100,
                        "응답 본문의 명시적 소유 필드", true));
            } else if (candidates.size() > 1) {
                result.put(resource, new OwnerInfo(resource, null, 0,
                        "소유 필드 충돌: " + candidates, false));
            } else if (creators.getOrDefault(resource, Set.of()).size() == 1) {
                String identity = creators.get(resource).iterator().next();
                result.put(resource, new OwnerInfo(resource, identity, CREATION_CONFIDENCE,
                        "생성 요청자(생성 응답이 이 객체 ID를 반환)", false));
            } else if (creators.getOrDefault(resource, Set.of()).size() > 1) {
                result.put(resource, new OwnerInfo(resource, null, 0,
                        "생성 응답 충돌: " + creators.get(resource), false));
            } else if (collectionMembers.getOrDefault(resource, Set.of()).size() == 1) {
                String identity = collectionMembers.get(resource).iterator().next();
                result.put(resource, new OwnerInfo(resource, identity, COLLECTION_MEMBERSHIP_CONFIDENCE,
                        "단일 신원 컬렉션 멤버십(교차 확인)", false));
            } else if (collectionMembers.getOrDefault(resource, Set.of()).size() > 1) {
                result.put(resource, new OwnerInfo(resource, null, 0,
                        "컬렉션 멤버십 공유/공개: " + collectionMembers.get(resource), false));
            } else if (firstSuccess.containsKey(resource)) {
                result.put(resource, new OwnerInfo(resource, firstSuccess.get(resource).idn, 20,
                        "첫 성공 접근자(저신뢰 후보, 판정 제외)", false));
            }
        }
        return result;
    }

    /**
     * 생성 요청자 추정(RESTler식 "만든 사람 = 소유자"). 로그인된 신원의 POST가 성공하고 그 응답이 새 객체 ID(최상위 또는
     * 한 단계 아래 객체의 "id")를 돌려주면, 같은 서비스에서 {@code [부모 체인/]컬렉션:ID}로 관측된 객체의 생성자로 본다.
     * 경로 끝이 객체 ID인 POST(기존 객체에 대한 동작)와 비로그인·신원 불명 요청은 쓰지 않는다.
     */
    private static Map<String, Set<String>> creators(List<RequestRecord> records) {
        Set<String> observed = new LinkedHashSet<>();
        records.stream().map(r -> r.resource).filter(java.util.Objects::nonNull).forEach(observed::add);
        Map<String, Set<String>> result = new LinkedHashMap<>();
        for (RequestRecord create : records) {
            if (!"POST".equalsIgnoreCase(create.method) || !isSuccessful(create) || create.idn == null
                    || Fingerprints.ANONYMOUS.equals(create.idn)) continue;
            Normalizer.Normalized normalized = Normalizer.normalize(create.method, create.path);
            String opPath = normalized.op.substring(normalized.op.indexOf(' ') + 1);
            String collection = opPath.substring(opPath.lastIndexOf('/') + 1);
            if (collection.isBlank() || "{id}".equals(collection)) continue;
            String prefix = create.service + " " + (normalized.resource == null ? "" : normalized.resource + "/") + collection + ":";
            for (String id : createdIds(create.responseBodyForAnalysis())) {
                String resource = prefix + id;
                if (observed.contains(resource)) result.computeIfAbsent(resource, ignored -> new LinkedHashSet<>()).add(create.idn);
            }
        }
        return result;
    }

    private static Set<String> createdIds(String body) {
        if (body == null || body.isBlank() || body.length() > ResponseEvidence.MAX_ANALYSIS_CHARS) return Set.of();
        try {
            JsonNode root = ResponseEvidence.parseBoundedJson(body);
            if (root == null || !root.isObject()) return Set.of();
            Set<String> ids = new LinkedHashSet<>();
            addId(root.get("id"), ids);
            root.elements().forEachRemaining(child -> { if (child.isObject()) addId(child.get("id"), ids); });
            return ids;
        } catch (Exception unreadable) {
            return Set.of();
        }
    }

    private static void addId(JsonNode value, Set<String> ids) {
        if (value != null && (value.isTextual() || value.isIntegralNumber()) && !value.asText().isBlank()) ids.add(value.asText());
    }

    private static Map<String, Set<String>> collectionMembers(List<RequestRecord> records) {
        Map<CollectionFamily, Set<String>> resourcesByFamily = new LinkedHashMap<>();
        for (RequestRecord detail : records) {
            if (detail.resource == null || !"GET".equalsIgnoreCase(detail.method)) continue;
            String detailOperation = Normalizer.normalize(detail.method, detail.path).op;
            if (!detailOperation.endsWith("/{id}")) continue;
            String collectionOperation = detailOperation.substring(0, detailOperation.length() - "/{id}".length());
            resourcesByFamily.computeIfAbsent(new CollectionFamily(detail.service, collectionOperation),
                    ignored -> new LinkedHashSet<>()).add(detail.resource);
        }

        Map<String, Set<String>> result = new LinkedHashMap<>();
        for (RequestRecord collection : records) {
            if (!"GET".equalsIgnoreCase(collection.method) || !isSuccessful(collection)
                    || collection.idn == null || Fingerprints.ANONYMOUS.equals(collection.idn)) continue;
            CollectionFamily family = new CollectionFamily(collection.service,
                    Normalizer.normalize(collection.method, collection.path).op);
            for (String resource : resourcesByFamily.getOrDefault(family, Set.of())) {
                if (ResponseEvidence.showsObject(collection.responseBodyForAnalysis(), resource, collection.idn)) {
                    result.computeIfAbsent(resource, ignored -> new LinkedHashSet<>()).add(collection.idn);
                }
            }
        }
        return result;
    }

    private record CollectionFamily(String service, String operation) {}

    private static String subjectOf(String fingerprint) {
        if (fingerprint == null) return null;
        int marker = fingerprint.lastIndexOf(":sub:");
        if (marker >= 0) return fingerprint.substring(marker + 5);
        return fingerprint.startsWith("sub:") ? fingerprint.substring(4) : null;
    }

    private static Decision decide(CellKey key, List<RequestRecord> evidence, OwnerInfo owner, AnalysisConfig config) {
        List<RequestRecord> observed = evidence.stream().filter(r -> r.hasResponse).toList();
        if (observed.isEmpty()) return new Decision(Verdict.UNTESTED, "실제 응답이 없음", false);
        if (isMetadataMethod(observed.get(0).method)) {
            return new Decision(Verdict.UNDECIDED, "OPTIONS/HEAD는 소유권 성공 증거에서 제외", false);
        }

        List<RequestRecord> successful = observed.stream().filter(AuthorizationAnalyzer::isSuccessful).toList();
        if (successful.isEmpty()) {
            if (observed.stream().anyMatch(AuthorizationAnalyzer::isDenied)) {
                return new Decision(Verdict.DENY, "401/403, 로그인 리다이렉트 또는 soft-deny 응답", false);
            }
            return new Decision(Verdict.UNDECIDED, "404/429/5xx 또는 해석 불가능한 응답", false);
        }

        AccessRole actual = evidence.stream().map(r -> r.role)
                .filter(role -> role != null && role != AccessRole.UNKNOWN).findFirst()
                .orElse(config.identityRole(key.identity()));
        AccessRole required = config.endpointRequirement(key.operation());
        AuthorizationPolicy.LayerDecision functionExpected = AuthorizationPolicy.function(actual, required);
        if (functionExpected == AuthorizationPolicy.LayerDecision.DENY) {
            return new Decision(Verdict.SUSPICIOUS,
                    "기능층(BFLA) 차단 기대: " + actual.label() + " 권한이 "
                            + required.label() + " 요구 엔드포인트에 성공", true);
        }
        if (key.resource() == null) return new Decision(Verdict.ALLOW, "객체 없는 엔드포인트 성공", false);
        ResourcePolicy resourcePolicy = config.resourcePolicy(key.operation(), key.resource());
        String ownerId = owner == null ? null : owner.identity();
        AccessRole ownerRole = ownerId == null ? AccessRole.UNKNOWN : config.identityRole(ownerId);
        AuthorizationPolicy.LayerDecision objectExpected = AuthorizationPolicy.object(resourcePolicy,
                key.identity(), actual, ownerId, ownerRole, owner != null && owner.decisionGrade());
        if (objectExpected == AuthorizationPolicy.LayerDecision.ALLOW) {
            return new Decision(Verdict.ALLOW, "객체층 허용 기대(" + resourcePolicy.label() + ")", false);
        }
        if (objectExpected == AuthorizationPolicy.LayerDecision.UNKNOWN) {
            return new Decision(Verdict.UNTESTED, resourcePolicy == ResourcePolicy.UNKNOWN
                    ? "소유자 근거 미확정" : "객체층 정책 판정에 필요한 소유자·역할 근거 미확정", false);
        }
        if (isWrite(successful.get(0).method)) {
            return new Decision(Verdict.SUSPICIOUS,
                    "객체층(BOLA) 차단 기대(" + resourcePolicy.label() + ")인데 상태변경 요청이 성공", false);
        }
        if (successful.stream().anyMatch(r -> ResponseEvidence.showsObject(
                r.responseBodyForAnalysis(), key.resource(), ownerId == null ? key.identity() : ownerId))) {
            return new Decision(Verdict.SUSPICIOUS,
                    "객체층(BOLA) 차단 기대(" + resourcePolicy.label() + ")인데 대상 객체 응답이 반환됨", false);
        }
        return new Decision(Verdict.UNDECIDED, "차단 기대 성공 응답이지만 대상 객체 포함 여부를 확인할 수 없음", false);
    }

    private static void addFindings(CoverageCell cell, List<Finding> findings, AnalysisConfig config) {
        if (cell.overall() != Verdict.SUSPICIOUS) return;
        boolean bfla = cell.perSource().values().stream().anyMatch(Decision::roleViolation);
        FindingType type = bfla ? FindingType.BFLA : FindingType.BOLA;
        Severity severity = bfla ? Severity.HIGH : (isWrite(operationMethod(cell.key().operation())) ? Severity.CRITICAL : Severity.HIGH);
        String title = (type == FindingType.BFLA ? "기능 권한 우회 후보: " : "객체 권한 우회 후보: ")
                + operationWithoutService(cell.key().operation());
        String reasons = cell.perSource().values().stream().filter(d -> d.verdict() == Verdict.SUSPICIOUS)
                .map(Decision::reason).distinct().reduce((a, b) -> a + "; " + b).orElse("의심 허용");
        String id = "finding-" + Fingerprints.hash(type + cell.key().stableKey());
        findings.add(new Finding(id, type, severity, title, cell.key(), reasons,
                cell.evidenceIds(), false));
    }

    private static void addUncrossed(Set<CellKey> observedKeys, List<RequestRecord> records,
                                     Map<String, OwnerInfo> owners, List<Gap> gaps) {
        Set<String> identities = new LinkedHashSet<>();
        records.stream().map(r -> r.idn).forEach(identities::add);
        Set<String> pairs = new LinkedHashSet<>();
        for (CellKey key : observedKeys) if (key.resource() != null) pairs.add(key.operation() + "\u0000" + key.resource());
        for (String pair : pairs) {
            String[] parts = pair.split("\u0000", 2);
            String operation = parts[0], resource = parts[1];
            OwnerInfo owner = owners.get(resource);
            if (owner == null || !owner.decisionGrade()) continue;
            for (String identity : identities) {
                if (identity.equals(owner.identity())) continue;
                CellKey key = new CellKey(identity, operation, resource);
                if (observedKeys.contains(key)) continue;
                int risk = isWrite(operationMethod(operation)) ? 100 : 70;
                gaps.add(new Gap(gapId(GapType.UNCROSSED, key), GapType.UNCROSSED,
                        identity, operation, resource, Set.of(), risk,
                        "O2/O3 소유자가 아닌 관측 신원이 아직 시도하지 않은 조합"));
            }
        }
    }

    private static Verdict overall(java.util.Collection<Decision> decisions) {
        Set<Verdict> values = new LinkedHashSet<>();
        decisions.forEach(d -> values.add(d.verdict()));
        for (Verdict candidate : List.of(Verdict.SUSPICIOUS, Verdict.UNDECIDED, Verdict.DENY,
                Verdict.ALLOW, Verdict.UNTESTED)) if (values.contains(candidate)) return candidate;
        return Verdict.UNTESTED;
    }

    private static boolean isSuccessful(RequestRecord r) {
        return ResponseEvidence.successful(r);
    }

    private static boolean isDenied(RequestRecord r) {
        return ResponseEvidence.denied(r);
    }

    private static boolean isMetadataMethod(String method) {
        return "OPTIONS".equals(method) || "HEAD".equals(method);
    }

    private static boolean isWrite(String method) {
        return Set.of("POST", "PUT", "PATCH", "DELETE").contains(method);
    }

    private static Set<String> ownerValues(String body) {
        if (body == null || body.isBlank() || body.length() > ResponseEvidence.MAX_ANALYSIS_CHARS) return Set.of();
        Set<String> values = new LinkedHashSet<>();
        try {
            collectOwnerValues(ResponseEvidence.parseBoundedJson(body), values);
            return values;
        } catch (StreamConstraintsException rejected) {
            return Set.of();
        } catch (Exception ignored) {
            Matcher matcher = OWNER_FIELD.matcher(body);
            while (matcher.find()) values.add(matcher.group(2));
            return values;
        }
    }

    private static void collectOwnerValues(JsonNode root, Set<String> values) {
        if (root == null) return;
        ArrayDeque<JsonNode> pending = new ArrayDeque<>();
        pending.add(root);
        int visited = 0;
        while (!pending.isEmpty() && visited++ < ResponseEvidence.MAX_VISITED_NODES) {
            JsonNode node = pending.removeFirst();
            if (!node.isObject()) {
                if (node.isArray()) node.elements().forEachRemaining(pending::addLast);
                continue;
            }
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                JsonNode value = field.getValue();
                if (OWNER_FIELDS.contains(normalizedField(field.getKey())) && value.isValueNode()) {
                    String scalar = value.asText();
                    if (!scalar.isBlank()) values.add(scalar);
                }
                if (value.isObject() && PRINCIPAL_OBJECT_FIELDS.contains(normalizedField(field.getKey()))) {
                    collectPrincipalValues(value, values);
                }
                if (value.isContainerNode()) pending.addLast(value);
            }
        }
    }

    private static void collectPrincipalValues(JsonNode principal, Set<String> values) {
        var fields = principal.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if (!PRINCIPAL_ID_FIELDS.contains(normalizedField(field.getKey())) || !field.getValue().isValueNode()) {
                continue;
            }
            String scalar = field.getValue().asText();
            if (!scalar.isBlank()) values.add(scalar);
        }
    }

    private static String normalizedField(String field) {
        return field == null ? "" : field.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
    }

    private static String operationMethod(String operation) {
        String noService = operationWithoutService(operation);
        int space = noService.indexOf(' ');
        return space < 0 ? noService : noService.substring(0, space);
    }

    private static String operationWithoutService(String operation) {
        int marker = operation.indexOf(" ");
        if (marker < 0) return operation;
        int method = operation.indexOf(" ", marker + 1);
        return method < 0 ? operation : operation.substring(marker + 1);
    }

    private static String gapId(GapType type, CellKey key) {
        return "gap-" + Fingerprints.hash(type + key.stableKey());
    }

    private static int severityRank(Severity severity) {
        return switch (severity) { case CRITICAL -> 4; case HIGH -> 3; case MEDIUM -> 2; case LOW -> 1; };
    }

}
