package io.flowscope;

import io.flowscope.core.Masking;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.parameter.ParameterKey;
import io.flowscope.core.parameter.ParameterObservation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class MaskingTest {
    @Test
    void javascriptMaskingPreservesHttpCallsAndHidesLiteralSecrets() {
        String script = "const password=readInput();fetch('/api/catalog');"
                + "const config={apiKey:'sk-synthetic',authorization:readHeader()};"
                + "const message='token=synthetic.jwt.value';";

        String masked = Masking.maskBody(script, "application/javascript");

        assertFalse(masked.contains("sk-synthetic"));
        assertFalse(masked.contains("synthetic.jwt.value"));
        assertTrue(masked.contains("readInput();fetch('/api/catalog')"));
        assertTrue(masked.contains("authorization:readHeader()"));
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(masked);
        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis.detail());
        assertTrue(analysis.callSites().stream().anyMatch(call -> "/api/catalog".equals(call.reference())));
    }

    @Test
    void javascriptDestructuringAndNumericCredentialRemainSyntacticallyValid() {
        String script = "const {authorization:auth}=config;const apiKey=123456;"
                + "const flags={token:!0};fetch('/api/summary');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertTrue(masked.contains("authorization:auth"));
        assertFalse(masked.contains("123456"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
    }

    @Test
    void javascriptBareTokenIsRedactedWithoutRemovingFollowingCode() {
        String script = "const token=secret-value;fetch('/api/summary');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertFalse(masked.contains("secret-value"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
        assertTrue(masked.contains("fetch('/api/summary')"));
    }

    @Test
    void javascriptTemplateLiteralAndExpressionKeepTheirDelimiters() {
        String script = "const note=`token=synthetic.jwt.value`;"
                + "const active=`${token=readInput()}`;fetch('/api/items');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertFalse(masked.contains("synthetic.jwt.value"));
        assertTrue(masked.contains("readInput()"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
    }

    @Test
    void javascriptTemplateLiteralSecretValueIsMaskedButInterpolationIsKept() {
        String script = "const config={apiKey:`sk-synthetic`};const token=`jwt.synthetic`;"
                + "const auth={authorization:`Bearer ${readToken()}`};fetch('/api/items');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertFalse(masked.contains("sk-synthetic"));
        assertFalse(masked.contains("jwt.synthetic"));
        assertTrue(masked.contains("${readToken()}"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
    }

    @Test
    void javascriptRegexSecretKeepsRegexAndFollowingCall() {
        String script = "const matcher=/token=synthetic/;fetch('/api/catalog');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertFalse(masked.contains("synthetic"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
        assertTrue(masked.contains("fetch('/api/catalog')"));
    }

    @Test
    void javascriptRegexLiteralWithQuotesDoesNotHideTheFollowingCode() {
        // 실측(crAPI 번들): 정규식 안의 따옴표를 문자열 시작으로 오인하면 이후 `{token:n}` 같은 코드까지 가려져
        // 문법이 깨지고 JS 경로 분석이 0건이 된다.
        String script = "const quote=/[\"']/g,escape=s=>s.replace(/'/g,\"\\\\'\");"
                + "const ratio=total/count;const o={token:n,password:p};fetch('/api/orders');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertEquals(script, masked, "identifiers are code, not secrets");
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(masked);
        assertEquals(JavascriptAnalysis.Status.PARSED, analysis.status(), analysis.detail());
        assertTrue(analysis.callSites().stream().anyMatch(call -> "/api/orders".equals(call.reference())));
    }

    @Test
    void javascriptExpressionValueAfterASecretKeyStaysParseable() {
        String script = "i({accessToken:t||\"\",service:s});const k={apiKey:'sk-synthetic'};fetch('/api/posts');";

        String masked = Masking.maskBody(script, "application/javascript");

        assertTrue(masked.contains("accessToken:t||\"\""));
        assertFalse(masked.contains("sk-synthetic"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
    }

    @Test
    void javascriptRelativeRouteConstantsNamedAfterPasswordOrTokenAreNotSecrets() {
        String script = "const r={RESET_PASSWORD:\"api/v2/user/reset-password\",LOGIN_TOKEN:'api/auth/v4.0/user/login-with-token',"
                + "REFRESH_TOKEN:\"auth/token/refresh\"};fetch('identity/'+r.RESET_PASSWORD,{method:'POST'});";

        String masked = Masking.maskBody(script, "application/javascript");

        assertEquals(script, masked);
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(masked);
        assertTrue(analysis.callSites().stream()
                .anyMatch(call -> "identity/api/v2/user/reset-password".equals(call.reference())), analysis.callSites().toString());
    }

    @Test
    void javascriptSecretLiteralsThatOnlyResemblePathsStayMasked() {
        String script = "const c={password:\"admin/secret\",token:\"a1b2c3d4e5f6a7b8c9d0e1f2/x/y\","
                + "apiKey:\"Sk/Live/AbC123\",accessToken:\"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig\"};fetch('/api/x');";

        String masked = Masking.maskBody(script, "application/javascript");

        for (String secret : new String[] {"admin/secret", "a1b2c3d4e5f6a7b8c9d0e1f2", "Sk/Live/AbC123", "eyJhbGciOiJIUzI1NiJ9"}) {
            assertFalse(masked.contains(secret), secret);
        }
        assertEquals(JavascriptAnalysis.Status.PARSED, JavascriptCallSiteAnalyzer.analyze(masked).status());
    }

    @Test
    void javascriptMediaTypeTakesPrecedenceOverJsonLookingFirstCharacter() {
        String script = "[{password:'sk-synthetic'}].map(x=>x.password);fetch('/api/items');";

        String masked = Masking.maskBody(script, "text/javascript");

        assertFalse(masked.contains("sk-synthetic"));
        assertEquals(JavascriptAnalysis.Status.PARSED,
                JavascriptCallSiteAnalyzer.analyze(masked).status());
    }
    @Test
    void sensitiveParameterSegmentsMatchCaseEncodingAndCompoundNames() {
        for (String path : new String[]{"/Authorization", "/Cookie", "/proxy-authorization", "/password", "/passwd",
                "/secret", "/token", "/csrf", "/session", "/api-key", "/credential", "/accessToken",
                "/client_secret", "/apiKey", "/filter/password/value", "/%74oken", "/x~1token", "/@password"}) {
            assertTrue(Masking.isSensitiveParameterPath(path), path);
        }
        for (String path : new String[]{"/keyword", "/tokenizer", "/items/*/product_id", "/monkey", "/sort"}) {
            assertFalse(Masking.isSensitiveParameterPath(path), path);
        }
    }

    @Test
    void routeConstantsNamedLikeSecretsKeepTheirUrlValueButRealSecretsStayMasked() {
        // D-162: JS 라우트 상수 이름에 TOKEN/PASSWORD가 들어도 값이 URL 경로면 보존한다(Explorer가 endpoint를 읽어야 함).
        String js = "var R={LOGIN_TOKEN:\"/identity/api/auth/login\",RESET_PASSWORD:\"/identity/api/v2/user/reset-password\","
                + "VERIFY_TOKEN:\"/identity/api/auth/verify\",BASE:\"https://app.test/api\"};";
        String masked = Masking.maskSecrets(js);
        assertTrue(masked.contains("/identity/api/auth/login"), masked);
        assertTrue(masked.contains("/identity/api/v2/user/reset-password"), masked);
        assertTrue(masked.contains("/identity/api/auth/verify"), masked);
        assertTrue(masked.contains("https://app.test/api"), masked);

        // 진짜 비밀 값(URL 아님)은 이름이 같은 키여도 계속 가린다.
        String secret = Masking.maskSecrets("password=hunter2 access_token=eyJabc.def token: \"sk-live-123\"");
        assertFalse(secret.contains("hunter2"), secret);
        assertFalse(secret.contains("eyJabc.def"), secret);
        assertFalse(secret.contains("sk-live-123"), secret);
        assertTrue(secret.contains("***MASKED***"), secret);
    }

    @Test
    void observationsCannotBypassSensitivePathRejection() {
        ParameterKey key = key("/token");
        assertThrows(IllegalArgumentException.class, () -> observation(key, null));
    }

    @Test
    void valueSummariesMaskEmbeddedSecretsWithoutChangingMetadata() {
        var value = new ParameterObservation.ValueSummary(
                ParameterObservation.ValueType.STRING, 12, "sha256:fixture", "token=hidden");
        assertEquals("token=***MASKED***", value.maskedPreview());
        assertEquals(12, value.byteLength());
        assertEquals("sha256:fixture", value.digest());
    }

    @Test
    void acronymPrefixedSensitiveNamesAreRejectedAtTheModelBoundary() {
        for (String path : new String[]{"/CSRFToken", "/APIToken", "/APIKey", "/HTTPAuthorization", "/JSONPassword"}) {
            assertThrows(IllegalArgumentException.class, () -> observation(key(path), null), path);
        }
        assertFalse(Masking.isSensitiveParameterPath("/HTTPStatus"));
    }

    @Test
    void suppliedOverlongPreviewIsRejectedBeforeMaskingCanShortenIt() {
        assertThrows(IllegalArgumentException.class, () -> observation(key("/note"),
                new ParameterObservation.ValueSummary(ParameterObservation.ValueType.STRING, 86,
                        "sha256:fixture", "token=" + "x".repeat(80))));
    }

    private static ParameterKey key(String path) {
        return new ParameterKey("https://example.test:443", "POST", "POST /orders",
                ParameterObservation.Location.QUERY, path);
    }

    private static ParameterObservation observation(ParameterKey key,
                                                     ParameterObservation.ValueSummary value) {
        return new ParameterObservation(key, "ev-1", null, null, null, null, null,
                ParameterObservation.Presence.PRESENT, ParameterObservation.Shape.SCALAR,
                value, "context", null);
    }
}
