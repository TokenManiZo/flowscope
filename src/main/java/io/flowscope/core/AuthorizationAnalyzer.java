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
            } else if (firstSuccess.containsKey(resource)) {
                result.put(resource, new OwnerInfo(resource, firstSuccess.get(resource).idn, 20,
                        "첫 성공 접근자(저신뢰 후보, 판정 제외)", false));
            }
        }
        return result;
    }

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
        if (actual.isBelow(required)) {
            return new Decision(Verdict.SUSPICIOUS,
                    actual.label() + " 권한이 " + required.label() + " 요구 엔드포인트에 성공", true);
        }
        if (key.resource() == null) return new Decision(Verdict.ALLOW, "객체 없는 엔드포인트 성공", false);
        if (owner == null || !owner.confirmed() || owner.identity() == null) {
            return new Decision(Verdict.UNTESTED, "소유자 근거 미확정", false);
        }
        if (owner.identity().equals(key.identity())) return new Decision(Verdict.ALLOW, "소유자의 정상 접근", false);
        if (actual == AccessRole.ADMIN) return new Decision(Verdict.ALLOW, "관리자 접근(별도 분류)", false);
        if (isWrite(successful.get(0).method)) {
            return new Decision(Verdict.SUSPICIOUS, "비소유자의 상태변경 요청이 성공", false);
        }
        if (successful.stream().anyMatch(r -> ResponseEvidence.showsObject(
                r.responseBodyForAnalysis(), key.resource(), owner.identity()))) {
            return new Decision(Verdict.SUSPICIOUS, "비소유자의 응답에 타 소유 객체가 포함됨", false);
        }
        return new Decision(Verdict.UNDECIDED, "성공 응답이지만 타 소유 객체 포함 여부를 확인할 수 없음", false);
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
            if (owner == null || !owner.confirmed() || owner.identity() == null) continue;
            for (String identity : identities) {
                if (identity.equals(owner.identity())) continue;
                CellKey key = new CellKey(identity, operation, resource);
                if (observedKeys.contains(key)) continue;
                int risk = isWrite(operationMethod(operation)) ? 100 : 70;
                gaps.add(new Gap(gapId(GapType.UNCROSSED, key), GapType.UNCROSSED,
                        identity, operation, resource, Set.of(), risk,
                        "확정 소유자가 아닌 관측 신원이 아직 시도하지 않은 조합"));
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
