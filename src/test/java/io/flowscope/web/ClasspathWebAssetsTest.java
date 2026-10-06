package io.flowscope.web;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ClasspathWebAssetsTest {
    private final ClasspathWebAssets assets = new ClasspathWebAssets();

    @Test
    void resolvesTheReactAppAtRootAndAppMount() {
        assertEquals("/web/app/index.html", assets.resolve("/").orElseThrow().resource());
        assertEquals("/web/app/index.html", assets.resolve("/app/").orElseThrow().resource());
        assertTrue(assets.resolve("/legacy/").isEmpty());
    }

    @Test
    void resolvesAllowlistedViteCssWithExplicitMimeType() {
        assertEquals("text/css; charset=utf-8", assets.resolve("/app/assets/app.css").orElseThrow().contentType());
    }

    @Test
    void rejectsEncodedDotSegmentBeforeLookingUpResources() {
        assertTrue(assets.resolve("/app/%2e%2e/index.html").isEmpty());
    }

    @Test
    void rejectsEncodedBackslashBeforeLookingUpResources() {
        assertTrue(assets.resolve("/app/assets/%5csecret").isEmpty());
    }
}
