package io.flowscope.burp;

import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

final class HttpMessageTextCodecTest {
    @Test
    void decodesJsonBodyAsUtf8WithoutCorruptingHangulOrEmoji() {
        String headers = "POST /posts HTTP/1.1\r\nContent-Type: application/json\r\n\r\n";
        String body = "{\"title\":\"한글 🧪\"}";
        byte[] message = concat(headers.getBytes(StandardCharsets.ISO_8859_1), body.getBytes(StandardCharsets.UTF_8));

        HttpMessageTextCodec.Decoded decoded = HttpMessageTextCodec.decode(message,
                headers.getBytes(StandardCharsets.ISO_8859_1).length, "application/json");

        assertTrue(decoded.editable());
        assertEquals("UTF-8", decoded.charset());
        assertEquals(headers + body, decoded.text());
    }

    @Test
    void honorsAnExplicitLegacyCharset() {
        Charset eucKr = Charset.forName("EUC-KR");
        String headers = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=EUC-KR\r\n\r\n";
        byte[] message = concat(headers.getBytes(StandardCharsets.ISO_8859_1), "한글".getBytes(eucKr));

        HttpMessageTextCodec.Decoded decoded = HttpMessageTextCodec.decode(message,
                headers.getBytes(StandardCharsets.ISO_8859_1).length, "text/plain; charset=EUC-KR");

        assertTrue(decoded.editable());
        assertEquals("EUC-KR", decoded.charset());
        assertTrue(decoded.text().endsWith("한글"));
    }

    @Test
    void invalidJsonUtf8IsNotSilentlyReplacedOrEditable() {
        String headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n";
        byte[] message = concat(headers.getBytes(StandardCharsets.ISO_8859_1), new byte[]{(byte) 0xC3, 0x28});

        HttpMessageTextCodec.Decoded decoded = HttpMessageTextCodec.decode(message,
                headers.getBytes(StandardCharsets.ISO_8859_1).length, "application/json");

        assertFalse(decoded.editable());
        assertFalse(decoded.text().contains("\uFFFD"));
        assertTrue(decoded.note().contains("디코딩"));
    }

    @Test
    void binaryBodyIsNeverPresentedAsEditableText() {
        String headers = "POST /upload HTTP/1.1\r\nContent-Type: application/octet-stream\r\n\r\n";
        byte[] message = concat(headers.getBytes(StandardCharsets.ISO_8859_1), new byte[]{0, 1, 2, 3});

        HttpMessageTextCodec.Decoded decoded = HttpMessageTextCodec.decode(message,
                headers.getBytes(StandardCharsets.ISO_8859_1).length, "application/octet-stream");

        assertFalse(decoded.editable());
        assertTrue(decoded.note().contains("바이너리"));
    }

    @Test
    void encodesEditedJsonBodyAsUtf8AndKeepsHeadersByteStable() {
        String edited = "POST /posts HTTP/1.1\r\nHost: example.test\r\n"
                + "Content-Type: application/json\r\n\r\n{\"title\":\"한글 🧪\"}";

        byte[] encoded = HttpMessageTextCodec.encodeEditedRequest(edited);
        int offset = indexAfterHeader(encoded);
        assertEquals(edited.substring(0, edited.indexOf('{')),
                new String(encoded, 0, offset, StandardCharsets.ISO_8859_1));
        assertEquals("{\"title\":\"한글 🧪\"}", new String(encoded, offset, encoded.length - offset,
                StandardCharsets.UTF_8));
    }

    @Test
    void editedTextareaRequestUsesCrLfHeadersWithoutChangingBodyNewlines() {
        String body = "note=first\nsecond";
        String edited = "POST /items?id=test HTTP/1.1\nHost: example.test\n"
                + "Content-Type: application/x-www-form-urlencoded\n"
                + "Content-Length: " + body.getBytes(StandardCharsets.UTF_8).length + "\n\n" + body;

        byte[] encoded = HttpMessageTextCodec.encodeEditedRequest(edited);
        int offset = indexAfterHeader(encoded);
        String headers = new String(encoded, 0, offset, StandardCharsets.ISO_8859_1);
        assertEquals("POST /items?id=test HTTP/1.1\r\nHost: example.test\r\n"
                + "Content-Type: application/x-www-form-urlencoded\r\n"
                + "Content-Length: 17\r\n\r\n", headers);
        assertArrayEquals(body.getBytes(StandardCharsets.UTF_8),
                java.util.Arrays.copyOfRange(encoded, offset, encoded.length));
    }

    private static int indexAfterHeader(byte[] bytes) {
        for (int i = 0; i <= bytes.length - 4; i++) {
            if (bytes[i] == '\r' && bytes[i + 1] == '\n' && bytes[i + 2] == '\r' && bytes[i + 3] == '\n') {
                return i + 4;
            }
        }
        fail("header separator missing");
        return -1;
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] result = new byte[first.length + second.length];
        System.arraycopy(first, 0, result, 0, first.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }
}
