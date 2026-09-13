package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.Masking;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 표준 HTML form 또는 운영자가 지정한 JSON 로그인 계약으로 Explorer 세션을 준비한다. */
public final class ExplorerAuthRuntime {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_REDIRECTS = 5;

    private final ExplorerAccountVault vault;
    private final ExplorerTransport transport;

    public ExplorerAuthRuntime(ExplorerAccountVault vault, ExplorerTransport transport) {
        this.vault = vault;
        this.transport = transport;
    }

    public ExplorerAccountVault.View authenticate(String accountId, String runId) {
        try {
            return vault.withSecret(accountId, secret -> {
                try {
                    boolean authenticationArtifact;
                    if (secret.loginMode() == ExplorerAccountVault.LoginMode.JSON) {
                        authenticationArtifact = authenticateJson(secret, runId);
                    } else {
                        authenticationArtifact = authenticateForm(secret, runId);
                    }
                    boolean validationPassed = validate(secret, runId);
                    if (!authenticationArtifact && !validationPassed) {
                        throw new NeedsInput("로그인 응답에서 새 세션 cookie·token을 확인하지 못했습니다. 검증 URL을 지정하세요.");
                    }
                    vault.status(accountId, ExplorerAccountVault.AuthStatus.READY,
                            validationPassed ? "검증 URL에서 인증 세션 응답을 확인했습니다."
                                    : "로그인 응답에서 인증 세션 값을 확인했습니다.");
                    return vault.view(accountId);
                } catch (NeedsInput error) {
                    vault.status(accountId, ExplorerAccountVault.AuthStatus.NEEDS_INPUT, error.getMessage());
                    return vault.view(accountId);
                } catch (Exception error) {
                    vault.status(accountId, ExplorerAccountVault.AuthStatus.FAILED,
                            safe("로그인 실패: " + error.getMessage()));
                    return vault.view(accountId);
                }
            });
        } catch (RuntimeException error) {
            vault.status(accountId, ExplorerAccountVault.AuthStatus.FAILED,
                    safe("로그인 실패: " + error.getMessage()));
            return vault.view(accountId);
        }
    }

    private boolean authenticateForm(ExplorerAccountVault.Secret secret, String runId) throws Exception {
        ExplorerTransport.Response page = send(secret.id(), "GET", secret.loginUrl(), Map.of(), new byte[0], "", runId);
        if (page.status() >= 400) throw new NeedsInput("로그인 화면 GET이 HTTP " + page.status() + "를 반환했습니다.");
        Document document = Jsoup.parse(page.body(), secret.loginUrl().toString());
        Element form = document.select("form:has(input[type=password])").first();
        if (form == null) throw new NeedsInput("비밀번호 입력 form을 찾지 못했습니다. SPA/API 로그인은 JSON 모드로 필드명을 지정하세요.");
        String usernameField = secret.usernameField().isBlank() ? usernameField(form) : secret.usernameField();
        String passwordField = secret.passwordField().isBlank() ? passwordField(form) : secret.passwordField();
        if (usernameField.isBlank() || passwordField.isBlank()) {
            throw new NeedsInput("로그인 ID 또는 비밀번호 필드명을 확정하지 못했습니다.");
        }
        Map<String, String> fields = new LinkedHashMap<>();
        for (Element input : form.select("input[name]")) {
            String name = input.attr("name");
            String type = input.attr("type").toLowerCase(Locale.ROOT);
            if (!name.isBlank() && (type.equals("hidden") || type.equals("submit"))) {
                fields.put(name, input.attr("value"));
            }
        }
        fields.put(usernameField, new String(secret.username()));
        fields.put(passwordField, new String(secret.password()));
        String body = fields.entrySet().stream().map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                .reduce((left, right) -> left + "&" + right).orElse("");
        URI action = secret.loginUrl().resolve(form.hasAttr("action") ? form.attr("action") : secret.loginUrl().toString());
        String method = form.attr("method").equalsIgnoreCase("get") ? "GET" : "POST";
        if (method.equals("GET")) {
            throw new NeedsInput("비밀번호를 URL query에 넣는 GET 로그인 form은 자동 실행하지 않습니다.");
        }
        ExplorerTransport.Response response = send(secret.id(), method, action,
                Map.of("Content-Type", "application/x-www-form-urlencoded"),
                body.getBytes(StandardCharsets.UTF_8),
                "application/x-www-form-urlencoded", runId);
        boolean sessionCookie = setsCookie(response);
        RedirectResult redirects = followRedirects(secret.id(), response, runId);
        sessionCookie |= redirects.setCookie();
        if (response.status() >= 400) throw new NeedsInput("로그인 form 제출이 HTTP " + response.status() + "를 반환했습니다.");
        return sessionCookie;
    }

