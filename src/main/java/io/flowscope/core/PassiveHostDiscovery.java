package io.flowscope.core;

import java.net.URI;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Host metadata from observed browser requests only; never changes scope or sends requests. */
public final class PassiveHostDiscovery {
    private static final int MAX_ORIGINS = 256;
    private final Set<String> origins = new LinkedHashSet<>();
    private long epoch = -1;

    public synchronized void observe(long datasetEpoch, ScopePolicy scope, String url) {
        if (!selectEpoch(datasetEpoch)) return;
        String origin = origin(url);
        if (origin == null || origins.size() >= MAX_ORIGINS || !related(scope, origin)) return;
        origins.add(origin);
    }

    public synchronized List<String> candidates(long datasetEpoch, ScopePolicy scope) {
        if (!selectEpoch(datasetEpoch)) return List.of();
        if (scope == null) return List.of();
        Set<String> registered = new LinkedHashSet<>();
        scope.entries().forEach(entry -> registered.add(origin(entry)));
        return observedOrigins(datasetEpoch, scope).stream().filter(value -> !registered.contains(value)).toList();
    }

    public synchronized List<String> observedOrigins(long datasetEpoch, ScopePolicy scope) {
        if (!selectEpoch(datasetEpoch)) return List.of();
        return origins.stream().filter(value -> related(scope, value)).sorted().toList();
    }

    /** Only browser-observed descendants; an exact host's path restriction stays intact. */
    public synchronized boolean allowsPassiveCapture(long datasetEpoch, ScopePolicy scope, String url) {
        if (!selectEpoch(datasetEpoch) || scope == null) return false;
        String value = origin(url);
        if (value == null || !origins.contains(value)) return false;
        String host = URI.create(value).getHost();
        return scope.entries().stream().map(entry -> URI.create(entry).getHost())
                .filter(PassiveHostDiscovery::dnsHost).anyMatch(root -> host.endsWith("." + root));
    }

    private boolean selectEpoch(long requested) {
        if (requested < epoch) return false;
        if (requested != epoch) { origins.clear(); epoch = requested; }
        return true;
    }

    private static boolean related(ScopePolicy scope, String origin) {
        if (scope == null) return false;
        String host = URI.create(origin).getHost();
        return scope.entries().stream().map(entry -> URI.create(entry).getHost())
                .filter(PassiveHostDiscovery::dnsHost)
                .anyMatch(root -> host.equals(root) || host.endsWith("." + root));
    }

    private static boolean dnsHost(String host) {
        return host != null && host.length() <= 253 && host.contains(".")
                && !host.matches("[0-9.]+")
                && host.matches("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+")
                && java.util.Arrays.stream(host.split("\\.")).allMatch(label -> label.length() <= 63);
    }

    private static String origin(String url) {
        if (url == null || url.length() > 8192) return null;
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("http") && !scheme.equals("https")) || !dnsHost(host)
                    || uri.getUserInfo() != null || uri.getFragment() != null) return null;
            int port = uri.getPort() < 0 ? (scheme.equals("https") ? 443 : 80) : uri.getPort();
            if (port < 1 || port > 65535) return null;
            return scheme + "://" + host + ":" + port;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
