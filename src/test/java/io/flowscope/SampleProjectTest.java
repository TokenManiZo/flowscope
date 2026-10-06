package io.flowscope;

import io.flowscope.core.*;
import io.flowscope.web.SnapshotJsonWriter;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class SampleProjectTest {
    @Test
    void sampleExercisesThreeSourcesAccountsAndBothAuthorizationFindingTypes() throws Exception {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());

        assertEquals(3, result.analysis.activeSources().size());
        assertEquals(3, sample.config().accounts().size());
        assertEquals("acct-demo-user-a", sample.config()
                .boundAccount("https://demo.flowscope.test:443", "sess:demo-a-rotated").orElseThrow().id());
        assertTrue(result.analysis.findings().stream()
                .anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BOLA));
        assertTrue(result.analysis.findings().stream()
                .anyMatch(finding -> finding.type() == AuthorizationAnalysis.FindingType.BFLA));
        // PR #11 sample expansion: identity-bound APIs without a dummy Object and a second object-backed group.
        assertEquals("acct-demo-user-a", sample.config().resourceOwner(
                "https://demo.flowscope.test:443 posts:301"));
        assertEquals("acct-demo-user-b", sample.config().resourceOwner(
                "https://demo.flowscope.test:443 posts:302"));
        assertTrue(result.coverageRecords.stream().anyMatch(record -> record.op.endsWith("GET /api/profile")));
        assertTrue(result.coverageRecords.stream().anyMatch(record -> record.op.endsWith("GET /api/account")));
        assertTrue(result.coverageRecords.stream().anyMatch(record -> record.op.endsWith("GET /api/posts/{id}")));
        assertTrue(result.coverageRecords.stream().filter(record ->
                record.path.equals("/api/profile") || record.path.equals("/api/account"))
                .allMatch(record -> record.resource == null), "identity-bound API에는 dummy Object를 만들지 않는다");
        assertTrue(result.coverageRecords.stream().anyMatch(record ->
                record.resource != null && record.resource.endsWith("posts:301")));
        assertTrue(result.coverageRecords.stream().anyMatch(record ->
                record.resource != null && record.resource.endsWith("posts:302")));
        assertTrue(result.records.stream().allMatch(record -> record.reqText.contains("Authorization: Bearer demo-")));
        assertTrue(result.records.stream().anyMatch(record ->
                record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.AUTH_SESSION));
        assertEquals(3, result.records.stream().filter(record ->
                record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.POLLING).count());
        assertTrue(result.coverageRecords.stream().noneMatch(record ->
                record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.AUTH_SESSION
                        || record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.POLLING));
        assertTrue(new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                new SnapshotJsonWriter().write(1, result, sample.config(), java.util.List.of(), java.util.List.of()))
                .path("sampleMode").asBoolean());
    }

    @Test
    void frontendCrossScreenFixtureMatchesTheCurrentPackagedSample() throws Exception {
        SampleProject.Data sample = SampleProject.create();
        Pipeline.Result result = Pipeline.run(sample.records(), sample.config());
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        String services = result.records.stream().map(record -> record.service + "/")
                .distinct().collect(java.util.stream.Collectors.joining("\n"));
        List<RouteCandidate> routes = RouteCandidateExtractor.extract(
                result.records, ScopePolicy.parse(services), List.of());
        var current = json.readTree(new SnapshotJsonWriter().write(
                1, 0, result, sample.config(), List.of(), List.of(), List.of(), routes, 0, List.of()));
        var fixture = json.readTree(Files.readAllBytes(
                Path.of("frontend/src/test/sample/sample-snapshot.json")));

        assertEquals(current, fixture,
                "프런트 화면 간 회귀 fixture는 현재 SampleProject snapshot과 함께 갱신해야 한다");
    }
}
