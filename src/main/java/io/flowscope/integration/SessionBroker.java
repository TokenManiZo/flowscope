package io.flowscope.integration;

import io.flowscope.core.AccountProfile;
import io.flowscope.core.ScopePolicy;

import java.net.HttpCookie;
import java.net.URI;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Explicit, memory-only test-account session broker. Raw credentials are never exposed by its view API
 * and are discarded when a session is replaced, revoked, or the extension unloads.
 */
public final class SessionBroker implements AutoCloseable {
    public enum Status { CAPTURING, ACTIVE, UNVERIFIED, SUSPECT, REAUTH_REQUIRED, REVOKED }

    private static final Set<String> MANAGED_HEADER_NAMES = Set.of(
            "Authorization", "Cookie", "Proxy-Authorization",
            "X-CSRF-Token", "X-XSRF-Token", "X-CSRFToken");

    public record SessionView(String handle, String accountId, String accountLabel, String service,
                              Status status, Instant createdAt, Instant lastUsedAt, Instant expiresAtHint,
                              boolean hasAuthorization, int cookieCount, boolean capturing,
                              boolean credentialConflict) {}

    private record CookieKey(String domain, String path, String name) {}

    private static final class Secret implements AutoCloseable {
        private char[] value;
        Secret(String value) { this.value = value == null ? new char[0] : value.toCharArray(); }
        String reveal() { return new String(value); }
        boolean isEmpty() { return value.length == 0; }
        @Override public void close() {
            java.util.Arrays.fill(value, '\0');
            value = new char[0];
        }
    }

    private static final class StoredCookie implements AutoCloseable {
        final CookieKey key;
        final boolean secure;
        final boolean hostOnly;
        final Instant expiresAt;
        final Secret value;

        StoredCookie(CookieKey key, String value, boolean secure, boolean hostOnly, Instant expiresAt) {
            this.key = key;
            this.secure = secure;
            this.hostOnly = hostOnly;
            this.expiresAt = expiresAt;
            this.value = new Secret(value);
        }

        boolean expired(Instant now) { return expiresAt != null && !expiresAt.isAfter(now); }
        @Override public void close() { value.close(); }
    }

    private static final class ManagedSession implements AutoCloseable {
        final String handle;
        final AccountProfile account;
        final Instant createdAt;
        final Map<CookieKey, StoredCookie> cookies = new LinkedHashMap<>();
        final Map<String, Secret> headers = new LinkedHashMap<>();
        Instant lastUsedAt;
        boolean responseConfirmed;
        boolean credentialConflict;
        Status status = Status.CAPTURING;
        boolean capturing = true;

        ManagedSession(String handle, AccountProfile account, Instant now) {
            this.handle = handle;
            this.account = account;
            this.createdAt = now;
            this.lastUsedAt = now;
        }

        @Override public void close() {
            cookies.values().forEach(StoredCookie::close);
            headers.values().forEach(Secret::close);
            cookies.clear();
            headers.clear();
            status = Status.REVOKED;
            capturing = false;
        }
    }

    private final Map<String, ManagedSession> byHandle = new LinkedHashMap<>();
    private final Map<String, String> handleByAccount = new LinkedHashMap<>();

    public synchronized String beginCapture(AccountProfile account, Instant now) {
        if (account == null) throw new IllegalArgumentException("account is required");
        Instant time = now == null ? Instant.now() : now;
        byHandle.values().stream()
                .filter(session -> session.capturing
                        && session.account.service().equals(account.service())
                        && !session.account.id().equals(account.id()))
                .findFirst()
                .ifPresent(session -> {
                    throw new IllegalStateException("같은 서비스에서 이미 로그인 캡처 중인 계정이 있습니다: "
                            + session.account.id());
                });
        String existing = handleByAccount.remove(account.id());
        if (existing != null) revoke(existing);
        String handle = "session-" + UUID.randomUUID();
        ManagedSession session = new ManagedSession(handle, account, time);
        byHandle.put(handle, session);
        handleByAccount.put(account.id(), handle);
        return handle;
    }

    public synchronized void endCapture(String handle) {
        ManagedSession session = required(handle);
        session.capturing = false;
        if (session.credentialConflict) {
            session.status = Status.SUSPECT;
            return;
        }
        if (!hasMaterial(session, Instant.now())) session.status = Status.REAUTH_REQUIRED;
        else session.status = session.responseConfirmed ? Status.ACTIVE : Status.UNVERIFIED;
    }

