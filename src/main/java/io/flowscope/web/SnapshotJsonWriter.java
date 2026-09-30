package io.flowscope.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.AuthorizationMatrixAnalyzer;
import io.flowscope.core.DataFlowAnalyzer;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.GraphObservationFact;
import io.flowscope.core.Masking;
import io.flowscope.core.ObservationCollapser;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.Normalizer;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SurfaceAnalyzer;
import io.flowscope.core.Verdict;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.core.parameter.ParameterCoordinates;
import io.flowscope.core.parameter.ParameterExtraction;
import io.flowscope.core.parameter.ParameterExtractor;
import io.flowscope.core.parameter.ParameterKey;
import io.flowscope.core.parameter.ParameterObservation;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.SessionBroker;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Serializes the masked analysis state consumed by the bundled localhost UI. */
public final class SnapshotJsonWriter {
    private final ObjectMapper json = new ObjectMapper();
    private long surfaceRevision = Long.MIN_VALUE;
    private Pipeline.Result surfaceResult;
    private List<RouteCandidate> surfaceCandidates;
    private SurfaceAnalysis cachedSurface;

    public byte[] write(long revision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments,
                        List<ValidationDecision> validations) throws JsonProcessingException {
        return write(revision, result, config, assessments, validations, List.of(), List.of());
    }

    public byte[] write(long revision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                        List<SessionBroker.SessionView> managedSessions) throws JsonProcessingException {
        return write(revision, result, config, assessments, validations, managedSessions, List.of());
    }

    public byte[] write(long revision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                        List<SessionBroker.SessionView> managedSessions,
                        List<RouteCandidate> routeCandidates) throws JsonProcessingException {
        return write(revision, result, config, assessments, validations, managedSessions, routeCandidates, 0);
    }

    public byte[] write(long revision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                        List<SessionBroker.SessionView> managedSessions,
                        List<RouteCandidate> routeCandidates, long droppedRecords) throws JsonProcessingException {
        return write(revision, result, config, assessments, validations, managedSessions,
                routeCandidates, droppedRecords, List.of());
    }

    public byte[] write(long revision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                        List<SessionBroker.SessionView> managedSessions,
                        List<RouteCandidate> routeCandidates, long droppedRecords,
                        List<RunExecutionLedger.Summary> executionSummaries) throws JsonProcessingException {
        return write(revision, revision, result, config, assessments, validations, managedSessions,
                routeCandidates, droppedRecords, executionSummaries);
    }

