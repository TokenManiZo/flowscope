package io.flowscope;

import io.flowscope.core.StoredPayload;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class StoredPayloadTest {
    @Test
    void 마스킹된_텍스트를_압축해_원문으로_복원한다() {
        String value = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n"
                + "{\"items\":[" + "{\"id\":1},".repeat(2_000) + "]}";

        StoredPayload payload = StoredPayload.capture(value, "application/json", 1024 * 1024);

        assertNotNull(payload);
        assertTrue(payload.retained());
        assertEquals(value, payload.text());
        assertEquals(value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length, payload.originalBytes());
        assertEquals(64, payload.digest().length());
    }

    @Test
    void 상한초과와_바이너리는_조용히_자르지_않고_메타데이터를_남긴다() {
        StoredPayload large = StoredPayload.capture("x".repeat(100), "application/json", 16);
        StoredPayload binary = StoredPayload.capture("binary", "image/png", 1024);

        assertEquals(StoredPayload.Retention.OVER_LIMIT_METADATA_ONLY, large.retention());
        assertEquals(100, large.originalBytes());
        assertNull(large.text());
        assertEquals(StoredPayload.Retention.BINARY_METADATA_ONLY, binary.retention());
        assertNull(binary.text());
    }

    @Test
    void 복원시_변조된_blob을_거부한다() {
        StoredPayload payload = StoredPayload.capture("hello", "text/plain", 100);

        assertThrows(IllegalArgumentException.class, () -> StoredPayload.restore(
                "0".repeat(64), payload.originalBytes(), payload.retention(), payload.gzipBase64()));
    }

    @Test
    void 압축전문_총량상한에서는_동일한_크기와_해시만_남긴다() {
        StoredPayload full = StoredPayload.capture("hello", "text/plain", 100);

        StoredPayload metadata = full.metadataOnly(StoredPayload.Retention.CAPACITY_METADATA_ONLY);

        assertFalse(metadata.retained());
        assertEquals(0, metadata.compressedBytes());
        assertEquals(full.originalBytes(), metadata.originalBytes());
        assertEquals(full.digest(), metadata.digest());
        assertEquals(StoredPayload.Retention.CAPACITY_METADATA_ONLY, metadata.retention());
    }
}