    /** 같은 인증 지문이 다른 등록 계정에 이미 묶인 경우 현재 세션을 자동 병합하지 않고 사용 중지한다. */
    public synchronized void markCredentialConflict(String accountId) {
        String handle = handleByAccount.get(accountId);
        ManagedSession session = handle == null ? null : byHandle.get(handle);
        if (session == null) return;
        session.credentialConflict = true;
        session.capturing = false;
        session.status = Status.SUSPECT;
    }

    public synchronized Optional<String> activeCaptureForService(String service) {
        return byHandle.values().stream()
                .filter(session -> session.capturing && session.account.service().equals(service))
                .map(session -> session.handle).findFirst();
    }

    public synchronized void observeRequest(String handle, URI target, Map<String, String> requestHeaders,
                                            Instant now) {
        ManagedSession session = requiredForTarget(handle, target);
        Instant time = now == null ? Instant.now() : now;
        session.lastUsedAt = time;
        if (session.credentialConflict) {
            session.status = Status.SUSPECT;
            return;
        }
        String authorization = header(requestHeaders, "Authorization");
        if (authorization != null && !authorization.isBlank()) replaceHeader(session, "Authorization", authorization);
        for (String csrf : List.of("X-CSRF-Token", "X-XSRF-Token", "X-CSRFToken")) {
            String value = header(requestHeaders, csrf);
            if (value != null && !value.isBlank()) replaceHeader(session, csrf, value);
        }
        String cookieHeader = header(requestHeaders, "Cookie");
        if (cookieHeader != null) captureRequestCookies(session, target, cookieHeader, time);
        if (hasMaterial(session, time)) {
            session.status = session.capturing ? Status.CAPTURING
                    : session.responseConfirmed ? Status.ACTIVE : Status.UNVERIFIED;
        }
    }

    public synchronized void observeResponse(String handle, URI target, int status, String location, String body,
                                             List<String> setCookieHeaders, Instant now) {
        ManagedSession session = requiredForTarget(handle, target);
        Instant time = now == null ? Instant.now() : now;
        session.lastUsedAt = time;
        if (session.credentialConflict) {
            session.status = Status.SUSPECT;
            return;
        }
        for (String value : setCookieHeaders == null ? List.<String>of() : setCookieHeaders) {
            captureSetCookie(session, target, value, time);
        }
        pruneExpired(session, time);
        if (!hasMaterial(session, time)) session.status = Status.REAUTH_REQUIRED;
        else if (status == 401 || isLoginRedirect(status, location)
                || containsInvalidToken(body)) session.status = Status.SUSPECT;
        else {
            if (status >= 200 && status < 500) session.responseConfirmed = true;
            if (!session.capturing) session.status = session.responseConfirmed ? Status.ACTIVE : Status.UNVERIFIED;
        }
    }

    public synchronized Map<String, String> headersForAccount(String accountId, URI target,
                                                              ScopePolicy scope, Instant now) {
        return headers(handleForAccount(accountId), target, scope, now);
    }

    public synchronized Map<String, String> headers(String handle, URI target, ScopePolicy scope, Instant now) {
        if (scope == null || !scope.allows(target.toString())) {
            throw new IllegalArgumentException("target is outside configured scope");
        }
        ManagedSession session = requiredForTarget(handle, target);
        Instant time = now == null ? Instant.now() : now;
        pruneExpired(session, time);
        if (!hasMaterial(session, time)) {
            session.status = Status.REAUTH_REQUIRED;
            throw new IllegalStateException("account session requires reauthentication: " + session.account.id());
        }
        if (session.status != Status.ACTIVE) {
            throw new IllegalStateException("account session is not active: " + session.account.id()
                    + " (" + session.status + ")");
        }
        Map<String, String> result = new LinkedHashMap<>();
        session.headers.forEach((name, value) -> {
            if (!value.isEmpty()) result.put(name, value.reveal());
        });
        List<String> cookies = new ArrayList<>();
        for (StoredCookie cookie : session.cookies.values()) {
            if (matches(cookie, target, time)) cookies.add(cookie.key.name() + "=" + cookie.value.reveal());
        }
        if (!cookies.isEmpty()) result.put("Cookie", String.join("; ", cookies));
        session.lastUsedAt = time;
        return Map.copyOf(result);
    }

    public synchronized String handleForAccount(String accountId) {
        String handle = handleByAccount.get(accountId);
        if (handle == null || !byHandle.containsKey(handle)) {
            throw new IllegalArgumentException("no captured session for account: " + accountId);
        }
        return handle;
    }

    /** Managed SCANNER requests remove these values before optional account injection. */
    public static Set<String> managedHeaderNames() { return MANAGED_HEADER_NAMES; }

