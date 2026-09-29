package io.flowscope.core;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/** In-scope documents may load passive resources from other origins without making those origins scan targets. */
public final class SupportingAssetScope {
    private static final Set<String> STATIC_EXTENSIONS = Set.of("js", "mjs", "cjs", "css", "map",
            "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif", "woff", "woff2", "ttf");
    private static final Set<String> PASSIVE_DESTINATIONS = Set.of("script", "style", "image", "font", "manifest");
    private static final int MAX_ORIGINS_PER_RUN = 128;
    private static final int MAX_LINKS_PER_RUN = 20_000;
    private final Map<String, Map<String, String>> originsByRun = new HashMap<>();
    private final Map<String, Map<String, String>> linksByRun = new HashMap<>();

    public synchronized List<String> observeHtml(Source source, String runId, Predicate<String> scope,
                                                 String pageUrl, String body) {
        if (scope == null || !scope.test(pageUrl) || body == null || body.isBlank()) return List.of();
        String page = documentUrl(pageUrl);
        if (page == null) return List.of();
        Document html = Jsoup.parse(body, pageUrl);
        List<String> links = new ArrayList<>();
        for (Element element : html.select("script[src], link[href], img[src]")) {
            String attribute = element.tagName().equals("link") ? "href" : "src";
            String destination = linkedDestination(element);
            if (destination == null) continue;
            String resolved = element.absUrl(attribute);
            if (!scope.test(resolved) && passiveResource("GET", resolved, destination)) {
                register(source, runId, resolved, page);
                Map<String, String> knownLinks = linksByRun.computeIfAbsent(key(source, runId), ignored -> new HashMap<>());
                if (knownLinks.size() < MAX_LINKS_PER_RUN) knownLinks.putIfAbsent(resolved, page);
                if (destination.equals("script") || destination.equals("manifest")
                        || resolved.matches("(?i).*\\.(?:js|mjs|cjs|map)(?:\\?.*)?")) links.add(resolved);
            }
        }
        return List.copyOf(links);
    }

    /** Returns the original document URL only for a passive resource in the same run. */
    public synchronized String pageUrlFor(Source source, String runId, Predicate<String> scope, String method,
                                             String url, String referrer, String fetchDestination) {
        if (scope == null || scope.test(url) || (!"GET".equalsIgnoreCase(method)
                && !"HEAD".equalsIgnoreCase(method))) return null;
        String assetOrigin = origin(url);
        if (assetOrigin == null) return null;
        String linkedPage = linksByRun.getOrDefault(key(source, runId), Map.of()).get(url);
        if (linkedPage != null) return linkedPage;
        if (!passiveResource(method, url, fetchDestination)) return null;
        Map<String, String> known = originsByRun.computeIfAbsent(key(source, runId), ignored -> new HashMap<>());
        String page = known.get(assetOrigin);
        if (page != null) return page;
        if (referrer != null && scope.test(referrer)) {
            page = documentUrl(referrer);
        } else {
            page = known.get(origin(referrer));
        }
        if (page == null || known.size() >= MAX_ORIGINS_PER_RUN) return null;
        known.put(assetOrigin, page);
        return page;
    }

    public synchronized void clear() { originsByRun.clear(); linksByRun.clear(); }

    private void register(Source source, String runId, String url, String pageUrl) {
        String assetOrigin = origin(url);
        if (assetOrigin == null) return;
        Map<String, String> known = originsByRun.computeIfAbsent(key(source, runId), ignored -> new HashMap<>());
        if (known.size() < MAX_ORIGINS_PER_RUN) known.putIfAbsent(assetOrigin, pageUrl);
    }

    private static String linkedDestination(Element element) {
        if (element.tagName().equals("script")) return "script";
        if (element.tagName().equals("img")) return "image";
        String rel = element.attr("rel").toLowerCase(Locale.ROOT);
        if (rel.contains("stylesheet")) return "style";
        if (rel.contains("manifest")) return "manifest";
        if (rel.contains("preload") || rel.contains("prefetch")) {
            String as = element.attr("as").toLowerCase(Locale.ROOT);
            return PASSIVE_DESTINATIONS.contains(as) ? as : "";
        }
        return null;
    }

    public static boolean passiveResource(String method, String url, String destination) {
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) return false;
        try {
            URI uri = URI.create(url);
            if (uri.getUserInfo() != null || uri.getFragment() != null || origin(url) == null) return false;
            String dest = destination == null ? "" : destination.toLowerCase(Locale.ROOT);
            if (PASSIVE_DESTINATIONS.contains(dest)) return true;
            String path = uri.getPath();
            int dot = path == null ? -1 : path.lastIndexOf('.');
            return dot >= 0 && STATIC_EXTENSIONS.contains(path.substring(dot + 1).toLowerCase(Locale.ROOT));
        } catch (RuntimeException ignored) { return false; }
    }

    private static String origin(String url) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("https") && !scheme.equals("http")) || uri.getHost() == null
                    || uri.getUserInfo() != null) return null;
            int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
            return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
        } catch (RuntimeException ignored) { return null; }
    }

    private static String documentUrl(String url) {
        String service = origin(url);
        if (service == null) return null;
        URI uri = URI.create(url);
        String path = uri.getRawPath();
        return service + (path == null || path.isBlank() ? "/" : path);
    }

    private static String key(Source source, String runId) {
        return source + "\0" + (runId == null ? "" : runId);
    }
}
