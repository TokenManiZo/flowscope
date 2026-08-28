package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 정규화 (기능명세서 F-04~06, 설계서 §4.2).
 * L0 범위: 경로 템플릿화(op) + 자원 식별(resource, 부모 체인) + 신원 라벨(idn).
 * 소유자/판정은 L0 밖(L1).
 *
 * 자원 식별은 규칙 우선(D-022). 리뷰 지적 반영:
 *  - 부모 체인 전체 표기: /orders/101/items/5 -> "orders:101/items:5" (동명이자원 충돌 방지, D 열린질문 Q4)
 *  - 숫자/UUID/16진 세그먼트만 ID 후보로 보되, 직전이 '이름' 세그먼트일 때만 ID로 승격(날짜열 오탐 완화)
 * 쿼리·본문의 명시적 *Id 필드와 GraphQL operationName도 함께 처리한다.
 */
public final class Normalizer {

    private static final Pattern NUMERIC = Pattern.compile("^\\d+$");
    private static final Pattern UUID =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern LONGHEX = Pattern.compile("^[0-9a-fA-F]{16,}$");
    private static final Pattern OPERATION_NAME = Pattern.compile(
            "(?i)[\\\"']operationName[\\\"']\\s*:\\s*[\\\"']([A-Za-z_][A-Za-z0-9_]*)[\\\"']");
    private static final Pattern GRAPHQL_DECLARATION = Pattern.compile(
            "(?i)\\b(?:query|mutation|subscription)\\s+([A-Za-z_][A-Za-z0-9_]*)");
    private static final Pattern BODY_FIELD = Pattern.compile(
            "(?i)[\\\"']?([A-Za-z][A-Za-z0-9_-]*ids?)[\\\"']?\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]+)");
    private static final Pattern MULTIPART_FIELD = Pattern.compile(
            "(?is)name=\\\"([A-Za-z][A-Za-z0-9_-]*ids?)\\\"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]*\\r?\\n)*?\\r?\\n([A-Za-z0-9._:-]+)");
    private static final Pattern XML_FIELD = Pattern.compile(
            "(?is)<([A-Za-z][A-Za-z0-9_-]*ids?)>\\s*([A-Za-z0-9._:-]+)\\s*</\\1>");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> CONTROL_FIELDS = Set.of(
            "page", "limit", "offset", "sort", "size", "cursor", "start", "end",
            "from", "to", "timestamp", "time", "debug", "enabled", "active");
    private static final List<String> SEMANTIC_ID_SUFFIXES = List.of(
            "number", "uuid", "guid", "seq", "key", "ref", "vin", "no");
    private static final Set<String> NON_OBJECT_TYPES = Set.of(
            "api", "auth", "authorization", "csrf", "secret", "token", "password", "session",
            "sort", "page", "status", "error", "locale", "language", "trace", "request",
            "correlation", "retry", "version");

    private Normalizer() {}

    public static final class Normalized {
        public final String op;
        public final String resource;
        Normalized(String op, String resource) {
            this.op = op;
            this.resource = resource;
        }
    }

    /** 날짜 구성요소로 보이는 값: 연도(1900~2099), 월/일(1~2자리) — 자원 ID 로 쓰지 않는다. */
    private static final Pattern YEARLIKE = Pattern.compile("^(19|20)\\d{2}$");
    /** API 버전 세그먼트: v1, v2, V10 ... */
    private static final Pattern VERSION = Pattern.compile("^[vV]\\d+$");

    static boolean isIdToken(String seg) {
        return NUMERIC.matcher(seg).matches()
                || UUID.matcher(seg).matches()
                || LONGHEX.matcher(seg).matches();
    }

    /** 컬렉션 이름으로 볼 수 없는 세그먼트(버전·날짜 등)는 ID 승격의 부모가 될 수 없다. */
    private static boolean isCollectionName(String seg) {
        return !VERSION.matcher(seg).matches()
                && !YEARLIKE.matcher(seg).matches()
                && !NUMERIC.matcher(seg).matches();
    }

    /** 날짜 경로(/2026/08/24)인지: 연도 뒤에 1~2자리 숫자가 이어지는 형태. */
    private static boolean looksLikeDateSequence(List<String> segs, int i) {
        if (!YEARLIKE.matcher(segs.get(i)).matches()) return false;
        return i + 1 < segs.size() && segs.get(i + 1).matches("^\\d{1,2}$");
    }

    private static boolean isStrongIdToken(String seg) {
        return UUID.matcher(seg).matches() || LONGHEX.matcher(seg).matches();
    }

