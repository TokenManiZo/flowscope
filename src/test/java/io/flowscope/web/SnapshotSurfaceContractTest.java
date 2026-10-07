package io.flowscope.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis.AuthorizationTargetLink;
import io.flowscope.core.SurfaceAnalysis.Confidence;
import io.flowscope.core.SurfaceAnalysis.EndpointKey;
import io.flowscope.core.SurfaceAnalysis.GapStatus;
import io.flowscope.core.SurfaceAnalysis.GapType;
import io.flowscope.core.SurfaceAnalysis.ParameterGap;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterValidationCell;
import io.flowscope.core.SurfaceAnalysis.SubjectClass;
import io.flowscope.core.Verdict;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.*;

/**
 * PR#11 SnapshotParameterContractTest·SnapshotParameterCacheTest를 우리 `snapshot.surface` 계약(D-143) 위로 이식한다.
 * 이식하지 않은 항목(attached generation·record fingerprint 캐시·bounded node 직렬화 seam·legacy UNKNOWN shape)은
 * D-143 5d 결정 기록에 사유를 남긴다. 값·digest·preview는 어떤 경우에도 snapshot에 나오지 않는다.
 */
final class SnapshotSurfaceContractTest {
    private static final List<String> SURFACE_ARRAYS = List.of("endpoints", "extractions", "probes",
            "parameterDiagnostics", "parameterGaps", "validationCells");
    private static final int PREVIEW = ParameterGap.MAX_EVIDENCE_IDS;
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void 빈_snapshot도_surface_배열을_비어_있는_채로_가산한다() throws Exception {
        JsonNode root = snapshot(new SnapshotJsonWriter(), 7, Pipeline.run(List.of()), List.of());
        JsonNode surface = root.path("surface");
        for (String field : SURFACE_ARRAYS) {
            assertTrue(surface.path(field).isArray(), field);
            assertEquals(0, surface.path(field).size(), field);
        }
        assertEquals(7, root.path("revision").asInt());
        assertTrue(root.path("cells").isArray());
        assertTrue(root.path("routeCandidates").isArray());
        assertEquals(0, root.path("trafficStats").path("coverage").asInt());
    }

