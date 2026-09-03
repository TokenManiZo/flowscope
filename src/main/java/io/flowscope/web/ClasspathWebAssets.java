package io.flowscope.web;

import java.util.Objects;
import java.util.Optional;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class ClasspathWebAssets {
    enum DefaultUi { LEGACY, REACT }

    record Asset(String resource, String contentType, boolean html) {}

    private final DefaultUi defaultUi;

    ClasspathWebAssets(DefaultUi defaultUi) {
        this.defaultUi = Objects.requireNonNull(defaultUi, "defaultUi");
    }

    Optional<Asset> resolve(String rawPath) {
        if (rawPath == null || !rawPath.startsWith("/") || containsEncodedSeparator(rawPath)) return Optional.empty();
        final String path;
        try {
            path = URLDecoder.decode(rawPath, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            return Optional.empty();
        }
        if (path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0 || hasDotSegment(path)) return Optional.empty();
        if (path.equals("/")) return Optional.of(defaultUi == DefaultUi.LEGACY ? legacyIndex() : reactIndex());
        if (path.equals("/legacy/")) return Optional.of(legacyIndex());
        if (path.equals("/app/")) return Optional.of(reactIndex());
        if (path.startsWith("/app/assets/")) return appAsset(path.substring("/app/assets/".length()));
        if (defaultUi == DefaultUi.REACT && path.startsWith("/assets/")) {
            return appAsset(path.substring("/assets/".length()));
        }
        return Optional.empty();
    }

    private static Asset legacyIndex() { return new Asset("/web/index.html", "text/html; charset=utf-8", true); }
    private static Asset reactIndex() { return new Asset("/web/app/index.html", "text/html; charset=utf-8", true); }

    private static Optional<Asset> appAsset(String name) {
        if (!name.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) return Optional.empty();
        String type = contentType(name);
        return type == null ? Optional.empty() : Optional.of(new Asset("/web/app/assets/" + name, type, false));
    }

    private static boolean containsEncodedSeparator(String value) {
        String lowerCase = value.toLowerCase(Locale.ROOT);
        return lowerCase.contains("%2f") || lowerCase.contains("%5c");
    }

    private static boolean hasDotSegment(String value) {
        for (String segment : value.split("/", -1)) {
            if (segment.equals(".") || segment.equals("..")) return true;
        }
        return false;
    }

    private static String contentType(String name) {
        String lowerCase = name.toLowerCase(Locale.ROOT);
        if (lowerCase.endsWith(".html")) return "text/html; charset=utf-8";
        if (lowerCase.endsWith(".js") || lowerCase.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (lowerCase.endsWith(".css")) return "text/css; charset=utf-8";
        if (lowerCase.endsWith(".json") || lowerCase.endsWith(".map")) return "application/json; charset=utf-8";
        if (lowerCase.endsWith(".svg")) return "image/svg+xml";
        if (lowerCase.endsWith(".png")) return "image/png";
        if (lowerCase.endsWith(".woff2")) return "font/woff2";
        return null;
    }
}