    private static List<String> pathSegments(String path) {
        List<String> segments = new ArrayList<>();
        for (String value : (path == null ? "/" : path).split("/")) {
            if (!value.isEmpty()) segments.add(value);
        }
        return segments;
    }

    private static Set<Integer> candidatePositions(List<String> segs) {
        Set<Integer> positions = new LinkedHashSet<>();
        String previous = null;
        boolean previousWasId = false;
        for (int i = 0; i < segs.size(); i++) {
            String segment = segs.get(i);
            boolean candidate = isIdToken(segment)
                    && previous != null && !previousWasId
                    && isCollectionName(previous)
                    && !YEARLIKE.matcher(segment).matches()
                    && !looksLikeDateSequence(segs, i);
            if (candidate) {
                positions.add(i);
                previousWasId = true;
            } else {
                previous = segment;
                previousWasId = false;
            }
        }
        return positions;
    }

    /** (METHOD, path) -> op + resource. 쿼리는 호출 전에 이미 분리돼 있다고 가정. */
    public static Normalized normalize(String method, String path) {
        List<String> segments = pathSegments(path);
        return normalize(method, segments, candidatePositions(segments));
    }

    private static Normalized normalize(String method, List<String> segs, Set<Integer> promotions) {
        String m = (method == null ? "GET" : method).toUpperCase(Locale.ROOT);
        List<String> opSegs = new ArrayList<>();
        List<String> chain = new ArrayList<>();  // 부모 체인: "collection:value"
        String prev = null;

        for (int i = 0; i < segs.size(); i++) {
            String seg = segs.get(i);
            if (promotions.contains(i)) {
                opSegs.add("{id}");
                chain.add(prev + ":" + seg);
            } else {
                opSegs.add(seg);
                prev = seg;
            }
        }

        String opPath = "/" + String.join("/", opSegs);
        String op = m + " " + opPath;
        // 객체 없는 요청은 자원 노드를 만들지 않는다(F-06/F-07: Endpoint까지만). resource=null.
        String resource = chain.isEmpty() ? null : String.join("/", chain);
        return new Normalized(op, resource);
    }

    /** 서로 다른 fp 를 최초 관측 순서대로 user-a, user-b ... 로 라벨링(결정적).
     *  비인증(fp=anon)은 user-X 가 아니라 'anon' 으로 분류한다(F-05). */
    public static void assignIdentities(List<RequestRecord> records) {
        Map<String, String> labels = new LinkedHashMap<>();
        for (RequestRecord r : records) {
            if ("anon".equals(r.fp)) continue;
            String identityKey = r.service + "\u0000" + r.fp;
            labels.computeIfAbsent(identityKey, k -> "user-" + labelFor(labels.size()));
        }
        for (RequestRecord r : records) {
            r.idn = "anon".equals(r.fp) ? "anon" : labels.get(r.service + "\u0000" + r.fp);
        }
    }

    private static String labelFor(int i) {
        return i < 26 ? String.valueOf((char) ('a' + i)) : String.valueOf(i);
    }

    /** 레코드 리스트 전체에 op/resource/idn 을 채운다.
     *  op·resource 에 타깃 service 를 접두해, 서로 다른 시스템(prod/test)이 합쳐지지 않게 한다. */
    public static void normalizeAll(List<RequestRecord> records) {
        TemplateCatalog catalog = TemplateCatalog.from(records);
        SemanticFieldCatalog semanticFields = SemanticFieldCatalog.from(records);
        for (RequestRecord r : records) {
            TemplateResolution resolution = catalog.resolve(r);
            Normalized n = normalize(r.method, pathSegments(r.path), resolution.positions());
            // 객체 후보 보존과 operation 묶음은 다른 판단이다. 단일 관측이라 template 근거가
            // 부족해도 /orders/101의 orders:101 객체 후보 자체를 잃으면 인가 분석이 퇴행한다.
            Normalized lexical = normalize(r.method, r.path);
            String op = n.op;
            if ("/graphql".equalsIgnoreCase(r.path)) {
                String operation = graphqlOperation(r.requestBodyForAnalysis());
                if (operation != null) op += "#" + operation;
            }
            List<ResourceReference> references = resourceReferences(r.path, r.query,
                    r.requestBodyForAnalysis(), lexical.resource,
                    "/graphql".equalsIgnoreCase(r.path));
            List<ResourceReference> semanticReferences = semanticFields.references(r);
            if (!semanticReferences.isEmpty()) {
                Map<String, ResourceReference> combined = new LinkedHashMap<>();
                references.forEach(value -> combined.putIfAbsent(value.resource(), value));
                semanticReferences.forEach(value -> combined.putIfAbsent(value.resource(), value));
                references = List.copyOf(combined.values());
            }
            String resource = references.isEmpty() ? null : references.getFirst().resource();
            r.op = r.service + " " + op;
            r.resource = resource == null ? null : r.service + " " + resource;
            r.resourceReferences = references.stream()
                    .map(value -> new ResourceReference(r.service + " " + value.resource(), value.evidence()))
                    .toList();
            r.pathTemplateStatus = resolution.status();
            r.pathTemplateReasons = resolution.reasons();
        }
        assignIdentities(records);
    }

