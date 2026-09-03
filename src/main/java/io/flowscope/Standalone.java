package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.HarParser;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.SampleProject;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.ValidationDecision;
import io.flowscope.integration.McpServer;
import io.flowscope.web.FlowScopeWebServer;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;

import java.awt.Desktop;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;

/** Burp 없이 같은 Web UI를 확인하는 로컬 데모. 네트워크 대상 요청은 만들지 않는다. */
public final class Standalone {
    public static void main(String[] args) throws Exception {
        DemoState state = new DemoState(args);
        try (FlowScopeWebServer server = new FlowScopeWebServer(state,
                Integer.getInteger("flowscope.web.port", 17777))) {
            server.start();
            System.out.println("FlowScope Web UI: " + server.url());
            if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(URI.create(server.url()));
            new CountDownLatch(1).await();
        }
    }

    private static final class DemoState implements FlowScopeWebServer.State {
        private final AnalysisConfig config = new AnalysisConfig();
        private final List<RequestRecord> records = new ArrayList<>();
        private final AtomicLong revision = new AtomicLong();
        private final RunContextRegistry contexts = new RunContextRegistry();
        private volatile Pipeline.Result result;
        private volatile List<RouteCandidate> routeCandidates = List.of();

        DemoState(String[] args) throws Exception {
            if (args.length >= 2) {
                records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[0])), Source.HUMAN));
                records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[1])), Source.SCANNER));
                if (args.length >= 3) records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[2])), Source.LLM));
            } else {
                replaceWithSample();
            }
            rebuild();
        }

        @Override public Pipeline.Result snapshot() { return result; }
        @Override public long revision() { return revision.get(); }
        @Override public AnalysisConfig config() { return config; }
        @Override public List<McpServer.Assessment> assessments() { return List.of(); }
        @Override public List<ValidationDecision> validations() { return List.of(); }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
        @Override public void rebuild() {
            result = Pipeline.runIsolated(new ArrayList<>(records), config);
            String services = result.records.stream().map(record -> record.service + "/")
                    .distinct().collect(java.util.stream.Collectors.joining("\n"));
            routeCandidates = services.isBlank() ? List.of() : RouteCandidateExtractor.extract(
                    result.records, ScopePolicy.parse(services), List.of());
            revision.incrementAndGet();
        }
        @Override public void clearTraffic() { records.clear(); JavascriptCallSiteAnalyzer.clearCache(); rebuild(); }
        @Override public void loadSample() { replaceWithSample(); JavascriptCallSiteAnalyzer.clearCache(); rebuild(); }
        @Override public BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
            BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
            records.addAll(parsed.records);
            rebuild();
            return parsed;
        }
        @Override public BurpXmlParser.ParseResult importHar(byte[] har) {
            BurpXmlParser.ParseResult parsed = HarParser.parseDetailed(har);
            records.addAll(parsed.records);
            rebuild();
            return parsed;
        }
        @Override public RequestRecord openInRepeater(String evidenceId) {
            throw new IllegalStateException("Repeater 초안은 Burp Extension에서만 열 수 있습니다.");
        }

        private void replaceWithSample() {
            SampleProject.Data sample = SampleProject.create();
            records.clear();
            records.addAll(sample.records());
            config.replaceWith(sample.config());
        }
    }
}
