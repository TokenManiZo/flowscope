package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.flowscope.core.SurfaceAnalysis.Declaration;
import io.flowscope.core.SurfaceAnalysis.DeltaState;
import io.flowscope.core.SurfaceAnalysis.EndpointFact;
import io.flowscope.core.SurfaceAnalysis.EndpointKey;
import io.flowscope.core.SurfaceAnalysis.Observation;
import io.flowscope.core.SurfaceAnalysis.ParameterFact;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterObservation;
import io.flowscope.core.SurfaceAnalysis.Requirement;
import io.flowscope.core.SurfaceAnalysis.ValueShape;
import io.flowscope.core.discovery.RouteDiscoveryDocument;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Evidence와 명시적 대상 산출물로부터 endpoint/parameter surface 사실을 파생한다. */
public final class SurfaceAnalyzer {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final Set<String> HTTP_METHODS = Set.of(
            "get", "post", "put", "patch", "delete", "options", "head");
    private static final Pattern UUID = Pattern.compile(
            "(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    private static final Pattern MULTIPART_NAME = Pattern.compile(
            "(?i)content-disposition\\s*:[^\\r\\n]*\\bname\\s*=\\s*(?:\"([^\"]+)\"|([^;\\s]+))");
    private static final Pattern JS_PROPERTY = Pattern.compile(
            "(?s)(?:^|[,\\{])\\s*(?:([A-Za-z_$][\\w$-]*)|'([^']+)'|\"([^\"]+)\")\\s*:");
    private static final Set<String> JS_OPTION_KEYS = Set.of(
            "method", "headers", "body", "credentials", "mode", "cache", "redirect", "referrer",
            "signal", "integrity", "keepalive", "url", "type", "data", "params", "timeout");
    private static final int MAX_PARAMETERS_PER_ENDPOINT = 1_024;
    private static final int MAX_JSON_DEPTH = 16;
    private static final int MAX_SCHEMA_DEPTH = 20;
    private static final int MAX_JS_WINDOW = 4_096;

    private SurfaceAnalyzer() {}

    public static SurfaceAnalysis analyze(List<RequestRecord> allRecords,
                                          List<RequestRecord> coverageRecords,
                                          List<RouteCandidate> routeCandidates) {
        Map<String, MutableEndpoint> endpoints = new LinkedHashMap<>();
        Map<String, RequestRecord> recordsByEvidence = new LinkedHashMap<>();
        for (RequestRecord record : allRecords == null ? List.<RequestRecord>of() : allRecords) {
            if (record.evidenceId != null && !record.evidenceId.isBlank()) {
                recordsByEvidence.putIfAbsent(record.evidenceId, record);
            }
        }

        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            EndpointKey key = new EndpointKey(candidate.service(), candidate.method(), candidate.pathTemplate());
            MutableEndpoint endpoint = endpoints.computeIfAbsent(key.stableKey(), ignored -> new MutableEndpoint(key));
            for (RouteCandidate.Provenance provenance : candidate.provenance()) {
                if (provenance.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST) continue;
                endpoint.declarations.add(declaration(provenance));
            }
        }

