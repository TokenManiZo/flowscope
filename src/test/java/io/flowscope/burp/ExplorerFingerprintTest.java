package io.flowscope.burp;

import io.flowscope.core.Fingerprints;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Explorer 신원 귀속 1단계: 실제 Explorer transport는
 * {@code recordFrom(…, applyRunContext=false, …, forcedAccountId)}로 {@code captureFingerprint(LLM, context=null, …)}를
 * 호출한다. LLM lane에서는 HUMAN/SCANNER 전용 익명 특례가 적용되지 않으므로 이 함수가
 * {@link Fingerprints#of(String, String)}로 정확히 환원되어야 하며, 그 사실을 여기서 고정한다.
 * {@code io.flowscope.explorer.ExplorerIdentityAttributionTest}는 이 환원에 기대어 공개 API만으로 나머지 경로를 검증한다.
 */
final class ExplorerFingerprintTest {

    @Test
    void llmLaneReducesToFingerprintsOfAndNeverLeaksTheRawToken() {
        String authorization = "Bearer secret-token";
        String fp = FlowScopeExtension.captureFingerprint(Source.LLM, null, "acct-llm", authorization, null);
        assertEquals(Fingerprints.of(authorization, null), fp);
        assertTrue(fp.startsWith("tok:"), fp);
        assertFalse(fp.contains("secret-token"), "raw token must never appear in the fingerprint");
        assertEquals(fp, FlowScopeExtension.captureFingerprint(Source.LLM, null, "acct-llm", authorization, null),
                "same injected token must map to the same fingerprint across requests");
    }

    @Test
    void llmLaneKeepsJwtSubjectAsStableIdentity() {
        String jwt = "Bearer " + base64url("{\"alg\":\"none\"}") + "." + base64url("{\"sub\":\"user-7\"}") + ".";
        String fp = FlowScopeExtension.captureFingerprint(Source.LLM, null, "acct-llm", jwt, null);
        assertEquals("sub:user-7", fp);
        assertEquals(Fingerprints.of(jwt, null), fp);
    }

    @Test
    void llmLaneWithoutCredentialsStaysAnonymousSoBindingIsSkipped() {
        assertEquals(Fingerprints.ANONYMOUS,
                FlowScopeExtension.captureFingerprint(Source.LLM, null, "acct-llm", null, null));
        assertEquals(Fingerprints.ANONYMOUS,
                FlowScopeExtension.captureFingerprint(Source.LLM, null, "acct-llm", "", " "),
                "blank credentials stay anonymous so recordFrom skips bindSession");
    }

    private static String base64url(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
}
