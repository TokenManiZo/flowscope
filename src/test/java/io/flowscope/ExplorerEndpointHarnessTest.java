package io.flowscope;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 매 실행 새 포트의 실제 HTTP 응답으로 API-first frontier가 연쇄 확장되는지 검증한다. */
final class ExplorerEndpointHarnessTest {
    @Test
    void html에서_script와_object를_거쳐_api_frontier를_소진한다() throws Exception {
        HttpServer target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        target.createContext("/", exchange -> reply(exchange, "text/html", """
                <!doctype html><script src='/assets/app.js'></script>
                <a href='/dashboard'>dashboard</a>
                <a href='/orders/101?view=full'>order</a>
                <a href='https://outside.example/private'>outside</a>
                """));
        target.createContext("/assets/app.js", exchange -> reply(exchange, "application/javascript", """
                fetch('/api/profile');
                fetch('/api/orders/101');
                fetch('/api/orders', {method:'POST'});
                """));
        target.createContext("/dashboard", exchange -> reply(exchange, "text/html",
                "<script>fetch('/api/notices')</script>dashboard"));
        target.createContext("/orders/101", exchange -> reply(exchange, "application/json", "{\"id\":101}"));
        target.createContext("/api/profile", exchange -> reply(exchange, "application/json", "{\"userId\":7}"));
        target.createContext("/api/orders/101", exchange -> reply(exchange, "application/json", "{\"id\":101}"));
        target.createContext("/api/notices", exchange -> reply(exchange, "application/json", "[]"));
        target.createContext("/api/orders", exchange -> reply(exchange, "application/json", "[]"));
        target.start();
        try {
            String service = "http://127.0.0.1:" + target.getAddress().getPort();
            ScopePolicy scope = ScopePolicy.parse(service + "/");
            HttpClient client = HttpClient.newHttpClient();
            ArrayDeque<String> frontier = new ArrayDeque<>(List.of("/"));
            Set<String> queued = new LinkedHashSet<>(frontier);
            Set<String> requested = new LinkedHashSet<>();
            List<RequestRecord> records = new ArrayList<>();
            List<RouteCandidate> candidates = List.of();

            while (!frontier.isEmpty()) {
                String concrete = frontier.removeFirst();
                if (!requested.add(concrete)) continue;
                URI uri = URI.create(service + concrete);
                HttpResponse<String> response = client.send(HttpRequest.newBuilder(uri).GET().build(),
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                RequestRecord record = new RequestRecord(Source.LLM, service, "GET",
                        uri.getPath(), response.statusCode(), "anon");
                record.query = uri.getRawQuery();
                record.body = response.body();
                record.hasResponse = true;
                record.responseContentType = response.headers().firstValue("Content-Type").orElse("");
                record.sourceDetail = SourceDetail.LLM_EXPLORER;
                record.orchestrator = Orchestrator.LLM;
                record.tool = ToolKind.CODEX;
                record.phase = RunPhase.EXPLORATION;
                record.executionTrust = ExecutionTrust.CONTROLLED;
                record.runId = "no-cache-fixture";
                records.add(record);

                Pipeline.Result pipeline = Pipeline.run(records);
                candidates = RouteCandidateExtractor.extract(pipeline.records, scope, List.of());
                for (RouteCandidate candidate : candidates) {
                    if (!Set.of("GET", "HEAD", "OPTIONS", "UNKNOWN").contains(candidate.method())) continue;
                    for (String path : candidate.concretePaths()) {
                        if (queued.add(path)) frontier.addLast(path);
                    }
                }
            }

            assertTrue(requested.containsAll(Set.of("/", "/assets/app.js", "/dashboard",
                    "/orders/101?view=full", "/api/profile", "/api/orders/101", "/api/notices")),
                    requested.toString());
            assertFalse(requested.contains("/api/orders"), "관측한 POST를 묵시적으로 GET 실행하면 안 된다");
            assertTrue(candidates.stream().anyMatch(candidate -> candidate.method().equals("POST")
                    && candidate.pathTemplate().equals("/api/orders")));
            assertTrue(candidates.stream().noneMatch(candidate -> candidate.service().contains("outside.example")));
            assertEquals(requested.size(), records.size());
            assertTrue(records.stream().allMatch(record -> record.source == Source.LLM
                    && record.executionTrust == ExecutionTrust.CONTROLLED
                    && record.runId.equals("no-cache-fixture")));
        } finally {
            target.stop(0);
        }
    }

    private static void reply(HttpExchange exchange, String mediaType, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", mediaType + "; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