    public byte[] write(long revision, long datasetRevision, Pipeline.Result result, AnalysisConfig config,
                        List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                        List<SessionBroker.SessionView> managedSessions,
                        List<RouteCandidate> routeCandidates, long droppedRecords,
                        List<RunExecutionLedger.Summary> executionSummaries) throws JsonProcessingException {
        config = config.snapshotCopy();
        ObjectNode root = json.createObjectNode();
        root.put("revision", revision);
        root.put("identityRevision", revision);
        root.put("datasetRevision", datasetRevision);
        root.put("sampleMode", !result.records.isEmpty() && result.records.stream().allMatch(record ->
                "https://demo.flowscope.test:443".equals(record.service)
                        && record.runId != null && record.runId.startsWith("demo-")));
        root.set("events", events(result));
        root.set("evidenceOrdinals", evidenceOrdinals(result));
        root.set("graphFacts", json.valueToTree(result.coverageRecords.stream()
                .map(GraphObservationFact::from).toList()));
        ObjectNode traffic = root.putObject("trafficStats");
        traffic.put("captured", result.records.size());
        traffic.put("coverage", result.coverageRecords.size());
        traffic.put("excluded", result.excludedCount);
        traffic.put("review", result.reviewCount);
        traffic.put("dropped", Math.max(0, droppedRecords));
        traffic.put("payloadMetadataOnly", result.records.stream()
                .flatMap(record -> java.util.stream.Stream.of(record.requestPayload, record.responsePayload))
                .filter(payload -> payload != null && !payload.retained()).count());
        // Attributable API traffic captured while no HUMAN pass was active. D-071 keeps it out of coverage;
        // D-155 surfaces the count so the operator sees a start-a-pass hint instead of an unexplained empty graph.
        traffic.put("humanApiOutsideRun", result.records.stream()
                .filter(record -> record.source == Source.HUMAN
                        && record.trafficClassification != null
                        && record.trafficClassification.trafficClass()
                                == io.flowscope.core.TrafficClassification.TrafficClass.API
                        && record.trafficClassification.reasons()
                                .contains(io.flowscope.core.TrafficClassifier.HUMAN_OUTSIDE_EXPLORATION_RUN))
                .count());
        root.putArray("replays");
        root.set("flowLinks", flowLinks(result.coverageRecords));
        root.set("roles", roles(result, config));
        root.set("owners", owners(result));
        root.set("ownerOverrides", json.valueToTree(config.resourceOwners()));
        ArrayNode manual = root.putArray("manualVerifications");
        for (RequestRecord record : result.records) {
            if (record.source == Source.HUMAN && record.phase == io.flowscope.core.RunPhase.VALIDATION
                    && record.originEvidenceId != null) {
                ObjectNode value = manual.addObject();
                value.put("eventId", record.evidenceId);
                value.put("originEvidenceId", record.originEvidenceId);
                value.put("operation", record.op);
                value.put("resource", record.resource);
                value.put("identity", config.identityLabel(record.idn));
                value.put("identityId", record.idn);
                value.put("timestamp", record.timestamp);
                value.put("status", record.status);
                value.put("durationMs", record.durationMillis);
            }
        }
        root.set("requiredRoles", requiredRoles(config));
        ObjectNode reviewValidation = json.createObjectNode();
        config.reviews().forEach((id, decision) -> {
            if (!decision.validationEvidenceIds().isEmpty()) reviewValidation.set(id, json.valueToTree(decision.validationEvidenceIds()));
        });
        if (!reviewValidation.isEmpty()) root.set("reviewValidationEvidence", reviewValidation);
        root.set("activeSources", json.valueToTree(result.analysis.activeSources().stream()
                .map(SnapshotJsonWriter::wire).sorted().toList()));
        root.set("cells", cells(result.analysis.cells()));
        // 판정 매트릭스(P/E/O)는 정본 cell 위의 표시 projection이다(D-144). 과거 검증은 이력 표시에만 쓴다.
        root.set("authorizationMatrix", json.valueToTree(
                AuthorizationMatrixAnalyzer.analyze(result, config, validations)));
        root.putArray("verifications");
        root.set("gaps", gaps(result.analysis.gaps()));
        root.set("scenarios", scenarios(result, config));
        ObjectNode history = root.putObject("legacyLlm");
        history.put("readOnly", true);
        history.set("assessments", json.valueToTree(assessments.stream().map(value -> Map.of(
                "id", value.id(), "type", value.type(), "verdict", value.verdict(),
                "title", Masking.maskSecrets(value.title()), "reason", Masking.maskSecrets(value.reason()),
                "evidenceIds", value.evidenceIds(), "createdAt", value.createdAt().toString())).toList()));
        history.set("validations", json.valueToTree(validations.stream().map(value -> Map.of(
                "candidateId", value.candidateId(), "verdict", value.verdict().name(),
                "reason", Masking.maskSecrets(value.reason()), "originalEvidenceIds", value.originalEvidenceIds(),
                "validationEvidenceIds", value.validationEvidenceIds(), "controlEvidenceIds", value.controlEvidenceIds(),
                "runId", value.runId(), "decidedAt", value.decidedAt().toString())).toList()));
        root.set("accounts", accounts(config, result.records));
        root.set("sessions", sessions(config, result.records));
        root.set("managedSessions", managedSessions(managedSessions));
        root.set("routeCandidates", routeCandidates(routeCandidates));
        root.set("runExecutions", json.valueToTree(executionSummaries == null ? List.of() : executionSummaries));
        root.set("surface", json.valueToTree(surface(revision, result, routeCandidates)));
        return json.writeValueAsBytes(root);
    }

