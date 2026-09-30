package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 인증정보 마스킹 (기능명세서 F-05 "원문 토큰은 저장하지 않는다", F-22 "인증 정보는 가린 상태로 표시").
 * 요청 전문·본문을 보관하기 전에 반드시 통과시킨다.
 */
public final class Masking {

    private static final String MASK = "***MASKED***";
    private static final String REDACTED = "[BODY REDACTED: secret-bearing content could not be parsed]";
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final Pattern AUTH_HEADER =
            Pattern.compile("(?im)^(Authorization:\\s*)(.+)$");
    private static final Pattern COOKIE_HEADER =
            Pattern.compile("(?im)^(Cookie:\\s*)(.+)$");
    private static final Pattern SET_COOKIE =
            Pattern.compile("(?im)^(Set-Cookie:\\s*)(.+)$");
    private static final Pattern CONTENT_TYPE =
            Pattern.compile("(?im)^Content-Type:\\s*([^\\r\\n]+)$");
    private static final Pattern BOUNDARY =
            Pattern.compile("(?i)(?:^|;)\\s*boundary=(?:\"([^\"]+)\"|([^;\\s]+))");
    private static final Pattern PART_NAME =
            Pattern.compile("(?i)\\bname=\"([^\"]+)\"");
    /** 일반 텍스트/쿼리의 비밀 값. 구조화 본문은 maskBody가 우선 처리한다. */
    private static final String SECRET_NAME =
            "(?:pass(?:word|wd)?|pwd|token|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|authorization)";
    private static final String SECRET_PREFIX = "[\"']?" + SECRET_NAME + "[\"']?\\s*[:=]\\s*[\"']?";
    private static final Pattern SECRET_FIELD = Pattern.compile(
            "(?i)(" + SECRET_PREFIX + ")([^\"'&,}\\s]+)");
    private static final Pattern JAVASCRIPT_SECRET_FIELD = Pattern.compile(
            "(?i)(" + SECRET_PREFIX + ")([^\"'`&,}\\s]+)");
    private static final Pattern XML_SECRET = Pattern.compile(
            "(?is)(<\\s*(password|passwd|pwd|token|secret|client_secret|api_key|access_token|refresh_token|id_token|session_token|authorization)\\b[^>]*>)(.*?)(</\\s*\\2\\s*>)");

    private Masking() {}

    /** Parameter profiles omit secret-bearing paths, including encoded and compound field names. */
    public static boolean isSensitiveParameterPath(String path) {
        if (path == null) return false;
        String decoded = splitParameterWords(decode(path).replace("~1", "/").replace("~0", "~"))
                .toLowerCase(Locale.ROOT);
        for (String segment : decoded.split("[^a-z0-9]+")) {
            if (switch (segment) {
                case "authorization", "cookie", "password", "passwd", "secret", "token", "csrf",
                        "session", "credential", "credentials", "apikey", "pwd", "pass" -> true;
                default -> false;
            }) return true;
        }
        return decoded.matches("(?s).*(?:^|[^a-z0-9])api[^a-z0-9]+key(?:[^a-z0-9]|$).*");
    }

    /** One forward pass, at most 2n character reads and one inserted separator per character. */
    static String splitParameterWords(CharSequence value) {
        int length = value.length();
        StringBuilder words = new StringBuilder(length);
        char previous = 0;
        for (int i = 0; i < length; i++) {
            char current = value.charAt(i);
            char next = i + 1 < length ? value.charAt(i + 1) : 0;
            boolean uppercase = current >= 'A' && current <= 'Z';
            boolean previousLowerOrDigit = previous >= 'a' && previous <= 'z'
                    || previous >= '0' && previous <= '9';
            boolean acronymEnd = previous >= 'A' && previous <= 'Z' && next >= 'a' && next <= 'z';
            if (i > 0 && uppercase && (previousLowerOrDigit || acronymEnd)) words.append('/');
            words.append(current);
            previous = current;
        }
        return words.toString();
    }

