package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.flowscope.core.RouteCandidate;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 대상 응답에서 실제 관측한 OpenAPI/Swagger JSON·YAML paths만 읽는다. */
public final class OpenApiRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final Set<String> METHODS = Set.of("get", "post", "put", "patch", "delete", "options", "head");

    @Override public String id() { return "openapi-json-yaml"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        String body = document.body();
        String media = document.mediaType();
        String path = document.path().toLowerCase(Locale.ROOT);
        return body.contains("\"openapi\"") || body.contains("\"swagger\"")
                || body.matches("(?s)^\\s*(openapi|swagger)\\s*:.*")
                || media.contains("openapi") || path.endsWith("openapi.json") || path.endsWith("openapi.yaml")
                || path.endsWith("openapi.yml") || path.endsWith("swagger.json") || path.endsWith("swagger.yaml")
                || path.endsWith("swagger.yml");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument document) {
        JsonNode root = parse(document.body());
        if (root == null || (!root.has("openapi") && !root.has("swagger"))) return List.of();
        JsonNode paths = root.path("paths");
        if (!paths.isObject()) return List.of();
        List<String> bases = bases(root, document);
        List<DiscoveredRoute> routes = new ArrayList<>();
        paths.properties().forEach(path -> path.getValue().properties().forEach(operation -> {
            String method = operation.getKey().toLowerCase(Locale.ROOT);
            if (!METHODS.contains(method)) return;
            for (String base : bases) {
                String reference = join(base, path.getKey());
                if (reference != null) routes.add(new DiscoveredRoute(reference, method,
                        RouteCandidate.ProvenanceType.OPENAPI, RouteCandidate.Applicability.APPLICABLE,
                        "관측 OpenAPI/Swagger paths의 명시 operation", id()));
            }
        }));
        return List.copyOf(routes);
    }

    private static JsonNode parse(String body) {
        try { return JSON.readTree(body); }
        catch (Exception ignored) {
            try { return YAML.readTree(body); }
            catch (Exception ignoredAgain) { return null; }
        }
    }

    private static List<String> bases(JsonNode root, RouteDiscoveryDocument document) {
        List<String> bases = new ArrayList<>();
        JsonNode servers = root.path("servers");
        if (servers.isArray()) {
            for (JsonNode server : servers) {
                String url = expandServer(server);
                if (!url.isBlank() && !url.contains("{")) bases.add(resolve(document.baseUrl(), url));
            }
            if (!servers.isEmpty() && bases.isEmpty()) return List.of();
        }
        if (bases.isEmpty() && root.has("swagger")) {
            String host = root.path("host").asText();
            String scheme = root.path("schemes").isArray() && !root.path("schemes").isEmpty()
                    ? root.path("schemes").get(0).asText() : URI.create(document.service()).getScheme();
            String basePath = root.path("basePath").asText("");
            bases.add(host.isBlank() ? document.service() + basePath : scheme + "://" + host + basePath);
        }
        if (bases.isEmpty()) bases.add(document.service());
        return bases.stream().filter(value -> value != null && !value.isBlank()).distinct().toList();
    }

    private static String expandServer(JsonNode server) {
        String url = server.path("url").asText();
        if (url.isBlank() || !url.contains("{")) return url;
        JsonNode variables = server.path("variables");
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("\\{([^{}]+)}").matcher(url);
        StringBuffer expanded = new StringBuffer();
        while (matcher.find()) {
            String replacement = variables.path(matcher.group(1)).path("default").asText();
            if (replacement.isBlank()) return "";
            matcher.appendReplacement(expanded, java.util.regex.Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(expanded);
        // 변수 default가 반복 치환돼 좌표 상한(8,192자)을 넘는 server base는 route를 만들지 않는다.
        return expanded.length() > MAX_SERVER_URL_CHARS ? "" : expanded.toString();
    }

    private static final int MAX_SERVER_URL_CHARS = 8_192;

    private static String resolve(String base, String reference) {
        try { return URI.create(base).resolve(reference).toString(); }
        catch (RuntimeException ignored) { return null; }
    }

    private static String join(String base, String path) {
        if (base == null || path == null || path.isBlank()) return null;
        if (base.endsWith("/") && path.startsWith("/")) return base + path.substring(1);
        if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
        return base + path;
    }
}
