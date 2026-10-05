package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.integration.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class ApiManagementTest {
    @TempDir Path temp;
    private static RequestRecord record(String path, int status) {
        var r = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", path, status, "anon");
        r.hasResponse = true; r.responseContentType = "application/json"; r.body = "{}";
        r.reqText = "GET " + path + " HTTP/1.1\r\nAuthorization: Bearer SECRET\r\n\r\n";
        r.reqText = Masking.maskHeaders(r.reqText);
        return r;
    }
    private static ApiManagement.Request change(String action, List<String> ops, List<String> ids, String color, List<String> expected) {
        return new ApiManagement.Request(action, 0, 0, ops, ids, color, expected);
    }
    private static ApiManagement.Change prepare(ApiManagement.Request change, List<RequestRecord> records, AnalysisConfig config, List<RouteCandidate> routes) {
        return ApiManagement.prepare(change, Pipeline.runIsolated(records, config), records, config, routes, RequestLabWorkspace.empty());
    }
    private static RouteCandidate declared(String path, String evidence, String run) {
        return new RouteCandidate("https://api.test:443", "GET", path, false,
                List.of(new RouteCandidate.Provenance(RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, evidence, Source.HUMAN, run, "fetch")),
                RouteCandidate.Applicability.APPLICABLE, "fetch declaration");
    }
    @Test void highlightsAndHumanRegistrationRoundTripInBothStoresAndSnapshots() throws Exception {
        var records = List.of(record("/api/orders", 200));
        var result = Pipeline.runIsolated(records, new AnalysisConfig());
        String op = ApiManagement.operation(result.records.getFirst()), id = result.records.getFirst().evidenceId;
        var highlighted = prepare(change("highlight", List.of(op), List.of(), "purple", null), records, new AnalysisConfig(), List.of());
        assertTrue(new AnalysisConfig().apiState().highlights().isEmpty());
        var registered = prepare(change("register", List.of(op), List.of(id), "", null), records, highlighted.config(), List.of());
        registered.config().restoreApiState(new ApiState(registered.config().apiState().highlights(), Map.of(op, Set.of("JAVASCRIPT_LITERAL\u0000ev-script\u0000old-run"))));
        var json = new ProjectStore(); var sqlite = new SqliteProjectStore(json);
        Path file = temp.resolve("marks.json"), db = temp.resolve("marks.db");
        json.save(file, records, registered.config(), List.of());
        sqlite.save(db, records, registered.config(), List.of(), List.of(), Set.of(), List.of());
        for (var loaded : List.of(json.load(file), sqlite.load(db))) {
            assertEquals(registered.config().apiState(), loaded.config().apiState());
            var marks = ApiManagement.marks(Pipeline.runIsolated(loaded.records(), loaded.config()), loaded.config(), loaded.routeCandidates());
            assertEquals("purple", marks.get(op).color()); assertTrue(marks.get(op).registered());
            assertEquals(List.of(id), marks.get(op).evidenceIds());
            assertFalse(loaded.records().getFirst().requestTextForEvidence().contains("SECRET"));
        }
        var removed = prepare(change("unregister", List.of(op), List.of(), "", null), records, registered.config(), List.of());
        assertFalse(ApiManagement.marks(result, removed.config(), List.of()).get(op).registered());
        assertEquals("purple", removed.config().apiState().highlights().get(op));
    }
    @Test void registrationRequiresRealResponseEvidenceFromTheSameApi() {
        var first = record("/api/orders", 200); var other = record("/api/users", 200);
        var result = Pipeline.runIsolated(List.of(first, other), new AnalysisConfig());
        String op = ApiManagement.operation(result.records.getFirst());
        assertThrows(IllegalArgumentException.class, () -> prepare(change("register", List.of(op), List.of(result.records.getLast().evidenceId), "", null), List.of(first, other), new AnalysisConfig(), List.of()));
        assertThrows(IllegalArgumentException.class, () -> prepare(change("register", List.of(op), List.of(), "", null), List.of(first), new AnalysisConfig(), List.of()));
        first.hasResponse = false;
        var pending = Pipeline.runIsolated(List.of(first), new AnalysisConfig());
        assertThrows(IllegalArgumentException.class, () -> prepare(change("register", List.of(ApiManagement.operation(pending.records.getFirst())), List.of(pending.records.getFirst().evidenceId), "", null), List.of(first), new AnalysisConfig(), List.of()));
        assertThrows(IllegalArgumentException.class, () -> prepare(change("highlight", List.of(op), List.of(), "invalid", null), List.of(record("/api/orders", 200)), new AnalysisConfig(), List.of()));
    }
    @Test void previewIsReadOnlyAndApiDeletionRemovesDescendantsWithoutDeletingSharedDeclarations() throws Exception {
        var original = record("/api/orders", 200); var sibling = record("/api/orders", 403); var other = record("/api/users", 200);
        var config = new AnalysisConfig(); var first = Pipeline.runIsolated(List.of(original, sibling, other), config);
        String id = first.records.getFirst().evidenceId, op = ApiManagement.operation(first.records.getFirst());
        var child = record("/api/validate", 200); child.originEvidenceId = id;
        String childId = Pipeline.runIsolated(List.of(child), config).records.getFirst().evidenceId;
        var grandchild = record("/api/control", 200); grandchild.replayBasisEvidenceId = childId;
        var records = List.of(original, sibling, other, child, grandchild);
        var result = Pipeline.runIsolated(records, config);
        config.reviewItem("related", ReviewDecision.Status.CONFIRMED, "review", List.of(id));
        config.reviewItem("unrelated", ReviewDecision.Status.UNRESOLVED, "keep", List.of(result.records.get(2).evidenceId));
        config.restoreApiState(new ApiState(Map.of(op, "yellow"), Map.of()));
        var routes = List.of(declared("/api/orders", "ev-script", "old-run"), declared("/api/users", "ev-script", "old-run"));
        var lab = new RequestLabWorkspace.Change("create", 1, "draft", "GET /api/orders HTTP/1.1", "ORIGINAL", null, false, false, 1).apply(RequestLabWorkspace.empty(), id);
        var preview = ApiManagement.prepare(change("preview-delete", List.of(op), List.of(), "", null), result, records, config, routes, lab);
        assertEquals(4, preview.preview().records()); assertEquals(1, preview.preview().reviews());
        assertEquals(1, preview.preview().declarations()); assertEquals(2, config.reviews().size()); assertTrue(lab.tabs().containsKey(id));
        assertThrows(IllegalStateException.class, () -> ApiManagement.prepare(change("delete", List.of(op), List.of(), "", List.of(id)), result, records, config, routes, lab));
        var deleted = ApiManagement.prepare(change("delete", List.of(op), List.of(), "", preview.preview().evidenceIds()), result, records, config, routes, lab);
        assertEquals(List.of(other.runtimeId()), deleted.records().stream().map(RequestRecord::runtimeId).toList());
        assertEquals(Set.of("unrelated"), deleted.config().reviews().keySet()); assertTrue(deleted.requestLab().tabs().isEmpty());
        assertTrue(deleted.config().apiState().highlights().isEmpty());
        assertEquals(List.of("/api/users"), ApiManagement.filterRoutes(routes, deleted.config()).stream().map(RouteCandidate::pathTemplate).toList());
        assertEquals(1, ApiManagement.filterRoutes(List.of(declared("/api/orders", "ev-new-script", "new-run")), deleted.config()).size(), "new traffic is allowed to rediscover the API");
        var store = new SqliteProjectStore(new ProjectStore()); Path db = temp.resolve("delete.db");
        store.save(db, records, config, List.of(), List.of(), Set.of(), routes);
        store.save(db, deleted.records(), deleted.config(), List.of(), List.of(), Set.of(), deleted.routes());
        var reopened = store.load(db);
        assertEquals(1, reopened.records().size()); assertFalse(reopened.config().reviews().containsKey("related"));
        assertEquals(List.of("/api/users"), ApiManagement.filterRoutes(routes, reopened.config()).stream().map(RouteCandidate::pathTemplate).toList());
    }
    @Test void completedRunsLoseDeletedEvidenceAndCountsInsteadOfKeepingOrphanReferences() {
        var first = record("/api/orders", 200); var second = record("/api/users", 200);
        var result = Pipeline.runIsolated(List.of(first, second), new AnalysisConfig());
        var run = new RunContextRegistry.CompletedRun(Source.HUMAN, "human-run", SourceDetail.BROWSER, Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "account-a", java.time.Instant.now(),
                result.records.stream().map(r -> r.evidenceId).toList(), 2, 2);
        var remaining = ApiManagement.retainedRuns(Map.of(Source.HUMAN, run), List.of(result.records.getLast()), Set.of(result.records.getFirst().evidenceId));
        assertEquals(List.of(result.records.getLast().evidenceId), remaining.get(Source.HUMAN).evidenceIds());
        assertEquals(1, remaining.get(Source.HUMAN).responseCount());
        assertTrue(ApiManagement.retainedRuns(remaining, List.of(), Set.of(result.records.getLast().evidenceId)).isEmpty());
    }
    @Test void deletingADuplicateKeepsTheSurvivorsStableEvidenceIdAndRegistration() {
        var first = record("/api/orders", 200); var second = record("/api/orders", 200);
        var config = new AnalysisConfig(); var result = Pipeline.runIsolated(List.of(first, second), config);
        String op = ApiManagement.operation(result.records.getFirst()), id = result.records.getLast().evidenceId;
        config.reviewItem(ApiManagement.reviewId(op), ReviewDecision.Status.CONFIRMED, "confirmed", List.of(id));
        var preview = prepare(change("preview-delete", List.of(), List.of(result.records.getFirst().evidenceId), "", null), List.of(first, second), config, List.of());
        var deleted = prepare(change("delete", List.of(), preview.preview().evidenceIds(), "", preview.preview().evidenceIds()), List.of(first, second), config, List.of());
        var rebuilt = Pipeline.runIsolated(deleted.records(), deleted.config());
        assertEquals(id, rebuilt.records.getFirst().evidenceId);
        assertTrue(ApiManagement.marks(rebuilt, deleted.config(), List.of()).get(op).registered());
    }
    @Test void deletingOneObservationKeepsOtherObservationsAndSharedObjectPolicies() {
        var first = record("/api/orders/1", 200); first.body = "{\"id\":1}";
        var second = record("/api/orders/1", 403); second.body = first.body;
        var config = new AnalysisConfig(); var result = Pipeline.runIsolated(List.of(first, second), config);
        String op = ApiManagement.operation(result.records.getFirst()), id = result.records.getFirst().evidenceId;
        String resource = result.records.getFirst().resource;
        assertNotNull(resource);
        config.withResourceOwner(resource, "owner-a").withResourcePolicy(resource, ResourcePolicy.OWNER_ONLY);
        var preview = prepare(change("preview-delete", List.of(), List.of(id), "", null), List.of(first, second), config, List.of());
        var deleted = prepare(change("delete", List.of(), List.of(id), "", preview.preview().evidenceIds()), List.of(first, second), config, List.of());
        assertEquals(1, deleted.records().size()); assertEquals("owner-a", deleted.config().resourceOwner(resource));
        var all = prepare(change("preview-delete", List.of(op), List.of(), "", null), List.of(first, second), config, List.of());
        assertNull(all.config().resourceOwner(resource));
    }
}