    /** 요청 전문에서 인증 헤더 값을 가린다. 헤더 이름·구조는 남겨 상세 보기(F-22)에 쓸 수 있게. */
    public static String maskHeaders(String reqText) {
        if (reqText == null) return null;
        int separator = headerSeparator(reqText);
        int separatorLength = separator < 0 ? 0 : (reqText.startsWith("\r\n\r\n", separator) ? 4 : 2);
        String headers = separator < 0 ? reqText : reqText.substring(0, separator);
        String body = separator < 0 ? null : reqText.substring(separator + separatorLength);
        String contentType = headerValue(CONTENT_TYPE, headers);

        String s = AUTH_HEADER.matcher(headers).replaceAll(m -> m.group(1) + MASK);
        s = COOKIE_HEADER.matcher(s).replaceAll(m -> m.group(1) + maskCookieValues(m.group(2)));
        s = SET_COOKIE.matcher(s).replaceAll(m -> m.group(1) + maskCookieValues(m.group(2)));
        s = maskSecrets(s);
        return body == null ? s : s + reqText.substring(separator, separator + separatorLength)
                + maskBody(body, contentType);
    }

    /** 본문·쿼리의 비밀 필드 값을 가린다. */
    public static String maskSecrets(String s) {
        if (s == null) return null;
        String trimmed = s.stripLeading();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) return maskJson(s);
        String xml = XML_SECRET.matcher(s).replaceAll(m -> m.group(1) + MASK + m.group(4));
        return SECRET_FIELD.matcher(xml).replaceAll(Masking::secretFieldReplacement);
    }

    /**
     * SECRET_FIELD 매치의 대체 문자열. 값이 URL 경로면(라우트 상수 `LOGIN_TOKEN:"/x"`, `RESET_PASSWORD:"/y"` 등) 원문을
     * 보존하고, 그 외에는 값을 가린다. 실제 비밀 값은 `/`·`http(s)://`로 시작하지 않으므로 마스킹이 유지된다(D-162).
     */
    private static String secretFieldReplacement(java.util.regex.MatchResult match) {
        return isRoutePathValue(match.group(2)) ? match.group() : match.group(1) + MASK;
    }

    /** 값이 절대/상대 URL 경로로 보이는가. 라우트 상수 값 보존용이며 비밀 값 판별이 아니다. */
    static boolean isRoutePathValue(String value) {
        if (value == null || value.isEmpty()) return false;
        return value.charAt(0) == '/' || value.startsWith("http://") || value.startsWith("https://");
    }

    /** Content-Type에 따라 구조화된 본문 전체 값을 가린다. 파싱 실패 시 비밀 표식이 있는 본문은 보존하지 않는다. */
    public static String maskBody(String body, String contentType) {
        if (body == null) return null;
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (type.contains("javascript") || type.contains("ecmascript")) return maskJavascript(body);
        String trimmed = body.stripLeading();
        if (type.contains("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) return maskJson(body);
        if (type.contains("application/x-www-form-urlencoded")) return maskForm(body);
        if (type.contains("multipart/form-data")) return maskMultipart(body, contentType);
        if (type.contains("xml") || trimmed.startsWith("<")) return maskSecrets(body);
        return maskSecrets(body);
    }

    /** Redact JavaScript literals without replacing a dynamic expression or the next statement. */
    private static String maskJavascript(String script) {
        String xml = XML_SECRET.matcher(script).replaceAll(m -> m.group(1) + MASK + m.group(4));
        Matcher matcher = JAVASCRIPT_SECRET_FIELD.matcher(xml);
        StringBuilder result = new StringBuilder(xml.length());
        JavascriptLexState state = new JavascriptLexState();
        int copied = 0;
        int scanned = 0;
        while (matcher.find()) {
            state.advance(xml, scanned, matcher.start());
            scanned = matcher.start();
            result.append(xml, copied, matcher.start());
            String prefix = matcher.group(1);
            String value = matcher.group(2);
            if (isRoutePathValue(value)) {
                result.append(matcher.group());
            } else if (!state.quotedOrCommented() && matcher.start() > 0
                    && xml.charAt(matcher.start() - 1) == '/') {
                int closingSlash = javascriptRegexEnd(value);
                if (closingSlash < 0) return REDACTED;
                result.append(prefix).append(MASK).append(value.substring(closingSlash));
            } else if (state.quotedOrCommented()
                    || prefix.endsWith("\"") || prefix.endsWith("'")
                    || javascriptQuotedPrefix(prefix)) {
                result.append(prefix).append(MASK);
            } else {
                String number = maskJavascriptNumber(value);
                if (number != null) result.append(prefix).append(number);
                else {
                    String bare = maskJavascriptBareValue(prefix, value);
                    result.append(bare == null ? matcher.group() : prefix + bare);
                }
            }
            copied = matcher.end();
        }
        return result.append(xml, copied, xml.length()).toString();
    }

    private static String maskJavascriptNumber(String value) {
        int start = value.startsWith("-") || value.startsWith("+") ? 1 : 0;
        if (start >= value.length() || !Character.isDigit(value.charAt(start))) return null;
        int end = start;
        if (value.regionMatches(true, start, "0x", 0, 2)) {
            end += 2;
            while (end < value.length() && Character.digit(value.charAt(end), 16) >= 0) end++;
        } else {
            while (end < value.length() && Character.isDigit(value.charAt(end))) end++;
            if (end + 1 < value.length() && value.charAt(end) == '.'
                    && Character.isDigit(value.charAt(end + 1))) {
                end++;
                while (end < value.length() && Character.isDigit(value.charAt(end))) end++;
            }
        }
        return "0" + value.substring(end);
    }

    private static String maskJavascriptBareValue(String prefix, String value) {
        int terminator = value.indexOf(';');
        String head = terminator < 0 ? value : value.substring(0, terminator);
        if (head.isBlank() || List.of("new", "await", "yield", "typeof", "delete", "void").contains(head)) {
            return null;
        }
        for (int i = 0; i < head.length(); i++) {
            if ("(){}[]?:+*/\\.,=".indexOf(head.charAt(i)) >= 0) return null;
        }
        boolean colon = prefix.lastIndexOf(':') > prefix.lastIndexOf('=');
        if (colon && head.matches("[A-Za-z_$][A-Za-z0-9_$]*")) return null;
        return "null" + (terminator < 0 ? "" : value.substring(terminator));
    }

    private static int javascriptRegexEnd(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) == '/' && (i == 0 || value.charAt(i - 1) != '\\')) return i;
        }
        return -1;
    }

    private static boolean javascriptQuotedPrefix(String prefix) {
        if (prefix.isEmpty()) return false;
        char quote = prefix.charAt(0);
        if (quote != '\'' && quote != '"') return false;
        int count = 0;
        for (int i = 0; i < prefix.length(); i++) if (prefix.charAt(i) == quote) count++;
        return (count & 1) != 0;
    }

    private static final class JavascriptLexState {
        private char quote;
        private boolean escaped;
        private boolean lineComment;
        private boolean blockComment;
        private final ArrayDeque<Integer> templateDepths = new ArrayDeque<>();

        boolean quotedOrCommented() { return quote != 0 || lineComment || blockComment; }

        void advance(String value, int from, int to) {
            for (int i = from; i < to; i++) {
                char c = value.charAt(i);
                char next = i + 1 < to ? value.charAt(i + 1) : 0;
                if (lineComment) {
                    if (c == '\n' || c == '\r') lineComment = false;
                } else if (blockComment) {
                    if (c == '*' && next == '/') { blockComment = false; i++; }
                } else if (quote != 0) {
                    if (escaped) escaped = false;
                    else if (c == '\\') escaped = true;
                    else if (quote == '`' && c == '$' && next == '{') {
                        quote = 0;
                        templateDepths.push(1);
                        i++;
                    }
                    else if (c == quote) quote = 0;
                } else if (c == '/' && next == '/') {
                    lineComment = true;
                    i++;
                } else if (c == '/' && next == '*') {
                    blockComment = true;
                    i++;
                } else if (!templateDepths.isEmpty() && c == '{') {
                    templateDepths.push(templateDepths.pop() + 1);
                } else if (!templateDepths.isEmpty() && c == '}') {
                    int depth = templateDepths.pop() - 1;
                    if (depth == 0) quote = '`';
                    else templateDepths.push(depth);
                } else if (c == '\'' || c == '"' || c == '`') {
                    quote = c;
                }
            }
        }
    }

    /** 쿠키는 이름만 남기고 값을 가린다(세션 식별은 fp 해시가 담당). */
    private static String maskCookieValues(String cookieLine) {
        StringBuilder sb = new StringBuilder();
        for (String part : cookieLine.split(";")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            int eq = p.indexOf('=');
            if (sb.length() > 0) sb.append("; ");
            sb.append(eq > 0 ? p.substring(0, eq) + "=***" : p);
        }
        return sb.toString();
    }

    private static String maskJson(String value) {
        try {
            JsonNode root = JSON.readTree(value);
            if (root == null) return value;
            maskJsonNode(root);
            return JSON.writeValueAsString(root);
        } catch (Exception ignored) {
            return containsSecretLabel(value) ? REDACTED : SECRET_FIELD.matcher(value)
                    .replaceAll(Masking::secretFieldReplacement);
        }
    }

    private static void maskJsonNode(JsonNode node) {
        if (node instanceof ObjectNode object) {
            List<String> names = new ArrayList<>();
            object.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                if (isSecretKey(name)) object.put(name, MASK);
                else if (object.get(name).isTextual()) object.put(name, maskPlainText(object.get(name).textValue()));
                else maskJsonNode(object.get(name));
            }
        } else if (node instanceof ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                if (array.get(i).isTextual()) array.set(i, JSON.getNodeFactory().textNode(maskPlainText(array.get(i).textValue())));
                else maskJsonNode(array.get(i));
            }
        }
    }

    private static String maskPlainText(String value) {
        String xml = XML_SECRET.matcher(value).replaceAll(m -> m.group(1) + MASK + m.group(4));
        return SECRET_FIELD.matcher(xml).replaceAll(Masking::secretFieldReplacement);
    }

    private static String maskForm(String body) {
        String[] fields = body.split("&", -1);
        for (int i = 0; i < fields.length; i++) {
            int equals = fields[i].indexOf('=');
            if (equals <= 0) continue;
            String key = decode(fields[i].substring(0, equals));
            if (isSecretKey(key)) fields[i] = fields[i].substring(0, equals + 1) + MASK;
        }
        return String.join("&", fields);
    }

    private static String maskMultipart(String body, String contentType) {
        var matcher = BOUNDARY.matcher(contentType == null ? "" : contentType);
        if (!matcher.find()) return containsSecretLabel(body) ? REDACTED : maskSecrets(body);
        String boundary = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
        String delimiter = "--" + boundary;
        String[] parts = body.split(Pattern.quote(delimiter), -1);
        StringBuilder out = new StringBuilder(parts[0]);
        for (int i = 1; i < parts.length; i++) {
            String part = parts[i];
            int separator = headerSeparator(part);
            if (separator >= 0) {
                String headers = part.substring(0, separator);
                var name = PART_NAME.matcher(headers);
                if (name.find() && isSecretKey(name.group(1))) {
                    int separatorLength = part.startsWith("\r\n\r\n", separator) ? 4 : 2;
                    String ending = part.endsWith("\r\n") ? "\r\n" : part.endsWith("\n") ? "\n" : "";
                    part = headers + part.substring(separator, separator + separatorLength) + MASK + ending;
                }
            }
            out.append(delimiter).append(part);
        }
        return out.toString();
    }

    private static boolean containsSecretLabel(String value) {
        String lower = value == null ? "" : value.toLowerCase(Locale.ROOT);
        return lower.matches("(?s).*(password|passwd|pwd|token|secret|api[_-]?key|authorization).*[:=\"].*");
    }

    private static boolean isSecretKey(String value) {
        if (value == null) return false;
        String key = value.toLowerCase(Locale.ROOT).replace("-", "_");
        return key.equals("password") || key.equals("passwd") || key.equals("pass") || key.equals("pwd")
                || key.equals("token") || key.equals("secret") || key.equals("client_secret")
                || key.equals("api_key") || key.equals("access_token") || key.equals("refresh_token")
                || key.equals("id_token") || key.equals("session_token") || key.equals("authorization");
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, StandardCharsets.UTF_8); }
        catch (IllegalArgumentException ignored) { return value; }
    }

    private static int headerSeparator(String value) {
        int windows = value.indexOf("\r\n\r\n");
        if (windows >= 0) return windows;
        return value.indexOf("\n\n");
    }

    private static String headerValue(Pattern pattern, String headers) {
        var matcher = pattern.matcher(headers == null ? "" : headers);
        return matcher.find() ? matcher.group(1).trim() : "";
    }

    /** 필요 이상으로 큰 본문은 잘라 메모리 폭증을 막는다. */
    public static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max) + "…(truncated)";
    }
}
