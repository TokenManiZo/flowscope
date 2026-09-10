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
    void 발견용_스크립트는_기본상한을_넘겨도_분석가능한_전문을_보존한다() {
        // 일반 회귀: 작은 UI preview 뒤에 있는 call-site도 discovery payload에는 남아야 한다.
        String headers = "HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\n\r\n";
        String script = "var pad=\"" + "y".repeat(1_400_000) + "\";fetch('/api/v2/posts');";
        byte[] message = (headers + script).getBytes(StandardCharsets.UTF_8);

        BoundedHttpCapture.Result result = BoundedHttpCapture.capture(message,
                headers.getBytes(StandardCharsets.UTF_8).length, "application/javascript",
                BoundedHttpCapture.retainedLimitFor("application/javascript", 1024 * 1024),
                BoundedHttpCapture.previewLimitFor("application/javascript", 64 * 1024));

        assertTrue(result.complete());
        assertEquals(StoredPayload.Retention.FULL, result.payload().retention());
        assertTrue(result.payload().text().contains("/api/v2/posts"));
        assertTrue(result.decoded().text().contains("/api/v2/posts"),
                "분석문이 1MB 이후 call site를 담지 못함");
    }

    @Test
    void 발견과_무관한_미디어는_프리뷰_상한이_그대로다() {
        assertEquals(64 * 1024, BoundedHttpCapture.previewLimitFor("text/css", 64 * 1024));
        assertEquals(64 * 1024, BoundedHttpCapture.previewLimitFor("image/png", 64 * 1024));
        assertEquals(64 * 1024, BoundedHttpCapture.previewLimitFor(null, 64 * 1024));
        assertTrue(BoundedHttpCapture.previewLimitFor("application/json", 64 * 1024) > 64 * 1024);
        assertTrue(BoundedHttpCapture.previewLimitFor("text/html; charset=utf-8", 64 * 1024) > 64 * 1024);
        assertEquals(64 * 1024 * 1024,
                BoundedHttpCapture.retainedLimitFor("application/javascript", 1024 * 1024));
        assertEquals(1024 * 1024,
                BoundedHttpCapture.retainedLimitFor("image/png", 1024 * 1024));
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
