package io.flowscope;

import io.flowscope.core.RequestRecord;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.integration.GraphWorkspace;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class StandaloneTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void failedDeleteCheckpointLeavesTheOriginalDatasetUntouched() throws Exception {
        Path root = temporaryDirectory.resolve("failed-delete");
        var state = new Standalone.DemoState(new String[0], new ProjectWorkspace(root));
        var project = state.startProject("checkpoint", "https://api.example.test/");
        state.loadSample();
        String op = io.flowscope.core.ApiManagement.operation(state.snapshot().records.getFirst());
        var preview = state.manageApi(new io.flowscope.core.ApiManagement.Request("preview-delete", state.datasetRevision(), state.revision(), List.of(op), List.of(), "", null));
        int count = state.snapshot().records.size(); long revision = state.revision();
        Path db = root.resolve(project.active().id()).resolve(ProjectWorkspace.DATABASE_NAME);
        Files.move(db, db.resolveSibling("checkpoint.backup"));
        Files.createDirectory(db); Files.writeString(db.resolve("block-replacement"), "test");
        assertThrows(IllegalStateException.class, () -> state.manageApi(new io.flowscope.core.ApiManagement.Request("delete", state.datasetRevision(), revision, List.of(op), List.of(), "", preview.evidenceIds())));
        assertEquals(count, state.snapshot().records.size()); assertEquals(revision, state.revision());
    }

    @Test
    void apiChangesPersistAcrossProjectReopenAndRejectStaleDeletion() throws Exception {
        var workspace = new ProjectWorkspace(temporaryDirectory.resolve("api-actions"));
        var state = new Standalone.DemoState(new String[0], workspace);
        var project = state.startProject("API actions", "https://api.example.test/");
        state.loadSample();
        var record = state.snapshot().records.getFirst();
        String op = io.flowscope.core.ApiManagement.operation(record);
        var beforeHighlight = state.snapshot();
        long oldRevision = state.revision();
        var acknowledged = state.manageApi(new io.flowscope.core.ApiManagement.Request("highlight", state.datasetRevision(), state.revision(), List.of(op), List.of(), "blue", null));
        org.junit.jupiter.api.Assertions.assertSame(beforeHighlight, state.snapshot());
        assertEquals(oldRevision + 1, acknowledged.revision());
        assertEquals(state.datasetRevision(), acknowledged.datasetRevision());
        assertEquals("blue", acknowledged.apiMarks().get(op).color());
        state.manageApi(new io.flowscope.core.ApiManagement.Request("register", state.datasetRevision(), state.revision(), List.of(op), List.of(record.evidenceId), "", null));
        state.openProject(project.active().id());
        var marks = io.flowscope.core.ApiManagement.marks(state.snapshot(), state.config(), state.routeCandidates());
        assertEquals("blue", marks.get(op).color()); assertTrue(marks.get(op).registered());
        long revision = state.revision();
        var preview = state.manageApi(new io.flowscope.core.ApiManagement.Request("preview-delete", state.datasetRevision(), revision, List.of(op), List.of(), "", null));
        assertEquals(revision, state.revision());
        assertThrows(IllegalStateException.class, () -> state.manageApi(new io.flowscope.core.ApiManagement.Request("delete", state.datasetRevision(), revision - 1, List.of(op), List.of(), "", preview.evidenceIds())));
        state.manageApi(new io.flowscope.core.ApiManagement.Request("delete", state.datasetRevision(), revision, List.of(op), List.of(), "", preview.evidenceIds()));
        state.openProject(project.active().id());
        assertTrue(state.snapshot().records.stream().noneMatch(r -> io.flowscope.core.ApiManagement.operation(r).equals(op)));
        assertFalse(state.config().apiState().highlights().containsKey(op));
    }

    @Test
    void exposesAnExactSampleEvidenceAsAReadOnlyDraftWithoutReusableSession() throws Exception {
        FlowScopeWebServer.State state = newDemoState();
        RequestRecord sample = state.snapshot().records.getFirst();

        FlowScopeWebServer.RequestLabDraft draft = state.requestLabDraft(sample.evidenceId);

        assertEquals(sample.evidenceId, draft.eventId());
        assertEquals(sample.service, draft.service());
        assertEquals(sample.requestTextForEvidence(), draft.request());
        assertEquals(sample.responseTextForEvidence(), draft.response());
        assertTrue(draft.request().contains("Authorization: Bearer "));
        assertFalse(draft.rawRequestRetained());
        assertFalse(draft.rawResponseRetained());
        assertFalse(draft.requestEditable());
        assertEquals("UTF-8", draft.requestCharset());
        assertEquals("UTF-8", draft.responseCharset());
        assertEquals("없음", draft.reusableSession());
        assertEquals("Standalone 데모에서는 읽기 전용 초안만 제공하며 Request Lab 전송을 사용할 수 없습니다.",
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
    void persistsGraphSeparatelyAndRejectsStaleEditsAfterProjectReplacement() throws Exception {
        var state = new Standalone.DemoState(new String[0], new ProjectWorkspace(temporaryDirectory));
        var first = state.startProject("첫 진단", "https://first.example/");
        state.loadSample();
        var before = state.graphWorkspace();
        long analysisRevision = state.revision();
        var view = new GraphWorkspace.View(Map.of("operation:GET /orders", new GraphWorkspace.Point(700, 200)),
                Map.of(), new GraphWorkspace.Viewport(1.2, new GraphWorkspace.Point(-20, 30)), List.of());
        var change = new GraphWorkspace.Change(null, Map.of("site", view), List.of(), true, null);
        var saved = state.updateGraphWorkspace(before.datasetRevision(), before.revision(), change);
        assertEquals(analysisRevision, state.revision(), "배치 변경은 트래픽 snapshot revision을 바꾸지 않는다");
        assertEquals(view, saved.workspace().views().get("site"));
        assertThrows(IllegalStateException.class,
                () -> state.updateGraphWorkspace(before.datasetRevision(), before.revision(), change));

        state.startProject("둘째 진단", "https://second.example/");
        assertEquals(GraphWorkspace.empty(), state.graphWorkspace().workspace());
        assertThrows(IllegalStateException.class,
                () -> state.updateGraphWorkspace(saved.datasetRevision(), saved.revision(), change));
        state.openProject(first.active().id());
        assertEquals(saved.workspace(), state.graphWorkspace().workspace());
        state.openProject(first.active().id());
        assertEquals(saved.workspace(), state.graphWorkspace().workspace());
        state.resetProjectTraffic();
        assertEquals(GraphWorkspace.empty(), state.graphWorkspace().workspace());
        state.openProject(first.active().id());
        assertEquals(GraphWorkspace.empty(), state.graphWorkspace().workspace());
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
