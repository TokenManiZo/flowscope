package io.flowscope;

import io.flowscope.core.AccessRole;
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
import io.flowscope.core.SurfaceAnalysis.ContextPresence;
import io.flowscope.core.SurfaceAnalysis.GapStatus;
import io.flowscope.core.SurfaceAnalysis.GapType;
import io.flowscope.core.SurfaceAnalysis.ParameterFact;
import io.flowscope.core.SurfaceAnalysis.ParameterGap;
import io.flowscope.core.SurfaceAnalysis.ParameterLocation;
import io.flowscope.core.SurfaceAnalysis.ParameterProfile;
import io.flowscope.core.SurfaceAnalysis.Presence;
import io.flowscope.core.SurfaceAnalysis.ValueShape;
import io.flowscope.core.SurfaceAnalysis.ValueType;
import io.flowscope.core.SurfaceAnalyzer;
import io.flowscope.core.TrafficClassification;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * PR#11 ParameterProfiler 의미(프로파일 계층·discovery Gap·priority reasons·retention gate·coverage-only 분모·
 * Evidence ID 충돌 제외)를 SurfaceAnalysis Fact 위에서 검증한다. 관측 사실은 값이 아니라 Evidence 역참조만 남긴다.
 */
final class SurfaceParameterProfileTest {
    private static final AtomicInteger IDS = new AtomicInteger();
    private static final String SERVICE = "https://app.test:443";

    @Test
    void 프로파일은_source_identity_role_run_phase를_세고_누락_축_gap은_알려진_증인을_참조한다() {
        RequestRecord a = request(Source.HUMAN, "USER A", "sort=DESC&keyword=phone");
        RequestRecord b = request(Source.HUMAN, "USER B", "keyword=phone");
        RequestRecord scanner = request(Source.SCANNER, "USER A", "keyword=phone");

        SurfaceAnalysis analysis = analyze(a, b, scanner);

        ParameterFact sort = fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/sort");
        ParameterProfile profile = sort.profile();
        assertEquals(1, profile.observationCount());
        assertEquals(1L, profile.sourceCounts().get(Source.HUMAN));
        assertEquals(1L, profile.identityCounts().get("USER A"));
        assertEquals(1L, profile.roleCounts().get(AccessRole.USER));
        assertEquals(1L, profile.runCounts().get("default"));
        assertEquals(1L, profile.phaseCounts().get(RunPhase.EXPLORATION));
        assertEquals(2, profile.absentObservedContextCount(), "USER B와 SCANNER의 완전한 요청 2건에서 부재");
        assertFalse(profile.serverUsageConfirmed(), "서버가 입력을 읽는다는 주장은 하지 않는다");

        List<ParameterGap> sortGaps = gaps(analysis, "/sort");
        assertEquals(2, sortGaps.size());
        ParameterGap sourceMissed = sortGaps.stream().filter(g -> g.type() == GapType.SOURCE_MISSED).findFirst().orElseThrow();
        assertEquals(Source.SCANNER, sourceMissed.source());
        assertTrue(sourceMissed.evidenceIds().contains(a.evidenceId) && sourceMissed.evidenceIds().contains(scanner.evidenceId),
                "긍정 증인과 대상 증인 Evidence를 함께 참조");
        assertTrue(sourceMissed.priorityReasons().contains("SOURCE_DISCREPANCY"));
        ParameterGap identityMissed = sortGaps.stream().filter(g -> g.type() == GapType.IDENTITY_MISSED).findFirst().orElseThrow();
        assertEquals("USER B", identityMissed.identity());
        assertTrue(identityMissed.evidenceIds().contains(a.evidenceId) && identityMissed.evidenceIds().contains(b.evidenceId));
        assertFalse(identityMissed.priorityReasons().contains("SOURCE_DISCREPANCY"));
        assertTrue(analysis.parameterGaps().stream().allMatch(g -> g.status() == GapStatus.OPEN
                && !g.evidenceIds().isEmpty() && g.priorityReasons().getLast().equals("HUMAN_REVIEW_REQUIRED")));
        assertTrue(gaps(analysis, "/keyword").isEmpty(), "세 요청 모두 관측한 입력은 gap이 없다");
        assertEquals("/sort", sourceMissed.canonicalPath());
        assertEquals("/api/orders", sourceMissed.endpoint().pathTemplate());
    }

