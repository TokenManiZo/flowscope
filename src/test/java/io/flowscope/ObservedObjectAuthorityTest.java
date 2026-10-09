package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.core.graph.ObservedObjectProjection;
import io.flowscope.web.SnapshotJsonWriter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ObservedObjectAuthorityTest {
    static final String SERVICE = "https://obj.test:443";
    private AnalysisConfig config() {
        return new AnalysisConfig().upsertAccount(new AccountProfile("a", "A", SERVICE, AccessRole.USER))
                .upsertAccount(new AccountProfile("b", "B", SERVICE, AccessRole.USER));
    }
    private RequestRecord record(String id, String method, String path, String query, String body, String response) {
        var record = new RequestRecord(Source.HUMAN, SERVICE, method, path, 200, "token-" + id);
        record.collectionAccountId = id; record.query = query; record.reqBody = body;
        record.requestContentType = "application/json"; record.responseContentType = "application/json";
        record.body = response; record.hasResponse = true; record.phase = RunPhase.EXPLORATION;
        record.reqText = method + " " + path + (query == null ? "" : "?" + query) + " HTTP/1.1\r\nHost: obj.test\r\n\r\n" + (body == null ? "" : body);
        return record;
    }
    @Test void graphAndMatrixUseExactlyTheSameCoreObjKeysWithoutChangingRecognitionOrRawEvidence() throws Exception {
        var config = config();
        var a = record("a", "POST", "/api/posts/7", "post_id=7", "{\"post_id\":7}", "{\"id\":7}");
        var b = record("b", "POST", "/api/posts/7", "post_id=7", "{\"post_id\":7}", "{\"id\":7}");
        String original = a.reqText;
        var result = Pipeline.run(List.of(a,b), config);
        assertEquals(Set.of("PATH", "QUERY", "REQUEST_BODY"), result.objects.targets().values().stream().map(ObservedObjectIndex.Target::kind).collect(java.util.stream.Collectors.toSet()));
        assertEquals(ObservedObjectProjection.build(result.coverageRecords), result.objects.observations());
        Set<String> targets = result.objects.targets().keySet();
        var matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        assertEquals(targets, matrix.objects().stream().map(AuthorizationMatrix.ObjectCell::resource).collect(java.util.stream.Collectors.toSet()));
        assertEquals(targets, result.graph.nodes().stream().filter(node -> node.type == io.flowscope.core.graph.FlowGraph.NodeType.RESOURCE).map(node -> node.id.substring(2)).collect(java.util.stream.Collectors.toSet()));
        for (String key : targets) config.withResourceOwner(key, "a");
        result = Pipeline.run(List.of(a,b), config);
        assertTrue(result.analysis.owners().values().stream().allMatch(owner -> owner.identity().equals("a") && owner.confirmed()));
        var json = new ObjectMapper().readTree(new SnapshotJsonWriter().write(1, result, config, List.of(), List.of()));
        assertEquals(6, json.path("displayObjects").size());
        for (String key : targets) assertEquals("a", json.path("ownerOverrides").path(key).asText());
        assertEquals(original, a.reqText);
        assertFalse(a.resource.contains("observed-object:"), "compatibility metadata cannot overwrite the captured DTO");
    }
    @Test void publicIsSharedByGraphAndMatrixAndScopedToOneApiAndObj() {
        var config = config();
        var a = record("a", "GET", "/api/posts/7", "post_id=7", null, "{\"id\":7}");
        var b = record("b", "GET", "/api/posts/7", "post_id=7", null, "{\"id\":7}");
        var result = Pipeline.run(List.of(a,b), config);
        result.objects.targets().keySet().forEach(key -> config.withResourceOwner(key, "a"));
        var query = result.objects.targets().values().stream().filter(target -> target.kind().equals("QUERY")).findFirst().orElseThrow();
        config.withResourcePolicy(AnalysisConfig.operationObjectPolicyKey(query.operation(), query.resource()), ResourcePolicy.PUBLIC);
        config.withEndpointRequirement(query.operation(), AccessRole.USER);
        result = Pipeline.run(List.of(a,b), config);
        var matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        var publicCell = matrix.objects().stream().filter(cell -> cell.identity().equals("b") && cell.resource().equals(query.resource())).findFirst().orElseThrow();
        assertEquals(AuthorizationMatrix.Expected.ALLOW, publicCell.expected());
        assertFalse(publicCell.status().name().contains("CANDIDATE"));
        assertTrue(result.analysis.findings().stream().anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA && !finding.cell().resource().equals(query.resource())));
    }
    @Test void auxiliaryStaticReplayAndDeniedOnlyInputsCannotBecomeJudgmentTargets() {
        var api = record("a", "GET", "/api/items", "id=1", null, "{\"id\":1}");
        var staticAsset = record("a", "GET", "/assets/app.js", "id=2", null, "var x=1;");
        var polling = record("a", "GET", "/session/state", null, null, "ready");
        polling.requestContentType = null;
        polling.responseContentType = "text/plain";
        var replay = record("a", "GET", "/api/items", "id=4", null, "{\"id\":4}");
        replay.phase = RunPhase.VALIDATION;
        var denied = new RequestRecord(Source.SCANNER, SERVICE, "GET", "/api/items", 403, "b");
        denied.collectionAccountId = "b"; denied.query = "id=5"; denied.hasResponse = true; denied.body = "{\"error\":\"forbidden\"}";
        var result = Pipeline.run(List.of(api,staticAsset,polling,replay,denied), config());
        assertEquals(Set.of(api.evidenceId), result.objects.observations().stream().map(ObservedObjectProjection.ObjectObservation::eventId).collect(java.util.stream.Collectors.toSet()));
        assertEquals(5, result.records.size());
    }
    @Test void paginationOwnershipCanBeAssignedButSuccessDoesNotProveIdor() {
        var config = config();
        var a = record("a", "GET", "/api/posts", "limit=10&offset=0", null, "{\"items\":[]}");
        var b = record("b", "GET", "/api/posts", "limit=10&offset=0", null, "{\"items\":[]}");
        var result = Pipeline.run(List.of(a,b), config);
        String key = result.objects.targets().keySet().iterator().next();
        assertNull(result.objects.reference(key)); config.withResourceOwner(key, "a");
        result = Pipeline.run(List.of(a,b), config);
        assertEquals("a", result.analysis.owners().get(key).identity());
        assertEquals(Verdict.UNDECIDED, result.analysis.cells().stream().filter(cell -> key.equals(cell.key().resource()) && cell.key().identity().equals("b")).findFirst().orElseThrow().overall());
        assertTrue(result.analysis.findings().isEmpty());
    }
    @Test void bflaHasOneEndpointCellAndFindingEvenWhenOneRequestContainsThreeObjChannels() {
        var config = config();
        var a = record("a", "POST", "/api/posts/7", "post_id=7", "{\"post_id\":7}", "{\"id\":7}");
        var b = record("b", "POST", "/api/posts/7", "post_id=7", "{\"post_id\":7}", "{\"id\":7}");
        Pipeline.run(List.of(a,b), config); config.withEndpointRequirement(a.op, AccessRole.ADMIN);
        var result = Pipeline.run(List.of(a,b), config);
        var matrix = AuthorizationMatrixAnalyzer.analyze(result, config, List.of());
        assertEquals(2, matrix.functions().size());
        assertEquals(1, matrix.functions().stream().filter(cell -> cell.identity().equals("a")).findFirst().orElseThrow().evidenceIds().size());
        assertEquals(2, result.analysis.findings().stream().filter(finding -> finding.type() == AuthorizationAnalysis.FindingType.BFLA).count());
        assertTrue(result.analysis.findings().stream().allMatch(finding -> finding.cell().resource() == null));
    }
    @Test void controlledReplayReusesExistingObjWithoutCreatingOrRenumberingTargets() {
        var a = record("a", "GET", "/api/posts/7", "post_id=7", null, "{\"id\":7,\"ownerId\":\"a\"}");
        var witness = record("a", "GET", "/api/posts/8", null, null, "{\"id\":8}");
        var replay = record("b", "GET", "/api/posts/7", "post_id=7", null, "{\"id\":7}");
        replay.phase = RunPhase.AUTHORIZATION_REPLAY; replay.sourceDetail = SourceDetail.AUTHORIZATION_REPLAY;
        replay.executionTrust = ExecutionTrust.CONTROLLED;
        var newTuple = record("b", "GET", "/api/posts/9", "post_id=9", null, "{\"id\":9}");
        newTuple.phase = replay.phase; newTuple.sourceDetail = replay.sourceDetail; newTuple.executionTrust = replay.executionTrust;
        var baseline = Pipeline.run(List.of(a,witness), config());
        var result = Pipeline.run(List.of(a,witness,replay,newTuple), config());
        assertEquals(baseline.objects.targets().keySet(), result.objects.targets().keySet());
        assertEquals(result.objects.resources(a.evidenceId), result.objects.resources(replay.evidenceId));
        assertTrue(result.objects.resources(newTuple.evidenceId).isEmpty());
        assertTrue(result.objects.observations().stream().noneMatch(object -> object.eventId().equals(replay.evidenceId)));
        assertTrue(result.analysis.findings().stream().anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA));
    }
    @Test void nestedParentsAndAmbiguousIdentifierTuplesKeepIndependentOwnership() {
        var a = record("a", "GET", "/api/users/1/posts/7", "", null, "{\"id\":7,\"ownerId\":\"a\"}");
        var b = record("b", "GET", "/api/users/2/posts/7", "", null, "{\"id\":7,\"ownerId\":\"b\"}");
        var otherA = record("a", "GET", "/api/users/1/posts/8", "", null, "{\"id\":8}");
        var otherB = record("b", "GET", "/api/users/2/posts/8", "", null, "{\"id\":8}");
        var result = Pipeline.run(List.of(a,b,otherA,otherB), config());
        for (RequestRecord record : List.of(a,b)) assertEquals(record.idn, result.analysis.owners().get(result.objects.resources(record.evidenceId).iterator().next()).identity());
        var ambiguous = record("a", "GET", "/api/posts", "id=7&id=8", null, "{\"id\":8}");
        result = Pipeline.run(List.of(ambiguous), config());
        assertTrue(result.objects.targets().values().stream().allMatch(target -> target.responseReference() == null));
    }
}
