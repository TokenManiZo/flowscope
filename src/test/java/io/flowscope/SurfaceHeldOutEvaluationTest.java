package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SurfaceAnalysis;
import io.flowscope.core.SurfaceAnalyzer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** 개발 corpus와 별도인 server-truth fixture. truth.json은 분석기 입력으로 전달하지 않는다. */
final class SurfaceHeldOutEvaluationTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SERVICE = "https://heldout.invalid:443";

    @Test
    void held_out_truth로_endpoint_parameter_asset과_알려진실패를_분리한다() throws Exception {
        List<RequestRecord> records = new ArrayList<>();
        records.add(document("/assets/generic-modern.mjs", "application/javascript",
                resource("generic-modern.mjs")));
        records.add(document("/contract.yaml", "application/yaml", resource("contract.yaml")));
        records.add(document("/forms", "text/html", resource("forms.html")));
        records.add(document("/assets/unsupported-wrapper.mjs", "application/javascript",
                resource("unsupported-wrapper.mjs")));
        records.add(document("/_next/static/build/_buildManifest.js", "application/javascript",
                resource("next-build-manifest.js")));
        RequestRecord graphql = new RequestRecord(Source.LLM, SERVICE, "POST", "/graphql", 200, "anon");
        graphql.hasResponse = true;
        graphql.requestContentType = "application/json";
        graphql.responseContentType = "application/json";
        graphql.reqBody = resource("graphql-request.json");
        graphql.body = "{\"data\":{}}";
        graphql.runId = "held-out-llm";
        records.add(graphql);

        Pipeline.Result result = Pipeline.runIsolated(records, new AnalysisConfig());
        List<RouteCandidate> candidates = RouteCandidateExtractor.extract(result.records,
                ScopePolicy.parse(SERVICE + "/"), List.of());
        SurfaceAnalysis surface = SurfaceAnalyzer.analyze(result.records, result.coverageRecords, candidates);
        JsonNode truth = JSON.readTree(resource("truth.json"));

        Set<String> endpoints = new LinkedHashSet<>();
        Set<String> parameters = new LinkedHashSet<>();
        for (SurfaceAnalysis.EndpointFact endpoint : surface.endpoints()) {
            String operation = endpoint.key().method() + " " + endpoint.key().pathTemplate();
            endpoints.add(operation);
            for (SurfaceAnalysis.ParameterFact parameter : endpoint.parameters()) {
                String name = parameter.location() == SurfaceAnalysis.ParameterLocation.PATH
                        ? parameter.displayName() : parameter.fieldPath();
                parameters.add(operation + "|" + parameter.location() + "|" + name);
            }
        }
        Set<String> assets = new LinkedHashSet<>();
        for (RouteCandidate candidate : candidates) {
            if (candidate.provenanceTypes().contains(RouteCandidate.ProvenanceType.HTML_SCRIPT)
                    || candidate.provenanceTypes().contains(RouteCandidate.ProvenanceType.SCRIPT_DEPENDENCY)
                    || candidate.provenanceTypes().contains(RouteCandidate.ProvenanceType.FRAMEWORK_MANIFEST_ASSET)) {
                assets.add(candidate.method() + " " + candidate.pathTemplate());
            }
        }

        assertEquals(strings(truth.path("expectedEndpoints")), endpoints);
        assertEquals(strings(truth.path("expectedParameters")), parameters);
        assertEquals(strings(truth.path("expectedAssetRoutes")), assets);
        JsonNode unsupported = truth.path("knownUnsupported").get(0);
        assertEquals("UNRECOGNIZED_APPLICATION_WRAPPER", unsupported.path("category").asText());
        assertFalse(endpoints.contains(unsupported.path("endpoint").asText()),
                "근거 없는 application wrapper를 HTTP 호출로 추정하면 안 된다");
    }

    private static Set<String> strings(JsonNode values) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        values.forEach(value -> out.add(value.asText()));
        return out;
    }

    private static RequestRecord document(String path, String mediaType, String body) {
        RequestRecord record = new RequestRecord(Source.HUMAN, SERVICE, "GET", path, 200, "anon");
        record.hasResponse = true;
        record.responseContentType = mediaType;
        record.body = body;
        record.runId = "held-out-human";
        return record;
    }

    private static String resource(String name) throws IOException {
        try (InputStream input = SurfaceHeldOutEvaluationTest.class.getResourceAsStream(
                "/surface-heldout/" + name)) {
            assertNotNull(input, name);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
