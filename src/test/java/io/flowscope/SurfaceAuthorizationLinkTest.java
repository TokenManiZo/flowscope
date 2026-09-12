package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.AuthorizationAnalyzer;
import io.flowscope.core.Fingerprints;
import io.flowscope.core.Normalizer;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.StoredPayload;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SurfaceAnalysis.AuthorizationTargetLink;
import io.flowscope.core.SurfaceAnalysis.Confidence;
import io.flowscope.core.SurfaceAnalysis.EndpointKey;
import io.flowscope.core.SurfaceAnalysis.GapType;
import io.flowscope.core.SurfaceAnalysis.ParameterFact;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterValidationCell;
import io.flowscope.core.SurfaceAnalysis.SubjectClass;
import io.flowscope.core.SurfaceAnalyzer;
import io.flowscope.core.TrafficClassification;
import io.flowscope.core.Verdict;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static io.flowscope.core.SurfaceAnalysis.SubjectClass.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * PR#11 ParameterAuthorizationAnalyzer 의미(입력→권한 대상 link, subject×source 검증 cell, AUTH_VARIANT_UNTESTED)를
 * SurfaceAnalysis 위에서 검증한다. 인가 판정 정본은 AuthorizationAnalysis이며 여기서는 재판정하지 않는다(D-050·D-004).
 */
final class SurfaceAuthorizationLinkTest {
    private static final AtomicInteger IDS = new AtomicInteger();

    @Test
    void 정확한_ID는_OBSERVED이고_일반_필드는_독립_근거_2건이_있어야_CORROBORATED다() {
        RequestRecord a = record(Source.HUMAN, "A", "PATCH", 200, "{\"status\":\"READY\",\"orderId\":101}");
        AuthorizationAnalysis auth = authorization(List.of(a), true);
        SurfaceAnalysis one = enrich(List.of(a), auth);
        assertEquals(Confidence.OBSERVED, link(one, "/orderId").confidence());
        assertEquals("EXACT_SCALAR_RESOURCE_REFERENCE", link(one, "/orderId").basis());
        assertEquals(Confidence.INFERRED, link(one, "/status").confidence());
        assertEquals(Confidence.INFERRED, link(enrich(List.of(a, a), auth), "/status").confidence(), "같은 Evidence 반복은 독립 근거가 아니다");
        RequestRecord b = record(Source.HUMAN, "A", "PATCH", 200, a.reqBody);
        SurfaceAnalysis two = enrich(List.of(a, b), authorization(List.of(a, b), true));
        assertEquals(Confidence.CORROBORATED, link(two, "/status").confidence());
        assertEquals("INDEPENDENT_RESOURCE_TYPE_COOCCURRENCE", link(two, "/status").basis());
    }

    @Test
    void 다중_대상은_일반_필드를_승격하지_않고_같은_값의_비의미_필드도_승격하지_않는다() {
        RequestRecord r = record(Source.HUMAN, "A", "PATCH", 200, "{\"status\":101,\"orderId\":101,\"userId\":202}");
        SurfaceAnalysis result = enrich(List.of(r), authorization(List.of(r), true));
        assertEquals(Confidence.UNKNOWN, link(result, "/status").confidence(), "값이 같아도 의미 필드가 아니면 연결하지 않는다");
        assertEquals(Confidence.OBSERVED, link(result, "/orderId").confidence());
        assertEquals(Confidence.OBSERVED, link(result, "/userId").confidence());
    }

    @Test
    void 모든_subject의_판정은_인가_정본을_재사용하고_한_Evidence가_두_차원에_남는다() {
        RequestRecord self = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        RequestRecord other = record(Source.HUMAN, "B", "PATCH", 200, self.reqBody);
        RequestRecord anon = record(Source.SCANNER, Fingerprints.ANONYMOUS, "PATCH", 403, self.reqBody);
        RequestRecord admin = record(Source.HUMAN, "C", "PATCH", 200, self.reqBody);
        List<RequestRecord> records = List.of(self, other, anon, admin);
        AuthorizationAnalysis auth = authorization(records, true);
        List<AuthorizationAnalysis.Finding> findings = List.copyOf(auth.findings());
        SurfaceAnalysis result = enrich(records, auth);
        assertCell(result, self, SELF, Verdict.ALLOW);
        assertCell(result, other, OTHER_OWNER, Verdict.SUSPICIOUS);
        assertCell(result, anon, ANONYMOUS, Verdict.DENY);
        assertCell(result, admin, OTHER_ROLE, Verdict.ALLOW);
        assertCell(result, admin, OTHER_OWNER, Verdict.ALLOW);
        assertEquals(findings, auth.findings(), "정본 finding은 바뀌지 않는다");
        assertTrue(result.validationCells().stream().allMatch(c -> c.verdict() == Verdict.UNTESTED
                ? c.evidenceIds().isEmpty() && !c.basisEvidenceIds().isEmpty() : !c.evidenceIds().isEmpty()));
    }

