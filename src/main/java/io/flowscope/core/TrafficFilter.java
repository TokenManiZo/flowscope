package io.flowscope.core;

import java.util.Locale;
import java.util.Set;

/**
 * 노이즈 필터 (기능명세서 F-03/F-12 정신: 점검 대상이 아닌 트래픽 제외).
 *
 * 원칙: **의심스러우면 남긴다.** 노이즈로 잘못 지우면 그래프·커버리지에서 사라져
 * 잘못된 '미관측'을 만들기 때문에, 오탐(정상 API 삭제)이 미탐(노이즈 잔존)보다 훨씬 해롭다.
 * 그래서 부분 문자열(contains) 매칭을 쓰지 않고 세그먼트 단위 정확 매칭만 사용한다.
 */
public final class TrafficFilter {

    /** 정적 자산 확장자 (마지막 세그먼트의 확장자와 정확히 일치할 때만). */
    private static final Set<String> STATIC_EXT = Set.of(
            "js", "mjs", "css", "map",
            "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif", "bmp",
            "woff", "woff2", "ttf", "eot"
    );

    /** 애널리틱스 경로: 전체 경로가 정확히 일치할 때만(정상 API 오탐 방지). */
    private static final Set<String> ANALYTICS_PATHS = Set.of(
            "/collect", "/analytics", "/telemetry", "/beacon", "/pixel",
            "/gtag/js", "/ga.js", "/gtm.js", "/robots.txt", "/favicon.ico"
    );

    private TrafficFilter() {}

    public static boolean isNoise(RequestRecord r) {
        String path = r.path.toLowerCase(Locale.ROOT);
        if (ANALYTICS_PATHS.contains(path)) return true;
        String ext = extension(path);
        return ext != null && STATIC_EXT.contains(ext);
    }

    /** 마지막 세그먼트의 확장자. 없으면 null. */
    private static String extension(String path) {
        int slash = path.lastIndexOf('/');
        String last = slash >= 0 ? path.substring(slash + 1) : path;
        int dot = last.lastIndexOf('.');
        return (dot > 0 && dot < last.length() - 1) ? last.substring(dot + 1) : null;
    }
}
