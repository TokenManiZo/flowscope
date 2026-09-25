package io.flowscope.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ResponseEvidence;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/** ZAP Browser Based Authentication을 구성하고 ZAP 성공 판정과 실제 인증 응답이 함께 있을 때만 완료한다. */
final class ZapBrowserAuthenticator {
    record Identity(String contextId, String contextName, String userId, String userName,
                    String browser, long verifiedEvidenceRuntimeId) {}

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
        boolean targetInScope = scopeAllows.test(target);
        boolean loginInScope = scopeAllows.test(login.loginUrl().toString());
        if (!targetInScope || !loginInScope) {
            String offending = !targetInScope && !loginInScope
                    ? "대상 " + target + " 과(와) 로그인 URL " + login.loginUrl()
                    : !targetInScope ? "대상 " + target : "로그인 URL " + login.loginUrl();
            throw new IllegalArgumentException(offending
                    + " 이(가) configured exact scope 밖입니다. 두 값을 모두 scope 안으로 맞추거나 scope에 포함하세요"
                    + " (ZAP 브라우저 인증의 로그인 URL은 폼이 있는 로그인 페이지여야 하며 로그인 API가 아닙니다).");
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
        // D-168: ZAP의 authSuccessful을 hard-gate가 아니라 하나의 신호로 강등한다. SPA/JWT 앱은 로그인이
        // 실제로 됐어도 ZAP이 스스로 성공을 확신하지 못하는(authSuccessful=false) 경우가 있어, 명시적 성공
        // 표식이 일치하거나 성공 응답에서 재사용 인증값(Bearer/쿠키)이 관측되면 로그인 성공으로 판정한다.
        // 2xx 응답 단독(재사용 인증값·ZAP 확인 모두 없음)은 소프트 실패로 보고 여전히 거부한다(D-015).
        boolean zapReportedSuccess = parse(zap.authenticateAsUser(contextId, userId))
                .path("authSuccessful").asBoolean(false);
        LoginEvidence login2 = loginEvidence(runId, login, zapReportedSuccess);
        if (!login2.confirmed()) {
            throw new IllegalStateException("로그인 실패: 재사용 가능한 ZAP 인증 응답 Evidence를 확인하지 못했습니다. "
                    + login2.diagnosis(login.loggedInIndicator())
                    + " ANON으로 대체하지 않으며 로그인 URL·ID·비밀번호를 확인하세요.");
        }
        return new Identity(contextId, contextName, userId, userName, BROWSER,
                login2.verifiedEvidenceRuntimeId());
    }

    /** 인증 단계에서 관측한 것을 요약해 실패 원인(무응답·자격증명·정규식)을 지목한다(D-164). */
    private record LoginEvidence(int responses, List<Integer> statuses, boolean matchedLoggedIn,
                                 boolean zapReportedSuccess, boolean materialSuccess, boolean anySuccess,
                                 boolean indicatorConfigured, boolean loggedOutLater,
                                 long verifiedEvidenceRuntimeId) {
        boolean confirmed() {
            if (loggedOutLater) return false;
            // 명시적 성공 표식이 설정됐으면 그 표식 일치만 성공으로 본다(운영자 의도 존중).
            if (indicatorConfigured) return matchedLoggedIn;
            // 표식이 없으면: 성공 응답에서 재사용 인증값을 관측했거나 ZAP이 성공을 확인한 경우만 성공(D-168).
            return materialSuccess || (anySuccess && zapReportedSuccess);
        }
        String diagnosis(String indicator) {
            if (responses == 0) {
                return "ZAP 인증 단계 응답이 0건입니다(브라우저가 로그인 폼을 제출하지 못했을 수 있음).";
            }
            if (loggedOutLater) {
                return "인증 응답 " + responses + "건(상태 " + statuses + ") 중 로그아웃 정규식이 로그인보다 나중에 일치했습니다.";
            }
            if (indicator == null || indicator.isBlank()) {
                return "인증 응답 " + responses + "건(상태 " + statuses
                        + ") 중 재사용 인증값(Bearer·쿠키)을 가진 성공 응답을 확인하지 못했습니다.";
            }
            return "인증 응답 " + responses + "건(상태 " + statuses + ") 중 선택적 로그인 성공 정규식 `"
                    + indicator + "`과(와) 일치 0건입니다.";
        }
    }

    private LoginEvidence loginEvidence(String runId, ZapAccountVault.Secret login, boolean zapReportedSuccess) {
        boolean indicatorConfigured = !login.loggedInIndicator().isBlank();
        Pattern loggedIn = indicatorConfigured ? Pattern.compile(login.loggedInIndicator()) : null;
        Pattern loggedOut = login.loggedOutIndicator().isBlank()
                ? null : Pattern.compile(login.loggedOutIndicator());
        long lastLoggedIn = -1;
        long lastAutomaticSuccess = -1;
        long lastMaterialSuccess = -1;
        long lastLoggedOut = -1;
        int responses = 0;
        List<Integer> statuses = new ArrayList<>();
        for (RequestRecord record : evidence.get()) {
            if (record.source != Source.SCANNER || record.sourceDetail != SourceDetail.ZAP_AUTHENTICATION
                    || !runId.equals(record.runId) || !login.id().equals(record.laneAccountId)
                    || !record.hasResponse) continue;
            String response = record.responseTextForEvidence();
            if (response == null) response = record.responseBodyForAnalysis();
            if (response == null) continue;
            responses++;
            if (statuses.size() < 8) statuses.add(record.status);
            if (loggedIn != null && loggedIn.matcher(response).find()) {
                lastLoggedIn = Math.max(lastLoggedIn, record.runtimeId());
            }
            if (ResponseEvidence.successful(record) && !ResponseEvidence.denied(record)) {
                lastAutomaticSuccess = Math.max(lastAutomaticSuccess, record.runtimeId());
                if (carriesReusableMaterial(record)) {
                    lastMaterialSuccess = Math.max(lastMaterialSuccess, record.runtimeId());
                }
            }
            if (loggedOut != null && loggedOut.matcher(response).find()) {
                lastLoggedOut = Math.max(lastLoggedOut, record.runtimeId());
            }
        }
        long verified = indicatorConfigured ? lastLoggedIn
                : (lastMaterialSuccess >= 0 ? lastMaterialSuccess : lastAutomaticSuccess);
        return new LoginEvidence(responses, statuses, lastLoggedIn >= 0, zapReportedSuccess,
                lastMaterialSuccess >= 0, lastAutomaticSuccess >= 0, indicatorConfigured,
                lastLoggedOut > verified, verified);
    }

    private static final Pattern REUSABLE_MATERIAL =
            Pattern.compile("(?im)^(?:Authorization|Cookie):\\s*\\S");

    /** 관측된 인증 요청이 재사용 가능한 인증값(Authorization/Cookie)을 실어 나르는지(마스킹돼도 헤더명은 남는다). */
    private static boolean carriesReusableMaterial(RequestRecord record) {
        String request = record.requestTextForEvidence();
        return request != null && REUSABLE_MATERIAL.matcher(request).find();
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
