package io.flowscope;

import io.flowscope.core.RequestRecord;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class StandaloneTest {
    @Test
    void exposesAnExactSampleEvidenceAsAMaskedReadOnlyDraftWithoutReusableSession() throws Exception {
        FlowScopeWebServer.State state = newDemoState();
        RequestRecord sample = state.snapshot().records.getFirst();

        FlowScopeWebServer.RequestLabDraft draft = state.requestLabDraft(sample.evidenceId);

        assertEquals(sample.evidenceId, draft.eventId());
        assertEquals(sample.service, draft.service());
        assertEquals(sample.requestTextForEvidence(), draft.request());
        assertEquals(sample.responseTextForEvidence(), draft.response());
        assertTrue(draft.request().contains("Authorization: ***MASKED***"));
        assertFalse(draft.rawRequestRetained());
        assertFalse(draft.rawResponseRetained());
        assertFalse(draft.requestEditable());
        assertEquals("UTF-8", draft.requestCharset());
        assertEquals("UTF-8", draft.responseCharset());
        assertEquals("없음", draft.reusableSession());
        assertEquals("Standalone 데모에서는 마스킹된 읽기 전용 초안만 제공하며 Request Lab 전송을 사용할 수 없습니다.",
                draft.message());
    }

    @Test
    void rejectsAnUnknownStandaloneEvidenceInsteadOfReturningAnotherRecord() throws Exception {
        FlowScopeWebServer.State state = newDemoState();

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> state.requestLabDraft("ev-0000000000000000"));

        assertEquals("해당 Evidence를 찾을 수 없습니다.", error.getMessage());
    }

    @Test
    void refusesStandaloneRequestLabTransmission() throws Exception {
        FlowScopeWebServer.State state = newDemoState();
        RequestRecord sample = state.snapshot().records.getFirst();

        UnsupportedOperationException error = assertThrows(UnsupportedOperationException.class,
                () -> state.sendRequestLab(sample.evidenceId, sample.requestTextForEvidence(),
                        FlowScopeWebServer.CredentialMode.ORIGINAL, ""));

        assertEquals("Standalone 데모에서는 Request Lab 전송을 사용할 수 없습니다.", error.getMessage());
    }

    private static FlowScopeWebServer.State newDemoState() throws Exception {
        return new Standalone.DemoState(new String[0]);
    }
}
