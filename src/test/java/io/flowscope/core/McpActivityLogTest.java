package io.flowscope.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class McpActivityLogTest {
    @Test
    void typedLinksRemainAttachedToTheirActivityAndResetForTheNextRun() {
        McpActivityLog log = new McpActivityLog();
        log.record("resend", "GET 재전송", false, null, "ev-2");
        log.record("verdict", "취약 판정", true, "llm:order", null);
        assertEquals("ev-2", log.entriesAfter(0).get(0).evidenceId());
        assertEquals("llm:order", log.entriesAfter(0).get(1).findingId());
        assertNull(log.entriesAfter(0).get(1).evidenceId());
        log.reset();
        assertEquals(0, log.entriesAfter(0).size());
    }
}