    @Test
    void 모델은_중복_Evidence를_제거해_전체_수를_보존하고_32개_preview만_남긴다() {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 40; i++) ids.add("ev-%02d".formatted(i));
        ids.add("ev-00");
        EndpointKey key = new EndpointKey("https://app.test:443", "PATCH", "/api/orders/{id}");
        ParameterGap gap = new ParameterGap("gap", GapType.AUTH_VARIANT_UNTESTED, key, ParameterLocation.JSON_BODY,
                "/orderId", null, null, Source.HUMAN, GapStatus.OPEN, List.of(), "Untested", ids);
        AuthorizationTargetLink link = new AuthorizationTargetLink("orders:101", Confidence.INFERRED, "basis", ids);
        ParameterValidationCell cell = new ParameterValidationCell(key, ParameterLocation.JSON_BODY, "/orderId",
                "orders:101", SubjectClass.ANONYMOUS, Source.HUMAN, "anon", AccessRole.ANONYMOUS, Verdict.UNTESTED,
                "Untested", true, List.of(), ids, 0);
        assertEquals(40, gap.evidenceCount());
        assertEquals(PREVIEW, gap.evidenceIds().size());
        assertEquals(40, link.evidenceCount());
        assertEquals(PREVIEW, link.evidenceIds().size());
        assertEquals(40, cell.basisEvidenceCount());
        assertEquals(PREVIEW, cell.basisEvidenceIds().size());
        assertEquals(0, cell.evidenceCount());
        assertEquals(40, json.valueToTree(gap).path("evidenceCount").asInt());
        assertEquals(PREVIEW, json.valueToTree(gap).path("evidenceIds").size());
        assertEquals(40, json.valueToTree(cell).path("basisEvidenceCount").asInt());
        assertThrows(UnsupportedOperationException.class, () -> gap.evidenceIds().clear());
        assertThrows(UnsupportedOperationException.class, () -> link.evidenceIds().clear());
        assertThrows(UnsupportedOperationException.class, () -> cell.basisEvidenceIds().clear());
    }

    @Test
    void preview는_전체_수를_보존하고_UNTESTED_basis는_실제_Evidence와_분리되며_입력_순서에_무관하다() throws Exception {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 40; i++) records.add(request("ev-%02d".formatted(i), "{\"orderId\":101,\"status\":\"ordinary-scalar-sentinel\"}"));
        JsonNode root = snapshot(new SnapshotJsonWriter(), 7, Pipeline.run(records), List.of());
        JsonNode surface = root.path("surface");
        JsonNode parameter = parameter(surface, "JSON_BODY", "/orderId");
        assertEquals(40, parameter.path("profile").path("observationCount").asInt());
        assertEquals(40, parameter.path("observationEvidenceIds").size(), "사실은 관측 metadata를 Evidence마다 유지한다(값 없음)");
        JsonNode link = parameter.path("authorizationTargets").get(0);
        assertNotNull(link);
        assertEquals(40, link.path("evidenceCount").asInt());
        assertEquals(PREVIEW, link.path("evidenceIds").size());
        boolean untested = false;
        assertFalse(surface.path("validationCells").isEmpty());
        for (JsonNode cell : surface.path("validationCells")) {
            assertTrue(cell.has("source") && cell.has("subjectClass") && cell.has("applicable"));
            assertEquals(40, cell.path("basisEvidenceCount").asInt());
            assertEquals(PREVIEW, cell.path("basisEvidenceIds").size());
            assertNotEquals("ALLOW", cell.path("verdict").asText(), "소유자 미확정·역할 미지정에서는 ALLOW를 만들지 않는다");
            if (cell.path("verdict").asText().equals("UNTESTED")) {
                untested = true;
                assertEquals(0, cell.path("evidenceCount").asInt());
                assertEquals(0, cell.path("evidenceIds").size());
            }
        }
        assertTrue(untested);
        JsonNode gap = surface.path("parameterGaps").get(0);
        assertNotNull(gap);
        assertEquals(40, gap.path("evidenceCount").asInt());
        assertEquals(PREVIEW, gap.path("evidenceIds").size());
        assertFalse(surface.toString().contains("ordinary-scalar-sentinel"));
        assertFalse(surface.toString().contains("preview"));
        Collections.reverse(records);
        JsonNode reversed = snapshot(new SnapshotJsonWriter(), 7, Pipeline.run(records), List.of()).path("surface");
        assertOrderIndependent(surface, reversed);
    }

    /** Evidence 하나마다 한 항목을 갖는 사실 목록: 수집 순서를 보존하므로 순서 무관 비교에서만 정렬한다. */
    private static final List<String> PER_EVIDENCE_LISTS = List.of("observations", "observationEvidenceIds", "requestContexts",
            "declarations", "extractions", "probes");

    /**
     * 집계(프로파일·link·cell·gap·진단·선언 preview 선택)는 입력 순서와 무관해야 한다. Evidence별 사실 목록은
     * 수집 순서를 보존하는 것이 계약이므로 그 목록만 정렬해 비교한다(집계 값이 다르면 여기서 드러난다).
     */
    private void assertOrderIndependent(JsonNode expected, JsonNode actual) {
        for (String field : SURFACE_ARRAYS) {
            JsonNode left = sortedEvidenceLists(expected.path(field), field), right = sortedEvidenceLists(actual.path(field), field);
            assertEquals(left, right, field);
        }
    }

    private JsonNode sortedEvidenceLists(JsonNode node, String name) {
        if (node.isArray()) {
            List<JsonNode> items = new ArrayList<>();
            for (JsonNode item : node) items.add(sortedEvidenceLists(item, ""));
            if (PER_EVIDENCE_LISTS.contains(name)) items.sort(java.util.Comparator.comparing(JsonNode::toString));
            var out = json.createArrayNode();
            items.forEach(out::add);
            return out;
        }
        if (!node.isObject()) return node;
        var out = json.createObjectNode();
        node.fields().forEachRemaining(entry -> out.set(entry.getKey(), sortedEvidenceLists(entry.getValue(), entry.getKey())));
        return out;
    }

    @Test
    void 선언만_있는_입력은_관측_Evidence_없이_선언_증인만_가지고_후보_route와_함께_결정적으로_게시된다() throws Exception {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            RequestRecord r = new RequestRecord(Source.HUMAN, "https://app.test:443", "GET", "/openapi.json", 200, "anon");
            r.evidenceId = "spec-%02d".formatted(i);
            r.hasResponse = true;
            r.responseContentType = "application/json";
            r.body = "{\"openapi\":\"3.0.0\",\"paths\":{\"/unseen\":{\"get\":{\"parameters\":[{\"in\":\"query\",\"name\":\"q\",\"schema\":{\"type\":\"string\"}}]}}}}";
            records.add(r);
        }
        Pipeline.Result result = Pipeline.run(records);
        List<RouteCandidate> routes = RouteCandidateExtractor.extract(result.records, ScopePolicy.parse("https://app.test/"), List.of());
        assertTrue(routes.stream().anyMatch(route -> route.pathTemplate().equals("/unseen") && !route.observed()));
        JsonNode surface = snapshot(new SnapshotJsonWriter(), 7, result, routes).path("surface");
        JsonNode parameter = parameter(surface, "QUERY", "/q");
        assertEquals("DECLARED_NOT_OBSERVED", parameter.path("deltaState").asText());
        assertEquals(0, parameter.path("observationEvidenceIds").size());
        assertEquals(0, parameter.path("profile").path("observationCount").asInt());
        assertEquals(0, parameter.path("authorizationTargets").size());
        assertFalse(parameter.path("profile").path("serverUsageConfirmed").asBoolean());
        // Pipeline은 Evidence ID를 내용 digest로 부여하므로 명시한 "spec-*"가 아니라 실제 레코드 ID와 대조한다.
        List<String> recordIds = result.records.stream().map(r -> r.evidenceId).toList();
        List<String> declared = new ArrayList<>();
        for (JsonNode declaration : parameter.path("declarations")) {
            String id = declaration.path("evidenceId").asText("");
            if (!id.isEmpty()) declared.add(id);
        }
        assertFalse(declared.isEmpty());
        assertTrue(recordIds.containsAll(declared), "선언 증인은 정적 근거 레코드의 Evidence ID다");
        List<String> stablePreview = recordIds.stream().distinct().sorted().limit(PREVIEW).toList();
        assertEquals(stablePreview, declared.stream().distinct().sorted().toList(), "선언 preview는 입력 순서가 아니라 Evidence ID 순으로 32개를 고른다");
        JsonNode gap = surface.path("parameterGaps").get(0);
        assertNotNull(gap);
        assertEquals("DEFINED_NOT_OBSERVED", gap.path("type").asText());
        assertEquals(40, gap.path("evidenceCount").asLong(), "gap은 preview 상한과 무관하게 선언 증인 전체 수를 보존한다");
        assertEquals(PREVIEW, gap.path("evidenceIds").size());
        List<String> gapPreview = new ArrayList<>();
        for (JsonNode id : gap.path("evidenceIds")) gapPreview.add(id.asText());
        assertEquals(stablePreview, gapPreview);
        assertTrue(surface.path("parameterDiagnostics").toString().contains("DECLARATION_LIMIT"), "잘린 선언 수는 진단으로 남는다");
        assertEquals(0, surface.path("validationCells").size(), "선언만 있으면 대상·subject 분모를 만들지 않는다");
        Collections.reverse(records);
        Pipeline.Result reversedResult = Pipeline.run(records);
        List<RouteCandidate> reversedRoutes = RouteCandidateExtractor.extract(reversedResult.records, ScopePolicy.parse("https://app.test/"), List.of());
        JsonNode reversed = snapshot(new SnapshotJsonWriter(), 7, reversedResult, reversedRoutes).path("surface");
        assertOrderIndependent(surface, reversed);
    }

    @Test
    void 실제_인가_Evidence와_VALIDATION_전용_성공은_각자_cell과_Evidence를_가진다() throws Exception {
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("alice", "Alice", "https://app.test:443", AccessRole.USER))
                .bindSession("https://app.test:443", "A", "alice")
                .withResourceOwner("https://app.test:443 orders:101", "alice");
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 40; i++) records.add(request("actual-%02d".formatted(i), "{\"orderId\":101}"));
        RequestRecord validation = request("validation", "{\"orderId\":101}");
        validation.phase = RunPhase.VALIDATION;
        records.add(validation);
        records.forEach(record -> record.collectionAccountId = "alice");
        Pipeline.Result result = Pipeline.run(records, config);
        JsonNode surface = json.readTree(new SnapshotJsonWriter().write(7, result, config, List.of(), List.of())).path("surface");
        assertEquals(40, parameter(surface, "JSON_BODY", "/orderId").path("profile").path("observationCount").asInt(),
                "VALIDATION 행은 프로파일 분모가 아니다");
        boolean actual = false, validationOnly = false;
        for (JsonNode cell : surface.path("validationCells")) {
            if (!cell.path("canonicalPath").asText().equals("/orderId") || !cell.path("subjectClass").asText().equals("SELF")) continue;
            assertEquals(41, cell.path("basisEvidenceCount").asInt(), "VALIDATION 행도 cell basis에는 참여한다");
            if (cell.path("verdict").asText().equals("ALLOW")) {
                actual = true;
                assertEquals(40, cell.path("evidenceCount").asInt());
                assertEquals(PREVIEW, cell.path("evidenceIds").size());
                assertFalse(cell.path("evidenceIds").toString().contains(validation.evidenceId));
            } else if (cell.path("verdict").asText().equals("UNDECIDED")) {
                validationOnly = true;
                assertEquals(1, cell.path("evidenceCount").asInt());
                assertEquals(validation.evidenceId, cell.path("evidenceIds").get(0).asText());
            }
        }
        assertTrue(actual, "정본 Decision에 결박된 실제 관측은 ALLOW cell");
        assertTrue(validationOnly, "VALIDATION 전용 성공은 정본 Decision이 없어 UNDECIDED cell");
    }

    @Test
    void password_파라미터도_좌표로_게시하고_값은_표면에_넣지_않는다() throws Exception {
        RequestRecord a = request("ev-secret-a", "{\"safe\":true,\"password\":\"password-value\"}");
        RequestRecord b = request("ev-secret-b", a.reqBody);
        JsonNode surface = snapshot(new SnapshotJsonWriter(), 7, Pipeline.run(List.of(a, b)), List.of()).path("surface");
        assertEquals(0, surface.path("parameterDiagnostics").size());
        assertNotNull(parameter(surface, "JSON_BODY", "/safe"));
        assertNotNull(parameter(surface, "JSON_BODY", "/password"));
        String serialized = surface.toString();
        assertFalse(serialized.contains("password-value"), "표면 요약은 값이 아니라 좌표만 담는다");
        assertFalse(serialized.contains("preview"));
    }

    @Test
    void 캐시는_현재_게시본_하나만_유지하고_설정_변경은_소비하지_않는다() throws Exception {
        SnapshotJsonWriter writer = new SnapshotJsonWriter();
        Pipeline.Result result = Pipeline.run(List.of(request("ev-cache", "{\"orderId\":101}")));
        AnalysisConfig config = new AnalysisConfig();
        writer.write(7, result, config, List.of(), List.of());
        writer.write(7, result, config, List.of(), List.of());
        assertEquals(1, writer.surfaceBuildCount());
        writer.write(8, result, config, List.of(), List.of());
        assertEquals(2, writer.surfaceBuildCount());
        result = Pipeline.run(List.of(request("ev-cache", "{\"orderId\":101}")));
        writer.write(8, result, config, List.of(), List.of());
        assertEquals(3, writer.surfaceBuildCount());
        config.withIdentityRole("owner", AccessRole.ADMIN);
        writer.write(8, result, config, List.of(), List.of());
        assertEquals(3, writer.surfaceBuildCount(), "config는 Pipeline.run에서 소비되므로 같은 Result에는 영향이 없다");
        SnapshotJsonWriter another = new SnapshotJsonWriter();
        another.write(8, result, config, List.of(), List.of());
        assertEquals(1, another.surfaceBuildCount());
        writer.write(7, result, config, List.of(), List.of());
        assertEquals(4, writer.surfaceBuildCount(), "이전 revision으로 돌아가면 다시 계산한다(현재 게시본만 캐시)");
        List<RouteCandidate> routes = new ArrayList<>();
        writer.write(7, result, config, List.of(), List.of(), List.of(), routes);
        assertEquals(5, writer.surfaceBuildCount(), "route 후보 목록 인스턴스가 바뀌면 다시 계산한다");
        writer.write(7, result, config, List.of(), List.of(), List.of(), routes);
        assertEquals(5, writer.surfaceBuildCount());
    }

    @Test
    void 같은_게시본에_대한_동시_poll은_한_번만_계산하고_같은_바이트를_돌려준다() throws Exception {
        SnapshotJsonWriter writer = new SnapshotJsonWriter();
        Pipeline.Result result = Pipeline.run(List.of(request("ev-poll", "{\"orderId\":101}")));
        AnalysisConfig config = new AnalysisConfig();
        try (var executor = Executors.newFixedThreadPool(4)) {
            List<Callable<byte[]>> calls = new ArrayList<>();
            for (int i = 0; i < 12; i++) calls.add(() -> writer.write(7, result, config, List.of(), List.of()));
            List<Future<byte[]>> futures = executor.invokeAll(calls);
            byte[] first = futures.getFirst().get();
            for (Future<byte[]> future : futures) assertArrayEquals(first, future.get());
        }
        assertEquals(1, writer.surfaceBuildCount());
    }

    @Test
    void 같은_게시본이_다시_계산되지_않으면_레코드_원문_변경도_surface를_바꾸지_않는다() throws Exception {
        SnapshotJsonWriter writer = new SnapshotJsonWriter();
        RequestRecord record = request("ev-attached", "{\"orderId\":101}");
        Pipeline.Result result = Pipeline.run(List.of(record));
        JsonNode before = snapshot(writer, 7, result, List.of()).path("surface");
        assertFalse(before.path("endpoints").isEmpty());
        result.records.getFirst().reqBody = "{\"different\":true,\"password\":\"secret-value\"}";
        JsonNode after = snapshot(writer, 7, result, List.of()).path("surface");
        for (String field : SURFACE_ARRAYS) assertEquals(before.path(field), after.path(field), field);
        assertFalse(after.toString().contains("different"));
        assertEquals(1, writer.surfaceBuildCount());
        JsonNode recomputed = snapshot(writer, 8, result, List.of()).path("surface");
        assertNotNull(parameter(recomputed, "JSON_BODY", "/different"), "새 revision은 현재 레코드로 다시 계산한다");
        assertFalse(recomputed.toString().contains("secret-value"));
    }

    private JsonNode snapshot(SnapshotJsonWriter writer, long revision, Pipeline.Result result, List<RouteCandidate> routes) throws Exception {
        return json.readTree(writer.write(revision, result, new AnalysisConfig(), List.of(), List.of(), List.of(), routes));
    }

    private static JsonNode parameter(JsonNode surface, String location, String canonicalPath) {
        for (JsonNode endpoint : surface.path("endpoints")) {
            for (JsonNode parameter : endpoint.path("parameters")) {
                if (location.equals(parameter.path("location").asText()) && canonicalPath.equals(parameter.path("canonicalPath").asText())) return parameter;
            }
        }
        fail("Missing parameter " + location + " " + canonicalPath + " in " + surface.path("endpoints"));
        return null;
    }

    private static RequestRecord request(String evidence, String body) {
        RequestRecord r = new RequestRecord(Source.HUMAN, "https://app.test:443", "PATCH", "/api/orders/101", 200, "A");
        r.collectionAccountId = "user-a";
        r.evidenceId = evidence;
        r.reqBody = body;
        r.requestContentType = "application/json";
        r.responseContentType = "application/json";
        r.body = "{\"id\":101}";
        r.hasResponse = true;
        r.phase = RunPhase.EXPLORATION;
        return r;
    }
}