    @Test
    void 미확정_소유자나_첫_성공_소유자는_SELF_ALLOW를_만들지_않는다() {
        RequestRecord r = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        AuthorizationAnalysis auth = authorization(List.of(r), false);
        assertFalse(auth.owners().get(r.resource).confirmed());
        SurfaceAnalysis result = enrich(List.of(r), auth);
        assertTrue(result.validationCells().stream().noneMatch(c -> c.verdict() == Verdict.ALLOW));
        assertTrue(result.validationCells().stream().filter(c -> c.subjectClass() == SELF).noneMatch(ParameterValidationCell::applicable));
        assertTrue(enrich(List.of(r), AuthorizationAnalysis.empty()).validationCells().stream()
                .noneMatch(c -> c.verdict() == Verdict.ALLOW));
    }

    @Test
    void metadata_method와_모호한_응답은_ALLOW가_되지_않는다() {
        for (String method : List.of("OPTIONS", "HEAD")) {
            RequestRecord r = record(Source.HUMAN, "A", method, 200, "{\"orderId\":101}");
            assertCell(enrich(List.of(r), authorization(List.of(r), true)), r, SELF, Verdict.UNDECIDED);
        }
        for (int status : List.of(404, 429, 500)) {
            RequestRecord r = record(Source.HUMAN, "A", "PATCH", status, "{\"orderId\":101}");
            assertCell(enrich(List.of(r), authorization(List.of(r), true)), r, SELF, Verdict.UNDECIDED);
        }
        RequestRecord denied = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        denied.body = "{\"error\":\"forbidden\"}";
        assertCell(enrich(List.of(denied), authorization(List.of(denied), true)), denied, SELF, Verdict.DENY);
    }

    @Test
    void VALIDATION_Evidence는_discovery를_늘리지_않고_cell과_link에만_연결되며_ALLOW를_빌리지_않는다() {
        RequestRecord discovery = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        RequestRecord validation = record(Source.HUMAN, "A", "PATCH", 200, discovery.reqBody);
        validation.phase = RunPhase.VALIDATION;
        RequestRecord denied = record(Source.SCANNER, Fingerprints.ANONYMOUS, "PATCH", 200, discovery.reqBody);
        denied.phase = RunPhase.VALIDATION;
        denied.body = "{\"error\":\"access denied\"}";
        List<RequestRecord> records = List.of(discovery, validation, denied);
        SurfaceAnalysis result = enrich(records, authorization(records, true));
        ParameterFact orderId = fact(result, "/orderId");
        assertEquals(1, orderId.profile().observationCount(), "VALIDATION은 discovery 관측이 아니다");
        assertEquals(List.of(discovery.evidenceId), orderId.observationEvidenceIds());
        assertCell(result, validation, SELF, Verdict.UNDECIDED);
        assertCell(result, denied, ANONYMOUS, Verdict.DENY);
        assertTrue(link(result, "/orderId").evidenceIds().contains(validation.evidenceId));
    }

    @Test
    void 미검증_변형은_finding이_아니라_증인이_있는_gap이다() {
        RequestRecord self = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        AuthorizationAnalysis auth = authorization(List.of(self), true);
        SurfaceAnalysis result = enrich(List.of(self), auth);
        assertTrue(result.validationCells().stream().anyMatch(c -> c.subjectClass() == ANONYMOUS && c.verdict() == Verdict.UNTESTED));
        assertTrue(result.validationCells().stream().filter(c -> c.verdict() == Verdict.UNTESTED)
                .allMatch(c -> c.evidenceIds().isEmpty() && c.basisEvidenceIds().contains(self.evidenceId)));
        assertTrue(result.parameterGaps().stream().anyMatch(g -> g.type() == GapType.AUTH_VARIANT_UNTESTED
                && g.evidenceIds().contains(self.evidenceId) && g.canonicalPath().equals("/orderId")
                && g.id().startsWith("pg:auth:")));
        assertTrue(auth.findings().isEmpty());
    }

