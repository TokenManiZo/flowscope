package io.flowscope.burp;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class FlowScopeExtensionRawHeaderTest {
    @Test
    void missingOrNullHeadersAreRepresentedAsEmptyStrings() {
        assertEquals("", FlowScopeExtension.rawHeader(Map.of(), "Cookie"));
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", null);
        assertEquals("", FlowScopeExtension.rawHeader(headers, "Authorization"));
    }

    @Test
    void headerLookupIsCaseInsensitive() {
        assertEquals("session=value", FlowScopeExtension.rawHeader(
                Map.of("cOoKiE", "session=value"), "Cookie"));
    }
}
