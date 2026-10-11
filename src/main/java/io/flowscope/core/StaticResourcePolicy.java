package io.flowscope.core;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;

/** Analysis exclusion policy only. Never rewrites URLs or deletes captured evidence. */
public final class StaticResourcePolicy {
    private StaticResourcePolicy() {}

    public static final Set<String> EXTENSIONS = Set.of(
            "jpg", "jpeg", "jfif", "png", "apng", "gif", "webp", "avif", "bmp", "svg", "svgz",
            "ico", "cur", "tif", "tiff", "heic", "heif",
            "css", "js", "mjs", "cjs", "map", "wasm",
            "woff", "woff2", "ttf", "otf", "eot",
            "mp3", "wav", "ogg", "oga", "opus", "aac", "m4a", "flac", "aif", "aiff", "mid", "midi", "weba",
            "mp4", "webm", "ogv", "avi", "mov", "m4v", "mpeg", "mpg", "mkv", "3gp", "3g2", "ts",
            "m3u", "m3u8", "mpd", "vtt", "srt", "webmanifest");
    private static final Set<String> COMPRESSION = Set.of("gz", "br", "zst", "bz2", "xz");

    public static boolean matchesPath(String path) {
        return EXTENSIONS.contains(extension(path));
    }

    public static boolean matchesOperation(String operation) {
        if (operation == null) return false;
        String plain = operation.strip();
        if (plain.startsWith("http://") || plain.startsWith("https://")) {
            int serviceEnd = plain.indexOf(' ');
            if (serviceEnd < 0) return false;
            plain = plain.substring(serviceEnd + 1);
        }
        int methodEnd = plain.indexOf(' ');
        return methodEnd > 0 && matchesPath(plain.substring(methodEnd + 1));
    }

    /** Inspect only the final raw segment, decoding once without form-style '+' conversion. */
    public static String extension(String path) {
        if (path == null || path.length() > 8192) return "";
        int end = path.length();
        int query = path.indexOf('?'), fragment = path.indexOf('#');
        if (query >= 0) end = Math.min(end, query);
        if (fragment >= 0) end = Math.min(end, fragment);
        String raw = path.substring(0, end);
        if (raw.contains("://")) {
            try { raw = new URI(raw).getRawPath(); }
            catch (URISyntaxException ignored) { return ""; }
            if (raw == null) return "";
        }
        String name = raw.substring(raw.lastIndexOf('/') + 1);
        try { name = new URI("/" + name).getPath().substring(1); }
        catch (URISyntaxException ignored) { return ""; }
        if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return "";
        name = name.toLowerCase(Locale.ROOT);
        String ext = suffix(name);
        if (COMPRESSION.contains(ext)) ext = suffix(name.substring(0, name.lastIndexOf('.')));
        return ext;
    }

    private static String suffix(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length() - 1 ? name.substring(dot + 1) : "";
    }
}
