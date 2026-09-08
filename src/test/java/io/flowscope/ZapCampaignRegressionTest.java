package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import io.flowscope.integration.ZapAccountVault;
import io.flowscope.integration.ZapClient;
import io.flowscope.integration.ZapCampaign;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.*;
import static io.flowscope.FakeZap.*;
import static org.junit.jupiter.api.Assertions.*;

/** 기존 MCP 테스트에서 옮긴 캠페인 회귀. API mock은 실물 크롤러 검증을 대신하지 않는다. */
final class ZapCampaignRegressionTest {
    private ZapCampaign server;
    @AfterEach void stop() { if (server != null) server.close(); }

    private static void restoreProperty(String name, String value) {
        if (value == null) System.clearProperty(name);
        else System.setProperty(name, value);
    }

    private JsonNode startBaseline(String input) throws Exception {
        JsonNode args = new ObjectMapper().readTree(input);
        List<String> accounts = new ArrayList<>();
        args.path("account_ids").forEach(value -> accounts.add(value.asText()));
        List<ZapCampaign.ZapDefinition> definitions = new ArrayList<>();
        args.path("definitions").forEach(value -> definitions.add(new ZapCampaign.ZapDefinition(
                ZapCampaign.ZapDefinitionType.valueOf(value.path("type").asText()),
                value.path("url").asText(), value.path("endpoint").asText())));
        return server.startDeterministicZapCampaign(args.path("target").asText(), accounts,
                args.path("include_anonymous").asBoolean(accounts.isEmpty()), definitions);
    }

