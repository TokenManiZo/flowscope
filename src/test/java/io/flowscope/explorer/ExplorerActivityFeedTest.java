package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The feed keeps only the most recent entries, so every uninformative line it holds is an informative one it has
 * dropped. Codex reports each tool call twice and names neither the tool nor the URL in either report.
 */
final class ExplorerActivityFeedTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode frame(String json) {
        try { return JSON.readTree(json); }
        catch (Exception error) { throw new AssertionError(error); }
    }

    @Test
    void toolCallStartAndSuccessAreNotActivities() {
        assertNull(CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/started\",\"params\":{\"item\":{\"type\":\"dynamicToolCall\"}}}")));
        assertNull(CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/started\",\"params\":{\"item\":{\"type\":\"commandExecution\"}}}")));
        assertNull(CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"dynamicToolCall\","
                        + "\"status\":\"completed\",\"durationMs\":4}}}")));
    }

    /**
     * Codex's own failure report names neither the tool nor the reason, so it read as "도구 처리 failed" and
     * nothing else. The useful line is written where both are known, not here.
     */
    @Test
    void codexOwnToolCallReportsAreNotActivitiesAtAll() {
        assertNull(CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"dynamicToolCall\","
                        + "\"status\":\"failed\",\"durationMs\":12}}}")));
    }

    /** Sandbox analysis never reaches the gateway, so dropping it would lose the only record of it. */
    @Test
    void sandboxAnalysisIsKeptBecauseNothingElseRecordsIt() {
        ExplorerProvider.Activity done = CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"commandExecution\","
                        + "\"status\":\"completed\",\"durationMs\":30}}}"));
        assertNotNull(done);
        assertEquals("응답 산출물 분석", done.title());
        assertEquals("COMPLETED", done.status());
    }

    @Test
    void turnStartModelNotesWarningsAndErrorsAreKept() {
        assertEquals("SYSTEM", CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"turn/started\",\"params\":{}}")).kind());
        assertEquals("MODEL", CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"agentMessage\","
                        + "\"text\":\"요약\"}}}")).kind());
        assertEquals("WARNING", CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"warning\",\"params\":{\"message\":\"hook timeout\"}}")).kind());
        assertEquals("ERROR", CodexAppServerProvider.activityFor(frame(
                "{\"method\":\"error\",\"params\":{\"error\":{\"message\":\"boom\"}}}")).kind());
    }

    /** One HTTP request used to produce three lines; only the gateway's own entry carries anything. */
    @Test
    void oneToolCallNoLongerCostsTheFeedThreeLines() {
        int kept = 0;
        for (String event : new String[]{
                "{\"method\":\"item/started\",\"params\":{\"item\":{\"type\":\"dynamicToolCall\"}}}",
                "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"dynamicToolCall\","
                        + "\"status\":\"completed\",\"durationMs\":4}}}"}) {
            if (CodexAppServerProvider.activityFor(frame(event)) != null) kept++;
        }
        assertEquals(0, kept);
    }
}
