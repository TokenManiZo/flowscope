package io.flowscope.integration;

import io.flowscope.core.AnalysisConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProjectWorkspaceTest {
    @TempDir Path temporary;

    @Test
    void allocatesOnePrivateScopeNamedDirectoryPerDiagnosisAndAvoidsCollisions() throws Exception {
        Clock clock = Clock.fixed(Instant.parse("2026-09-10T01:02:03Z"), ZoneOffset.UTC);
        ProjectWorkspace workspace = new ProjectWorkspace(temporary, clock);

        ProjectWorkspace.Allocation first = workspace.allocate("", "https://Example.test/app");
        ProjectWorkspace.Allocation second = workspace.allocate("", "https://Example.test/app");

        assertEquals("example-test-443-20260910-010203", first.id());
        assertEquals("example-test-443-20260910-010203-2", second.id());
        assertEquals(List.of("https://example.test:443/app"), first.context().scope());
        assertTrue(first.directory().startsWith(temporary));
        assertFalse(first.database().toFile().exists());
    }

    @Test
    void listsSavedProjectsAndRejectsPathTraversal() throws Exception {
        ProjectStore codec = new ProjectStore();
        SqliteProjectStore store = new SqliteProjectStore(codec);
        ProjectWorkspace workspace = new ProjectWorkspace(temporary,
                Clock.fixed(Instant.parse("2026-09-10T01:02:03Z"), ZoneOffset.UTC));
        ProjectWorkspace.Allocation allocation = workspace.allocate("진단 A", "http://127.0.0.1:8888/");
        store.save(allocation.database(), List.of(), new AnalysisConfig(), List.of(), List.of(),
                Map.of(), List.of(), List.of(), allocation.context());

        ProjectWorkspace.Status status = workspace.status(allocation.database(), allocation.context(), store);

        assertEquals(allocation.database(), workspace.resolveDatabase(allocation.id()));
        assertEquals("진단 A", status.active().name());
        assertTrue(allocation.id().startsWith("진단-a--127-0-0-1-8888-"));
        assertEquals(1, status.projects().size());
        assertTrue(status.projects().getFirst().readable());
        ProjectWorkspace.Status failed = status.withPersistence(
                "FAILED", "2026-09-10T01:03:00Z", "disk full");
        assertEquals("FAILED", failed.saveState());
        assertEquals("2026-09-10T01:03:00Z", failed.lastSavedAt());
        assertEquals("disk full", failed.saveError());
        assertThrows(IllegalArgumentException.class, () -> workspace.resolveDatabase("../outside"));
        assertThrows(IllegalArgumentException.class, () -> workspace.resolveDatabase("missing"));
    }

    @Test
    void usesWindowsSafeNamesWithoutDiscardingTheDisplayName() throws Exception {
        ProjectWorkspace workspace = new ProjectWorkspace(temporary,
                Clock.fixed(Instant.parse("2026-09-10T01:02:03Z"), ZoneOffset.UTC));
        ProjectWorkspace.Allocation allocation = workspace.allocate("CON", "https://example.test/");

        assertTrue(allocation.id().startsWith("project-con--example-test-443-"));
        assertEquals("CON", allocation.context().name());
    }

    @Test
    void keepsAnExternalManuallySavedDatabaseSelectableWithoutTreatingItAsManaged() throws Exception {
        ProjectStore codec = new ProjectStore();
        SqliteProjectStore store = new SqliteProjectStore(codec);
        ProjectWorkspace workspace = new ProjectWorkspace(temporary.resolve("managed"));
        Path external = temporary.resolve("manual.flowscope.db");
        ProjectStore.ProjectContext context = new ProjectStore.ProjectContext(
                "수동 프로젝트", List.of("https://manual.example:443/"), Instant.parse("2026-09-10T01:02:03Z"));
        store.save(external, List.of(), new AnalysisConfig(), List.of(), List.of(),
                Map.of(), List.of(), List.of(), context);

        ProjectWorkspace.Status status = workspace.status(external, context, store);

        assertEquals("external-active", status.active().id());
        assertEquals("수동 프로젝트", status.active().name());
        assertEquals(1, status.projects().size());
        assertTrue(status.projects().getFirst().active());
        assertFalse(status.projects().getFirst().managed());
    }
}