    @Test
    void authenticatedLaneRejectsDiskBackedZapBeforeSendingCredentials() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        ZapAccountVault accounts = new ZapAccountVault();
        accounts.save(new ZapAccountVault.Input("zap-user-a", "USER A", "USER", target,
                target + "login", "user-a@example.test", "password-a"));
        AtomicBoolean credentialsSent = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.removeContext("/JSON/core/view/zapHomePath/");
        zapServer.createContext("/JSON/core/view/zapHomePath/", exchange -> zapReply(exchange,
                "{\"zapHomePath\":\"/home/zap/.ZAP/\"}"));
        zapServer.removeContext("/JSON/users/action/setAuthenticationCredentials/");
        zapServer.createContext("/JSON/users/action/setAuthenticationCredentials/", exchange -> {
            credentialsSent.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public ZapAccountVault zapAccounts() { return accounts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            IllegalStateException error = assertThrows(IllegalStateException.class,
                    () -> server.startDeterministicZapCampaign(target, List.of("zap-user-a"), false));

            assertTrue(error.getMessage().contains("Docker Chromium runtime"), error.getMessage());
            assertFalse(credentialsSent.get());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            accounts.close();
            zapServer.stop(0);
        }
    }

    @Test
    void anonymousLaneAlsoRequiresTheManagedChromiumRuntime() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.removeContext("/JSON/core/view/zapHomePath/");
        zapServer.createContext("/JSON/core/view/zapHomePath/", exchange -> zapReply(exchange,
                "{\"zapHomePath\":\"/home/zap/.ZAP/\"}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            IllegalStateException error = assertThrows(IllegalStateException.class,
                    () -> server.startDeterministicZapCampaign(target, List.of(), true));

            assertTrue(error.getMessage().contains("Docker Chromium runtime"), error.getMessage());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void immediateCancellationDoesNotLeaveTheCampaignPermanentlyLocked() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            server.startDeterministicZapCampaign(target, List.of(), true);
            assertEquals("CANCELLED", server.cancelDeterministicZapBaseline().path("status").asText());

            JsonNode restarted = null;
            for (int attempt = 0; attempt < 100 && restarted == null; attempt++) {
                try {
                    restarted = server.startDeterministicZapCampaign(target, List.of(), true);
                } catch (IllegalStateException error) {
                    assertTrue(error.getMessage().contains("cleanup is still running"), error.getMessage());
                    Thread.sleep(10);
                }
            }
            assertNotNull(restarted, "cancelled task must eventually release the workflow lifecycle gate");
            assertEquals("RUNNING", restarted.path("status").asText());
            server.cancelDeterministicZapBaseline();
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void cancellingZapBaselineStopsOwnedCrawlerClearsCapabilityAndAbortsRun() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicBoolean clientStarted = new AtomicBoolean();
        AtomicBoolean clientStopped = new AtomicBoolean();
        AtomicReference<String> capabilityRun = new AtomicReference<>("");
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientStarted.set(true);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> {
            zapReply(exchange, clientStopped.get() ? "{\"status\":\"100\"}" : "{\"status\":\"0\"}");
        });
        zapServer.createContext("/JSON/clientSpider/action/stop/", exchange -> {
            clientStopped.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
                @Override public void scannerCapability(String runId, String capability) {
                    capabilityRun.set(runId);
                }
                @Override public void clearScannerCapability(String runId) {
                    capabilityRun.compareAndSet(runId, "");
                }
            });

            JsonNode started = server.startDeterministicZapCampaign(target, List.of(), true);
            assertEquals("RUNNING", started.path("status").asText());
            for (int i = 0; i < 100 && !clientStarted.get(); i++) Thread.sleep(10);
            assertTrue(clientStarted.get());

            JsonNode cancelled = server.cancelDeterministicZapBaseline();

            assertEquals("CANCELLED", cancelled.path("status").asText(), cancelled.toString());
            assertTrue(clientStopped.get());
            assertEquals("", capabilityRun.get());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void zapCampaignFailsFastWhenBurpRejectsMissingRunCapability() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong rejected = new AtomicLong();
        AtomicBoolean clientStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientStarted.set(true);
            rejected.incrementAndGet();
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/stop/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
                @Override public long scannerCapabilityRejections(String runId) {
                    return rejected.get();
                }
            });

            server.startDeterministicZapCampaign(target, List.of(), true);
            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.path("status").asText())) break;
                Thread.sleep(10);
            }

            assertNotNull(status);
            assertEquals("FAILED", status.path("status").asText(), status.toString());
            assertEquals(1, status.path("capability_rejected_requests").asLong());
            assertTrue(status.path("error").asText().contains("run capability"), status.toString());
            assertTrue(clientStarted.get(), "the Client Spider request must trigger the capability rejection");
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void zapSessionSetupPublishesWorkerHeartbeatWhileApiResponseIsPending() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicBoolean sessionRequestStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> {
            sessionRequestStarted.set(true);
            try { Thread.sleep(1_400); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> zapReply(exchange,
                "{\"scan\":\"1\"}"));
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"100\"}"));
        zapServer.start();
        String previousHeartbeat = System.getProperty("flowscope.zap.workerHeartbeat.ms");
        try {
            System.setProperty("flowscope.zap.workerHeartbeat.ms", "20");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            server.startDeterministicZapCampaign(target, List.of(), true);
            for (int i = 0; i < 100 && !sessionRequestStarted.get(); i++) Thread.sleep(5);
            assertTrue(sessionRequestStarted.get());
            Thread.sleep(1_150);

            JsonNode status = server.deterministicZapBaselineStatus();
            assertEquals("RUNNING", status.path("status").asText(), status.toString());
            assertEquals("SESSION_SETUP", status.at("/lanes/0/stage").asText());
            assertEquals(0, status.path("last_heartbeat_age_seconds").asLong());
            assertTrue(status.path("heartbeat_status").asText().contains("응답 대기"), status.toString());
            assertEquals("WAITING_FOR_ZAP_RESPONSE", status.path("activity_state").asText());
        } finally {
            restoreProperty("flowscope.zap.workerHeartbeat.ms", previousHeartbeat);
            zapServer.stop(0);
        }
    }

    @Test
    void deterministicZapBaselineImportsExplicitDefinitionRunsOnlyClientSpiderAndPublishesAlerts() throws Exception {
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        Pipeline.Result initial = Pipeline.run(records.get());
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human", initial);
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm", initial);
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 501);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        AtomicReference<String> definitionQuery = new AtomicReference<>();
        zapServer.createContext("/JSON/openapi/action/importUrl/", exchange -> {
            definitionQuery.set(exchange.getRequestURI().getRawQuery());
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        AtomicBoolean traditionalStarted = new AtomicBoolean();
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            traditionalStarted.set(true);
            zapReply(exchange, "{\"scan\":\"unexpected\"}");
        });
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            zapReply(exchange, "{\"Result\":\"unexpected\"}");
        });
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            zapReply(exchange, query != null && query.contains("start=500")
                    ? zapAlertsPage(500, 1) : zapAlertsPage(0, 500));
        });
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse("http://127.0.0.1:8888/"); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String target) {
                    return action.contains("API 정의");
                }
            });

            JsonNode started = startBaseline(
                    "{\"target\":\"http://127.0.0.1:8888/\",\"run_id\":\"zap-baseline-1\","
                            + "\"definitions\":[{\"type\":\"OPENAPI\","
                            + "\"url\":\"http://127.0.0.1:8888/openapi.json\"}]}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED", status.at("/status").asText(), status.toString());
            assertEquals("ALERTS_READY", status.at("/stage").asText());
            assertEquals(1, status.at("/definition_count").asInt());
            assertEquals(1, status.at("/lanes/0/definition_imports").asInt());
            assertTrue(definitionQuery.get().contains("contextId="));
            assertEquals(501, status.at("/alert_count").asInt());
            assertEquals(1, status.at("/lanes/0/client_captures").asInt());
            assertFalse(traditionalStarted.get(), "Traditional Spider must not be used by the Client-only campaign");
            assertFalse(ajaxStarted.get(), "AJAX Spider must not be used by the Client-only campaign");
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertFalse(status.toString().contains("raw-alert-secret"));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void deterministicZapBaselineFailsWhenTheOnlyCrawlerCapturesNoTraffic() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>(List.of(
                laneMarker(Source.HUMAN), laneMarker(Source.LLM))));
        Pipeline.Result initial = Pipeline.run(records.get());
        complete(contexts, Source.HUMAN, SourceDetail.BROWSER, "completed-human", initial);
        complete(contexts, Source.LLM, SourceDetail.LLM_EXPLORER, "completed-llm", initial);
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_AJAX_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"stopped\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"rendered warning alert\"}]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode started = startBaseline(
                    "{\"target\":\"" + target + "\",\"run_id\":\"client-zero-rendered\"}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertFalse(ajaxStarted.get(), status.toString());
            assertEquals("FAILED", status.at("/status").asText(), status.toString());
            assertEquals(0, status.at("/lanes/0/client_captures").asInt());
            assertTrue(status.at("/error").asText().contains("Client Spider completed without captured"));
            assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void passiveQueueStallPreservesCapturedTrafficAndAlertsAsTransparentPartialCompletion() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean queueCleared = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/spider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"1\"}");
        });
        zapServer.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/ajaxSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":\"stopped\"}"));
        zapServer.removeContext("/JSON/pscan/view/currentTasks/");
        zapServer.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                queueCleared.get() ? "{\"currentTasks\":[]}" : "{\"currentTasks\":[{\"name\":\"Slow rule\","
                        + "\"url\":\"http://127.0.0.1:8888/static/app.js\"}]}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                queueCleared.get() ? "{\"recordsToScan\":\"0\"}" : "{\"recordsToScan\":\"5\"}"));
        zapServer.removeContext("/JSON/pscan/action/clearQueue/");
        zapServer.createContext("/JSON/pscan/action/clearQueue/", exchange -> {
            queueCleared.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"partial alert\"}]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        String previousAbsolute = System.getProperty("flowscope.zap.passive.absolute.ms");
        String previousStall = System.getProperty("flowscope.zap.passive.stall.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            System.setProperty("flowscope.zap.passive.absolute.ms", "500");
            System.setProperty("flowscope.zap.passive.stall.ms", "100");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode started = startBaseline(
                    "{\"target\":\"" + target + "\",\"run_id\":\"passive-partial\"}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED_WITH_WARNINGS",
                    status.at("/status").asText(), status.toString());
            assertEquals(1, status.at("/captured_records").asInt());
            assertFalse(status.at("/lanes/0/passive_complete").asBoolean());
            assertEquals(5, status.at("/lanes/0/passive_remaining").asInt());
            assertEquals(1, status.at("/lanes/0/alert_count").asInt());
            assertFalse(status.at("/lanes/0/alert_snapshot_complete").asBoolean());
            assertTrue(status.at("/lanes/0/warning").asText().contains("미처리 5건"));
            JsonNode events = status.at("/events");
            assertTrue(events.isArray());
            assertTrue(events.toString().contains("Passive queue 5건 남음"));
            assertTrue(events.toString().contains("Passive queue와 실행 작업 격리 정리 완료"));
            assertTrue(queueCleared.get());
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            restoreProperty("flowscope.zap.passive.absolute.ms", previousAbsolute);
            restoreProperty("flowscope.zap.passive.stall.ms", previousStall);
            zapServer.stop(0);
        }
    }

    @Test
    void earlyLaneFailureBlocksTheNextIdentityWhenBackgroundCleanupCannotFinish() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicLong clientStarts = new AtomicLong();
        ZapAccountVault accounts = new ZapAccountVault();
        accounts.save(new ZapAccountVault.Input("zap-user-a", "USER A", "USER", target,
                target + "login", "user-a@example.test", "password-a"));

        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 1);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            clientStarts.incrementAndGet();
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            records.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"1\"}"));
        zapServer.removeContext("/JSON/pscan/view/currentTasks/");
        zapServer.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                "{\"currentTasks\":[{\"name\":\"Never ends\"}]}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange,
                "{\"alerts\":[{\"name\":\"partial alert\"}]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        String previousAbsolute = System.getProperty("flowscope.zap.passive.absolute.ms");
        String previousStall = System.getProperty("flowscope.zap.passive.stall.ms");
        String previousCleanup = System.getProperty("flowscope.zap.passive.cleanup.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            System.setProperty("flowscope.zap.passive.absolute.ms", "500");
            System.setProperty("flowscope.zap.passive.stall.ms", "100");
            System.setProperty("flowscope.zap.passive.cleanup.ms", "100");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public ZapAccountVault zapAccounts() { return accounts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode started = startBaseline( "{\"target\":\"" + target
                    + "\",\"run_id\":\"isolation-stop\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"zap-user-a\"]}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("FAILED", status.at("/status").asText(), status.toString());
            assertEquals("NOT_RUN", status.at("/lanes/1/status").asText());
            assertEquals("BLOCKED_BY_ISOLATION", status.at("/lanes/1/stage").asText());
            assertTrue(status.at("/events").toString()
                    .contains("Passive background 작업이 제한시간 안에 종료되지 않음"));
            assertTrue(status.at("/events").toString()
                    .contains("이전 신원 격리 실패로 실행하지 않음"));
            assertEquals(1, clientStarts.get(), "the account lane must not start with dirty passive work");
            assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            restoreProperty("flowscope.zap.passive.absolute.ms", previousAbsolute);
            restoreProperty("flowscope.zap.passive.stall.ms", previousStall);
            restoreProperty("flowscope.zap.passive.cleanup.ms", previousCleanup);
            zapServer.stop(0);
            accounts.close();
        }
    }

    @Test
    void failedClientSpiderIsStoppedAndDoesNotInvokeAnotherCrawler() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean clientStopped = new AtomicBoolean();
        AtomicBoolean ajaxStarted = new AtomicBoolean();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"2\"}"));
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> {
            if (clientStopped.get()) zapReply(exchange, "{\"status\":{\"state\":\"COMPLETED\"}}");
            else {
                byte[] body = "client failed".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            }
        });
        zapServer.createContext("/JSON/clientSpider/action/stop/", exchange -> {
            clientStopped.set(true);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/ajaxSpider/action/scan/", exchange -> {
            ajaxStarted.set(true);
            zapReply(exchange, "{\"Result\":\"unexpected\"}");
        });
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        String previousPoll = System.getProperty("flowscope.zap.poll.ms");
        try {
            System.setProperty("flowscope.zap.poll.ms", "10");
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode started = startBaseline(
                    "{\"target\":\"" + target + "\",\"run_id\":\"client-cleanup\"}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("FAILED",
                    status.at("/status").asText(), status.toString());
            assertTrue(clientStopped.get());
            assertFalse(ajaxStarted.get(), "a failed Client Spider must not invoke AJAX fallback");
        } finally {
            restoreProperty("flowscope.zap.poll.ms", previousPoll);
            zapServer.stop(0);
        }
    }

    @Test
    void scannerCompletionUsesRawCaptureCounterInsteadOfPossiblyStalePipelineSnapshot() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicLong rawCaptures = new AtomicLong();
        AtomicReference<List<RequestRecord>> rawRecords = new AtomicReference<>(new ArrayList<>());
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            rawCaptures.incrementAndGet();
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(rawRecords.get());
            copy.add(observation(Source.SCANNER, "anon", 200, "{}",
                    SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
            rawRecords.set(copy);
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public Pipeline.Result completionSnapshot() { return Pipeline.run(rawRecords.get()); }
                @Override public long capturedCount(Source source, String runId, SourceDetail detail) {
                    return source == Source.SCANNER && rawRecords.get().stream().anyMatch(record -> runId.equals(record.runId))
                            && (detail == null || detail == SourceDetail.ZAP_CLIENT_SPIDER) ? rawCaptures.get() : 0;
                }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode started = startBaseline(
                    "{\"target\":\"" + target + "\",\"run_id\":\"raw-gate\"}");

            JsonNode status = null;
            for (int i = 0; i < 100; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED", status.at("/status").asText(),
                    status.toString());
            assertEquals(1, status.at("/captured_records").asInt());
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void scannerCampaignResetsZapAndRunsAnonymousThenEachActiveAccount() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        AtomicReference<List<RequestRecord>> records = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<String>> seenAccounts = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<String>> zapSessions = new AtomicReference<>(new ArrayList<>());
        AtomicBoolean omitUserBTraffic = new AtomicBoolean(true);
        AtomicLong removedUsers = new AtomicLong();
        AtomicLong removedContexts = new AtomicLong();
        ZapAccountVault accounts = new ZapAccountVault();
        for (String accountId : List.of("zap-user-a", "zap-user-b")) {
            accounts.save(new ZapAccountVault.Input(accountId, accountId.toUpperCase(), "USER", target,
                    target + "login", accountId + "@example.test", "password-" + accountId));
        }

        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.removeContext("/JSON/users/action/authenticateAsUser/");
        zapServer.createContext("/JSON/users/action/authenticateAsUser/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            List<RequestRecord> copy = new ArrayList<>(records.get());
            copy.add(observationAt(Source.SCANNER, "anon", 200, "{\"authSuccessful\":true}",
                    context.detail(), RunPhase.SESSION_SETUP, context.runId(), "/api/auth/login"));
            records.set(copy);
            zapReply(exchange, "{\"authSuccessful\":true}");
        });
        zapServer.removeContext("/JSON/users/action/removeUser/");
        zapServer.createContext("/JSON/users/action/removeUser/", exchange -> {
            removedUsers.incrementAndGet();
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.removeContext("/JSON/context/action/removeContext/");
        zapServer.createContext("/JSON/context/action/removeContext/", exchange -> {
            removedContexts.incrementAndGet();
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/core/action/newSession/", exchange -> {
            List<String> copy = new ArrayList<>(zapSessions.get());
            copy.add(exchange.getRequestURI().getRawQuery());
            zapSessions.set(copy);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        zapServer.createContext("/JSON/clientSpider/action/scan/", exchange -> {
            RunContextRegistry.Context context = contexts.current(Source.SCANNER);
            String account = context.accountId() == null ? "anonymous" : context.accountId();
            List<String> seen = new ArrayList<>(seenAccounts.get());
            seen.add(account);
            seenAccounts.set(seen);
            if (!(omitUserBTraffic.get() && account.equals("zap-user-b"))) {
                List<RequestRecord> copy = new ArrayList<>(records.get());
                copy.add(observation(Source.SCANNER, account, 200, "{}",
                        SourceDetail.ZAP_CLIENT_SPIDER, RunPhase.EXPLORATION, context.runId()));
                records.set(copy);
            }
            zapReply(exchange, "{\"scan\":\"2\"}");
        });
        zapServer.createContext("/JSON/clientSpider/view/status/", exchange -> zapReply(exchange,
                "{\"status\":{\"state\":\"COMPLETED\"}}"));
        zapServer.createContext("/JSON/pscan/view/recordsToScan/", exchange -> zapReply(exchange,
                "{\"recordsToScan\":\"0\"}"));
        zapServer.createContext("/JSON/alert/view/alerts/", exchange -> zapReply(exchange, "{\"alerts\":[]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(records.get()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public ZapAccountVault zapAccounts() { return accounts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            JsonNode failedStart = startBaseline( "{\"target\":\"" + target
                    + "\",\"run_id\":\"campaign-1\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"zap-user-a\",\"zap-user-b\"]}");

            assertTrue(failedStart.at("/campaign_started_at").asLong() > 0);
            assertTrue(failedStart.at("/elapsed_seconds").asLong() >= 0);
            assertEquals(2, failedStart.at("/lanes/1/queue_position").asInt());
            assertEquals(3, failedStart.at("/lanes/1/queue_total").asInt());
            assertTrue(failedStart.at("/lanes/1/wait_reason").asText()
                    .contains("lane 완료 후 시작"));
            JsonNode failedStatus = null;
            for (int i = 0; i < 200; i++) {
                failedStatus = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(failedStatus.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(failedStatus);
            assertEquals("FAILED", failedStatus.at("/status").asText(),
                    failedStatus.toString());
            assertEquals("FAILED", failedStatus.at("/lanes/2/status").asText());
            assertEquals(List.of("anonymous", "zap-user-a", "zap-user-b"), seenAccounts.get());
            assertEquals(3, zapSessions.get().size());
            assertFalse(contexts.completedExplorations().contains(Source.SCANNER));
            assertNull(contexts.current(Source.SCANNER));

            omitUserBTraffic.set(false);
            seenAccounts.set(new ArrayList<>());
            JsonNode started = startBaseline( "{\"target\":\"" + target
                    + "\",\"run_id\":\"campaign-2\",\"include_anonymous\":true,"
                    + "\"account_ids\":[\"zap-user-a\",\"zap-user-b\"]}");

            JsonNode status = null;
            for (int i = 0; i < 200; i++) {
                status = server.deterministicZapBaselineStatus();
                if (!"RUNNING".equals(status.at("/status").asText())) break;
                Thread.sleep(10);
            }
            assertNotNull(status);
            assertEquals("COMPLETED", status.at("/status").asText(), status.toString());
            assertEquals(List.of("anonymous", "zap-user-a", "zap-user-b"), seenAccounts.get());
            assertEquals(6, zapSessions.get().size());
            assertEquals(4, removedUsers.get(), "each authenticated lane must delete its temporary ZAP user");
            assertEquals(6, removedContexts.get(), "every lane must delete its temporary ZAP context");
            assertEquals(3, status.at("/lanes").size());
            assertEquals("zap-user-b", status.at("/lanes/2/account_id").asText());
            assertEquals(3, status.at("/captured_records").asInt(),
                    "authentication setup traffic must not inflate scanner discovery captures");
            assertTrue(status.at("/lanes/0/elapsed_seconds").asLong() >= 0);
            assertTrue(status.at("/lanes/0/stage_timeout_seconds").asLong() >= 0);
            assertFalse(status.at("/lanes/0/heartbeat_status").asText().isBlank());
            assertTrue(contexts.completedExplorations().contains(Source.SCANNER));
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
            accounts.close();
        }
    }

    @Test
    void safeZapCampaignFailsBeforeActivationWhenRequiredPassiveOrDiscoveryAddonIsMissing() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        zapServer.createContext("/JSON/core/view/version/", exchange -> zapReply(exchange,
                "{\"version\":\"2.17.0\"}"));
        zapServer.createContext("/JSON/core/view/zapHomePath/", exchange -> zapReply(exchange,
                "{\"zapHomePath\":\"/run/flowscope-zap/test/home/\"}"));
        zapServer.createContext("/JSON/autoupdate/view/installedAddons/", exchange -> zapReply(exchange,
                "{\"installedAddons\":[{\"id\":\"spider\"}]}"));
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            Exception error = assertThrows(IllegalStateException.class, () -> startBaseline(
                    "{\"target\":\"" + target + "\",\"run_id\":\"missing-addons\"}"));
            assertTrue(error.getMessage().contains("missing required safe ZAP add-on"), error.getMessage());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void explicitApiDefinitionsNeedBurpApprovalBeforeScannerActivation() throws Exception {
        String target = "http://127.0.0.1:8888/";
        RunContextRegistry contexts = new RunContextRegistry();
        HttpServer zapServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        registerSafeZapEnvironment(zapServer, 0);
        zapServer.start();
        try {
            ZapClient zap = new ZapClient("http://127.0.0.1:" + zapServer.getAddress().getPort(), "");
            server = new ZapCampaign(new ZapCampaign.State() {
                @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
                @Override public ScopePolicy scope() { return ScopePolicy.parse(target); }
                @Override public ZapClient zap() { return zap; }
                @Override public RunContextRegistry contexts() { return contexts; }
                @Override public boolean approve(String action, String value) { return false; }
            });

            Exception error = assertThrows(IllegalStateException.class, () -> startBaseline( "{\"target\":\"" + target
                    + "\",\"definitions\":[{\"type\":\"OPENAPI\","
                    + "\"url\":\"http://127.0.0.1:8888/openapi.json\"}]}"));
            assertTrue(error.getMessage().contains("explicit Burp approval"), error.getMessage());
            assertNull(contexts.current(Source.SCANNER));
        } finally {
            zapServer.stop(0);
        }
    }

    @Test
    void refusesRemoteZapApi() {
        assertThrows(IllegalArgumentException.class,
                () -> new ZapClient("https://example.com:8089", ""));
    }


    private static RequestRecord observation(Source source, String fingerprint, int status, String body,
                                             SourceDetail detail, RunPhase phase, String runId) {
        return observationAt(source, fingerprint, status, body, detail, phase, runId, "/v1/orders/7");
    }

    private static RequestRecord observationAt(Source source, String fingerprint, int status, String body,
                                               SourceDetail detail, RunPhase phase, String runId, String path) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", path, status, fingerprint);
        record.body = body;
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.sourceDetail = detail;
        record.phase = phase;
        record.runId = runId;
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN;
        record.tool = source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER;
        record.executionTrust = source == Source.HUMAN
                ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        return record;
    }

    private static RequestRecord laneMarker(Source source) {
        SourceDetail detail = switch (source) {
            case HUMAN -> SourceDetail.BROWSER;
            case SCANNER -> SourceDetail.ZAP_CLIENT_SPIDER;
            case LLM -> SourceDetail.LLM_EXPLORER;
            default -> SourceDetail.UNKNOWN;
        };
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443",
                "GET", "/health-" + source.name().toLowerCase(), 200, "marker-" + source.name());
        record.body = "{\"ok\":true}";
        record.hasResponse = true;
        record.responseContentType = "application/json";
        record.sourceDetail = detail;
        record.phase = RunPhase.EXPLORATION;
        record.runId = "completed-" + source.name().toLowerCase();
        record.orchestrator = source == Source.LLM ? Orchestrator.LLM
                : source == Source.SCANNER ? Orchestrator.SYSTEM : Orchestrator.HUMAN;
        record.tool = source == Source.LLM ? ToolKind.CODEX
                : source == Source.SCANNER ? ToolKind.ZAP : ToolKind.BROWSER;
        record.executionTrust = source == Source.HUMAN ? ExecutionTrust.OBSERVED : ExecutionTrust.CONTROLLED;
        return record;
    }

    private static void complete(RunContextRegistry contexts, Source source, SourceDetail detail, String runId,
                                 Pipeline.Result snapshot) {
        contexts.activate(source, new RunContextRegistry.Context(detail,
                source == Source.LLM ? Orchestrator.LLM : Orchestrator.HUMAN,
                source == Source.SCANNER ? ToolKind.ZAP : source == Source.LLM ? ToolKind.CODEX : ToolKind.BROWSER,
                RunPhase.EXPLORATION, runId));
        assertNotNull(LaneCompletionPolicy.complete(contexts, source, runId, snapshot));
    }

    private static String zapAlertsPage(int start, int count) {
        StringBuilder value = new StringBuilder("{\"alerts\":[");
        for (int i = 0; i < count; i++) {
            if (i > 0) value.append(',');
            value.append("{\"name\":\"alert-").append(start + i)
                    .append("\",\"evidence\":\"token=raw-alert-secret\"}");
        }
        return value.append("]}").toString();
    }

}
