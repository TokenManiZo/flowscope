package io.flowscope;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.*;
import io.flowscope.integration.ZapCampaign;
import io.flowscope.integration.ZapClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
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

    private static JsonNode awaitTerminal(ZapCampaign campaign) throws Exception {
        await(() -> !"RUNNING".equals(campaign.deterministicZapBaselineStatus().path("status").asText()));
        return campaign.deterministicZapBaselineStatus();
    }

    private static void await(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(10);
        assertTrue(condition.getAsBoolean(), "condition did not become true within five seconds");
    }


    private static final class Fixture implements ZapCampaign.State, AutoCloseable {
        private final HttpServer server;
        private final ZapClient client;
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final List<RequestRecord> records = new CopyOnWriteArrayList<>();
        private final CountDownLatch started = new CountDownLatch(1);
        private final AtomicBoolean stopped = new AtomicBoolean();
        private final AtomicReference<String> capabilityRun = new AtomicReference<>("");

        Fixture(boolean blockClient) throws IOException {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            registerSafeZapEnvironment(server, 0);
            server.createContext("/JSON/core/action/newSession/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
            server.createContext("/JSON/clientSpider/action/scan/", exchange -> {
                observe("/client");
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

        private void observe(String path) {
            RunContextRegistry.Context current = contexts.current(Source.SCANNER);
            RequestRecord record = new RequestRecord(Source.SCANNER, "https://fixture.example.test:443",
                    "GET", path, 200, "anon");
            record.hasResponse = true;
            record.body = "{\"ok\":true}";
            record.responseContentType = "application/json";
            record.sourceDetail = current.detail();
            record.orchestrator = current.orchestrator();
            record.tool = current.tool();
            record.phase = current.phase();
            record.runId = current.runId();
            record.executionTrust = ExecutionTrust.CONTROLLED;
            records.add(record);
        }

        @Override public Pipeline.Result snapshot() { return Pipeline.run(List.copyOf(records)); }
        @Override public ScopePolicy scope() { return ScopePolicy.parse(TARGET); }
        @Override public ZapClient zap() { return client; }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public boolean approve(String action, String target) { return false; }
        @Override public void scannerCapability(String runId, String capability) { capabilityRun.set(runId); }
        @Override public void clearScannerCapability(String runId) { capabilityRun.compareAndSet(runId, ""); }
        @Override public void close() { server.stop(0); }
    }
}
