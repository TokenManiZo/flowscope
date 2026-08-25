package io.flowscope;

import io.flowscope.core.Fingerprints;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

class FingerprintsTest {

    private static String jwt(String sub) {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(("{\"sub\":\"" + sub + "\"}").getBytes(StandardCharsets.UTF_8));
        return "h." + payload + ".s";
    }

    @Test
    void 세션쿠키는_해시되어_원문저장_안함() {
        String fp = Fingerprints.of(null, "session=AAA; csrf=xyz");
        assertTrue(fp.startsWith("sess:"), "세션은 sess: 접두 해시");
        assertFalse(fp.contains("AAA"), "원문 토큰이 fp에 남으면 안 됨(F-05)");
        assertEquals(fp, Fingerprints.of(null, "session=AAA; csrf=other"),
                "같은 세션이면 같은 fp (신원 묶임 보존)");
    }

    @Test
    void 불투명_bearer도_해시() {
        String fp = Fingerprints.of("Bearer opaque-secret-123", null);
        assertTrue(fp.startsWith("tok:"));
        assertFalse(fp.contains("opaque-secret-123"), "원문 토큰 저장 금지(F-05)");
    }

    @Test
    void jwt_sub_로_묶임_세션쿠키가_회전해도() {
        String bearer = "Bearer " + jwt("roamer");
        String a = Fingerprints.of(bearer, "session=1a2b");   // 회전 쿠키 1
        String b = Fingerprints.of(bearer, "session=9f8e");   // 회전 쿠키 2
        assertEquals("sub:roamer", a);
        assertEquals(a, b, "JWT sub 가 같으면 세션쿠키가 달라도 같은 신원");
    }

    @Test
    void jwt_issuer가_다르면_같은_sub도_분리한다() {
        String a = Base64.getUrlEncoder().withoutPadding().encodeToString(
                "{\"iss\":\"service-a\",\"sub\":\"42\"}".getBytes(StandardCharsets.UTF_8));
        String b = Base64.getUrlEncoder().withoutPadding().encodeToString(
                "{\"iss\":\"service-b\",\"sub\":\"42\"}".getBytes(StandardCharsets.UTF_8));
        assertNotEquals(Fingerprints.of("Bearer h." + a + ".s", null),
                Fingerprints.of("Bearer h." + b + ".s", null));
    }

    @Test
    void 불투명_회전은_못묶음_물려받는_한계() {
        // 안정 신호가 없으면 서로 다른 fp — 원리적 한계(Q5)
        String x = Fingerprints.of(null, "session=1a2b");
        String y = Fingerprints.of(null, "session=9f8e");
        assertNotEquals(x, y);
    }

    @Test
    void 인증없으면_anon() {
        assertEquals("anon", Fingerprints.of(null, null));
    }
}
