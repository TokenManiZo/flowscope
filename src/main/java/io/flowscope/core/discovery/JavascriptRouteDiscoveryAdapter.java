package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 정적 string literal만 다루는 보수적 JavaScript call-site 추출기. */
public final class JavascriptRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final Pattern FETCH = Pattern.compile("(?is)\\bfetch\\s*\\(\\s*(['\"])(.*?)\\1");
    private static final Pattern FETCH_METHOD = Pattern.compile(
            "(?is)\\bmethod\\s*:\\s*(['\"])(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\1");
    private static final Pattern AXIOS_VERB = Pattern.compile(
            "(?is)\\baxios\\.(get|post|put|patch|delete|head|options)\\s*\\(\\s*(['\"])(.*?)\\2");
    private static final Pattern XHR = Pattern.compile(
            "(?is)\\.open\\s*\\(\\s*(['\"])(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\1\\s*,\\s*(['\"])(.*?)\\3");
    private static final Pattern JQUERY_VERB = Pattern.compile(
            "(?is)\\$\\.(get|post)\\s*\\(\\s*(['\"])(.*?)\\2");
    private static final Pattern AJAX_BLOCK = Pattern.compile("(?is)\\$\\.ajax\\s*\\(\\s*\\{(.{0,1024}?)\\}\\s*\\)");
    private static final Pattern URL_PROPERTY = Pattern.compile("(?is)\\burl\\s*:\\s*(['\"])(.*?)\\1");
    private static final Pattern METHOD_PROPERTY = Pattern.compile(
            "(?is)\\b(?:method|type)\\s*:\\s*(['\"])(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\1");
    private static final Pattern BEACON = Pattern.compile("(?is)\\bsendBeacon\\s*\\(\\s*(['\"])(.*?)\\1");

    @Override public String id() { return "javascript-static-literal"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        return document.mediaType().contains("javascript") || document.path().toLowerCase(Locale.ROOT).endsWith(".js")
                || document.path().toLowerCase(Locale.ROOT).endsWith(".mjs");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument document) {
        return discoverScript(document.body(), id());
    }

    static List<DiscoveredRoute> discoverScript(String body, String adapterId) {
        List<DiscoveredRoute> routes = new ArrayList<>();
        Matcher fetch = FETCH.matcher(body);
        while (fetch.find()) if (!concatenated(body, fetch.end())) {
            String method = fetchMethod(body, fetch.end());
            add(routes, fetch.group(2), method, method.equals("UNKNOWN")
                    ? "fetch literal; method를 정적으로 확인할 수 없음" : "fetch literal의 명시/default method", adapterId);
        }
        Matcher axios = AXIOS_VERB.matcher(body);
        while (axios.find()) if (!concatenated(body, axios.end())) {
            add(routes, axios.group(3), axios.group(1), "axios verb literal", adapterId);
        }
        Matcher xhr = XHR.matcher(body);
        while (xhr.find()) if (!concatenated(body, xhr.end())) {
            add(routes, xhr.group(4), xhr.group(2), "XMLHttpRequest.open literal", adapterId);
        }
        Matcher jquery = JQUERY_VERB.matcher(body);
        while (jquery.find()) if (!concatenated(body, jquery.end())) {
            add(routes, jquery.group(3), jquery.group(1), "jQuery verb literal", adapterId);
        }
        Matcher ajax = AJAX_BLOCK.matcher(body);
        while (ajax.find()) {
            Matcher url = URL_PROPERTY.matcher(ajax.group(1));
            if (!url.find()) continue;
            Matcher method = METHOD_PROPERTY.matcher(ajax.group(1));
            add(routes, url.group(2), method.find() ? method.group(2) : "UNKNOWN", "jQuery ajax literal", adapterId);
        }
        Matcher beacon = BEACON.matcher(body);
        while (beacon.find()) if (!concatenated(body, beacon.end())) {
            add(routes, beacon.group(2), "POST", "sendBeacon literal", adapterId);
        }
        return List.copyOf(routes);
    }

    private static void add(List<DiscoveredRoute> routes, String reference, String method,
                            String reason, String adapterId) {
        if (reference == null || reference.isBlank()) return;
        routes.add(new DiscoveredRoute(reference, method.toUpperCase(Locale.ROOT),
                RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, RouteCandidate.Applicability.REVIEW,
                reason, adapterId));
    }

    private static boolean concatenated(String body, int end) {
        int cursor = end;
        while (cursor < body.length() && Character.isWhitespace(body.charAt(cursor))) cursor++;
        return cursor < body.length() && body.charAt(cursor) == '+';
    }

    private static String fetchMethod(String body, int end) {
        int cursor = end;
        while (cursor < body.length() && Character.isWhitespace(body.charAt(cursor))) cursor++;
        if (cursor < body.length() && body.charAt(cursor) == ')') return "GET";
        int close = body.indexOf(')', cursor);
        if (close < 0 || close - cursor > 512) return "UNKNOWN";
        Matcher method = FETCH_METHOD.matcher(body.substring(cursor, close));
        return method.find() ? method.group(2).toUpperCase(Locale.ROOT) : "UNKNOWN";
    }
}
