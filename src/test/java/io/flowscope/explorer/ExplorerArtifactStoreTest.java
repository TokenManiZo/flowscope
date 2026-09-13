package io.flowscope.explorer;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ExplorerArtifactStoreTest {
    @Test
    void deduplicatesContentButKeepsEveryEvidenceProvenance() throws Exception {
        try (ExplorerArtifactStore store = new ExplorerArtifactStore("run:one", 1024 * 1024)) {
            ExplorerArtifactStore.Metadata first = store.store(
                    "ev-1", "https://app.example/main.js", "application/javascript",
                    "const endpoint='/api/orders';", true);
            ExplorerArtifactStore.Metadata second = store.store(
                    "ev-2", "https://cdn.example/main.js", "application/javascript",
                    "const endpoint='/api/orders';", true);

            assertEquals(first.id(), second.id());
            assertEquals(1, store.list().size());
            assertEquals(List.of("ev-1", "ev-2"), store.metadata(first.id()).provenance().stream()
                    .map(ExplorerArtifactStore.Provenance::evidenceId).toList());
            assertEquals("const endpoint='/api/orders';", store.read(first.id(), 0, 64).text());
            assertTrue(store.read(first.id(), 0, 64).endOfArtifact());
        }
    }

    @Test
    void searchesLargeArtifactsWithoutReturningTheWholeFile() throws Exception {
        String text = "x".repeat(70_000) + "fetch('/api/private/report')" + "y".repeat(70_000);
        try (ExplorerArtifactStore store = new ExplorerArtifactStore("run-search", 1024 * 1024)) {
            String id = store.store("ev-1", "https://app.example/main.js",
                    "application/javascript", text, true).id();

            List<ExplorerArtifactStore.Match> matches = store.search(id, "/API/PRIVATE/REPORT", false, 5);
            ExplorerArtifactStore.Read page = store.read(id, 69_990, 64);

            assertEquals(1, matches.size());
            assertTrue(matches.getFirst().charOffset() >= 70_000);
            assertTrue(matches.getFirst().snippet().contains("/api/private/report"));
            assertTrue(page.text().contains("fetch('/api/private/report')"));
            assertFalse(page.endOfArtifact());
        }
    }

    @Test
    void rejectsCapacityOverflowAndDeletesTheRunIndexOnClose() throws Exception {
        ExplorerArtifactStore store = new ExplorerArtifactStore("run-capacity", 8);
        String id = store.store("ev-1", "https://app.example/a", "text/plain", "12345678", true).id();

        assertThrows(ExplorerArtifactStore.CapacityExceededException.class,
                () -> store.store("ev-2", "https://app.example/b", "text/plain", "abcdefghi", true));
        store.close();
        assertThrows(IllegalArgumentException.class, () -> store.metadata(id));
    }
}
