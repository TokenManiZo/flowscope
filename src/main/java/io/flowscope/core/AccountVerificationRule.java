package io.flowscope.core;

import java.net.URI;
import java.util.Locale;
import java.util.Optional;

/**
 * An account's stored login-success rule. A response only strengthens a session to
 * {@code RULE_MATCHED} when it hits this rule's verification endpoint (method + same-origin + path)
 * and its body contains the operator-supplied {@code expectedSubject}.
 *
 * <p>The endpoint is kept structurally split (method / origin / path); query and fragment are never
 * stored so no sensitive token is persisted. A rule always carries a non-blank success indicator —
 * a target-only "rule" is not strong and is simply not stored (the caller then sees {@code NO_RULE}).
 */
public record AccountVerificationRule(String accountId, String method, String origin, String path,
                                      String expectedSubject) {

    private static final int MAX_SUBJECT = 200;

    public AccountVerificationRule {
        // The canonical constructor is also the project-load path, so it enforces every invariant here
        // rather than only in fromExchange.
        accountId = require(accountId, "accountId");
        method = require(method, "method").toUpperCase(Locale.ROOT);
        origin = normalizedOrigin(require(origin, "origin"));
        path = validatedPath(require(path, "path"));
        expectedSubject = sanitizeSubject(expectedSubject);
    }

    /**
     * Build a rule from an operator-confirmed exchange. Returns empty when no explicit success
     * indicator is supplied, because a target-only rule is not a strong rule.
     */
    public static Optional<AccountVerificationRule> fromExchange(String accountId, String method, URI target,
                                                                 String expectedSubject) {
        if (expectedSubject == null || expectedSubject.isBlank()) return Optional.empty();
        return Optional.of(new AccountVerificationRule(accountId, method, originOf(target), pathOf(target),
                expectedSubject));
    }

    /** Classify one observed response against this rule. */
    public VerificationOutcome evaluate(String responseMethod, URI responseTarget, String body) {
        if (responseTarget == null) return VerificationOutcome.OFF_TARGET;
        boolean sameEndpoint = method.equalsIgnoreCase(responseMethod == null ? "" : responseMethod.trim())
                && origin.equalsIgnoreCase(originOf(responseTarget))
                && path.equals(pathOf(responseTarget));
        if (!sameEndpoint) return VerificationOutcome.OFF_TARGET;
        return body != null && body.contains(expectedSubject)
                ? VerificationOutcome.MATCHED : VerificationOutcome.TARGET_FAILED;
    }

    public static String originOf(URI uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        int port = uri.getPort() >= 0 ? uri.getPort()
                : "https".equals(scheme) ? 443 : "http".equals(scheme) ? 80 : -1;
        return scheme + "://" + host + (port >= 0 ? ":" + port : "");
    }

    public static String pathOf(URI uri) {
        String path = uri.getPath();
        return path == null || path.isBlank() ? "/" : path;
    }

    /** Validate and canonicalize an http(s) origin: scheme://host[:port] with no path, query, or fragment. */
    private static String normalizedOrigin(String origin) {
        URI uri;
        try {
            uri = URI.create(origin);
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("origin must be a valid http or https origin");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            throw new IllegalArgumentException("origin must be http or https");
        }
        if (uri.getHost() == null) throw new IllegalArgumentException("origin must include a host");
        if (uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("origin must not contain a path, query, or fragment");
        }
        return originOf(uri);
    }

    private static String validatedPath(String path) {
        if (!path.startsWith("/")) throw new IllegalArgumentException("path must start with /");
        if (path.indexOf('?') >= 0 || path.indexOf('#') >= 0) {
            throw new IllegalArgumentException("path must not contain a query or fragment");
        }
        return path;
    }

    private static String require(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value.trim();
    }

    /**
     * Guard the operator-typed indicator: it is a public identity marker (a username, a "Welcome X"
     * string, a {@code "id":"..."} fragment), never a credential. Reject blank, over-long, or
     * credential-shaped input so no secret is stored as a "subject".
     */
    static String sanitizeSubject(String subject) {
        if (subject == null) throw new IllegalArgumentException("expectedSubject is required");
        String trimmed = subject.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("expectedSubject is required");
        if (trimmed.length() > MAX_SUBJECT) {
            throw new IllegalArgumentException("expectedSubject exceeds " + MAX_SUBJECT + " characters");
        }
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (lower.contains("authorization") || lower.contains("bearer ") || lower.contains("cookie:")
                || lower.contains("password") || lower.matches(".*\\b[a-z0-9]{40,}\\b.*")) {
            throw new IllegalArgumentException("expectedSubject must not contain credential-like material");
        }
        return trimmed;
    }
}
