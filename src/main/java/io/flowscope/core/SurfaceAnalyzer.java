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
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

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
    /** 파라미터당 선언 상한(PR#11 definition/provenance 32). 넘으면 DECLARATION_LIMIT 진단. */
    static final int MAX_DECLARATIONS_PER_PARAMETER = 32;

    private SurfaceAnalyzer() {}

    public static SurfaceAnalysis analyze(List<RequestRecord> allRecords,
                                          List<RequestRecord> coverageRecords,
                                          List<RouteCandidate> routeCandidates) {
        return analyze(allRecords, coverageRecords, routeCandidates, AuthorizationAnalysis.empty());
    }

    /**
     * authorization은 인가 판정 정본(AuthorizationAnalysis)이며 입력→권한 대상 link·검증 cell은 그 판정을 재사용만 한다.
     * 비어 있으면 소유자·정책 판정이 없는 상태로 계산한다(ALLOW는 만들어지지 않는다).
     */
    public static SurfaceAnalysis analyze(List<RequestRecord> allRecords,
                                          List<RequestRecord> coverageRecords,
                                          List<RouteCandidate> routeCandidates,
                                          AuthorizationAnalysis authorization) {
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

        RowLedger ledger = new RowLedger();
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
            endpoint.addRow(record, ParameterExtractor.extract(record), true, ledger, parameterDiagnostics);
        }
        // VALIDATION(Request Lab 등) 응답은 discovery 사실을 늘리지 않지만 검증 cell·link에는 연결된다(PR#11).
        for (RequestRecord record : allRecords == null ? List.<RequestRecord>of() : allRecords) {
            if (record.phase != RunPhase.VALIDATION || !record.hasResponse || capabilityProbe(record)
                    || record.source != Source.HUMAN && record.source != Source.SCANNER && record.source != Source.LLM) continue;
            MutableEndpoint endpoint = endpoints.get(observedKey(record).stableKey());
            if (endpoint != null) endpoint.addRow(record, ParameterExtractor.extract(record), false, ledger, parameterDiagnostics);
        }
        for (MutableEndpoint endpoint : endpoints.values()) endpoint.applyRows(parameterDiagnostics);

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

        for (MutableEndpoint endpoint : endpoints.values()) endpoint.declarationDiagnostics(parameterDiagnostics);
        SurfaceAuthorizationLinker linker = new SurfaceAuthorizationLinker(
                endpoints.values().stream().map(endpoint -> List.copyOf(endpoint.rows.values())).toList(), authorization);
        List<SurfaceAnalysis.ParameterGap> gaps = new ArrayList<>();
        List<SurfaceAnalysis.ParameterValidationCell> cells = new ArrayList<>();
        List<EndpointFact> facts = endpoints.values().stream()
                .sorted(Comparator.comparing((MutableEndpoint endpoint) -> endpoint.key.service())
                        .thenComparing(endpoint -> endpoint.key.pathTemplate())
                        .thenComparing(endpoint -> endpoint.key.method()))
                .map(endpoint -> endpoint.freeze(parameterDiagnostics, gaps, cells, linker))
                .toList();
        gaps.sort(SurfaceAnalysis.ParameterGap.PRIORITY_ORDER);
        cells.sort(Comparator.comparing(SurfaceAuthorizationLinker::cellKey));
        return new SurfaceAnalysis(facts, extractionReports, probes, parameterDiagnostics, gaps, cells);
    }

    /** 분석 전체에서 Evidence ID는 유일하다. 같은 ID의 다른 내용은 operation이 달라도 둘 다 제외한다. */
    private static final class RowLedger {
        private final Map<String, MutableEndpoint> owners = new LinkedHashMap<>();
        private final Set<String> conflicts = new LinkedHashSet<>();
    }

    /** discovery 프로파일·Gap 분모(PR#11): coverage-eligible이며 VALIDATION/COACH_PROBE가 아닌 요청만. */
    private static boolean discovery(RequestRecord record) {
        return record.trafficClassification != null && record.trafficClassification.coverageEligible()
                && record.phase != RunPhase.VALIDATION && record.phase != RunPhase.COACH_PROBE;
    }

    private static boolean knownIdentity(String identity) {
        return identity != null && !identity.isBlank() && !identity.equalsIgnoreCase("UNKNOWN")
                && !identity.toLowerCase(Locale.ROOT).startsWith("unresolved");
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
                JsonNode operation = operationEntry.getValue();
                Map<String, JsonNode> merged = new LinkedHashMap<>();
                collectOpenApiParameters(root, pathItem.path("parameters"), merged);
                collectOpenApiParameters(root, operation.path("parameters"), merged);
                declareOpenApiParameters(endpoint, root, pathEntry.getKey(), merged.values(), provenance);
                declareTemplatePath(endpoint, pathEntry.getKey(), provenance, diagnostics);
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
            MutableParameter existing = endpoint.parameters.get(ParameterLocation.PATH + ":" + templateSlots.get(i).canonicalPath());
            if (existing != null && !existing.declarations.isEmpty()) continue; // 이름 있는 path parameter가 타입과 함께 선언함
            endpoint.parameter(ParameterLocation.PATH, templateSlots.get(i).canonicalPath(), name)
                    .declare(provenance, Requirement.REQUIRED, name);
        }
    }

    /** path-level과 operation-level parameter를 (in|name)으로 병합한다. operation-level이 override한다(PR#11 collect). */
    private static void collectOpenApiParameters(JsonNode root, JsonNode array, Map<String, JsonNode> out) {
        if (!array.isArray()) return;
        for (JsonNode raw : array) {
            JsonNode parameter = resolveLocalRef(root, raw, 0);
            if (parameter.isObject() && !parameter.path("name").asText().isBlank()) {
                out.put(parameter.path("in").asText() + "|" + parameter.path("name").asText(), parameter);
            }
        }
    }

    private static void declareOpenApiParameters(MutableEndpoint endpoint, JsonNode root, String schemaPath,
                                                 Collection<JsonNode> parameters, RouteCandidate.Provenance provenance) {
        for (JsonNode parameter : parameters) {
            String name = parameter.path("name").asText();
            String in = parameter.path("in").asText();
            // PR#11: required 미표기는 OPTIONAL. 선언 타입은 schema 또는(swagger 2) parameter 자체의 type/format.
            Requirement requirement = parameter.path("required").asBoolean(false) ? Requirement.REQUIRED : Requirement.OPTIONAL;
            JsonNode schema = parameter.has("schema") ? parameter.get("schema") : parameter;
            if (in.equals("body")) {
                declareSchema(endpoint, root, schema, "", provenance, requirement, ParameterLocation.JSON_BODY, 0,
                        new LinkedHashSet<>(), "", null);
                continue;
            }
            ParameterLocation location = switch (in) {
                case "path" -> ParameterLocation.PATH;
                case "query" -> ParameterLocation.QUERY;
                case "formData" -> ParameterLocation.FORM_BODY;
                default -> null;
            };
            if (location == null) continue;
            if (location == ParameterLocation.PATH) {
                var schemaSlots = ParameterCoordinates.pathSlots(schemaPath);
                var templateSlots = ParameterCoordinates.pathSlots(endpoint.key.pathTemplate());
                if (schemaSlots.size() != templateSlots.size()) continue; // declareTemplatePath가 정렬 실패를 진단한다
                for (int i = 0; i < schemaSlots.size(); i++) {
                    if (schemaSlots.get(i).declaredName().equals(name)) {
                        declareSchema(endpoint, root, schema, templateSlots.get(i).canonicalPath(), provenance,
                                Requirement.REQUIRED, ParameterLocation.PATH, 0, new LinkedHashSet<>(), "", name);
                    }
                }
                continue;
            }
            declareSchema(endpoint, root, schema, ParameterCoordinates.nameToken(name), provenance, requirement,
                    location, 0, new LinkedHashSet<>(), "", name);
        }
    }

    private static void declareRequestBody(MutableEndpoint endpoint, JsonNode root, JsonNode raw,
                                           RouteCandidate.Provenance provenance) {
        JsonNode requestBody = resolveLocalRef(root, raw, 0);
        if (!requestBody.isObject()) return;
        Requirement rootRequirement = requestBody.path("required").asBoolean(false) ? Requirement.REQUIRED : Requirement.OPTIONAL;
        JsonNode content = requestBody.path("content");
        if (!content.isObject()) return;
        content.properties().forEach(entry -> {
            String media = mediaType(entry.getKey());
            ParameterLocation location = media.contains("json") ? ParameterLocation.JSON_BODY
                    : media.equals("application/x-www-form-urlencoded") ? ParameterLocation.FORM_BODY
                    : media.equals("multipart/form-data") ? ParameterLocation.MULTIPART_BODY : null;
            if (location == null) return;
            declareSchema(endpoint, root, entry.getValue().path("schema"), "", provenance, rootRequirement,
                    location, 0, new LinkedHashSet<>(), "", null);
        });
    }

    /**
     * OpenAPI schema를 PR#11 정의 의미로 선언한다: local $ref만(외부·순환 거부), oneOf/anyOf 변형은 CONDITIONAL +
     * {@code union[i];} 조건, enum은 값 없이 {@code enum[i];} 인덱스별 선언, type/format→declaredType, 배열/객체→declaredShape,
     * FORM/MULTIPART의 binary/file 제외. 중첩 객체는 자식만 선언하고 배열은 필드 자체와 객체 원소 필드를 선언한다.
     */
    private static void declareSchema(MutableEndpoint endpoint, JsonNode root, JsonNode raw, String path,
                                      RouteCandidate.Provenance provenance, Requirement inherited,
                                      ParameterLocation location, int depth, Set<String> refs,
                                      String condition, String displayName) {
        if (raw == null || raw.isMissingNode() || !raw.isObject() || depth > MAX_SCHEMA_DEPTH
                || condition.length() > 512 || endpoint.parameters.size() >= MAX_PARAMETERS_PER_ENDPOINT) return;
        JsonNode schema = raw;
        if (schema.has("$ref")) {
            String ref = schema.path("$ref").asText();
            if (!ref.startsWith("#/") || ref.length() > 8_192 || refs.size() >= 32 || !refs.add(ref)) return;
            declareSchema(endpoint, root, root.at(ref.substring(1)), path, provenance, inherited, location,
                    depth + 1, refs, condition, displayName);
            return;
        }
        for (String union : List.of("oneOf", "anyOf")) {
            JsonNode variants = schema.path(union);
            if (variants.isArray()) {
                for (int i = 0; i < variants.size(); i++) {
                    declareSchema(endpoint, root, variants.get(i), path, provenance, Requirement.CONDITIONAL, location,
                            depth + 1, new LinkedHashSet<>(refs), condition + union + "[" + i + "];", displayName);
                }
                return;
            }
        }
        ValueType type = declaredType(schema);
        String typeName = schema.path("type").asText();
        if ((location == ParameterLocation.FORM_BODY || location == ParameterLocation.MULTIPART_BODY)
                && (type == ValueType.BINARY || typeName.equals("file"))) return;
        JsonNode properties = schema.path("properties");
        boolean array = typeName.equals("array");
        boolean object = properties.isObject() || typeName.equals("object");
        ValueShape shape = array ? ValueShape.ARRAY : object ? ValueShape.OBJECT : declaredShape(type);
        if (!path.isEmpty() && !properties.isObject()) {
            String label = displayName != null ? displayName : observedDisplayName(location, path, endpoint.key.pathTemplate());
            JsonNode enums = schema.path("enum");
            if (enums.isArray() && !enums.isEmpty()) {
                for (int i = 0; i < enums.size(); i++) {
                    endpoint.parameter(location, path, label).declare(provenance, inherited, label,
                            ParameterCoordinates.CoordinateVersion.FLOW_V2, true, type, shape,
                            condition + "enum[" + i + "];", SurfaceAnalysis.Confidence.INFERRED);
                }
            } else {
                endpoint.parameter(location, path, label).declare(provenance, inherited, label,
                        ParameterCoordinates.CoordinateVersion.FLOW_V2, true, type, shape, condition,
                        SurfaceAnalysis.Confidence.INFERRED);
            }
        }
        if (properties.isObject()) {
            Set<String> requiredNames = new LinkedHashSet<>();
            JsonNode required = schema.path("required");
            if (required.isArray()) for (JsonNode item : required) requiredNames.add(item.asText());
            properties.properties().forEach(entry -> {
                Requirement childRequirement = inherited == Requirement.CONDITIONAL ? Requirement.CONDITIONAL
                        : requiredNames.contains(entry.getKey()) ? Requirement.REQUIRED : Requirement.OPTIONAL;
                declareSchema(endpoint, root, entry.getValue(), ParameterCoordinates.jsonChild(path, entry.getKey()),
                        provenance, childRequirement, location, depth + 1, new LinkedHashSet<>(refs), condition, entry.getKey());
            });
        }
        if (array) {
            JsonNode items = resolveLocalRef(root, schema.path("items"), 0);
            if (items.has("properties") || items.path("type").asText().equals("object")
                    || items.has("oneOf") || items.has("anyOf") || items.has("allOf")) {
                declareSchema(endpoint, root, schema.path("items"), ParameterCoordinates.arrayElement(path), provenance,
                        inherited, location, depth + 1, new LinkedHashSet<>(refs), condition, null);
            }
        }
        JsonNode allOf = schema.path("allOf");
        if (allOf.isArray()) for (JsonNode value : allOf) {
            declareSchema(endpoint, root, value, path, provenance, inherited, location, depth + 1,
                    new LinkedHashSet<>(refs), condition, displayName);
        }
    }

    /** OpenAPI type/format → 선언 타입. type이 없으면 null(정보 없음). */
    private static ValueType declaredType(JsonNode schema) {
        if (!schema.has("type")) return null;
        return switch (schema.path("type").asText()) {
            case "string" -> switch (schema.path("format").asText()) {
                case "uuid" -> ValueType.UUID;
                case "date-time" -> ValueType.DATE_TIME;
                case "binary", "byte" -> ValueType.BINARY;
                default -> ValueType.STRING;
            };
            case "integer" -> ValueType.INTEGER;
            case "number" -> ValueType.NUMBER;
            case "boolean" -> ValueType.BOOLEAN;
            case "array", "object" -> null;
            default -> ValueType.UNKNOWN;
        };
    }

    private static ValueShape declaredShape(ValueType type) {
        if (type == null) return null;
        return switch (type) {
            case STRING, DATE_TIME -> ValueShape.STRING;
            case INTEGER -> ValueShape.INTEGER;
            case NUMBER -> ValueShape.DECIMAL;
            case BOOLEAN -> ValueShape.BOOLEAN;
            case UUID -> ValueShape.UUID;
            case BINARY -> ValueShape.BINARY;
            case UNKNOWN -> ValueShape.UNKNOWN;
        };
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
            if (!candidate.method().equalsIgnoreCase(call.method()) || "UNKNOWN".equalsIgnoreCase(call.method())
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
                                ParameterCoordinates.CoordinateVersion.FLOW_V2, coordinate.resolved(),
                                literalType(parameter.literal()), literalShape(parameter.literal()), "",
                                SurfaceAnalysis.Confidence.INFERRED);
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

    /**
     * 요청 행(PR#11 ParameterProfiler/ParameterAuthorizationAnalyzer.Row). observed는 파라미터 map key→엔진 관측.
     * fact=true(coverage 레코드)만 파라미터 사실이 되고, discovery=true만 프로파일·Gap 분모가 되며, VALIDATION 행은
     * fact=false로 검증 cell·link에만 쓰인다. complete=false(추출 진단 또는 잘린 request payload)는 긍정 관측만 남기고
     * 부재·누락의 증인이 되지 못한다.
     */
    record Row(RequestRecord record, Map<String, io.flowscope.core.parameter.ParameterObservation> observed,
               String signature, boolean complete, boolean discovery, boolean fact,
               List<io.flowscope.core.parameter.ParameterDiagnostic> diagnostics) {
        String evidenceId() { return record.evidenceId; }
    }

    private static final class MutableEndpoint {
        private final EndpointKey key;
        private final LinkedHashSet<Observation> observations = new LinkedHashSet<>();
        private final LinkedHashSet<Declaration> declarations = new LinkedHashSet<>();
        private final Map<String, MutableParameter> parameters = new LinkedHashMap<>();
        /** Evidence ID별 요청 행. 같은 ID의 같은 내용은 한 번만, 다른 내용은 둘 다 제외한다(독립 근거 아님, RowLedger). */
        private final Map<String, Row> rows = new LinkedHashMap<>();

        private MutableEndpoint(EndpointKey key) { this.key = key; }

        private String operation() { return key.method() + " " + key.pathTemplate(); }

        private void addRow(RequestRecord record, ParameterExtraction extraction, boolean fact, RowLedger ledger,
                            List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
            if (record.evidenceId == null || record.evidenceId.isBlank()) {
                if (fact) forward(record, extraction.diagnostics(), diagnostics);
                return;
            }
            if (ledger.conflicts.contains(record.evidenceId)) return;
            Map<String, io.flowscope.core.parameter.ParameterObservation> observed = new LinkedHashMap<>();
            for (io.flowscope.core.parameter.ParameterObservation observation : extraction.observations()) {
                observed.put(ParameterCoordinates.location(observation.key().location()) + ":"
                        + observation.key().canonicalPath(), observation);
            }
            String signature = observed.isEmpty()
                    ? "ctx:v1:" + digest("ctx:v1;" + record.role + ";" + record.phase + ";")
                    : observed.values().iterator().next().contextSignature();
            boolean retained = record.requestPayload == null || record.requestPayload.retained();
            Row row = new Row(record, observed, signature, extraction.diagnostics().isEmpty() && retained,
                    fact && discovery(record), fact, List.copyOf(extraction.diagnostics()));
            MutableEndpoint owner = ledger.owners.putIfAbsent(record.evidenceId, this);
            if (owner == null) {
                rows.put(record.evidenceId, row);
                return;
            }
            Row previous = owner.rows.get(record.evidenceId);
            if (owner == this && previous != null && sameEvidence(previous, row)) return; // 같은 Evidence 반복
            owner.rows.remove(record.evidenceId);
            ledger.owners.remove(record.evidenceId);
            ledger.conflicts.add(record.evidenceId);
            diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId, operation(),
                    "CONFLICTING_EVIDENCE", 1));
        }

        private static boolean sameEvidence(Row a, Row b) {
            return a.complete == b.complete && a.observed.equals(b.observed) && a.signature.equals(b.signature)
                    && a.diagnostics.equals(b.diagnostics) && a.record.source == b.record.source
                    && java.util.Objects.equals(a.record.idn, b.record.idn)
                    && java.util.Objects.equals(a.record.runId, b.record.runId);
        }

        private void forward(RequestRecord record, List<io.flowscope.core.parameter.ParameterDiagnostic> engine,
                             List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
            for (io.flowscope.core.parameter.ParameterDiagnostic diagnostic : engine) {
                diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId,
                        diagnostic.operation(), diagnostic.reasonCode(), diagnostic.droppedCount()));
            }
        }

        /** 충돌하지 않은 coverage 행의 관측을 파라미터 사실로 적재한다(입력 순서 유지). VALIDATION 행은 사실이 아니다. */
        private void applyRows(List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
            for (Row row : rows.values()) {
                if (!row.fact) continue;
                RequestRecord record = row.record;
                forward(record, row.diagnostics, diagnostics);
                if (record.requestPayload != null && !record.requestPayload.retained()) {
                    diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId, operation(),
                            "REQUEST_PAYLOAD_NOT_RETAINED", 1));
                }
                for (io.flowscope.core.parameter.ParameterObservation observation : row.observed.values()) {
                    ParameterLocation location = ParameterCoordinates.location(observation.key().location());
                    String canonical = observation.key().canonicalPath();
                    MutableParameter parameter = parameter(location, canonical,
                            observedDisplayName(location, canonical, key.pathTemplate()));
                    if (parameter.observe(observation, record.status)) {
                        diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(record.evidenceId, operation(),
                                "DISTINCT_VALUE_LIMIT", 1));
                    }
                }
            }
        }

        /** 파라미터당 선언 상한을 넘겨 버린 선언 수를 진단으로 남긴다(조용히 누락하지 않는다). */
        private void declarationDiagnostics(List<SurfaceAnalysis.ParameterDiagnostic> out) {
            for (MutableParameter parameter : parameters.values()) {
                if (parameter.droppedDeclarations > 0) {
                    // 진단의 anchor Evidence도 preview와 같은 안정 순서의 첫 선언이라 수집 순서와 무관하다.
                    String evidenceId = parameter.declarations.isEmpty() ? null
                            : Collections.min(parameter.declarations, MutableParameter.DECLARATION_ORDER).evidenceId();
                    out.add(new SurfaceAnalysis.ParameterDiagnostic(evidenceId, key.method() + " " + key.pathTemplate(),
                            "DECLARATION_LIMIT", parameter.droppedDeclarations));
                }
            }
        }

        private MutableParameter parameter(ParameterLocation location, String canonicalPath, String displayName) {
            return parameter(location, canonicalPath, displayName, true);
        }

        /**
         * resolved=false는 canonical을 확정하지 못한 선언 좌표다. key 공간을 분리("?" 접두)해 확정 좌표와 절대 join하지 않는다.
         * 확정 canonical은 항상 "/"로 시작하므로 ':' 구분자와 충돌하지 않는다.
         */
        private MutableParameter parameter(ParameterLocation location, String canonicalPath, String displayName,
                                           boolean resolved) {
            // 인증·비밀 이름의 좌표는 관측(엔진)과 마찬가지로 선언에서도 만들지 않는다(PR#11 sink 규칙).
            if (canonicalPath == null || canonicalPath.isBlank() || Masking.isSensitiveParameterPath(canonicalPath)
                    || parameters.size() >= MAX_PARAMETERS_PER_ENDPOINT) {
                return MutableParameter.IGNORED;
            }
            String key = location + ":" + (resolved ? "" : "?") + canonicalPath;
            return parameters.computeIfAbsent(key,
                    ignored -> new MutableParameter(location, canonicalPath, displayName, resolved));
        }

        private EndpointFact freeze(List<SurfaceAnalysis.ParameterDiagnostic> diagnostics,
                                    List<SurfaceAnalysis.ParameterGap> gaps,
                                    List<SurfaceAnalysis.ParameterValidationCell> cells,
                                    SurfaceAuthorizationLinker linker) {
            Set<Source> sources = observations.stream().map(Observation::source)
                    .collect(java.util.stream.Collectors.toCollection(() -> EnumSet.noneOf(Source.class)));
            // 프로파일·Gap 증인 선택은 입력 순서가 아니라 Evidence ID 순서로 결정적이다(PR#11).
            List<Row> sortedRows = rows.values().stream().sorted(Comparator.comparing(Row::evidenceId)).toList();
            List<Row> discoveryRows = sortedRows.stream().filter(Row::discovery).toList();
            List<ParameterFact> parameterFacts = new ArrayList<>();
            for (MutableParameter parameter : parameters.values().stream()
                    .sorted(Comparator.comparing((MutableParameter p) -> p.location.ordinal())
                            .thenComparing(p -> p.canonicalPath)).toList()) {
                SurfaceAnalysis.ParameterProfile profile = parameter.resolved
                        ? profile(this, parameter, discoveryRows, diagnostics)
                        : SurfaceAnalysis.ParameterProfile.EMPTY;
                List<SurfaceAnalysis.AuthorizationTargetLink> links = List.of();
                if (parameter.resolved) {
                    gaps.addAll(gaps(this, parameter, discoveryRows));
                    SurfaceAuthorizationLinker.Result linked = linker.link(
                            new SurfaceAuthorizationLinker.Parameter(key, parameter.location, parameter.canonicalPath), sortedRows);
                    links = linked.links();
                    cells.addAll(linked.cells());
                    gaps.addAll(linked.gaps());
                }
                parameterFacts.add(parameter.freeze(profile, links));
            }
            List<SurfaceAnalysis.RequestContext> contexts = sortedRows.stream().map(row -> new SurfaceAnalysis.RequestContext(
                    row.evidenceId(), row.complete(),
                    row.record().requestPayload == null || row.record().requestPayload.retained(),
                    row.discovery(), row.signature())).toList();
            return new EndpointFact(key, immutableEnumSet(Source.class, sources),
                    List.copyOf(observations), List.copyOf(declarations),
                    parameterFacts, delta(!declarations.isEmpty(), sources), endpointKinds(), contexts);
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
            return immutableEnumSet(SurfaceAnalysis.EndpointKind.class, kinds);
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

    private static ValueType literalType(JavascriptAnalysis.LiteralKind literal) {
        return switch (literal) {
            case STRING -> ValueType.STRING;
            case INTEGER -> ValueType.INTEGER;
            case NUMBER -> ValueType.NUMBER;
            case BOOLEAN -> ValueType.BOOLEAN;
            case NULL, ARRAY, OBJECT, DYNAMIC -> null;
        };
    }

    private static ValueShape literalShape(JavascriptAnalysis.LiteralKind literal) {
        return switch (literal) {
            case STRING -> ValueShape.STRING;
            case INTEGER -> ValueShape.INTEGER;
            case NUMBER -> ValueShape.DECIMAL;
            case BOOLEAN -> ValueShape.BOOLEAN;
            case NULL -> ValueShape.NULL;
            case ARRAY -> ValueShape.ARRAY;
            case OBJECT -> ValueShape.OBJECT;
            case DYNAMIC -> null;
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
        /** 상한과 무관한 모든 선언 증인 ID(정렬). DEFINED_NOT_OBSERVED gap의 전체 count·preview 근거. */
        private final TreeSet<String> declarationEvidence = new TreeSet<>();
        private final EnumSet<Requirement> requirements = EnumSet.noneOf(Requirement.class);
        private int droppedDeclarations;
        /** 상한 preview 선택 순서: 입력 순서가 아니라 Evidence ID·종류·adapter·사유·조건의 안정 순서. */
        private static final Comparator<Declaration> DECLARATION_ORDER = Comparator
                .comparing(Declaration::evidenceId, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(Declaration::type, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(Declaration::adapter, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(Declaration::reason, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(Declaration::conditionText);

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
                    presence, valueType, byteLength, masked, engineObs.contextSignature(),
                    SurfaceAnalysis.Confidence.valueOf(engineObs.confidence().name())));
            return newlyTruncated;
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name) {
            declare(provenance, requirement, name, ParameterCoordinates.CoordinateVersion.FLOW_V2, true);
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name,
                             ParameterCoordinates.CoordinateVersion version, boolean coordinateResolved) {
            declare(provenance, requirement, name, version, coordinateResolved, null, null, "",
                    SurfaceAnalysis.Confidence.INFERRED);
        }

        private void declare(RouteCandidate.Provenance provenance, Requirement requirement, String name,
                             ParameterCoordinates.CoordinateVersion version, boolean coordinateResolved,
                             ValueType declaredType, ValueShape declaredShape, String conditionText,
                             SurfaceAnalysis.Confidence confidence) {
            if (this == IGNORED) return;
            Declaration base = declaration(provenance);
            Declaration declaration = new Declaration(base.evidenceId(), base.source(), base.runId(), base.type(),
                    base.adapter(), base.reason(), version, coordinateResolved, declaredType, declaredShape,
                    conditionText, confidence);
            if (base.evidenceId() != null) declarationEvidence.add(base.evidenceId());
            if (!declarations.contains(declaration) && declarations.size() >= MAX_DECLARATIONS_PER_PARAMETER) {
                // 상한을 넘으면 입력 순서가 아니라 안정 순서로 preview를 고른다(가장 큰 항목을 밀어냄). 수집 순서 역전에도 같은 결과.
                Declaration largest = Collections.max(declarations, DECLARATION_ORDER);
                droppedDeclarations++;
                if (DECLARATION_ORDER.compare(declaration, largest) >= 0) return;
                declarations.remove(largest);
            }
            declarations.add(declaration);
            requirements.add(requirement == null ? Requirement.UNKNOWN : requirement);
            if (name != null && !name.isBlank()) displayName = name;
        }

        /** 관측 행의 파라미터 map key(확정 좌표만 관측되므로 "?" 접두는 없다). */
        private String mapKey() { return location + ":" + canonicalPath; }

        private ParameterFact freeze(SurfaceAnalysis.ParameterProfile profile,
                                     List<SurfaceAnalysis.AuthorizationTargetLink> links) {
            Requirement requirement = requirements.size() == 1 ? requirements.iterator().next() : Requirement.UNKNOWN;
            DeltaState state = resolved ? delta(!declarations.isEmpty(), sources) : DeltaState.UNRESOLVED_COORDINATE;
            return new ParameterFact(location, displayPath(location, canonicalPath, displayName, resolved), displayName,
                    requirement, immutableEnumSet(ValueShape.class, shapes),
                    immutableEnumSet(Source.class, sources), List.copyOf(evidenceIds),
                    List.copyOf(observations), List.copyOf(declarations), state, canonicalPath,
                    immutableEnumSet(ValueType.class, valueTypes), distinctDigests.size(), resolved,
                    distinctTruncated, profile, links);
        }
    }

    private static <E extends Enum<E>> Set<E> immutableEnumSet(Class<E> type, Collection<E> values) {
        EnumSet<E> copy = EnumSet.noneOf(type);
        copy.addAll(values);
        return Collections.unmodifiableSet(copy);
    }

    // ---- discovery 프로파일과 Gap (PR#11 ParameterProfiler 의미) ----

    private static final int MAX_PROFILE_CONTEXTS = 64;
    private static final int MAX_PROFILE_AXIS_VALUES = 64;
    private static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
    /** corroboration 계산에서 독립 정의 종류로 세는 선언 타입(PR#11 SourceType OPENAPI/JAVASCRIPT). */
    private static final Set<String> DEFINITION_KINDS = Set.of("OPENAPI", "JAVASCRIPT_LITERAL");

    private static SurfaceAnalysis.ParameterProfile profile(MutableEndpoint endpoint, MutableParameter parameter,
                                                            List<Row> rows,
                                                            List<SurfaceAnalysis.ParameterDiagnostic> diagnostics) {
        String mapKey = parameter.mapKey();
        Map<Source, Long> sources = new java.util.EnumMap<>(Source.class);
        Map<String, Long> identities = new java.util.TreeMap<>();
        Map<AccessRole, Long> roles = new java.util.EnumMap<>(AccessRole.class);
        Map<String, Long> runs = new java.util.TreeMap<>();
        Map<RunPhase, Long> phases = new java.util.EnumMap<>(RunPhase.class);
        EnumSet<Presence> presence = EnumSet.noneOf(Presence.class);
        Set<String> structuralShapes = new LinkedHashSet<>();
        EnumSet<ValueType> types = EnumSet.noneOf(ValueType.class);
        Map<String, Set<SurfaceAnalysis.ContextPresence>> contexts = new java.util.TreeMap<>();
        long count = 0;
        long absent = 0;
        // 선언이 있거나 완전한 긍정 관측이 하나라도 있어야 다른 완전한 요청의 부재를 "관측된 문맥에서의 부재"로 센다.
        boolean completeExpectation = !parameter.declarations.isEmpty()
                || rows.stream().anyMatch(row -> row.complete && row.observed.containsKey(mapKey));
        for (Row row : rows) {
            io.flowscope.core.parameter.ParameterObservation o = row.observed.get(mapKey);
            if (o != null) {
                count++;
                sources.merge(o.source(), 1L, Long::sum);
                if (knownIdentity(o.identity())) identities.merge(o.identity(), 1L, Long::sum);
                roles.merge(o.role(), 1L, Long::sum);
                if (o.runId() != null) runs.merge(o.runId(), 1L, Long::sum);
                phases.merge(o.phase(), 1L, Long::sum);
                presence.add(mapPresence(o.presence()));
                String structural = structuralShape(o.shape());
                if (structural != null) structuralShapes.add(structural);
                ValueType type = mapType(o.value());
                if (type != ValueType.UNKNOWN) types.add(type);
                contexts.computeIfAbsent(row.signature, ignored -> EnumSet.noneOf(SurfaceAnalysis.ContextPresence.class))
                        .add(o.presence() == io.flowscope.core.parameter.ParameterObservation.Presence.EXPLICIT_NULL
                                ? SurfaceAnalysis.ContextPresence.EXPLICIT_NULL : SurfaceAnalysis.ContextPresence.PRESENT);
            } else if (row.complete && completeExpectation) {
                absent++;
                contexts.computeIfAbsent(row.signature, ignored -> EnumSet.noneOf(SurfaceAnalysis.ContextPresence.class))
                        .add(SurfaceAnalysis.ContextPresence.ABSENT_OBSERVED_CONTEXT);
            }
        }
        // 미리보기 상한은 계수·Gap 비교를 바꾸지 않는다(원 행으로 계산). 넘친 수만 진단으로 남긴다.
        limitDiagnostic(diagnostics, endpoint, "PROFILE_CONTEXT_LIMIT", contexts.size(), MAX_PROFILE_CONTEXTS);
        limitDiagnostic(diagnostics, endpoint, "PROFILE_IDENTITY_LIMIT", identities.size(), MAX_PROFILE_AXIS_VALUES);
        limitDiagnostic(diagnostics, endpoint, "PROFILE_RUN_LIMIT", runs.size(), MAX_PROFILE_AXIS_VALUES);
        return new SurfaceAnalysis.ParameterProfile(count, sources, first(identities, MAX_PROFILE_AXIS_VALUES), roles,
                first(runs, MAX_PROFILE_AXIS_VALUES), phases, presence,
                structuralShapes.size() > 1 || types.size() > 1, absent, first(contexts, MAX_PROFILE_CONTEXTS), false);
    }

    private static List<SurfaceAnalysis.ParameterGap> gaps(MutableEndpoint endpoint, MutableParameter parameter,
                                                           List<Row> rows) {
        String mapKey = parameter.mapKey();
        List<SurfaceAnalysis.ParameterGap> result = new ArrayList<>();
        List<Row> positive = rows.stream().filter(row -> row.observed.containsKey(mapKey)).toList();
        List<Row> complete = rows.stream().filter(Row::complete).toList();
        if (positive.isEmpty()) {
            // 불완전한 요청이 하나라도 있으면 선언 미관측을 확정하지 않는다(잘린 본문에 있었을 수 있다).
            if (!parameter.declarations.isEmpty() && rows.stream().allMatch(Row::complete)) {
                result.add(gap(endpoint, parameter, 0, SurfaceAnalysis.GapType.DEFINED_NOT_OBSERVED, null, null, null, "",
                        "선언된 입력을 discovery 요청에서 관측하지 못했다. optional이면 결함이 아니다.",
                        new ArrayList<>(parameter.declarationEvidence), false));
            }
            return result;
        }
        List<Row> observed = positive.stream().filter(Row::complete).toList();
        if (observed.isEmpty()) return result;
        Map<Source, List<Row>> bySource = new java.util.EnumMap<>(Source.class);
        Map<String, List<Row>> byIdentity = new java.util.TreeMap<>();
        for (Row row : complete) {
            if (row.record.source != null) bySource.computeIfAbsent(row.record.source, ignored -> new ArrayList<>()).add(row);
            if (knownIdentity(row.record.idn)) byIdentity.computeIfAbsent(row.record.idn, ignored -> new ArrayList<>()).add(row);
        }
        EnumSet<Source> observedSources = EnumSet.noneOf(Source.class);
        Set<String> observedIdentities = new LinkedHashSet<>();
        List<Row> knownSourceRows = new ArrayList<>();
        List<Row> knownIdentityRows = new ArrayList<>();
        for (Row row : observed) {
            if (row.record.source != null && row.record.source != Source.UNKNOWN) {
                observedSources.add(row.record.source);
                knownSourceRows.add(row);
            }
            if (knownIdentity(row.record.idn)) {
                observedIdentities.add(row.record.idn);
                knownIdentityRows.add(row);
            }
        }
        for (Source source : Source.values()) {
            if (source == Source.UNKNOWN) continue;
            List<Row> target = bySource.getOrDefault(source, List.of());
            if (!target.isEmpty() && !knownSourceRows.isEmpty() && !observedSources.contains(source)) {
                result.add(gap(endpoint, parameter, observed.size(), SurfaceAnalysis.GapType.SOURCE_MISSED, null, null, source, "",
                        "이 source의 완전한 비교 가능 discovery 요청에서 입력이 관측되지 않았다.",
                        List.of(knownSourceRows.getFirst().evidenceId(), target.getFirst().evidenceId()), true));
            }
        }
        for (Map.Entry<String, List<Row>> entry : byIdentity.entrySet()) {
            if (!knownIdentityRows.isEmpty() && !observedIdentities.contains(entry.getKey())) {
                result.add(gap(endpoint, parameter, observed.size(), SurfaceAnalysis.GapType.IDENTITY_MISSED, entry.getKey(), null, null, "",
                        "이 discovery 신원의 완전한 요청에서 입력이 관측되지 않았다. 인가 결론은 아니다.",
                        List.of(knownIdentityRows.getFirst().evidenceId(), entry.getValue().getFirst().evidenceId()), false));
            }
        }
        result.addAll(typeVariantGaps(endpoint, parameter, observed));
        result.addAll(conditionGaps(endpoint, parameter, observed));
        return result;
    }

    /**
     * 선언된 형태/타입 변형 중 완전한 관측이 하나도 맞지 않는 변형(PR#11 TYPE_VARIANT_UNOBSERVED). 타입 비교는
     * JSON/GraphQL native 타입(STRING/INTEGER/NUMBER/BOOLEAN)만이며 wire 문자열·format 타입은 비교하지 않는다.
     * enum 선택지는 같은 타입이라 변형이 아니다.
     */
    private static List<SurfaceAnalysis.ParameterGap> typeVariantGaps(MutableEndpoint endpoint, MutableParameter parameter,
                                                                      List<Row> observed) {
        String mapKey = parameter.mapKey();
        List<SurfaceAnalysis.ParameterGap> result = new ArrayList<>();
        Map<String, Variant> variants = new java.util.TreeMap<>();
        Map<String, List<String>> provenance = new java.util.TreeMap<>();
        for (Declaration declaration : parameter.declarations) {
            Variant variant = new Variant(declaredStructuralShape(declaration.declaredShape()),
                    comparableType(parameter.location, declaration.declaredType()));
            if (variant.shape() == null && (variant.type() == null || variant.type() == ValueType.UNKNOWN)) continue;
            variants.putIfAbsent(variant.label(), variant);
            provenance.computeIfAbsent(variant.label(), ignored -> new ArrayList<>()).add(declaration.evidenceId());
        }
        for (Variant variant : variants.values()) {
            boolean matched = observed.stream().map(row -> row.observed.get(mapKey)).anyMatch(o ->
                    ambiguousVariant(o) || (variant.shape() == null || variant.shape().equals(structuralShape(o.shape())))
                            && (variant.type() == null || variant.type() == ValueType.UNKNOWN || o.value() != null
                            && (mapType(o.value()) == variant.type()
                            || variant.type() == ValueType.NUMBER && mapType(o.value()) == ValueType.INTEGER)));
            if (matched) continue;
            List<String> refs = new ArrayList<>();
            refs.add(observed.getFirst().evidenceId());
            refs.addAll(provenance.get(variant.label()));
            result.add(gap(endpoint, parameter, observed.size(), SurfaceAnalysis.GapType.TYPE_VARIANT_UNOBSERVED, null, null, null,
                    variant.label(), "선언된 형태/타입 변형을 관측하지 못했다: " + variant.label() + ". enum 값은 추정하지 않는다.",
                    refs, false));
        }
        return result;
    }

    /** 선언 변형 = 구조 형태(SCALAR/ARRAY/OBJECT 또는 정보 없음) × 비교 가능한 native 타입. */
    private record Variant(String shape, ValueType type) {
        private String label() { return shape + ":" + type; }
    }

    private record ContextAxis(Source source, AccessRole role, RunPhase phase) {}

    /**
     * 같은 존재 서명(contextSignature)이 독립 근거 2건 이상 반복됐는데 다른 source의 같은 role/phase 문맥에서는
     * 그 서명이 없을 때(PR#11 CONDITION_COMBINATION_UNOBSERVED). 단일 동시출현은 조건으로 보지 않는다.
     */
    private static List<SurfaceAnalysis.ParameterGap> conditionGaps(MutableEndpoint endpoint, MutableParameter parameter,
                                                                    List<Row> observed) {
        List<SurfaceAnalysis.ParameterGap> result = new ArrayList<>();
        Map<String, List<Row>> signatures = new java.util.TreeMap<>();
        Map<ContextAxis, List<Row>> contextTargets = new java.util.HashMap<>();
        Map<ContextAxis, Set<String>> targetSignatures = new java.util.HashMap<>();
        for (Row row : observed) {
            if (row.record.source == null || row.record.source == Source.UNKNOWN) continue;
            signatures.computeIfAbsent(row.signature, ignored -> new ArrayList<>()).add(row);
            ContextAxis axis = new ContextAxis(row.record.source, row.record.role, row.record.phase);
            contextTargets.computeIfAbsent(axis, ignored -> new ArrayList<>()).add(row);
            targetSignatures.computeIfAbsent(axis, ignored -> new java.util.HashSet<>()).add(row.signature);
        }
        for (Map.Entry<String, List<Row>> entry : signatures.entrySet()) {
            List<Row> support = entry.getValue();
            if (support.size() < 2) continue;
            RequestRecord context = support.getFirst().record;
            for (Source source : Source.values()) {
                if (source == Source.UNKNOWN) continue;
                ContextAxis axis = new ContextAxis(source, context.role, context.phase);
                List<Row> target = contextTargets.getOrDefault(axis, List.of());
                if (target.isEmpty() || targetSignatures.get(axis).contains(entry.getKey())) continue;
                result.add(gap(endpoint, parameter, observed.size(), SurfaceAnalysis.GapType.CONDITION_COMBINATION_UNOBSERVED, null,
                        context.role, source, entry.getKey(),
                        "반복된 존재 서명이 이 source/role/phase 문맥에서 관측되지 않았다: " + entry.getKey()
                                + ". 확인된 업무 조건은 아니다.",
                        List.of(support.get(0).evidenceId(), support.get(1).evidenceId(), target.getFirst().evidenceId()), true));
            }
        }
        return result;
    }

    private static SurfaceAnalysis.ParameterGap gap(MutableEndpoint endpoint, MutableParameter parameter, long completeEvidenceCount,
                                                    SurfaceAnalysis.GapType type, String identity, AccessRole role, Source source,
                                                    String variant, String summary, List<String> evidence, boolean sourceDiscrepancy) {
        List<String> reasons = new ArrayList<>();
        if (WRITE_METHODS.contains(endpoint.key.method())) reasons.add("WRITE_METHOD");
        // 같은 문서를 여러 번 받은 provenance는 정의 하나이지 증인 셋이 아니다: 정의 종류(OpenAPI/JS)로만 센다.
        long definitionKinds = parameter.declarations.stream().map(Declaration::type)
                .filter(DEFINITION_KINDS::contains).distinct().count();
        if (completeEvidenceCount >= 2 || completeEvidenceCount > 0 && definitionKinds > 0 || definitionKinds >= 2) {
            reasons.add("CORROBORATED_EVIDENCE");
        }
        if (sourceDiscrepancy) reasons.add("SOURCE_DISCREPANCY");
        // 권한 대상 관계 증명은 4단계 몫이다. 이름·status로 추측하지 않는다.
        reasons.add("HUMAN_REVIEW_REQUIRED");
        String stableKey = "pk:v1:" + frame(endpoint.key.service()) + frame(endpoint.key.method())
                + frame(endpoint.key.operation()) + frame(parameter.location.name()) + frame(parameter.canonicalPath);
        String coordinate = frame(stableKey) + frame(type.name()) + frame(identity)
                + frame(role == null ? null : role.name()) + frame(source == null ? null : source.name()) + frame(variant);
        return new SurfaceAnalysis.ParameterGap("pg:v1:" + digest(coordinate), type, endpoint.key, parameter.location,
                parameter.canonicalPath, identity, role, source, SurfaceAnalysis.GapStatus.OPEN, reasons, summary, evidence);
    }

    /** 표시 shape에서 구조 형태(SCALAR/ARRAY/OBJECT)만 뽑는다. NULL/UNKNOWN은 비교 대상이 아니라 null. */
    private static String structuralShape(ValueShape shape) {
        if (shape == null) return null;
        return switch (shape) {
            case ARRAY -> "ARRAY";
            case OBJECT -> "OBJECT";
            case NULL, UNKNOWN -> null;
            default -> "SCALAR";
        };
    }

    private static String declaredStructuralShape(ValueShape declared) {
        return declared == null ? null : structuralShape(declared);
    }

    /** wire 문자열은 서버 coercion 증명이 아니고 format 타입(UUID/DATE_TIME/BINARY)은 관측이 분류하지 않으므로 비교하지 않는다. */
    private static ValueType comparableType(ParameterLocation location, ValueType declared) {
        if (location != ParameterLocation.JSON_BODY && location != ParameterLocation.GRAPHQL_VARIABLE) return null;
        return declared == ValueType.STRING || declared == ValueType.INTEGER || declared == ValueType.NUMBER
                || declared == ValueType.BOOLEAN ? declared : null;
    }

    private static boolean ambiguousVariant(io.flowscope.core.parameter.ParameterObservation observation) {
        return observation == null || observation.shape() == io.flowscope.core.parameter.ParameterObservation.Shape.UNKNOWN
                || observation.shape() == io.flowscope.core.parameter.ParameterObservation.Shape.SCALAR
                && observation.value() != null
                && observation.value().type() == io.flowscope.core.parameter.ParameterObservation.ValueType.UNKNOWN;
    }

    private static String structuralShape(io.flowscope.core.parameter.ParameterObservation.Shape shape) {
        return switch (shape) {
            case ARRAY -> "ARRAY";
            case OBJECT -> "OBJECT";
            case SCALAR -> "SCALAR";
            case NULL, UNKNOWN -> null;
        };
    }

    private static <K, V> Map<K, V> first(Map<K, V> map, int limit) {
        Map<K, V> result = new LinkedHashMap<>();
        map.entrySet().stream().limit(limit).forEach(e -> result.put(e.getKey(), e.getValue()));
        return result;
    }

    private static void limitDiagnostic(List<SurfaceAnalysis.ParameterDiagnostic> diagnostics, MutableEndpoint endpoint,
                                        String reason, int count, int limit) {
        if (count > limit) diagnostics.add(new SurfaceAnalysis.ParameterDiagnostic(null, endpoint.operation(), reason, count - limit));
    }

    static String frame(String value) {
        return value == null ? "-1:" : value.getBytes(StandardCharsets.UTF_8).length + ":" + value;
    }

    /** 엔진 ValueSummary.digest와 같은 형식("sha256:" + hex)이라 exact scalar 매칭에 그대로 비교한다. */
    static String digest(String value) {
        try {
            return "sha256:" + java.util.HexFormat.of().formatHex(
                    java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }
}
