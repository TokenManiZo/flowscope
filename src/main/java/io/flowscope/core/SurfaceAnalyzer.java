package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.flowscope.core.SurfaceAnalysis.Declaration;
import io.flowscope.core.SurfaceAnalysis.DeltaState;
import io.flowscope.core.SurfaceAnalysis.EndpointFact;
import io.flowscope.core.SurfaceAnalysis.EndpointKey;
import io.flowscope.core.SurfaceAnalysis.ExtractionReport;
import io.flowscope.core.SurfaceAnalysis.ExtractionFailure;
import io.flowscope.core.SurfaceAnalysis.ExtractionIssue;
import io.flowscope.core.SurfaceAnalysis.ExtractionIssueKind;
import io.flowscope.core.SurfaceAnalysis.ExtractionStatus;
import io.flowscope.core.SurfaceAnalysis.Observation;
import io.flowscope.core.SurfaceAnalysis.ParameterFact;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterObservation;
import io.flowscope.core.SurfaceAnalysis.Requirement;
import io.flowscope.core.SurfaceAnalysis.ValueShape;
import io.flowscope.core.discovery.RouteDiscoveryDocument;
import io.flowscope.core.discovery.JavascriptAnalysis;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;
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
    private static final int MAX_PARAMETERS_PER_ENDPOINT = 1_024;
    private static final int MAX_JSON_DEPTH = 16;
    private static final int MAX_SCHEMA_DEPTH = 20;

    private SurfaceAnalyzer() {}

    public static SurfaceAnalysis analyze(List<RequestRecord> allRecords,
                                          List<RequestRecord> coverageRecords,
                                          List<RouteCandidate> routeCandidates) {
        Map<String, MutableEndpoint> endpoints = new LinkedHashMap<>();
        Map<String, RequestRecord> recordsByEvidence = new LinkedHashMap<>();
        Map<String, JavascriptAnalysis> javascriptByEvidence = new LinkedHashMap<>();
        List<ExtractionReport> extractionReports = new ArrayList<>();
        for (RequestRecord record : allRecords == null ? List.<RequestRecord>of() : allRecords) {
            if (record.evidenceId != null && !record.evidenceId.isBlank()) {
                recordsByEvidence.putIfAbsent(record.evidenceId, record);
            }
            if (javascriptArtifact(record)) {
                JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(record.responseBodyForAnalysis());
                if (record.evidenceId != null) javascriptByEvidence.put(record.evidenceId, analysis);
                extractionReports.add(new ExtractionReport(record.evidenceId, record.source, record.runId,
                        "JAVASCRIPT", "javascript-ast", extractionStatus(analysis.status()),
                        extractionFailure(analysis), analysis.detail(),
                        analysis.callSites().size(), analysis.assets().size(), analysis.issues().stream()
                        .map(issue -> new ExtractionIssue(ExtractionIssueKind.valueOf(issue.kind().name()),
                                issue.adapter(), issue.detail(), issue.line(), issue.column()))
                        .toList()));
            } else if (openApiArtifact(record)) {
                boolean parsed = parseOpenApi(record.responseBodyForAnalysis()) != null;
                extractionReports.add(new ExtractionReport(record.evidenceId, record.source, record.runId,
                        "OPENAPI", "openapi-json-yaml", parsed ? ExtractionStatus.PARSED : ExtractionStatus.FAILED,
                        parsed ? ExtractionFailure.NONE : ExtractionFailure.PARSE_FAILED,
                        parsed ? "" : "OpenAPI/Swagger document parse failed", 0, 0));
            } else if (htmlArtifact(record)) {
                extractionReports.add(new ExtractionReport(record.evidenceId, record.source, record.runId,
                        "HTML", "html-dom", ExtractionStatus.PARSED, ExtractionFailure.NONE, "", 0, 0));
            }
        }

        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            for (RouteCandidate.Provenance provenance : candidate.provenance()) {
                if (!surfaceDeclaration(candidate, provenance.type())) continue;
                EndpointKey key = new EndpointKey(candidate.service(), candidate.method(), candidate.pathTemplate());
                MutableEndpoint endpoint = endpoints.computeIfAbsent(key.stableKey(),
                        ignored -> new MutableEndpoint(key));
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
                if (!surfaceDeclaration(candidate, provenance.type())) continue;
                RequestRecord artifact = recordsByEvidence.get(provenance.evidenceId());
                if (artifact == null) continue;
                switch (provenance.type()) {
                    case OPENAPI -> declareOpenApi(endpoints, candidate, artifact, provenance);
                    case HTML_FORM -> declareHtmlForm(endpoints, candidate, artifact, provenance);
                    case JAVASCRIPT_LITERAL -> declareJavascript(endpoints, candidate, artifact, provenance,
                            javascriptByEvidence.computeIfAbsent(provenance.evidenceId(),
                                    ignored -> JavascriptCallSiteAnalyzer.analyze(artifact.responseBodyForAnalysis())));
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
        return new SurfaceAnalysis(facts, extractionReports);
    }

    private static ExtractionStatus extractionStatus(JavascriptAnalysis.Status status) {
        return switch (status) {
            case PARSED -> ExtractionStatus.PARSED;
            case PARTIAL -> ExtractionStatus.PARTIAL;
            case PARSE_FAILED -> ExtractionStatus.FAILED;
            case LIMIT_EXCEEDED -> ExtractionStatus.LIMIT_EXCEEDED;
        };
    }

    private static ExtractionFailure extractionFailure(JavascriptAnalysis analysis) {
        return switch (analysis.status()) {
            case PARSED -> ExtractionFailure.NONE;
            case PARTIAL -> ExtractionFailure.SYNTAX_RECOVERY;
            case PARSE_FAILED -> ExtractionFailure.PARSE_FAILED;
            case LIMIT_EXCEEDED -> analysis.detail().startsWith("script exceeds")
                    ? ExtractionFailure.INPUT_SIZE_LIMIT : ExtractionFailure.AST_NODE_LIMIT;
        };
    }

    private static boolean javascriptArtifact(RequestRecord record) {
        String media = mediaType(record.responseContentType);
        String path = record.path.toLowerCase(Locale.ROOT);
        return media.contains("javascript") || path.endsWith(".js") || path.endsWith(".mjs")
                || path.endsWith(".cjs");
    }

    private static boolean htmlArtifact(RequestRecord record) {
        String media = mediaType(record.responseContentType);
        String body = record.responseBodyForAnalysis();
        String leading = body == null ? "" : body.stripLeading().toLowerCase(Locale.ROOT);
        return media.equals("text/html") || media.equals("application/xhtml+xml")
                || leading.startsWith("<!doctype html") || leading.startsWith("<html");
    }

    private static boolean openApiArtifact(RequestRecord record) {
        String path = record.path.toLowerCase(Locale.ROOT);
        String body = record.responseBodyForAnalysis();
        return path.endsWith("openapi.json") || path.endsWith("openapi.yaml") || path.endsWith("openapi.yml")
                || path.endsWith("swagger.json") || path.endsWith("swagger.yaml") || path.endsWith("swagger.yml")
                || body != null && (body.contains("\"openapi\"") || body.contains("\"swagger\"")
                || body.matches("(?s)^\\s*(openapi|swagger)\\s*:.*"));
    }

    private static boolean surfaceDeclaration(RouteCandidate candidate, RouteCandidate.ProvenanceType type) {
        return type == RouteCandidate.ProvenanceType.OPENAPI
                || type == RouteCandidate.ProvenanceType.HTML_FORM
                || type == RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL
                || (type == RouteCandidate.ProvenanceType.XML_ROUTE && !candidate.method().equals("UNKNOWN"));
    }

    private static EndpointKey observedKey(RequestRecord record) {
        String prefix = record.service + " " + record.method + " ";
        String path = record.op != null && record.op.startsWith(prefix)
                ? record.op.substring(prefix.length()) : record.path;
        return new EndpointKey(record.service, record.method, path);
    }

    private static Declaration declaration(RouteCandidate.Provenance provenance) {
        return new Declaration(provenance.evidenceId(), provenance.source(), provenance.runId(),
                provenance.type().name(), provenance.adapter(), provenance.reason());
    }

    private static void observePathParameters(MutableEndpoint endpoint, RequestRecord record) {
        String pathTemplate = endpoint.key.pathTemplate();
        int operationName = pathTemplate.indexOf('#');
        if (operationName >= 0) pathTemplate = pathTemplate.substring(0, operationName);
        String[] template = pathTemplate.split("/", -1);
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
                if (graphql(record) && root.isObject()) {
                    observeJson(endpoint, record, root.path("variables"), "", 0, new int[]{0},
                            ParameterLocation.GRAPHQL_VARIABLE);
                } else {
                    observeJson(endpoint, record, root, "", 0, new int[]{0}, ParameterLocation.JSON_BODY);
                }
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
                                    String path, int depth, int[] count, ParameterLocation location) {
        if (node == null || depth > MAX_JSON_DEPTH || count[0] >= MAX_PARAMETERS_PER_ENDPOINT) return;
        if (node.isObject()) {
            if (!path.isBlank() && node.isEmpty()) {
                endpoint.parameter(location, path, path).observe(record, ValueShape.OBJECT);
                count[0]++;
            }
            node.properties().forEach(entry -> {
                if (count[0] >= MAX_PARAMETERS_PER_ENDPOINT) return;
                String child = path.isBlank() ? entry.getKey() : path + "." + entry.getKey();
                observeJson(endpoint, record, entry.getValue(), child, depth + 1, count, location);
            });
            return;
        }
        if (node.isArray()) {
            endpoint.parameter(location, path, path).observe(record, ValueShape.ARRAY);
            count[0]++;
            if (!node.isEmpty() && (node.get(0).isObject() || node.get(0).isArray())) {
                observeJson(endpoint, record, node.get(0), path + "[]", depth + 1, count, location);
            }
            return;
        }
        if (!path.isBlank()) {
            endpoint.parameter(location, path, path).observe(record, shape(node));
            count[0]++;
        }
    }

    private static boolean graphql(RequestRecord record) {
        return record.requestContentType != null && record.requestContentType.toLowerCase(Locale.ROOT).contains("graphql")
                || record.path.equalsIgnoreCase("/graphql")
                || record.op != null && record.op.contains("#");
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
                    JsonNode items = resolveLocalRef(root, value.path("items"), 0);
                    if (items.has("properties") || items.path("type").asText().equals("object")) {
                        declareSchema(endpoint, root, items, child + "[]", provenance, requirement,
                                location, depth + 1, new LinkedHashSet<>(refs));
                    }
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
            String defaultMethod = form.attr("method").isBlank()
                    ? "GET" : form.attr("method").toUpperCase(Locale.ROOT);
            String defaultAction = form.hasAttr("action") ? form.absUrl("action") : artifact.service + artifact.path;
            List<Element> matchingSubmitters = new ArrayList<>();
            boolean defaultMatches = htmlCandidateMatches(candidate, defaultMethod, defaultAction);
            for (Element submitter : form.select("button[formaction], input[formaction]")) {
                String method = submitter.attr("formmethod").isBlank()
                        ? defaultMethod : submitter.attr("formmethod").toUpperCase(Locale.ROOT);
                if (htmlCandidateMatches(candidate, method, submitter.absUrl("formaction"))) {
                    matchingSubmitters.add(submitter);
                }
            }
            if (!defaultMatches && matchingSubmitters.isEmpty()) continue;
            String method = candidate.method();
            ParameterLocation location = method.equals("GET") ? ParameterLocation.QUERY
                    : form.attr("enctype").toLowerCase(Locale.ROOT).startsWith("multipart/form-data")
                    ? ParameterLocation.MULTIPART_BODY : ParameterLocation.FORM_BODY;
            MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                    candidate.pathTemplate()).stableKey());
            if (endpoint == null) continue;
            for (Element control : form.select("input[name], select[name], textarea[name], button[name]")) {
                if (control.hasAttr("disabled")) continue;
                boolean submitControl = control.tagName().equals("button")
                        || (control.tagName().equals("input") && Set.of("submit", "image")
                        .contains(control.attr("type").toLowerCase(Locale.ROOT)));
                if (submitControl && !matchingSubmitters.contains(control)
                        && (!defaultMatches || control.hasAttr("formaction") || control.hasAttr("formmethod"))) continue;
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
                                          RequestRecord artifact, RouteCandidate.Provenance provenance,
                                          JavascriptAnalysis analysis) {
        MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                candidate.pathTemplate()).stableKey());
        if (endpoint == null) return;
        for (JavascriptAnalysis.CallSite call : analysis.callSites()) {
            if (!candidate.method().equalsIgnoreCase(call.method())
                    || !javascriptPathMatches(artifact, candidate.pathTemplate(), call.reference())) continue;
            if (call.reference().contains("{expr}")) {
                String[] segments = candidate.pathTemplate().split("/", -1);
                for (int index = 0; index < segments.length; index++) {
                    if (segments[index].equals("{id}")) {
                        endpoint.parameter(ParameterLocation.PATH, "path[" + index + "]", "dynamic expression")
                                .declare(provenance, Requirement.UNKNOWN, "dynamic expression");
                    }
                }
            }
            for (JavascriptAnalysis.Parameter parameter : call.parameters()) {
                ParameterLocation location = switch (parameter.kind()) {
                    case QUERY -> ParameterLocation.QUERY;
                    case JSON_BODY -> ParameterLocation.JSON_BODY;
                    case FORM_BODY -> ParameterLocation.FORM_BODY;
                };
                endpoint.parameter(location, parameter.name(), parameter.name())
                        .declare(provenance, Requirement.UNKNOWN, parameter.name());
            }
        }
    }

    private static boolean javascriptPathMatches(RequestRecord artifact, String candidatePath, String reference) {
        try {
            String encoded = reference.replace("{", "%7B").replace("}", "%7D");
            String path = URI.create(artifact.service + artifact.path).resolve(encoded).getPath();
            if (path == null) return false;
            String normalized = Normalizer.normalize("GET", path.replace("{expr}", "1")).op;
            String template = normalized.substring(normalized.indexOf(' ') + 1);
            return candidatePath.equals(template);
        } catch (RuntimeException ignored) {
            return false;
        }
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
