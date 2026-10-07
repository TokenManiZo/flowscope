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

    /** FORM: ZAP이 로그인 URL에 ID/PW를 넣는 폼 로그인. INJECT: 사용자가 직접 로그인 후 얻은 쿠키·헤더를 주입. */
    public enum AuthMode { FORM, INJECT }

    public record Input(String id, String label, String role, String service, String loginUrl,
                        String username, String password, String cookie, String headers,
                        String authMode, String loggedInIndicator, String loggedOutIndicator,
                        String verifyUrl) {
        /** 기존 폼 로그인 호출(쿠키·헤더·모드·검증 URL 없음) 호환 생성자. */
        public Input(String id, String label, String role, String service, String loginUrl,
                     String username, String password, String loggedInIndicator, String loggedOutIndicator) {
            this(id, label, role, service, loginUrl, username, password, "", "", "FORM",
                    loggedInIndicator, loggedOutIndicator, "");
        }
    }

    public record View(String id, String label, String role, String service, String loginUrl,
                       AuthStatus status, String message, String updatedAt, boolean hasPassword,
                       boolean hasLoggedInIndicator, boolean hasLoggedOutIndicator,
                       AuthMode authMode, boolean hasCookie, boolean hasHeaders, String verifyUrl) {}

    record Secret(String id, String label, String role, URI service, AuthMode authMode, URI loginUrl,
                  char[] username, char[] password, char[] cookie, char[] headers,
                  String loggedInIndicator, String loggedOutIndicator, URI verifyUrl) {}

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
        AuthMode authMode = authMode(input.authMode());
        String loggedInIndicator = verificationPattern(input.loggedInIndicator(), "로그인 상태 정규식");
        String loggedOutIndicator = verificationPattern(input.loggedOutIndicator(), "로그아웃 상태 정규식");
        URI loginUrl;
        String username;
        String password;
        String cookie;
        String headers;
        URI verifyUrl = null;
        if (authMode == AuthMode.FORM) {
            loginUrl = absoluteHttp(input.loginUrl(), "로그인 URL");
            username = requiredCredential(input.username(), "로그인 ID", 512);
            if (username.isBlank()) throw new IllegalArgumentException("로그인 ID가 필요합니다.");
            password = requiredCredential(input.password(), "비밀번호", 4_096);
            cookie = "";
            headers = "";
        } else {
            // 주입 모드는 ZAP이 폼 로그인을 하지 않으므로 로그인 URL·ID·비밀번호가 없다. 쿠키나 헤더를 하나 이상 받는다.
            loginUrl = null;
            username = "";
            password = "";
            cookie = cookieBlock(input.cookie());
            headers = headerBlock(input.headers());
            if (cookie.isBlank() && headers.isBlank()) {
                throw new IllegalArgumentException("주입할 쿠키나 인증 헤더를 하나 이상 입력하세요.");
            }
            // 검증 URL(선택): 로그인해야 열리는 대상 주소. 주입값을 실어 보내 응답 상태로 로그인 여부를 확인한다.
            // 대상 서비스와 같은 origin만 허용해 범위 밖으로 요청이 새지 않게 한다.
            verifyUrl = sameOriginVerifyUrl(input.verifyUrl(), service);
        }
        Entry replacement = new Entry(id, label, role, service, authMode, loginUrl,
                username.toCharArray(), password.toCharArray(), cookie.toCharArray(), headers.toCharArray(),
                loggedInIndicator, loggedOutIndicator, verifyUrl);
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
            Arrays.fill(secret.cookie(), '\0');
            Arrays.fill(secret.headers(), '\0');
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

    private static AuthMode authMode(String value) {
        String mode = clean(value, 16).toUpperCase(java.util.Locale.ROOT);
        if (mode.isBlank()) return AuthMode.FORM;
        try {
            return AuthMode.valueOf(mode);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("로그인 방식은 FORM 또는 INJECT여야 합니다.");
        }
    }

    /** 주입 쿠키 블록(`name=value; name2=value2`). CR·LF·제어문자를 막아 헤더 스머글링을 차단한다. */
    private static String cookieBlock(String value) {
        String clean = clean(value, 8_192);
        if (clean.isBlank()) return "";
        if (hasControlChar(clean)) throw new IllegalArgumentException("쿠키에 줄바꿈·제어문자가 있습니다.");
        boolean any = false;
        for (String pair : clean.split(";")) {
            String trimmed = pair.trim();
            if (trimmed.isEmpty()) continue;
            int eq = trimmed.indexOf('=');
            if (eq <= 0) throw new IllegalArgumentException("쿠키는 name=value 형식이어야 합니다.");
            any = true;
        }
        if (!any) throw new IllegalArgumentException("쿠키는 name=value 형식이어야 합니다.");
        return clean;
    }

    /** 주입 인증 헤더 블록(줄바꿈 구분 `Name: value`). 각 줄은 헤더 이름과 값을 가져야 한다. */
    private static String headerBlock(String value) {
        String clean = clean(value, 8_192);
        if (clean.isBlank()) return "";
        boolean any = false;
        for (String line : clean.split("\n", -1)) {
            String trimmed = line.strip();
            if (trimmed.isEmpty()) continue;
            if (hasControlChar(trimmed)) throw new IllegalArgumentException("인증 헤더에 제어문자가 있습니다.");
            int colon = trimmed.indexOf(':');
            if (colon <= 0 || trimmed.substring(colon + 1).isBlank()) {
                throw new IllegalArgumentException("인증 헤더는 Name: value 형식이어야 합니다.");
            }
            any = true;
        }
        if (!any) throw new IllegalArgumentException("인증 헤더는 Name: value 형식이어야 합니다.");
        return clean;
    }

    /** 검증 URL은 비워 둘 수 있다. 넣으면 절대 HTTP(S)이고 대상 서비스와 같은 origin이어야 한다(범위 밖 전송 방지). */
    private static URI sameOriginVerifyUrl(String value, URI service) {
        String clean = clean(value, 2_048);
        if (clean.isBlank()) return null;
        URI uri = absoluteHttp(clean, "검증 URL");
        int port = uri.getPort() >= 0 ? uri.getPort()
                : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        boolean sameOrigin = uri.getScheme().equalsIgnoreCase(service.getScheme())
                && uri.getHost() != null && uri.getHost().equalsIgnoreCase(service.getHost())
                && port == service.getPort();
        if (!sameOrigin) {
            throw new IllegalArgumentException("검증 URL은 대상 서비스와 같은 호스트·포트여야 합니다.");
        }
        return uri;
    }

    private static boolean hasControlChar(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
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
        private final AuthMode authMode;
        private final URI loginUrl;
        private final char[] username;
        private final char[] password;
        private final char[] cookie;
        private final char[] headers;
        private final String loggedInIndicator;
        private final String loggedOutIndicator;
        private final URI verifyUrl;
        private AuthStatus status = AuthStatus.UNVERIFIED;
        private String message = "ZAP 로그인 확인 전";
        private Instant updatedAt = Instant.now();

        private Entry(String id, String label, String role, URI service, AuthMode authMode, URI loginUrl,
                      char[] username, char[] password, char[] cookie, char[] headers,
                      String loggedInIndicator, String loggedOutIndicator, URI verifyUrl) {
            this.id = id;
            this.label = label;
            this.role = role;
            this.service = service;
            this.authMode = authMode;
            this.loginUrl = loginUrl;
            this.username = username;
            this.password = password;
            this.cookie = cookie;
            this.headers = headers;
            this.loggedInIndicator = loggedInIndicator;
            this.loggedOutIndicator = loggedOutIndicator;
            this.verifyUrl = verifyUrl;
        }

        private Secret secret() {
            return new Secret(id, label, role, service, authMode, loginUrl,
                    username.clone(), password.clone(), cookie.clone(), headers.clone(),
                    loggedInIndicator, loggedOutIndicator, verifyUrl);
        }

        private View view() {
            return new View(id, label, role, service.toString(), loginUrl == null ? "" : loginUrl.toString(),
                    status, message, updatedAt.toString(), password.length > 0,
                    !loggedInIndicator.isBlank(), !loggedOutIndicator.isBlank(),
                    authMode, cookie.length > 0, headers.length > 0, verifyUrl == null ? "" : verifyUrl.toString());
        }

        private void clear() {
            Arrays.fill(username, '\0');
            Arrays.fill(password, '\0');
            Arrays.fill(cookie, '\0');
            Arrays.fill(headers, '\0');
            status = AuthStatus.FAILED;
            message = "메모리 자격증명 폐기";
            updatedAt = Instant.now();
        }
    }
}
