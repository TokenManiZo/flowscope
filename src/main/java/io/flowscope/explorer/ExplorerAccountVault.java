package io.flowscope.explorer;

import io.flowscope.core.TextLimits;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Explorer 세션 저장소. 계정은 계정·세션에 등록된 계정을 그대로 쓰고, 세션은 사용자가 FlowScope가 띄운 브라우저에서
 * 직접 로그인한 결과(쿠키·인증 헤더)만 받는다. 비밀번호는 받지 않으며 live 인증값은 현재 프로세스 메모리에만 둔다.
 */
public final class ExplorerAccountVault implements AutoCloseable {
    public enum AuthStatus { UNVERIFIED, READY, NEEDS_INPUT, EXPIRED, FAILED }

    /** Values only names: cookie values and header values never leave the vault. */
    public record View(String id, String label, String role, String loginUrl, AuthStatus status, String message,
                       String updatedAt, int cookieCount, List<String> headerNames, boolean browserOpen) {}

    private static final int MAX_ACCOUNTS = 16;
    private final Map<String, Entry> entries = new LinkedHashMap<>();

    /** Creates the session slot for a registered account, or refreshes its label and role. */
    public synchronized View register(String id, String label, String role) {
        String key = required(id, "계정 ID", 96);
        Entry entry = entries.get(key);
        if (entry == null) {
            if (entries.size() >= MAX_ACCOUNTS) {
                throw new IllegalStateException("Explorer 계정은 최대 " + MAX_ACCOUNTS + "개까지 사용할 수 있습니다.");
            }
            entry = new Entry(key);
            entries.put(key, entry);
        }
        entry.label = required(label, "계정 이름", 96);
        entry.role = clean(role, 64);
        return entry.view();
    }

    public synchronized List<View> views() {
        return entries.values().stream().map(Entry::view).toList();
    }

    public synchronized View view(String id) {
        return entry(id).view();
    }

    public synchronized boolean contains(String id) {
        return id != null && entries.containsKey(id.trim());
    }

    public synchronized void remove(String id) {
        Entry entry = entries.remove(id == null ? "" : id.trim());
        if (entry == null) throw new IllegalArgumentException("존재하지 않는 Explorer 계정입니다.");
        entry.clear();
    }

    public synchronized void clear() {
        entries.values().forEach(Entry::clear);
        entries.clear();
    }

    /** The login window is open; the account waits for the operator to finish and press complete. */
    synchronized void awaitBrowserLogin(String id, URI loginUrl) {
        Entry entry = entry(id);
        entry.loginUrl = loginUrl;
        entry.browserOpen = true;
        setStatus(entry, AuthStatus.NEEDS_INPUT, "브라우저에서 로그인한 뒤 [로그인 완료]를 누르세요.");
    }

    synchronized void browserClosed(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        if (entry == null) return;
        entry.browserOpen = false;
        entry.updatedAt = Instant.now();
    }

    /**
     * Adopts what the login window holds for {@code target}: its cookies and the auth headers its own requests carried
     * (token SPAs keep the session in an Authorization header, not a cookie). The operator asserts the identity.
     */
    synchronized View adoptSession(String id, URI target, List<HttpCookie> cookies, Map<String, String> headers) {
        Entry entry = entry(id);
        entry.cookies.getCookieStore().removeAll();
        URI origin = URI.create(target.getScheme() + "://" + target.getRawAuthority() + "/");
        for (HttpCookie cookie : cookies) {
            // Browser cookies are Netscape-style. HttpCookie defaults to RFC 2965, which makes CookieManager emit
            // `$Version="1"` as the first Cookie value and the real pairs after it, so the session never went out.
            cookie.setVersion(0);
            entry.cookies.getCookieStore().add(origin, cookie);
        }
        entry.headers.clear();
        headers.forEach((name, value) -> {
            if (value != null && !value.isBlank() && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) {
                entry.headers.put(name, value);
            }
        });
        setStatus(entry, AuthStatus.READY, "브라우저 로그인 세션 (사용자 확인)");
        return entry.view();
    }

    synchronized Map<String, String> authenticationHeaders(String id, URI target) {
        Entry entry = entry(id);
        if (entry.status != AuthStatus.READY) {
            throw new IllegalStateException(entry.label + " 인증 상태가 READY가 아닙니다: " + entry.status);
        }
        Map<String, String> headers = new LinkedHashMap<>(entry.headers);
        Map<String, List<String>> cookieHeaders;
        try { cookieHeaders = entry.cookies.get(target, Map.of()); }
        catch (java.io.IOException error) { cookieHeaders = Map.of(); }
        String cookie = cookieHeaders.entrySet().stream()
                .filter(value -> value.getKey().equalsIgnoreCase("Cookie"))
                .flatMap(value -> value.getValue().stream()).findFirst().orElse("");
        if (!cookie.isBlank()) headers.put("Cookie", cookie);
        return Map.copyOf(headers);
    }

    synchronized void acceptResponse(String id, URI requestUri, Map<String, List<String>> responseHeaders) {
        Entry entry = entry(id);
        try { entry.cookies.put(requestUri, responseHeaders == null ? Map.of() : responseHeaders); }
        catch (Exception ignored) { /* malformed target cookies are not promoted to an auth session */ }
        entry.updatedAt = Instant.now();
    }

    synchronized void status(String id, AuthStatus status, String message) {
        setStatus(entry(id), status, message);
    }

    @Override public synchronized void close() {
        clear();
    }

    private static void setStatus(Entry entry, AuthStatus status, String message) {
        entry.status = status == null ? AuthStatus.FAILED : status;
        entry.message = TextLimits.truncate(message == null ? "" : message, 500);
        entry.updatedAt = Instant.now();
    }

    private Entry entry(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        if (entry == null) throw new IllegalArgumentException("존재하지 않는 Explorer 계정입니다.");
        return entry;
    }

    private static String required(String value, String label, int max) {
        String clean = clean(value, max);
        if (clean.isBlank()) throw new IllegalArgumentException(label + "이 필요합니다.");
        return clean;
    }

    private static String clean(String value, int max) {
        String clean = value == null ? "" : value.trim();
        if (clean.length() > max) throw new IllegalArgumentException("입력 길이 상한을 초과했습니다.");
        return clean;
    }

    private static final class Entry {
        private final String id;
        private String label = "";
        private String role = "";
        private URI loginUrl;
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final Map<String, String> headers = new LinkedHashMap<>();
        private boolean browserOpen;
        private AuthStatus status = AuthStatus.UNVERIFIED;
        private String message = "브라우저 로그인 전";
        private Instant updatedAt = Instant.now();

        private Entry(String id) { this.id = id; }

        private View view() {
            return new View(id, label, role, loginUrl == null ? "" : loginUrl.toString(), status, message,
                    updatedAt.toString(), cookies.getCookieStore().getCookies().size(),
                    List.copyOf(headers.keySet()), browserOpen);
        }

        private void clear() {
            headers.clear();
            cookies.getCookieStore().removeAll();
            browserOpen = false;
            status = AuthStatus.EXPIRED;
            message = "메모리 인증값 폐기";
            updatedAt = Instant.now();
        }
    }
}
