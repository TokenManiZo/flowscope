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
import io.flowscope.core.SurfaceAnalysis.Presence;
import io.flowscope.core.SurfaceAnalysis.ValueType;
import io.flowscope.core.parameter.ParameterCoordinates;
import io.flowscope.core.parameter.ParameterExtraction;
import io.flowscope.core.parameter.ParameterExtractor;
import io.flowscope.core.SurfaceAnalysis.ProbeObservation;
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

/** Evidence와 명시적 대상 산출물로부터 endpoint/parameter surface 사실을 파생한다. */
public final class SurfaceAnalyzer {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final Set<String> HTTP_METHODS = Set.of(
            "get", "post", "put", "patch", "delete", "options", "head");
    private static final int MAX_PARAMETERS_PER_ENDPOINT = 1_024;
    private static final int MAX_SCHEMA_DEPTH = 20;
    /** 파라미터별 distinct 값 digest 상한. 넘으면 count를 고정하고 truncated+DISTINCT_VALUE_LIMIT 진단을 남긴다. */
    public static final int MAX_DISTINCT_VALUES = 256;

    private SurfaceAnalyzer() {}

    public static SurfaceAnalysis analyze(List<RequestRecord> allRecords,
                                          List<RequestRecord> coverageRecords,
                                          List<RouteCandidate> routeCandidates) {
        Map<String, MutableEndpoint> endpoints = new LinkedHashMap<>();
        Map<String, RequestRecord> recordsByEvidence = new LinkedHashMap<>();
        Map<String, JavascriptAnalysis> javascriptByEvidence = new LinkedHashMap<>();
        List<ExtractionReport> extractionReports = new ArrayList<>();
        List<ProbeObservation> probes = new ArrayList<>();
        List<SurfaceAnalysis.ParameterDiagnostic> parameterDiagnostics = new ArrayList<>();
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
            if (capabilityProbe(record)) {
                probes.add(new ProbeObservation(key, record.evidenceId, record.source, record.runId,
                        record.idn, record.status));
                continue;
            }
            MutableEndpoint endpoint = endpoints.computeIfAbsent(key.stableKey(), ignored -> new MutableEndpoint(key));
            endpoint.observations.add(new Observation(record.evidenceId, record.source, record.runId, record.idn,
                    record.status, record.trafficClassification.trafficClass()));
            ParameterExtraction extraction = ParameterExtractor.extract(record);
            for (io.flowscope.core.parameter.ParameterObservation observation : extraction.observations()) {
                ParameterLocation location = ParameterCoordinates.location(observation.key().location());
                String canonical = observation.key().canonicalPath();
                MutableParameter parameter = endpoint.parameter(location, canonical,
                        observedDisplayName(location, canonical, key.pathTemplate()));
                if (parameter.observe(observation, record.status)) {
                    parameterDiagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId,
                            record.method + " " + key.pathTemplate(), "DISTINCT_VALUE_LIMIT", 1));
                }
            }
            for (io.flowscope.core.parameter.ParameterDiagnostic diagnostic : extraction.diagnostics()) {
                parameterDiagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId,
                        diagnostic.operation(), diagnostic.reasonCode(), diagnostic.droppedCount()));
            }
        }

        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            for (RouteCandidate.Provenance provenance : candidate.provenance()) {
                if (!surfaceDeclaration(candidate, provenance.type())) continue;
                RequestRecord artifact = recordsByEvidence.get(provenance.evidenceId());
                if (artifact == null) continue;
                switch (provenance.type()) {
                    case OPENAPI -> declareOpenApi(endpoints, candidate, artifact, provenance, parameterDiagnostics);
                    case HTML_FORM -> declareHtmlForm(endpoints, candidate, artifact, provenance);
                    case JAVASCRIPT_LITERAL -> declareJavascript(endpoints, candidate, artifact, provenance,
                            javascriptByEvidence.computeIfAbsent(provenance.evidenceId(),
                                    ignored -> JavascriptCallSiteAnalyzer.analyze(artifact.responseBodyForAnalysis())),
                            parameterDiagnostics);
                    default -> declareQueryLiteral(endpoints, candidate, provenance);
                }
            }
            MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                    candidate.pathTemplate()).stableKey());
            if (endpoint != null) for (RouteCandidate.DeclaredParameter parameter : candidate.declaredParameters()) {
                RouteCandidate.Provenance provenance = new RouteCandidate.Provenance(
                        RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS, parameter.evidenceId(),
                        parameter.source(), parameter.runId(), parameter.adapter(),
                        RouteCandidate.Applicability.REVIEW, parameter.reason());
                Coordinate coordinate = declaredCoordinate(parameter, candidate, parameterDiagnostics);
                endpoint.parameter(parameter.location(), coordinate.path(), parameter.displayName(), coordinate.resolved())
                        .declare(provenance, parameter.requirement(), parameter.displayName(),
                                parameter.coordinateVersion(), coordinate.resolved());
            }
        }

        List<EndpointFact> facts = endpoints.values().stream()
                .map(MutableEndpoint::freeze)
                .sorted(Comparator.comparing((EndpointFact fact) -> fact.key().service())
                        .thenComparing(fact -> fact.key().pathTemplate())
                        .thenComparing(fact -> fact.key().method()))
                .toList();
        return new SurfaceAnalysis(facts, extractionReports, probes, parameterDiagnostics);
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
            case PARSE_FAILED -> analysis.detail().startsWith("isolated JavaScript parser")
                    ? ExtractionFailure.WORKER_FAILURE : ExtractionFailure.PARSE_FAILED;
            case LIMIT_EXCEEDED -> {
                String detail = analysis.detail();
                if (detail.startsWith("script exceeds isolated worker input budget")) {
                    yield ExtractionFailure.INPUT_SIZE_LIMIT;
                }
                if (detail.startsWith("isolated JavaScript parser exceeded")) {
                    yield ExtractionFailure.WORKER_TIMEOUT;
                }
                if (detail.startsWith("isolated JavaScript index exceeds")) {
                    yield ExtractionFailure.WORKER_OUTPUT_LIMIT;
                }
                yield ExtractionFailure.AST_NODE_LIMIT;
            }
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
                || type == RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS
                || (type == RouteCandidate.ProvenanceType.XML_ROUTE && !candidate.method().equals("UNKNOWN"));
    }

    private static EndpointKey observedKey(RequestRecord record) {
        String prefix = record.service + " " + record.method + " ";
        String path = record.op != null && record.op.startsWith(prefix)
                ? record.op.substring(prefix.length()) : record.path;
        return new EndpointKey(record.service, record.method, path);
    }

    private static boolean capabilityProbe(RequestRecord record) {
        if (!"OPTIONS".equals(record.method)) return false;
        return (record.accessControlRequestMethod != null && !record.accessControlRequestMethod.isBlank())
                || (record.source == Source.LLM && record.sourceDetail == SourceDetail.LLM_EXPLORER);
    }

    private static Declaration declaration(RouteCandidate.Provenance provenance) {
        return new Declaration(provenance.evidenceId(), provenance.source(), provenance.runId(),
                provenance.type().name(), provenance.adapter(), provenance.reason());
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
                endpoint.parameter(ParameterLocation.QUERY, ParameterCoordinates.nameToken(value.name()), value.name())
                        .declare(provenance, Requirement.UNKNOWN, value.name());
            }
        }
    }

    private static void declareOpenApi(Map<String, MutableEndpoint> endpoints, RouteCandidate candidate,
                                       RequestRecord artifact, RouteCandidate.Provenance provenance,
                                       List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
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
                declareTemplatePath(endpoint, pathEntry.getKey(), provenance, diagnostics);
                declareOpenApiParameters(endpoint, root, pathEntry.getKey(), pathItem.path("parameters"), provenance);
                JsonNode operation = operationEntry.getValue();
                declareOpenApiParameters(endpoint, root, pathEntry.getKey(), operation.path("parameters"), provenance);
                declareRequestBody(endpoint, root, operation.path("requestBody"), provenance);
            });
        });
    }

    /** 선언 좌표 확정 결과. resolved=false면 path는 canonical이 아닌 원래 선언 경로이며 관측과 join하지 않는다. */
    private record Coordinate(String path, boolean resolved) {}

    /**
     * 저장/전송된 선언 파라미터의 좌표를 확정한다. FLOW_V2는 그대로, LEGACY_V1은 D-143 계약으로 변환하며
     * dot 표기 JSON처럼 무손실 변환이 불가능하면 unresolved로 두고 LEGACY_AMBIGUOUS_COORDINATE로 진단한다.
     */
    private static Coordinate declaredCoordinate(RouteCandidate.DeclaredParameter parameter, RouteCandidate candidate,
                                                 List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
        if (parameter.coordinateVersion() == ParameterCoordinates.CoordinateVersion.FLOW_V2) {
            if (parameter.location() == ParameterLocation.PATH
                    && !ParameterCoordinates.pathSlotPosition(candidate.pathTemplate(), parameter.fieldPath())) {
                // legacy path[i]가 placeholder가 아닌 위치를 가리킬 때와 같은 결과: 확정하지 않는다.
                diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(parameter.evidenceId(),
                        candidate.method() + " " + candidate.pathTemplate(), "INVALID_PATH_POSITION", 0));
                return new Coordinate(parameter.fieldPath(), false);
            }
            return new Coordinate(parameter.fieldPath(), true);
        }
        return ParameterCoordinates.legacyToCanonical(parameter.location(), parameter.fieldPath(),
                        candidate.pathTemplate())
                .map(canonical -> new Coordinate(canonical, true))
                .orElseGet(() -> {
                    diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(parameter.evidenceId(),
                            candidate.method() + " " + candidate.pathTemplate(), "LEGACY_AMBIGUOUS_COORDINATE", 0));
                    return new Coordinate(parameter.fieldPath(), false);
                });
    }

    /**
     * JS body 선언 좌표. 분석기가 AST 세그먼트를 보존했으면(중첩·배열 원소 {@code *}) 그대로 canonical pointer로
     * 확정한다. 세그먼트 없이 이미 평탄화된 점·배열 이름만 구조를 구분할 수 없어 unresolved로 남긴다(D-143).
     */
    private static Coordinate jsBodyCoordinate(JavascriptAnalysis.Parameter parameter) {
        if (parameter.segments() != null && !parameter.segments().isEmpty()) {
            String canonical = "";
            for (JavascriptAnalysis.Segment segment : parameter.segments()) {
                canonical = segment.arrayElement()
                        ? ParameterCoordinates.arrayElement(canonical)
                        : ParameterCoordinates.jsonChild(canonical, segment.key());
            }
            return new Coordinate(canonical, true);
        }
        String name = parameter.name();
        boolean ambiguous = name.indexOf('.') >= 0 || name.indexOf('[') >= 0
                || name.indexOf('*') >= 0 || name.indexOf('/') >= 0;
        return ambiguous ? new Coordinate(name, false)
                : new Coordinate(ParameterCoordinates.jsonChild("", name), true);
    }

    private static void declareTemplatePath(MutableEndpoint endpoint, String schemaPath,
                                            RouteCandidate.Provenance provenance,
                                            List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
        var templateSlots = ParameterCoordinates.pathSlots(endpoint.key.pathTemplate());
        var schemaSlots = ParameterCoordinates.pathSlots(schemaPath);
        if (schemaSlots.size() != templateSlots.size()) {
            // mounted prefix 등으로 slot 수가 달라 위치를 짝지을 수 없으면 임의 선언 대신 진단만 남긴다(D-143).
            diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(provenance.evidenceId(),
                    endpoint.key.method() + " " + endpoint.key.pathTemplate(), "UNRESOLVED_PATH_ALIGNMENT",
                    templateSlots.size()));
            return;
        }
        for (int i = 0; i < templateSlots.size(); i++) {
            String name = schemaSlots.get(i).declaredName();
            endpoint.parameter(ParameterLocation.PATH, templateSlots.get(i).canonicalPath(), name)
                    .declare(provenance, Requirement.REQUIRED, name);
        }
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
            if (location == null || location == ParameterLocation.PATH) continue;
            Requirement requirement = parameter.has("required")
                    ? (parameter.path("required").asBoolean() ? Requirement.REQUIRED : Requirement.OPTIONAL)
                    : Requirement.UNKNOWN;
            endpoint.parameter(location, ParameterCoordinates.nameToken(name), name).declare(provenance, requirement, name);
        }
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
                String child = ParameterCoordinates.jsonChild(path, entry.getKey());
                Requirement requirement = requiredNames.contains(entry.getKey())
                        ? Requirement.REQUIRED : Requirement.OPTIONAL;
                JsonNode value = entry.getValue();
                if (value.path("type").asText().equals("object") || value.has("properties") || value.has("$ref")) {
                    declareSchema(endpoint, root, value, child, provenance, requirement, location,
                            depth + 1, new LinkedHashSet<>(refs));
                } else if (value.path("type").asText().equals("array")) {
                    endpoint.parameter(location, child, entry.getKey())
                            .declare(provenance, requirement, entry.getKey());
                    JsonNode items = resolveLocalRef(root, value.path("items"), 0);
                    if (items.has("properties") || items.path("type").asText().equals("object")) {
                        declareSchema(endpoint, root, items, ParameterCoordinates.arrayElement(child), provenance, requirement,
                                location, depth + 1, new LinkedHashSet<>(refs));
                    }
                } else {
                    endpoint.parameter(location, child, entry.getKey())
                            .declare(provenance, requirement, entry.getKey());
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
                endpoint.parameter(location, ParameterCoordinates.nameToken(name), name).declare(provenance, requirement, name);
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
                                          JavascriptAnalysis analysis,
                                          List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
        MutableEndpoint endpoint = endpoints.get(new EndpointKey(candidate.service(), candidate.method(),
                candidate.pathTemplate()).stableKey());
        if (endpoint == null) return;
        for (JavascriptAnalysis.CallSite call : analysis.callSites()) {
            if (!candidate.method().equalsIgnoreCase(call.method())
                    || !javascriptPathMatches(artifact, candidate.pathTemplate(), call.reference())) continue;
            if (call.reference().contains("{expr}")) {
                for (var slot : ParameterCoordinates.pathSlots(candidate.pathTemplate())) {
                    endpoint.parameter(ParameterLocation.PATH, slot.canonicalPath(), "dynamic expression")
                            .declare(provenance, Requirement.UNKNOWN, "dynamic expression");
                }
            }
            for (JavascriptAnalysis.Parameter parameter : call.parameters()) {
                ParameterLocation location = switch (parameter.kind()) {
                    case QUERY -> ParameterLocation.QUERY;
                    case JSON_BODY -> ParameterLocation.JSON_BODY;
                    case FORM_BODY -> ParameterLocation.FORM_BODY;
                };
                Coordinate coordinate = location == ParameterLocation.JSON_BODY
                        ? jsBodyCoordinate(parameter)
                        : new Coordinate(ParameterCoordinates.nameToken(parameter.name()), true);
                if (!coordinate.resolved()) {
                    diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(provenance.evidenceId(),
                            candidate.method() + " " + candidate.pathTemplate(), "UNRESOLVED_PARAMETER_COORDINATE", 0));
                }
                endpoint.parameter(location, coordinate.path(), parameter.name(), coordinate.resolved())
                        .declare(provenance, Requirement.UNKNOWN, parameter.name(),
                                ParameterCoordinates.CoordinateVersion.FLOW_V2, coordinate.resolved());
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

        private MutableParameter parameter(ParameterLocation location, String canonicalPath, String displayName) {
            return parameter(location, canonicalPath, displayName, true);
        }

        /**
         * resolved=false는 canonical을 확정하지 못한 선언 좌표다. key 공간을 분리("?" 접두)해 확정 좌표와 절대 join하지 않는다.
         * 확정 canonical은 항상 "/"로 시작하므로 ':' 구분자와 충돌하지 않는다.
         */
        private MutableParameter parameter(ParameterLocation location, String canonicalPath, String displayName,
                                           boolean resolved) {
            if (canonicalPath == null || canonicalPath.isBlank() || parameters.size() >= MAX_PARAMETERS_PER_ENDPOINT) {
                return MutableParameter.IGNORED;
            }
            String key = location + ":" + (resolved ? "" : "?") + canonicalPath;
            return parameters.computeIfAbsent(key,
                    ignored -> new MutableParameter(location, canonicalPath, displayName, resolved));
        }

        private EndpointFact freeze() {
            Set<Source> sources = observations.stream().map(Observation::source)
                    .collect(java.util.stream.Collectors.toCollection(() -> EnumSet.noneOf(Source.class)));
            List<ParameterFact> parameterFacts = parameters.values().stream().map(MutableParameter::freeze)
                    .sorted(Comparator.comparing((ParameterFact fact) -> fact.location().ordinal())
                            .thenComparing(ParameterFact::canonicalPath)).toList();
            return new EndpointFact(key, Set.copyOf(sources), List.copyOf(observations), List.copyOf(declarations),
                    parameterFacts, delta(!declarations.isEmpty(), sources), endpointKinds());
        }

        private Set<SurfaceAnalysis.EndpointKind> endpointKinds() {
            EnumSet<SurfaceAnalysis.EndpointKind> kinds = EnumSet.noneOf(SurfaceAnalysis.EndpointKind.class);
            for (Observation observation : observations) {
                switch (observation.trafficClass()) {
                    case API, AUTH_SESSION, POLLING, BACKGROUND, TELEMETRY_CANDIDATE ->
                            kinds.add(SurfaceAnalysis.EndpointKind.OBSERVED_API);
                    case NAVIGATION -> kinds.add(SurfaceAnalysis.EndpointKind.NAVIGATION);
                    case STATIC_ASSET -> kinds.add(SurfaceAnalysis.EndpointKind.STATIC_ASSET);
                    case DISCOVERY_METADATA -> kinds.add(SurfaceAnalysis.EndpointKind.DISCOVERY_DOCUMENT);
                    default -> { }
                }
            }
            for (Declaration declaration : declarations) {
                switch (declaration.type()) {
                    case "OPENAPI", "JAVASCRIPT_LITERAL", "LLM_ARTIFACT_ANALYSIS", "XML_ROUTE" ->
                            kinds.add(SurfaceAnalysis.EndpointKind.ARTIFACT_API);
                    case "HTML_FORM" -> kinds.add(SurfaceAnalysis.EndpointKind.FORM_ACTION);
                    case "HTML_SCRIPT", "SCRIPT_DEPENDENCY", "FRAMEWORK_MANIFEST_ASSET" ->
                            kinds.add(SurfaceAnalysis.EndpointKind.STATIC_ASSET);
                    default -> { }
                }
            }
            if (kinds.isEmpty()) kinds.add(SurfaceAnalysis.EndpointKind.UNVERIFIED);
            return Set.copyOf(kinds);
        }
    }

    private static Presence mapPresence(io.flowscope.core.parameter.ParameterObservation.Presence presence) {
        return presence == io.flowscope.core.parameter.ParameterObservation.Presence.EXPLICIT_NULL
                ? Presence.EXPLICIT_NULL : Presence.PRESENT;
    }

    private static ValueType mapType(io.flowscope.core.parameter.ParameterObservation.ValueSummary value) {
        if (value == null) return ValueType.UNKNOWN;
        return switch (value.type()) {
            case STRING -> ValueType.STRING;
            case INTEGER -> ValueType.INTEGER;
            case NUMBER -> ValueType.NUMBER;
            case BOOLEAN -> ValueType.BOOLEAN;
            case UUID -> ValueType.UUID;
            case DATE_TIME -> ValueType.DATE_TIME;
            case BINARY -> ValueType.BINARY;
            case UNKNOWN -> ValueType.UNKNOWN;
        };
    }

    /**
     * 표시용 shape. 실제 타입이 있는 JSON/GraphQL은 타입 기준이며 UUID 형식만 승격한다(숫자형 문자열 "1"은 STRING 유지).
     * wire 위치(PATH/QUERY/FORM/MULTIPART/HEADER/XML)는 타입이 항상 STRING이므로 형식 신호로 INTEGER/UUID 등을 표시한다.
     */
    private static ValueShape mapShape(ParameterLocation location,
                                       io.flowscope.core.parameter.ParameterObservation.Shape shape, ValueType type,
                                       io.flowscope.core.parameter.ParameterObservation.Format format) {
        return switch (shape) {
            case OBJECT -> ValueShape.OBJECT;
            case ARRAY -> ValueShape.ARRAY;
            case NULL -> ValueShape.NULL;
            case UNKNOWN -> ValueShape.UNKNOWN;
            case SCALAR -> switch (type) {
                case STRING, DATE_TIME -> {
                    boolean wire = location != ParameterLocation.JSON_BODY && location != ParameterLocation.GRAPHQL_VARIABLE;
                    yield switch (format) {
                        case UUID -> ValueShape.UUID;
                        case INTEGER_LIKE -> wire ? ValueShape.INTEGER : ValueShape.STRING;
                        case DECIMAL_LIKE -> wire ? ValueShape.DECIMAL : ValueShape.STRING;
                        case BOOLEAN_LIKE -> wire ? ValueShape.BOOLEAN : ValueShape.STRING;
                        case NONE -> ValueShape.STRING;
                    };
                }
                case INTEGER -> ValueShape.INTEGER;
                case NUMBER -> ValueShape.DECIMAL;
                case BOOLEAN -> ValueShape.BOOLEAN;
                case UUID -> ValueShape.UUID;
                case BINARY -> ValueShape.BINARY;
                case UNKNOWN -> ValueShape.UNKNOWN;
            };
        };
    }

    /** 관측 전용 파라미터의 사람 라벨: PATH는 endpoint template placeholder 이름, 그 외는 canonical의 마지막 세그먼트. */
    private static String observedDisplayName(ParameterLocation location, String canonicalPath, String pathTemplate) {
        if (location == ParameterLocation.PATH) {
            for (var slot : ParameterCoordinates.pathSlots(pathTemplate)) {
                if (slot.canonicalPath().equals(canonicalPath)) return slot.declaredName();
            }
            return canonicalPath;
        }
        String leaf = canonicalPath;
        for (String segment : canonicalPath.split("/")) {
            if (!segment.isEmpty() && !segment.equals(ParameterCoordinates.ARRAY_WILDCARD)) leaf = segment;
        }
        return unescape(leaf);
    }

    /**
     * 사람이 읽는 표시 경로(fieldPath). 기계 join key는 canonicalPath에만 둔다.
     * PATH→선언명, JSON/GraphQL→{@code parent.child}·배열 {@code parent[].child}, 그 외→이스케이프 해제한 이름.
     */
    private static String displayPath(ParameterLocation location, String canonicalPath, String displayName,
                                      boolean resolved) {
        if (!resolved) return canonicalPath;
        if (location == ParameterLocation.PATH) {
            return displayName == null || displayName.isBlank() ? canonicalPath : displayName;
        }
        String body = canonicalPath.startsWith("/") ? canonicalPath.substring(1) : canonicalPath;
        if (location != ParameterLocation.JSON_BODY && location != ParameterLocation.GRAPHQL_VARIABLE) {
            return location == ParameterLocation.XML_PATH ? body : unescape(body);
        }
        StringBuilder out = new StringBuilder();
        for (String segment : body.split("/")) {
            if (segment.equals(ParameterCoordinates.ARRAY_WILDCARD)) { out.append("[]"); continue; }
            if (!out.isEmpty()) out.append('.');
            out.append(unescape(segment));
        }
        return out.toString();
    }

    /** FlowScope pointer 이스케이프 해제(~1→/, ~2→* 뒤에 ~0→~). */
    private static String unescape(String token) {
        return token.replace("~1", "/").replace("~2", "*").replace("~0", "~");
    }

    private static final class MutableParameter {
        private static final MutableParameter IGNORED = new MutableParameter(null, "", "", true);
        private final ParameterLocation location;
        private final String canonicalPath;
        private final boolean resolved;
        private String displayName;
        private final EnumSet<ValueShape> shapes = EnumSet.noneOf(ValueShape.class);
        private final EnumSet<ValueType> valueTypes = EnumSet.noneOf(ValueType.class);
        private final LinkedHashSet<String> distinctDigests = new LinkedHashSet<>();
        private boolean distinctTruncated;
        private final EnumSet<Source> sources = EnumSet.noneOf(Source.class);
        private final LinkedHashSet<String> evidenceIds = new LinkedHashSet<>();
        private final LinkedHashSet<ParameterObservation> observations = new LinkedHashSet<>();
        private final LinkedHashSet<Declaration> declarations = new LinkedHashSet<>();
        private final EnumSet<Requirement> requirements = EnumSet.noneOf(Requirement.class);

        private MutableParameter(ParameterLocation location, String canonicalPath, String displayName,
                                 boolean resolved) {
            this.location = location;
            this.canonicalPath = canonicalPath;
            this.displayName = displayName;
            this.resolved = resolved;
        }

        /** @return 이 관측이 distinct 값 집합을 처음으로 MAX_DISTINCT_VALUES 밖으로 밀어냈으면 true(진단 1회용). */
        private boolean observe(io.flowscope.core.parameter.ParameterObservation engineObs, int status) {
            if (this == IGNORED) return false;
            sources.add(engineObs.source());
            if (engineObs.evidenceId() != null) evidenceIds.add(engineObs.evidenceId());
            ValueType valueType = mapType(engineObs.value());
            ValueShape observedShape = mapShape(location, engineObs.shape(), valueType, engineObs.value() == null
                    ? io.flowscope.core.parameter.ParameterObservation.Format.NONE : engineObs.value().format());
            Presence presence = mapPresence(engineObs.presence());
            shapes.add(observedShape);
            valueTypes.add(valueType);
            int byteLength = engineObs.value() == null ? 0 : engineObs.value().byteLength();
            boolean masked = engineObs.value() != null && engineObs.value().maskedPreview() != null
                    && engineObs.value().maskedPreview().contains("***MASKED***");
            boolean newlyTruncated = false;
            // 엔진 digest는 원문 스칼라 기준(PR#11 권한 연결의 exact scalar 매칭 계약)이라 "1"과 1이 같다.
            // distinct 계수는 실제 타입을 키에 포함해 타입 차이를 보존한다.
            String digest = engineObs.value() == null || engineObs.value().digest() == null
                    ? null : valueType.name() + ":" + engineObs.value().digest();
            if (digest != null && !distinctDigests.contains(digest)) {
                if (distinctDigests.size() < MAX_DISTINCT_VALUES) distinctDigests.add(digest);
                else if (!distinctTruncated) { distinctTruncated = true; newlyTruncated = true; }
            }
            observations.add(new ParameterObservation(engineObs.evidenceId(), engineObs.source(), engineObs.runId(),
                    engineObs.identity(), status, observedShape, engineObs.role(), engineObs.phase(),
                    presence, valueType, byteLength, masked, engineObs.contextSignature()));
            return newlyTruncated;
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name) {
            declare(provenance, requirement, name, ParameterCoordinates.CoordinateVersion.FLOW_V2, true);
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name,
                             ParameterCoordinates.CoordinateVersion version, boolean coordinateResolved) {
            if (this == IGNORED) return;
            Declaration base = declaration(provenance);
            declarations.add(new Declaration(base.evidenceId(), base.source(), base.runId(), base.type(),
                    base.adapter(), base.reason(), version, coordinateResolved));
            requirements.add(requirement == null ? Requirement.UNKNOWN : requirement);
            if (name != null && !name.isBlank()) displayName = name;
        }

        private ParameterFact freeze() {
            Requirement requirement = requirements.size() == 1 ? requirements.iterator().next() : Requirement.UNKNOWN;
            DeltaState state = resolved ? delta(!declarations.isEmpty(), sources) : DeltaState.UNRESOLVED_COORDINATE;
            return new ParameterFact(location, displayPath(location, canonicalPath, displayName, resolved), displayName,
                    requirement, Set.copyOf(shapes), Set.copyOf(sources), List.copyOf(evidenceIds),
                    List.copyOf(observations), List.copyOf(declarations), state, canonicalPath,
                    Set.copyOf(valueTypes), distinctDigests.size(), resolved, distinctTruncated);
        }
    }
}
