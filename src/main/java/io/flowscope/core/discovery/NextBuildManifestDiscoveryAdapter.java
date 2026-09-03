package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 공개된 Next.js pages-router build manifest에서 클라이언트 chunk 참조만 추출한다. */
public final class NextBuildManifestDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final Pattern CHUNK = Pattern.compile(
            "['\"]((?:/_next/)?static/(?:chunks|[^/'\"]+/pages)/[^'\"]+?\\.(?:js|mjs)(?:\\?[^'\"]*)?)['\"]");
    private static final int MAX_ASSETS = 10_000;

    @Override public String id() { return "next-build-manifest"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        String path = document.path().toLowerCase(Locale.ROOT);
        return path.endsWith("/_buildmanifest.js") || document.body().contains("__BUILD_MANIFEST");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument document) {
        LinkedHashSet<String> references = new LinkedHashSet<>();
        Matcher matcher = CHUNK.matcher(document.body());
        while (matcher.find() && references.size() < MAX_ASSETS) {
            String value = matcher.group(1);
            references.add(value.startsWith("/_next/") ? value : "/_next/" + value);
        }
        List<DiscoveredRoute> routes = new ArrayList<>();
        for (String reference : references) {
            routes.add(new DiscoveredRoute(reference, "GET",
                    RouteCandidate.ProvenanceType.FRAMEWORK_MANIFEST_ASSET,
                    RouteCandidate.Applicability.REVIEW,
                    "공개 Next.js build manifest의 client chunk 참조", id()));
        }
        return List.copyOf(routes);
    }
}