    public synchronized Optional<String> accountForHandle(String handle) {
        ManagedSession session = byHandle.get(handle);
        return session == null ? Optional.empty() : Optional.of(session.account.id());
    }

    /**
     * 현재 요청 자격증명이 어느 관리 세션과 일치하는지 raw 값을 외부에 노출하지 않고 판별한다.
     * Authorization은 정확히 일치해야 하고, Cookie는 해당 target에 적용되는 저장 쿠키가 모두
     * 요청에 존재해야 한다. 둘 이상의 계정이 일치하면 오병합을 피하기 위해 미확정으로 남긴다.
     */
    public synchronized Optional<String> accountForRequest(URI target, Map<String, String> requestHeaders,
                                                           Instant now) {
        Instant time = now == null ? Instant.now() : now;
        String authorization = header(requestHeaders, "Authorization");
        Map<String, String> suppliedCookies = parseCookieHeader(header(requestHeaders, "Cookie"));
        List<String> matches = new ArrayList<>();
        for (ManagedSession session : byHandle.values()) {
            if (session.credentialConflict) continue;
            if (!sameService(session, target)) continue;
            pruneExpired(session, time);
            boolean authorizationMatch = authorization != null
                    && session.headers.containsKey("Authorization")
                    && authorization.equals(session.headers.get("Authorization").reveal());
            List<StoredCookie> expected = session.cookies.values().stream()
                    .filter(cookie -> matches(cookie, target, time)).toList();
            boolean cookieMatch = !expected.isEmpty() && expected.stream().allMatch(cookie ->
                    cookie.value.reveal().equals(suppliedCookies.get(cookie.key.name())));
            if (authorizationMatch || cookieMatch) matches.add(session.account.id());
        }
        return matches.size() == 1 ? Optional.of(matches.get(0)) : Optional.empty();
    }

    public synchronized Optional<SessionView> viewForAccount(String accountId) {
        String handle = handleByAccount.get(accountId);
        return handle == null ? Optional.empty() : Optional.ofNullable(byHandle.get(handle)).map(this::view);
    }

    public synchronized List<SessionView> views() {
        return byHandle.values().stream().map(this::view).toList();
    }

    public synchronized void revoke(String handle) {
        ManagedSession session = byHandle.remove(handle);
        if (session == null) return;
        handleByAccount.remove(session.account.id(), handle);
        session.close();
    }

    @Override public synchronized void close() {
        List<String> handles = List.copyOf(byHandle.keySet());
        handles.forEach(this::revoke);
    }

    private ManagedSession required(String handle) {
        ManagedSession session = byHandle.get(handle);
        if (session == null) throw new IllegalArgumentException("unknown session handle");
        return session;
    }

    private ManagedSession requiredForTarget(String handle, URI target) {
        ManagedSession session = required(handle);
        if (!sameService(session, target)) {
            throw new IllegalArgumentException("session account and target services differ");
        }
        return session;
    }

    private static boolean sameService(ManagedSession session, URI target) {
        URI service = URI.create(session.account.service());
        int port = target.getPort() >= 0 ? target.getPort() : "https".equalsIgnoreCase(target.getScheme()) ? 443 : 80;
        return target.getHost() != null && service.getScheme().equalsIgnoreCase(target.getScheme())
                && service.getHost().equalsIgnoreCase(target.getHost()) && service.getPort() == port;
    }

    private SessionView view(ManagedSession session) {
        Instant expires = session.cookies.values().stream().map(cookie -> cookie.expiresAt)
                .filter(java.util.Objects::nonNull).min(Instant::compareTo).orElse(null);
        return new SessionView(session.handle, session.account.id(), session.account.label(),
                session.account.service(), session.status, session.createdAt, session.lastUsedAt, expires,
                session.headers.containsKey("Authorization"), session.cookies.size(), session.capturing,
                session.credentialConflict);
    }

    private static void replaceHeader(ManagedSession session, String name, String value) {
        Secret previous = session.headers.put(name, new Secret(value));
        if (previous != null) previous.close();
    }

    private static void captureRequestCookies(ManagedSession session, URI target, String value, Instant now) {
        String host = target.getHost().toLowerCase(Locale.ROOT);
        for (String part : value.split(";")) {
            int equals = part.indexOf('=');
            if (equals <= 0) continue;
            String name = part.substring(0, equals).trim();
            String cookieValue = part.substring(equals + 1).trim();
            if (name.isBlank()) continue;
            putCookie(session, new StoredCookie(new CookieKey(host, "/", name), cookieValue,
                    "https".equalsIgnoreCase(target.getScheme()), true, null), now);
        }
    }

