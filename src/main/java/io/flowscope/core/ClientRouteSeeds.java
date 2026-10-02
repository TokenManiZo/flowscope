package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 이미 수집한 범위 안 스크립트와 응답에서, 브라우저 크롤러가 바로 열 화면 주소를 만든다.
 * SPA 내비게이션은 번들 안에 있어 클릭만으로 모든 화면에 닿지 못한다(ZAP Client Spider 실측: crAPI 상세 화면 미진입).
 * Katana(-jc)가 JS에서 찾은 경로를 크롤러 시작 주소로 주는 방식, Black Widow가 상태 간 데이터 의존성을 추적해 재사용하는
 * 방식을 합쳤다: ①라우터 설정의 정적 경로, ②상세 화면 템플릿(`/post?post_id=${}`)에 목록 응답의 실제 ID를 채운 주소.
 * 요청을 새로 보내지 않고 이미 가진 기록만 읽는다.
 */
public final class ClientRouteSeeds {
    /** `/post?post_id=${`처럼 쿼리 매개변수 하나로 상세 화면을 여는 템플릿. prefix=경로, key=매개변수 이름. */
    private static final Pattern DETAIL_TEMPLATE =
            Pattern.compile("[`\"](/[A-Za-z0-9/_-]+)[?]([A-Za-z0-9_]+)=[$][{]");
    /** 상세 화면 매개변수에 넣을 수 있는 응답 ID의 JSON 키. id/uuid는 번호·식별자, vin은 차량 식별자. */
    private static final Set<String> ID_KEYS = Set.of("id", "uuid", "vin");
    /** URL에 바로 넣을 수 있는 안전한 ID 값만. 공백·슬래시·특수문자가 있으면 식별자가 아니다. */
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9._~-]{1,64}");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_IDS_PER_ROUTE = 8;
    private static final int MAX_DETAIL_SEEDS = 40;

    private ClientRouteSeeds() {}

    /**
     * @param target  크롤러 시작 주소. 이 주소의 origin에 화면 경로를 붙이고, 같은 하위 경로 안의 것만 남긴다.
     * @param exclude 열면 세션·계정을 바꿀 수 있어 시작 주소로 주지 않을 경로
     */
    public static List<String> from(List<RequestRecord> records, ScopePolicy scope, String target,
                                    Pattern exclude, int limit) {
        URI base;
        try { base = URI.create(target); }
        catch (RuntimeException error) { return List.of(); }
        if (base.getScheme() == null || base.getRawAuthority() == null) return List.of();
        String origin = base.getScheme() + "://" + base.getRawAuthority();
        String targetPath = base.getRawPath() == null || base.getRawPath().isEmpty() ? "/" : base.getRawPath();
        String subtree = targetPath.substring(0, targetPath.lastIndexOf('/') + 1);

        List<RequestRecord> safe = records == null ? List.of() : records;
        LinkedHashSet<String> seeds = new LinkedHashSet<>();
        // ① 라우터 설정의 정적 경로
        Set<String> analyzed = new HashSet<>();
        Map<String, String> detailTemplates = new LinkedHashMap<>();
        for (RequestRecord record : safe) {
            if (!record.hasResponse || !scope.allows(record.service + record.path) || !script(record)) continue;
            String body = record.responseBodyForAnalysis();
            if (body == null || body.isBlank() || !analyzed.add(body)) continue;
            for (JavascriptAnalysis.ClientRoute route : JavascriptCallSiteAnalyzer.analyze(body).clientRoutes()) {
                addSeed(seeds, origin, route.path(), null, scope, subtree, exclude, target, limit);
            }
            collectDetailTemplates(body, detailTemplates);
        }
        // ② 상세 화면 템플릿 + 목록 응답의 실제 ID
        if (!detailTemplates.isEmpty()) {
            List<IdValue> ids = collectIds(safe, scope);
            int detail = 0;
            for (Map.Entry<String, String> template : detailTemplates.entrySet()) {
                if (detail >= MAX_DETAIL_SEEDS) break;
                String path = template.getKey();
                String param = template.getValue();
                if (exclude.matcher(path).matches()) continue;
                int used = 0;
                for (String value : valuesFor(path, param, ids)) {
                    if (used >= MAX_IDS_PER_ROUTE || detail >= MAX_DETAIL_SEEDS) break;
                    if (addSeed(seeds, origin, path + "?" + param + "=" + value, path, scope, subtree,
                            exclude, target, Integer.MAX_VALUE)) {
                        used++;
                        detail++;
                    }
                }
            }
        }
        return List.copyOf(seeds);
    }

    /** 응답 경로·JSON 키·값. 엔티티별로 ID를 가르기 위해 어느 응답에서 나왔는지 함께 둔다. */
    private record IdValue(String responsePath, String key, String value) {}

    private static boolean addSeed(LinkedHashSet<String> seeds, String origin, String pathAndQuery,
                                   String matchPath, ScopePolicy scope, String subtree, Pattern exclude,
                                   String target, int limit) {
        if (seeds.size() >= limit) return false;
        String path = matchPath == null ? pathAndQuery : matchPath;
        if (!path.startsWith(subtree) || exclude.matcher(path).matches()) return false;
        String url = origin + pathAndQuery;
        if (url.equals(target) || !scope.allows(url)) return false;
        return seeds.add(url);
    }

    /**
     * 응답 JSON에서 상세 화면에 넣을 ID 값을 모은다. 목록 항목의 식별자만 쓰려고 루트나 배열 원소의 바로 아래(엔티티 레벨)
     * id/uuid/vin만 담고, 중첩 객체(`order.product.id` 등)의 id는 담지 않는다.
     */
    private static List<IdValue> collectIds(List<RequestRecord> records, ScopePolicy scope) {
        List<IdValue> ids = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (RequestRecord record : records) {
            if (!record.hasResponse || !scope.allows(record.service + record.path)) continue;
            String media = record.responseContentType == null ? "" : record.responseContentType.toLowerCase(Locale.ROOT);
            if (!media.contains("json")) continue;
            String body = record.responseBodyForAnalysis();
            if (body == null || body.isBlank()) continue;
            String path = record.path == null ? "" : record.path.toLowerCase(Locale.ROOT);
            try { collectIds(JSON.readTree(body), path, true, ids, seen, 0); }
            catch (RuntimeException ignored) { /* 잘못된 JSON은 건너뛴다 */ }
            catch (Exception ignored) { /* 파싱 실패는 건너뛴다 */ }
        }
        return ids;
    }

    private static void collectIds(JsonNode node, String path, boolean entityLevel,
                                   List<IdValue> ids, Set<String> seen, int depth) {
        if (node == null || depth > 12 || ids.size() >= 500) return;
        if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                String key = entry.getKey().toLowerCase(Locale.ROOT);
                JsonNode value = entry.getValue();
                if (entityLevel && ID_KEYS.contains(key) && value.isValueNode()) {
                    String text = value.asText();
                    if (!text.isBlank() && SAFE_ID.matcher(text).matches() && seen.add(path + "|" + key + "|" + text)) {
                        ids.add(new IdValue(path, key, text));
                    }
                } else {
                    // 배열 원소는 다시 엔티티 레벨, 그 밖의 중첩 객체는 엔티티 레벨이 아니다.
                    collectIds(value, path, false, ids, seen, depth + 1);
                }
            });
        } else if (node.isArray()) {
            for (JsonNode child : node) collectIds(child, path, true, ids, seen, depth + 1);
        }
    }

    /**
     * 상세 라우트에 넣을 ID. vin 매개변수는 vin 값만 쓴다. id 계열은 라우트 경로가 가리키는 엔티티(예: `/post`→posts 응답)의
     * id·uuid를 먼저 쓰고, 맞는 응답이 없을 때만 전체 id·uuid로 넓힌다(재현율 유지).
     */
    private static List<String> valuesFor(String routePath, String param, List<IdValue> ids) {
        String normalized = param.toLowerCase(Locale.ROOT);
        LinkedHashSet<String> values = new LinkedHashSet<>();
        if (normalized.equals("vin")) {
            for (IdValue id : ids) if (id.key().equals("vin")) values.add(id.value());
            return List.copyOf(values);
        }
        if (!(normalized.equals("id") || normalized.endsWith("_id") || normalized.endsWith("id"))) return List.of();
        Set<String> entities = entityTokens(routePath);
        for (IdValue id : ids) {
            if ((id.key().equals("id") || id.key().equals("uuid"))
                    && entities.stream().anyMatch(id.responsePath()::contains)) {
                values.add(id.value());
            }
        }
        if (values.isEmpty()) {
            for (IdValue id : ids) if (id.key().equals("id") || id.key().equals("uuid")) values.add(id.value());
        }
        return List.copyOf(values);
    }

    /** 라우트 경로에서 엔티티 이름 후보. `/service-report`→{service,report}. 복수형 매칭을 위해 끝 s는 떼지 않고 contains로 본다. */
    private static Set<String> entityTokens(String routePath) {
        Set<String> tokens = new HashSet<>();
        for (String part : routePath.toLowerCase(Locale.ROOT).split("[/-]")) {
            if (part.length() >= 3) tokens.add(part.endsWith("s") ? part.substring(0, part.length() - 1) : part);
        }
        return tokens;
    }

    private static void collectDetailTemplates(String body, Map<String, String> templates) {
        Matcher matcher = DETAIL_TEMPLATE.matcher(body);
        while (matcher.find() && templates.size() < 200) {
            templates.putIfAbsent(matcher.group(1), matcher.group(2));
        }
    }

    private static boolean script(RequestRecord record) {
        String media = record.responseContentType == null ? "" : record.responseContentType.toLowerCase(Locale.ROOT);
        String path = record.path == null ? "" : record.path.toLowerCase(Locale.ROOT);
        int query = path.indexOf('?');
        if (query >= 0) path = path.substring(0, query);
        return media.contains("javascript") || path.endsWith(".js") || path.endsWith(".mjs");
    }
}
