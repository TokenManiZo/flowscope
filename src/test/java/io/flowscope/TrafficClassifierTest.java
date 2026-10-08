package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TrafficClassifierTest {
    @Test void passiveSubdomainTrafficRetainsEvidenceWithoutCoverageEvenWithAnIncludeOverride() {
        RequestRecord api = record("GET", "/api/orders", null, "application/json");
        api.passiveSubdomainTraffic = true;
        api.sourceDetail = SourceDetail.BROWSER;
        api.phase = RunPhase.EXPLORATION;
        AnalysisConfig config = new AnalysisConfig().withTrafficOverride(classified(api).op, TrafficOverride.INCLUDE);
        var result = Pipeline.run(List.of(api), config);
        assertTrue(result.records.getFirst().passiveSubdomainTraffic);
        assertEquals(List.of(TrafficClassifier.PASSIVE_SUBDOMAIN_TRAFFIC), result.records.getFirst().trafficClassification.reasons());
        assertTrue(result.coverageRecords.isEmpty());
    }
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
    void manualReviewPreservesEvidenceAndDiscoveryBoundary() {
        RequestRecord api = record("GET", "/api/orders", null, "application/json");
        RequestRecord duplicate = record("GET", "/api/orders", null, "application/json");
        RequestRecord validation = record("GET", "/api/orders", null, "application/json");
        validation.phase = RunPhase.VALIDATION;
        String operation = classified(api).op;
        AnalysisConfig config = new AnalysisConfig().withTrafficOverride(operation, TrafficOverride.REVIEW);
        var result = Pipeline.run(List.of(api, duplicate, validation), config);
        assertEquals(3, result.records.size());
        assertEquals(TrafficClassification.Disposition.REVIEW, result.records.get(0).trafficClassification.disposition());
        assertTrue(result.records.get(0).trafficClassification.reasons().contains("USER_REVIEW"));
        assertFalse(result.records.get(0).trafficClassification.coverageEligible());
        assertEquals(TrafficClassification.Disposition.REVIEW, result.records.get(1).trafficClassification.disposition());
        assertEquals(TrafficClassification.Disposition.EXCLUDE, result.records.get(2).trafficClassification.disposition());
        assertFalse(result.records.get(2).trafficClassification.userOverride());
        config.withTrafficOverride(operation, TrafficOverride.AUTO);
        assertEquals(TrafficClassification.Disposition.INCLUDE, Pipeline.run(List.of(api), config).records.getFirst().trafficClassification.disposition());
    }

    @Test
    void repeaterAndIntruderResendsStayOutOfJudgmentEvenDuringAnExplorationRunOrUserInclude() {
        RequestRecord browser = record("GET", "/api/orders", null, "application/json");
        browser.phase = RunPhase.EXPLORATION;
        browser.sourceDetail = SourceDetail.BROWSER;
        RequestRecord repeater = record("GET", "/api/orders", null, "application/json");
        repeater.phase = RunPhase.EXPLORATION;
        repeater.sourceDetail = SourceDetail.BURP_REPEATER;
        RequestRecord intruder = record("GET", "/api/orders", null, "application/json");
        intruder.phase = RunPhase.EXPLORATION;
        intruder.sourceDetail = SourceDetail.BURP_INTRUDER;
        AnalysisConfig config = new AnalysisConfig().withTrafficOverride(classified(browser).op, TrafficOverride.INCLUDE);

        var result = Pipeline.run(List.of(browser, repeater, intruder), config);

        assertTrue(result.records.get(0).trafficClassification.coverageEligible());
        for (RequestRecord resend : result.records.subList(1, 3)) {
            assertEquals(TrafficClassification.Disposition.EXCLUDE, resend.trafficClassification.disposition());
            assertEquals(List.of(TrafficClassifier.MANUAL_TOOL_RESEND), resend.trafficClassification.reasons());
        }
        assertEquals(List.of(result.records.get(0)), result.coverageRecords);
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
    void 로그인_세션_준비_트래픽은_source와_무관하게_Evidence만_보존하고_3way_비교에서_제외한다() {
        RequestRecord login = record("POST", "/login", "application/json", "application/json");
        login.sourceDetail = SourceDetail.BROWSER;
        login.phase = RunPhase.SESSION_SETUP;
        RequestRecord zapLogin = new RequestRecord(Source.SCANNER, "https://t:443",
                "POST", "/api/auth/login", 200, "anon");
        zapLogin.hasResponse = true;
        zapLogin.requestContentType = "application/json";
        zapLogin.responseContentType = "application/json";
        zapLogin.sourceDetail = SourceDetail.ZAP_AUTHENTICATION;
        zapLogin.phase = RunPhase.SESSION_SETUP;

        Pipeline.Result result = Pipeline.run(List.of(login, zapLogin));

        assertEquals(2, result.records.size());
        assertTrue(result.coverageRecords.isEmpty());
        assertTrue(result.records.stream().allMatch(record -> record.trafficClassification.trafficClass()
                == TrafficClassification.TrafficClass.AUTH_SESSION));
        assertTrue(result.records.stream().allMatch(record -> record.trafficClassification.reasons()
                .equals(List.of("SESSION_SETUP"))));
    }

    @Test
    void 동일한_애매한_안정요청_반복은_polling_검토후보로_표시한다() {
        RequestRecord first = record("GET", "/events", null, "text/plain");
        RequestRecord second = record("GET", "/events", null, "text/plain");
        RequestRecord third = record("GET", "/events", null, "text/plain");
        first.timestamp = 1;
        second.timestamp = 2;
        third.timestamp = 3;

        Pipeline.Result result = Pipeline.run(List.of(first, second, third));

        assertTrue(result.coverageRecords.isEmpty());
        assertTrue(result.records.stream().allMatch(value -> value.trafficClassification.trafficClass()
                == TrafficClassification.TrafficClass.POLLING));
        assertTrue(result.records.stream().allMatch(value -> value.trafficClassification.reasons()
                .equals(List.of("REPEATED_STABLE_OBSERVATION"))));
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
    void 루트_manifest_json은_일반_JSON으로_응답해도_discovery_metadata다() {
        RequestRecord manifest = record("GET", "/manifest.json", null, "application/json");

        RequestRecord result = classified(manifest);

        assertEquals(TrafficClassification.TrafficClass.DISCOVERY_METADATA,
                result.trafficClassification.trafficClass());
        assertEquals(TrafficClassification.Disposition.EXCLUDE,
                result.trafficClassification.disposition());
        assertEquals(List.of("WEB_APP_MANIFEST_PATH"), result.trafficClassification.reasons());
    }

    @Test
    void 중첩_manifest_json도_PWA_구조가_확인되면_LLM_API로_세지_않는다() {
        RequestRecord manifest = record("GET", "/assets/manifest.json", null, "application/json");
        manifest.body = "{\"name\":\"Shop\",\"short_name\":\"Shop\",\"icons\":[{\"src\":\"/logo.png\"}],\"start_url\":\"/\"}";
        manifest.sourceDetail = SourceDetail.LLM_EXPLORER;

        RequestRecord result = classified(manifest);

        assertEquals(TrafficClassification.TrafficClass.DISCOVERY_METADATA,
                result.trafficClassification.trafficClass());
        assertEquals(TrafficClassification.Disposition.EXCLUDE,
                result.trafficClassification.disposition());
        assertEquals(List.of("WEB_APP_MANIFEST_BODY"), result.trafficClassification.reasons());
    }

    @Test
    void manifest_json_경로지만_PWA_본문이_아닌_business_API는_보존한다() {
        RequestRecord api = record("GET", "/assets/manifest.json", null, "application/json");
        api.body = "{\"id\":42,\"status\":\"ready\"}";

        assertEquals(TrafficClassification.TrafficClass.API,
                classified(api).trafficClassification.trafficClass());
    }

    @Test
    void 권한응답_하나만으로_경로를_business_API로_확정하지_않는다() {
        RequestRecord directoryProbe = new RequestRecord(Source.HUMAN, "https://t:443",
                "GET", "/static/js/", 403, "anon");
        directoryProbe.hasResponse = true;

        RequestRecord result = classified(directoryProbe);

        assertEquals(TrafficClassification.TrafficClass.UNKNOWN,
                result.trafficClassification.trafficClass());
        assertEquals(TrafficClassification.Disposition.REVIEW,
                result.trafficClassification.disposition());
        assertEquals(List.of("AUTHORIZATION_RESPONSE_ONLY"), result.trafficClassification.reasons());
    }

    @Test
    void JSON_API의_권한응답은_계속_business_API로_포함한다() {
        RequestRecord api = new RequestRecord(Source.HUMAN, "https://t:443",
                "GET", "/api/admin", 403, "anon");
        api.hasResponse = true;
        api.responseContentType = "application/json";

        RequestRecord result = classified(api);

        assertEquals(TrafficClassification.TrafficClass.API,
                result.trafficClassification.trafficClass());
        assertEquals(TrafficClassification.Disposition.INCLUDE,
                result.trafficClassification.disposition());
        assertTrue(result.trafficClassification.reasons().contains("AUTHORIZATION_RESPONSE"));
        assertTrue(result.trafficClassification.reasons().contains("API_MEDIA_TYPE"));
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
