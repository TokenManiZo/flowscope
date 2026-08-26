package io.flowscope.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
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
            "(?i)[\\\"']?([A-Za-z][A-Za-z0-9_-]*id)[\\\"']?\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]+)");
    private static final Pattern MULTIPART_FIELD = Pattern.compile(
            "(?is)name=\\\"([A-Za-z][A-Za-z0-9_-]*id)\\\"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]*\\r?\\n)*?\\r?\\n([A-Za-z0-9._:-]+)");
    private static final Set<String> CONTROL_FIELDS = Set.of(
            "page", "limit", "offset", "sort", "size", "cursor", "start", "end",
            "from", "to", "timestamp", "time", "debug", "enabled", "active");

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

    /** (METHOD, path) -> op + resource. 쿼리는 호출 전에 이미 분리돼 있다고 가정. */
    public static Normalized normalize(String method, String path) {
        String m = (method == null ? "GET" : method).toUpperCase(Locale.ROOT);
        String[] raw = path.split("/");
        List<String> segs = new ArrayList<>();
        for (String s : raw) if (!s.isEmpty()) segs.add(s);

        List<String> opSegs = new ArrayList<>();
        List<String> chain = new ArrayList<>();  // 부모 체인: "collection:value"
        String prev = null;
        boolean prevWasId = false;

        for (int i = 0; i < segs.size(); i++) {
            String seg = segs.get(i);
            // ID 승격 조건:
            //  - ID 형태이고
            //  - 직전 세그먼트가 '컬렉션 이름'이며(버전 v1·연도·숫자는 부모가 될 수 없음)
            //  - 직전이 ID 가 아니고
            //  - 날짜 시퀀스(2026/08/24)의 일부가 아닐 것
            boolean promote = isIdToken(seg)
                    && prev != null && !prevWasId
                    && isCollectionName(prev)
                    && !YEARLIKE.matcher(seg).matches()
                    && !looksLikeDateSequence(segs, i);
            if (promote) {
                opSegs.add("{id}");
                chain.add(prev + ":" + seg);
                prevWasId = true;
            } else {
                opSegs.add(seg);
                prev = seg;
                prevWasId = false;
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
        for (RequestRecord r : records) {
            Normalized n = normalize(r.method, r.path);
            String op = n.op;
            if ("/graphql".equalsIgnoreCase(r.path)) {
                String operation = graphqlOperation(r.reqBody);
                if (operation != null) op += "#" + operation;
            }
            String resource = n.resource != null ? n.resource : auxiliaryResource(r.path, r.query, r.reqBody);
            r.op = r.service + " " + op;
            r.resource = resource == null ? null : r.service + " " + resource;
        }
        assignIdentities(records);
    }

    private static String graphqlOperation(String body) {
        if (body == null) return null;
        Matcher named = OPERATION_NAME.matcher(body);
        if (named.find()) return named.group(1);
        Matcher declared = GRAPHQL_DECLARATION.matcher(body);
        return declared.find() ? declared.group(1) : null;
    }

    /** 명시적인 id 필드만 사용한다. page/limit 같은 제어값과 일반 숫자는 객체로 승격하지 않는다. */
    private static String auxiliaryResource(String path, String query, String body) {
        String queryResource = queryResource(path, query);
        if (queryResource != null) return queryResource;
        String bodyResource = bodyResource(path, body);
        if (bodyResource != null) return bodyResource;
        return null;
    }

    /** UI와 후보 정렬이 임의 confidence 대신 표시하는 재현 가능한 객체 추출 근거. */
    public static String resourceEvidence(RequestRecord record) {
        if (record == null || record.resource == null) return "NONE";
        if (normalize(record.method, record.path).resource != null) return "PATH_ID";
        if (queryResource(record.path, record.query) != null) return "QUERY_ID";
        if (bodyResource(record.path, record.reqBody) != null) {
            return "/graphql".equalsIgnoreCase(record.path) ? "GRAPHQL_VARIABLE" : "BODY_ID";
        }
        return "DERIVED";
    }

    private static String queryResource(String path, String query) {
        if (query == null) return null;
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length != 2) continue;
            String resource = resourceFromField(path, decode(kv[0]), decode(kv[1]));
            if (resource != null) return resource;
        }
        return null;
    }

    private static String bodyResource(String path, String body) {
        if (body == null) return null;
        Matcher matcher = BODY_FIELD.matcher(body);
        while (matcher.find()) {
            String resource = resourceFromField(path, matcher.group(1), matcher.group(2));
            if (resource != null) return resource;
        }
        Matcher multipart = MULTIPART_FIELD.matcher(body);
        while (multipart.find()) {
            String resource = resourceFromField(path, multipart.group(1), multipart.group(2));
            if (resource != null) return resource;
        }
        return null;
    }

    private static String resourceFromField(String path, String rawKey, String value) {
        if (rawKey == null || value == null || value.isBlank() || value.contains("***")) return null;
        String key = rawKey.toLowerCase(Locale.ROOT).replace('-', '_');
        if (CONTROL_FIELDS.contains(key)) return null;
        String type;
        if (key.equals("id")) {
            type = lastNamedSegment(path);
        } else if (key.endsWith("_id")) {
            type = key.substring(0, key.length() - 3);
        } else if (key.endsWith("id")) {
            type = key.substring(0, key.length() - 2);
        } else {
            return null;
        }
        if (type == null || type.isBlank() || CONTROL_FIELDS.contains(type)) return null;
        return pluralize(type) + ":" + value;
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
