package io.flowscope.core;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Protocol + Host + Port + Path를 모두 비교하는 명시적 허용목록(F-01/F-18). */
public final class ScopePolicy {
    private final List<ScopeEntry> entries;

    private ScopePolicy(List<ScopeEntry> entries) { this.entries = List.copyOf(entries); }

    public static ScopePolicy parse(String text) {
        List<ScopeEntry> entries = new ArrayList<>();
        if (text != null) {
            for (String line : text.split("[\\r\\n,]+")) {
                String value = line.trim();
                if (value.isEmpty() || value.startsWith("#")) continue;
                boolean wildcard = value.startsWith("*.");
                String candidate = wildcard ? "https://" + value : value;
                int authority = candidate.indexOf("://");
                if (authority >= 0 && candidate.startsWith("*.", authority + 3)) wildcard = true;
                if (wildcard) candidate = candidate.substring(0, authority + 3)
                        + candidate.substring(authority + 5);
                if (candidate.indexOf('*') >= 0) {
                    throw new IllegalArgumentException("와일드카드는 호스트 맨 앞의 *. 형식만 지원합니다: " + value);
                }
                URI uri = URI.create(candidate);
                if (uri.getScheme() == null || uri.getHost() == null) {
                    throw new IllegalArgumentException("스코프는 *.domain 또는 scheme://host[:port][/path] 형식이어야 합니다: " + value);
                }
                if (uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null) {
                    throw new IllegalArgumentException("스코프에는 사용자정보·쿼리·fragment를 사용할 수 없습니다: " + value);
                }
                String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
                if (!scheme.equals("http") && !scheme.equals("https")) {
                    throw new IllegalArgumentException("HTTP(S) 스코프만 지원합니다: " + value);
                }
                int port = uri.getPort() >= 0 ? uri.getPort() : (scheme.equals("https") ? 443 : 80);
                String path = normalizePath(uri);
                String host = uri.getHost().toLowerCase(Locale.ROOT);
                if (wildcard && !dnsHost(host)) {
                    throw new IllegalArgumentException("와일드카드는 DNS 도메인에만 사용할 수 있습니다: " + value);
                }
                entries.add(new ScopeEntry(scheme, host, port, path, wildcard));
            }
        }
        return new ScopePolicy(entries);
    }

    public boolean allows(String target) {
        try {
            URI uri = URI.create(target);
            if (uri.getUserInfo() != null || uri.getFragment() != null) return false;
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            int port = uri.getPort() >= 0 ? uri.getPort() : (scheme.equals("https") ? 443 : 80);
            String path = normalizePath(uri);
            return entries.stream().anyMatch(entry -> entry.matches(scheme, host, port, path));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public boolean isEmpty() { return entries.isEmpty(); }
    /** 실행을 시작할 수 있는 유효한 루트 URL. wildcard 항목은 apex URL로 반환한다. */
    public List<String> entries() {
        return List.copyOf(new LinkedHashSet<>(entries.stream().map(ScopeEntry::target).toList()));
    }

    /** 프로젝트에 저장하고 다시 편집할 사용자의 실제 범위 표현. */
    public List<String> configuredEntries() {
        return List.copyOf(new LinkedHashSet<>(entries.stream().map(ScopeEntry::toString).toList()));
    }

    /** ZAP Context와 Replacer도 동일한 host/path 범위를 사용하도록 제공하는 단일 정규식. */
    public String urlRegex() {
        if (entries.isEmpty()) throw new IllegalStateException("스코프가 비어 있습니다");
        return entries.stream().map(ScopeEntry::urlRegex).map(regex -> "(?:" + regex + ")")
                .reduce((left, right) -> left + "|" + right).orElseThrow();
    }

    private static String normalizePath(URI uri) {
        String raw = uri.getRawPath();
        if (raw == null) raw = "/";
        String lower = raw.toLowerCase(Locale.ROOT);
        if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")
                || lower.contains("%25") || raw.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("모호하게 인코딩된 경로는 허용하지 않습니다");
        }
        String value = uri.getPath();
        if (value != null) {
            for (String segment : value.split("/", -1)) {
                if (segment.equals(".") || segment.equals("..")) {
                    throw new IllegalArgumentException("dot-segment 경로는 허용하지 않습니다");
                }
            }
        }
        if (value == null || value.isBlank()) return "/";
        String path = value.startsWith("/") ? value : "/" + value;
        return path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
    }

    private static boolean dnsHost(String host) {
        return host != null && host.length() <= 253 && host.contains(".")
                && !host.matches("[0-9.]+")
                && host.matches("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+")
                && java.util.Arrays.stream(host.split("\\.")).allMatch(label -> label.length() <= 63);
    }

    private record ScopeEntry(String scheme, String host, int port, String path, boolean wildcard) {
        boolean matches(String actualScheme, String actualHost, int actualPort, String actualPath) {
            boolean hostMatches = host.equals(actualHost) || wildcard && actualHost.endsWith("." + host);
            if (!scheme.equals(actualScheme) || !hostMatches || port != actualPort) return false;
            return path.equals("/") || actualPath.equals(path) || actualPath.startsWith(path + "/");
        }

        String target() { return scheme + "://" + displayHost() + ":" + port + path; }

        String urlRegex() {
            String hostRegex = wildcard
                    ? "(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*" + Pattern.quote(host)
                    : Pattern.quote(displayHost());
            StringBuilder regex = new StringBuilder("^(?i:")
                    .append(Pattern.quote(scheme + "://")).append(hostRegex).append(')');
            int defaultPort = scheme.equals("https") ? 443 : 80;
            if (port == defaultPort) regex.append("(?::").append(defaultPort).append(")?");
            else regex.append(Pattern.quote(":" + port));
            if (path.equals("/")) regex.append("(?:/.*)?");
            else regex.append(Pattern.quote(path)).append("(?:/.*)?");
            return regex.append("(?:\\?.*)?$").toString();
        }

        private String displayHost() {
            if (host.startsWith("[") && host.endsWith("]")) return host;
            return host.indexOf(':') >= 0 ? "[" + host + "]" : host;
        }

        @Override public String toString() {
            return scheme + "://" + (wildcard ? "*." : "") + displayHost() + ":" + port + path;
        }
    }
}