    private record TemplateKey(String service, String shape, int position) {}

    private record SemanticFieldKey(String service, String method, String path,
                                    String channel, String location) {}

    private record SemanticFieldCandidate(SemanticFieldKey key, String resource, String value,
                                          String evidence) {}

    /**
     * `*Id` 이외의 도메인 식별자는 이름만으로 확정하지 않는다. 동일 service·method·path·field
     * 위치에서 서로 다른 값이 둘 이상 관측된 경우에만 객체 참조로 보강한다.
     */
    private static final class SemanticFieldCatalog {
        private final Map<SemanticFieldKey, Set<String>> values;

        private SemanticFieldCatalog(Map<SemanticFieldKey, Set<String>> values) {
            this.values = values;
        }

        static SemanticFieldCatalog from(List<RequestRecord> records) {
            Map<SemanticFieldKey, Set<String>> values = new LinkedHashMap<>();
            for (RequestRecord record : records) {
                for (SemanticFieldCandidate candidate : semanticCandidates(record)) {
                    values.computeIfAbsent(candidate.key(), ignored -> new LinkedHashSet<>())
                            .add(candidate.value());
                }
            }
            return new SemanticFieldCatalog(values);
        }

        List<ResourceReference> references(RequestRecord record) {
            Map<String, ResourceReference> result = new LinkedHashMap<>();
            for (SemanticFieldCandidate candidate : semanticCandidates(record)) {
                if (values.getOrDefault(candidate.key(), Set.of()).size() < 2) continue;
                result.putIfAbsent(candidate.resource(),
                        new ResourceReference(candidate.resource(), candidate.evidence()));
            }
            return List.copyOf(result.values());
        }
    }

    private static final class TemplateEvidence {
        final Set<String> values = new HashSet<>();
        final Set<String> observations = new HashSet<>();
        boolean responseMatch;
    }

    private record TemplateResolution(Set<Integer> positions, PathTemplateStatus status, List<String> reasons) {}

    private static final class TemplateCatalog {
        private final Map<TemplateKey, TemplateEvidence> evidence;
        private final Map<RequestRecord, Set<Integer>> responseMatches;

        private TemplateCatalog(Map<TemplateKey, TemplateEvidence> evidence,
                                Map<RequestRecord, Set<Integer>> responseMatches) {
            this.evidence = evidence;
            this.responseMatches = responseMatches;
        }

        static TemplateCatalog from(List<RequestRecord> records) {
            Map<TemplateKey, TemplateEvidence> evidence = new HashMap<>();
            Map<RequestRecord, Set<Integer>> responseMatches = new IdentityHashMap<>();
            for (RequestRecord record : records) {
                List<String> segments = pathSegments(record.path);
                Set<Integer> candidates = candidatePositions(segments);
                String shape = shape(segments, candidates);
                int lastCandidate = candidates.stream().mapToInt(Integer::intValue).max().orElse(-1);
                for (int position : candidates) {
                    TemplateEvidence item = evidence.computeIfAbsent(
                            new TemplateKey(record.service, shape, position), ignored -> new TemplateEvidence());
                    item.values.add(segments.get(position));
                    item.observations.add(record.source + "\0" + record.runId + "\0" + record.method);
                    if (responseConfirms(record, segments.get(position), segments.get(position - 1),
                            position == lastCandidate)) {
                        item.responseMatch = true;
                        responseMatches.computeIfAbsent(record, ignored -> new HashSet<>()).add(position);
                    }
                }
            }
            return new TemplateCatalog(evidence, responseMatches);
        }

