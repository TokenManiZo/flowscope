package io.flowscope;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class RetiredHarnessTest {
    @Test
    void retiredExecutorsAndTransportAreNotShipped() {
        for (String name : new String[]{"McpServer", "LocalMcpToken", "LocalLlmRunner", "ControlledBrowserExplorer"}) {
            assertThrows(ClassNotFoundException.class,
                    () -> Class.forName("io.flowscope.integration." + name), name);
        }
        for (String resource : new String[]{"/agent-workspace/AGENTS.md",
                "/agent-workspace/prompts/judge.md", "/agent-workspace/prompts/explorer.md"}) {
            assertNull(getClass().getResource(resource), resource);
        }
    }
}