        for (RequestRecord record : coverageRecords == null ? List.<RequestRecord>of() : coverageRecords) {
            if (record.source != Source.HUMAN && record.source != Source.SCANNER && record.source != Source.LLM) continue;
            EndpointKey key = observedKey(record);
            MutableEndpoint endpoint = endpoints.computeIfAbsent(key.stableKey(), ignored -> new MutableEndpoint(key));
            endpoint.observations.add(new Observation(record.evidenceId, record.source, record.runId, record.idn,
                    record.status));
            observePathParameters(endpoint, record);
            observeQueryParameters(endpoint, record);
            observeBodyParameters(endpoint, record);
        }

        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            for (RouteCandidate.Provenance provenance : candidate.provenance()) {
                if (provenance.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST) continue;
                RequestRecord artifact = recordsByEvidence.get(provenance.evidenceId());
                if (artifact == null) continue;
                switch (provenance.type()) {
                    case OPENAPI -> declareOpenApi(endpoints, candidate, artifact, provenance);
                    case HTML_FORM -> declareHtmlForm(endpoints, candidate, artifact, provenance);
                    case JAVASCRIPT_LITERAL -> declareJavascript(endpoints, candidate, artifact, provenance);
                    default -> declareQueryLiteral(endpoints, candidate, provenance);
                }
            }
        }

        List<EndpointFact> facts = endpoints.values().stream()
                .map(MutableEndpoint::freeze)
                .sorted(Comparator.comparing((EndpointFact fact) -> fact.key().service())
                        .thenComparing(fact -> fact.key().pathTemplate())
                        .thenComparing(fact -> fact.key().method()))
                .toList();
        return new SurfaceAnalysis(facts);
    }

    private static EndpointKey observedKey(RequestRecord record) {
        String prefix = record.service + " " + record.method + " ";
        String path = record.op != null && record.op.startsWith(prefix)
                ? record.op.substring(prefix.length()) : record.path;
        int operationName = path.indexOf('#');
        if (operationName >= 0) path = path.substring(0, operationName);
        return new EndpointKey(record.service, record.method, path);
    }

    private static Declaration declaration(RouteCandidate.Provenance provenance) {
        return new Declaration(provenance.evidenceId(), provenance.source(), provenance.runId(),
                provenance.type().name(), provenance.adapter(), provenance.reason());
    }

    private static void observePathParameters(MutableEndpoint endpoint, RequestRecord record) {
        String[] template = endpoint.key.pathTemplate().split("/", -1);
        String[] actual = record.path.split("/", -1);
        int length = Math.min(template.length, actual.length);
        for (int index = 0; index < length; index++) {
            if (!template[index].startsWith("{") || !template[index].endsWith("}")) continue;
            endpoint.parameter(ParameterLocation.PATH, "path[" + index + "]", template[index])
                    .observe(record, shape(decode(actual[index])));
        }
    }

    private static void observeQueryParameters(MutableEndpoint endpoint, RequestRecord record) {
        if (record.query == null || record.query.isBlank()) return;
        for (NameValue value : query(record.query)) {
            endpoint.parameter(ParameterLocation.QUERY, value.name(), value.name())
                    .observe(record, shape(value.value()));
        }
    }

    private static void observeBodyParameters(MutableEndpoint endpoint, RequestRecord record) {
        String body = record.requestBodyForAnalysis();
        if (body == null || body.isBlank()) return;
        String media = mediaType(record.requestContentType);
        String stripped = body.stripLeading();
        if (media.contains("json") || stripped.startsWith("{") || stripped.startsWith("[")) {
            try {
                JsonNode root = JSON.readTree(body);
                observeJson(endpoint, record, root, "", 0, new int[]{0});
            } catch (Exception ignored) {
                // JSON으로 확인되지 않은 본문을 추정 파싱하지 않는다.
            }
            return;
        }
        if (media.equals("application/x-www-form-urlencoded")) {
            for (NameValue value : query(body)) {
                endpoint.parameter(ParameterLocation.FORM_BODY, value.name(), value.name())
                        .observe(record, shape(value.value()));
            }
            return;
        }
        if (media.startsWith("multipart/form-data")) {
            Matcher matcher = MULTIPART_NAME.matcher(body);
            while (matcher.find()) {
                String name = matcher.group(1) == null ? matcher.group(2) : matcher.group(1);
                endpoint.parameter(ParameterLocation.MULTIPART_BODY, name, name)
                        .observe(record, ValueShape.UNKNOWN);
            }
        }
    }

    private static void observeJson(MutableEndpoint endpoint, RequestRecord record, JsonNode node,
                                    String path, int depth, int[] count) {
        if (node == null || depth > MAX_JSON_DEPTH || count[0] >= MAX_PARAMETERS_PER_ENDPOINT) return;
        if (node.isObject()) {
            if (!path.isBlank() && node.isEmpty()) {
                endpoint.parameter(ParameterLocation.JSON_BODY, path, path).observe(record, ValueShape.OBJECT);
                count[0]++;
            }
            node.properties().forEach(entry -> {
                if (count[0] >= MAX_PARAMETERS_PER_ENDPOINT) return;
                String child = path.isBlank() ? entry.getKey() : path + "." + entry.getKey();
                observeJson(endpoint, record, entry.getValue(), child, depth + 1, count);
            });
            return;
        }
        if (node.isArray()) {
            endpoint.parameter(ParameterLocation.JSON_BODY, path, path).observe(record, ValueShape.ARRAY);
            count[0]++;
            if (!node.isEmpty()) observeJson(endpoint, record, node.get(0), path + "[]", depth + 1, count);
            return;
        }
        if (!path.isBlank()) {
            endpoint.parameter(ParameterLocation.JSON_BODY, path, path).observe(record, shape(node));
            count[0]++;
        }
    }

    private static void declareQueryLiteral(Map<String, MutableEndpoint> endpoints, RouteCandidate candidate,
                                            RouteCandidate.Provenance provenance) {
        MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                candidate.pathTemplate()).stableKey());
        if (endpoint == null) return;
        for (String concrete : candidate.concretePaths()) {
            int question = concrete.indexOf('?');
            if (question < 0 || question + 1 >= concrete.length()) continue;
            for (NameValue value : query(concrete.substring(question + 1))) {
                endpoint.parameter(ParameterLocation.QUERY, value.name(), value.name())
                        .declare(provenance, Requirement.UNKNOWN, value.name());
            }
        }
    }

    private static void declareOpenApi(Map<String, MutableEndpoint> endpoints, RouteCandidate candidate,
                                       RequestRecord artifact, RouteCandidate.Provenance provenance) {
        JsonNode root = parseOpenApi(artifact.responseBodyForAnalysis());
        if (root == null || !root.path("paths").isObject()) return;
        root.path("paths").properties().forEach(pathEntry -> {
            JsonNode pathItem = pathEntry.getValue();
            pathItem.properties().forEach(operationEntry -> {
                String method = operationEntry.getKey().toLowerCase(Locale.ROOT);
                if (!HTTP_METHODS.contains(method) || !candidate.method().equalsIgnoreCase(method)
                        || !candidatePathMatches(candidate.pathTemplate(), pathEntry.getKey())) return;
                MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                        candidate.pathTemplate()).stableKey());
                if (endpoint == null) return;
                declareTemplatePath(endpoint, pathEntry.getKey(), provenance);
                declareOpenApiParameters(endpoint, root, pathEntry.getKey(), pathItem.path("parameters"), provenance);
                JsonNode operation = operationEntry.getValue();
                declareOpenApiParameters(endpoint, root, pathEntry.getKey(), operation.path("parameters"), provenance);
                declareRequestBody(endpoint, root, operation.path("requestBody"), provenance);
            });
        });
    }

    private static void declareTemplatePath(MutableEndpoint endpoint, String schemaPath,
                                            RouteCandidate.Provenance provenance) {
        String[] segments = schemaPath.split("/", -1);
        for (int index = 0; index < segments.length; index++) {
            String value = segments[index];
            if (value.startsWith("{") && value.endsWith("}")) {
                String name = value.substring(1, value.length() - 1);
                endpoint.parameter(ParameterLocation.PATH, "path[" + alignedPathIndex(endpoint.key.pathTemplate(),
                                schemaPath, index) + "]", name)
                        .declare(provenance, Requirement.REQUIRED, name);
            }
        }
    }

    private static int alignedPathIndex(String candidatePath, String schemaPath, int schemaIndex) {
        int offset = candidatePath.split("/", -1).length - schemaPath.split("/", -1).length;
        return Math.max(0, schemaIndex + offset);
    }

    private static void declareOpenApiParameters(MutableEndpoint endpoint, JsonNode root, String schemaPath,
                                                 JsonNode parameters, RouteCandidate.Provenance provenance) {
        if (!parameters.isArray()) return;
        for (JsonNode raw : parameters) {
            JsonNode parameter = resolveLocalRef(root, raw, 0);
            String name = parameter.path("name").asText();
            if (name.isBlank()) continue;
            ParameterLocation location = switch (parameter.path("in").asText()) {
                case "path" -> ParameterLocation.PATH;
                case "query" -> ParameterLocation.QUERY;
                case "formData" -> ParameterLocation.FORM_BODY;
                case "body" -> null;
                default -> null;
            };
            if (parameter.path("in").asText().equals("body")) {
                declareSchema(endpoint, root, parameter.path("schema"), "", provenance,
                        parameter.path("required").asBoolean(false) ? Requirement.REQUIRED : Requirement.OPTIONAL,
                        ParameterLocation.JSON_BODY, 0, new LinkedHashSet<>());
                continue;
            }
            if (location == null) continue;
            String key = location == ParameterLocation.PATH
                    ? pathKey(schemaPath, name, endpoint.key.pathTemplate()) : name;
            Requirement requirement = parameter.has("required")
                    ? (parameter.path("required").asBoolean() ? Requirement.REQUIRED : Requirement.OPTIONAL)
                    : location == ParameterLocation.PATH ? Requirement.REQUIRED : Requirement.UNKNOWN;
            endpoint.parameter(location, key, name).declare(provenance, requirement, name);
        }
    }

    private static String pathKey(String schemaPath, String name, String candidatePath) {
        String[] segments = schemaPath.split("/", -1);
        for (int index = 0; index < segments.length; index++) {
            if (segments[index].equals("{" + name + "}")) {
                return "path[" + alignedPathIndex(candidatePath, schemaPath, index) + "]";
            }
        }
        return "path[?]";
    }

    private static void declareRequestBody(MutableEndpoint endpoint, JsonNode root, JsonNode raw,
                                           RouteCandidate.Provenance provenance) {
        JsonNode requestBody = resolveLocalRef(root, raw, 0);
        if (!requestBody.isObject()) return;
        Requirement rootRequirement = requestBody.has("required") && requestBody.path("required").asBoolean()
                ? Requirement.REQUIRED : Requirement.UNKNOWN;
        JsonNode content = requestBody.path("content");
        if (!content.isObject()) return;
        content.properties().forEach(entry -> {
            String media = mediaType(entry.getKey());
            ParameterLocation location = media.contains("json") ? ParameterLocation.JSON_BODY
                    : media.equals("application/x-www-form-urlencoded") ? ParameterLocation.FORM_BODY
                    : media.equals("multipart/form-data") ? ParameterLocation.MULTIPART_BODY : null;
            if (location == null) return;
            declareSchema(endpoint, root, entry.getValue().path("schema"), "", provenance, rootRequirement,
                    location, 0, new LinkedHashSet<>());
        });
    }

    private static void declareSchema(MutableEndpoint endpoint, JsonNode root, JsonNode raw, String path,
                                      RouteCandidate.Provenance provenance, Requirement inherited,
                                      ParameterLocation location, int depth, Set<String> refs) {
        if (raw == null || depth > MAX_SCHEMA_DEPTH || endpoint.parameters.size() >= MAX_PARAMETERS_PER_ENDPOINT) return;
        JsonNode schema = raw;
        if (schema.has("$ref")) {
            String ref = schema.path("$ref").asText();
            if (!ref.startsWith("#/") || !refs.add(ref)) return;
            schema = resolveLocalRef(root, schema, 0);
        }
        JsonNode required = schema.path("required");
        Set<String> requiredNames = new LinkedHashSet<>();
        if (required.isArray()) for (JsonNode item : required) requiredNames.add(item.asText());
        JsonNode properties = schema.path("properties");
        if (properties.isObject()) {
            properties.properties().forEach(entry -> {
                String child = path.isBlank() ? entry.getKey() : path + "." + entry.getKey();
                Requirement requirement = requiredNames.contains(entry.getKey())
                        ? Requirement.REQUIRED : Requirement.OPTIONAL;
                JsonNode value = entry.getValue();
                if (value.path("type").asText().equals("object") || value.has("properties") || value.has("$ref")) {
                    declareSchema(endpoint, root, value, child, provenance, requirement, location,
                            depth + 1, new LinkedHashSet<>(refs));
                } else if (value.path("type").asText().equals("array")) {
                    endpoint.parameter(location, child, child)
                            .declare(provenance, requirement, child);
                    declareSchema(endpoint, root, value.path("items"), child + "[]", provenance, requirement,
                            location, depth + 1, new LinkedHashSet<>(refs));
                } else {
                    endpoint.parameter(location, child, child)
                            .declare(provenance, requirement, child);
                }
            });
        } else if (!path.isBlank()) {
            endpoint.parameter(location, path, path)
                    .declare(provenance, inherited, path);
        }
        for (String composition : List.of("allOf", "oneOf", "anyOf")) {
            JsonNode values = schema.path(composition);
            if (values.isArray()) for (JsonNode value : values) {
                declareSchema(endpoint, root, value, path, provenance, inherited, location,
                        depth + 1, new LinkedHashSet<>(refs));
            }
        }
    }

    private static JsonNode resolveLocalRef(JsonNode root, JsonNode node, int depth) {
        JsonNode current = node;
        int remaining = MAX_SCHEMA_DEPTH - depth;
        while (current != null && current.has("$ref") && remaining-- > 0) {
            String ref = current.path("$ref").asText();
            if (!ref.startsWith("#/")) return current;
            current = root.at(ref.substring(1));
        }
        return current == null ? JSON.nullNode() : current;
    }

    private static void declareHtmlForm(Map<String, MutableEndpoint> endpoints, RouteCandidate candidate,
                                        RequestRecord artifact, RouteCandidate.Provenance provenance) {
        Document document = Jsoup.parse(artifact.responseBodyForAnalysis(), artifact.service + artifact.path);
        for (Element form : document.select("form")) {
            String method = form.attr("method").isBlank() ? "GET" : form.attr("method").toUpperCase(Locale.ROOT);
            String action = form.hasAttr("action") ? form.absUrl("action") : artifact.service + artifact.path;
            if (!htmlCandidateMatches(candidate, method, action)) continue;
            ParameterLocation location = method.equals("GET") ? ParameterLocation.QUERY
                    : form.attr("enctype").toLowerCase(Locale.ROOT).startsWith("multipart/form-data")
                    ? ParameterLocation.MULTIPART_BODY : ParameterLocation.FORM_BODY;
            MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                    candidate.pathTemplate()).stableKey());
            if (endpoint == null) continue;
            for (Element control : form.select("input[name], select[name], textarea[name], button[name]")) {
                if (control.hasAttr("disabled")) continue;
                String name = control.attr("name").trim();
                if (name.isBlank()) continue;
                Requirement requirement = control.hasAttr("required") ? Requirement.REQUIRED : Requirement.OPTIONAL;
                endpoint.parameter(location, name, name).declare(provenance, requirement, name);
            }
        }
    }

    private static boolean htmlCandidateMatches(RouteCandidate candidate, String method, String action) {
        if (!candidate.method().equalsIgnoreCase(method)) return false;
        try {
            URI uri = URI.create(action);
            String normalized = Normalizer.normalize(method, uri.getPath()).op;
            String path = normalized.substring(normalized.indexOf(' ') + 1);
            return candidate.pathTemplate().equals(path);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static void declareJavascript(Map<String, MutableEndpoint> endpoints, RouteCandidate candidate,
                                          RequestRecord artifact, RouteCandidate.Provenance provenance) {
        declareQueryLiteral(endpoints, candidate, provenance);
        if (candidate.method().equals("GET") || candidate.method().equals("HEAD")
                || candidate.method().equals("OPTIONS") || candidate.method().equals("UNKNOWN")) return;
        MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                candidate.pathTemplate()).stableKey());
        if (endpoint == null) return;
        String body = artifact.responseBodyForAnalysis();
        for (String concrete : candidate.concretePaths()) {
            String path = concrete.split("\\?", 2)[0];
            int from = 0;
            while (from < body.length()) {
                int hit = body.indexOf(path, from);
                if (hit < 0) break;
                String window = requestExpression(body, hit);
                int objectStart = requestObjectStart(window);
                if (objectStart >= 0) {
                    int objectEnd = balancedObjectEnd(window, objectStart);
                    if (objectEnd > objectStart) {
                        Matcher property = JS_PROPERTY.matcher(window.substring(objectStart, objectEnd + 1));
                        while (property.find()) {
                            String name = first(property.group(1), property.group(2), property.group(3));
                            if (name != null && !JS_OPTION_KEYS.contains(name)) {
                                endpoint.parameter(ParameterLocation.JSON_BODY, name, name)
                                        .declare(provenance, Requirement.UNKNOWN, name);
                            }
                        }
                    }
                }
                from = hit + path.length();
            }
        }
    }

    private static String requestExpression(String script, int pathStart) {
        int lowerBound = Math.max(0, pathStart - 256);
        int callStart = -1;
        for (int index = pathStart - 1; index >= lowerBound; index--) {
            char current = script.charAt(index);
            if (current == '(') {
                callStart = index;
                break;
            }
            if (current == ';' || current == '\n' || current == '\r') break;
        }
        if (callStart >= 0) {
            int callEnd = balancedCallEnd(script, callStart, Math.min(script.length(), callStart + MAX_JS_WINDOW));
            if (callEnd > pathStart) return script.substring(pathStart, callEnd + 1);
        }
        int limit = Math.min(script.length(), pathStart + MAX_JS_WINDOW);
        int end = limit;
        for (int index = pathStart; index < limit; index++) {
            char current = script.charAt(index);
            if (current == ';' || current == '\n' || current == '\r') {
                end = index;
                break;
            }
        }
        return script.substring(pathStart, end);
    }

    private static int balancedCallEnd(String value, int start, int limit) {
        int depth = 0;
        char quote = 0;
        boolean escaped = false;
        for (int index = start; index < limit; index++) {
            char current = value.charAt(index);
            if (quote != 0) {
                if (escaped) escaped = false;
                else if (current == '\\') escaped = true;
                else if (current == quote) quote = 0;
                continue;
            }
            if (current == '\'' || current == '"' || current == '`') {
                quote = current;
                continue;
            }
            if (current == '(') depth++;
            else if (current == ')' && --depth == 0) return index;
        }
        return -1;
    }

    private static int requestObjectStart(String window) {
        int stringify = window.indexOf("JSON.stringify");
        if (stringify >= 0) {
            int brace = window.indexOf('{', stringify);
            if (brace >= 0) return brace;
        }
        int body = window.indexOf("body:");
        if (body < 0) body = window.indexOf("body :");
        if (body >= 0) {
            int brace = window.indexOf('{', body);
            if (brace >= 0) return brace;
        }
        int comma = window.indexOf(',');
        if (comma >= 0) {
            int brace = window.indexOf('{', comma);
            if (brace >= 0) return brace;
        }
        return -1;
    }

    private static int balancedObjectEnd(String value, int start) {
        int depth = 0;
        char quote = 0;
        boolean escaped = false;
        for (int index = start; index < value.length(); index++) {
            char current = value.charAt(index);
            if (quote != 0) {
                if (escaped) escaped = false;
                else if (current == '\\') escaped = true;
                else if (current == quote) quote = 0;
                continue;
            }
            if (current == '\'' || current == '"' || current == '`') { quote = current; continue; }
            if (current == '{') depth++;
            else if (current == '}' && --depth == 0) return index;
        }
        return -1;
    }

    private static JsonNode parseOpenApi(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode root = JSON.readTree(body);
            return root.has("openapi") || root.has("swagger") ? root : null;
        } catch (Exception ignored) {
            try {
                JsonNode root = YAML.readTree(body);
                return root.has("openapi") || root.has("swagger") ? root : null;
            } catch (Exception ignoredAgain) {
                return null;
            }
        }
    }

    private static boolean candidatePathMatches(String candidatePath, String schemaPath) {
        String normalized = schemaPath.replaceAll("\\{[^/{}]+}", "{id}");
        return candidatePath.equals(normalized) || candidatePath.endsWith(normalized);
    }

    private static List<NameValue> query(String raw) {
        List<NameValue> values = new ArrayList<>();
        for (String pair : raw.split("&", -1)) {
            if (pair.isBlank()) continue;
            int equals = pair.indexOf('=');
            String name = decode(equals < 0 ? pair : pair.substring(0, equals)).trim();
            if (name.isBlank()) continue;
            String value = equals < 0 ? "" : decode(pair.substring(equals + 1));
            values.add(new NameValue(name, value));
        }
        return values;
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, StandardCharsets.UTF_8); }
        catch (IllegalArgumentException ignored) { return value; }
    }

    private static ValueShape shape(JsonNode node) {
        if (node == null || node.isNull()) return ValueShape.NULL;
        if (node.isBoolean()) return ValueShape.BOOLEAN;
        if (node.isIntegralNumber()) return ValueShape.INTEGER;
        if (node.isFloatingPointNumber() || node.isBigDecimal()) return ValueShape.DECIMAL;
        if (node.isArray()) return ValueShape.ARRAY;
        if (node.isObject()) return ValueShape.OBJECT;
        return shape(node.asText());
    }

    private static ValueShape shape(String value) {
        if (value == null || value.isEmpty()) return ValueShape.EMPTY;
        if (UUID.matcher(value).matches()) return ValueShape.UUID;
        if (value.matches("-?\\d+")) return ValueShape.INTEGER;
        if (value.matches("-?(?:\\d+\\.\\d*|\\d*\\.\\d+)(?:[eE][+-]?\\d+)?")) return ValueShape.DECIMAL;
        if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("false")) return ValueShape.BOOLEAN;
        return ValueShape.STRING;
    }

    private static String mediaType(String value) {
        if (value == null) return "";
        int semicolon = value.indexOf(';');
        return (semicolon < 0 ? value : value.substring(0, semicolon)).trim().toLowerCase(Locale.ROOT);
    }

    private static String first(String... values) {
        for (String value : values) if (value != null) return value;
        return null;
    }

    private static DeltaState delta(boolean declared, Set<Source> sources) {
        int count = (int) sources.stream().filter(source -> source == Source.HUMAN
                || source == Source.SCANNER || source == Source.LLM).count();
        if (count == 0) return DeltaState.DECLARED_NOT_OBSERVED;
        if (count == 3) return DeltaState.ALL_SOURCES_OBSERVED;
        if (count == 2) return DeltaState.MULTI_SOURCE_OBSERVED;
        return declared ? DeltaState.ONE_SOURCE_OBSERVED : DeltaState.OBSERVED_NOT_DECLARED;
    }

    private record NameValue(String name, String value) {}

    private static final class MutableEndpoint {
        private final EndpointKey key;
        private final LinkedHashSet<Observation> observations = new LinkedHashSet<>();
        private final LinkedHashSet<Declaration> declarations = new LinkedHashSet<>();
        private final Map<String, MutableParameter> parameters = new LinkedHashMap<>();

        private MutableEndpoint(EndpointKey key) { this.key = key; }

        private MutableParameter parameter(ParameterLocation location, String fieldPath, String displayName) {
            if (fieldPath == null || fieldPath.isBlank() || parameters.size() >= MAX_PARAMETERS_PER_ENDPOINT) {
                return MutableParameter.IGNORED;
            }
            String key = location + "\u0000" + fieldPath;
            return parameters.computeIfAbsent(key, ignored -> new MutableParameter(location, fieldPath, displayName));
        }

        private EndpointFact freeze() {
            Set<Source> sources = observations.stream().map(Observation::source)
                    .collect(java.util.stream.Collectors.toCollection(() -> EnumSet.noneOf(Source.class)));
            List<ParameterFact> parameterFacts = parameters.values().stream().map(MutableParameter::freeze)
                    .sorted(Comparator.comparing((ParameterFact fact) -> fact.location().ordinal())
                            .thenComparing(ParameterFact::fieldPath)).toList();
            return new EndpointFact(key, Set.copyOf(sources), List.copyOf(observations), List.copyOf(declarations),
                    parameterFacts, delta(!declarations.isEmpty(), sources));
        }
    }

    private static final class MutableParameter {
        private static final MutableParameter IGNORED = new MutableParameter(null, "", "");
        private final ParameterLocation location;
        private final String fieldPath;
        private String displayName;
        private final EnumSet<ValueShape> shapes = EnumSet.noneOf(ValueShape.class);
        private final EnumSet<Source> sources = EnumSet.noneOf(Source.class);
        private final LinkedHashSet<String> evidenceIds = new LinkedHashSet<>();
        private final LinkedHashSet<ParameterObservation> observations = new LinkedHashSet<>();
        private final LinkedHashSet<Declaration> declarations = new LinkedHashSet<>();
        private final EnumSet<Requirement> requirements = EnumSet.noneOf(Requirement.class);

        private MutableParameter(ParameterLocation location, String fieldPath, String displayName) {
            this.location = location;
            this.fieldPath = fieldPath;
            this.displayName = displayName;
        }

        private void observe(RequestRecord record, ValueShape shape) {
            if (this == IGNORED) return;
            sources.add(record.source);
            if (record.evidenceId != null) evidenceIds.add(record.evidenceId);
            ValueShape observedShape = shape == null ? ValueShape.UNKNOWN : shape;
            shapes.add(observedShape);
            observations.add(new ParameterObservation(record.evidenceId, record.source, record.runId,
                    record.idn, record.status, observedShape));
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name) {
            if (this == IGNORED) return;
            declarations.add(declaration(provenance));
            requirements.add(requirement == null ? Requirement.UNKNOWN : requirement);
            if (name != null && !name.isBlank()) displayName = name;
        }

        private ParameterFact freeze() {
            Requirement requirement = requirements.size() == 1 ? requirements.iterator().next() : Requirement.UNKNOWN;
            return new ParameterFact(location, fieldPath, displayName, requirement, Set.copyOf(shapes),
                    Set.copyOf(sources), List.copyOf(evidenceIds), List.copyOf(observations), List.copyOf(declarations),
                    delta(!declarations.isEmpty(), sources));
        }
    }
}
