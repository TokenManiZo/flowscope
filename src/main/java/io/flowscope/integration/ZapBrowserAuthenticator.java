package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;

import java.util.List;
import java.util.Objects;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/** ZAP Browser Based Authentication을 구성하고 관측된 인증 응답이 성공 지표와 일치할 때만 완료한다. */
final class ZapBrowserAuthenticator {
    record Identity(String contextId, String contextName, String userId, String userName, String browser) {}

    private static final String BROWSER = ZapClient.CLIENT_BROWSER;
    private final ZapClient zap;
    private final ObjectMapper json;
    private final Predicate<String> scopeAllows;
    private final Supplier<List<RequestRecord>> evidence;

    ZapBrowserAuthenticator(ZapClient zap, ObjectMapper json, Predicate<String> scopeAllows,
                            Supplier<List<RequestRecord>> evidence) {
        this.zap = Objects.requireNonNull(zap);
        this.json = Objects.requireNonNull(json);
        this.scopeAllows = Objects.requireNonNull(scopeAllows);
        this.evidence = Objects.requireNonNull(evidence);
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
        if (!login.loggedInIndicator().isBlank()) {
            requireOk(zap.setLoggedInIndicator(contextId, login.loggedInIndicator()),
                    "로그인 상태 검증 정규식");
        }
        if (!login.loggedOutIndicator().isBlank()) {
            requireOk(zap.setLoggedOutIndicator(contextId, login.loggedOutIndicator()),
                    "로그아웃 상태 검증 정규식");
        }
        String userId = parse(zap.newUser(contextId, userName)).path("userId").asText();
        if (userId.isBlank()) throw new IllegalStateException("ZAP이 인증 사용자를 만들지 못했습니다.");
        requireOk(zap.setUserCredentials(contextId, userId,
                new String(login.username()), new String(login.password())), "사용자 자격증명");
        requireOk(zap.setUserEnabled(contextId, userId), "사용자 활성화");
        parse(zap.authenticateAsUser(contextId, userId));
        if (!hasLoggedInEvidence(runId, login)) {
            throw new IllegalStateException("로그인 성공 정규식과 일치하는 ZAP 인증 응답 Evidence가 없습니다. "
                    + "로그인 URL·자격증명·인증 검증 정규식을 확인하세요.");
        }
        return new Identity(contextId, contextName, userId, userName, BROWSER);
    }

    private boolean hasLoggedInEvidence(String runId, ZapAccountVault.Secret login) {
        Pattern loggedIn = Pattern.compile(login.loggedInIndicator());
        Pattern loggedOut = login.loggedOutIndicator().isBlank()
                ? null : Pattern.compile(login.loggedOutIndicator());
        long lastLoggedIn = -1;
        long lastLoggedOut = -1;
        for (RequestRecord record : evidence.get()) {
            if (record.source != Source.SCANNER || record.sourceDetail != SourceDetail.ZAP_AUTHENTICATION
                    || !runId.equals(record.runId) || !login.id().equals(record.laneAccountId)
                    || !record.hasResponse) continue;
            String response = record.responseTextForEvidence();
            if (response == null) response = record.responseBodyForAnalysis();
            if (response == null) continue;
            if (loggedIn.matcher(response).find()) lastLoggedIn = Math.max(lastLoggedIn, record.runtimeId());
            if (loggedOut != null && loggedOut.matcher(response).find()) {
                lastLoggedOut = Math.max(lastLoggedOut, record.runtimeId());
            }
        }
        return lastLoggedIn > lastLoggedOut;
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
