package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Objects;
import java.util.function.Predicate;

/** ZAP Browser Based Authentication을 구성하고 ZAP이 명시적으로 인증 성공을 반환한 경우만 완료한다. */
final class ZapBrowserAuthenticator {
    record Identity(String contextId, String contextName, String userId, String userName, String browser) {}

    private static final String BROWSER = "firefox-headless";
    private final ZapClient zap;
    private final ObjectMapper json;
    private final Predicate<String> scopeAllows;

    ZapBrowserAuthenticator(ZapClient zap, ObjectMapper json, Predicate<String> scopeAllows) {
        this.zap = Objects.requireNonNull(zap);
        this.json = Objects.requireNonNull(json);
        this.scopeAllows = Objects.requireNonNull(scopeAllows);
    }

    Identity authenticate(String runId, String target, int laneIndex, String contextId,
                          String contextName, ZapAccountVault.Secret login) {
        if (!scopeAllows.test(target) || !scopeAllows.test(login.loginUrl().toString())) {
            throw new IllegalArgumentException("ZAP 대상과 로그인 URL은 모두 configured exact scope 안이어야 합니다.");
        }
        String userName = "FlowScope " + login.id() + " " + runId + " " + laneIndex;
        requireOk(zap.includeInContext(contextName,
                        ZapClient.exactSubtreeRegex(login.loginUrl().toString())),
                "로그인 URL Context");
        requireOk(zap.setBrowserAuthentication(contextId, login.loginUrl().toString(), BROWSER),
                "Browser Based Authentication");
        requireOk(zap.setAutoDetectSessionManagement(contextId), "Auto-Detect Session Management");
        String userId = parse(zap.newUser(contextId, userName)).path("userId").asText();
        if (userId.isBlank()) throw new IllegalStateException("ZAP이 인증 사용자를 만들지 못했습니다.");
        requireOk(zap.setUserCredentials(contextId, userId,
                new String(login.username()), new String(login.password())), "사용자 자격증명");
        requireOk(zap.setUserEnabled(contextId, userId), "사용자 활성화");
        JsonNode result = parse(zap.authenticateAsUser(contextId, userId));
        if (!result.has("authSuccessful") || !result.path("authSuccessful").asBoolean(false)) {
            throw new IllegalStateException("ZAP이 로그인 성공을 검증하지 못했습니다. 로그인 URL·자격증명·인증 진단을 확인하세요.");
        }
        return new Identity(contextId, contextName, userId, userName, BROWSER);
    }

    private void requireOk(String raw, String step) {
        if (!"OK".equalsIgnoreCase(parse(raw).path("Result").asText())) {
            throw new IllegalStateException("ZAP " + step + " 설정에 실패했습니다.");
        }
    }

    private JsonNode parse(String raw) {
        try { return json.readTree(raw); }
        catch (Exception error) { return json.createObjectNode().put("raw", raw == null ? "" : raw); }
    }
}