        TemplateResolution resolve(RequestRecord record) {
            List<String> segments = pathSegments(record.path);
            Set<Integer> candidates = candidatePositions(segments);
            String shape = shape(segments, candidates);
            Set<Integer> promotions = new LinkedHashSet<>();
            Set<String> reasons = new LinkedHashSet<>();
            boolean inferred = false;
            for (int position : candidates) {
                String value = segments.get(position);
                TemplateEvidence item = evidence.get(new TemplateKey(record.service, shape, position));
                if (isStrongIdToken(value)) {
                    promotions.add(position);
                    reasons.add("UUID_OR_LONG_HEX_FORMAT");
                    inferred = true;
                } else if (item != null && item.responseMatch) {
                    promotions.add(position);
                    boolean ownMatch = responseMatches.getOrDefault(record, Set.of()).contains(position);
                    reasons.add(ownMatch ? "RESPONSE_ID_MATCH" : "CORROBORATED_RESPONSE_ID_MATCH");
                } else if (item != null && item.values.size() >= 2) {
                    promotions.add(position);
                    reasons.add("MULTIPLE_VALUES_SAME_POSITION");
                    inferred = true;
                } else if (item != null && item.observations.size() >= 2) {
                    promotions.add(position);
                    reasons.add("CORROBORATED_OBSERVATIONS");
                    inferred = true;
                }
            }
            PathTemplateStatus status = promotions.isEmpty() ? PathTemplateStatus.LITERAL
                    : inferred ? PathTemplateStatus.INFERRED : PathTemplateStatus.CORROBORATED;
            return new TemplateResolution(Set.copyOf(promotions), status, List.copyOf(reasons));
        }

        private static String shape(List<String> segments, Set<Integer> candidates) {
            List<String> shaped = new ArrayList<>(segments);
            candidates.forEach(position -> shaped.set(position, "{?}"));
            return "/" + String.join("/", shaped);
        }
    }

