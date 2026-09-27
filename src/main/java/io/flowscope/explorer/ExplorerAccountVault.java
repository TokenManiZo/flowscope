package io.flowscope.explorer;

import io.flowscope.core.Masking;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/** Explorer 전용 계정·세션 저장소. 비밀번호와 live 인증값은 현재 프로세스 메모리에만 둔다. */
public final class ExplorerAccountVault implements AutoCloseable {
    public enum LoginMode { AUTO_FORM, JSON }
    public enum AuthStatus { UNVERIFIED, READY, NEEDS_INPUT, EXPIRED, FAILED }

    public record Input(String id, String label, String role, String loginUrl,
                        String username, String password, LoginMode loginMode,
                        String usernameField, String passwordField,
                        String tokenJsonPath, String authHeader, String authPrefix,
                        String validationUrl) {}

    public record View(String id, String label, String role, String loginUrl, LoginMode loginMode,
                       String validationUrl, AuthStatus status, String message,
                       String updatedAt, boolean hasPassword, int cookieCount,
                       boolean hasTokenHeader) {}

    /** Package-private secret view; callers must not retain it or include it in logs/snapshots. */
    record Secret(String id, String label, String role, URI loginUrl, char[] username, char[] password,
                  LoginMode loginMode, String usernameField, String passwordField,
                  String tokenJsonPath, String authHeader, String authPrefix, URI validationUrl) {}

    private static final int MAX_ACCOUNTS = 16;
    private final Map<String, Entry> entries = new LinkedHashMap<>();

    public synchronized View save(Input input) {
        if (input == null) throw new IllegalArgumentException("계정 입력이 필요합니다.");
        String id = clean(input.id(), 96);
        if (id.isBlank()) id = "llm-" + UUID.randomUUID().toString().substring(0, 8);
        if (!entries.containsKey(id) && entries.size() >= MAX_ACCOUNTS) {
            throw new IllegalStateException("Explorer 계정은 최대 " + MAX_ACCOUNTS + "개까지 등록할 수 있습니다.");
        }
        String label = required(input.label(), "계정 이름", 96);
        String role = clean(input.role(), 64);
        URI loginUrl = absoluteHttp(input.loginUrl(), "로그인 URL");
        String username = required(input.username(), "로그인 ID", 512);
        String password = required(input.password(), "비밀번호", 4_096);
        LoginMode mode = input.loginMode() == null ? LoginMode.AUTO_FORM : input.loginMode();
        URI validationUrl = optionalHttp(input.validationUrl(), "검증 URL");
        Entry replacement = new Entry(id, label, role, loginUrl,
                username.toCharArray(), password.toCharArray(), mode,
                clean(input.usernameField(), 128), clean(input.passwordField(), 128),
                clean(input.tokenJsonPath(), 256), clean(input.authHeader(), 128),
                cleanPrefix(input.authPrefix(), 128), validationUrl);
        Entry previous = entries.put(id, replacement);
        if (previous != null) previous.clear();
        return replacement.view();
    }

    public synchronized List<View> views() {
        return entries.values().stream().map(Entry::view).toList();
    }

    public synchronized View view(String id) {
        return entry(id).view();
    }

    public synchronized void remove(String id) {
        Entry entry = entries.remove(id);
        if (entry == null) throw new IllegalArgumentException("존재하지 않는 Explorer 계정입니다.");
        entry.clear();
    }

    public synchronized void clear() {
        entries.values().forEach(Entry::clear);
        entries.clear();
    }

    synchronized <T> T withSecret(String id, Function<Secret, T> action) {
        Entry entry = entry(id);
        Secret secret = entry.secret();
        try { return action.apply(secret); }
        finally {
            Arrays.fill(secret.username(), '\0');
            Arrays.fill(secret.password(), '\0');
        }
    }

    synchronized Map<String, String> authenticationHeaders(String id, URI target) {
        Entry entry = entry(id);
        if (entry.status != AuthStatus.READY) {
            throw new IllegalStateException(entry.label + " 인증 상태가 READY가 아닙니다: " + entry.status);
        }
        Map<String, String> headers = new LinkedHashMap<>();
        Map<String, List<String>> cookieHeaders;
        try { cookieHeaders = entry.cookies.get(target, Map.of()); }
        catch (java.io.IOException error) { cookieHeaders = Map.of(); }
        String cookie = cookieHeaders.entrySet().stream()
                .filter(value -> value.getKey().equalsIgnoreCase("Cookie"))
                .flatMap(value -> value.getValue().stream()).findFirst().orElse("");
        if (!cookie.isBlank()) headers.put("Cookie", cookie);
        if (entry.authValue != null && !entry.authValue.isBlank()) {
            headers.put(entry.authHeader.isBlank() ? "Authorization" : entry.authHeader, entry.authValue);
        }
        return Map.copyOf(headers);
    }

