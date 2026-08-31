package io.flowscope.burp;

import io.flowscope.core.StoredPayload;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

final class BoundedHttpCaptureTest {
    @Test
    void oversizedTextCopiesOnlyPreviewAndKeepsSizeMetadata() {
        String headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                + "Set-Cookie: sid=secret-session\r\n\r\n";
        byte[] message = (headers + "{\"items\":\"" + "x".repeat(2 * 1024 * 1024) + "\"}")
                .getBytes(StandardCharsets.UTF_8);

        BoundedHttpCapture.Result result = BoundedHttpCapture.capture(message,
                headers.getBytes(StandardCharsets.UTF_8).length, "application/json", 1024 * 1024, 64 * 1024);

        assertFalse(result.complete());
        assertEquals(message.length, result.originalBytes());
        assertEquals(StoredPayload.Retention.OVER_LIMIT_METADATA_ONLY, result.payload().retention());
        assertEquals(message.length, result.payload().originalBytes());
        assertTrue(result.decoded().text().length() <= 64 * 1024);
        assertFalse(result.maskedText().contains("secret-session"));
        assertNull(result.payload().text());
    }

    @Test
    void oversizedBinaryIsMetadataOnly() {
        byte[] message = new byte[2 * 1024 * 1024];

        BoundedHttpCapture.Result result = BoundedHttpCapture.capture(message,
                0, "application/octet-stream", 1024 * 1024, 64 * 1024);

        assertEquals(StoredPayload.Retention.BINARY_METADATA_ONLY, result.payload().retention());
        assertEquals(message.length, result.payload().originalBytes());
        assertFalse(result.payload().retained());
    }

    @Test
    void samePreviewWithDifferentActualSizesHasDifferentDigest() {
        byte[] first = new byte[2 * 1024 * 1024];
        byte[] second = new byte[3 * 1024 * 1024];

        BoundedHttpCapture.Result firstResult = BoundedHttpCapture.capture(
                first, 0, "application/octet-stream", 1024 * 1024, 64 * 1024);
        BoundedHttpCapture.Result secondResult = BoundedHttpCapture.capture(
                second, 0, "application/octet-stream", 1024 * 1024, 64 * 1024);

        assertNotEquals(firstResult.payload().digest(), secondResult.payload().digest());
    }
}
