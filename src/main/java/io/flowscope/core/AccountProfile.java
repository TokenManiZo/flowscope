package io.flowscope.core;

import java.net.URI;
import java.util.Locale;

/** 사용자가 등록한 테스트 계정. 비밀번호·토큰·로그인 ID 원문은 보관하지 않는다. */
public record AccountProfile(String id, String label, String service, AccessRole role) {
    public AccountProfile {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("account id is required");
        if (label == null || label.isBlank()) throw new IllegalArgumentException("account label is required");
        id = id.trim();
        label = label.trim();
        service = normalizeService(service);
        role = role == null ? AccessRole.UNKNOWN : role;
    }

    static String normalizeService(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("account service is required");
        URI uri = URI.create(value.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ((!scheme.equals("http") && !scheme.equals("https")) || uri.getHost() == null) {
            throw new IllegalArgumentException("account service must be http(s)://host[:port]");
        }
        if (uri.getPath() != null && !uri.getPath().isBlank() && !"/".equals(uri.getPath())) {
            throw new IllegalArgumentException("account service must not include a path");
        }
        int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }
}
