package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.*;
import io.flowscope.integration.McpServer;
import io.flowscope.integration.ProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class ProjectStoreTest {
    @TempDir Path temp;

    @Test
    void maskedSessionRoundTripsWithPolicyAndAssessment() throws Exception {
        RequestRecord record = new RequestRecord(Source.LLM, "https://api.test:443",
                "POST", "/orders/7", 200, "raw-session-value");
        record.sourceDetail = SourceDetail.LLM_VALIDATION;
        record.orchestrator = Orchestrator.LLM;
        record.tool = ToolKind.CODEX;
        record.phase = RunPhase.VALIDATION;
        record.runId = "validation-1";
        record.laneAccountId = "acct-a";
        record.query = "token=QUERYSECRET&id=7";
        record.reqBody = "{\"password\":\"BODYSECRET\",\"orderId\":7}";
        record.reqText = "POST /orders/7 HTTP/1.1\r\nAuthorization: Bearer HEADERSECRET\r\n\r\n" + record.reqBody;
        record.requestPayload = StoredPayload.capture(Masking.maskHeaders(record.reqText),
                "application/json", 1024 * 1024);
        record.body = "{\"ownerId\":\"user-a\"}";
        record.respText = "HTTP/1.1 200 OK\r\nSet-Cookie: sid=COOKIESECRET\r\n\r\n" + record.body;
        record.responsePayload = StoredPayload.capture(Masking.maskHeaders(record.respText),
                "application/json", 1024 * 1024);
        record.location = "/next?token=REDIRECTSECRET";
        record.hasResponse = true;
        record.timestamp = 1234;
        record.requestContentType = "application/json";
        record.responseContentType = "application/json";
        record.secFetchDest = "empty";
        record.secFetchMode = "cors";
        Pipeline.run(List.of(record));

        AnalysisConfig config = new AnalysisConfig()
                .withIdentityRole("user-a", AccessRole.USER)
                .withEndpointRequirement(record.op, AccessRole.LV1)
                .withResourceOwner(record.resource, "user-a")
                .withTrafficOverride(record.op, TrafficOverride.INCLUDE);
        AccountProfile account = new AccountProfile("acct-a", "USER A", "https://api.test:443", AccessRole.USER);
        config.upsertAccount(account).bindSession(record.service, record.fp, account.id());
        McpServer.Assessment assessment = new McpServer.Assessment("a-1", "BOLA", "LIKELY",
                "candidate", "evidence based", List.of(record.evidenceId), Instant.parse("2026-08-24T00:00:00Z"));
        ValidationDecision validation = new ValidationDecision("finding-1",
                ValidationDecision.FinalVerdict.INCONCLUSIVE, "needs a second account",
                List.of(record.evidenceId), List.of(), List.of(), "",
                Instant.parse("2026-08-24T00:01:00Z"));
        config.reviewItem(assessment.id(), ReviewDecision.Status.CONFIRMED,
                "token=REVIEWSECRET 재현 완료", assessment.evidenceIds());
        Path file = temp.resolve("session.flowscope.json");
        RouteCandidate routeCandidate = new RouteCandidate(record.service, "UNKNOWN", "/undocumented/{id}",
                List.of("/undocumented/42"), false, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.BURP_UNREQUESTED,
                "sitemap:abc", Source.UNKNOWN, "burp-site-map", "burp-site-map")),
                RouteCandidate.Applicability.REVIEW, "응답 없는 Site Map 항목");

        ProjectStore store = new ProjectStore();
        store.save(file, List.of(record), config, List.of(assessment), List.of(validation),
                Set.of(Source.HUMAN, Source.SCANNER, Source.LLM), List.of(routeCandidate));
        String raw = Files.readString(file);
        assertEquals(TrafficClassifier.VERSION,
                new ObjectMapper().readTree(raw).path("traffic_classifier_version").asInt());
        for (String secret : List.of("QUERYSECRET", "BODYSECRET", "HEADERSECRET", "COOKIESECRET",
                "REDIRECTSECRET", "REVIEWSECRET", "raw-session-value")) assertFalse(raw.contains(secret), secret);

        ProjectStore.ProjectData loaded = store.load(file);
        assertEquals(1, loaded.records().size());
        RequestRecord restored = loaded.records().get(0);
        assertEquals(SourceDetail.LLM_VALIDATION, restored.sourceDetail);
        assertEquals("validation-1", restored.runId);
        assertEquals("acct-a", restored.laneAccountId);
        assertEquals(record.evidenceId, restored.evidenceId);
        assertEquals(record.contentDigest, restored.contentDigest);
        assertTrue(restored.hasResponse);
        assertEquals("application/json", restored.responseContentType);
        assertEquals("empty", restored.secFetchDest);
        assertEquals(record.authState, restored.authState);
        assertEquals(record.trafficClassification, restored.trafficClassification);
        assertEquals(TrafficOverride.INCLUDE, loaded.config().trafficOverride(record.op));
        assertEquals(AccessRole.USER, loaded.config().identityRole("user-a"));
        assertEquals("user-a", loaded.config().resourceOwner(record.resource));
        assertEquals("USER A", loaded.config().account("acct-a").orElseThrow().label());
        assertEquals("acct-a", loaded.config().boundAccount(record.service, restored.fp).orElseThrow().id());
        assertEquals("LIKELY", loaded.assessments().get(0).verdict());
        assertEquals(ValidationDecision.FinalVerdict.INCONCLUSIVE, loaded.validations().get(0).verdict());
        assertTrue(loaded.completedLanes().isEmpty(),
                "source-only completion flags are not persisted by the current schema");
        assertEquals(List.of(routeCandidate), loaded.routeCandidates());
        assertEquals(ReviewDecision.Status.CONFIRMED,
                loaded.config().review(assessment.id(), assessment.evidenceIds()).orElseThrow().status());
    }

    @Test
    void rejectsUnknownSchema() throws Exception {
        Path file = temp.resolve("bad.json");
        Files.writeString(file, "{\"schema_version\":99,\"records\":[]}");
        assertThrows(IllegalArgumentException.class, () -> new ProjectStore().load(file));
    }

    @Test
    void legacyRouteProvenanceDoesNotInventTypeToEvidenceMappings() throws Exception {
        RouteCandidate candidate = new RouteCandidate("https://api.test:443", "UNKNOWN", "/legacy", false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.HTML_LINK,
                        "legacy-a", Source.HUMAN, "old-run", "old-adapter")),
                RouteCandidate.Applicability.REVIEW, "legacy");
        Path file = temp.resolve("legacy-route.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, List.of(), new AnalysisConfig(), List.of(), List.of(), Set.of(), List.of(candidate));

        ObjectMapper json = new ObjectMapper();
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(Files.readString(file));
        var stored = (com.fasterxml.jackson.databind.node.ObjectNode) root.path("route_candidates").get(0);
        stored.remove("provenance");
        stored.set("provenance_types", json.valueToTree(List.of("HTML_LINK", "OPENAPI")));
        stored.set("provenance_evidence_ids", json.valueToTree(List.of("legacy-a", "legacy-b")));
        Files.writeString(file, json.writeValueAsString(root));

        RouteCandidate restored = store.load(file).routeCandidates().getFirst();
        assertEquals(List.of("legacy-a", "legacy-b"), restored.provenanceEvidenceIds());
        assertEquals(Set.of(RouteCandidate.ProvenanceType.LEGACY_UNMAPPED), restored.provenanceTypes());
        assertTrue(restored.provenance().stream().allMatch(item -> item.source() == Source.UNKNOWN
                && item.adapter().equals("legacy-project-unmapped")));
    }

    @Test
    void doesNotInferCompletedLaneFromPartialExplorationRecords() throws Exception {
        RequestRecord partial = new RequestRecord(Source.LLM, "https://api.test:443",
                "GET", "/partial", 200, "session");
        partial.sourceDetail = SourceDetail.LLM_EXPLORER;
        partial.phase = RunPhase.EXPLORATION;
        partial.runId = "interrupted-run";
        partial.hasResponse = true;
        Path file = temp.resolve("partial.flowscope.json");

        ProjectStore store = new ProjectStore();
        store.save(file, List.of(partial), new AnalysisConfig(), List.of(), List.of());

        assertTrue(store.load(file).completedLanes().isEmpty());
    }

    @Test
    void humanSessionSetupPhaseRoundTripsWithoutBecomingCoverage() throws Exception {
        RequestRecord login = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "POST", "/login", 200, "sess:login");
        login.sourceDetail = SourceDetail.BROWSER;
        login.phase = RunPhase.SESSION_SETUP;
        login.hasResponse = true;
        login.requestContentType = "application/json";
        login.responseContentType = "application/json";
        Pipeline.Result beforeSave = Pipeline.run(List.of(login));
        Path file = temp.resolve("session-setup.flowscope.json");

        ProjectStore store = new ProjectStore();
        store.save(file, beforeSave.records, new AnalysisConfig(), List.of(), List.of());
        RequestRecord restored = store.load(file).records().getFirst();
        Pipeline.Result afterLoad = Pipeline.run(List.of(restored));

        assertEquals(RunPhase.SESSION_SETUP, restored.phase);
        assertEquals(1, afterLoad.records.size());
        assertTrue(afterLoad.coverageRecords.isEmpty());
        assertEquals(List.of("SESSION_SETUP"),
                afterLoad.records.getFirst().trafficClassification.reasons());
    }

    @Test
    void evidenceIdentityCoversResponseAndProvenanceAndSurvivesReassignment() {
        RequestRecord allowed = new RequestRecord(Source.LLM, "https://api.test:443",
                "GET", "/orders/7", 200, "session");
        allowed.hasResponse = true;
        allowed.body = "{\"id\":7}";
        allowed.location = "/orders/7";
        allowed.sourceDetail = SourceDetail.LLM_EXPLORER;
        RequestRecord denied = new RequestRecord(Source.LLM, "https://api.test:443",
                "GET", "/orders/7", 403, "session");
        denied.hasResponse = true;
        denied.body = "{\"error\":\"forbidden\"}";
        denied.location = "/login";
        denied.sourceDetail = SourceDetail.LLM_VALIDATION;

        EvidenceIds.assign(List.of(allowed, denied));
        String stableId = allowed.evidenceId;

        assertNotEquals(allowed.contentDigest, denied.contentDigest);
        assertNotEquals(allowed.evidenceId, denied.evidenceId);
        EvidenceIds.assign(List.of(allowed));
        assertEquals(stableId, allowed.evidenceId);
    }

    @Test
    void compressedPayloadsAreDeduplicatedAndRoundTripBeyondPreviewLimit() throws Exception {
        String body = "{\"items\":[" + "{\"orderId\":101},".repeat(1_000) + "]}";
        String request = "POST /orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n" + body;
        RequestRecord first = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "POST", "/orders", 200, "anon");
        first.requestPayload = StoredPayload.capture(request, "application/json", 1024 * 1024);
        first.reqText = Masking.truncate(request, 8192);
        first.reqBody = Masking.truncate(body, 8192);
        first.hasResponse = true;
        RequestRecord second = new RequestRecord(Source.HUMAN, "https://api.test:443",
                "POST", "/orders", 201, "anon");
        second.requestPayload = first.requestPayload;
        second.reqText = first.reqText;
        second.reqBody = first.reqBody;
        second.hasResponse = true;
        Path file = temp.resolve("payloads.flowscope.json");

        ProjectStore store = new ProjectStore();
        store.save(file, List.of(first, second), new AnalysisConfig(), List.of());
        var root = new ObjectMapper().readTree(Files.readString(file));
        ProjectStore.ProjectData loaded = store.load(file);

        assertEquals(3, root.path("schema_version").asInt());
        assertEquals(1, root.path("payloads").size(), "동일 payload blob은 한 번만 저장해야 한다");
        assertEquals(request, loaded.records().getFirst().requestTextForEvidence());
        assertEquals(body, loaded.records().getFirst().requestBodyForAnalysis());
    }

    @Test
    void rejectsProjectsWhoseDistinctRestoredPayloadsExceedAggregateBudget() throws Exception {
        List<RequestRecord> records = new java.util.ArrayList<>();
        for (int index = 0; index < 49; index++) {
            String prefix = "payload-" + index + ":";
            String body = prefix + "x".repeat(1024 * 1024 - prefix.length());
            RequestRecord record = new RequestRecord(Source.HUMAN, "https://api.test:443",
                    "POST", "/payload/" + index, 200, "anon");
            record.requestPayload = StoredPayload.capture(body, "text/plain", 1024 * 1024);
            record.hasResponse = true;
            records.add(record);
        }
        Path file = temp.resolve("aggregate-over-limit.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, records, new AnalysisConfig(), List.of());

        assertThrows(IllegalArgumentException.class, () -> store.load(file));
    }

    @Test
    void exactCompletedRunsRoundTripAndLegacyLaneFlagsRemainUntrusted() throws Exception {
        RequestRecord evidence = new RequestRecord(Source.LLM, "https://api.test:443",
                "GET", "/health", 200, "test");
        evidence.hasResponse = true;
        evidence.body = "{\"ok\":true}";
        evidence.sourceDetail = SourceDetail.LLM_EXPLORER;
        evidence.orchestrator = Orchestrator.LLM;
        evidence.tool = ToolKind.CODEX;
        evidence.phase = RunPhase.EXPLORATION;
        evidence.runId = "llm-exact-1";
        evidence.executionTrust = ExecutionTrust.CONTROLLED;
        Pipeline.Result result = Pipeline.run(List.of(evidence));
        RunContextRegistry contexts = new RunContextRegistry();
        contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, evidence.runId));
        assertNotNull(LaneCompletionPolicy.complete(contexts, Source.LLM, evidence.runId, result));

        ProjectStore store = new ProjectStore();
        Path current = temp.resolve("exact-run.flowscope.json");
        store.save(current, List.of(evidence), new AnalysisConfig(), List.of(), List.of(),
                contexts.completedRuns(), List.of());
        ProjectStore.ProjectData loaded = store.load(current);

        assertEquals(evidence.runId, loaded.completedRuns().get(Source.LLM).runId());
        assertEquals(List.of(evidence.evidenceId), loaded.completedRuns().get(Source.LLM).evidenceIds());
        assertEquals(Set.of(Source.LLM), loaded.completedLanes());

        ObjectMapper json = new ObjectMapper();
        var legacy = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(Files.readString(current));
        legacy.put("schema_version", 2);
        Path old = temp.resolve("legacy-lanes.flowscope.json");
        Files.writeString(old, json.writeValueAsString(legacy));
        ProjectStore.ProjectData restoredLegacy = store.load(old);
        assertEquals(Set.of(Source.LLM), restoredLegacy.completedLanes());
        assertTrue(restoredLegacy.completedRuns().isEmpty(),
                "source-only lane flags must not become exact run completion after migration");
    }

    @Test
    void currentSchemaRejectsLaneAndExactRunMismatch() throws Exception {
        Path file = temp.resolve("mismatched-completion.flowscope.json");
        ProjectStore store = new ProjectStore();
        store.save(file, List.of(), new AnalysisConfig(), List.of(), List.of());

        ObjectMapper json = new ObjectMapper();
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(Files.readString(file));
        ((com.fasterxml.jackson.databind.node.ArrayNode) root.path("completed_lanes")).add("HUMAN");
        Files.writeString(file, json.writeValueAsString(root));

        assertThrows(IllegalArgumentException.class, () -> store.load(file));
    }
}
