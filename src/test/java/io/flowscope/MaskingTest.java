package io.flowscope;

import io.flowscope.core.Masking;
import io.flowscope.core.parameter.ParameterKey;
import io.flowscope.core.parameter.ParameterObservation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class MaskingTest {
    @Test
    void sensitiveParameterSegmentsMatchCaseEncodingAndCompoundNames() {
        for (String path : new String[]{"/Authorization", "/Cookie", "/proxy-authorization", "/password", "/passwd",
                "/secret", "/token", "/csrf", "/session", "/api-key", "/credential", "/accessToken",
                "/client_secret", "/apiKey", "/filter/password/value", "/%74oken", "/x~1token", "/@password"}) {
            assertTrue(Masking.isSensitiveParameterPath(path), path);
        }
        for (String path : new String[]{"/keyword", "/tokenizer", "/items/*/product_id", "/monkey", "/sort"}) {
            assertFalse(Masking.isSensitiveParameterPath(path), path);
        }
    }

    @Test
    void observationsCannotBypassSensitivePathRejection() {
        ParameterKey key = key("/token");
        assertThrows(IllegalArgumentException.class, () -> observation(key, null));
    }

    @Test
    void valueSummariesMaskEmbeddedSecretsWithoutChangingMetadata() {
        var value = new ParameterObservation.ValueSummary(
                ParameterObservation.ValueType.STRING, 12, "sha256:fixture", "token=hidden");
        assertEquals("token=***MASKED***", value.maskedPreview());
        assertEquals(12, value.byteLength());
        assertEquals("sha256:fixture", value.digest());
    }

    @Test
    void acronymPrefixedSensitiveNamesAreRejectedAtTheModelBoundary() {
        for (String path : new String[]{"/CSRFToken", "/APIToken", "/APIKey", "/HTTPAuthorization", "/JSONPassword"}) {
            assertThrows(IllegalArgumentException.class, () -> observation(key(path), null), path);
        }
        assertFalse(Masking.isSensitiveParameterPath("/HTTPStatus"));
    }

    @Test
    void suppliedOverlongPreviewIsRejectedBeforeMaskingCanShortenIt() {
        assertThrows(IllegalArgumentException.class, () -> observation(key("/note"),
                new ParameterObservation.ValueSummary(ParameterObservation.ValueType.STRING, 86,
                        "sha256:fixture", "token=" + "x".repeat(80))));
    }

    private static ParameterKey key(String path) {
        return new ParameterKey("https://example.test:443", "POST", "POST /orders",
                ParameterObservation.Location.QUERY, path);
    }

    private static ParameterObservation observation(ParameterKey key,
                                                     ParameterObservation.ValueSummary value) {
        return new ParameterObservation(key, "ev-1", null, null, null, null, null,
                ParameterObservation.Presence.PRESENT, ParameterObservation.Shape.SCALAR,
                value, "context", null);
    }
}
