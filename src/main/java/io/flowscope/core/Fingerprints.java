package io.flowscope.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 인증 지문(fp) 산출 — 신원(idn) 식별의 근거 (기능명세서 F-05, 설계서 §4.2).
 * 우선순위: JWT sub(안정) > Authorization 원문 > Cookie session= > Cookie 전체 > anon.
 *
 * JWT sub 를 쓰면 세션 쿠키가 요청마다 회전해도 같은 사용자로 묶인다(Q5 완화).
 * 단, 안정 신호가 전혀 없는 순수 불투명 회전 토큰은 원리적으로 못 묶는다(물려받는 한계).
 */
public final class Fingerprints {

    private static final Pattern SESSION = Pattern.compile("(?i)session=([^;\\s]+)");
    private static final Pattern SUB = Pattern.compile("\"sub\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern ISS = Pattern.compile("\"iss\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern AUD = Pattern.compile("\"aud\"\\s*:\\s*(?:\"([^\"]+)\"|\\[\\s*\"([^\"]+)\")");

    private Fingerprints() {}

    public static String of(String authHeader, String cookieHeader) {
        // 원문 토큰은 fp 에 저장하지 않는다(F-05): 식별자(sub)는 유지, 토큰류는 해시.
        if (notBlank(authHeader)) {
            String sub = jwtSub(authHeader);
            if (sub != null) return sub;
            return "tok:" + hash(authHeader.trim());    // 불투명 토큰 → 해시
        }
        if (notBlank(cookieHeader)) {
            Matcher s = SESSION.matcher(cookieHeader);
            if (s.find()) return "sess:" + hash(s.group(1).trim());  // 세션ID → 해시
            return "ck:" + hash(cookieHeader.trim());                // 쿠키 전체 → 해시
        }
        return "anon";
    }

    /** 일방 해시(원문 토큰 미저장). 같은 값 → 같은 fp 라 신원 묶임은 보존된다. */
    static String hash(String v) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(v.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return Integer.toHexString(v.hashCode());
        }
    }

    /** 프로젝트 파일에는 알려진 비가역/subject 형식만 기록한다. 임의 값은 다시 해시한다. */
    public static String safeForStorage(String value) {
        if (value == null || value.isBlank() || "anon".equals(value)) return "anon";
        if (value.startsWith("sub:") || value.startsWith("jwt:") || value.startsWith("tok:")
                || value.startsWith("sess:") || value.startsWith("ck:") || value.startsWith("fp:")) {
            return value;
        }
        return "fp:" + hash(value);
    }

    /**
     * JWT payload의 (iss,aud,sub)를 이름공간 키로 쓴다. 서명을 검증한 인증 판정이 아니라
     * 관측 레코드 묶음용 비신뢰 힌트이며, 서비스 경계는 Normalizer가 추가한다.
     */
    static String jwtSub(String authHeader) {
        String token = authHeader.trim();
        if (token.regionMatches(true, 0, "Bearer ", 0, 7)) token = token.substring(7).trim();
        String[] parts = token.split("\\.");
        if (parts.length < 2) return null;
        try {
            String payload = new String(Base64.getUrlDecoder().decode(pad(parts[1])), StandardCharsets.UTF_8);
            Matcher m = SUB.matcher(payload);
            if (!m.find()) return null;
            String sub = m.group(1);
            Matcher iss = ISS.matcher(payload);
            Matcher aud = AUD.matcher(payload);
            String namespace = (iss.find() ? iss.group(1) : "") + "|"
                    + (aud.find() ? (aud.group(1) != null ? aud.group(1) : aud.group(2)) : "");
            return namespace.equals("|") ? "sub:" + sub : "jwt:" + hash(namespace) + ":sub:" + sub;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String pad(String b64url) {
        int rem = b64url.length() % 4;
        return rem == 0 ? b64url : b64url + "====".substring(rem);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
