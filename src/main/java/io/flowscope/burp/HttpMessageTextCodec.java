package io.flowscope.burp;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Byte-preserving HTTP message bridge for the Web request lab. */
final class HttpMessageTextCodec {
    record Decoded(String text, boolean editable, String charset, String note) {}

    private static final Pattern CHARSET = Pattern.compile("(?i)(?:^|;)\\s*charset\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|([^;\\s]+))");
    private static final String UNAVAILABLE = "[본문을 텍스트로 안전하게 표시할 수 없습니다]";

    private HttpMessageTextCodec() {}

    static Decoded decode(byte[] message, int bodyOffset, String contentType) {
        if (message == null) return new Decoded(null, false, null, "원문이 보존되지 않았습니다.");
        int offset = Math.max(0, Math.min(bodyOffset, message.length));
        String headers = new String(message, 0, offset, StandardCharsets.ISO_8859_1);
        int bodyLength = message.length - offset;
        if (bodyLength == 0) return new Decoded(headers, true, null, "본문 없음");
        if (isBinary(contentType)) {
            String note = "바이너리 본문 " + bodyLength + "바이트는 텍스트 편집하지 않습니다.";
            return new Decoded(headers + UNAVAILABLE, false, null, note);
        }
        Charset charset;
        try {
            charset = charsetFor(contentType);
        } catch (IllegalArgumentException error) {
            String note = "지원하지 않는 문자셋이라 본문을 디코딩하지 않았습니다: " + error.getMessage();
            return new Decoded(headers + UNAVAILABLE, false, null, note);
        }
        try {
            String body = decodeStrict(message, offset, bodyLength, charset);
            if (!isTextual(contentType) && !looksTextual(body)) {
                String note = "텍스트로 확인되지 않은 본문 " + bodyLength + "바이트는 편집하지 않습니다.";
                return new Decoded(headers + UNAVAILABLE, false, charset.name(), note);
            }
            return new Decoded(headers + body, true, charset.name(), charset.name() + "로 디코딩했습니다.");
        } catch (CharacterCodingException error) {
            String note = charset.name() + " 디코딩 오류로 원문 바이트를 보존하고 텍스트 편집을 차단했습니다.";
            return new Decoded(headers + UNAVAILABLE, false, charset.name(), note);
        }
    }

    static byte[] encodeEditedRequest(String requestText) {
        if (requestText == null || requestText.isBlank()) {
            throw new IllegalArgumentException("전송할 HTTP 요청 전문이 필요합니다.");
        }
        int separator = requestText.indexOf("\r\n\r\n");
        int separatorLength = 4;
        if (separator < 0) {
            separator = requestText.indexOf("\n\n");
            separatorLength = 2;
        }
        String headerText = separator < 0 ? requestText : requestText.substring(0, separator + separatorLength);
        String bodyText = separator < 0 ? "" : requestText.substring(separator + separatorLength);
        byte[] headers = encodeHeaders(headerText);
        if (bodyText.isEmpty()) return headers;
        String contentType = contentType(headerText);
        if (isBinary(contentType)) {
            throw new IllegalArgumentException("바이너리 Content-Type 본문은 Web 텍스트 편집기로 재인코딩할 수 없습니다. Burp Repeater를 사용하세요.");
        }
        Charset charset = charsetFor(contentType);
        byte[] body = encodeBody(bodyText, charset);
        ByteArrayOutputStream output = new ByteArrayOutputStream(headers.length + body.length);
        output.writeBytes(headers);
        output.writeBytes(body);
        return output.toByteArray();
    }

    static String contentType(String messageHeaders) {
        if (messageHeaders == null) return null;
        for (String line : messageHeaders.split("\\r?\\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Type")) {
                String value = line.substring(colon + 1).trim();
                return value.isEmpty() ? null : value;
            }
        }
        return null;
    }

    private static Charset charsetFor(String contentType) {
        if (contentType != null) {
            Matcher matcher = CHARSET.matcher(contentType);
            if (matcher.find()) {
                String value = matcher.group(1) != null ? matcher.group(1)
                        : matcher.group(2) != null ? matcher.group(2) : matcher.group(3);
                try {
                    return Charset.forName(value.trim());
                } catch (RuntimeException error) {
                    throw new IllegalArgumentException(value.trim());
                }
            }
        }
        return StandardCharsets.UTF_8;
    }

    private static byte[] encodeHeaders(String headers) {
        var encoder = StandardCharsets.ISO_8859_1.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            ByteBuffer encoded = encoder.encode(CharBuffer.wrap(headers));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException("HTTP 시작줄·헤더에는 ISO-8859-1 밖의 문자를 넣을 수 없습니다.");
        }
    }

    private static byte[] encodeBody(String body, Charset charset) {
        var encoder = charset.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            ByteBuffer encoded = encoder.encode(CharBuffer.wrap(body));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException(charset.name() + "로 표현할 수 없는 본문 문자가 있습니다.");
        }
    }

    private static String decodeStrict(byte[] bytes, int offset, int length, Charset charset)
            throws CharacterCodingException {
        return charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, offset, length)).toString();
    }

    private static boolean isTextual(String contentType) {
        if (contentType == null || contentType.isBlank()) return false;
        String media = contentType.toLowerCase(Locale.ROOT).split(";", 2)[0].trim();
        return media.startsWith("text/") || media.equals("application/json") || media.endsWith("+json")
                || media.equals("application/xml") || media.endsWith("+xml")
                || media.equals("application/x-www-form-urlencoded") || media.equals("application/graphql")
                || media.equals("application/javascript") || media.equals("application/problem+json");
    }

    private static boolean isBinary(String contentType) {
        if (contentType == null || contentType.isBlank()) return false;
        String media = contentType.toLowerCase(Locale.ROOT).split(";", 2)[0].trim();
        return media.startsWith("image/") || media.startsWith("audio/") || media.startsWith("video/")
                || media.startsWith("font/") || media.equals("application/octet-stream")
                || media.equals("application/pdf") || media.equals("application/zip")
                || media.equals("application/gzip") || media.contains("protobuf") || media.contains("msgpack");
    }

    private static boolean looksTextual(String value) {
        if (value.isEmpty()) return true;
        int controls = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == 0 || (c < 0x20 && c != '\r' && c != '\n' && c != '\t')) controls++;
        }
        return controls * 20 <= value.length();
    }
}