    private boolean authenticateJson(ExplorerAccountVault.Secret secret, String runId) throws Exception {
        String usernameField = secret.usernameField().isBlank() ? "username" : secret.usernameField();
        String passwordField = secret.passwordField().isBlank() ? "password" : secret.passwordField();
        String body = JSON.createObjectNode().put(usernameField, new String(secret.username()))
                .put(passwordField, new String(secret.password())).toString();
        ExplorerTransport.Response response = send(secret.id(), "POST", secret.loginUrl(),
                Map.of("Content-Type", "application/json", "Accept", "application/json"),
                body.getBytes(StandardCharsets.UTF_8), "application/json", runId);
        if (response.status() >= 400) throw new NeedsInput("JSON 로그인이 HTTP " + response.status() + "를 반환했습니다.");
        boolean authenticationArtifact = setsCookie(response);
        RedirectResult redirects = followRedirects(secret.id(), response, runId);
        authenticationArtifact |= redirects.setCookie();
        if (!secret.tokenJsonPath().isBlank()) {
            JsonNode root = JSON.readTree(response.body());
            JsonNode token = jsonPath(root, secret.tokenJsonPath());
            if (token == null || !token.isValueNode() || token.asText().isBlank()) {
                throw new NeedsInput("지정한 token JSON 경로에서 값을 찾지 못했습니다.");
            }
            vault.setToken(secret.id(), secret.authHeader(), secret.authPrefix(), token.asText());
            authenticationArtifact = true;
        }
        return authenticationArtifact;
    }

    private boolean validate(ExplorerAccountVault.Secret secret, String runId) throws Exception {
        URI validation = secret.validationUrl();
        if (validation == null) return false;
        ExplorerTransport.Response response = send(secret.id(), "GET", validation, Map.of(), new byte[0], "", runId);
        response = followRedirects(secret.id(), response, runId).response();
        boolean loginForm = response.contentType() != null
                && response.contentType().toLowerCase(Locale.ROOT).contains("html")
                && Jsoup.parse(response.body()).selectFirst("form:has(input[type=password])") != null;
        if (response.status() < 200 || response.status() >= 400 || loginForm) {
            throw new NeedsInput("검증 URL이 HTTP " + response.status() + "를 반환해 로그인 상태를 확인하지 못했습니다.");
        }
        return true;
    }

    private ExplorerTransport.Response send(String accountId, String method, URI url,
                                            Map<String, String> headers, byte[] body,
                                            String contentType, String runId) throws Exception {
        Map<String, String> combined = new LinkedHashMap<>(vault.authenticationHeadersOrEmpty(accountId, url));
        combined.putAll(headers);
        ExplorerTransport.Response response = transport.send(new ExplorerTransport.Request(accountId, method,
                url.toString(), combined, body, contentType, runId, true));
        vault.acceptResponse(accountId, url, response.headers());
        return response;
    }

    private RedirectResult followRedirects(String accountId, ExplorerTransport.Response initial, String runId) throws Exception {
        ExplorerTransport.Response response = initial;
        boolean setCookie = false;
        for (int count = 0; count < MAX_REDIRECTS && response.status() >= 300 && response.status() < 400
                && response.location() != null && !response.location().isBlank(); count++) {
            URI next = URI.create(response.url()).resolve(response.location());
            response = send(accountId, "GET", next, Map.of(), new byte[0], "", runId);
            setCookie |= setsCookie(response);
        }
        return new RedirectResult(response, setCookie);
    }

    private static boolean setsCookie(ExplorerTransport.Response response) {
        return response.headers().entrySet().stream()
                .anyMatch(entry -> entry.getKey().equalsIgnoreCase("Set-Cookie")
                        && entry.getValue().stream().anyMatch(value -> value != null && !value.isBlank()));
    }

    private static JsonNode jsonPath(JsonNode root, String path) {
        JsonNode current = root;
        for (String segment : path.replaceFirst("^\\$\\.?", "").split("\\.")) {
            if (segment.isBlank()) continue;
            current = current.path(segment);
            if (current.isMissingNode()) return null;
        }
        return current;
    }

    private static String usernameField(Element form) {
        Element explicit = form.select("input[autocomplete=username][name],input[type=email][name]").first();
        if (explicit != null) return explicit.attr("name");
        Element fallback = form.select("input[type=text][name],input:not([type])[name]").first();
        return fallback == null ? "" : fallback.attr("name");
    }

    private static String passwordField(Element form) {
        Element input = form.select("input[type=password][name]").first();
        return input == null ? "" : input.attr("name");
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private static String safe(String value) {
        return Masking.truncate(Masking.maskSecrets(value == null ? "" : value), 500);
    }

    private static final class NeedsInput extends Exception {
        private NeedsInput(String message) { super(message); }
    }

    private record RedirectResult(ExplorerTransport.Response response, boolean setCookie) {}
}
