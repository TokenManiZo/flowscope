package io.flowscope.explorer;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class McpVerificationOutputTest {
    @Test
    void extractsOnlyCompletedAgentAnswer() {
        assertEquals("근거를 확인했습니다.", McpVerificationRunner.agentMessage(
                "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"근거를 확인했습니다.\"}}"));
        assertEquals("", McpVerificationRunner.agentMessage(
                "{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"text\":\"ignore\"}}"));
        assertEquals("", McpVerificationRunner.agentMessage("diagnostic output"));
    }
}
