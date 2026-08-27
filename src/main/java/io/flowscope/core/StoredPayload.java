package io.flowscope.core;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
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
        byte[] compressed = gzipBase64 == null || gzipBase64.isBlank()
                ? null : Base64.getDecoder().decode(gzipBase64);
        if (retention == Retention.FULL && compressed == null) {
            throw new IllegalArgumentException("FULL payload requires compressed bytes");
        }
        StoredPayload value = new StoredPayload(digest, originalBytes, retention, compressed);
        if (value.retained()) {
            byte[] plain = value.text().getBytes(StandardCharsets.UTF_8);
            if (!sha256(plain).equals(digest) || plain.length != originalBytes) {
                throw new IllegalArgumentException("payload digest or size mismatch");
            }
        }
        return value;
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
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(gzip))) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new IllegalStateException("stored payload is corrupt", error);
        }
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

    private static String sha256(byte[] value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}
