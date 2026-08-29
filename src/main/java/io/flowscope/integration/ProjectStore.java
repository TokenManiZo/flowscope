package io.flowscope.integration;

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
import java.util.Set;

/** Versioned, masked FlowScope session file. Model-provider credentials are never part of this schema. */
public final class ProjectStore {
    public record ProjectData(List<RequestRecord> records, AnalysisConfig config,
                              List<McpServer.Assessment> assessments,
                              List<ValidationDecision> validations,
                              Set<Source> completedLanes,
                              List<RouteCandidate> routeCandidates) {}

    private static final int SCHEMA_VERSION = 2;
    private static final int LEGACY_SCHEMA_VERSION = 1;
    private static final int MAX_RECORDS = 20_000;
    private static final long MAX_FILE_BYTES = 100L * 1024 * 1024;
    private static final int MAX_TEXT = 8192;
    private final ObjectMapper json = new ObjectMapper();

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<McpServer.Assessment> assessments) throws IOException {
        save(target, records, config, assessments, List.of(), Set.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<McpServer.Assessment> assessments,
                     List<ValidationDecision> validations) throws IOException {
        save(target, records, config, assessments, validations, Set.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<McpServer.Assessment> assessments,
                     List<ValidationDecision> validations,
                     Set<Source> completedLanes) throws IOException {
        save(target, records, config, assessments, validations, completedLanes, List.of());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<McpServer.Assessment> assessments,
                     List<ValidationDecision> validations,
                     Set<Source> completedLanes,
                     List<RouteCandidate> routeCandidates) throws IOException {
        ObjectNode root = toDocument(records, config, assessments, validations, completedLanes, routeCandidates);
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
                          List<McpServer.Assessment> assessments,
                          List<ValidationDecision> validations,
                          Set<Source> completedLanes,
                          List<RouteCandidate> routeCandidates) {
        if (records.size() > MAX_RECORDS) throw new IllegalArgumentException("record limit exceeded");
        config = config.snapshotCopy();
        EvidenceIds.assign(records);
        ObjectNode root = json.createObjectNode();
        root.put("schema_version", SCHEMA_VERSION);
        root.put("traffic_classifier_version", TrafficClassifier.VERSION);
        root.put("saved_at", Instant.now().toString());
        ArrayNode savedLanes = root.putArray("completed_lanes");
        (completedLanes == null ? Set.<Source>of() : completedLanes).stream()
                .filter(source -> source == Source.HUMAN || source == Source.SCANNER || source == Source.LLM)
                .map(Enum::name).sorted().forEach(savedLanes::add);
        ArrayNode savedRecords = root.putArray("records");
        ObjectNode payloads = root.putObject("payloads");
        for (RequestRecord record : records) savedRecords.add(writeRecord(record, payloads));
        ArrayNode savedRouteCandidates = root.putArray("route_candidates");
        for (RouteCandidate candidate : routeCandidates == null ? List.<RouteCandidate>of() : routeCandidates) {
            savedRouteCandidates.add(writeRouteCandidate(candidate));
        }
        root.set("policy", writePolicy(config));
        ArrayNode savedReviews = root.putArray("reviews");
        config.reviews().values().stream().sorted(java.util.Comparator.comparing(ReviewDecision::itemId))
                .forEach(review -> savedReviews.add(writeReview(review)));
        ArrayNode savedAssessments = root.putArray("assessments");
        for (McpServer.Assessment assessment : assessments) savedAssessments.add(writeAssessment(assessment));
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
        if (schemaVersion != SCHEMA_VERSION && schemaVersion != LEGACY_SCHEMA_VERSION) {
            throw new IllegalArgumentException("unsupported FlowScope schema version");
        }
        JsonNode recordNodes = root.path("records");
        if (!recordNodes.isArray() || recordNodes.size() > MAX_RECORDS) {
            throw new IllegalArgumentException("invalid records array");
        }
        List<RequestRecord> records = new ArrayList<>();
        JsonNode payloads = root.path("payloads");
        for (JsonNode value : recordNodes) records.add(readRecord(value, payloads));
        AnalysisConfig config = readPolicy(root.path("policy"));
        JsonNode reviewNodes = root.path("reviews");
        if (reviewNodes.isArray()) {
            if (reviewNodes.size() > 2_000) throw new IllegalArgumentException("review limit exceeded");
            for (JsonNode value : reviewNodes) config.restoreReview(readReview(value));
        }
        List<McpServer.Assessment> assessments = new ArrayList<>();
        JsonNode assessmentNodes = root.path("assessments");
        if (assessmentNodes.isArray()) {
            if (assessmentNodes.size() > 1_000) throw new IllegalArgumentException("assessment limit exceeded");
            for (JsonNode value : assessmentNodes) assessments.add(readAssessment(value));
        }
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
        List<RouteCandidate> routeCandidates = new ArrayList<>();
        JsonNode candidateNodes = root.path("route_candidates");
        if (candidateNodes.isArray()) {
            if (candidateNodes.size() > MAX_RECORDS) throw new IllegalArgumentException("route candidate limit exceeded");
            for (JsonNode value : candidateNodes) routeCandidates.add(readRouteCandidate(value));
        }
        return new ProjectData(List.copyOf(records), config, List.copyOf(assessments), List.copyOf(validations),
                Set.copyOf(completedLanes), List.copyOf(routeCandidates));
    }

    private ObjectNode writeRouteCandidate(RouteCandidate candidate) {
        ObjectNode out = json.createObjectNode();
        out.put("service", candidate.service());
        out.put("method", candidate.method());
        out.put("path_template", candidate.pathTemplate());
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
        out.put("applicability", candidate.applicability().name());
        out.put("review_reason", Masking.maskSecrets(candidate.reviewReason()));
        return out;
    }

    private RouteCandidate readRouteCandidate(JsonNode value) {
        List<RouteCandidate.Provenance> provenance = new ArrayList<>();
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
        return new RouteCandidate(required(value, "service"), required(value, "method"),
                required(value, "path_template"), value.path("observed").asBoolean(false), provenance,
                enumValue(RouteCandidate.Applicability.class, required(value, "applicability")),
                masked(value, "review_reason"));
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

    private RequestRecord readRecord(JsonNode value, JsonNode payloads) {
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
        r.requestPayload = readPayload(value.path("request_payload"), payloads);
        r.timestamp = value.path("timestamp").asLong();
        r.body = masked(value, "response_body");
        r.respText = maskedHeaders(value, "response");
        r.responsePayload = readPayload(value.path("response_payload"), payloads);
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

    private StoredPayload readPayload(JsonNode reference, JsonNode payloads) {
        if (reference == null || !reference.isObject()) return null;
        String digest = required(reference, "digest");
        int originalBytes = reference.path("original_bytes").asInt(-1);
        if (originalBytes < 0) throw new IllegalArgumentException("payload original_bytes is invalid");
        StoredPayload.Retention retention = enumValue(StoredPayload.Retention.class,
                required(reference, "retention"));
        JsonNode blob = payloads == null ? null : payloads.get(digest);
        return StoredPayload.restore(digest, originalBytes, retention,
                blob == null || blob.isNull() ? null : blob.asText());
    }

    private ObjectNode writePolicy(AnalysisConfig config) {
        ObjectNode policy = json.createObjectNode();
        policy.set("identity_roles", json.valueToTree(config.identityRoles()));
        policy.set("endpoint_requirements", json.valueToTree(config.endpointRequirements()));
        policy.set("resource_owners", json.valueToTree(config.resourceOwners()));
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

    private ObjectNode writeAssessment(McpServer.Assessment value) {
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

    private McpServer.Assessment readAssessment(JsonNode value) {
        List<String> evidence = new ArrayList<>();
        value.path("evidence_ids").forEach(id -> evidence.add(id.asText()));
        String verdict = required(value, "verdict");
        if (!Set.of("LIKELY", "INCONCLUSIVE", "REJECTED").contains(verdict)) {
            throw new IllegalArgumentException("invalid assessment verdict: " + verdict);
        }
        return new McpServer.Assessment(required(value, "id"), required(value, "type"),
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
