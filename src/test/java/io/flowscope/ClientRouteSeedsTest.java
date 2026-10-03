package io.flowscope;

import io.flowscope.core.ClientRouteSeeds;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

final class ClientRouteSeedsTest {
    private static final String SERVICE = "http://127.0.0.1:8888";
    private static final String TARGET = "http://127.0.0.1:8888/";
    // ZapCampaign.ROUTE_SEED_EXCLUDE_REGEX와 같은 식: 로그인·계정 변경 화면 제외.
    private static final Pattern EXCLUDE = Pattern.compile(
            "(?i).*(log-?(in|out|off)|sign-?(in|up|out)|register|password|unlock|change-|delete|destroy|remove).*");

    private static RequestRecord response(String path, String media, String body) {
        RequestRecord record = new RequestRecord(Source.SCANNER, SERVICE, "GET", path, 200, "anon");
        record.hasResponse = true;
        record.body = body;
        record.responseContentType = media;
        return record;
    }

    @Test
    void 번들의_정적_라우트를_시작_주소로_만든다() {
        RequestRecord bundle = response("/static/js/main.js", "application/javascript", """
                jsx(Route, {path: "/shop", element: s});
                jsx(Route, {path: "/login", element: l});
                """);
        List<String> seeds = ClientRouteSeeds.from(List.of(bundle), ScopePolicy.parse(TARGET), TARGET, EXCLUDE, 100);
        assertEquals(List.of("http://127.0.0.1:8888/shop"), seeds);
    }

    @Test
    void 상세_화면_템플릿에_목록_응답의_실제_ID를_채운다() {
        RequestRecord bundle = response("/static/js/main.js", "application/javascript", """
                navigate(`/post?post_id=${n}`);
                navigate(`/orders?order_id=${n}`);
                location.href = `/vehicle-service-dashboard?VIN=${v}`;
                navigate(`/change-email?id=${n}`);
                """);
        RequestRecord posts = response("/community/api/v2/community/posts/recent", "application/json",
                "{\"posts\":[{\"id\":\"LgHyZH356Ez\",\"title\":\"A\"}]}");
        RequestRecord orders = response("/workshop/api/shop/orders/all", "application/json",
                "{\"orders\":[{\"id\":25,\"product\":{\"id\":2}}]}");
        RequestRecord vehicles = response("/identity/api/v2/vehicle/vehicles", "application/json",
                "[{\"id\":6,\"vin\":\"2B06H053476HV1ED4\"}]");

        List<String> seeds = ClientRouteSeeds.from(List.of(bundle, posts, orders, vehicles),
                ScopePolicy.parse(TARGET), TARGET, EXCLUDE, 100);

        // post_id·order_id는 id/uuid 값(문자 ID와 숫자 ID)을 받는다. VIN은 vin 값만. change-email은 제외된다.
        assertTrue(seeds.contains("http://127.0.0.1:8888/post?post_id=LgHyZH356Ez"), seeds.toString());
        assertTrue(seeds.contains("http://127.0.0.1:8888/orders?order_id=25"), seeds.toString());
        assertTrue(seeds.contains("http://127.0.0.1:8888/vehicle-service-dashboard?VIN=2B06H053476HV1ED4"), seeds.toString());
        assertTrue(seeds.stream().noneMatch(s -> s.contains("VIN=25") || s.contains("VIN=LgHyZH")), seeds.toString());
        assertTrue(seeds.stream().noneMatch(s -> s.contains("change-email")), seeds.toString());
    }

    @Test
    void 목록에_보인_객체는_상세_화면을_모두_연다() {
        RequestRecord bundle = response("/static/js/main.js", "application/javascript",
                "navigate(`/post?post_id=${n}`);");
        StringBuilder posts = new StringBuilder("{\"posts\":[");
        for (int i = 1; i <= 12; i++) posts.append(i > 1 ? "," : "").append("{\"id\":\"P").append(i).append("\"}");
        posts.append("]}");
        RequestRecord list = response("/community/api/v2/community/posts/recent", "application/json", posts.toString());

        List<String> seeds = ClientRouteSeeds.from(List.of(bundle, list), ScopePolicy.parse(TARGET), TARGET, EXCLUDE, 600);

        assertEquals(12, seeds.stream().filter(s -> s.contains("post_id=")).count(), seeds.toString());
    }

    @Test
    void 엔티티_목록을_봤는데_비어_있으면_다른_객체의_ID로_채우지_않는다() {
        RequestRecord bundle = response("/static/js/main.js", "application/javascript", """
                navigate(`/service-report?id=${n}`);
                navigate(`/orders?order_id=${n}`);
                """);
        RequestRecord emptyServices = response("/workshop/api/merchant/service_requests", "application/json",
                "{\"service_requests\":[],\"count\":0}");
        RequestRecord posts = response("/community/api/v2/community/posts/recent", "application/json",
                "{\"posts\":[{\"id\":\"P1\"}]}");

        List<String> seeds = ClientRouteSeeds.from(List.of(bundle, emptyServices, posts),
                ScopePolicy.parse(TARGET), TARGET, EXCLUDE, 600);

        // 정비 요청 목록은 봤지만 비어 있다 → 열 리포트가 없다. 주문 목록은 본 적이 없다 → 다른 응답 ID로 추측해 본다.
        assertTrue(seeds.stream().noneMatch(s -> s.contains("service-report?id=")), seeds.toString());
        assertTrue(seeds.contains("http://127.0.0.1:8888/orders?order_id=P1"), seeds.toString());
    }

    @Test
    void 범위_밖이나_하위경로_밖_응답은_무시한다() {
        RequestRecord outside = new RequestRecord(Source.SCANNER, "http://evil.test", "GET",
                "/static/js/main.js", 200, "anon");
        outside.hasResponse = true;
        outside.body = "jsx(Route, {path: \"/shop\", element: s});";
        outside.responseContentType = "application/javascript";
        List<String> seeds = ClientRouteSeeds.from(List.of(outside), ScopePolicy.parse(TARGET), TARGET, EXCLUDE, 100);
        assertTrue(seeds.isEmpty(), seeds.toString());
    }
}
