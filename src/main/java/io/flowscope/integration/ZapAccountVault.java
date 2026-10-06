package io.flowscope.integration;

import io.flowscope.core.TextLimits;
import io.flowscope.core.AccessRole;

import java.net.URI;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/** ZAP 브라우저 인증 계정 저장소. 자격증명은 현재 프로세스 메모리에만 둔다. */
public final class ZapAccountVault implements AutoCloseable {
    public enum AuthStatus { UNVERIFIED, AUTHENTICATING, VERIFIED_BY_ZAP, FAILED }

    public record Input(String id, String label, String role, String service, String loginUrl,
                        String username, String password, String loggedInIndicator,
                        String loggedOutIndicator) {}

    public record View(String id, String label, String role, String service, String loginUrl,
                       AuthStatus status, String message, String updatedAt, boolean hasPassword,
                       boolean hasLoggedInIndicator, boolean hasLoggedOutIndicator) {}

    record Secret(String id, String label, String role, URI service, URI loginUrl,
                  char[] username, char[] password, String loggedInIndicator,
                  String loggedOutIndicator) {}

    /** 계정 설정 화면에 그대로 보여 줄 로그인 ID·비밀번호. 프로젝트·Evidence·로그·LLM으로는 내보내지 않는다. */
    public record Credentials(String username, String password) {}

    private static final int MAX_ACCOUNTS = 16;
    private final Map<String, Entry> entries = new LinkedHashMap<>();

    public synchronized View save(Input input) {
        if (input == null) throw new IllegalArgumentException("ZAP 계정 입력이 필요합니다.");
        String id = clean(input.id(), 96);
        if (id.isBlank()) id = "zap-" + UUID.randomUUID().toString().substring(0, 8);
        if (!entries.containsKey(id) && entries.size() >= MAX_ACCOUNTS) {
            throw new IllegalStateException("ZAP 계정은 최대 " + MAX_ACCOUNTS + "개까지 등록할 수 있습니다.");
        }
        String label = required(input.label(), "계정 이름", 96);
        String role = accountRole(input.role());
        URI service = serviceOrigin(input.service());
        URI loginUrl = absoluteHttp(input.loginUrl(), "로그인 URL");
        String username = requiredCredential(input.username(), "로그인 ID", 512);
        if (username.isBlank()) throw new IllegalArgumentException("로그인 ID가 필요합니다.");
        String password = requiredCredential(input.password(), "비밀번호", 4_096);
        String loggedInIndicator = verificationPattern(input.loggedInIndicator(), "로그인 상태 정규식");
        String loggedOutIndicator = verificationPattern(input.loggedOutIndicator(), "로그아웃 상태 정규식");
        Entry replacement = new Entry(id, label, role, service, loginUrl,
                username.toCharArray(), password.toCharArray(), loggedInIndicator, loggedOutIndicator);
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

    public synchronized java.util.Optional<Credentials> credentials(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        return entry == null ? java.util.Optional.empty()
                : java.util.Optional.of(new Credentials(new String(entry.username), new String(entry.password)));
    }

    public synchronized void remove(String id) {
        Entry removed = entries.remove(id == null ? "" : id.trim());
        if (removed == null) throw new IllegalArgumentException("존재하지 않는 ZAP 계정입니다.");
        removed.clear();
    }

    <T> T withSecret(String id, Function<Secret, T> action) {
        Secret secret;
        synchronized (this) {
            secret = entry(id).secret();
        }
        try { return action.apply(secret); }
        finally {
            Arrays.fill(secret.username(), '\0');
            Arrays.fill(secret.password(), '\0');
        }
    }

    synchronized void status(String id, AuthStatus status, String message) {
        Entry entry = entry(id);
        entry.status = status == null ? AuthStatus.FAILED : status;
        entry.message = TextLimits.truncate(message == null ? "" : message, 500);
        entry.updatedAt = Instant.now();
    }

    public synchronized void clear() {
        entries.values().forEach(Entry::clear);
        entries.clear();
    }

    @Override public synchronized void close() {
        clear();
    }

    private Entry entry(String id) {
        Entry entry = entries.get(id == null ? "" : id.trim());
        if (entry == null) throw new IllegalArgumentException("존재하지 않는 ZAP 계정입니다.");
        return entry;
    }

    private static URI serviceOrigin(String value) {
        URI uri = absoluteHttp(value, "대상 서비스");
        if (uri.getRawQuery() != null || (uri.getPath() != null && !uri.getPath().isBlank()
                && !"/".equals(uri.getPath()))) {
            throw new IllegalArgumentException("대상 서비스는 경로·쿼리 없는 HTTP(S) origin이어야 합니다.");
        }
        int port = uri.getPort() >= 0 ? uri.getPort()
                : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        String rawHost = uri.getHost();
        if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
            rawHost = rawHost.substring(1, rawHost.length() - 1);
        }
        String host = rawHost.contains(":") ? "[" + rawHost + "]" : rawHost;
        return URI.create(uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://"
                + host.toLowerCase(java.util.Locale.ROOT) + ":" + port);
    }

