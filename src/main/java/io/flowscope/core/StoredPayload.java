package io.flowscope.core;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Masked request/response text retained independently from the small UI preview.
 * Binary and over-budget payloads keep size and digest metadata instead of being silently truncated.
 */
public final class StoredPayload {
    public enum Retention {
        FULL,
        BINARY_METADATA_ONLY,
        OVER_LIMIT_METADATA_ONLY,
        CAPACITY_METADATA_ONLY
    }

    private static final Set<String> TEXT_PREFIXES = Set.of("text/");
    private final String digest;
    private final int originalBytes;
    private final Retention retention;
    private final byte[] gzip;

    private StoredPayload(String digest, int originalBytes, Retention retention, byte[] gzip) {
        this.digest = digest;
        this.originalBytes = originalBytes;
        this.retention = retention;
        this.gzip = gzip == null ? null : Arrays.copyOf(gzip, gzip.length);
    }

    public static StoredPayload capture(String maskedText, String contentType, int maxBytes) {
        if (maskedText == null) return null;
        byte[] plain = maskedText.getBytes(StandardCharsets.UTF_8);
        String digest = sha256(plain);
        if (!isTextual(contentType, maskedText)) {
            return new StoredPayload(digest, plain.length, Retention.BINARY_METADATA_ONLY, null);
        }
        if (plain.length > maxBytes) {
            return new StoredPayload(digest, plain.length, Retention.OVER_LIMIT_METADATA_ONLY, null);
        }
        return new StoredPayload(digest, plain.length, Retention.FULL, gzip(plain));
    }

    public static StoredPayload restore(String digest, int originalBytes, Retention retention, String gzipBase64) {
        return restore(digest, originalBytes, retention, gzipBase64, Integer.MAX_VALUE);
    }

    public static StoredPayload restore(String digest, int originalBytes, Retention retention, String gzipBase64,
                                        int maxPlainBytes) {
        if (originalBytes < 0 || maxPlainBytes < 0 || originalBytes > maxPlainBytes) {
            throw new IllegalArgumentException("payload size exceeds restore limit");
        }
        long maxCompressedBytes = Math.min((long) Integer.MAX_VALUE,
                (long) maxPlainBytes + 64L * 1024L);
        long maxBase64Chars = ((maxCompressedBytes + 2L) / 3L) * 4L;
        if (gzipBase64 != null && gzipBase64.length() > maxBase64Chars) {
            throw new IllegalArgumentException("compressed payload exceeds restore limit");
        }
        byte[] compressed = gzipBase64 == null || gzipBase64.isBlank()
                ? null : Base64.getDecoder().decode(gzipBase64);
        if (compressed != null && compressed.length > maxCompressedBytes) {
            throw new IllegalArgumentException("compressed payload exceeds restore limit");
        }
        if (retention == Retention.FULL && compressed == null) {
            throw new IllegalArgumentException("FULL payload requires compressed bytes");
        }
        if (retention != Retention.FULL && compressed != null) {
            throw new IllegalArgumentException("metadata-only payload must not contain compressed bytes");
        }
        StoredPayload value = new StoredPayload(digest, originalBytes, retention, compressed);
        if (value.retained()) {
            byte[] plain = value.plainBytes(maxPlainBytes);
            if (!sha256(plain).equals(digest) || plain.length != originalBytes) {
                throw new IllegalArgumentException("payload digest or size mismatch");
            }
        }
        return value;
    }

    /** 문자열로 안전하게 표현할 수 없는 가져오기 payload의 byte 크기와 digest만 보존한다. */
    public static StoredPayload metadataOnly(byte[] bytes, Retention reason) {
        return metadataOnly(bytes, bytes == null ? 0 : bytes.length, reason);
    }

    public static StoredPayload metadataOnly(String digest, int originalBytes, Retention reason) {
        if (digest == null || !digest.matches("[0-9a-f]{64}") || originalBytes < 0
                || reason == null || reason == Retention.FULL) {
            throw new IllegalArgumentException("metadata-only digest, size and reason required");
        }
        return new StoredPayload(digest, originalBytes, reason, null);
    }