    private static void captureSetCookie(ManagedSession session, URI target, String raw, Instant now) {
        if (raw == null || raw.isBlank()) return;
        List<HttpCookie> parsed;
        try { parsed = HttpCookie.parse(raw); }
        catch (IllegalArgumentException ignored) { return; }
        for (HttpCookie cookie : parsed) {
            String host = target.getHost().toLowerCase(Locale.ROOT);
            boolean hostOnly = cookie.getDomain() == null || cookie.getDomain().isBlank();
            String domain = hostOnly ? host : cookie.getDomain().replaceFirst("^\\.", "").toLowerCase(Locale.ROOT);
            if (!domainMatches(host, domain, hostOnly)) continue;
            String path = cookie.getPath() == null || cookie.getPath().isBlank() ? defaultPath(target.getPath()) : cookie.getPath();
            Instant expires = cookie.getMaxAge() >= 0 ? now.plusSeconds(cookie.getMaxAge()) : parseExpires(raw);
            StoredCookie stored = new StoredCookie(new CookieKey(domain, path, cookie.getName()), cookie.getValue(),
                    cookie.getSecure(), hostOnly, expires);
            putCookie(session, stored, now);
        }
    }

    private static void putCookie(ManagedSession session, StoredCookie cookie, Instant now) {
        StoredCookie previous = session.cookies.remove(cookie.key);
        if (previous != null) previous.close();
        if (cookie.value.isEmpty() || cookie.expired(now)) cookie.close();
        else session.cookies.put(cookie.key, cookie);
    }

    private static void pruneExpired(ManagedSession session, Instant now) {
        List<CookieKey> expired = session.cookies.entrySet().stream()
                .filter(entry -> entry.getValue().expired(now)).map(Map.Entry::getKey).toList();
        for (CookieKey key : expired) {
            StoredCookie removed = session.cookies.remove(key);
            if (removed != null) removed.close();
        }
    }

    private static boolean hasMaterial(ManagedSession session, Instant now) {
        pruneExpired(session, now);
        return !session.cookies.isEmpty() || session.headers.containsKey("Authorization");
    }

    private static boolean matches(StoredCookie cookie, URI target, Instant now) {
        if (cookie.expired(now) || (cookie.secure && !"https".equalsIgnoreCase(target.getScheme()))) return false;
        String host = target.getHost().toLowerCase(Locale.ROOT);
        String path = target.getPath() == null || target.getPath().isBlank() ? "/" : target.getPath();
        return domainMatches(host, cookie.key.domain(), cookie.hostOnly)
                && (path.equals(cookie.key.path()) || path.startsWith(cookie.key.path().endsWith("/")
                ? cookie.key.path() : cookie.key.path() + "/"));
    }

    private static boolean domainMatches(String host, String domain, boolean hostOnly) {
        return host.equals(domain) || (!hostOnly && host.endsWith("." + domain));
    }

    private static String defaultPath(String path) {
        if (path == null || !path.startsWith("/") || path.equals("/")) return "/";
        int slash = path.lastIndexOf('/');
        return slash <= 0 ? "/" : path.substring(0, slash);
    }

    private static Instant parseExpires(String raw) {
        for (String part : raw.split(";")) {
            int equals = part.indexOf('=');
            if (equals <= 0 || !part.substring(0, equals).trim().equalsIgnoreCase("Expires")) continue;
            try { return ZonedDateTime.parse(part.substring(equals + 1).trim(), DateTimeFormatter.RFC_1123_DATE_TIME).toInstant(); }
            catch (RuntimeException ignored) { return null; }
        }
        return null;
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        return headers.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .map(Map.Entry::getValue).findFirst().orElse(null);
    }

    private static Map<String, String> parseCookieHeader(String value) {
        if (value == null || value.isBlank()) return Map.of();
        Map<String, String> out = new LinkedHashMap<>();
        for (String part : value.split(";")) {
            int equals = part.indexOf('=');
            if (equals <= 0) continue;
            String name = part.substring(0, equals).trim();
            if (!name.isBlank()) out.put(name, part.substring(equals + 1).trim());
        }
        return out;
    }

    private static boolean isLoginRedirect(int status, String location) {
        return status >= 300 && status < 400 && location != null
                && location.toLowerCase(Locale.ROOT).matches(".*(/login|/signin|/auth)(?:[/?#].*)?");
    }

    private static boolean containsInvalidToken(String body) {
        if (body == null) return false;
        String lower = body.toLowerCase(Locale.ROOT);
        return lower.contains("invalid_token") || lower.contains("token expired") || lower.contains("session expired");
    }
}