    private static String accountRole(String value) {
        String role = clean(value, 64).toUpperCase(java.util.Locale.ROOT);
        if (role.isBlank()) role = AccessRole.UNKNOWN.name();
        try {
            AccessRole parsed = AccessRole.valueOf(role);
            if (parsed == AccessRole.ANONYMOUS) {
                throw new IllegalArgumentException("로그인 계정 역할은 ANONYMOUS일 수 없습니다.");
            }
            return parsed.name();
        } catch (IllegalArgumentException error) {
            if ("로그인 계정 역할은 ANONYMOUS일 수 없습니다.".equals(error.getMessage())) throw error;
            throw new IllegalArgumentException("지원하지 않는 계정 역할입니다.");
        }
    }

    private static URI absoluteHttp(String value, String label) {
        String clean = required(value, label, 2_048);
        try {
            URI uri = URI.create(clean);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException();
            }
            return uri;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(label + "이 올바른 절대 HTTP(S) URL이 아닙니다.");
        }
    }

    private static String required(String value, String label, int max) {
        String clean = clean(value, max);
        if (clean.isBlank()) throw new IllegalArgumentException(label + "이 필요합니다.");
        return clean;
    }

    private static String requiredCredential(String value, String label, int max) {
        String credential = value == null ? "" : value;
        if (credential.length() > max) throw new IllegalArgumentException("입력 길이 상한을 초과했습니다.");
        if (credential.isEmpty()) throw new IllegalArgumentException(label + "이 필요합니다.");
        return credential;
    }

    private static String verificationPattern(String value, String label) {
        String pattern = clean(value, 2_048);
        if (pattern.isBlank()) return "";
        try {
            java.util.regex.Pattern.compile(pattern);
            return pattern;
        } catch (java.util.regex.PatternSyntaxException error) {
            throw new IllegalArgumentException(label + "이 올바른 Java 정규식이 아닙니다.");
        }
    }

    private static String clean(String value, int max) {
        String clean = value == null ? "" : value.trim();
        if (clean.length() > max) throw new IllegalArgumentException("입력 길이 상한을 초과했습니다.");
        return clean;
    }

    private static final class Entry {
        private final String id;
        private final String label;
        private final String role;
        private final URI service;
        private final URI loginUrl;
        private final char[] username;
        private final char[] password;
        private final String loggedInIndicator;
        private final String loggedOutIndicator;
        private AuthStatus status = AuthStatus.UNVERIFIED;
        private String message = "ZAP 로그인 확인 전";
        private Instant updatedAt = Instant.now();

        private Entry(String id, String label, String role, URI service, URI loginUrl,
                      char[] username, char[] password, String loggedInIndicator,
                      String loggedOutIndicator) {
            this.id = id;
            this.label = label;
            this.role = role;
            this.service = service;
            this.loginUrl = loginUrl;
            this.username = username;
            this.password = password;
            this.loggedInIndicator = loggedInIndicator;
            this.loggedOutIndicator = loggedOutIndicator;
        }

        private Secret secret() {
            return new Secret(id, label, role, service, loginUrl, username.clone(), password.clone(),
                    loggedInIndicator, loggedOutIndicator);
        }

        private View view() {
            return new View(id, label, role, service.toString(), loginUrl.toString(), status,
                    message, updatedAt.toString(), password.length > 0,
                    !loggedInIndicator.isBlank(), !loggedOutIndicator.isBlank());
        }

        private void clear() {
            Arrays.fill(username, '\0');
            Arrays.fill(password, '\0');
            status = AuthStatus.FAILED;
            message = "메모리 자격증명 폐기";
            updatedAt = Instant.now();
        }
    }
}
