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

    /** route discovery가 읽는 media type. 이 값들만 분석·보존 상한을 넓힌다. */
    private static final int DISCOVERY_PAYLOAD_BYTES = Integer.getInteger(
            "flowscope.payload.discoveryBytes", 4 * 1024 * 1024);

    private BoundedHttpCapture() {}

    /**
     * route discovery가 읽을 수 있는 크기까지 분석 preview를 넓힌다.
     */
    static int previewLimitFor(String contentType, int defaultPreviewLimit) {
        String media = contentType == null ? "" : contentType.toLowerCase(java.util.Locale.ROOT);
        int cut = media.indexOf(';');
        if (cut >= 0) media = media.substring(0, cut);
        media = media.trim();
        boolean discovery = media.contains("javascript") || media.contains("ecmascript")
                || media.contains("json") || media.contains("html") || media.contains("xml");
        return discovery ? Math.max(defaultPreviewLimit, DISCOVERY_PAYLOAD_BYTES) : defaultPreviewLimit;
    }

    /**
     * JavaScript·HTML·OpenAPI 문서는 후반부 call-site까지 분석하려면 retained payload가 필요하다.
     * 그 외 본문과 discovery 상한 초과 본문은 기존 metadata-only 계약을 유지한다.
     */
    static int retainedLimitFor(String contentType, int defaultRetainedLimit) {
        return Math.max(defaultRetainedLimit, previewLimitFor(contentType, defaultRetainedLimit));
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