    private static boolean responseConfirms(RequestRecord record, String value, String parent,
                                            boolean allowGenericId) {
        if (!record.hasResponse || record.status < 200 || record.status >= 300) return false;
        String body = record.responseBodyForAnalysis();
        if (body == null || body.isBlank()) return false;
        String singular = parent.toLowerCase(Locale.ROOT);
        if (singular.endsWith("ies") && singular.length() > 3) singular = singular.substring(0, singular.length() - 3) + "y";
        else if (singular.endsWith("s") && singular.length() > 1) singular = singular.substring(0, singular.length() - 1);
        Set<String> keys = new HashSet<>();
        keys.add(keyToken(singular + "Id"));
        if (allowGenericId) keys.add("id");
        try {
            return jsonContainsId(JSON.readTree(body), keys, value);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean jsonContainsId(JsonNode node, Set<String> keys, String value) {
        if (node == null) return false;
        if (node.isObject()) {
            var fields = node.properties().iterator();
            while (fields.hasNext()) {
                var field = fields.next();
                JsonNode child = field.getValue();
                if (keys.contains(keyToken(field.getKey())) && child.isValueNode()
                        && !child.isNull() && value.equals(child.asText())) return true;
                if (jsonContainsId(child, keys, value)) return true;
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) if (jsonContainsId(child, keys, value)) return true;
        }
        return false;
    }

    private static String keyToken(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static String graphqlOperation(String body) {
        if (body == null) return null;
        Matcher named = OPERATION_NAME.matcher(body);
        if (named.find()) return named.group(1);
        Matcher declared = GRAPHQL_DECLARATION.matcher(body);
        return declared.find() ? declared.group(1) : null;
    }

    private static List<ResourceReference> resourceReferences(String path, String query, String body,
                                                               String pathResource, boolean graphql) {
        Map<String, ResourceReference> values = new LinkedHashMap<>();
        if (pathResource != null) addReference(values, pathResource, "PATH_ID");
        queryResources(path, query).forEach(value -> addReference(values, value, "QUERY_ID"));
        bodyResources(path, body).forEach(value -> addReference(values, value,
                graphql ? "GRAPHQL_VARIABLE" : "BODY_ID"));
        return List.copyOf(values.values());
    }

    private static void addReference(Map<String, ResourceReference> values, String resource, String evidence) {
        if (resource != null) values.putIfAbsent(resource, new ResourceReference(resource, evidence));
    }

    /** UI와 후보 정렬이 임의 confidence 대신 표시하는 재현 가능한 객체 추출 근거. */
    public static String resourceEvidence(RequestRecord record) {
        if (record == null || record.resource == null) return "NONE";
        if (record.resourceReferences != null && !record.resourceReferences.isEmpty()) {
            return record.resourceReferences.getFirst().evidence();
        }
        if (normalize(record.method, record.path).resource != null) return "PATH_ID";
        if (queryResource(record.path, record.query) != null) return "QUERY_ID";
        if (bodyResource(record.path, record.requestBodyForAnalysis()) != null) {
            return "/graphql".equalsIgnoreCase(record.path) ? "GRAPHQL_VARIABLE" : "BODY_ID";
        }
        return "DERIVED";
    }

    private static List<SemanticFieldCandidate> semanticCandidates(RequestRecord record) {
        List<SemanticFieldCandidate> values = new ArrayList<>();
        if (record.query != null) {
            for (String pair : record.query.split("&")) {
                String[] kv = pair.split("=", 2);
                if (kv.length == 2) addSemanticCandidate(values, record, "QUERY", keyToken(decode(kv[0])),
                        decode(kv[0]), decode(kv[1]));
            }
        }
        String body = record.requestBodyForAnalysis();
        if (body == null || body.isBlank()) return values;
        String trimmed = body.stripLeading();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try { collectSemanticJson(values, record, JSON.readTree(body), "$"); }
            catch (Exception ignored) { /* malformed JSON is not guessed as a structured identifier source */ }
        } else if (body.contains("=")) {
            for (String pair : body.split("&")) {
                String[] kv = pair.split("=", 2);
                if (kv.length == 2) addSemanticCandidate(values, record, "BODY", keyToken(decode(kv[0])),
                        decode(kv[0]), decode(kv[1]));
            }
        }
        return values;
    }

    private static void collectSemanticJson(List<SemanticFieldCandidate> values, RequestRecord record,
                                            JsonNode node, String location) {
        if (node == null) return;
        if (node.isObject()) {
            node.properties().forEach(entry -> {
                JsonNode value = entry.getValue();
                String childLocation = location + "." + keyToken(entry.getKey());
                if (value.isValueNode()) {
                    addSemanticCandidate(values, record, "BODY", childLocation,
                            entry.getKey(), value.isNull() ? null : value.asText());
                } else if (value.isArray()) {
                    for (JsonNode item : value) {
                        if (item.isValueNode()) addSemanticCandidate(values, record, "BODY", childLocation,
                                entry.getKey(), item.isNull() ? null : item.asText());
                    }
                }
                collectSemanticJson(values, record, value, childLocation);
            });
        } else if (node.isArray()) {
            for (JsonNode item : node) collectSemanticJson(values, record, item, location + "[]");
        }
    }

    private static void addSemanticCandidate(List<SemanticFieldCandidate> values, RequestRecord record,
                                             String channel, String location, String rawKey, String value) {
        String type = semanticType(record.path, rawKey);
        if (type == null || value == null || value.isBlank() || value.contains("***") || value.length() > 256) return;
        SemanticFieldKey key = new SemanticFieldKey(record.service, record.method, record.path,
                channel, location);
        values.add(new SemanticFieldCandidate(key, pluralize(type) + ":" + value, value,
                channel + "_SEMANTIC_FIELD_CORROBORATED"));
    }

    private static String semanticType(String path, String rawKey) {
        if (rawKey == null || isIdField(rawKey)) return null;
        String key = keyToken(rawKey);
        String type = null;
        for (String suffix : SEMANTIC_ID_SUFFIXES) {
            if (!key.endsWith(suffix)) continue;
            String prefix = key.substring(0, key.length() - suffix.length());
            if (prefix.length() >= 2) type = prefix;
            else if ((suffix.equals("uuid") || suffix.equals("guid") || suffix.equals("vin")) && prefix.isEmpty()) {
                type = lastNamedSegment(path);
            }
            break;
        }
        if (type == null || type.isBlank() || CONTROL_FIELDS.contains(type) || NON_OBJECT_TYPES.contains(type)) {
            return null;
        }
        return type;
    }

    private static String queryResource(String path, String query) {
        return queryResources(path, query).stream().findFirst().orElse(null);
    }

    private static List<String> queryResources(String path, String query) {
        List<String> values = new ArrayList<>();
        if (query == null) return List.of();
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length != 2) continue;
            String resource = resourceFromField(path, decode(kv[0]), decode(kv[1]));
            if (resource != null && !values.contains(resource)) values.add(resource);
        }
        return values;
    }

    private static String bodyResource(String path, String body) {
        return bodyResources(path, body).stream().findFirst().orElse(null);
    }

