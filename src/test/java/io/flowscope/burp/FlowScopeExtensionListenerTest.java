package io.flowscope.burp;

import io.flowscope.core.Orchestrator;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import io.flowscope.core.ToolKind;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlowScopeExtensionListenerTest {
    private static final ScopePolicy SCOPE = ScopePolicy.parse("https://example.test/");
    private static final Map<Integer, FlowScopeExtension.PortProfile> PORTS = Map.of(
            8080, new FlowScopeExtension.PortProfile(Source.HUMAN, SourceDetail.BROWSER),
            8081, new FlowScopeExtension.PortProfile(Source.SCANNER, SourceDetail.OTHER_SCANNER),
            8082, new FlowScopeExtension.PortProfile(Source.LLM, SourceDetail.LLM_EXPLORER));

    private static RunContextRegistry.Context human(String runId) {
        return new RunContextRegistry.Context(SourceDetail.BROWSER, Orchestrator.HUMAN,
                ToolKind.BROWSER, RunPhase.EXPLORATION, runId, null);
    }

    @Test
    void activeHumanPassClaimsTheActualUnmappedBrowserListener() {
        var listeners = new FlowScopeExtension.HumanListenerBinding(PORTS);

        assertEquals(Source.UNKNOWN, listeners.resolve("127.0.0.1:8888",
                "https://example.test/api/orders", SCOPE, null).source());
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:8888",
                "https://example.test/api/orders", SCOPE, human("human-1")).source());
        assertEquals(8888, listeners.boundPort("human-1"));
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:8888",
                "https://example.test/api/orders/2", SCOPE, human("human-1")).source());
    }

    @Test
    void anotherListenerOrOutOfScopeRequestCannotTakeTheHumanRun() {
        var listeners = new FlowScopeExtension.HumanListenerBinding(PORTS);

        assertEquals(Source.UNKNOWN, listeners.resolve("127.0.0.1:8888",
                "https://other.test/api", SCOPE, human("human-1")).source());
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:8888",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(Source.UNKNOWN, listeners.resolve("127.0.0.1:9999",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(1, listeners.otherPortCount("human-1"));
        assertEquals(9999, listeners.otherPort("human-1"));
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:8080",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(8888, listeners.boundPort("human-1"));
    }

    @Test
    void configuredScannerAndLlmListenersKeepTheirOwnSources() {
        var listeners = new FlowScopeExtension.HumanListenerBinding(PORTS);

        assertEquals(Source.SCANNER, listeners.resolve("127.0.0.1:8081",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(Source.LLM, listeners.resolve("127.0.0.1:8082",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(-1, listeners.boundPort("human-1"));
    }

    @Test
    void aNewHumanRunCanBindAChangedBrowserListener() {
        var listeners = new FlowScopeExtension.HumanListenerBinding(PORTS);

        listeners.resolve("127.0.0.1:8888", "https://example.test/api", SCOPE, human("human-1"));
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:9999",
                "https://example.test/api", SCOPE, human("human-2")).source());
        assertEquals(9999, listeners.boundPort("human-2"));
        assertEquals(-1, listeners.boundPort("human-1"));
    }

    @Test
    void reusingAnOperatorRunIdStartsWithNoInheritedListener() {
        var listeners = new FlowScopeExtension.HumanListenerBinding(PORTS);
        listeners.start("human-1");
        listeners.resolve("127.0.0.1:8888", "https://example.test/api", SCOPE, human("human-1"));

        listeners.start("human-1");

        assertEquals(-1, listeners.boundPort("human-1"));
        assertEquals(Source.HUMAN, listeners.resolve("127.0.0.1:9999",
                "https://example.test/api", SCOPE, human("human-1")).source());
        assertEquals(9999, listeners.boundPort("human-1"));
    }
}
