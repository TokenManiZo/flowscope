package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import io.flowscope.integration.ZapCampaign;
import io.flowscope.integration.ZapClient;
import io.flowscope.integration.ZapAccountVault;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static io.flowscope.FakeZap.registerSafeZapEnvironment;
import static io.flowscope.FakeZap.zapReply;
import static org.junit.jupiter.api.Assertions.*;

/** MCP 전송 계층 없이 기존 캠페인 계약을 검증한다. 실물 ZAP 검증은 별도다. */
final class ZapCampaignTest {
    private static final String TARGET = "https://fixture.example.test/";

    @Test
    void completesWithEvidenceProgressAndAlertsWithoutAnMcpServer() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertEquals(1, result.path("captured_records").asInt());
            assertEquals(1, result.at("/lanes/0/client_captures").asInt());
            assertTrue(result.path("passive_complete").asBoolean());
            assertTrue(result.path("alert_snapshot_complete").asBoolean());
            assertFalse(result.path("events").isEmpty());
            assertTrue(result.has("elapsed_seconds"));
            assertNull(fixture.contexts.current(Source.SCANNER));
            await(() -> fixture.capabilityRun.get().isEmpty());
            campaign.resetWorkflow();
            assertEquals("NOT_STARTED", campaign.deterministicZapBaselineStatus().path("status").asText());
        }
    }



    @Test
    void campaignCloseStopsOwnedCrawlerWithoutMcp() throws Exception {
        try (Fixture fixture = new Fixture(true)) {
            ZapCampaign campaign = new ZapCampaign(fixture);
            try (campaign) {
                campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
                assertTrue(fixture.started.await(3, TimeUnit.SECONDS));
                await(() -> "CLIENT_SPIDER".equals(
                        campaign.deterministicZapBaselineStatus().at("/lanes/0/stage").asText())
                        && !campaign.deterministicZapBaselineStatus().path("scan_id").asText().isEmpty());
            }
            assertTrue(fixture.stopped.get());
            assertNull(fixture.contexts.current(Source.SCANNER));
            assertEquals("", fixture.capabilityRun.get());
            assertEquals("CANCELLED", campaign.deterministicZapBaselineStatus().path("status").asText());
        }
    }

    @Test
    void runStageIsTheBareStageKeySoTheUiCanTranslateIt() throws Exception {
        try (Fixture fixture = new Fixture(true);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            assertTrue(fixture.started.await(3, TimeUnit.SECONDS));
            await(() -> !campaign.deterministicZapBaselineStatus().path("scan_id").asText().isEmpty());
            // 계정 이름은 lanes[].account_label에 있다. run.stage에 붙이면 화면이 "test2 · PASSIVE_SCAN_QUEUE"를 그대로 보인다.
            assertEquals("CLIENT_SPIDER", campaign.deterministicZapBaselineStatus().path("stage").asText());
        }
    }

    @Test
    void preservesScopeGuard() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            assertTrue(assertThrows(IllegalArgumentException.class,
                    () -> campaign.startDeterministicZapCampaign("https://outside.example.test/", List.of(), true))
                    .getMessage().contains("outside configured scope"));
            assertEquals(1, fixture.started.getCount(), "blocked starts must not invoke a crawler");
            assertEquals("", fixture.capabilityRun.get());
        }
    }

    @Test
    void independentExplorerBlocksTheCampaignBeforeAnyZapWork() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.contexts.activate(Source.LLM, new RunContextRegistry.Context(SourceDetail.LLM_EXPLORER,
                    Orchestrator.LLM, ToolKind.CODEX, RunPhase.EXPLORATION, "explorer-fixture"));
            assertTrue(assertThrows(IllegalStateException.class,
                    () -> campaign.startDeterministicZapCampaign(TARGET, List.of(), true))
                    .getMessage().contains("independent Explorer"));
            assertEquals(1, fixture.started.getCount());
            assertEquals("", fixture.capabilityRun.get());
            assertNull(fixture.contexts.current(Source.SCANNER));
        }
    }

    @Test
    void campaignRunsAlongsideIndependentHumanAccounts() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.contexts.activateHuman(new RunContextRegistry.Context(SourceDetail.BROWSER,
                    Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "human-a", "A"));
            fixture.contexts.activateHuman(new RunContextRegistry.Context(SourceDetail.BROWSER,
                    Orchestrator.HUMAN, ToolKind.BROWSER, RunPhase.EXPLORATION, "human-b", "B"));
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            assertEquals("COMPLETED", awaitTerminal(campaign).path("status").asText());
            assertEquals(2, fixture.contexts.activeHumanRuns().size());
        }
    }

    @Test
    void completedStatusIsPublishedOnlyAfterCleanupAndAllowsImmediateRestart() throws Exception {
        assertTerminalWaitsForCleanup(true);
    }

    @Test
    void failedStatusIsPublishedOnlyAfterCleanupAndAllowsImmediateRestart() throws Exception {
        assertTerminalWaitsForCleanup(false);
    }

    private void assertTerminalWaitsForCleanup(boolean capture) throws Exception {
        try (Fixture fixture = new Fixture(false, capture);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            CountDownLatch cleaning = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            fixture.holdCleanup(cleaning, release);
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            try {
                assertTrue(cleaning.await(5, TimeUnit.SECONDS));
                JsonNode status = campaign.deterministicZapBaselineStatus();
                assertEquals("RUNNING", status.path("status").asText(), status.toString());
                assertEquals("CLEANUP", status.path("stage").asText());
                assertNotNull(fixture.contexts.current(Source.SCANNER), "dataset changes must remain blocked until cleanup finishes");
            } finally { release.countDown(); }
            assertEquals(capture ? "COMPLETED" : "FAILED", awaitTerminal(campaign).path("status").asText());
            assertEquals("", fixture.capabilityRun.get());
            assertDoesNotThrow(() -> campaign.startDeterministicZapCampaign(TARGET, List.of(), true));
            awaitTerminal(campaign);
        }
    }

    @Test
    void cancellationDoesNotPublishTerminalWhileOwnedCleanupIsBlocked() throws Exception {
        try (Fixture fixture = new Fixture(true);
             ZapCampaign campaign = new ZapCampaign(fixture);
             var callers = Executors.newVirtualThreadPerTaskExecutor()) {
            CountDownLatch cleaning = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            fixture.holdCleanup(cleaning, release);
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            await(() -> "2".equals(campaign.deterministicZapBaselineStatus().path("scan_id").asText()));
            var cancellation = callers.submit(campaign::cancelDeterministicZapBaseline);
            try {
                assertTrue(cleaning.await(5, TimeUnit.SECONDS));
                JsonNode status = campaign.deterministicZapBaselineStatus();
                assertEquals("RUNNING", status.path("status").asText());
                assertEquals("CLEANUP", status.path("stage").asText());
                assertNotNull(fixture.contexts.current(Source.SCANNER));
            } finally { release.countDown(); }
            cancellation.get(5, TimeUnit.SECONDS);
            JsonNode terminal = awaitTerminal(campaign);
            assertEquals("CANCELLED", terminal.path("status").asText());
            terminal.path("lanes").forEach(lane -> assertFalse(
                    List.of("RUNNING", "PENDING").contains(lane.path("status").asText())));
            assertTrue(fixture.stopped.get());
            assertEquals("", fixture.capabilityRun.get());
            assertDoesNotThrow(() -> campaign.startDeterministicZapCampaign(TARGET, List.of(), true));
        }
    }

    @Test
    void cancellationWaitsForAcceptedStartReplyAndStopsTheReturnedScan() throws Exception {
        try (Fixture fixture = new Fixture(true);
             ZapCampaign campaign = new ZapCampaign(fixture);
             var callers = Executors.newVirtualThreadPerTaskExecutor()) {
            CountDownLatch accepted = new CountDownLatch(1);
            CountDownLatch reply = new CountDownLatch(1);
            CountDownLatch cancelling = new CountDownLatch(1);
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                accepted.countDown();
                Fixture.awaitRelease(reply);
                zapReply(exchange, "{\"scan\":\"2\"}");
            });
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            assertTrue(accepted.await(5, TimeUnit.SECONDS));
            var cancellation = callers.submit(() -> {
                cancelling.countDown();
                return campaign.cancelDeterministicZapBaseline();
            });
            try {
                assertTrue(cancelling.await(5, TimeUnit.SECONDS));
                assertThrows(TimeoutException.class, () -> cancellation.get(150, TimeUnit.MILLISECONDS));
            } finally { reply.countDown(); }
            cancellation.get(5, TimeUnit.SECONDS);
            assertEquals("CANCELLED", awaitTerminal(campaign).path("status").asText());
            assertTrue(fixture.stopped.get(), "accepted scan must not be orphaned by interrupting its start reply");
            assertNull(fixture.contexts.current(Source.SCANNER));
        }
    }

    private static JsonNode awaitTerminal(ZapCampaign campaign) throws Exception {
        await(() -> !"RUNNING".equals(campaign.deterministicZapBaselineStatus().path("status").asText()));
        return campaign.deterministicZapBaselineStatus();
    }

    @Test
    void authenticationOnlyRunPromotesTheVerifiedEvidenceIntoTheIndependentAccountSession() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("COMPLETED", terminal.path("status").asText(), terminal.toString());
            assertEquals("SESSION_READY", terminal.path("stage").asText());
            assertTrue(fixture.promotedEvidenceRuntimeId > 0);
            assertEquals("user-a", fixture.promotedAccountId);
            assertEquals("VERIFIED_BY_ZAP", fixture.accounts.view("user-a").status().name());
        }
    }

    @Test
    void authenticationOnlyRunFailsWhenTheVerifiedResponseCannotPopulateTheAccountSession() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            fixture.allowSessionPromotion = false;

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            assertTrue(terminal.path("error").asText().contains("독립 계정 세션"), terminal.toString());
            assertEquals("FAILED", fixture.accounts.view("user-a").status().name());
            assertEquals(1, terminal.path("captured_records").asInt(), terminal.toString());
            assertEquals(1, terminal.at("/lanes/0/captured_records").asInt(), terminal.toString());
            assertNull(fixture.contexts.current(Source.SCANNER));
            assertEquals("", fixture.capabilityRun.get());
        }
    }

    @Test
    void authenticationOnlyFailurePreservesResponsesCapturedBeforeTheApiFailed() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            fixture.server.removeContext("/JSON/users/action/authenticateAsUser/");
            fixture.server.createContext("/JSON/users/action/authenticateAsUser/", exchange -> {
                fixture.observe("/assets/root.js");
                byte[] body = "authentication transport failed".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(503, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            assertTrue(terminal.path("error").asText().contains("HTTP 503"), terminal.toString());
            assertEquals(1, terminal.path("captured_records").asInt(), terminal.toString());
            assertEquals(1, terminal.at("/lanes/0/captured_records").asInt(), terminal.toString());
            assertEquals(1, fixture.started.getCount(), "failed login must not start a crawler");
            assertNull(fixture.contexts.current(Source.SCANNER));
            assertEquals("", fixture.capabilityRun.get());
        }
    }

    @Test
    void authenticationOnlyCleanupFailurePreservesCapturedResponses() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            fixture.server.removeContext("/JSON/replacer/action/removeRule/");
            fixture.server.createContext("/JSON/replacer/action/removeRule/", exchange ->
                    zapReply(exchange, "{\"Result\":\"FAIL\"}"));

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            assertTrue(terminal.path("error").asText().contains("capability cleanup failed"), terminal.toString());
            assertEquals(1, terminal.path("captured_records").asInt(), terminal.toString());
            assertEquals(1, terminal.at("/lanes/0/captured_records").asInt(), terminal.toString());
            assertNull(fixture.contexts.current(Source.SCANNER));
            assertEquals("", fixture.capabilityRun.get());
        }
    }

    @Test
    void injectedVerificationProbesTheSessionAndReportsLoggedIn() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            List<String> probes = new CopyOnWriteArrayList<>();
            fixture.server.removeContext("/JSON/core/action/sendRequest/");
            fixture.server.createContext("/JSON/core/action/sendRequest/", exchange -> {
                probes.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                zapReply(exchange, "{\"sendRequest\":[{\"responseHeader\":\"HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\",\"responseBody\":\"{\\\"user\\\":\\\"ok\\\"}\"}]}");
            });
            fixture.addInjectedAccount("user-a", "SESSION=abc123", "", TARGET + "api/me");

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("COMPLETED", terminal.path("status").asText(), terminal.toString());
            assertEquals("VERIFIED_BY_ZAP", fixture.accounts.view("user-a").status().name());
            assertTrue(fixture.accounts.view("user-a").message().contains("로그인 확인"), fixture.accounts.view("user-a").message());
            // 프로브 요청에 주입 쿠키가 실렸다. 폼 로그인(authenticateAsUser)은 쓰지 않는다.
            assertTrue(probes.stream().anyMatch(p -> p.contains("SESSION%3Dabc123") || p.contains("SESSION=abc123")), probes.toString());
        }
    }

    @Test
    void injectedVerificationReportsNotLoggedInOnLoginRedirect() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.server.removeContext("/JSON/core/action/sendRequest/");
            fixture.server.createContext("/JSON/core/action/sendRequest/", exchange -> zapReply(exchange,
                    "{\"sendRequest\":[{\"responseHeader\":\"HTTP/1.1 302 Found\\r\\nLocation: " + TARGET + "login\\r\\n\",\"responseBody\":\"\"}]}"));
            fixture.addInjectedAccount("user-a", "SESSION=stale", "", TARGET + "api/me");

            campaign.startAuthenticationOnly("user-a");
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            assertEquals("FAILED", fixture.accounts.view("user-a").status().name());
        }
    }

    @Test
    void injectedAccountSeedsTheSessionCookieAndCrawlsWithoutFormLogin() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            List<String> calls = new CopyOnWriteArrayList<>();
            for (String action : List.of("addSessionToken", "createEmptySession", "setSessionTokenValue", "setActiveSession")) {
                fixture.server.removeContext("/JSON/httpSessions/action/" + action + "/");
                fixture.server.createContext("/JSON/httpSessions/action/" + action + "/", exchange -> {
                    // ZapClient는 이 액션들을 POST 본문(form)으로 보낸다. 쿼리가 아니라 본문을 읽는다.
                    calls.add(action + "?" + java.net.URLDecoder.decode(new String(exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8), java.nio.charset.StandardCharsets.UTF_8));
                    zapReply(exchange, "{\"Result\":\"OK\"}");
                });
            }
            // 폼 로그인(ZAP user 인증)을 쓰면 안 된다는 것을 확인한다.
            fixture.server.removeContext("/JSON/users/action/authenticateAsUser/");
            fixture.server.createContext("/JSON/users/action/authenticateAsUser/", exchange -> {
                calls.add("authenticateAsUser");
                zapReply(exchange, "{\"authSuccessful\":true}");
            });
            fixture.addInjectedAccount("user-a", "SESSION=abc123; csrf=z9", "");

            campaign.startDeterministicZapCampaign(TARGET, List.of("user-a"), false);
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("COMPLETED", terminal.path("status").asText(), terminal.toString());
            assertEquals("VERIFIED_BY_ZAP", fixture.accounts.view("user-a").status().name());
            assertTrue(calls.stream().anyMatch(c -> c.startsWith("addSessionToken") && c.contains("SESSION")), calls.toString());
            assertTrue(calls.stream().anyMatch(c -> c.startsWith("setSessionTokenValue") && c.contains("abc123")), calls.toString());
            assertTrue(calls.stream().anyMatch(c -> c.startsWith("setActiveSession")), calls.toString());
            // 주입 모드는 ZAP user 폼 인증을 하지 않는다. 세션 승격도 없다.
            assertFalse(calls.contains("authenticateAsUser"), calls.toString());
            assertEquals("", fixture.promotedAccountId);
        }
    }

    @Test
    void injectedAccountSendsItsHeadersOnEveryCrawlRequestAndRemovesTheRulesAfterwards() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            List<String> calls = new CopyOnWriteArrayList<>();
            for (String action : List.of("addRule", "removeRule")) {
                fixture.server.removeContext("/JSON/replacer/action/" + action + "/");
                fixture.server.createContext("/JSON/replacer/action/" + action + "/", exchange -> {
                    calls.add(action + " " + java.net.URLDecoder.decode(new String(exchange.getRequestBody().readAllBytes(),
                            java.nio.charset.StandardCharsets.UTF_8), java.nio.charset.StandardCharsets.UTF_8));
                    zapReply(exchange, "{\"Result\":\"OK\"}");
                });
            }
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                calls.add("client");
                fixture.observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
            });
            // Host와 스캐너 출처 헤더는 전송·격리에 쓰이므로 주입 값으로 덮어쓰면 안 된다.
            fixture.addInjectedAccount("user-a", "", "Authorization: Bearer injected-token\nX-Api-Key: k1\n"
                    + "Host: evil.example\nX-FlowScope-Scanner-Capability: forged");

            campaign.startDeterministicZapCampaign(TARGET, List.of("user-a"), false);
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("COMPLETED", terminal.path("status").asText(), terminal.toString());
            List<String> injected = calls.stream()
                    .filter(call -> call.startsWith("addRule ") && call.contains("description=flowscope-inject-")).toList();
            assertEquals(2, injected.size(), calls.toString());
            assertTrue(injected.stream().anyMatch(call -> call.contains("matchType=REQ_HEADER")
                    && call.contains("matchString=Authorization&") && call.contains("replacement=Bearer injected-token&")), calls.toString());
            assertTrue(injected.stream().anyMatch(call -> call.contains("matchString=X-Api-Key&")
                    && call.contains("replacement=k1&")), calls.toString());
            assertFalse(calls.stream().anyMatch(call -> call.contains("evil.example") || call.contains("forged")), calls.toString());
            // 크롤 전에 설치하고, lane이 끝나면 하나도 남기지 않는다.
            assertTrue(calls.indexOf(injected.get(0)) < calls.indexOf("client"), calls.toString());
            for (String rule : injected) {
                String description = rule.substring(rule.indexOf("description=") + "description=".length());
                description = description.substring(0, description.indexOf('&'));
                String expected = "removeRule description=" + description;
                assertTrue(calls.contains(expected), expected + " in " + calls);
            }
        }
    }

    @Test
    void authenticatedCampaignDoesNotFallBackToAnonymousWhenSessionPromotionFails() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            fixture.allowSessionPromotion = false;

            campaign.startDeterministicZapCampaign(TARGET, List.of("user-a"), false);
            JsonNode terminal = awaitTerminal(campaign);

            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            assertTrue(terminal.path("error").asText().contains("ANON으로 대체하지 않고"), terminal.toString());
            assertEquals("FAILED", terminal.at("/lanes/0/status").asText(), terminal.toString());
            assertEquals(1L, fixture.started.getCount(), "client spider must not start with an unbound session");
        }
    }

    @Test
    void runsTheTraditionalSpiderAfterTheClientSpiderWithGetOnlyOptions() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            List<String> calls = new CopyOnWriteArrayList<>();
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                calls.add("client");
                fixture.observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
            });
            for (String path : List.of("/JSON/spider/action/setOptionPostForm/", "/JSON/spider/action/excludeFromScan/")) {
                fixture.server.removeContext(path);
                fixture.server.createContext(path, exchange -> {
                    calls.add(path + "?" + java.net.URLDecoder.decode(exchange.getRequestURI().getRawQuery(), java.nio.charset.StandardCharsets.UTF_8));
                    zapReply(exchange, "{\"Result\":\"OK\"}");
                });
            }
            fixture.server.removeContext("/JSON/replacer/action/addRule/");
            fixture.server.createContext("/JSON/replacer/action/addRule/", exchange -> {
                calls.add("capability " + java.net.URLDecoder.decode(new String(exchange.getRequestBody().readAllBytes(),
                        java.nio.charset.StandardCharsets.UTF_8), java.nio.charset.StandardCharsets.UTF_8));
                zapReply(exchange, "{\"Result\":\"OK\"}");
            });
            fixture.server.removeContext("/JSON/spider/action/scan/");
            fixture.server.createContext("/JSON/spider/action/scan/", exchange -> {
                calls.add("spider?" + exchange.getRequestURI().getRawQuery());
                fixture.observe("/robots-only");
                zapReply(exchange, "{\"scan\":\"3\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertTrue(calls.stream().anyMatch(call -> call.startsWith("capability ") && call.contains("initiators=3,5,6,14,15,18")),
                    "the Spider initiator (3) must carry the run capability: " + calls);
            assertEquals("client", calls.stream().filter(call -> !call.startsWith("capability ")).findFirst().orElseThrow());
            assertTrue(calls.contains("/JSON/spider/action/setOptionPostForm/?Boolean=false"), calls.toString());
            assertTrue(calls.stream().anyMatch(call -> call.startsWith("/JSON/spider/action/excludeFromScan/?regex=")
                    && call.contains("log-?out")), calls.toString());
            String spider = calls.stream().filter(call -> call.startsWith("spider?")).findFirst().orElseThrow();
            assertTrue(spider.contains("subtreeOnly=true") && spider.contains("contextName=flowscope-"), spider);
            assertEquals(2, result.path("captured_records").asInt(), result.toString());
            assertTrue(fixture.records.stream().anyMatch(record -> record.sourceDetail == SourceDetail.ZAP_SPIDER
                    && "/robots-only".equals(record.path)));
        }
    }

    @Test
    void logsInTheTraditionalSpiderAsTheVerifiedZapUser() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            AtomicReference<String> query = new AtomicReference<>("");
            fixture.server.removeContext("/JSON/spider/action/scanAsUser/");
            fixture.server.createContext("/JSON/spider/action/scanAsUser/", exchange -> {
                query.set(exchange.getRequestURI().getRawQuery());
                zapReply(exchange, "{\"scanAsUser\":\"3\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of("user-a"), false);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertTrue(query.get().contains("contextId=1") && query.get().contains("userId=7")
                    && query.get().contains("subtreeOnly=true"), query.get());
        }
    }

    @Test
    void clearsTheClientMapAfterLoginAndRightBeforeTheClientSpider() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.addAuthenticatedAccount("user-a");
            List<String> calls = new CopyOnWriteArrayList<>();
            fixture.server.removeContext("/JSON/users/action/authenticateAsUser/");
            fixture.server.createContext("/JSON/users/action/authenticateAsUser/", exchange -> {
                calls.add("login");
                zapReply(exchange, "{\"authSuccessful\":true}");
            });
            for (String path : List.of("/JSON/script/action/setGlobalVar/", "/JSON/script/action/runStandAloneScript/",
                    "/JSON/script/view/globalVar/")) {
                fixture.server.removeContext(path);
            }
            FakeZap.registerClientMapReset(fixture.server, script -> calls.add("reset " + script));
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                calls.add("client");
                fixture.observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of("user-a"), false);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            // 로그인이 화면을 먼저 열어 Map에 등록한 메뉴·버튼을 Client Spider가 새 요소로 다시 보도록, 둘 사이에서 비운다.
            assertEquals(List.of("login", "reset flowscope-clear-client-map", "client"), calls);
        }
    }

    @Test
    void seedsTheClientSpiderWithClientRoutesFromTheRecordedBundle() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.observeScript("/static/js/main.js", """
                    jsx(Route, {path: "/shop", element: jsx(Shop, {})});
                    jsx(Route, {path: "/service-report", element: jsx(Report, {})});
                    jsx(Route, {path: "/login", element: jsx(Login, {})});
                    jsx(Route, {path: "/change-email", element: jsx(ChangeEmail, {})});
                    jsx(Route, {path: "/post/:id", element: jsx(Post, {})});
                    """);
            java.util.Map<String, String> vars = new java.util.concurrent.ConcurrentHashMap<>();
            for (String path : List.of("/JSON/script/action/setGlobalVar/", "/JSON/script/action/runStandAloneScript/",
                    "/JSON/script/view/globalVar/")) {
                fixture.server.removeContext(path);
            }
            FakeZap.registerClientMapReset(fixture.server, script -> { }, vars);

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            // 시작 주소 + 바로 열 수 있는 화면. 로그인·계정 변경 화면과 매개변수 경로는 넣지 않는다.
            assertEquals(String.join("\n", TARGET, "https://fixture.example.test/shop",
                    "https://fixture.example.test/service-report"), vars.get("flowscope.clientMap.seeds"));
            assertTrue(result.path("events").toString().contains("클라이언트 라우트 2개"), result.toString());
        }
    }

    @Test
    void aFollowUpPassOpensDetailScreensWithIdsCollectedDuringTheFirstPass() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.observeScript("/static/js/main.js", """
                    jsx(Route, {path: "/forum", element: jsx(Forum, {})});
                    navigate(`/post?post_id=${n}`);
                    """);
            java.util.Map<String, String> vars = new java.util.concurrent.ConcurrentHashMap<>();
            List<String> seedsPerPass = new CopyOnWriteArrayList<>();
            for (String path : List.of("/JSON/script/action/setGlobalVar/", "/JSON/script/action/runStandAloneScript/",
                    "/JSON/script/view/globalVar/")) {
                fixture.server.removeContext(path);
            }
            FakeZap.registerClientMapReset(fixture.server, script -> seedsPerPass.add(vars.get("flowscope.clientMap.seeds")), vars);
            java.util.concurrent.atomic.AtomicInteger passes = new java.util.concurrent.atomic.AtomicInteger();
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                // 1차 패스가 Forum을 열면서 목록 응답(실제 글 ID)을 처음 수집한다.
                if (passes.incrementAndGet() == 1) {
                    fixture.observe("/community/api/v2/community/posts/recent", "{\"posts\":[{\"id\":\"abcPOST1\"}]}");
                } else {
                    fixture.observe("/community/api/v2/community/posts/abcPOST1");
                }
                zapReply(exchange, "{\"scan\":\"" + (1 + passes.get()) + "\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertEquals(2, passes.get(), "새 상세 주소가 생겼으므로 후속 패스를 한 번 돈다");
            assertEquals(2, seedsPerPass.size(), seedsPerPass.toString());
            assertFalse(seedsPerPass.get(0).contains("post_id=abcPOST1"), "1차 패스 전에는 글 ID를 모른다");
            // 후속 패스는 시작 주소 + 새로 생긴 상세 주소만 넣는다(1차에 넣은 /forum은 다시 넣지 않는다).
            // 쿼리 주소에는 Client Map 노드를 나누는 fragment가 붙는다(서버로는 가지 않는다).
            assertEquals(String.join("\n", TARGET, "https://fixture.example.test/post?post_id=abcPOST1#flowscope-1"),
                    seedsPerPass.get(1));
            assertTrue(result.path("events").toString().contains("후속 패스 1"), result.toString());
            assertTrue(result.path("events").toString().contains("후속 패스 종료"), result.toString());
        }
    }

    @Test
    void followUpPassesGoDeeperWhileDetailScreensRevealNewIds() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.observeScript("/static/js/main.js", """
                    navigate(`/post?post_id=${n}`);
                    navigate(`/user?user_id=${n}`);
                    """);
            java.util.concurrent.atomic.AtomicInteger passes = new java.util.concurrent.atomic.AtomicInteger();
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                switch (passes.incrementAndGet()) {
                    // 1차: 글 목록 → 글 ID, 후속 1: 글 상세가 작성자 목록을 보여 줌 → 사용자 ID, 후속 2: 사용자 상세
                    case 1 -> fixture.observe("/api/posts/recent", "{\"posts\":[{\"id\":\"p1\"}]}");
                    case 2 -> fixture.observe("/api/users/recent", "{\"users\":[{\"id\":\"u1\"}]}");
                    default -> fixture.observe("/api/users/u1");
                }
                zapReply(exchange, "{\"scan\":\"" + (1 + passes.get()) + "\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertEquals(3, passes.get(), "글 상세가 새 사용자 ID를 드러냈으므로 한 단계 더 들어간다");
            assertTrue(result.path("events").toString().contains("후속 패스 2"), result.toString());
        }
    }

    @Test
    void queryStartUrlsGetDistinctFragmentsSoZapKeepsOneNodePerObject() {
        assertEquals(List.of("https://a.test/shop", "https://a.test/post?post_id=A#flowscope-1",
                        "https://a.test/post?post_id=B#flowscope-2", "https://a.test/x?y=1#keep"),
                ZapCampaign.distinctClientMapUrls(List.of("https://a.test/shop", "https://a.test/post?post_id=A",
                        "https://a.test/post?post_id=B", "https://a.test/x?y=1#keep")));
    }

    @Test
    void theFollowUpPassIsSkippedWhenNoNewStartUrlsAppear() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            java.util.concurrent.atomic.AtomicInteger passes = new java.util.concurrent.atomic.AtomicInteger();
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                passes.incrementAndGet();
                fixture.observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertEquals(1, passes.get());
            assertTrue(result.path("events").toString().contains("후속 패스 생략"), result.toString());
        }
    }

    @Test
    void anOriginTargetGetsTheRootPathSoTheClientSpiderQueuesTheSeededRoutes() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            AtomicReference<String> url = new AtomicReference<>("");
            fixture.server.removeContext("/JSON/clientSpider/action/scan/");
            fixture.server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                url.set(FakeZap.query(exchange).get("url"));
                fixture.observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
            });

            // 화면 입력은 보통 끝 슬래시가 없다(실측 run target: http://127.0.0.1:8888).
            campaign.startDeterministicZapCampaign("https://fixture.example.test", List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED", result.path("status").asText(), result.toString());
            assertEquals(TARGET, url.get());
            assertEquals(TARGET, result.path("target").asText());
        }
        assertEquals("https://app.test/app", ZapCampaign.withRootPath("https://app.test/app"));
        assertEquals("https://app.test/?a=1", ZapCampaign.withRootPath("https://app.test?a=1"));
    }

    @Test
    void anOlderResetScriptThatIgnoresRoutesIsReportedAsAWarning() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.observeScript("/static/js/main.js", "jsx(Route, {path: \"/shop\", element: jsx(Shop, {})});");
            java.util.Map<String, String> vars = new java.util.concurrent.ConcurrentHashMap<>();
            for (String path : List.of("/JSON/script/action/setGlobalVar/", "/JSON/script/action/runStandAloneScript/",
                    "/JSON/script/view/globalVar/")) {
                fixture.server.removeContext(path);
            }
            FakeZap.registerClientMapReset(fixture.server, script -> { }, vars);
            fixture.server.removeContext("/JSON/script/action/runStandAloneScript/");
            fixture.server.createContext("/JSON/script/action/runStandAloneScript/", exchange -> {
                vars.put("flowscope.clientMap.cleared", vars.get("flowscope.clientMap.request"));
                zapReply(exchange, "{\"Result\":\"OK\"}");
            });

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED_WITH_WARNINGS", result.path("status").asText(), result.toString());
            assertTrue(result.at("/lanes/0/warning").asText().contains("클라이언트 라우트 시작 주소 미등록"), result.toString());
        }
    }

    @Test
    void anUnconfirmedClientMapResetIsAWarningAndTheClientSpiderStillRuns() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            // 옛 start-zap.sh로 띄운 ZAP: 스크립트가 등록돼 있지 않다.
            fixture.server.removeContext("/JSON/script/action/runStandAloneScript/");
            fixture.server.createContext("/JSON/script/action/runStandAloneScript/", exchange -> zapReply(exchange,
                    "{\"code\":\"does_not_exist\",\"message\":\"Does Not Exist\"}"));

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED_WITH_WARNINGS", result.path("status").asText(), result.toString());
            assertEquals(1, result.at("/lanes/0/client_captures").asInt(), "the Client Spider still runs");
            assertTrue(result.at("/lanes/0/warning").asText().contains("Client Map 초기화 생략"), result.toString());
        }
    }

    @Test
    void aFailedTraditionalSpiderIsAWarningNotALaneFailure() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.server.removeContext("/JSON/spider/action/scan/");
            fixture.server.createContext("/JSON/spider/action/scan/", exchange -> zapReply(exchange,
                    "{\"code\":\"bad_view\",\"message\":\"spider unavailable\"}"));

            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode result = awaitTerminal(campaign);

            assertEquals("COMPLETED_WITH_WARNINGS", result.path("status").asText(), result.toString());
            assertEquals(1, result.at("/lanes/0/client_captures").asInt(), "the Client Spider result is kept");
            assertTrue(result.at("/lanes/0/warning").asText().contains("일반 Spider 생략"), result.toString());
        }
    }

    @Test
    void theSpiderExclusionKeepsSessionEndingAndDeletingLinksOut() {
        java.util.regex.Pattern exclude = java.util.regex.Pattern.compile(ZapCampaign.SPIDER_EXCLUDE_REGEX);
        for (String url : List.of("https://app.test/logout", "https://app.test/users/sign-out?next=/",
                "https://app.test/api/v1/posts/7/delete", "https://app.test/LogOff")) {
            assertTrue(exclude.matcher(url).matches(), url);
        }
        for (String url : List.of("https://app.test/api/v1/posts", "https://app.test/login",
                "https://app.test/search?q=logout")) {
            assertFalse(exclude.matcher(url).matches(), url);
        }
    }

    private static void await(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(10);
        assertTrue(condition.getAsBoolean(), "condition did not become true within five seconds");
    }


    @Test
    void refusesToStartWhenTheBurpScannerListenerIsClosed() throws Exception {
        try (Fixture fixture = new Fixture(false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.listenerOpen = false;
            String message = assertThrows(IllegalStateException.class,
                    () -> campaign.startDeterministicZapCampaign(TARGET, List.of(), true)).getMessage();
            assertTrue(message.contains("127.0.0.1:8081 is closed"), message);
            assertTrue(message.contains("host.docker.internal:8081"), message);
            assertEquals(1, fixture.started.getCount(), "a closed listener must fail before any crawler starts");
        }
    }

    @Test
    void explainsZeroCaptureAsTrafficThatNeverReachedBurpWhenZapRecordedMessages() throws Exception {
        try (Fixture fixture = new Fixture(false, false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.zapMessages("7");
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode terminal = awaitTerminal(campaign);
            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            String error = terminal.path("error").asText();
            assertTrue(error.contains("ZAP recorded 7 message(s)"), error);
            assertTrue(error.contains("none reached Burp SCANNER 127.0.0.1:8081"), error);
        }
    }

    @Test
    void explainsZeroCaptureAsAnEmptyCrawlWhenZapRecordedNothing() throws Exception {
        try (Fixture fixture = new Fixture(false, false);
             ZapCampaign campaign = new ZapCampaign(fixture)) {
            fixture.zapMessages("0");
            campaign.startDeterministicZapCampaign(TARGET, List.of(), true);
            JsonNode terminal = awaitTerminal(campaign);
            assertEquals("FAILED", terminal.path("status").asText(), terminal.toString());
            String error = terminal.path("error").asText();
            assertTrue(error.contains("ZAP recorded no messages"), error);
            assertTrue(error.contains("crawler produced nothing"), error);
        }
    }

    @Test
    void loopbackListenerProbeReportsOpenAndClosedPorts() throws Exception {
        try (java.net.ServerSocket listener = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            int open = listener.getLocalPort();
            assertTrue(ZapCampaign.loopbackListenerOpen(open, java.time.Duration.ofSeconds(2)));
            listener.close();
            assertTrue(!ZapCampaign.loopbackListenerOpen(open, java.time.Duration.ofMillis(500)),
                    "a closed port must not report an open listener");
        }
    }

    private static final class Fixture implements ZapCampaign.State, AutoCloseable {
        private final HttpServer server;
        private final ZapClient client;
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final ZapAccountVault accounts = new ZapAccountVault();
        private final List<RequestRecord> records = new CopyOnWriteArrayList<>();
        private final CountDownLatch started = new CountDownLatch(1);
        private final AtomicBoolean stopped = new AtomicBoolean();
        private final AtomicReference<String> capabilityRun = new AtomicReference<>("");
        private volatile boolean allowSessionPromotion = true;
        private volatile String promotedAccountId = "";
        private volatile long promotedEvidenceRuntimeId = -1;

        Fixture(boolean blockClient) throws IOException { this(blockClient, true); }

        Fixture(boolean blockClient, boolean capture) throws IOException {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            registerSafeZapEnvironment(server, 0);
            server.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
            server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                if (capture) observe("/client");
                zapReply(exchange, "{\"scan\":\"2\"}");
                started.countDown();
            });
            server.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                    blockClient && !stopped.get() ? "{\"status\":\"0\"}" : "{\"status\":\"100\"}"));
            server.createContext("/JSON/clientSpider/action/stop/", exchange -> {
                stopped.set(true);
                zapReply(exchange, "{\"Result\":\"OK\"}");
            });
            server.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange, "{\"recordsToScan\":\"0\"}"));
            server.start();
            client = new ZapClient("http://127.0.0.1:" + server.getAddress().getPort(), "");
        }

        private void holdCleanup(CountDownLatch entered, CountDownLatch release) {
            AtomicBoolean first = new AtomicBoolean(true);
            server.removeContext("/JSON/replacer/action/removeRule/");
            server.createContext("/JSON/replacer/action/removeRule/", exchange -> {
                if (first.compareAndSet(true, false)) {
                    entered.countDown();
                    awaitRelease(release);
                }
                zapReply(exchange, "{\"Result\":\"OK\"}");
            });
        }

        private static void awaitRelease(CountDownLatch release) throws IOException {
            try {
                if (!release.await(10, TimeUnit.SECONDS)) throw new IOException("test barrier was not released");
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException(error);
            }
        }

        private void observe(String path) {
            observe(path, "{\"ok\":true}");
        }

        private void observe(String path, String json) {
            RunContextRegistry.Context current = contexts.current(Source.SCANNER);
            RequestRecord record = new RequestRecord(Source.SCANNER, "https://fixture.example.test:443",
                    "GET", path, 200, "anon");
            record.hasResponse = true;
            record.body = json;
            record.responseContentType = "application/json";
            record.sourceDetail = current.detail();
            record.orchestrator = current.orchestrator();
            record.tool = current.tool();
            record.phase = current.phase();
            record.runId = current.runId();
            record.executionTrust = ExecutionTrust.CONTROLLED;
            records.add(record);
        }

        /** 이전 탐색에서 이미 받아 둔 범위 안 스크립트 응답. 캠페인은 이 기록만 읽고 요청을 새로 보내지 않는다. */
        private void observeScript(String path, String script) {
            RequestRecord record = new RequestRecord(Source.HUMAN, "https://fixture.example.test:443",
                    "GET", path, 200, "anon");
            record.hasResponse = true;
            record.body = script;
            record.responseContentType = "application/javascript";
            records.add(record);
        }

        private void addAuthenticatedAccount(String id) {
            accounts.save(new ZapAccountVault.Input(id, "User A", "USER", TARGET,
                    TARGET + "login", "user-a@example.test", "secret-password",
                    "Signed in", "Sign in"));
        }

        private void addInjectedAccount(String id, String cookie, String headers) {
            addInjectedAccount(id, cookie, headers, "");
        }

        private void addInjectedAccount(String id, String cookie, String headers, String verifyUrl) {
            accounts.save(new ZapAccountVault.Input(id, "Injected", "USER", TARGET,
                    "", "", "", cookie, headers, "INJECT", "", "", verifyUrl));
        }

        @Override public Pipeline.Result snapshot() { return Pipeline.run(List.copyOf(records)); }
        @Override public ScopePolicy scope() { return ScopePolicy.parse(TARGET); }
        @Override public ZapClient zap() { return client; }
        @Override public ZapAccountVault zapAccounts() { return accounts; }
        @Override public List<RequestRecord> authenticationEvidence(String runId, String accountId) {
            RequestRecord record = new RequestRecord(Source.SCANNER, "https://fixture.example.test:443",
                    "POST", "/login", 200, "session:verified");
            record.hasResponse = true;
            record.body = "Signed in";
            record.responseContentType = "text/html";
            record.sourceDetail = SourceDetail.ZAP_AUTHENTICATION;
            record.orchestrator = Orchestrator.SYSTEM;
            record.tool = ToolKind.ZAP;
            record.phase = RunPhase.EXPLORATION;
            record.runId = runId;
            record.laneAccountId = accountId;
            record.executionTrust = ExecutionTrust.CONTROLLED;
            records.add(record);
            return List.of(record);
        }
        @Override public boolean promoteAuthenticatedSession(String accountId, long evidenceRuntimeId) {
            promotedAccountId = accountId;
            promotedEvidenceRuntimeId = evidenceRuntimeId;
            return allowSessionPromotion;
        }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public boolean approve(String action, String target) { return false; }
        private volatile boolean listenerOpen = true;
        @Override public boolean scannerListenerOpen() { return listenerOpen; }
        /** ZAP core view numberOfMessages를 고정값으로 응답하게 한다(0건 실패 원인 구분 테스트용). */
        private void zapMessages(String count) {
            server.createContext("/JSON/core/view/numberOfMessages/", exchange -> zapReply(exchange, "{\"numberOfMessages\":\"" + count + "\"}"));
        }
        @Override public void scannerCapability(String runId, String capability) { capabilityRun.set(runId); }
        @Override public void clearScannerCapability(String runId) { capabilityRun.compareAndSet(runId, ""); }
        @Override public void close() { accounts.close(); server.stop(0); }
    }
}