    private static List<String> bodyResources(String path, String body) {
        List<String> values = new ArrayList<>();
        if (body == null) return List.of();
        String trimmed = body.stripLeading();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try { collectJsonResources(path, JSON.readTree(body), values); }
            catch (Exception ignored) { /* malformed JSON falls back to the conservative text patterns below */ }
        }
        Matcher matcher = BODY_FIELD.matcher(body);
        while (matcher.find()) {
            String resource = resourceFromField(path, matcher.group(1), matcher.group(2));
            if (resource != null && !values.contains(resource)) values.add(resource);
        }
        Matcher multipart = MULTIPART_FIELD.matcher(body);
        while (multipart.find()) {
            String resource = resourceFromField(path, multipart.group(1), multipart.group(2));
            if (resource != null && !values.contains(resource)) values.add(resource);
        }
        Matcher xml = XML_FIELD.matcher(body);
        while (xml.find()) {
            String resource = resourceFromField(path, xml.group(1), xml.group(2));
            if (resource != null && !values.contains(resource)) values.add(resource);
        }
        return values;
    }

    private static void collectJsonResources(String path, JsonNode node, List<String> values) {
        if (node == null) return;
        if (node.isObject()) {
            node.properties().forEach(entry -> {
                JsonNode value = entry.getValue();
                if (isIdField(entry.getKey())) {
                    if (value.isValueNode()) addJsonResource(path, entry.getKey(), value, values);
                    else if (value.isArray()) value.forEach(item -> addJsonResource(path, entry.getKey(), item, values));
                }
                collectJsonResources(path, value, values);
            });
        } else if (node.isArray()) node.forEach(value -> collectJsonResources(path, value, values));
    }

    private static void addJsonResource(String path, String key, JsonNode value, List<String> values) {
        if (!value.isValueNode() || value.isNull()) return;
        String resource = resourceFromField(path, key, value.asText());
        if (resource != null && !values.contains(resource)) values.add(resource);
    }

    private static boolean isIdField(String rawKey) {
        if (rawKey == null) return false;
        String key = rawKey.toLowerCase(Locale.ROOT).replace('-', '_');
        if (key.equals("id") || key.equals("ids") || key.endsWith("_id") || key.endsWith("_ids")) {
            return true;
        }
        return camelIdPrefix(rawKey) != null;
    }

    private static String resourceFromField(String path, String rawKey, String value) {
        if (rawKey == null || value == null || value.isBlank() || value.contains("***")) return null;
        String key = rawKey.toLowerCase(Locale.ROOT).replace('-', '_');
        if (CONTROL_FIELDS.contains(key)) return null;
        String type;
        if (key.equals("id") || key.equals("ids")) {
            type = lastNamedSegment(path);
        } else if (key.endsWith("_ids")) {
            type = key.substring(0, key.length() - 4);
        } else if (key.endsWith("_id")) {
            type = key.substring(0, key.length() - 3);
        } else {
            type = camelIdPrefix(rawKey);
        }
        if (type == null || type.isBlank() || CONTROL_FIELDS.contains(type)) return null;
        return pluralize(type) + ":" + value;
    }

    /** `valid`, `fluid`, `guid`처럼 우연히 소문자 id로 끝나는 단어는 ID 필드가 아니다. */
    private static String camelIdPrefix(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) return null;
        String suffix = rawKey.endsWith("Ids") ? "Ids" : rawKey.endsWith("Id") ? "Id"
                : rawKey.endsWith("IDs") ? "IDs" : rawKey.endsWith("ID") ? "ID" : null;
        if (suffix == null || rawKey.length() <= suffix.length()) return null;
        String prefix = rawKey.substring(0, rawKey.length() - suffix.length());
        if ((suffix.equals("ID") || suffix.equals("IDs"))
                && prefix.chars().noneMatch(Character::isLowerCase)) return null;
        String type = keyToken(prefix);
        return type.isBlank() ? null : type;
    }

    private static String lastNamedSegment(String path) {
        if (path == null) return null;
        String[] parts = path.split("/");
        for (int i = parts.length - 1; i >= 0; i--) {
            String p = parts[i];
            if (!p.isBlank() && isCollectionName(p)) return p.toLowerCase(Locale.ROOT);
        }
        return null;
    }

    private static String pluralize(String type) {
        String t = type.toLowerCase(Locale.ROOT);
        if (t.endsWith("s")) return t;
        if (t.endsWith("y") && t.length() > 1) return t.substring(0, t.length() - 1) + "ies";
        return t + "s";
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, StandardCharsets.UTF_8); }
        catch (IllegalArgumentException e) { return value; }
    }
}
