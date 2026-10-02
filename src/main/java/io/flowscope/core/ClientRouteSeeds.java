package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
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
    /** 응답에서 뽑아 상세 화면에 넣을 식별자 JSON 키. 범용 관례(id·_id·uuid·guid·slug)와 차량 식별자 vin. */
    private static final Set<String> ID_KEYS = Set.of("id", "_id", "uuid", "guid", "slug", "vin");
    /** URL에 바로 넣을 수 있는 안전한 ID 값만. 공백·슬래시·특수문자가 있으면 식별자가 아니다. */
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9._~-]{1,64}");
    private static final ObjectMapper JSON = new ObjectMapper();
    // 취약점 탐색은 놓치는 객체가 없을수록 좋다. 목록에 보인 객체는 상세 화면을 모두 연다(사이트가 커져도 끝나도록 상한만 둔다).
    private static final int MAX_IDS_PER_ROUTE = 200;
    // 엔티티 목록을 한 번도 보지 못했을 때만 다른 응답의 ID로 넓힌다. 이때는 추측이므로 적게 시도한다.
    private static final int MAX_FALLBACK_IDS_PER_ROUTE = 30;
    private static final int MAX_DETAIL_SEEDS = 500;

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
        // ① 라우터 설정의 경로. 정적 경로는 바로 열고, 경로 매개변수(/post/:id)는 상세 라우트로 모은다.
        Set<String> analyzed = new HashSet<>();
        LinkedHashSet<DetailRoute> details = new LinkedHashSet<>();
        for (RequestRecord record : safe) {
            if (!record.hasResponse || !scope.allows(record.service + record.path) || !script(record)) continue;
            String body = record.responseBodyForAnalysis();
            if (body == null || body.isBlank() || !analyzed.add(body)) continue;
            for (JavascriptAnalysis.ClientRoute route : JavascriptCallSiteAnalyzer.analyze(body).clientRoutes()) {
                DetailRoute pathParam = pathParamRoute(route.path());
                if (pathParam == null) addSeed(seeds, origin, route.path(), null, scope, subtree, exclude, target, limit);
                else details.add(pathParam);
            }
            collectQueryTemplates(body, details);
        }
        // ② 상세 라우트(쿼리·경로 매개변수) + 목록 응답의 실제 ID
        if (!details.isEmpty()) {
            Set<String> jsonPaths = new HashSet<>();
            List<IdValue> ids = collectIds(safe, scope, jsonPaths);
            int detail = 0;
            for (DetailRoute route : details) {
                if (detail >= MAX_DETAIL_SEEDS) break;
                if (exclude.matcher(route.matchPath()).matches()) continue;
                Candidates candidates = valuesFor(route.matchPath(), route.param(), ids, jsonPaths);
                int cap = candidates.fallback() ? MAX_FALLBACK_IDS_PER_ROUTE : MAX_IDS_PER_ROUTE;
                int used = 0;
                for (String value : candidates.values()) {
                    if (used >= cap || detail >= MAX_DETAIL_SEEDS) break;
                    if (addSeed(seeds, origin, route.url(value), route.matchPath(), scope, subtree,
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

    /** 상세 라우트에 넣을 값. fallback이면 그 엔티티의 응답을 보지 못해 다른 응답의 ID로 넓힌 추측이다. */
    private record Candidates(List<String> values, boolean fallback) {}

    /**
     * ID 하나를 채워 여는 상세 화면. 쿼리 방식(`/post?post_id=<v>`)과 경로 방식(`/post/<v>`)을 한 형태로 다룬다.
     * matchPath=엔티티 판별·제외·범위 검사에 쓰는 정적 경로, param=ID 종류 판별용 매개변수 이름.
     */
    private record DetailRoute(String matchPath, String param, String prefix, String suffix, boolean query) {
        String url(String value) {
            return query ? prefix + "?" + param + "=" + value : prefix + "/" + value + suffix;
        }
    }

    private static final Pattern PATH_PARAM = Pattern.compile("/:([A-Za-z_][A-Za-z0-9_]*)");

    /**
     * 경로 매개변수 라우트(`/post/:id`)를 상세 라우트로 바꾼다. `:param`이 정확히 하나일 때만 다룬다(둘 이상은 어느 값을
     * 어디에 넣을지 단정할 수 없어 건너뛴다). 정적 경로면 null을 돌려줘 호출부가 바로 열게 한다.
     */
    private static DetailRoute pathParamRoute(String routePath) {
        Matcher m = PATH_PARAM.matcher(routePath);
        if (!m.find()) return null;
        String prefix = routePath.substring(0, m.start());
        String param = m.group(1);
        String suffix = routePath.substring(m.end());
        if (prefix.isEmpty() || suffix.contains("/:")) return null;
        return new DetailRoute(prefix, param, prefix, suffix, false);
    }

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
    private static List<IdValue> collectIds(List<RequestRecord> records, ScopePolicy scope, Set<String> jsonPaths) {
        List<IdValue> ids = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (RequestRecord record : records) {
            if (!record.hasResponse || !scope.allows(record.service + record.path)) continue;
            String media = record.responseContentType == null ? "" : record.responseContentType.toLowerCase(Locale.ROOT);
            if (!media.contains("json")) continue;
            String body = record.responseBodyForAnalysis();
            if (body == null || body.isBlank()) continue;
            String path = record.path == null ? "" : record.path.toLowerCase(Locale.ROOT);
            jsonPaths.add(path);
            try { collectIds(JSON.readTree(body), path, true, ids, seen, 0); }
            catch (RuntimeException ignored) { /* 잘못된 JSON은 건너뛴다 */ }
            catch (Exception ignored) { /* 파싱 실패는 건너뛴다 */ }
        }
        return ids;
    }

    private static void collectIds(JsonNode node, String path, boolean entityLevel,
                                   List<IdValue> ids, Set<String> seen, int depth) {
        if (node == null || depth > 12 || ids.size() >= 5_000) return;
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

    /** id 계열 매개변수에 넣는 식별자 키. 범용 관례: id, _id(MongoDB), uuid, guid, slug. */
    private static final Set<String> GENERIC_ID_KEYS = Set.of("id", "_id", "uuid", "guid", "slug");

    /**
     * 상세 라우트에 넣을 ID. vin 매개변수는 vin 값만 쓴다. id 계열은 라우트 경로가 가리키는 엔티티(예: `/post`→posts 응답)의
     * 식별자를 쓴다. 그 엔티티 응답을 봤는데 항목이 없으면 열 객체가 없는 것이므로 비운다. 엔티티 응답을 한 번도
     * 보지 못했을 때만 전체 식별자로 넓힌다(재현율 유지, 추측이므로 적게 시도).
     */
    private static Candidates valuesFor(String routePath, String param, List<IdValue> ids, Set<String> jsonPaths) {
        String normalized = param.toLowerCase(Locale.ROOT);
        LinkedHashSet<String> values = new LinkedHashSet<>();
        if (normalized.equals("vin")) {
            for (IdValue id : ids) if (id.key().equals("vin")) values.add(id.value());
            return new Candidates(List.copyOf(values), false);
        }
        if (!(normalized.equals("id") || normalized.endsWith("_id") || normalized.endsWith("id")
                || normalized.equals("slug") || normalized.equals("uuid"))) {
            return new Candidates(List.of(), false);
        }
        Set<String> entities = entityTokens(routePath);
        for (IdValue id : ids) {
            if (GENERIC_ID_KEYS.contains(id.key()) && entities.stream().anyMatch(id.responsePath()::contains)) {
                values.add(id.value());
            }
        }
        if (!values.isEmpty()) return new Candidates(List.copyOf(values), false);
        boolean entityObserved = jsonPaths.stream().anyMatch(path -> entities.stream().anyMatch(path::contains));
        if (entityObserved) return new Candidates(List.of(), false);
        for (IdValue id : ids) if (GENERIC_ID_KEYS.contains(id.key())) values.add(id.value());
        return new Candidates(List.copyOf(values), true);
    }

    /** 라우트 경로에서 엔티티 이름 후보. `/service-report`→{service,report}. 복수형 매칭을 위해 끝 s는 떼지 않고 contains로 본다. */
    private static Set<String> entityTokens(String routePath) {
        Set<String> tokens = new HashSet<>();
        for (String part : routePath.toLowerCase(Locale.ROOT).split("[/-]")) {
            if (part.length() >= 3) tokens.add(part.endsWith("s") ? part.substring(0, part.length() - 1) : part);
        }
        return tokens;
    }

    /** 쿼리 방식 상세 템플릿(`/post?post_id=${}`)을 모은다. 경로 방식은 라우트 정의에서 이미 모았다. */
    private static void collectQueryTemplates(String body, LinkedHashSet<DetailRoute> details) {
        Matcher matcher = DETAIL_TEMPLATE.matcher(body);
        while (matcher.find() && details.size() < 400) {
            String path = matcher.group(1);
            String param = matcher.group(2);
            details.add(new DetailRoute(path, param, path, "", true));
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
