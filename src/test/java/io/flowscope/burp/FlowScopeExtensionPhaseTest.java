package io.flowscope.burp;

import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlowScopeExtensionPhaseTest {
    @Test
    void HUMAN_로그인_캡처만_SESSION_SETUP으로_분리한다() {
        assertEquals(RunPhase.SESSION_SETUP,
                FlowScopeExtension.capturePhase(Source.HUMAN, SourceDetail.BROWSER, true));
        assertEquals(RunPhase.BASELINE,
                FlowScopeExtension.capturePhase(Source.HUMAN, SourceDetail.BROWSER, false));
    }

    @Test
    void 다른_source의_기존_phase는_바꾸지_않는다() {
        assertEquals(RunPhase.EXPLORATION,
                FlowScopeExtension.capturePhase(Source.LLM, SourceDetail.LLM_EXPLORER, false));
        assertEquals(RunPhase.EXPLORATION,
                FlowScopeExtension.capturePhase(Source.SCANNER, SourceDetail.ZAP_SPIDER, false));
    }
}
