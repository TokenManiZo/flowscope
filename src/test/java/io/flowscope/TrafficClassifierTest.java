package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TrafficClassifierTest {
    private RequestRecord record(String method, String path, String requestType, String responseType) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443", method, path, 200, "anon");
        record.hasResponse = true;
        record.requestContentType = requestType;
        record.responseContentType = responseType;
        return record;
    }

    private RequestRecord classified(RequestRecord record) {
        return Pipeline.run(List.of(record)).records.getFirst();
    }

    @Test
    void 표준문맥과_MIME가_일치하는_정적자산만_제외한다() {
        RequestRecord js = record("GET", "/static/app.js", null, "application/javascript");
        js.secFetchDest = "script";
        TrafficClassification result = classified(js).trafficClassification;
        assertEquals(TrafficClassification.TrafficClass.STATIC_ASSET, result.trafficClass());
        assertEquals(TrafficClassification.Disposition.EXCLUDE, result.disposition());
    }

    @Test
    void 확장자만_정적처럼_보이면_버리지_않는다() {
        RequestRecord api = classified(record("GET", "/api/report.js", null, "application/json"));
        assertEquals(TrafficClassification.TrafficClass.API, api.trafficClassification.trafficClass());
        assertTrue(api.trafficClassification.coverageEligible());
    }

    @Test
    void 객체가_있는_private_image_API는_보존한다() {
        RequestRecord image = record("GET", "/api/users/7/avatar.png", null, "image/png");
        image.secFetchDest = "image";
        RequestRecord result = classified(image);
        assertNotNull(result.resource);
        assertEquals(TrafficClassification.Disposition.INCLUDE, result.trafficClassification.disposition());
    }

    @Test
    void 실제_CORS_preflight만_제외하고_일반_OPTIONS는_보존한다() {
        RequestRecord preflight = record("OPTIONS", "/api/orders", null, null);
        preflight.accessControlRequestMethod = "POST";
        assertEquals(TrafficClassification.TrafficClass.PREFLIGHT,
                classified(preflight).trafficClassification.trafficClass());
        assertFalse(classified(preflight).trafficClassification.coverageEligible());

        RequestRecord capabilities = classified(record("OPTIONS", "/api/orders", null, "application/json"));
        assertTrue(capabilities.trafficClassification.coverageEligible());
    }

    @Test
    void telemetry_이름만으로_제외하지_않는다() {
        RequestRecord telemetry = classified(record("POST", "/collect", "application/json", "application/json"));
        assertEquals(TrafficClassification.TrafficClass.API, telemetry.trafficClassification.trafficClass());
        assertTrue(telemetry.trafficClassification.coverageEligible());
    }

    @Test
    void 사용자의_operation_override가_자동판정보다_우선한다() {
        RequestRecord asset = record("GET", "/static/app.js", null, "application/javascript");
        asset.secFetchDest = "script";
        Normalizer.normalizeAll(List.of(asset));
        AnalysisConfig config = new AnalysisConfig().withTrafficOverride(asset.op, TrafficOverride.INCLUDE);
        Pipeline.Result result = Pipeline.run(List.of(asset), config);
        assertTrue(result.records.getFirst().trafficClassification.userOverride());
        assertEquals(1, result.coverageRecords.size());
    }

    @Test
    void 사용자_include도_discovery_신뢰경계를_우회하지_못한다() {
        RequestRecord validation = record("GET", "/api/orders", null, "application/json");
        validation.phase = RunPhase.VALIDATION;
        Normalizer.normalizeAll(List.of(validation));
        AnalysisConfig config = new AnalysisConfig().withTrafficOverride(validation.op, TrafficOverride.INCLUDE);

        Pipeline.Result result = Pipeline.run(List.of(validation), config);

        assertTrue(result.coverageRecords.isEmpty());
        assertFalse(result.records.getFirst().trafficClassification.userOverride());
        assertEquals(List.of("NON_DISCOVERY_PHASE"),
                result.records.getFirst().trafficClassification.reasons());
    }

    @Test
    void HUMAN_pass_밖의_API는_Evidence만_보존하고_3way_비교에서_제외한다() {
        RequestRecord outsidePass = record("GET", "/api/me", null, "application/json");
        outsidePass.sourceDetail = SourceDetail.BROWSER;
        outsidePass.phase = RunPhase.BASELINE;

        Pipeline.Result result = Pipeline.run(List.of(outsidePass));

        assertEquals(1, result.records.size());
        assertTrue(result.coverageRecords.isEmpty());
        assertEquals(TrafficClassification.Disposition.EXCLUDE,
                result.records.getFirst().trafficClassification.disposition());
        assertEquals(List.of("HUMAN_OUTSIDE_EXPLORATION_RUN"),
                result.records.getFirst().trafficClassification.reasons());
    }

    @Test
    void 명시적_HUMAN_EXPLORATION_pass의_API는_3way_비교에_포함한다() {
        RequestRecord exploration = record("GET", "/api/me", null, "application/json");
        exploration.sourceDetail = SourceDetail.BROWSER;
        exploration.phase = RunPhase.EXPLORATION;

        Pipeline.Result result = Pipeline.run(List.of(exploration));

        assertEquals(1, result.coverageRecords.size());
        assertEquals(TrafficClassification.Disposition.INCLUDE,
                result.records.getFirst().trafficClassification.disposition());
    }

    @Test
    void 로그인_세션_준비_트래픽은_Evidence만_보존하고_3way_비교에서_제외한다() {
        RequestRecord login = record("POST", "/login", "application/json", "application/json");
        login.sourceDetail = SourceDetail.BROWSER;
        login.phase = RunPhase.SESSION_SETUP;

        Pipeline.Result result = Pipeline.run(List.of(login));

        assertEquals(1, result.records.size());
        assertTrue(result.coverageRecords.isEmpty());
        assertEquals(List.of("SESSION_SETUP"), result.records.getFirst().trafficClassification.reasons());
    }

    @Test
    void web_manifest는_JSON이어도_business_API로_포함하지_않는다() {
        RequestRecord manifest = record("GET", "/manifest.json", null, "application/manifest+json");

        RequestRecord result = classified(manifest);

        assertEquals(TrafficClassification.TrafficClass.DISCOVERY_METADATA,
                result.trafficClassification.trafficClass());
        assertEquals(TrafficClassification.Disposition.EXCLUDE,
                result.trafficClassification.disposition());
        assertEquals(List.of("WEB_APP_MANIFEST"), result.trafficClassification.reasons());
    }

    @Test
    void source_map과_service_worker는_Evidence로_남지만_business_graph에서는_제외한다() {
        RequestRecord sourceMap = record("GET", "/assets/app.js.map", null, "application/json");
        RequestRecord worker = record("GET", "/service-worker.js", null, "application/javascript");
        worker.secFetchDest = "serviceworker";

        Pipeline.Result result = Pipeline.run(List.of(sourceMap, worker));

        assertEquals(2, result.records.size());
        assertTrue(result.coverageRecords.isEmpty());
        assertTrue(result.records.stream().allMatch(record -> record.trafficClassification.trafficClass()
                == TrafficClassification.TrafficClass.DISCOVERY_METADATA));
    }

    @Test
    void 같은_operation의_강한_API관측은_애매한_교차관측을_보조한다() {
        RequestRecord strong = record("GET", "/api/profile", null, "application/json");
        strong.secFetchDest = "empty";
        strong.secFetchMode = "cors";
        RequestRecord ambiguous = record("GET", "/api/profile", null, "text/plain");

        Pipeline.Result result = Pipeline.run(List.of(strong, ambiguous));

        assertEquals(2, result.coverageRecords.size());
        assertEquals(List.of("OPERATION_CORROBORATED_BY_API_EVIDENCE"),
                result.records.get(1).trafficClassification.reasons());
    }

    @Test
    void 교차보강은_서비스경계와_응답존재_gate를_우회하지_않는다() {
        RequestRecord strong = record("GET", "/api/profile", null, "application/json");
        strong.secFetchDest = "empty";
        RequestRecord otherService = new RequestRecord(Source.HUMAN, "https://other.test:443",
                "GET", "/api/profile", 200, "anon");
        otherService.hasResponse = true;
        otherService.responseContentType = "text/plain";
        RequestRecord noResponse = record("GET", "/api/profile", null, null);
        noResponse.hasResponse = false;

        Pipeline.Result result = Pipeline.run(List.of(strong, otherService, noResponse));

        assertEquals(1, result.coverageRecords.size());
        assertEquals(TrafficClassification.Disposition.REVIEW,
                result.records.get(1).trafficClassification.disposition());
        assertEquals(List.of("NO_RESPONSE"), result.records.get(2).trafficClassification.reasons());
    }
}
