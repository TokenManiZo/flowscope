package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.RouteCandidate;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Location, robots.txt, Web App Manifest처럼 형식이 표준화된 discovery metadata. */
public final class MetadataRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Override public String id() { return "standard-metadata"; }
    @Override public boolean supports(RouteDiscoveryDocument document) { return true; }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument document) {
        List<DiscoveredRoute> routes = new ArrayList<>();
        if (document.location() != null && !document.location().isBlank()) {
            routes.add(route(document.location(), RouteCandidate.ProvenanceType.LOCATION,
                    "Location은 method를 증명하지 않음"));
        }
        if (document.path().toLowerCase(Locale.ROOT).endsWith("/robots.txt")
                || document.path().equalsIgnoreCase("/robots.txt")) {
            for (String line : document.body().split("\\R")) {
                String[] pair = line.split(":", 2);
                if (pair.length == 2 && Set.of("allow", "disallow", "sitemap")
                        .contains(pair[0].trim().toLowerCase(Locale.ROOT)) && !pair[1].trim().isBlank()) {
                    routes.add(route(pair[1].trim(), RouteCandidate.ProvenanceType.ROBOTS_OR_SITEMAP,
                            "robots.txt 참조는 method를 증명하지 않음"));
                }
            }
        }
        if (document.mediaType().equals("application/manifest+json")
                || document.path().toLowerCase(Locale.ROOT).endsWith(".webmanifest")) {
            try {
                JsonNode root = JSON.readTree(document.body());
                addJsonUrl(routes, root, "start_url");
                addJsonUrl(routes, root, "scope");
                addJsonUrl(routes, root, "id");
                root.path("shortcuts").forEach(shortcut -> addJsonUrl(routes, shortcut, "url"));
            } catch (Exception ignored) {
                // 파싱 불가 manifest에서 URL을 꾸며내지 않는다.
            }
        }
        return List.copyOf(routes);
    }

    private void addJsonUrl(List<DiscoveredRoute> routes, JsonNode node, String field) {
        String value = node.path(field).asText();
        if (!value.isBlank()) routes.add(route(value, RouteCandidate.ProvenanceType.WEB_MANIFEST,
                "Web App Manifest " + field + " 참조는 method를 증명하지 않음"));
    }

    private DiscoveredRoute route(String reference, RouteCandidate.ProvenanceType type, String reason) {
        return new DiscoveredRoute(reference, "UNKNOWN", type, RouteCandidate.Applicability.REVIEW, reason, id());
    }
}