    /** 마스킹된 제한 미리보기의 digest와 실제 메시지 크기만 보존한다. */
    public static StoredPayload metadataOnly(byte[] maskedBytes, int originalBytes, Retention reason) {
        if (reason == null || reason == Retention.FULL || maskedBytes == null || originalBytes < 0) {
            throw new IllegalArgumentException("metadata-only bytes and reason required");
        }
        return new StoredPayload(sha256(maskedBytes), originalBytes, reason, null);
    }

    /** 제한 미리보기·실제 크기·보존 사유를 함께 묶어 같은 접두부의 대형 메시지를 구분한다. */
    public static StoredPayload previewMetadataOnly(byte[] maskedPreview, int originalBytes, Retention reason) {
        if (reason == null || reason == Retention.FULL || maskedPreview == null || originalBytes < 0) {
            throw new IllegalArgumentException("metadata-only preview, size and reason required");
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update("flowscope-preview-v1".getBytes(StandardCharsets.US_ASCII));
            digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(originalBytes).array());
            byte[] reasonBytes = reason.name().getBytes(StandardCharsets.US_ASCII);
            digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(reasonBytes.length).array());
            digest.update(reasonBytes);
            digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(maskedPreview.length).array());
            digest.update(maskedPreview);
            return new StoredPayload(hex(digest.digest()), originalBytes, reason, null);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    public String digest() { return digest; }
    public int originalBytes() { return originalBytes; }
    public Retention retention() { return retention; }
    public boolean retained() { return retention == Retention.FULL; }
    public int compressedBytes() { return gzip == null ? 0 : gzip.length; }
    public String gzipBase64() { return gzip == null ? null : Base64.getEncoder().encodeToString(gzip); }

    public StoredPayload metadataOnly(Retention reason) {
        if (reason == Retention.FULL) throw new IllegalArgumentException("metadata-only reason required");
        return new StoredPayload(digest, originalBytes, reason, null);
    }

    public String text() {
        if (!retained()) return null;
        return new String(plainBytes(originalBytes), StandardCharsets.UTF_8);
    }

    public String preview(int maxChars) {
        String text = text();
        return text == null ? null : Masking.truncate(text, maxChars);
    }

    private static boolean isTextual(String contentType, String value) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        int semicolon = type.indexOf(';');
        if (semicolon >= 0) type = type.substring(0, semicolon).trim();
        if (TEXT_PREFIXES.stream().anyMatch(type::startsWith)
                || type.contains("json") || type.contains("xml") || type.contains("javascript")
                || type.contains("graphql") || type.contains("x-www-form-urlencoded")
                || type.contains("multipart/form-data")) return true;
        if (!type.isBlank()) return false;
        String trimmed = value.stripLeading();
        return trimmed.startsWith("HTTP/") || trimmed.matches("(?s)^[A-Z]+\\s+\\S+\\s+HTTP/.*");
    }

    private static byte[] gzip(byte[] plain) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (GZIPOutputStream gzip = new GZIPOutputStream(output)) { gzip.write(plain); }
            return output.toByteArray();
        } catch (IOException error) {
            throw new IllegalStateException("gzip unavailable", error);
        }
    }

    private byte[] plainBytes(int maxBytes) {
        if (!retained()) return null;
        if (originalBytes < 0 || originalBytes > maxBytes) {
            throw new IllegalArgumentException("payload size exceeds restore limit");
        }
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(gzip));
             ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(originalBytes, 64 * 1024))) {
            byte[] buffer = new byte[8192];
            int total = 0;
            for (int read; (read = input.read(buffer)) >= 0;) {
                if (read == 0) continue;
                total += read;
                if (total > maxBytes || total > originalBytes) {
                    throw new IllegalArgumentException("decompressed payload exceeds declared limit");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } catch (IOException error) {
            throw new IllegalStateException("stored payload is corrupt", error);
        }
    }

    private static String sha256(byte[] value) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private static String hex(byte[] digest) {
        StringBuilder out = new StringBuilder(digest.length * 2);
        for (byte b : digest) out.append(String.format("%02x", b));
        return out.toString();
    }
}
