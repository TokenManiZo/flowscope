package io.flowscope;

import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SupportingAssetScope;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class SupportingAssetScopeTest {
    private final ScopePolicy scope = ScopePolicy.parse("https://shop.example.test/");
    private final SupportingAssetScope assets = new SupportingAssetScope();

    @Test
    void followsPageLinkedCdnScriptsAndChunksWithoutAdmittingCdnApis() {
        var links = assets.observeHtml(Source.SCANNER, "scan-1", scope::allows,
                "https://shop.example.test/", "<script src='https://cdn.example.test/app/main.js'></script>");
        assertEquals(1, links.size());
        assertEquals("https://cdn.example.test/app/main.js", links.getFirst());
        assertEquals("https://shop.example.test:443/", assets.pageUrlFor(Source.SCANNER, "scan-1", scope::allows,
                "GET", links.getFirst(), null, "script"));
        assertEquals("https://shop.example.test:443/", assets.pageUrlFor(Source.SCANNER, "scan-1", scope::allows,
                "GET", "https://cdn.example.test/app/chunk-4.js", null, "script"));
        assertNull(assets.pageUrlFor(Source.SCANNER, "scan-1", scope::allows,
                "GET", "https://cdn.example.test/api/orders", null, "empty"));
        assertNull(assets.pageUrlFor(Source.SCANNER, "scan-1", scope::allows,
                "POST", "https://cdn.example.test/app/main.js", null, "script"));
        assertNull(assets.pageUrlFor(Source.LLM, "scan-1", scope::allows,
                "GET", links.getFirst(), null, "script"));
        assertNull(assets.pageUrlFor(Source.SCANNER, "scan-2", scope::allows,
                "GET", links.getFirst(), null, "script"));
    }

    @Test
    void acceptsBrowserLinkedStaticOriginAndRejectsUnrelatedHost() {
        assertEquals("https://shop.example.test:443/catalog", assets.pageUrlFor(Source.HUMAN, "human-1", scope::allows,
                "GET", "https://cdn.example.test/assets/runtime.js",
                "https://shop.example.test/catalog?sort=asc", "script"));
        assertEquals("https://shop.example.test:443/catalog", assets.pageUrlFor(Source.HUMAN, "human-1", scope::allows,
                "GET", "https://cdn.example.test/assets/next.js", null, "script"));
        assertNull(assets.pageUrlFor(Source.HUMAN, "human-1", scope::allows,
                "GET", "https://other.example.test/assets/app.js", null, "script"));
        assets.clear();
        assertNull(assets.pageUrlFor(Source.HUMAN, "human-1", scope::allows,
                "GET", "https://cdn.example.test/assets/next.js", null, "script"));
    }

    @Test
    void aPrefetchLinkDoesNotTurnCdnJsonApisIntoPassiveAssets() {
        assets.observeHtml(Source.LLM, "llm-1", scope::allows, "https://shop.example.test/", """
                <link rel='prefetch' href='https://cdn.example.test/api/private.json'>
                <link rel='manifest' href='https://cdn.example.test/app.webmanifest'>
                """);
        assertNull(assets.pageUrlFor(Source.LLM, "llm-1", scope::allows, "GET",
                "https://cdn.example.test/api/private.json", null, ""));
        assertEquals("https://shop.example.test:443/", assets.pageUrlFor(Source.LLM, "llm-1",
                scope::allows, "GET", "https://cdn.example.test/app.webmanifest", null, ""));
    }

    @Test
    void javascriptImportsAndSourceMapBecomeFollowUpAssets() {
        assets.observeHtml(Source.LLM, "llm-js", scope::allows, "https://shop.example.test/", """
                <script src='https://cdn.example.test/js/main.js'></script>
                """);
        var references = assets.observeJavascript(Source.LLM, "llm-js", scope::allows,
                "https://cdn.example.test/js/main.js", "https://shop.example.test/", """
                import('./chunk.js');
                //# sourceMappingURL=main.js.map
                """);
        assertTrue(references.contains("https://cdn.example.test/js/chunk.js"));
        assertTrue(references.contains("https://cdn.example.test/js/main.js.map"));
        assertEquals("https://shop.example.test:443/", assets.pageUrlFor(Source.LLM, "llm-js",
                scope::allows, "GET", "https://cdn.example.test/js/main.js.map", null, ""));
    }
}
