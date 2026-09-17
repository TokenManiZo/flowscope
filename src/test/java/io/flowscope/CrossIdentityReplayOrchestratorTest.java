package io.flowscope;

import io.flowscope.core.AccessRole;
import io.flowscope.core.AccountProfile;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.AuthorizationAnalysis;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ResourcePolicy;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import io.flowscope.core.Verdict;
import io.flowscope.integration.CrossIdentityReplayOrchestrator;
import io.flowscope.integration.SessionBroker;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

final class CrossIdentityReplayOrchestratorTest {
    private static final Instant NOW = Instant.parse("2026-09-16T00:00:00Z");
    private static final ScopePolicy SCOPE = ScopePolicy.parse("https://api.test/api");

    @Test
    void unarmedRunNeverSendsSafeRequests() {
        SessionBroker broker = activeBroker("user-b", "Bearer replay-secret");
        AtomicInteger sends = new AtomicInteger();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    sends.incrementAndGet();
                    return response(200, "{\"id\":19}");
                }, (candidate, headers) -> fail("GET must not open a draft"));

        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(List.of(
                candidate("GET /api/orders/{id}", "https://api.test/api/orders/19")), false);

        assertEquals(0, sends.get());
        assertEquals(0, result.sent());
        assertEquals(CrossIdentityReplayOrchestrator.Outcome.SKIPPED_UNARMED,
                result.items().getFirst().outcome());
    }

    @Test
    void onlyGetAndHeadAreSentAndStateChangingMethodsBecomeRepeaterDrafts() {
        String rawSecret = "Bearer never-persist-this";
        SessionBroker broker = activeBroker("user-b", rawSecret);
        AtomicInteger sends = new AtomicInteger();
        AtomicInteger drafts = new AtomicInteger();
        List<CrossIdentityReplayOrchestrator.ReplayContext> contexts = new ArrayList<>();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    assertEquals(rawSecret, headers.get("Authorization"));
                    contexts.add(context);
                    sends.incrementAndGet();
                    return response(200, "{\"id\":19}");
                }, (candidate, headers) -> {
                    assertEquals(rawSecret, headers.get("Authorization"));
                    drafts.incrementAndGet();
                });

        List<CrossIdentityReplayOrchestrator.Recommendation> candidates = new ArrayList<>();
        for (String method : List.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")) {
            candidates.add(candidate(method + " /api/orders/{id}", "https://api.test/api/orders/19"));
        }
        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(candidates, true);

        assertEquals(2, sends.get());
        assertEquals(4, drafts.get());
        assertEquals(2, result.sent());
        assertEquals(4, result.drafted());
        assertTrue(contexts.stream().allMatch(context -> context.executionTrust() == ExecutionTrust.CONTROLLED));
        assertFalse(result.toString().contains(rawSecret));
        assertEquals(1, CrossIdentityReplayOrchestrator.MAX_CONCURRENT_PER_TARGET,
                "automatic replay must remain serialized per target");
    }

    @Test
    void outOfScopeAndNonActiveIdentitiesAreSkippedBeforeTransport() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        AccountProfile inactive = new AccountProfile("user-c", "USER C", "https://api.test:443", AccessRole.USER);
        String inactiveHandle = broker.beginCapture(inactive, NOW);
        broker.observeRequest(inactiveHandle, URI.create("https://api.test/login"),
                Map.of("Authorization", "Bearer inactive"), NOW);
        broker.endCapture(inactiveHandle);
        AtomicInteger sends = new AtomicInteger();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    sends.incrementAndGet();
                    return response(200, "{}");
                }, (candidate, headers) -> fail("no draft expected"));

        CrossIdentityReplayOrchestrator.Recommendation outside = candidate(
                "GET /private/orders/{id}", "https://api.test/private/orders/19");
        CrossIdentityReplayOrchestrator.Recommendation inactiveCandidate = new CrossIdentityReplayOrchestrator.Recommendation(
                "GET /api/orders/{id}", "user-c", "user-a", "ev-basis",
                URI.create("https://api.test/api/orders/19"));
        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(
                List.of(outside, inactiveCandidate), true);

        assertEquals(0, sends.get());
        assertEquals(2, result.skipped());
        assertTrue(result.items().stream().allMatch(item ->
                item.outcome() == CrossIdentityReplayOrchestrator.Outcome.SKIPPED_INELIGIBLE));
    }

    @Test
    void duplicateOperationAndIdentityIsExecutedOnce() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        AtomicInteger sends = new AtomicInteger();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    sends.incrementAndGet();
                    return response(200, "{}");
                }, (candidate, headers) -> fail("no draft expected"));
        CrossIdentityReplayOrchestrator.Recommendation value = candidate(
                "GET /api/orders/{id}", "https://api.test/api/orders/19");

        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(List.of(value, value), true);

        assertEquals(1, sends.get());
        assertEquals(1, result.sent());
        assertEquals(CrossIdentityReplayOrchestrator.Outcome.SKIPPED_DUPLICATE,
                result.items().get(1).outcome());
    }

    @Test
    void anonymousReplayStaysInScopeAndUsesNoCredentials() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        AtomicInteger sends = new AtomicInteger();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    assertEquals(CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY,
                            candidate.targetIdentity());
                    assertTrue(headers.isEmpty());
                    sends.incrementAndGet();
                    return response(200, "{\"id\":19}");
                }, (candidate, headers) -> fail("GET must not open a draft"));
        CrossIdentityReplayOrchestrator.Recommendation anonymous =
                new CrossIdentityReplayOrchestrator.Recommendation(
                        "GET /api/orders/{id}", CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY,
                        "user-a", "ev-basis", URI.create("https://api.test/api/orders/19"));
        CrossIdentityReplayOrchestrator.Recommendation outside =
                new CrossIdentityReplayOrchestrator.Recommendation(
                        "GET /private/orders/{id}", CrossIdentityReplayOrchestrator.ANONYMOUS_IDENTITY,
                        "user-a", "ev-outside", URI.create("https://api.test/private/orders/19"));

        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(
                List.of(anonymous, outside), true);

        assertEquals(1, sends.get());
        assertEquals(1, result.sent());
        assertEquals(CrossIdentityReplayOrchestrator.Outcome.SKIPPED_INELIGIBLE,
                result.items().get(1).outcome());
    }

    @Test
    void unauthorizedReplayMakesIdentitySuspectAndSkipsItsNextRequest() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        AtomicInteger sends = new AtomicInteger();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    sends.incrementAndGet();
                    return response(401, "{\"error\":\"invalid token\"}");
                }, (candidate, headers) -> fail("no draft expected"));

        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(List.of(
                candidate("GET /api/orders/{id}", "https://api.test/api/orders/19"),
                candidate("GET /api/profile", "https://api.test/api/profile")), true);

        assertEquals(1, sends.get());
        assertEquals(SessionBroker.Status.SUSPECT,
                broker.viewForAccount("user-b").orElseThrow().status());
        assertEquals(CrossIdentityReplayOrchestrator.Outcome.SKIPPED_INELIGIBLE,
                result.items().get(1).outcome());
    }

    @Test
    void killSwitchStopsTheRunBeforeItsNextSend() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        AtomicInteger sends = new AtomicInteger();
        AtomicReference<CrossIdentityReplayOrchestrator> reference = new AtomicReference<>();
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    sends.incrementAndGet();
                    reference.get().kill();
                    return response(200, "{}");
                }, (candidate, headers) -> fail("no draft expected"));
        reference.set(orchestrator);

        CrossIdentityReplayOrchestrator.RunResult result = orchestrator.execute(List.of(
                candidate("GET /api/orders/{id}", "https://api.test/api/orders/19"),
                candidate("GET /api/profile", "https://api.test/api/profile")), true);

        assertEquals(1, sends.get());
        assertEquals(CrossIdentityReplayOrchestrator.Outcome.SKIPPED_KILL_SWITCH,
                result.items().get(1).outcome());
    }

    @Test
    void controlledReplayFeedsTheExistingAnalyzerButNeverConfirmsTheFinding() {
        SessionBroker broker = activeBroker("user-b", "Bearer active");
        List<RequestRecord> records = new ArrayList<>();
        RequestRecord owner = record(Source.HUMAN, "user-a", 200,
                "{\"id\":19,\"ownerId\":\"user-a\"}");
        records.add(owner);
        CrossIdentityReplayOrchestrator orchestrator = orchestrator(broker,
                (candidate, headers, context) -> {
                    RequestRecord replay = record(Source.SCANNER, "user-b", 200, "{\"id\":19}");
                    context.applyTo(replay);
                    records.add(replay);
                    return response(200, replay.body);
                }, (candidate, headers) -> fail("no draft expected"));

        CrossIdentityReplayOrchestrator.RunResult run = orchestrator.execute(List.of(
                candidate("GET /api/orders/{id}", "https://api.test/api/orders/19")), true);
        AnalysisConfig config = new AnalysisConfig()
                .upsertAccount(new AccountProfile("user-a", "USER A", "https://api.test:443", AccessRole.USER))
                .upsertAccount(new AccountProfile("user-b", "USER B", "https://api.test:443", AccessRole.USER));
        Pipeline.Result result = Pipeline.run(records, config);
        RequestRecord replay = result.records.stream()
                .filter(record -> record.phase == RunPhase.AUTHORIZATION_REPLAY).findFirst().orElseThrow();
        AuthorizationAnalysis.CoverageCell cross = result.analysis.cells().stream()
                .filter(cell -> cell.key().identity().equals("user-b")).findFirst().orElseThrow();

        assertEquals(ExecutionTrust.CONTROLLED, replay.executionTrust);
        assertEquals(Source.SCANNER, replay.source);
        assertEquals(SourceDetail.AUTHORIZATION_REPLAY, replay.sourceDetail);
        assertEquals(Orchestrator.SYSTEM, replay.orchestrator);
        assertEquals(ToolKind.BURP, replay.tool);
        assertEquals("user-a", replay.replayBasisIdentity);
        assertEquals("user-b", replay.laneAccountId);
        assertEquals(Verdict.SUSPICIOUS, cross.overall());
        assertFalse(result.analysis.findings().isEmpty());
        assertTrue(config.reviews().isEmpty(), "controlled replay may create a candidate, never a human confirmation");
        assertEquals(1, run.sent());
    }

    private static CrossIdentityReplayOrchestrator orchestrator(
            SessionBroker broker,
            CrossIdentityReplayOrchestrator.Transport transport,
            CrossIdentityReplayOrchestrator.DraftOpener drafts) {
        return new CrossIdentityReplayOrchestrator(broker, () -> SCOPE, transport, drafts,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static SessionBroker activeBroker(String accountId, String authorization) {
        SessionBroker broker = new SessionBroker();
        AccountProfile account = new AccountProfile(accountId, accountId.toUpperCase(),
                "https://api.test:443", AccessRole.USER);
        String handle = broker.beginCapture(account, NOW);
        broker.observeRequest(handle, URI.create("https://api.test/login"),
                Map.of("Authorization", authorization), NOW);
        broker.observeResponse(handle, URI.create("https://api.test/me"), 200, null,
                "{\"id\":\"" + accountId + "\"}", List.of(), NOW);
        broker.endCapture(handle);
        return broker;
    }

    private static CrossIdentityReplayOrchestrator.Recommendation candidate(String operation, String target) {
        return new CrossIdentityReplayOrchestrator.Recommendation(
                operation, "user-b", "user-a", "ev-basis", URI.create(target));
    }

    private static CrossIdentityReplayOrchestrator.Exchange response(int status, String body) {
        FlowScopeWebServer.RequestLabResult result = new FlowScopeWebServer.RequestLabResult(
                "ev-replay", status, body, 1, 1, body.length());
        return new CrossIdentityReplayOrchestrator.Exchange(result, null, body, List.of());
    }

    private static RequestRecord record(Source source, String identity, int status, String body) {
        RequestRecord record = new RequestRecord(source, "https://api.test:443",
                "GET", "/api/orders/19", status, "sub:" + identity);
        record.body = body;
        record.responseContentType = "application/json";
        record.hasResponse = true;
        record.timestamp = NOW.toEpochMilli();
        record.executionTrust = source == Source.HUMAN ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        return record;
    }
}
