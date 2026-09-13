package io.flowscope.core;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

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
                URI uri = URI.create(value);
                if (uri.getScheme() == null || uri.getHost() == null) {
                    throw new IllegalArgumentException("스코프는 scheme://host[:port][/path] 형식이어야 합니다: " + value);
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
                entries.add(new ScopeEntry(scheme, uri.getHost().toLowerCase(Locale.ROOT), port, path));
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
    public List<String> entries() { return entries.stream().map(ScopeEntry::toString).toList(); }

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

    private record ScopeEntry(String scheme, String host, int port, String path) {
        boolean matches(String actualScheme, String actualHost, int actualPort, String actualPath) {
            if (!scheme.equals(actualScheme) || !host.equals(actualHost) || port != actualPort) return false;
            return path.equals("/") || actualPath.equals(path) || actualPath.startsWith(path + "/");
        }

        @Override public String toString() { return scheme + "://" + host + ":" + port + path; }
    }
}
