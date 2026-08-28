package io.flowscope.ui;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FlowScopeControlTabTest {
    @Test
    void masksBearerInVisibleStatusWithoutChangingNonSecretStatus() {
        String token = "not-a-real-token-" + "x".repeat(32);
        String visible = FlowScopeControlTab.maskMcpConnection(
                "http://127.0.0.1:8787/mcp · Bearer " + token);

        assertFalse(visible.contains(token));
        assertTrue(visible.contains("Bearer ••••••••"));
        assertEquals("비활성 — address in use", FlowScopeControlTab.maskMcpConnection("비활성 — address in use"));
    }
}
