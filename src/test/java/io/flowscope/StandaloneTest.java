package io.flowscope;

import io.flowscope.core.RequestRecord;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class StandaloneTest {
    @TempDir
    Path temporaryDirectory;

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

    @Test
    void startsPersistsAndReopensIsolatedDiagnosisProjects() throws Exception {
        Path workspaceRoot = temporaryDirectory.resolve("projects");
        Standalone.DemoState state = new Standalone.DemoState(
                new String[0], new ProjectWorkspace(workspaceRoot));
        int sampleRecords = state.snapshot().records.size();
        long initialDatasetRevision = state.datasetRevision();

        ProjectWorkspace.Status first = state.startProject("첫 진단", "https://first.example/api/");

        assertTrue(state.snapshot().records.isEmpty());
        assertEquals("첫 진단", first.active().name());
        assertEquals(List.of("https://first.example:443/api"), first.active().scope());
        assertTrue(Files.isRegularFile(workspaceRoot.resolve(first.active().id())
                .resolve(ProjectWorkspace.DATABASE_NAME)));
        assertTrue(state.datasetRevision() > initialDatasetRevision);

        state.loadSample();
        assertEquals(sampleRecords, state.snapshot().records.size());
        ProjectWorkspace.Status second = state.startProject("둘째 진단", "https://second.example/");
        assertEquals(2, second.projects().size());
        assertTrue(state.snapshot().records.isEmpty());

        ProjectWorkspace.Status reopened = state.openProject(first.active().id());

        assertEquals(first.active().id(), reopened.active().id());
        assertEquals(sampleRecords, state.snapshot().records.size());
        assertEquals("SAVED", reopened.saveState());

        ProjectWorkspace.Status updated = state.updateProject("이름 바꾼 진단", "https://first.example/api/\nhttps://auth.example/");
        assertEquals("이름 바꾼 진단", updated.active().name());
        assertEquals(List.of("https://first.example:443/api", "https://auth.example:443/"), updated.active().scope());
        assertEquals(sampleRecords, state.snapshot().records.size(), "수정은 이미 모은 기록을 지우지 않는다");
        assertEquals("이름 바꾼 진단", state.openProject(first.active().id()).active().name(), "수정한 이름·범위는 저장된다");
        assertThrows(IllegalArgumentException.class, () -> state.updateProject("", " "));

        ProjectWorkspace.Status reset = state.resetProjectTraffic();
        assertEquals(first.active().id(), reset.active().id());
        assertTrue(state.snapshot().records.isEmpty());

        state.openProject(second.active().id());
        state.deleteProject(first.active().id());
        assertFalse(Files.exists(workspaceRoot.resolve(first.active().id())));
    }

    @Test
    void reportsExplorerAsUnavailableWithoutFailingTheStandaloneStatusEndpoint() throws Exception {
        ExplorerCoordinator.Snapshot status = newDemoState().explorerStatus();

        assertEquals(ExplorerCoordinator.Status.IDLE, status.status());
        assertEquals("UNAVAILABLE", status.providerReadiness());
    }

    private static FlowScopeWebServer.State newDemoState() throws Exception {
        return new Standalone.DemoState(new String[0]);
    }
}
