package io.flowscope.burp;

import burp.api.montoya.core.ByteArray;
import io.flowscope.core.Masking;
import io.flowscope.core.StoredPayload;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Builds the analysis preview without materializing an unbounded Montoya message. */
final class BoundedHttpCapture {
    record Result(HttpMessageTextCodec.Decoded decoded, String maskedText,
                  StoredPayload payload, int originalBytes, boolean complete) {}

    /** route discovery가 읽는 media type. 이 값들만 분석문을 길게 남긴다. */
    private static final int DISCOVERY_PREVIEW_BYTES = Integer.getInteger(
            "flowscope.payload.discoveryPreviewBytes", 4 * 1024 * 1024);

    private BoundedHttpCapture() {}

    /**
     * 보존 상한(retainedPayloadLimit)은 그대로 두고, route discovery가 읽는 분석문만 넓힌다.
     * 초과 응답은 여전히 metadata-only로 남으므로 "전문 보존"을 주장하지 않는다.
     */
    static int previewLimitFor(String contentType, int defaultPreviewLimit) {
        String media = contentType == null ? "" : contentType.toLowerCase(java.util.Locale.ROOT);
        int cut = media.indexOf(';');
        if (cut >= 0) media = media.substring(0, cut);
        media = media.trim();
        boolean discovery = media.contains("javascript") || media.contains("ecmascript")
                || media.contains("json") || media.contains("html") || media.contains("xml");
        return discovery ? Math.max(defaultPreviewLimit, DISCOVERY_PREVIEW_BYTES) : defaultPreviewLimit;
    }

    static Result capture(ByteArray message, int bodyOffset, String contentType,
                          int retainedPayloadLimit, int previewLimit) {
        if (message == null) return new Result(
                new HttpMessageTextCodec.Decoded(null, false, null, "원문이 없습니다."),
                null, null, 0, true);
        if (retainedPayloadLimit < 0 || previewLimit < 1) {
            throw new IllegalArgumentException("capture limits are invalid");
        }
        int originalBytes = message.length();
        boolean complete = originalBytes <= retainedPayloadLimit;
        int copiedBytes = complete ? originalBytes : Math.min(originalBytes, previewLimit);
        byte[] bounded = copiedBytes == originalBytes
                ? message.getBytes() : message.subArray(0, copiedBytes).getBytes();
        return captured(bounded, bodyOffset, contentType, retainedPayloadLimit, originalBytes, complete);
    }

    static Result capture(byte[] message, int bodyOffset, String contentType,
                          int retainedPayloadLimit, int previewLimit) {
        if (message == null) return capture((ByteArray) null, bodyOffset, contentType,
                retainedPayloadLimit, previewLimit);
        if (retainedPayloadLimit < 0 || previewLimit < 1) {
            throw new IllegalArgumentException("capture limits are invalid");
        }
        int originalBytes = message.length;
        boolean complete = originalBytes <= retainedPayloadLimit;
        int copiedBytes = complete ? originalBytes : Math.min(originalBytes, previewLimit);
        byte[] bounded = copiedBytes == originalBytes ? message.clone() : Arrays.copyOf(message, copiedBytes);
        return captured(bounded, bodyOffset, contentType, retainedPayloadLimit, originalBytes, complete);
    }

    private static Result captured(byte[] bounded, int bodyOffset, String contentType,
                                   int retainedPayloadLimit, int originalBytes, boolean complete) {
        HttpMessageTextCodec.Decoded decoded = HttpMessageTextCodec.decode(
                bounded, Math.min(bodyOffset, bounded.length), contentType);
        String masked = Masking.maskHeaders(decoded.text());
        StoredPayload payload;
        if (complete && decoded.editable()) {
            payload = StoredPayload.capture(masked, contentType, retainedPayloadLimit);
        } else if (complete && HttpMessageTextCodec.isBinary(contentType)) {
            payload = StoredPayload.metadataOnly(bounded, originalBytes,
                    StoredPayload.Retention.BINARY_METADATA_ONLY);
        } else {
            StoredPayload.Retention reason = HttpMessageTextCodec.isBinary(contentType)
                    ? StoredPayload.Retention.BINARY_METADATA_ONLY
                    : StoredPayload.Retention.OVER_LIMIT_METADATA_ONLY;
            payload = StoredPayload.previewMetadataOnly(
                    masked == null ? new byte[0] : masked.getBytes(StandardCharsets.UTF_8),
                    originalBytes, reason);
        }
        return new Result(decoded, masked, payload, originalBytes, complete);
    }
}