    synchronized Map<String, String> authenticationHeadersOrEmpty(String id, URI target) {
        Entry entry = entry(id);
        if (entry.status != AuthStatus.READY && entry.status != AuthStatus.UNVERIFIED) return Map.of();
        Map<String, String> headers = new LinkedHashMap<>();
        Map<String, List<String>> cookieHeaders;
        try { cookieHeaders = entry.cookies.get(target, Map.of()); }
        catch (java.io.IOException error) { cookieHeaders = Map.of(); }
        cookieHeaders.entrySet().stream().filter(value -> value.getKey().equalsIgnoreCase("Cookie"))
                .flatMap(value -> value.getValue().stream()).findFirst()
                .ifPresent(value -> headers.put("Cookie", value));
        if (entry.authValue != null && !entry.authValue.isBlank()) {
            headers.put(entry.authHeader.isBlank() ? "Authorization" : entry.authHeader, entry.authValue);
        }
        return Map.copyOf(headers);
    }

    synchronized void acceptResponse(String id, URI requestUri, Map<String, List<String>> responseHeaders) {
        Entry entry = entry(id);
        try { entry.cookies.put(requestUri, responseHeaders == null ? Map.of() : responseHeaders); }
        catch (Exception ignored) { /* malformed target cookies are not promoted to an auth session */ }
        entry.updatedAt = Instant.now();
    }

    synchronized void setToken(String id, String header, String prefix, String token) {
        Entry entry = entry(id);
        if (token == null || token.isBlank()) return;
        entry.authHeader = header == null || header.isBlank() ? "Authorization" : header.trim();
        entry.authValue = (prefix == null ? "" : prefix) + token;
        entry.updatedAt = Instant.now();
    }

    synchronized void status(String id, AuthStatus status, String message) {
        Entry entry = entry(id);
        entry.status = status == null ? AuthStatus.FAILED : status;
        entry.message = Masking.truncate(Masking.maskSecrets(message == null ? "" : message), 500);
        entry.updatedAt = Instant.now();
    }

    @Override public synchronized void close() {
        clear();
    }

    private Entry entry(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        if (entry == null) throw new IllegalArgumentException("존재하지 않는 Explorer 계정입니다.");
        return entry;
    }

    private static URI absoluteHttp(String value, String label) {
        String clean = required(value, label, 2_048);
        try {
            URI uri = URI.create(clean);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException(label + "은 절대 HTTP(S) URL이어야 합니다.");
            }
            return uri;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(label + "이 올바르지 않습니다.");
        }
    }

    private static URI optionalHttp(String value, String label) {
        return value == null || value.isBlank() ? null : absoluteHttp(value, label);
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

    private static String cleanPrefix(String value, int max) {
        String clean = value == null ? "" : value;
        if (clean.length() > max || clean.indexOf('\r') >= 0 || clean.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("인증 접두사가 올바르지 않습니다.");
        }
        return clean;
    }

    private static final class Entry {
        private final String id;
        private final String label;
        private final String role;
        private final URI loginUrl;
        private final char[] username;
        private final char[] password;
        private final LoginMode loginMode;
        private final String usernameField;
        private final String passwordField;
        private final String tokenJsonPath;
        private String authHeader;
        private final String authPrefix;
        private final URI validationUrl;
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private String authValue;
        private AuthStatus status = AuthStatus.UNVERIFIED;
        private String message = "로그인 확인 전";
        private Instant updatedAt = Instant.now();

        private Entry(String id, String label, String role, URI loginUrl, char[] username, char[] password,
                      LoginMode loginMode, String usernameField, String passwordField,
                      String tokenJsonPath, String authHeader, String authPrefix, URI validationUrl) {
            this.id = id;
            this.label = label;
            this.role = role;
            this.loginUrl = loginUrl;
            this.username = username;
            this.password = password;
            this.loginMode = loginMode;
            this.usernameField = usernameField;
            this.passwordField = passwordField;
            this.tokenJsonPath = tokenJsonPath;
            this.authHeader = authHeader;
            this.authPrefix = authPrefix;
            this.validationUrl = validationUrl;
        }

        private Secret secret() {
            return new Secret(id, label, role, loginUrl, username.clone(), password.clone(), loginMode,
                    usernameField, passwordField, tokenJsonPath, authHeader, authPrefix, validationUrl);
        }

        private View view() {
            return new View(id, label, role, loginUrl.toString(), loginMode,
                    validationUrl == null ? "" : validationUrl.toString(), status, message, updatedAt.toString(),
                    password.length > 0, cookies.getCookieStore().getCookies().size(),
                    authValue != null && !authValue.isBlank());
        }

        private void clear() {
            Arrays.fill(username, '\0');
            Arrays.fill(password, '\0');
            authValue = null;
            cookies.getCookieStore().removeAll();
            status = AuthStatus.EXPIRED;
            message = "메모리 인증값 폐기";
            updatedAt = Instant.now();
        }
    }
}
