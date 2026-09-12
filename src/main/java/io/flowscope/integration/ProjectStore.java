package io.flowscope.integration;

import io.flowscope.core.LegacyAssessment;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.*;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Versioned, masked FlowScope session file. Model-provider credentials are never part of this schema. */
public final class ProjectStore {
    /** A diagnostic workspace's user-visible identity. Secrets are never part of this metadata. */
    public record ProjectContext(String name, List<String> scope, Instant createdAt) {
        public ProjectContext {
            name = name == null ? "" : name.trim();
            scope = List.copyOf(scope == null ? List.of() : scope);
            createdAt = createdAt == null ? Instant.EPOCH : createdAt;
        }

        public static ProjectContext empty() {
            return new ProjectContext("", List.of(), Instant.EPOCH);
        }

        public boolean present() {
            return !name.isBlank() || !scope.isEmpty() || !Instant.EPOCH.equals(createdAt);
        }
    }

    public record ProjectData(List<RequestRecord> records, AnalysisConfig config,
                              List<LegacyAssessment> assessments,
                              List<ValidationDecision> validations,
                              Set<Source> completedLanes,
                              Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                              List<RouteCandidate> routeCandidates,
                              List<RunExecutionLedger.Attempt> runAttempts,
                              ProjectContext context) {}

    private static final int SCHEMA_VERSION = 5;
    private static final Set<Integer> LEGACY_SCHEMA_VERSIONS = Set.of(1, 2, 3, 4);
    private static final int MAX_RECORDS = 20_000;
    private static final long MAX_FILE_BYTES = 100L * 1024 * 1024;
    private static final int MAX_TEXT = 8192;
    /** Large masked discovery artifacts may be retained up to the Explorer response limit. */
    private static final int MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
    private final ObjectMapper json = new ObjectMapper();
    private final long maxRestoredPayloadBytes;

    public ProjectStore() {
        this(Math.max((long) MAX_PAYLOAD_BYTES, Long.getLong(
                "flowscope.payload.expandedBytes", 512L * 1024 * 1024)));
    }

