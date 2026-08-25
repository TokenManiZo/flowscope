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
}
