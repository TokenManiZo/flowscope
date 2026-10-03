package io.flowscope.explorer;

import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;

/** Pre-dispatch scope boundary for a driven browser, including passive page-linked assets. */
final class BrowserScopePolicy {
    private static final Set<String> PASSIVE_ASSETS = Set.of("Script", "Stylesheet", "Image", "Font", "Manifest");
    private final Predicate<String> exactScope;

    BrowserScopePolicy(Predicate<String> exactScope) { this.exactScope = exactScope; }

    boolean allows(LoginBrowser.BrowserRequest request) {
        if (!http(request.url())) return false;
        if (exactScope.test(request.url())) return true;
        String method = request.method() == null ? "" : request.method().toUpperCase(Locale.ROOT);
        return !request.credentialed() && ("GET".equals(method) || "HEAD".equals(method))
                && PASSIVE_ASSETS.contains(request.resourceType())
                && http(request.initiatorUrl()) && exactScope.test(request.initiatorUrl());
    }

    private static boolean http(String value) {
        try {
            URI uri = URI.create(value == null ? "" : value);
            return uri.getHost() != null && uri.getUserInfo() == null
                    && ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()));
        } catch (RuntimeException error) {
            return false;
        }
    }
}