    /**
     * 현재 게시본 하나만 캐시한다(revision·Pipeline.Result·route 후보 목록 동일성). 레코드 내용 fingerprint는 두지 않는다:
     * 게시본은 Pipeline.run마다 새 Result·새 revision으로 바뀌므로 같은 Result에 대한 동시 poll만 한 번 계산하면 된다.
     */
    private synchronized SurfaceAnalysis surface(long revision, Pipeline.Result result,
                                                 List<RouteCandidate> routeCandidates) {
        if (cachedSurface != null && surfaceRevision == revision && surfaceResult == result
                && surfaceCandidates == routeCandidates) {
            return cachedSurface;
        }
        SurfaceAnalysis computed = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, routeCandidates,
                result.analysis);
        surfaceRevision = revision;
        surfaceResult = result;
        surfaceCandidates = routeCandidates;
        cachedSurface = computed;
        surfaceBuilds++;
        return computed;
    }

    private int surfaceBuilds;

    /** 테스트 seam: surface projection을 실제로 계산한 횟수(캐시 적중은 세지 않는다). */
    synchronized int surfaceBuildCount() { return surfaceBuilds; }

    ArrayNode managedSessions(List<SessionBroker.SessionView> values) {
        ArrayNode out = json.createArrayNode();
        for (SessionBroker.SessionView value : values) {
            ObjectNode session = out.addObject();
            session.put("handle", value.handle());
            session.put("accountId", value.accountId());
            session.put("accountLabel", value.accountLabel());
            session.put("service", value.service());
            session.put("status", value.status().name());
            session.put("verificationSource", value.verificationSource().name());
            session.put("createdAt", value.createdAt().toString());
            if (value.lastUsedAt() == null) session.putNull("lastUsedAt");
            else session.put("lastUsedAt", value.lastUsedAt().toString());
            if (value.expiresAtHint() == null) session.putNull("expiresAtHint");
            else session.put("expiresAtHint", value.expiresAtHint().toString());
            session.put("hasAuthorization", value.hasAuthorization());
            session.put("cookieCount", value.cookieCount());
            session.put("capturing", value.capturing());
            session.put("credentialConflict", value.credentialConflict());
            session.put("replayReady", value.replayReady());
            if (value.lastRecordedAt() == null) session.putNull("lastRecordedAt");
            else session.put("lastRecordedAt", value.lastRecordedAt().toString());
        }
        return out;
    }


    private ArrayNode events(Pipeline.Result result) {
        Map<String, ObservationCollapser.Group> clusters = ObservationCollapser.byEvidence(result.records);
        Map<String, Verdict> verdicts = new LinkedHashMap<>();
        for (AuthorizationAnalysis.CoverageCell cell : result.analysis.cells()) {
            for (Map.Entry<Source, AuthorizationAnalysis.Decision> decision : cell.perSource().entrySet()) {
                verdicts.put(cell.key().stableKey() + "\u0000" + decision.getKey(), decision.getValue().verdict());
            }
        }
        ArrayNode out = json.createArrayNode();
        for (RequestRecord record : result.records) {
            ObjectNode event = out.addObject();
            event.put("eventId", record.evidenceId);
            event.put("method", record.method);
            event.put("path", record.path + (record.query == null ? "" : "?" + record.query));
            event.put("status", record.status);
            event.put("fp", record.fp);
            event.put("idn", record.idn);
            event.put("role", record.role.label());
            event.put("source", wire(record.source));
            event.put("op", record.op);
            if (record.resource == null) event.putNull("resource"); else event.put("resource", record.resource);
            event.put("timestamp", record.timestamp);
            event.put("sourceDetail", record.sourceDetail.name());
            event.put("orchestrator", record.orchestrator.name());
            event.put("tool", record.tool.name());
            event.put("phase", record.phase.name());
            event.put("executionTrust", record.executionTrust.name());
            event.put("runId", record.runId);
            if (record.laneAccountId == null) event.putNull("laneAccountId");
            else event.put("laneAccountId", record.laneAccountId);
            if (record.replayBasisIdentity != null) {
                event.put("replayBasisIdentity", record.replayBasisIdentity);
            }
            if (record.replayBasisEvidenceId != null) {
                event.put("replayBasisEvidenceId", record.replayBasisEvidenceId);
            }
            event.put("authState", record.authState.name());
            event.put("trafficClass", record.trafficClassification.trafficClass().name());
            event.put("trafficDisposition", record.trafficClassification.disposition().name());
            event.put("coverageEligible", record.trafficClassification.coverageEligible());
            event.put("classificationOverride", record.trafficClassification.userOverride());
            event.set("classificationReasons", json.valueToTree(record.trafficClassification.reasons()));
            event.put("pathTemplateStatus", record.pathTemplateStatus.name());
            event.set("pathTemplateReasons", json.valueToTree(record.pathTemplateReasons));
            ObservationCollapser.Group cluster = clusters.get(record.evidenceId);
            event.put("clusterId", cluster.id());
            event.put("repeatCount", cluster.count());
            event.put("firstSeen", cluster.firstSeen());
            event.put("lastSeen", cluster.lastSeen());
            ArrayNode objects = event.putArray("objects");
            if (!record.resourceReferences.isEmpty()) {
                for (io.flowscope.core.ResourceReference reference : record.resourceReferences) {
                    ObjectNode object = objects.addObject();
                    object.put("resource", reference.resource());
                    object.put("evidence", reference.evidence());
                }
            } else if (record.resource != null) {
                ObjectNode object = objects.addObject();
                object.put("resource", record.resource);
                object.put("evidence", Normalizer.resourceEvidence(record));
            }
            String key = new AuthorizationAnalysis.CellKey(
                    record.idn, record.op, record.resource).stableKey() + "\u0000" + record.source;
            event.put("verdict", wire(verdicts.getOrDefault(key, Verdict.UNTESTED)));
        }
        return out;
    }

    /**
     * 사람이 보기 쉬운 표시용 순번(#1, #2 …)을 Evidence ID(내용 해시 `ev-…`)에 얹는 매핑이다. 원본 ID는 역참조·중복제거 키로 유지한다.
     * 활성 프로젝트 스냅샷 단위라 프로젝트별 순번이 되며, 최초 관측(firstSeen) 순으로 정렬해 새로고침·증분 관측에도 번호가 흔들리지 않는다.
     */
    private ObjectNode evidenceOrdinals(Pipeline.Result result) {
        Map<String, ObservationCollapser.Group> clusters = ObservationCollapser.byEvidence(result.records);
        List<String> ordered = result.records.stream().map(record -> record.evidenceId).distinct()
                .sorted(Comparator.comparingLong((String id) -> clusters.get(id).firstSeen())
                        .thenComparing(Comparator.naturalOrder()))
                .toList();
        ObjectNode out = json.createObjectNode();
        int ordinal = 1;
        for (String id : ordered) out.put(id, ordinal++);
        return out;
    }

    private ArrayNode routeCandidates(List<RouteCandidate> candidates) {
        ArrayNode out = json.createArrayNode();
        for (RouteCandidate candidate : candidates) {
            ObjectNode value = out.addObject();
            value.put("service", candidate.service());
            value.put("method", candidate.method());
            value.put("pathTemplate", candidate.pathTemplate());
            value.set("concretePaths", json.valueToTree(candidate.concretePaths()));
            value.put("concretePathsTruncated", candidate.concretePathsTruncated());
            value.put("observed", candidate.observed());
            value.set("provenanceTypes", json.valueToTree(candidate.provenanceTypes().stream()
                    .map(Enum::name).sorted().toList()));
            value.set("provenanceEvidenceIds", json.valueToTree(candidate.provenanceEvidenceIds()));
            value.set("provenance", json.valueToTree(candidate.provenance().stream().map(item -> Map.of(
                    "type", item.type().name(), "evidenceId", item.evidenceId(),
                    "source", item.source().name(), "runId", item.runId(), "adapter", item.adapter(),
                    "applicability", item.applicability().name(), "reason", item.reason())).toList()));
            value.set("declaredParameters", json.valueToTree(candidate.declaredParameters().stream().map(item -> Map.of(
                    "location", item.location().name(), "fieldPath", item.fieldPath(),
                    "displayName", item.displayName(), "requirement", item.requirement().name(),
                    "evidenceId", item.evidenceId(), "source", item.source().name(),
                    "runId", item.runId(), "adapter", item.adapter(), "reason", item.reason(),
                    "coordinateVersion", item.coordinateVersion().name())).toList()));
            value.put("applicability", candidate.applicability().name());
            value.put("reviewReason", candidate.reviewReason());
            value.set("priorityReasons", json.valueToTree(RouteCandidateExtractor.priorityReasons(candidate)));
        }
        return out;
    }

    public byte[] evidence(Pipeline.Result result, String operation, int offset, int limit) throws JsonProcessingException {
        List<RequestRecord> matching = result.records.stream()
                .filter(record -> operation.equals(record.op)).toList();
        ArrayNode records = json.createArrayNode();
        matching.stream().skip(offset).limit(limit).forEach(record -> {
            ObjectNode value = records.addObject();
            value.put("eventId", record.evidenceId);
            value.put("query", masked(record.query));
            parameterEvidence(value, record);
            value.put("requestBody", masked(record.requestBodyForAnalysis()));
            value.put("request", Masking.maskHeaders(masked(record.requestTextForEvidence())));
            value.put("responseBody", masked(record.responseBodyForAnalysis()));
            value.put("response", Masking.maskHeaders(masked(record.responseTextForEvidence())));
            value.put("location", masked(record.location));
            payloadMetadata(value, "requestPayload", record.requestPayload);
            payloadMetadata(value, "responsePayload", record.responsePayload);
            value.put("trafficClass", record.trafficClassification.trafficClass().name());
            value.put("trafficDisposition", record.trafficClassification.disposition().name());
            value.set("classificationReasons", json.valueToTree(record.trafficClassification.reasons()));
        });
        ObjectNode out = json.createObjectNode();
        out.set("records", records);
        out.put("total", matching.size());
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("hasMore", (long) offset + records.size() < matching.size());
        return json.writeValueAsBytes(out);
    }

    public byte[] clusterEvidence(Pipeline.Result result, String clusterId, int offset, int limit)
            throws JsonProcessingException {
        ObservationCollapser.Group cluster = ObservationCollapser.byEvidence(result.records).values().stream()
                .filter(value -> value.id().equals(clusterId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("해당 반복 묶음을 찾을 수 없습니다."));
        List<String> page = cluster.evidenceIds().stream().skip(offset).limit(limit).toList();
        ObjectNode out = json.createObjectNode();
        out.put("clusterId", cluster.id());
        out.put("repeatCount", cluster.count());
        out.put("firstSeen", cluster.firstSeen());
        out.put("lastSeen", cluster.lastSeen());
        out.set("evidenceIds", json.valueToTree(page));
        out.put("total", cluster.evidenceIds().size());
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("hasMore", (long) offset + page.size() < cluster.evidenceIds().size());
        return json.writeValueAsBytes(out);
    }

    /**
     * PR #11 evidence contract (D-145): per-record structured parameter metadata for the request diff.
     * Derived from the same masked stored record the Surface uses; never values, preview, HTTP text or raw vault.
     * Sensitive paths are dropped, the digest is a SHA-256 of a non-sensitive value only, and the count is bounded.
     */
    private void parameterEvidence(ObjectNode value, RequestRecord record) {
        ObjectNode context = value.putObject("parameterContext");
        context.put("service", record.service);
        context.put("method", record.method);
        context.put("operation", record.op);
        context.put("identity", record.idn);
        context.put("role", record.role == null ? AccessRole.UNKNOWN.name() : record.role.name());
        context.put("source", record.source.name());
        context.put("status", record.status);
        boolean retained = record.requestPayload != null && record.requestPayload.retained();
        context.put("retention", retained ? "RETAINED" : record.requestPayload == null ? "UNKNOWN" : "METADATA_ONLY");
        ParameterExtraction extraction = ParameterExtractor.extract(record);
        // Same framing as SurfaceAnalysis.RequestContext.complete: parsed completely (deliberate sensitive omissions
        // do not count as failures, D-160) and a fully retained request.
        boolean complete = retained && extraction.parsedCompletely();
        context.put("complete", complete);
        if (!complete) context.put("completenessReason", retained ? "EXTRACTION_DIAGNOSTICS" : "REQUEST_NOT_RETAINED");
        ArrayNode observations = value.putArray("parameterObservations");
        extraction.observations().stream().limit(10_000).forEach(observation -> {
            if (Masking.isSensitiveParameterPath(observation.key().canonicalPath())) return;
            ObjectNode item = observations.addObject();
            item.set("key", parameterKey(observation.key()));
            item.put("presence", observation.presence() == null ? "UNKNOWN" : observation.presence().name());
            item.put("shape", observation.shape() == null ? "UNKNOWN" : observation.shape().name());
            ParameterObservation.ValueSummary summary = observation.value();
            item.put("valueType", summary == null ? "UNKNOWN" : summary.type().name());
            if (summary == null) item.putNull("byteLength"); else item.put("byteLength", summary.byteLength());
            String digest = summary == null ? null : summary.digest();
            if (digest != null && digest.matches("(?:sha256:)?[a-fA-F0-9]{64}")) {
                item.put("digest", digest.replaceFirst("^sha256:", ""));
            } else {
                item.putNull("digest");
            }
            // Occurrence count is folded into the context signature and is not a stored field.
            item.putNull("occurrenceCount");
            String signature = observation.contextSignature();
            if (signature != null && signature.matches("ctx:v1:sha256:[a-fA-F0-9]{64}")) {
                item.put("contextSignature", signature);
            } else {
                item.putNull("contextSignature");
            }
            item.put("confidence", observation.confidence().name());
        });
    }

    private ObjectNode parameterKey(ParameterKey key) {
        ObjectNode value = json.createObjectNode();
        value.put("service", key.service());
        value.put("method", key.method());
        value.put("operation", key.operation());
        value.put("location", ParameterCoordinates.location(key.location()).name());
        value.put("canonicalPath", key.canonicalPath());
        value.put("stableKey", key.stableKey());
        return value;
    }

    private void payloadMetadata(ObjectNode out, String field, io.flowscope.core.StoredPayload payload) {
        if (payload == null) { out.putNull(field); return; }
        ObjectNode value = out.putObject(field);
        value.put("digest", payload.digest());
        value.put("bytes", payload.originalBytes());
        value.put("retention", payload.retention().name());
        value.put("retained", payload.retained());
    }

    private ArrayNode flowLinks(List<RequestRecord> records) {
        ArrayNode out = json.createArrayNode();
        List<RequestRecord> analyzable = records.stream().filter(record -> record.source != Source.UNKNOWN).toList();
        for (DataFlowAnalyzer.Link link : DataFlowAnalyzer.analyze(analyzable)) {
            ObjectNode value = out.addObject();
            value.put("fromEventId", link.producer().evidenceId);
            value.put("toEventId", link.consumer().evidenceId);
            value.put("fromOp", link.producer().op);
            value.put("toOp", link.consumer().op);
            value.put("idn", link.consumer().idn);
            value.put("source", wire(link.consumer().source));
            value.put("values", link.value());
        }
        return out;
    }

    private ObjectNode roles(Pipeline.Result result, AnalysisConfig config) {
        ObjectNode out = json.createObjectNode();
        result.records.stream().filter(r -> r.source != Source.UNKNOWN).map(r -> r.idn).distinct().sorted()
                .forEach(identity -> out.put(identity, config.identityRole(identity).label()));
        return out;
    }

    private ArrayNode cells(List<AuthorizationAnalysis.CoverageCell> values) {
        ArrayNode out = json.createArrayNode();
        for (AuthorizationAnalysis.CoverageCell cell : values) {
            ObjectNode value = out.addObject();
            value.put("idn", cell.key().identity());
            value.put("op", cell.key().operation());
            if (cell.key().resource() == null) value.putNull("resource");
            else value.put("resource", cell.key().resource());
            ObjectNode perSource = value.putObject("perSource");
            ObjectNode reasons = value.putObject("reasons");
            cell.perSource().entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
                perSource.put(wire(entry.getKey()), wire(entry.getValue().verdict()));
                reasons.put(wire(entry.getKey()), entry.getValue().reason());
            });
            value.put("overall", wire(cell.overall()));
            value.put("conflict", cell.conflict());
            value.set("missedSources", json.valueToTree(cell.missedBy().stream()
                    .map(SnapshotJsonWriter::wire).sorted().toList()));
            value.set("evidenceIds", json.valueToTree(cell.evidenceIds()));
        }
        return out;
    }

    private ObjectNode owners(Pipeline.Result result) {
        ObjectNode out = json.createObjectNode();
        result.analysis.owners().values().stream().filter(value -> value.confirmed() && value.identity() != null)
                .sorted(Comparator.comparing(AuthorizationAnalysis.OwnerInfo::resource))
                .forEach(value -> out.put(value.resource(), value.identity()));
        return out;
    }

    private ObjectNode requiredRoles(AnalysisConfig config) {
        ObjectNode out = json.createObjectNode();
        config.endpointRequirements().entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> out.put(entry.getKey(), entry.getValue().label()));
        return out;
    }

    private ArrayNode gaps(List<AuthorizationAnalysis.Gap> values) {
        ArrayNode out = json.createArrayNode();
        for (AuthorizationAnalysis.Gap gap : values) {
            ObjectNode value = out.addObject();
            value.put("id", gap.id());
            value.put("type", gap.type().name());
            value.put("risk", gap.risk());
            value.put("idn", gap.identity());
            value.put("op", gap.operation());
            if (gap.resource() == null) value.putNull("resource"); else value.put("resource", gap.resource());
            value.set("missedSources", json.valueToTree(gap.missedBy().stream()
                    .map(SnapshotJsonWriter::wire).sorted().toList()));
            value.put("summary", gap.reason());
        }
        return out;
    }

    private ArrayNode scenarios(Pipeline.Result result, AnalysisConfig config) {
        ArrayNode out = json.createArrayNode();
        for (AuthorizationAnalysis.Finding finding : result.analysis.findings()) {
            ObjectNode value = out.addObject();
            value.put("id", finding.id());
            value.put("tag", finding.type().name());
            value.put("title", finding.title());
            value.put("proposal", finding.reason());
            value.put("evidence", String.join(", ", finding.evidenceIds()));
            value.put("risk", finding.severity().name());
            value.set("evidenceIds", json.valueToTree(finding.evidenceIds()));
            appendReview(value, config, finding.id(), finding.evidenceIds());
        }
        return out;
    }

    private void appendReview(ObjectNode value, AnalysisConfig config, String id, List<String> evidenceIds) {
        config.review(id, evidenceIds).ifPresentOrElse(review -> {
            value.put("reviewStatus", review.status().name());
            value.put("reviewNote", review.note());
        }, () -> {
            value.put("reviewStatus", "UNRESOLVED");
            value.put("reviewNote", "");
        });
    }

    private ArrayNode accounts(AnalysisConfig config, List<RequestRecord> records) {
        Map<String, Long> artifactCounts = records.stream().filter(r -> config.account(r.idn).isPresent())
                .collect(java.util.stream.Collectors.groupingBy(r -> r.idn,
                        LinkedHashMap::new, java.util.stream.Collectors.mapping(r -> r.fp,
                                java.util.stream.Collectors.collectingAndThen(java.util.stream.Collectors.toSet(), set -> (long) set.size()))));
        ArrayNode out = json.createArrayNode();
        config.accounts().values().stream().sorted(Comparator.comparing(io.flowscope.core.AccountProfile::id))
                .forEach(account -> {
                    ObjectNode value = out.addObject();
                    value.put("id", account.id());
                    value.put("label", account.label());
                    value.put("role", account.role().label());
                    value.put("target", account.service());
                    value.put("color", color(account.id()));
                    value.put("authArtifactCount", artifactCounts.getOrDefault(account.id(), 0L));
                });
        return out;
    }

    private ArrayNode sessions(AnalysisConfig config, List<RequestRecord> records) {
        record Session(String service, String fingerprint, String identity, long first, long last) {}
        Map<String, Session> sessions = new LinkedHashMap<>();
        records.stream().filter(record -> !Fingerprints.ANONYMOUS.equals(record.fp)
                && !Fingerprints.UNRESOLVED.equals(record.fp)).forEach(record -> {
            String key = record.service + "\u0000" + record.fp;
            Session previous = sessions.get(key);
            long time = record.timestamp;
            long first = previous == null ? time : minKnown(previous.first(), time);
            long last = previous == null ? time : Math.max(previous.last(), time);
            sessions.put(key, new Session(record.service, record.fp, record.idn, first, last));
        });
        ArrayNode out = json.createArrayNode();
        sessions.values().forEach(session -> {
            var account = config.boundAccount(session.service(), session.fingerprint());
            boolean registered = account.isPresent();
            ObjectNode value = out.addObject();
            value.put("fingerprint", session.fingerprint());
            value.put("idn", session.identity());
            if (registered) value.put("accountId", account.orElseThrow().id());
            else value.putNull("accountId");
            value.put("artifactKind", artifactKind(session.fingerprint()));
            value.put("evidence", "Authorization/Cookie one-way fingerprint");
            value.put("confidence", registered ? "MANUAL" : "UNASSIGNED");
            value.put("firstSeen", session.first());
            value.put("lastSeen", session.last());
            value.put("registered", registered);
            value.put("service", session.service());
        });
        return out;
    }

    private static String artifactKind(String fingerprint) {
        if (fingerprint.startsWith("sub:") || fingerprint.contains(":sub:")) return "SUBJECT_HINT";
        if (fingerprint.startsWith("tok:")) return "AUTHORIZATION";
        if (fingerprint.startsWith("sess:") || fingerprint.startsWith("ck:")) return "COOKIE";
        return "OTHER";
    }

    private static long minKnown(long left, long right) {
        if (left == 0) return right;
        if (right == 0) return left;
        return Math.min(left, right);
    }

    private static String color(String id) {
        String[] palette = {"#3D79C4", "#8B5CF6", "#0EA5A4", "#D97706", "#DC4C64", "#4F7C2B"};
        return palette[Math.floorMod(id.hashCode(), palette.length)];
    }

    private static String masked(String value) {
        return value == null ? "" : Masking.maskSecrets(value);
    }

    private static String wire(Source source) { return source.name().toLowerCase(java.util.Locale.ROOT); }
    private static String wire(Verdict verdict) { return verdict.name().toLowerCase(java.util.Locale.ROOT); }
}