    private ProjectStore(long maxRestoredPayloadBytes) {
        if (maxRestoredPayloadBytes < MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("restored payload limit must allow one retained payload");
        }
        this.maxRestoredPayloadBytes = maxRestoredPayloadBytes;
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments) throws IOException {
        save(target, records, config, assessments, List.of(), Set.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations) throws IOException {
        save(target, records, config, assessments, validations, Set.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Set<Source> completedLanes) throws IOException {
        save(target, records, config, assessments, validations, completedLanes, List.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Set<Source> completedLanes,
                     List<RouteCandidate> routeCandidates) throws IOException {
        ObjectNode root = toDocument(records, config, assessments, validations,
                completedLanes, Map.of(), routeCandidates);
        saveDocument(target, root);
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates) throws IOException {
        Map<Source, RunContextRegistry.CompletedRun> runs = completedRuns == null ? Map.of() : completedRuns;
        ObjectNode root = toDocument(records, config, assessments, validations,
                runs.keySet(), runs, routeCandidates, List.of());
        saveDocument(target, root);
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates,
                     List<RunExecutionLedger.Attempt> runAttempts) throws IOException {
        save(target, records, config, assessments, validations, completedRuns, routeCandidates,
                runAttempts, ProjectContext.empty());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates,
                     List<RunExecutionLedger.Attempt> runAttempts,
                     ProjectContext context) throws IOException {
        Map<Source, RunContextRegistry.CompletedRun> runs = completedRuns == null ? Map.of() : completedRuns;
        ObjectNode root = toDocument(records, config, assessments, validations,
                runs.keySet(), runs, routeCandidates, runAttempts, context);
        saveDocument(target, root);
    }

    private void saveDocument(Path target, ObjectNode root) throws IOException {
        Path absolute = target.toAbsolutePath().normalize();
        Path parent = absolute.getParent();
        if (parent == null) throw new IllegalArgumentException("project file needs a parent directory");
        Files.createDirectories(parent);
        Path temporary = Files.createTempFile(parent, ".flowscope-", ".tmp");
        try {
            json.writerWithDefaultPrettyPrinter().writeValue(temporary.toFile(), root);
            if (Files.size(temporary) > MAX_FILE_BYTES) {
                throw new IllegalArgumentException("project file exceeds 100 MiB");
            }
            try {
                Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, absolute, StandardCopyOption.REPLACE_EXISTING);
            }
            restrictPermissions(absolute);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    ObjectNode toDocument(List<RequestRecord> records, AnalysisConfig config,
                          List<LegacyAssessment> assessments,
                          List<ValidationDecision> validations,
                          Set<Source> completedLanes,
                          List<RouteCandidate> routeCandidates) {
        return toDocument(records, config, assessments, validations, completedLanes, Map.of(), routeCandidates);
    }

    ObjectNode toDocument(List<RequestRecord> records, AnalysisConfig config,
                          List<LegacyAssessment> assessments,
                          List<ValidationDecision> validations,
                          Set<Source> completedLanes,
                          Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                          List<RouteCandidate> routeCandidates) {
        return toDocument(records, config, assessments, validations, completedLanes, completedRuns,
                routeCandidates, List.of());
    }

    ObjectNode toDocument(List<RequestRecord> records, AnalysisConfig config,
                          List<LegacyAssessment> assessments,
                          List<ValidationDecision> validations,
                          Set<Source> completedLanes,
                          Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                          List<RouteCandidate> routeCandidates,
                          List<RunExecutionLedger.Attempt> runAttempts) {
        return toDocument(records, config, assessments, validations, completedLanes, completedRuns,
                routeCandidates, runAttempts, ProjectContext.empty());
    }

    ObjectNode toDocument(List<RequestRecord> records, AnalysisConfig config,
                          List<LegacyAssessment> assessments,
                          List<ValidationDecision> validations,
                          Set<Source> completedLanes,
                          Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                          List<RouteCandidate> routeCandidates,
                          List<RunExecutionLedger.Attempt> runAttempts,
                          ProjectContext context) {
        if (records.size() > MAX_RECORDS) throw new IllegalArgumentException("record limit exceeded");
        assessments = assessments == null ? List.of() : List.copyOf(assessments);
        LegacyAssessment.validateSet(assessments);
        config = config.snapshotCopy();
        EvidenceIds.assign(records);
        ObjectNode root = json.createObjectNode();
        root.put("schema_version", SCHEMA_VERSION);
        root.put("traffic_classifier_version", TrafficClassifier.VERSION);
        root.put("saved_at", Instant.now().toString());
        ProjectContext safeContext = context == null ? ProjectContext.empty() : context;
        ObjectNode savedProject = root.putObject("project");
        savedProject.put("name", safeContext.name());
        savedProject.set("scope", json.valueToTree(safeContext.scope()));
        savedProject.put("created_at", safeContext.createdAt().toString());
        List<RunContextRegistry.CompletedRun> exactRuns =
                (completedRuns == null ? Map.<Source, RunContextRegistry.CompletedRun>of() : completedRuns)
                        .entrySet().stream().sorted(java.util.Map.Entry.comparingByKey())
                        .map(entry -> {
                            RunContextRegistry.CompletedRun run = entry.getValue();
                            if (run == null || entry.getKey() != run.source() || !validCompletedRun(run)) {
                                throw new IllegalArgumentException("invalid exact completed run: " + entry.getKey());
                            }
                            return run;
                        }).toList();
        ArrayNode savedLanes = root.putArray("completed_lanes");
        exactRuns.stream().map(RunContextRegistry.CompletedRun::source)
                .map(Enum::name).forEach(savedLanes::add);
        ArrayNode savedRuns = root.putArray("completed_runs");
        exactRuns.forEach(run -> savedRuns.add(writeCompletedRun(run)));
        ArrayNode savedRecords = root.putArray("records");
        ObjectNode payloads = root.putObject("payloads");
        for (RequestRecord record : records) savedRecords.add(writeRecord(record, payloads));
        ArrayNode savedRouteCandidates = root.putArray("route_candidates");
        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            savedRouteCandidates.add(writeRouteCandidate(candidate));
        }
        ArrayNode savedAttempts = root.putArray("run_attempts");
        List<RunExecutionLedger.Attempt> attempts = runAttempts == null ? List.of() : List.copyOf(runAttempts);
        if (attempts.size() > 5_000) throw new IllegalArgumentException("run attempt limit exceeded");
        for (RunExecutionLedger.Attempt attempt : attempts) {
            savedAttempts.add(writeRunAttempt(attempt));
        }
        root.set("policy", writePolicy(config));
        ArrayNode savedReviews = root.putArray("reviews");
        config.reviews().values().stream().sorted(java.util.Comparator.comparing(ReviewDecision::itemId))
                .forEach(review -> savedReviews.add(writeReview(review)));
        ArrayNode savedAssessments = root.putArray("assessments");
        for (LegacyAssessment assessment : assessments) savedAssessments.add(writeAssessment(assessment));
        ArrayNode savedValidations = root.putArray("validations");
        for (ValidationDecision validation : validations) savedValidations.add(writeValidation(validation));
        return root;
    }

    public ProjectData load(Path source) throws IOException {
        long size = Files.size(source);
        if (size > MAX_FILE_BYTES) throw new IllegalArgumentException("project file exceeds 100 MiB");
        return fromDocument(json.readTree(Files.readAllBytes(source)));
    }

    ProjectData fromDocument(JsonNode root) {
        int schemaVersion = root.path("schema_version").asInt(-1);
        if (schemaVersion != SCHEMA_VERSION && !LEGACY_SCHEMA_VERSIONS.contains(schemaVersion)) {
            throw new IllegalArgumentException("unsupported FlowScope schema version");
        }
        JsonNode recordNodes = root.path("records");
        if (!recordNodes.isArray() || recordNodes.size() > MAX_RECORDS) {
            throw new IllegalArgumentException("invalid records array");
        }
        List<RequestRecord> records = new ArrayList<>();
        JsonNode payloads = root.path("payloads");
        Map<String, StoredPayload> restoredPayloads = new java.util.HashMap<>();
        long[] restoredPayloadBytes = {0};
        for (JsonNode value : recordNodes) {
            records.add(readRecord(value, payloads, restoredPayloads, restoredPayloadBytes));
        }
        AnalysisConfig config = readPolicy(root.path("policy"));
        JsonNode reviewNodes = root.path("reviews");
        if (reviewNodes.isArray()) {
            if (reviewNodes.size() > 2_000) throw new IllegalArgumentException("review limit exceeded");
            for (JsonNode value : reviewNodes) config.restoreReview(readReview(value));
        }
        List<LegacyAssessment> assessments = new ArrayList<>();
        JsonNode assessmentNodes = root.path("assessments");
        if (assessmentNodes.isArray()) {
            if (assessmentNodes.size() > 1_000) throw new IllegalArgumentException("assessment limit exceeded");
            for (JsonNode value : assessmentNodes) assessments.add(readAssessment(value));
        }
        LegacyAssessment.validateSet(assessments);
        List<ValidationDecision> validations = new ArrayList<>();
        JsonNode validationNodes = root.path("validations");
        if (validationNodes.isArray()) {
            if (validationNodes.size() > 1_000) throw new IllegalArgumentException("validation limit exceeded");
            for (JsonNode value : validationNodes) validations.add(readValidation(value));
        }
        Set<Source> completedLanes = java.util.EnumSet.noneOf(Source.class);
        JsonNode laneNodes = root.path("completed_lanes");
        if (laneNodes.isArray()) for (JsonNode value : laneNodes) {
            Source lane = enumValue(Source.class, value.asText());
            if (lane == Source.HUMAN || lane == Source.SCANNER || lane == Source.LLM) completedLanes.add(lane);
        }
        Map<Source, RunContextRegistry.CompletedRun> completedRuns = new java.util.EnumMap<>(Source.class);
        JsonNode runNodes = root.path("completed_runs");
        // completed_runs is defined by v3. Legacy documents cannot acquire trusted completion by
        // carrying an unknown future field or by changing only their schema_version value.
        if (schemaVersion >= 3 && runNodes.isArray()) {
            if (runNodes.size() > 3) throw new IllegalArgumentException("completed run limit exceeded");
            for (JsonNode value : runNodes) {
                RunContextRegistry.CompletedRun run = readCompletedRun(value);
                if (completedRuns.putIfAbsent(run.source(), run) != null) {
                    throw new IllegalArgumentException("duplicate completed run source");
                }
            }
        }
        if (schemaVersion >= 3 && !completedLanes.equals(completedRuns.keySet())) {
            throw new IllegalArgumentException("completed lanes do not match exact completed runs");
        }
        List<RouteCandidate> routeCandidates = new ArrayList<>();
        JsonNode candidateNodes = root.path("route_candidates");
        if (candidateNodes.isArray()) {
            if (candidateNodes.size() > MAX_RECORDS) throw new IllegalArgumentException("route candidate limit exceeded");
            for (JsonNode value : candidateNodes) routeCandidates.add(readRouteCandidate(value));
        }
        List<RunExecutionLedger.Attempt> runAttempts = new ArrayList<>();
        JsonNode attemptNodes = root.path("run_attempts");
        if (schemaVersion >= 4 && !attemptNodes.isArray()) {
            throw new IllegalArgumentException("invalid run attempts array");
        }
        if (schemaVersion >= 4) {
            if (attemptNodes.size() > 5_000) throw new IllegalArgumentException("run attempt limit exceeded");
            for (JsonNode value : attemptNodes) runAttempts.add(readRunAttempt(value));
        }
        ProjectContext context = ProjectContext.empty();
        JsonNode projectNode = root.path("project");
        if (schemaVersion >= 5) {
            if (!projectNode.isObject()) throw new IllegalArgumentException("invalid project context");
            JsonNode scopeNode = projectNode.path("scope");
            if (!scopeNode.isArray()) throw new IllegalArgumentException("invalid project scope");
            List<String> projectScope = new ArrayList<>();
            for (JsonNode value : scopeNode) {
                String entry = value.asText("").trim();
                if (entry.isBlank()) throw new IllegalArgumentException("invalid project scope entry");
                projectScope.add(entry);
            }
            String createdAt = required(projectNode, "created_at");
            context = new ProjectContext(projectNode.path("name").asText(""), projectScope,
                    Instant.parse(createdAt));
        }
        return new ProjectData(List.copyOf(records), config, List.copyOf(assessments), List.copyOf(validations),
                Set.copyOf(completedLanes), Map.copyOf(completedRuns), List.copyOf(routeCandidates),
                List.copyOf(runAttempts), context);
    }

    private ObjectNode writeRunAttempt(RunExecutionLedger.Attempt attempt) {
        ObjectNode out = json.createObjectNode();
        out.put("sequence", attempt.sequence());
        out.put("source", attempt.source().name());
        out.put("run_id", attempt.runId());
        put(out, "account_id", attempt.accountId());
        out.put("method", attempt.method());
        put(out, "service", attempt.service());
        out.put("path", attempt.path());
        out.put("outcome", attempt.outcome().name());
        out.put("status", attempt.status());
        put(out, "evidence_id", attempt.evidenceId());
        out.put("attempted_at", attempt.attemptedAt().toString());
        out.put("duration_ms", attempt.durationMillis());
        return out;
    }

    private RunExecutionLedger.Attempt readRunAttempt(JsonNode value) {
        return new RunExecutionLedger.Attempt(value.path("sequence").asLong(-1),
                enumValue(Source.class, required(value, "source")), required(value, "run_id"),
                nullable(value, "account_id"), required(value, "method"), nullable(value, "service"),
                required(value, "path"), enumValue(RunExecutionLedger.Outcome.class, required(value, "outcome")),
                value.path("status").asInt(-1), nullable(value, "evidence_id"),
                Instant.parse(required(value, "attempted_at")), value.path("duration_ms").asLong(-1));
    }

    private ObjectNode writeCompletedRun(RunContextRegistry.CompletedRun run) {
        ObjectNode out = json.createObjectNode();
        out.put("source", run.source().name());
        out.put("run_id", run.runId());
        out.put("source_detail", run.detail().name());
        out.put("orchestrator", run.orchestrator().name());
        out.put("tool", run.tool().name());
        out.put("phase", run.phase().name());
        put(out, "account_id", run.accountId());
        out.put("completed_at", run.completedAt().toString());
        out.set("evidence_ids", json.valueToTree(run.evidenceIds()));
        out.put("response_count", run.responseCount());
        out.put("coverage_count", run.coverageCount());
        return out;
    }

    private RunContextRegistry.CompletedRun readCompletedRun(JsonNode value) {
        Source source = enumValue(Source.class, required(value, "source"));
        RunContextRegistry.CompletedRun run = new RunContextRegistry.CompletedRun(source,
                required(value, "run_id"), enumValue(SourceDetail.class, required(value, "source_detail")),
                enumValue(Orchestrator.class, required(value, "orchestrator")),
                enumValue(ToolKind.class, required(value, "tool")),
                enumValue(RunPhase.class, required(value, "phase")), nullable(value, "account_id"),
                Instant.parse(required(value, "completed_at")), stringList(value, "evidence_ids"),
                value.path("response_count").asLong(-1), value.path("coverage_count").asLong(-1));
        if (!validCompletedRun(run)) throw new IllegalArgumentException("invalid completed run");
        return run;
    }

    private static boolean validCompletedRun(RunContextRegistry.CompletedRun run) {
        return run != null && (run.source() == Source.HUMAN || run.source() == Source.SCANNER
                || run.source() == Source.LLM) && run.runId() != null && !run.runId().isBlank()
                && run.detail() != null && run.orchestrator() != null && run.tool() != null
                && run.phase() == RunPhase.EXPLORATION && run.completedAt() != null
                && !run.evidenceIds().isEmpty() && run.responseCount() >= run.evidenceIds().size()
                && run.coverageCount() >= 0 && run.coverageCount() <= run.responseCount();
    }

    private ObjectNode writeRouteCandidate(RouteCandidate candidate) {
        ObjectNode out = json.createObjectNode();
        out.put("service", candidate.service());
        out.put("method", candidate.method());
        out.put("path_template", candidate.pathTemplate());
        out.set("concrete_paths", json.valueToTree(candidate.concretePaths()));
        out.put("concrete_paths_truncated", candidate.concretePathsTruncated());
        out.put("observed", candidate.observed());
        out.set("provenance_types", json.valueToTree(candidate.provenanceTypes().stream()
                .map(Enum::name).sorted().toList()));
        out.set("provenance_evidence_ids", json.valueToTree(candidate.provenanceEvidenceIds()));
        ArrayNode provenance = out.putArray("provenance");
        candidate.provenance().forEach(item -> {
            ObjectNode entry = provenance.addObject();
            entry.put("type", item.type().name());
            entry.put("evidence_id", item.evidenceId());
            entry.put("source", item.source().name());
            entry.put("run_id", item.runId());
            entry.put("adapter", item.adapter());
            entry.put("applicability", item.applicability().name());
            entry.put("reason", Masking.maskSecrets(item.reason()));
        });
        ArrayNode declaredParameters = out.putArray("declared_parameters");
        candidate.declaredParameters().forEach(item -> {
            ObjectNode entry = declaredParameters.addObject();
            entry.put("location", item.location().name());
            entry.put("field_path", Masking.maskSecrets(item.fieldPath()));
            entry.put("display_name", Masking.maskSecrets(item.displayName()));
            entry.put("requirement", item.requirement().name());
            entry.put("evidence_id", item.evidenceId());
            entry.put("source", item.source().name());
            entry.put("run_id", item.runId());
            entry.put("adapter", item.adapter());
            entry.put("reason", Masking.maskSecrets(item.reason()));
            entry.put("coordinate_version", item.coordinateVersion().name());
        });
        out.put("applicability", candidate.applicability().name());
        out.put("review_reason", Masking.maskSecrets(candidate.reviewReason()));
        return out;
    }

    private RouteCandidate readRouteCandidate(JsonNode value) {
        List<RouteCandidate.Provenance> provenance = new ArrayList<>();
        List<RouteCandidate.DeclaredParameter> declaredParameters = new ArrayList<>();
        JsonNode stored = value.path("provenance");
        if (stored.isArray()) stored.forEach(item -> provenance.add(new RouteCandidate.Provenance(
                enumValue(RouteCandidate.ProvenanceType.class, required(item, "type")),
                required(item, "evidence_id"), enumValue(Source.class, optional(item, "source", "UNKNOWN")),
                optional(item, "run_id", "legacy-project"), optional(item, "adapter", "legacy-project"),
                enumValue(RouteCandidate.Applicability.class, optional(item, "applicability", "REVIEW")),
                masked(item, "reason"))));
        if (provenance.isEmpty()) {
            for (String evidence : stringList(value, "provenance_evidence_ids")) {
                provenance.add(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.LEGACY_UNMAPPED,
                        evidence, Source.UNKNOWN, "legacy-project", "legacy-project-unmapped",
                        RouteCandidate.Applicability.REVIEW, "구버전 project의 provenance 대응 관계 미확정"));
            }
        }
        JsonNode storedParameters = value.path("declared_parameters");
        if (storedParameters.isArray()) storedParameters.forEach(item -> declaredParameters.add(
                new RouteCandidate.DeclaredParameter(
                        enumValue(SurfaceAnalysis.ParameterLocation.class, required(item, "location")),
                        masked(item, "field_path"), masked(item, "display_name"),
                        enumValue(SurfaceAnalysis.Requirement.class, optional(item, "requirement", "UNKNOWN")),
                        required(item, "evidence_id"),
                        enumValue(Source.class, optional(item, "source", "UNKNOWN")),
                        optional(item, "run_id", "legacy-project"),
                        optional(item, "adapter", "legacy-project"), masked(item, "reason"),
                        enumValue(io.flowscope.core.parameter.ParameterCoordinates.CoordinateVersion.class,
                                optional(item, "coordinate_version", "LEGACY_V1")))));
        return new RouteCandidate(required(value, "service"), required(value, "method"),
                required(value, "path_template"), stringList(value, "concrete_paths"),
                value.path("concrete_paths_truncated").asBoolean(false),
                value.path("observed").asBoolean(false), provenance,
                enumValue(RouteCandidate.Applicability.class, required(value, "applicability")),
                masked(value, "review_reason"), declaredParameters);
    }

    private ObjectNode writeRecord(RequestRecord r, ObjectNode payloads) {
        ObjectNode out = json.createObjectNode();
        out.put("source", r.source.name());
        out.put("service", r.service);
        out.put("method", r.method);
        out.put("path", r.path);
        out.put("status", r.status);
        out.put("fingerprint", Fingerprints.safeForStorage(r.fp));
        out.put("source_detail", r.sourceDetail.name());
        out.put("orchestrator", r.orchestrator.name());
        out.put("tool", r.tool.name());
        out.put("phase", r.phase.name());
        out.put("execution_trust", r.executionTrust.name());
        out.put("auth_state", r.authState.name());
        out.put("traffic_class", r.trafficClassification.trafficClass().name());
        out.put("traffic_disposition", r.trafficClassification.disposition().name());
        out.put("traffic_user_override", r.trafficClassification.userOverride());
        out.set("classification_reasons", json.valueToTree(r.trafficClassification.reasons()));
        put(out, "run_id", r.runId);
        put(out, "lane_account_id", r.laneAccountId);
        put(out, "evidence_id", r.evidenceId);
        put(out, "content_digest", r.contentDigest);
        put(out, "query", r.query);
        put(out, "request_body", r.reqBody);
        put(out, "request_content_type", r.requestContentType);
        put(out, "response_content_type", r.responseContentType);
        put(out, "sec_fetch_dest", r.secFetchDest);
        put(out, "sec_fetch_mode", r.secFetchMode);
        put(out, "access_control_request_method", r.accessControlRequestMethod);
        putHeaders(out, "request", r.reqText);
        writePayload(out, "request_payload", r.requestPayload, payloads);
        out.put("timestamp", r.timestamp);
        put(out, "response_body", r.body);
        putHeaders(out, "response", r.respText);
        writePayload(out, "response_payload", r.responsePayload, payloads);
        put(out, "location", r.location);
        out.put("has_response", r.hasResponse);
        return out;
    }

    private RequestRecord readRecord(JsonNode value, JsonNode payloads,
                                     Map<String, StoredPayload> restoredPayloads,
                                     long[] restoredPayloadBytes) {
        Source source = enumValue(Source.class, required(value, "source"));
        RequestRecord r = new RequestRecord(source, required(value, "service"), required(value, "method"),
                required(value, "path"), value.path("status").asInt(), required(value, "fingerprint"));
        r.sourceDetail = enumValue(SourceDetail.class, required(value, "source_detail"));
        r.orchestrator = enumValue(Orchestrator.class, required(value, "orchestrator"));
        r.tool = enumValue(ToolKind.class, required(value, "tool"));
        r.phase = enumValue(RunPhase.class, required(value, "phase"));
        r.executionTrust = enumValue(ExecutionTrust.class, optional(value, "execution_trust", "UNKNOWN"));
        r.authState = enumValue(AuthState.class, optional(value, "auth_state", "UNRESOLVED"));
        List<String> reasons = new ArrayList<>();
        JsonNode reasonNodes = value.path("classification_reasons");
        if (reasonNodes.isArray()) reasonNodes.forEach(reason -> reasons.add(Masking.maskSecrets(reason.asText())));
        r.trafficClassification = new TrafficClassification(
                enumValue(TrafficClassification.TrafficClass.class,
                        optional(value, "traffic_class", "UNKNOWN")),
                enumValue(TrafficClassification.Disposition.class,
                        optional(value, "traffic_disposition", "REVIEW")),
                reasons, value.path("traffic_user_override").asBoolean(false));
        r.runId = optional(value, "run_id", "project-import");
        r.laneAccountId = nullable(value, "lane_account_id");
        r.evidenceId = nullable(value, "evidence_id");
        r.contentDigest = nullable(value, "content_digest");
        r.query = masked(value, "query");
        r.reqBody = masked(value, "request_body");
        r.requestContentType = masked(value, "request_content_type");
        r.responseContentType = masked(value, "response_content_type");
        r.secFetchDest = masked(value, "sec_fetch_dest");
        r.secFetchMode = masked(value, "sec_fetch_mode");
        r.accessControlRequestMethod = masked(value, "access_control_request_method");
        r.reqText = maskedHeaders(value, "request");
        r.requestPayload = readPayload(value.path("request_payload"), payloads,
                restoredPayloads, restoredPayloadBytes);
        r.timestamp = value.path("timestamp").asLong();
        r.body = masked(value, "response_body");
        r.respText = maskedHeaders(value, "response");
        r.responsePayload = readPayload(value.path("response_payload"), payloads,
                restoredPayloads, restoredPayloadBytes);
        r.location = masked(value, "location");
        r.hasResponse = value.path("has_response").asBoolean(false);
        return r;
    }

    private void writePayload(ObjectNode record, String field, StoredPayload payload, ObjectNode payloads) {
        if (payload == null) { record.putNull(field); return; }
        if (payload.retained()) {
            String masked = Masking.maskHeaders(payload.text());
            if (!masked.equals(payload.text())) {
                throw new IllegalArgumentException("unmasked stored payload rejected");
            }
        }
        ObjectNode reference = record.putObject(field);
        reference.put("digest", payload.digest());
        reference.put("original_bytes", payload.originalBytes());
        reference.put("retention", payload.retention().name());
        if (payload.retained() && !payloads.has(payload.digest())) {
            payloads.put(payload.digest(), payload.gzipBase64());
        }
    }

    private StoredPayload readPayload(JsonNode reference, JsonNode payloads,
                                      Map<String, StoredPayload> restoredPayloads,
                                      long[] restoredPayloadBytes) {
        if (reference == null || !reference.isObject()) return null;
        String digest = required(reference, "digest");
        int originalBytes = reference.path("original_bytes").asInt(-1);
        if (originalBytes < 0) throw new IllegalArgumentException("payload original_bytes is invalid");
        StoredPayload.Retention retention = enumValue(StoredPayload.Retention.class,
                required(reference, "retention"));
        StoredPayload cached = restoredPayloads.get(digest);
        if (cached != null) {
            if (cached.originalBytes() != originalBytes || cached.retention() != retention) {
                throw new IllegalArgumentException("conflicting payload metadata for digest");
            }
            return cached;
        }
        JsonNode blob = payloads == null ? null : payloads.get(digest);
        StoredPayload restored = StoredPayload.restore(digest, originalBytes, retention,
                blob == null || blob.isNull() ? null : blob.asText(), MAX_PAYLOAD_BYTES);
        long next = restoredPayloadBytes[0] + (restored.retained() ? restored.originalBytes() : 0L);
        if (next > maxRestoredPayloadBytes) {
            throw new IllegalArgumentException("restored payload aggregate limit exceeded");
        }
        restoredPayloadBytes[0] = next;
        restoredPayloads.put(digest, restored);
        return restored;
    }

    private ObjectNode writePolicy(AnalysisConfig config) {
        ObjectNode policy = json.createObjectNode();
        policy.set("identity_roles", json.valueToTree(config.identityRoles()));
        policy.set("endpoint_requirements", json.valueToTree(config.endpointRequirements()));
        policy.set("resource_owners", json.valueToTree(config.resourceOwners()));
        policy.set("resource_policies", json.valueToTree(config.resourcePolicies()));
        policy.set("traffic_overrides", json.valueToTree(config.trafficOverrides()));
        ArrayNode accounts = policy.putArray("accounts");
        config.accounts().values().stream().sorted(java.util.Comparator.comparing(AccountProfile::id)).forEach(account -> {
            ObjectNode value = accounts.addObject();
            value.put("id", account.id());
            value.put("label", account.label());
            value.put("service", account.service());
            value.put("role", account.role().name());
        });
        ArrayNode bindings = policy.putArray("session_bindings");
        config.sessionBindings().entrySet().stream().sorted(java.util.Map.Entry.comparingByKey()).forEach(entry -> {
            int split = entry.getKey().indexOf('\0');
            if (split < 1) return;
            ObjectNode value = bindings.addObject();
            value.put("service", entry.getKey().substring(0, split));
            value.put("fingerprint", Fingerprints.safeForStorage(entry.getKey().substring(split + 1)));
            value.put("account_id", entry.getValue());
        });
        return policy;
    }

    private AnalysisConfig readPolicy(JsonNode value) {
        AnalysisConfig config = new AnalysisConfig();
        value.path("identity_roles").properties().forEach(e ->
                config.withIdentityRole(e.getKey(), enumValue(AccessRole.class, e.getValue().asText())));
        value.path("endpoint_requirements").properties().forEach(e ->
                config.withEndpointRequirement(e.getKey(), enumValue(AccessRole.class, e.getValue().asText())));
        value.path("resource_owners").properties().forEach(e ->
                config.withResourceOwner(e.getKey(), e.getValue().asText()));
        value.path("resource_policies").properties().forEach(e ->
                config.withResourcePolicy(e.getKey(), enumValue(ResourcePolicy.class, e.getValue().asText())));
        value.path("traffic_overrides").properties().forEach(e ->
                config.withTrafficOverride(e.getKey(), enumValue(TrafficOverride.class, e.getValue().asText())));
        JsonNode accounts = value.path("accounts");
        if (accounts.isArray()) {
            for (JsonNode account : accounts) {
                config.upsertAccount(new AccountProfile(required(account, "id"), required(account, "label"),
                        required(account, "service"), enumValue(AccessRole.class, required(account, "role"))));
            }
        }
        JsonNode bindings = value.path("session_bindings");
        if (bindings.isArray()) {
            for (JsonNode binding : bindings) {
                config.bindSession(required(binding, "service"), required(binding, "fingerprint"),
                        required(binding, "account_id"));
            }
        }
        return config;
    }

    private ObjectNode writeAssessment(LegacyAssessment value) {
        ObjectNode out = json.createObjectNode();
        out.put("id", value.id());
        out.put("type", value.type());
        out.put("verdict", value.verdict());
        out.put("title", Masking.maskSecrets(value.title()));
        out.put("reason", Masking.maskSecrets(value.reason()));
        out.set("evidence_ids", json.valueToTree(value.evidenceIds()));
        out.put("created_at", value.createdAt().toString());
        return out;
    }

    private ObjectNode writeReview(ReviewDecision value) {
        ObjectNode out = json.createObjectNode();
        out.put("item_id", value.itemId());
        out.put("status", value.status().name());
        out.put("note", value.note());
        out.set("evidence_ids", json.valueToTree(value.evidenceIds()));
        out.put("decided_at", value.decidedAt().toString());
        return out;
    }

    private ObjectNode writeValidation(ValidationDecision value) {
        ObjectNode out = json.createObjectNode();
        out.put("candidate_id", value.candidateId());
        out.put("verdict", value.verdict().name());
        out.put("reason", Masking.maskSecrets(value.reason()));
        out.set("original_evidence_ids", json.valueToTree(value.originalEvidenceIds()));
        out.set("validation_evidence_ids", json.valueToTree(value.validationEvidenceIds()));
        out.set("control_evidence_ids", json.valueToTree(value.controlEvidenceIds()));
        out.put("run_id", value.runId());
        out.put("decided_at", value.decidedAt().toString());
        return out;
    }

    private ReviewDecision readReview(JsonNode value) {
        List<String> evidence = new ArrayList<>();
        value.path("evidence_ids").forEach(id -> evidence.add(id.asText()));
        return new ReviewDecision(required(value, "item_id"),
                enumValue(ReviewDecision.Status.class, required(value, "status")),
                masked(value, "note"), List.copyOf(evidence),
                Instant.parse(required(value, "decided_at")));
    }

    private LegacyAssessment readAssessment(JsonNode value) {
        List<String> evidence = new ArrayList<>();
        value.path("evidence_ids").forEach(id -> evidence.add(id.asText()));
        String verdict = required(value, "verdict");
        if (!Set.of("LIKELY", "INCONCLUSIVE", "REJECTED").contains(verdict)) {
            throw new IllegalArgumentException("invalid assessment verdict: " + verdict);
        }
        return new LegacyAssessment(required(value, "id"), required(value, "type"),
                verdict, masked(value, "title"), masked(value, "reason"),
                List.copyOf(evidence), Instant.parse(required(value, "created_at")));
    }

    private ValidationDecision readValidation(JsonNode value) {
        return new ValidationDecision(required(value, "candidate_id"),
                enumValue(ValidationDecision.FinalVerdict.class, required(value, "verdict")),
                masked(value, "reason"), stringList(value, "original_evidence_ids"),
                stringList(value, "validation_evidence_ids"), stringList(value, "control_evidence_ids"),
                optional(value, "run_id", ""), Instant.parse(required(value, "decided_at")));
    }

    private static List<String> stringList(JsonNode value, String field) {
        JsonNode values = value.path(field);
        if (!values.isArray()) throw new IllegalArgumentException(field + " must be an array");
        List<String> result = new ArrayList<>();
        for (JsonNode item : values) {
            if (!item.isTextual() || item.asText().isBlank()) {
                throw new IllegalArgumentException(field + " must contain strings");
            }
            result.add(item.asText());
        }
        return List.copyOf(result);
    }

    private static void put(ObjectNode node, String field, String value) {
        if (value == null) node.putNull(field);
        else node.put(field, Masking.truncate(Masking.maskSecrets(value), MAX_TEXT));
    }

    private static void putHeaders(ObjectNode node, String field, String value) {
        if (value == null) node.putNull(field);
        else node.put(field, Masking.truncate(Masking.maskHeaders(value), MAX_TEXT));
    }

    private static String masked(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null
                : Masking.truncate(Masking.maskSecrets(value.asText()), MAX_TEXT);
    }

    private static String maskedHeaders(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null
                : Masking.truncate(Masking.maskHeaders(value.asText()), MAX_TEXT);
    }

    private static String required(JsonNode node, String field) {
        String value = node.path(field).asText();
        if (value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value;
    }

    private static String optional(JsonNode node, String field, String fallback) {
        String value = node.path(field).asText();
        return value.isBlank() ? fallback : value;
    }

    private static String nullable(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() || value.asText().isBlank() ? null : value.asText();
    }

    private static <T extends Enum<T>> T enumValue(Class<T> type, String value) {
        try { return Enum.valueOf(type, value); }
        catch (IllegalArgumentException e) { throw new IllegalArgumentException("invalid " + type.getSimpleName() + ": " + value); }
    }

    static void restrictPermissions(Path path) {
        try {
            Files.setPosixFilePermissions(path, Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows/non-POSIX: rely on the user's filesystem ACL.
        }
    }
}