    @Test
    void discovery_분모는_VALIDATION_COACH_PROBE_비커버리지_트래픽을_제외한다() {
        RequestRecord human = request(Source.HUMAN, "USER A", "sort=DESC");
        RequestRecord validation = request(Source.SCANNER, "USER B", "validationOnly=1");
        validation.phase = RunPhase.VALIDATION;
        RequestRecord probe = request(Source.LLM, "USER C", "probeOnly=1");
        probe.phase = RunPhase.COACH_PROBE;
        RequestRecord excluded = request(Source.SCANNER, "USER D", "excludedOnly=1");
        excluded.trafficClassification = TrafficClassification.unresolved("REVIEW");

        SurfaceAnalysis analysis = analyze(human, validation, probe, excluded);

        assertEquals(1, fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/sort").profile().observationCount());
        assertEquals(0, fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/validationOnly").profile().observationCount(),
                "VALIDATION 관측은 사실로 남되 discovery 프로파일에는 세지 않는다");
        assertEquals(0, fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/probeOnly").profile().observationCount());
        assertTrue(endpoint(analysis, "GET", "/api/orders").parameters().stream()
                .noneMatch(p -> p.canonicalPath().equals("/excludedOnly")), "비커버리지 트래픽은 Fact가 아니다");
        assertTrue(analysis.parameterGaps().isEmpty(), "VALIDATION·probe 요청은 누락 축의 분모가 아니다");
    }

    @Test
    void 명시적_null과_비교_부재를_구분하고_단일_요청에서_부재를_만들지_않는다() {
        RequestRecord a = json(Source.HUMAN, "USER A", "{\"x\":null}");

        ParameterFact one = fact(analyze(a), "GET", "/api/orders", ParameterLocation.JSON_BODY, "/x");
        assertEquals(Set.of(Presence.EXPLICIT_NULL), one.profile().observedPresence());
        assertEquals(Set.of(ValueShape.NULL), one.observedShapes());
        assertEquals(0, one.profile().absentObservedContextCount());
        assertEquals(1, one.profile().contextPresence().size());
        assertTrue(one.profile().contextPresence().values().iterator().next().contains(ContextPresence.EXPLICIT_NULL));

        ParameterFact two = fact(analyze(a, json(Source.HUMAN, "USER A", "{}")), "GET", "/api/orders",
                ParameterLocation.JSON_BODY, "/x");
        assertEquals(1, two.profile().absentObservedContextCount());
        assertTrue(two.profile().contextPresence().values().stream()
                .anyMatch(states -> states.contains(ContextPresence.ABSENT_OBSERVED_CONTEXT)));
    }

    @Test
    void 타입_충돌과_반복_query_배열과_distinct를_집계하되_TYPE_VARIANT_gap은_선언이_있어야_한다() {
        RequestRecord a = json(Source.HUMAN, "USER A", "{\"x\":1}");
        a.query = "tag=a&tag=b";
        RequestRecord b = json(Source.HUMAN, "USER A", "{\"x\":\"one\"}");
        b.query = "tag=c&tag=d";

        SurfaceAnalysis analysis = analyze(a, b);

        ParameterFact x = fact(analysis, "GET", "/api/orders", ParameterLocation.JSON_BODY, "/x");
        assertEquals(Set.of(ValueType.INTEGER, ValueType.STRING), x.observedValueTypes());
        assertTrue(x.profile().typeConflict());
        assertEquals(2, x.distinctValueCount());
        ParameterFact tag = fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/tag");
        assertEquals(Set.of(ValueShape.ARRAY), tag.observedShapes());
        assertFalse(tag.profile().typeConflict());
        assertTrue(analysis.parameterGaps().stream().noneMatch(g -> g.type() == GapType.TYPE_VARIANT_UNOBSERVED));
    }

    @Test
    void optional_선언과_미요청_route는_DEFINED_NOT_OBSERVED_gap이_되고_누락_축_gap은_아니다() {
        RequestRecord known = request(Source.HUMAN, "USER A", "keyword=phone");
        RequestRecord openapi = openapi("spec-1", """
                {"/api/orders":{"get":{"parameters":[{"name":"sort","in":"query","required":false,"schema":{"type":"string"}}]}},
                 "/api/other/{id}":{"get":{"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}]}}}
                """);

        SurfaceAnalysis analysis = analyzeWithRoutes(known, openapi);

        ParameterFact sort = fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/sort");
        assertEquals(SurfaceAnalysis.Requirement.OPTIONAL, sort.requirement());
        assertEquals(0, sort.profile().observationCount());
        assertTrue(sort.observedSources().isEmpty());
        assertFalse(sort.profile().serverUsageConfirmed());
        ParameterFact other = fact(analysis, "GET", "/api/other/{id}", ParameterLocation.PATH, "/segments/2");
        assertEquals(0, other.profile().observationCount());
        for (String path : List.of("/sort", "/segments/2")) {
            ParameterGap gap = gaps(analysis, path).stream().filter(g -> g.type() == GapType.DEFINED_NOT_OBSERVED)
                    .findFirst().orElseThrow(() -> new AssertionError(path + " DEFINED_NOT_OBSERVED"));
            assertTrue(gap.evidenceIds().contains("spec-1"), "선언 provenance Evidence를 참조");
            assertFalse(gap.priorityReasons().contains("CORROBORATED_EVIDENCE"), "선언 하나·관측 0은 corroboration이 아니다");
        }
        assertTrue(analysis.parameterGaps().stream().noneMatch(g -> g.type() == GapType.SOURCE_MISSED
                || g.type() == GapType.IDENTITY_MISSED));
    }

    @Test
    void 선언_타입_변형은_비교하되_enum_값은_추정하지_않고_wire_타입과_format은_gap이_아니다() {
        RequestRecord observed = json(Source.HUMAN, "USER A", "{\"x\":1}", "POST");
        RequestRecord union = openapi("spec-union", """
                {"/api/orders":{"post":{"requestBody":{"content":{"application/json":{"schema":{"type":"object",
                  "properties":{"x":{"oneOf":[{"type":"integer"},{"type":"string"}]}}}}}}}}}
                """);
        SurfaceAnalysis withUnion = analyzeWithRoutes(observed, union);
        List<ParameterGap> variants = withUnion.parameterGaps().stream()
                .filter(g -> g.type() == GapType.TYPE_VARIANT_UNOBSERVED).toList();
        assertEquals(1, variants.size(), "관측하지 못한 string 변형 하나만");
        assertTrue(variants.getFirst().summary().contains("STRING"));
        assertTrue(variants.getFirst().evidenceIds().contains(observed.evidenceId)
                && variants.getFirst().evidenceIds().contains("spec-union"), "관측 증인과 선언 증인을 함께 참조");
        assertTrue(variants.getFirst().priorityReasons().contains("WRITE_METHOD"));
        assertTrue(variants.getFirst().priorityReasons().contains("CORROBORATED_EVIDENCE"), "완전 관측 1 + 선언 종류 1");

        RequestRecord enumSpec = openapi("spec-enum", """
                {"/api/orders":{"post":{"requestBody":{"content":{"application/json":{"schema":{"type":"object",
                  "properties":{"x":{"type":"integer","enum":[1,2]}}}}}}}}}
                """);
        assertTrue(analyzeWithRoutes(observed, enumSpec).parameterGaps().stream()
                .noneMatch(g -> g.type() == GapType.TYPE_VARIANT_UNOBSERVED), "enum 선택지는 값 변형이 아니다");

        RequestRecord query = request(Source.HUMAN, "USER A", "x=1");
        RequestRecord integerQuery = openapi("spec-int", """
                {"/api/orders":{"get":{"parameters":[{"name":"x","in":"query","schema":{"type":"integer"}}]}}}
                """);
        assertTrue(analyzeWithRoutes(query, integerQuery).parameterGaps().isEmpty(), "wire 문자열은 타입 비교 대상이 아니다");
        for (String format : List.of("uuid", "date-time", "binary")) {
            RequestRecord formatted = json(Source.HUMAN, "USER A", "{\"x\":\"unclassified-format\"}", "POST");
            RequestRecord spec = openapi("spec-" + format, """
                    {"/api/orders":{"post":{"requestBody":{"content":{"application/json":{"schema":{"type":"object",
                      "properties":{"x":{"type":"string","format":"%s"}}}}}}}}}
                    """.formatted(format));
            assertTrue(analyzeWithRoutes(formatted, spec).parameterGaps().stream()
                    .noneMatch(g -> g.type() == GapType.TYPE_VARIANT_UNOBSERVED), format + " 형식은 미분류 타입이라 gap이 아니다");
        }
        RequestRecord arrayQuery = openapi("spec-array", """
                {"/api/orders":{"get":{"parameters":[{"name":"x","in":"query","schema":{"type":"array","items":{"type":"string"}}}]}}}
                """);
        assertTrue(analyzeWithRoutes(query, arrayQuery).parameterGaps().stream()
                .anyMatch(g -> g.type() == GapType.TYPE_VARIANT_UNOBSERVED), "선언 배열 형태 vs 관측 스칼라는 형태 변형 gap");
        RequestRecord number = json(Source.HUMAN, "USER A", "{\"x\":1}", "POST");
        RequestRecord numberSpec = openapi("spec-number", """
                {"/api/orders":{"post":{"requestBody":{"content":{"application/json":{"schema":{"type":"object",
                  "properties":{"x":{"type":"number"}}}}}}}}}
                """);
        assertTrue(analyzeWithRoutes(number, numberSpec).parameterGaps().isEmpty(), "number 선언은 integer 관측을 받아들인다");
    }

    @Test
    void 조건_조합_gap은_독립_근거_2개와_실제_비교_문맥이_있어야_한다() {
        RequestRecord human = request(Source.HUMAN, "USER A", "x=1&y=1");
        RequestRecord scanner = request(Source.SCANNER, "USER A", "x=2");
        assertTrue(analyze(human, scanner).parameterGaps().stream()
                .noneMatch(g -> g.type() == GapType.CONDITION_COMBINATION_UNOBSERVED), "단일 동시출현은 조건이 아니다");
        assertTrue(analyze(human, human, scanner).parameterGaps().stream()
                .noneMatch(g -> g.type() == GapType.CONDITION_COMBINATION_UNOBSERVED), "같은 Evidence 반복은 독립 근거가 아니다");

        RequestRecord repeated = request(Source.HUMAN, "USER A", "y=2&x=2");
        SurfaceAnalysis analysis = analyze(human, repeated, scanner);
        ParameterGap condition = gaps(analysis, "/x").stream()
                .filter(g -> g.type() == GapType.CONDITION_COMBINATION_UNOBSERVED).findFirst().orElseThrow();
        assertEquals(Source.SCANNER, condition.source());
        assertEquals(AccessRole.USER, condition.role());
        assertEquals(3, condition.evidenceIds().size(), "지지 근거 2 + 대상 문맥 1");
        assertTrue(condition.priorityReasons().contains("CORROBORATED_EVIDENCE"));
        assertTrue(analyze(human, repeated).parameterGaps().stream()
                .noneMatch(g -> g.type() == GapType.CONDITION_COMBINATION_UNOBSERVED), "비교 대상 문맥이 없으면 gap이 없다");
    }

    @Test
    void 누락_축은_operation_범위이며_단일_요청과_미상_source_신원은_분모가_아니다() {
        RequestRecord a = request(Source.HUMAN, "USER A", "x=1");
        RequestRecord other = request(Source.SCANNER, "USER B", null, "GET", "/api/other");
        RequestRecord unknown = request(Source.UNKNOWN, "unresolved-token", null);
        RequestRecord unresolvedIdentity = request(Source.HUMAN, "unresolved-abc", "x=1");
        RequestRecord known = request(Source.HUMAN, "USER A", null);

        assertTrue(analyze(a, other, unknown).parameterGaps().isEmpty());
        assertTrue(analyze(a).parameterGaps().isEmpty());
        assertTrue(analyze(unresolvedIdentity, known).parameterGaps().stream()
                .noneMatch(g -> g.type() == GapType.IDENTITY_MISSED), "미해결 신원은 비교 가능한 두 번째 신원이 아니다");
    }

    @Test
    void 파서_실패와_입력_상한은_부재_문맥을_만들지_않는다() {
        RequestRecord a = json(Source.HUMAN, "USER A", "{\"x\":1}");
        RequestRecord broken = json(Source.SCANNER, "USER B", "{broken");
        RequestRecord limited = json(Source.LLM, "USER C", " ".repeat(1_000_001));

        SurfaceAnalysis analysis = analyze(a, broken, limited);

        assertEquals(0, fact(analysis, "GET", "/api/orders", ParameterLocation.JSON_BODY, "/x").profile().absentObservedContextCount());
        assertTrue(analysis.parameterGaps().isEmpty());
        assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("INVALID_JSON")));
        assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("INPUT_LIMIT")));
    }

    @Test
    void metadata_only_요청은_긍정_관측만_남기고_부재_증인이나_누락_축이_되지_않는다() {
        String body = "visible=1&padding=" + "x".repeat(100) + "&late=2";
        String headers = "POST /api/orders HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\n";
        for (StoredPayload.Retention retention : List.of(StoredPayload.Retention.OVER_LIMIT_METADATA_ONLY,
                StoredPayload.Retention.CAPACITY_METADATA_ONLY)) {
            RequestRecord full = request(Source.HUMAN, "USER A", null, "POST", "/api/orders");
            full.requestContentType = "application/x-www-form-urlencoded";
            full.reqText = headers + body;
            RequestRecord repeated = full.analysisCopy();
            repeated.evidenceId = full.evidenceId + "-repeat";
            RequestRecord preview = request(Source.SCANNER, "USER B", null, "POST", "/api/orders");
            preview.requestContentType = full.requestContentType;
            preview.reqText = headers + "visible=1";
            preview.requestPayload = retention == StoredPayload.Retention.OVER_LIMIT_METADATA_ONLY
                    ? StoredPayload.capture(headers + body, full.requestContentType, 32)
                    : StoredPayload.capture(headers + body, full.requestContentType, 1000).metadataOnly(retention);
            assertEquals(retention, preview.requestPayload.retention());

            SurfaceAnalysis analysis = analyze(full, repeated, preview);
            assertEquals(3, fact(analysis, "POST", "/api/orders", ParameterLocation.FORM_BODY, "/visible").profile().observationCount());
            assertEquals(0, fact(analysis, "POST", "/api/orders", ParameterLocation.FORM_BODY, "/late").profile().absentObservedContextCount());
            assertTrue(analysis.parameterGaps().isEmpty(), retention + ": 잘린 요청은 누락의 증인이 아니다");
            assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("REQUEST_PAYLOAD_NOT_RETAINED")
                    && preview.evidenceId.equals(d.evidenceId())));

            preview.requestPayload = null; // 잘림 메타데이터가 없는 legacy 레코드는 완전한 요청으로 본다
            SurfaceAnalysis legacy = analyze(full, repeated, preview);
            assertEquals(1, fact(legacy, "POST", "/api/orders", ParameterLocation.FORM_BODY, "/late").profile().absentObservedContextCount());
            assertTrue(legacy.parameterGaps().stream().anyMatch(g -> g.type() == GapType.SOURCE_MISSED
                    && g.canonicalPath().equals("/late") && g.source() == Source.SCANNER));
        }
    }

    @Test
    void 불완전_긍정_관측은_부재_증인이_되지_않고_DEFINED_NOT_OBSERVED와_corroboration도_보류한다() {
        RequestRecord partial = request(Source.HUMAN, "USER A", null);
        partial.requestContentType = "application/x-www-form-urlencoded";
        partial.reqBody = "x=1";
        partial.requestPayload = StoredPayload.capture("x=1&later=2", partial.requestContentType, 1);
        RequestRecord complete = request(Source.SCANNER, "USER B", null);
        SurfaceAnalysis analysis = analyze(partial, complete);
        ParameterFact x = fact(analysis, "GET", "/api/orders", ParameterLocation.FORM_BODY, "/x");
        assertEquals(1, x.profile().observationCount(), "긍정 관측은 사실로 남는다");
        assertEquals(0, x.profile().absentObservedContextCount());
        assertTrue(analysis.parameterGaps().isEmpty(), "불완전 긍정은 SOURCE_MISSED의 증인이 아니다");

        RequestRecord incomplete = request(Source.HUMAN, "USER A", null);
        incomplete.requestContentType = "application/x-www-form-urlencoded";
        incomplete.reqBody = "visible=1";
        incomplete.requestPayload = StoredPayload.capture("visible=1&late=2", incomplete.requestContentType, 1);
        RequestRecord spec = openapi("spec-form", """
                {"/api/orders":{"get":{"parameters":[{"name":"late","in":"formData","type":"string"}]}}}
                """);
        SurfaceAnalysis declared = analyzeWithRoutes(incomplete, spec);
        assertEquals(0, fact(declared, "GET", "/api/orders", ParameterLocation.FORM_BODY, "/late").profile().observationCount());
        assertTrue(declared.parameterGaps().isEmpty(), "불완전한 operation은 선언 미관측을 확정하지 않는다");
        assertTrue(declared.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("REQUEST_PAYLOAD_NOT_RETAINED")));

        RequestRecord full = request(Source.HUMAN, "USER A", "x=1");
        RequestRecord partialQuery = request(Source.HUMAN, "USER A", "x=1");
        partialQuery.requestPayload = StoredPayload.capture("visible=1&later=2", "application/x-www-form-urlencoded", 1);
        RequestRecord target = request(Source.SCANNER, "USER B", null);
        SurfaceAnalysis priority = analyze(full, partialQuery, target);
        assertEquals(2, fact(priority, "GET", "/api/orders", ParameterLocation.QUERY, "/x").profile().observationCount());
        assertFalse(priority.parameterGaps().getFirst().priorityReasons().contains("CORROBORATED_EVIDENCE"),
                "완전한 관측이 하나뿐이면 corroboration이 아니다");
    }

    @Test
    void 출력과_우선순위_순서는_입력_순서와_무관하고_쓰기_method가_먼저다() {
        RequestRecord a = request(Source.HUMAN, "USER A", "x=1&y=1");
        RequestRecord b = request(Source.SCANNER, "USER B", "x=2");
        RequestRecord write = request(Source.HUMAN, "USER A", null, "PATCH", "/api/orders");
        RequestRecord spec = openapi("spec-write", """
                {"/api/orders":{"patch":{"requestBody":{"content":{"application/json":{"schema":{"type":"object",
                  "properties":{"status":{"type":"string"}}}}}}}}}
                """);
        List<RequestRecord> inputs = new ArrayList<>(List.of(a, b, write, spec));

        SurfaceAnalysis one = analyzeWithRoutes(inputs.toArray(RequestRecord[]::new));
        Collections.reverse(inputs);
        SurfaceAnalysis reversed = analyzeWithRoutes(inputs.toArray(RequestRecord[]::new));

        assertEquals(one.parameterGaps(), reversed.parameterGaps());
        assertEquals(profiles(one), profiles(reversed));
        assertEquals(one.parameterGaps(), analyzeWithRoutes(a, a, b, write, spec).parameterGaps(), "중복 Evidence는 독립 근거가 아니다");
        assertEquals("WRITE_METHOD", one.parameterGaps().getFirst().priorityReasons().getFirst());
        assertEquals(GapType.DEFINED_NOT_OBSERVED, one.parameterGaps().getFirst().type());
        assertEquals(one.parameterGaps().size(), one.parameterGaps().stream().map(ParameterGap::id).distinct().count());
        assertTrue(one.parameterGaps().stream().allMatch(g -> g.id().startsWith("pg:v1:")));
        assertTrue(one.parameterGaps().stream().allMatch(g -> g.evidenceCount() == g.evidenceIds().size()));
    }

    @Test
    void 반복_provenance는_한_정의를_corroboration으로_만들지_않는다() {
        RequestRecord known = request(Source.HUMAN, "USER A", null);
        RequestRecord first = openapi("spec-a", """
                {"/api/orders":{"get":{"parameters":[{"name":"x","in":"query","schema":{"type":"string"}}]}}}
                """);
        RequestRecord second = openapi("spec-b", """
                {"/api/orders":{"get":{"parameters":[{"name":"x","in":"query","schema":{"type":"string"}}]}}}
                """);

        SurfaceAnalysis analysis = analyzeWithRoutes(known, first, second);

        ParameterGap gap = gaps(analysis, "/x").getFirst();
        assertEquals(GapType.DEFINED_NOT_OBSERVED, gap.type());
        assertEquals(2, fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/x").declarations().size());
        assertFalse(gap.priorityReasons().contains("CORROBORATED_EVIDENCE"), "같은 종류 문서 2개는 정의 종류 1개");
        assertTrue(gap.evidenceIds().containsAll(List.of("spec-a", "spec-b")));
    }

    @Test
    void 충돌하는_중복_Evidence는_결정적으로_제외하고_진단을_남긴다() {
        RequestRecord first = request(Source.HUMAN, "USER A", "x=1");
        RequestRecord conflicting = request(Source.SCANNER, "USER B", "y=1");
        conflicting.evidenceId = first.evidenceId;

        SurfaceAnalysis analysis = analyze(first, conflicting);

        assertTrue(endpoint(analysis, "GET", "/api/orders").parameters().isEmpty(), "같은 ID의 다른 내용은 둘 다 파라미터 근거가 아니다");
        assertTrue(analysis.parameterGaps().isEmpty());
        assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals("CONFLICTING_EVIDENCE")
                && first.evidenceId.equals(d.evidenceId())));
        assertEquals(profiles(analysis), profiles(analyze(conflicting, first)));
        RequestRecord broken = json(Source.SCANNER, "USER B", "{broken");
        broken.evidenceId = first.evidenceId;
        assertEquals(profiles(analyze(first, broken)), profiles(analyze(broken, first)));
    }

    @Test
    void 프로파일_context_상한은_진단을_남기고_총계와_불변성을_보존한다() {
        List<RequestRecord> records = new ArrayList<>();
        for (int i = 0; i < 80; i++) records.add(request(Source.HUMAN, "USER " + i, "x=1&p" + i + "=1"));
        records.forEach(r -> r.runId = "run-" + r.idn);

        SurfaceAnalysis analysis = analyze(records.toArray(RequestRecord[]::new));

        ParameterFact x = fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/x");
        assertEquals(80, x.profile().observationCount());
        assertEquals(80, x.observationEvidenceIds().size(), "Fact의 Evidence 역참조는 잘리지 않는다");
        assertEquals(64, x.profile().contextPresence().size());
        assertEquals(64, x.profile().identityCounts().size());
        assertEquals(64, x.profile().runCounts().size());
        for (String reason : List.of("PROFILE_CONTEXT_LIMIT", "PROFILE_IDENTITY_LIMIT", "PROFILE_RUN_LIMIT")) {
            assertTrue(analysis.parameterDiagnostics().stream().anyMatch(d -> d.reasonCode().equals(reason) && d.droppedCount() == 16), reason);
        }
        assertThrows(UnsupportedOperationException.class, () -> x.profile().contextPresence().clear());
        assertThrows(UnsupportedOperationException.class, () -> x.profile().contextPresence().values().iterator().next().clear());
        assertThrows(UnsupportedOperationException.class, () -> x.profile().sourceCounts().clear());
        assertThrows(UnsupportedOperationException.class, () -> analysis.parameterGaps().clear());
    }

    @Test
    void 미확정_좌표_선언은_부재를_세지_않고_gap이_되지_않는다() {
        RequestRecord human = json(Source.HUMAN, "USER A", "{\"filters\":{\"active\":true}}", "POST");
        RequestRecord scanner = json(Source.SCANNER, "USER B", "{\"filters\":{\"active\":false}}", "POST");
        List<RequestRecord> records = List.of(human, scanner);
        RouteCandidate base = RouteCandidateExtractor.extract(records, ScopePolicy.parse("https://app.test/"), List.of())
                .stream().filter(c -> c.pathTemplate().equals("/api/orders") && c.method().equals("POST")).findFirst().orElseThrow();
        RouteCandidate legacy = new RouteCandidate(base.service(), base.method(), base.pathTemplate(), base.concretePaths(),
                base.concretePathsTruncated(), base.observed(), base.provenance(), base.applicability(), base.reviewReason(),
                List.of(new RouteCandidate.DeclaredParameter(
                        ParameterLocation.JSON_BODY, "filters.active", "filters.active", SurfaceAnalysis.Requirement.OPTIONAL,
                        "legacy-1", Source.LLM, "llm-run", "explorer", "legacy")));

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(records, records, List.of(legacy));

        ParameterFact unresolved = endpoint(analysis, "POST", "/api/orders").parameters().stream()
                .filter(p -> !p.coordinateResolved()).findFirst().orElseThrow();
        assertEquals(SurfaceAnalysis.DeltaState.UNRESOLVED_COORDINATE, unresolved.deltaState());
        assertEquals(0, unresolved.profile().absentObservedContextCount());
        assertTrue(unresolved.profile().contextPresence().isEmpty());
        assertTrue(analysis.parameterGaps().isEmpty(), "미확정 좌표는 DEFINED_NOT_OBSERVED로 승격하지 않는다");
        assertEquals(2, fact(analysis, "POST", "/api/orders", ParameterLocation.JSON_BODY, "/filters/active").profile().observationCount());
    }

    @Test
    void endpoint는_요청_문맥으로_완전_보존_discovery_여부를_남겨_요청_비교의_부재와_미상을_구분한다() {
        RequestRecord complete = request(Source.HUMAN, "USER A", "sort=DESC");
        RequestRecord truncated = request(Source.SCANNER, "USER B", null, "GET", "/api/orders");
        truncated.requestContentType = "application/x-www-form-urlencoded";
        truncated.reqBody = "visible=1";
        truncated.requestPayload = StoredPayload.capture("visible=1&late=2", truncated.requestContentType, 1);
        RequestRecord broken = json(Source.LLM, "USER C", "{broken");
        RequestRecord validation = request(Source.HUMAN, "USER A", "sort=ASC");
        validation.phase = RunPhase.VALIDATION;
        validation.trafficClassification = TrafficClassification.unresolved("NON_DISCOVERY_PHASE");

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(List.of(complete, truncated, broken, validation),
                coverage(List.of(complete, truncated, broken, validation)), List.of());

        List<SurfaceAnalysis.RequestContext> contexts = endpoint(analysis, "GET", "/api/orders").requestContexts();
        assertEquals(4, contexts.size(), "VALIDATION 행도 문맥에는 남는다(사실·프로파일은 아님)");
        SurfaceAnalysis.RequestContext completeContext = contexts.stream().filter(c -> c.evidenceId().equals(complete.evidenceId)).findFirst().orElseThrow();
        assertTrue(completeContext.complete() && completeContext.retained() && completeContext.discovery());
        assertTrue(completeContext.contextSignature().startsWith("ctx:v1:sha256:"));
        SurfaceAnalysis.RequestContext truncatedContext = contexts.stream().filter(c -> c.evidenceId().equals(truncated.evidenceId)).findFirst().orElseThrow();
        assertFalse(truncatedContext.complete());
        assertFalse(truncatedContext.retained());
        SurfaceAnalysis.RequestContext brokenContext = contexts.stream().filter(c -> c.evidenceId().equals(broken.evidenceId)).findFirst().orElseThrow();
        assertFalse(brokenContext.complete(), "추출 진단이 있는 행은 부재의 증인이 아니다");
        assertTrue(brokenContext.retained());
        SurfaceAnalysis.RequestContext validationContext = contexts.stream().filter(c -> c.evidenceId().equals(validation.evidenceId)).findFirst().orElseThrow();
        assertFalse(validationContext.discovery());
        assertTrue(validationContext.complete());
        assertEquals(1, fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/sort").profile().observationCount());
        assertEquals(List.of(complete.evidenceId), fact(analysis, "GET", "/api/orders", ParameterLocation.QUERY, "/sort").observationEvidenceIds());
    }

    @Test
    void Pipeline_경로에서도_프로파일과_gap이_생기고_직렬화는_값과_digest를_노출하지_않는다() {
        RequestRecord human = pipelineRecord(Source.HUMAN, "GET",
                "/api/orders/550e8400-e29b-41d4-a716-446655440000?sort=DESC&keyword=SECRET_KEYWORD");
        RequestRecord scanner = pipelineRecord(Source.SCANNER, "GET",
                "/api/orders/6ba7b810-9dad-11d1-80b4-00c04fd430c8?keyword=other");
        Pipeline.Result result = Pipeline.runIsolated(List.of(human, scanner), new io.flowscope.core.AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse("https://app.test/"), List.of());

        SurfaceAnalysis analysis = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);

        ParameterFact sort = fact(analysis, "GET", "/api/orders/{id}", ParameterLocation.QUERY, "/sort");
        assertEquals(1, sort.profile().observationCount());
        assertEquals(1, sort.profile().absentObservedContextCount());
        assertTrue(gaps(analysis, "/sort").stream().anyMatch(g -> g.type() == GapType.SOURCE_MISSED && g.source() == Source.SCANNER));
        String serialized = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(analysis).toString();
        assertTrue(serialized.contains("\"parameterGaps\""));
        assertTrue(serialized.contains("\"absentObservedContextCount\":1"));
        assertFalse(serialized.contains("SECRET_KEYWORD"));
        assertFalse(serialized.contains("\"digest\""));
        String withoutSignatures = serialized.replaceAll("ctx:v1:sha256:[0-9a-f]+", "")
                .replaceAll("pg:(?:v1|auth):sha256:[0-9a-f]+", "");
        assertFalse(withoutSignatures.contains("sha256:"), "구조 서명·gap 좌표 ID 외 digest 노출 금지");
    }

    private static RequestRecord pipelineRecord(Source source, String method, String pathAndQuery) {
        int question = pathAndQuery.indexOf('?');
        RequestRecord record = new RequestRecord(source, SERVICE, method,
                question < 0 ? pathAndQuery : pathAndQuery.substring(0, question), 200, source.name().toLowerCase() + "-fp");
        record.query = question < 0 ? null : pathAndQuery.substring(question + 1);
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.body = "{}";
        record.runId = source.name().toLowerCase() + "-run";
        return record;
    }

    private static RequestRecord request(Source source, String identity, String query) {
        return request(source, identity, query, "GET", "/api/orders");
    }

    private static RequestRecord request(Source source, String identity, String query, String method, String path) {
        RequestRecord r = new RequestRecord(source, SERVICE, method, path, 200, "A");
        r.op = r.service + " " + Normalizer.normalize(r.method, r.path).op;
        r.query = query;
        r.idn = identity;
        r.role = AccessRole.USER;
        r.evidenceId = "ev-" + IDS.incrementAndGet();
        r.phase = RunPhase.EXPLORATION;
        r.hasResponse = true;
        r.trafficClassification = new TrafficClassification(TrafficClassification.TrafficClass.API,
                TrafficClassification.Disposition.INCLUDE, List.of("TEST_API"), false);
        return r;
    }

    private static RequestRecord json(Source source, String identity, String body) {
        return json(source, identity, body, "GET");
    }

    private static RequestRecord json(Source source, String identity, String body, String method) {
        RequestRecord r = request(source, identity, null, method, "/api/orders");
        r.requestContentType = "application/json";
        r.reqBody = body;
        return r;
    }

    private static RequestRecord openapi(String evidenceId, String paths) {
        RequestRecord r = new RequestRecord(Source.HUMAN, SERVICE, "GET", "/openapi.json", 200, "A");
        r.evidenceId = evidenceId;
        r.hasResponse = true;
        r.responseContentType = "application/json";
        r.body = "{\"openapi\":\"3.0.3\",\"paths\":" + paths.strip() + "}";
        r.trafficClassification = TrafficClassification.unresolved("DISCOVERY_DOCUMENT");
        return r;
    }

    /** Pipeline과 같은 coverage 분모: coverage-eligible이며 source가 미상이 아닌 레코드만. */
    private static List<RequestRecord> coverage(List<RequestRecord> records) {
        return records.stream().filter(r -> r.trafficClassification.coverageEligible() && r.source != Source.UNKNOWN).toList();
    }

    private static SurfaceAnalysis analyze(RequestRecord... records) {
        List<RequestRecord> all = List.of(records);
        return SurfaceAnalyzer.analyze(all, coverage(all), List.of());
    }

    private static SurfaceAnalysis analyzeWithRoutes(RequestRecord... records) {
        List<RequestRecord> all = List.of(records);
        List<RouteCandidate> routes = RouteCandidateExtractor.extract(all, ScopePolicy.parse("https://app.test/"), List.of());
        return SurfaceAnalyzer.analyze(all, coverage(all), routes);
    }

    private static SurfaceAnalysis.EndpointFact endpoint(SurfaceAnalysis analysis, String method, String path) {
        return analysis.endpoints().stream()
                .filter(item -> item.key().method().equals(method) && item.key().pathTemplate().equals(path))
                .findFirst().orElseThrow(() -> new AssertionError("endpoint " + method + " " + path));
    }

    private static ParameterFact fact(SurfaceAnalysis analysis, String method, String path, ParameterLocation location,
                                      String canonicalPath) {
        List<ParameterFact> matches = endpoint(analysis, method, path).parameters().stream()
                .filter(item -> item.location() == location && item.canonicalPath().equals(canonicalPath)
                        && item.coordinateResolved()).toList();
        assertEquals(1, matches.size(), "exactly one fact must match " + location + ":" + canonicalPath);
        return matches.getFirst();
    }

    private static List<ParameterGap> gaps(SurfaceAnalysis analysis, String canonicalPath) {
        return analysis.parameterGaps().stream().filter(gap -> gap.canonicalPath().equals(canonicalPath)).toList();
    }

    private static List<ParameterProfile> profiles(SurfaceAnalysis analysis) {
        return analysis.endpoints().stream().flatMap(e -> e.parameters().stream()).map(ParameterFact::profile).toList();
    }
}
