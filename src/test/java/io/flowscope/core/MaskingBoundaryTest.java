package io.flowscope.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class MaskingBoundaryTest {
    @Test
    void uppercaseRunsHaveALinearCharacterAccessBound() {
        for (String text : new String[]{"A".repeat(100_000), "A".repeat(100_000) + "Token"}) {
            CountingCharacters input = new CountingCharacters(text);
            String split = Masking.splitParameterWords(input);
            assertEquals(text.endsWith("Token") ? "A".repeat(100_000) + "/Token" : text, split);
            assertTrue(input.reads <= 2L * text.length());
        }
    }

    @Test
    void splitterPreservesAcronymLowercaseAndDigitBoundaries() {
        assertEquals("CSRF/Token", Masking.splitParameterWords("CSRFToken"));
        assertEquals("API/Token", Masking.splitParameterWords("APIToken"));
        assertEquals("HTTP/Status", Masking.splitParameterWords("HTTPStatus"));
        assertEquals("access/Token", Masking.splitParameterWords("accessToken"));
        assertEquals("v2/Token", Masking.splitParameterWords("v2Token"));
        assertEquals("a/B/Cd", Masking.splitParameterWords("aBCd"));
        assertTrue(Masking.isSensitiveParameterPath("/CSRFToken"));
        assertTrue(Masking.isSensitiveParameterPath("/APIToken"));
        assertFalse(Masking.isSensitiveParameterPath("/HTTPStatus"));
    }

    private static final class CountingCharacters implements CharSequence {
        private final String text;
        private long reads;

        private CountingCharacters(String text) { this.text = text; }
        @Override public int length() { return text.length(); }
        @Override public char charAt(int index) {
            if (++reads > 3L * text.length() + 16) throw new AssertionError("character-access budget exceeded");
            return text.charAt(index);
        }
        @Override public CharSequence subSequence(int start, int end) {
            throw new AssertionError("splitter must scan the supplied sequence");
        }
        @Override public String toString() {
            throw new AssertionError("splitter must not bypass character-access accounting");
        }
    }
}