    @Test
    void link_cell_gap은_결정적이고_상한이_있으며_불변이다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 40; i++) records.add(record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}"));
        AuthorizationAnalysis auth = authorization(records, true);
        SurfaceAnalysis result = enrich(records, auth);
        Collections.reverse(records);
        SurfaceAnalysis reversed = enrich(records, auth);
        assertEquals(result.validationCells(), reversed.validationCells());
        assertEquals(result.parameterGaps(), reversed.parameterGaps());
        assertEquals(links(result, "/orderId"), links(reversed, "/orderId"));
        assertEquals(32, link(result, "/orderId").evidenceIds().size());
        assertEquals(40, link(result, "/orderId").evidenceCount());
        assertTrue(result.validationCells().stream().anyMatch(c -> c.subjectClass() == SELF && c.evidenceCount() == 40));
        assertTrue(result.validationCells().stream().allMatch(c -> c.evidenceIds().size() <= 32));
        assertThrows(UnsupportedOperationException.class, () -> result.validationCells().clear());
        assertThrows(UnsupportedOperationException.class, () -> link(result, "/orderId").evidenceIds().clear());
        assertThrows(UnsupportedOperationException.class, () -> fact(result, "/orderId").authorizationTargets().clear());
    }

    @Test
    void corroborated_semantic_참조는_정확한_스칼라_필드만_연결한다() {
        RequestRecord a = new RequestRecord(Source.HUMAN, "https://example.test:443", "PATCH", "/api/orders", 200, "A");
        a.evidenceId = "ev-semantic-a";
        a.reqBody = "{\"orderNumber\":\"ABC\",\"status\":\"ABC\"}";
        a.requestContentType = "application/json";
        a.hasResponse = true;
        a.phase = RunPhase.EXPLORATION;
        a.trafficClassification = record(Source.HUMAN, "A", "PATCH", 200, "{}").trafficClassification;
        RequestRecord b = a.analysisCopy();
        b.evidenceId = "ev-semantic-b";
        b.reqBody = "{\"orderNumber\":\"DEF\",\"status\":\"DEF\"}";
        List<RequestRecord> records = List.of(a, b);
        SurfaceAnalysis result = enrich(records, authorization(records, false));
        assertFalse(links(result, "/orderNumber").isEmpty());
        assertTrue(links(result, "/orderNumber").stream().allMatch(l -> l.confidence() == Confidence.OBSERVED));
        assertEquals(Confidence.INFERRED, link(result, "/status").confidence(),
                "리소스별 link는 다른 리소스의 증인을 빌리지 않는다");
    }

    @Test
    void 미확정_subject는_basis만_갖고_다른_source의_판정을_빌리지_않는다() {
        RequestRecord a = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        SurfaceAnalysis noOwner = enrich(List.of(a), authorization(List.of(a), false));
        assertTrue(noOwner.validationCells().stream().filter(c -> c.subjectClass() == SELF || c.subjectClass() == OTHER_OWNER)
                .allMatch(c -> !c.applicable() && c.verdict() == Verdict.UNTESTED && c.evidenceIds().isEmpty()
                        && c.basisEvidenceIds().contains(a.evidenceId)));
        RequestRecord scanner = record(Source.SCANNER, "A", "PATCH", 200, a.reqBody);
        scanner.phase = RunPhase.VALIDATION;
        SurfaceAnalysis result = enrich(List.of(a, scanner), authorization(List.of(a, scanner), true));
        assertCell(result, scanner, SELF, Verdict.UNDECIDED);
    }

    @Test
    void 충돌하는_중복_Evidence는_link와_cell에서도_제외되고_operation_순서와_무관하다() {
        RequestRecord a = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        RequestRecord b = record(Source.SCANNER, "B", "PATCH", 403, a.reqBody);
        AuthorizationAnalysis auth = authorization(List.of(a, b), true);
        b.evidenceId = a.evidenceId;
        SurfaceAnalysis result = enrich(List.of(a, b), auth);
        assertTrue(result.endpoints().stream().allMatch(e -> e.parameters().isEmpty()));
        assertTrue(result.validationCells().isEmpty());
        assertEquals(result.validationCells(), enrich(List.of(b, a), auth).validationCells());

        RequestRecord get = record(Source.SCANNER, "B", "GET", 403, a.reqBody);
        AuthorizationAnalysis crossAuth = authorization(List.of(a, get), true);
        get.evidenceId = a.evidenceId;
        SurfaceAnalysis cross = enrich(List.of(a, get), crossAuth);
        assertTrue(cross.endpoints().stream().allMatch(e -> e.parameters().isEmpty()), "같은 Evidence ID는 operation이 달라도 충돌이다");
        assertTrue(cross.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("CONFLICTING_EVIDENCE")));
        assertEquals(cross.validationCells(), enrich(List.of(get, a), crossAuth).validationCells());
        assertEquals(cross.parameterGaps(), enrich(List.of(get, a), crossAuth).parameterGaps());
    }

    @Test
    void 미상_source는_사실이_아니므로_미검증_gap을_만들지_않는다() {
        RequestRecord r = record(Source.UNKNOWN, "A", "PATCH", 200, "{\"orderId\":101}");
        Normalizer.normalizeAll(List.of(r));
        AuthorizationAnalysis auth = new AuthorizationAnalysis(java.util.Map.of(r.resource,
                new AuthorizationAnalysis.OwnerInfo(r.resource, r.idn, 100, "configured", true)),
                List.of(), List.of(), List.of(), java.util.Set.of());
        SurfaceAnalysis result = enrich(List.of(r), auth);
        assertTrue(result.parameterGaps().stream().noneMatch(g -> g.type() == GapType.AUTH_VARIANT_UNTESTED));
        assertTrue(result.validationCells().isEmpty());
    }

    @Test
    void 필드를_생략한_요청의_집계_성공을_파라미터_부분집합이_빌리지_않는다() {
        for (String fp : List.of("A", "B")) for (int status : List.of(403, 500)) {
            RequestRecord owner = record(Source.HUMAN, "A", "PATCH", 200, "{}");
            RequestRecord success = record(Source.HUMAN, fp, "PATCH", 200, "{}");
            RequestRecord bearing = record(Source.HUMAN, fp, "PATCH", status, "{\"status\":\"READY\"}");
            List<RequestRecord> records = List.of(owner, success, bearing);
            AuthorizationAnalysis auth = authorization(records, true);
            assertTrue(auth.cells().stream().filter(c -> c.key().identity().equals(bearing.idn))
                    .anyMatch(c -> c.overall() == (fp.equals("A") ? Verdict.ALLOW : Verdict.SUSPICIOUS)));
            SurfaceAnalysis result = enrich(records, auth);
            List<ParameterValidationCell> tested = result.validationCells().stream()
                    .filter(c -> c.canonicalPath().equals("/status") && !c.evidenceIds().isEmpty()).toList();
            assertFalse(tested.isEmpty());
            assertTrue(tested.stream().allMatch(c -> c.verdict() == (status == 403 ? Verdict.DENY : Verdict.UNDECIDED)
                    && c.evidenceIds().equals(List.of(bearing.evidenceId)) && c.evidenceCount() == 1), fp + "/" + status);
        }
    }

    @Test
    void 성공한_파라미터_응답은_다른_응답의_객체_노출을_빌리지_않는다() {
        RequestRecord owner = record(Source.HUMAN, "A", "GET", 200, "{}");
        RequestRecord exposed = record(Source.HUMAN, "B", "GET", 200, "{}");
        RequestRecord bearing = record(Source.HUMAN, "B", "GET", 200, "{\"status\":\"READY\"}");
        bearing.body = "{\"ok\":true}";
        List<RequestRecord> records = List.of(owner, exposed, bearing);
        AuthorizationAnalysis auth = authorization(records, true);
        assertTrue(auth.cells().stream().anyMatch(c -> c.key().identity().equals(bearing.idn) && c.overall() == Verdict.SUSPICIOUS));
        SurfaceAnalysis result = enrich(records, auth);
        List<ParameterValidationCell> tested = result.validationCells().stream()
                .filter(c -> c.canonicalPath().equals("/status") && !c.evidenceIds().isEmpty()).toList();
        assertFalse(tested.isEmpty());
        assertTrue(tested.stream().allMatch(c -> c.verdict() == Verdict.UNDECIDED
                && c.evidenceIds().equals(List.of(bearing.evidenceId))));
    }

    @Test
    void 리소스별_corroboration은_자기_독립_증인만_공개하고_순서와_무관하다() {
        RequestRecord a = record(Source.HUMAN, "A", "PATCH", 200, "{\"status\":\"READY\"}");
        RequestRecord b = new RequestRecord(Source.HUMAN, a.service, "PATCH", "/api/orders/102", 200, "A");
        b.reqBody = a.reqBody;
        b.requestContentType = a.requestContentType;
        b.body = "{\"id\":102}";
        b.hasResponse = true;
        b.phase = a.phase;
        b.trafficClassification = a.trafficClassification;
        AuthorizationAnalysis auth = authorization(List.of(a, b), true);
        SurfaceAnalysis first = enrich(List.of(a, b), auth);
        assertEquals(links(first, "/status"), links(enrich(List.of(b, a), auth), "/status"));
        assertEquals(2, links(first, "/status").size());
        assertTrue(links(first, "/status").stream().allMatch(l -> l.confidence() == Confidence.INFERRED && l.evidenceIds().size() == 1));
        RequestRecord c = record(Source.HUMAN, "A", "PATCH", 200, a.reqBody);
        List<RequestRecord> records = List.of(a, b, c);
        auth = authorization(records, true);
        SurfaceAnalysis second = enrich(records, auth);
        assertEquals(links(second, "/status"), links(enrich(List.of(c, b, a), auth), "/status"));
        List<AuthorizationTargetLink> corroborated = links(second, "/status").stream()
                .filter(l -> l.confidence() == Confidence.CORROBORATED).toList();
        assertEquals(1, corroborated.size());
        assertEquals(a.resource, corroborated.getFirst().resource());
        assertTrue(corroborated.getFirst().evidenceIds().containsAll(List.of(a.evidenceId, c.evidenceId)));
    }

    @Test
    void 잘린_link는_완전한_증인을_공개하지_못하면_corroboration을_주장하지_않는다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 34; i++) {
            RequestRecord r = record(Source.HUMAN, "A", "PATCH", 200, "{\"status\":\"READY\"}");
            if (i < 32) r.requestPayload = StoredPayload.capture(r.reqBody, "application/json", 1);
            records.add(r);
        }
        AuthorizationAnalysis auth = authorization(records, true);
        for (int i = 0; i < records.size(); i++) records.get(i).evidenceId = String.format("ev-%016x", i);
        SurfaceAnalysis result = enrich(records, auth);
        assertEquals(Confidence.INFERRED, link(result, "/status").confidence());
        assertEquals(32, link(result, "/status").evidenceIds().size());
        assertEquals(34, link(result, "/status").evidenceCount());
        Collections.reverse(records);
        assertEquals(links(result, "/status"), links(enrich(records, auth), "/status"));
    }

    @Test
    void validation_cell은_모순된_Evidence와_count를_거부하고_목록을_정규화한다() throws Exception {
        for (long count : List.of(-1L, 0L, 2L)) {
            assertThrows(IllegalArgumentException.class, () -> cell(Verdict.ALLOW, true, List.of("ev-a"), List.of("ev-a"), count));
        }
        assertThrows(IllegalArgumentException.class, () -> cell(Verdict.UNTESTED, true, List.of(), List.of(), 0));
        assertThrows(IllegalArgumentException.class, () -> cell(Verdict.UNTESTED, true, List.of("ev-a"), List.of("ev-a"), 1));
        for (Verdict verdict : List.of(Verdict.ALLOW, Verdict.DENY, Verdict.SUSPICIOUS, Verdict.UNDECIDED)) {
            assertThrows(IllegalArgumentException.class, () -> cell(verdict, true, List.of(), List.of("ev-a"), 0));
        }
        assertThrows(IllegalArgumentException.class, () -> cell(Verdict.DENY, false, List.of("ev-a"), List.of(), 1));

        ParameterValidationCell unclassified = assertDoesNotThrow(() -> cell(Verdict.UNTESTED, false, null, null, 0));
        assertEquals(List.of(), unclassified.evidenceIds());
        assertEquals(List.of(), unclassified.basisEvidenceIds());
        List<String> ids = new ArrayList<>(List.of("ev-b", "ev-a", "ev-a"));
        ParameterValidationCell normalized = cell(Verdict.DENY, true, ids, ids, 2);
        ids.clear();
        assertEquals(List.of("ev-a", "ev-b"), normalized.evidenceIds());
        assertThrows(UnsupportedOperationException.class, () -> normalized.evidenceIds().clear());
        List<String> many = java.util.stream.IntStream.range(0, 40).mapToObj(i -> "ev-" + i).toList();
        ParameterValidationCell bounded = cell(Verdict.ALLOW, true, many, many, 40);
        assertEquals(32, bounded.evidenceIds().size());
        assertEquals(40, bounded.basisEvidenceCount());
        com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();
        assertEquals(bounded, json.readValue(json.writeValueAsString(bounded), ParameterValidationCell.class));
        assertThrows(IllegalArgumentException.class, () -> cell(Verdict.ALLOW, true, many, many, 41));
    }

    @Test
    void 불완전_payload는_미검증_gap이나_corroboration을_만들지_않는다() {
        RequestRecord a = record(Source.HUMAN, "A", "PATCH", 200, "{\"status\":\"READY\"}");
        a.requestPayload = StoredPayload.capture(a.reqBody, "application/json", 1);
        RequestRecord b = record(Source.HUMAN, "A", "PATCH", 200, a.reqBody);
        b.requestPayload = StoredPayload.capture(b.reqBody, "application/json", 1);
        List<RequestRecord> records = List.of(a, b);
        SurfaceAnalysis result = enrich(records, authorization(records, true));
        assertEquals(Confidence.INFERRED, link(result, "/status").confidence());
        assertTrue(result.parameterGaps().stream().noneMatch(g -> g.type() == GapType.AUTH_VARIANT_UNTESTED));
    }

    @Test
    void 인가_우선순위가_쓰기_우선순위보다_앞선다() {
        RequestRecord self = record(Source.HUMAN, "A", "PATCH", 200, "{\"orderId\":101}");
        SurfaceAnalysis result = enrich(List.of(self), authorization(List.of(self), true));
        SurfaceAnalysis.ParameterGap gap = result.parameterGaps().stream()
                .filter(g -> g.type() == GapType.AUTH_VARIANT_UNTESTED).findFirst().orElseThrow();
        assertEquals(List.of("CONFIRMED_AUTH_BOUNDARY", "AUTH_VARIANT_UNTESTED", "WRITE_METHOD"), gap.priorityReasons());
        assertEquals(gap, result.parameterGaps().getFirst(), "인가 사유가 있는 gap이 discovery gap보다 먼저다");
    }

    @Test
    void Pipeline_경로에서_link와_cell이_직렬화되고_값을_노출하지_않는다() {
        RequestRecord owner = pipelineRecord(Source.HUMAN, "owner-fp", "PATCH", "/api/orders/101", 200,
                "{\"status\":\"READY-SECRET\",\"orderId\":101}");
        RequestRecord other = pipelineRecord(Source.SCANNER, "other-fp", "PATCH", "/api/orders/101", 403,
                "{\"status\":\"READY\",\"orderId\":101}");
        AnalysisConfig config = new AnalysisConfig();
        Pipeline.Result probe = Pipeline.runIsolated(List.of(owner, other), config);
        String resource = probe.records.getFirst().resource;
        String ownerIdentity = probe.records.getFirst().idn;
        config = new AnalysisConfig().withResourceOwner(resource, ownerIdentity)
                .withIdentityRole(ownerIdentity, AccessRole.USER)
                .withIdentityRole(probe.records.get(1).idn, AccessRole.USER);
        Pipeline.Result result = Pipeline.runIsolated(List.of(owner, other), config);
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates, result.analysis);

        ParameterFact path = fact(analysis, "/segments/2");
        assertEquals(Confidence.OBSERVED, path.authorizationTargets().getFirst().confidence());
        assertEquals(resource, path.authorizationTargets().getFirst().resource());
        assertTrue(analysis.validationCells().stream().anyMatch(c -> c.canonicalPath().equals("/segments/2")
                && c.subjectClass() == SELF && c.source() == Source.HUMAN && c.verdict() == Verdict.ALLOW));
        assertTrue(analysis.validationCells().stream().anyMatch(c -> c.canonicalPath().equals("/segments/2")
                && c.subjectClass() == OTHER_OWNER && c.source() == Source.SCANNER && c.verdict() == Verdict.DENY));
        assertTrue(analysis.validationCells().stream().anyMatch(c -> c.subjectClass() == ANONYMOUS && c.verdict() == Verdict.UNTESTED
                && c.applicable() && !c.basisEvidenceIds().isEmpty()));
        String serialized = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(analysis).toString();
        assertTrue(serialized.contains("\"validationCells\"") && serialized.contains("\"authorizationTargets\""));
        assertFalse(serialized.contains("READY-SECRET"));
        assertFalse(serialized.contains("\"digest\""));
        String withoutSignatures = serialized.replaceAll("ctx:v1:sha256:[0-9a-f]+", "")
                .replaceAll("pg:(?:v1|auth):sha256:[0-9a-f]+", "");
        assertFalse(withoutSignatures.contains("sha256:"));
    }

    @Test
    void nestedPathSlotsReferenceTheirOwnResourcePrefixes() {
        assertNestedPathLinks("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    }

    @Test
    void repeatedNestedIdsRemainSeparatedByPathPosition() {
        assertNestedPathLinks("11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111");
    }

    private static void assertNestedPathLinks(String parentId, String childId) {
        RequestRecord record = pipelineRecord(Source.HUMAN, "anon", "GET",
                "/api/orders/" + parentId + "/items/" + childId, 200, null);
        record.body = "{\"id\":\"" + childId + "\"}";
        Pipeline.Result result = Pipeline.runIsolated(List.of(record), new AnalysisConfig());
        List<io.flowscope.core.ResourceReference> originalReferences = List.copyOf(result.records.getFirst().resourceReferences);
        SurfaceAnalysis surface = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, List.of(), result.analysis);

        AuthorizationTargetLink parent = link(surface, "/segments/2");
        AuthorizationTargetLink child = link(surface, "/segments/4");
        assertEquals(record.service + " orders:" + parentId, parent.resource());
        assertEquals(parent.resource() + "/items:" + childId, child.resource());
        assertEquals(Confidence.OBSERVED, parent.confidence());
        assertEquals(Confidence.OBSERVED, child.confidence());
        assertEquals(originalReferences, result.records.getFirst().resourceReferences,
                "Surface linking must not change the stored references or the authorization core");
    }

    @Test
    void repeatedCooccurrenceDoesNotConfirmAnAuthorizationBoundary() {
        RequestRecord first = record(Source.HUMAN, "A", "GET", 200, null);
        first.query = "sort=asc";
        RequestRecord second = record(Source.HUMAN, "A", "GET", 200, null);
        second.query = "sort=desc";
        List<RequestRecord> records = List.of(first, second);
        SurfaceAnalysis surface = enrich(records, authorization(records, true));

        assertEquals(Confidence.CORROBORATED, link(surface, "/sort").confidence(),
                "Cooccurrence remains useful recorded evidence, not an authorization proof");
        var gaps = surface.parameterGaps().stream().filter(gap -> gap.canonicalPath().equals("/sort")
                && gap.type() == GapType.AUTH_VARIANT_UNTESTED).toList();
        assertFalse(gaps.isEmpty());
        assertTrue(gaps.stream().noneMatch(gap -> gap.priorityReasons().contains("CONFIRMED_AUTH_BOUNDARY")));
        assertTrue(gaps.stream().allMatch(gap -> gap.priorityReasons().contains("HUMAN_REVIEW_REQUIRED")));
        assertTrue(surface.parameterGaps().stream().anyMatch(gap -> gap.canonicalPath().equals("/segments/2")
                && gap.priorityReasons().contains("CONFIRMED_AUTH_BOUNDARY")),
                "The confirmed owner's exact resource identifier keeps its established priority");
    }

    @Test
    void tenThousandParameterObservationsStayPartitionedByOperation() {
        List<RequestRecord> records = new ArrayList<>();
        String query = java.util.stream.IntStream.range(0, 100)
                .mapToObj(index -> "field" + index + "=" + index)
                .collect(java.util.stream.Collectors.joining("&"));
        for (int operation = 0; operation < 100; operation++) {
            RequestRecord record = new RequestRecord(Source.HUMAN, "https://scale.test:443", "GET",
                    "/api/type-" + operation, 200, "user-a");
            record.query = query;
            record.hasResponse = true;
            record.body = "{}";
            record.responseContentType = "application/json";
            record.phase = RunPhase.EXPLORATION;
            record.runId = "scale";
            records.add(record);
        }

        SurfaceAnalysis surface = assertTimeout(Duration.ofSeconds(10), () -> {
            Pipeline.Result pipeline = Pipeline.run(records);
            return SurfaceAnalyzer.analyze(pipeline.records, pipeline.coverageRecords, List.of(), pipeline.analysis);
        });

        assertEquals(100, surface.endpoints().size());
        assertEquals(10_000, surface.endpoints().stream().mapToInt(endpoint -> endpoint.parameters().size()).sum());
        assertTrue(surface.endpoints().stream().allMatch(endpoint -> endpoint.parameters().size() == 100));
    }

    private static ParameterValidationCell cell(Verdict verdict, boolean applicable, List<String> ids, List<String> basis, long count) {
        return new ParameterValidationCell(new EndpointKey("https://test:443", "GET", "/orders"), ParameterLocation.QUERY, "/id",
                "https://test:443 orders:1", SELF, Source.UNKNOWN, null, AccessRole.UNKNOWN, verdict, "test", applicable, ids, basis, count);
    }

    private static RequestRecord pipelineRecord(Source source, String fp, String method, String path, int status, String body) {
        RequestRecord r = new RequestRecord(source, "https://app.test:443", method, path, status, fp);
        r.reqBody = body;
        r.requestContentType = "application/json";
        r.hasResponse = true;
        r.responseContentType = "application/json";
        r.body = status == 200 ? "{\"id\":101}" : "{\"error\":\"forbidden\"}";
        r.phase = RunPhase.EXPLORATION;
        r.runId = source.name().toLowerCase() + "-run";
        return r;
    }

    private static SurfaceAnalysis enrich(List<RequestRecord> records, AuthorizationAnalysis auth) {
        List<RequestRecord> coverage = records.stream().filter(r -> r.source != Source.UNKNOWN
                && r.phase != RunPhase.VALIDATION && r.phase != RunPhase.COACH_PROBE
                && r.trafficClassification.coverageEligible()).toList();
        return SurfaceAnalyzer.analyze(records, coverage, List.of(), auth);
    }

    private static ParameterFact fact(SurfaceAnalysis result, String path) {
        return result.endpoints().stream().flatMap(e -> e.parameters().stream())
                .filter(p -> p.canonicalPath().equals(path)).findFirst().orElseThrow(() -> new AssertionError("fact " + path));
    }

    private static List<AuthorizationTargetLink> links(SurfaceAnalysis result, String path) {
        return fact(result, path).authorizationTargets();
    }

    private static AuthorizationTargetLink link(SurfaceAnalysis result, String path) {
        List<AuthorizationTargetLink> links = links(result, path);
        assertFalse(links.isEmpty(), "link " + path);
        return links.getFirst();
    }

    private static void assertCell(SurfaceAnalysis result, RequestRecord r, SubjectClass subject, Verdict verdict) {
        assertTrue(result.validationCells().stream().anyMatch(c -> c.canonicalPath().equals("/orderId")
                && c.subjectClass() == subject && c.source() == r.source && c.verdict() == verdict
                && c.evidenceIds().contains(r.evidenceId) && c.applicable()), subject + " " + verdict + " " + r.evidenceId);
    }

    private static AuthorizationAnalysis authorization(List<RequestRecord> records, boolean owner) {
        Normalizer.normalizeAll(records);
        AnalysisConfig config = new AnalysisConfig();
        for (RequestRecord r : records) config = config.withIdentityRole(r.idn, "C".equals(r.fp) ? AccessRole.ADMIN : AccessRole.USER);
        if (owner) config = config.withResourceOwner(records.getFirst().resource, records.getFirst().idn);
        return AuthorizationAnalyzer.analyze(records, config);
    }

    private static RequestRecord record(Source source, String fp, String method, int status, String requestBody) {
        RequestRecord r = new RequestRecord(source, "https://example.test:443", method, "/api/orders/101", status, fp);
        r.evidenceId = "ev-parameter-auth-" + IDS.incrementAndGet();
        r.reqBody = requestBody;
        r.requestContentType = "application/json";
        r.hasResponse = true;
        r.body = "{\"id\":101}";
        r.phase = RunPhase.EXPLORATION;
        r.trafficClassification = new TrafficClassification(TrafficClassification.TrafficClass.API,
                TrafficClassification.Disposition.INCLUDE, List.of("TEST_API"), false);
        return r;
    }
}
