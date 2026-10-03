package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.GraphWorkspace;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

final class GraphWorkspacePersistenceTest {
    @TempDir Path temp;
    private static final String VIEW = "[\"site\",\"\",\"\"]";
    private static GraphWorkspace layout() {
        var view = new GraphWorkspace.View(Map.of("operation:GET /orders", new GraphWorkspace.Point(700, 200)),
                Map.of("operation:GET /orders", new GraphWorkspace.Size(300, 140)),
                new GraphWorkspace.Viewport(1.3, new GraphWorkspace.Point(-20, 30)), List.of("object-group:orders"));
        return new GraphWorkspace(1, GraphWorkspace.empty().navigation(), Map.of(VIEW, view), true, "mouse");
    }

    @Test void roundTripsLayoutInJsonAndSqliteAndReadsOldProjectsAsEmpty() throws Exception {
        var codec = new ProjectStore();
        var sqlite = new SqliteProjectStore(codec);
        Path json = temp.resolve("layout.json"), database = temp.resolve("layout.db");
        codec.save(json, List.of(), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), layout());
        sqlite.save(database, List.of(), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), layout());
        assertEquals(layout(), codec.load(json).graphWorkspace());
        assertEquals(layout(), sqlite.load(database).graphWorkspace());
        ObjectNode old = (ObjectNode) new ObjectMapper().readTree(Files.readString(json));
        old.put("schema_version", 6);
        old.remove("graphWorkspace");
        Files.writeString(json, old.toString());
        assertEquals(GraphWorkspace.empty(), codec.load(json).graphWorkspace());
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement()) {
            statement.executeUpdate("DELETE FROM metadata WHERE key='graph_workspace'");
            statement.executeUpdate("UPDATE metadata SET value='6' WHERE key='project_schema_version'");
        }
        assertEquals(GraphWorkspace.empty(), sqlite.load(database).graphWorkspace());
        sqlite.saveGraphWorkspace(database, layout());
        assertEquals(layout(), sqlite.load(database).graphWorkspace());
    }

    @Test void metadataCheckpointDoesNotRewriteTrafficOrPayloads() throws Exception {
        var store = new SqliteProjectStore(new ProjectStore());
        Path database = temp.resolve("traffic.db");
        var record = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders/7", 200, "anon");
        record.hasResponse = true;
        record.body = "{\"id\":7}";
        store.save(database, List.of(record), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of());
        String before;
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT document FROM records")) {
            assertTrue(rows.next()); before = rows.getString(1);
        }
        store.saveGraphWorkspace(database, layout());
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT document FROM records")) {
            assertTrue(rows.next()); assertEquals(before, rows.getString(1)); assertFalse(rows.next());
        }
        assertEquals(1, store.load(database).records().size());
        assertEquals(layout(), store.load(database).graphWorkspace());
    }

    @Test void viewChangesKeepOtherViewsAndValidateGeometry() {
        GraphWorkspace original = layout();
        var site = original.views().get(VIEW);
        var twoViews = new GraphWorkspace(1, original.navigation(), Map.of(VIEW, site, "legacy", site), true, "mouse");
        var change = new GraphWorkspace.Change(null, Map.of(VIEW, new GraphWorkspace.View(Map.of(), Map.of(), null, List.of())),
                List.of(), null, null);
        assertEquals(site, change.apply(twoViews).views().get("legacy"));
        assertEquals(2, twoViews.views().size());
        assertFalse(new GraphWorkspace.Change(null, Map.of(), List.of("legacy"), null, null).apply(twoViews).views().containsKey("legacy"));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Point(Double.NaN, 0));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Size(700, 100));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Change(null, Map.of("token=SECRET", site), List.of(), null, null));
    }

    @Test void longOperationKeysRoundTripWithoutTruncatingOrMergingPaths() throws Exception {
        String first = "https://api.test:443 GET /" + "segment/".repeat(300) + "a";
        String second = first.substring(0, first.length() - 1) + "b";
        var navigation = new GraphWorkspace.Navigation("operation", "orders", first, 18, 18, "");
        String key = new ObjectMapper().writeValueAsString(List.of("operation", "orders", first));
        var view = new GraphWorkspace.View(Map.of("operation:" + first, new GraphWorkspace.Point(540, 200),
                "operation:" + second, new GraphWorkspace.Point(540, 400)),
                Map.of("operation:" + first, new GraphWorkspace.Size(300, 140)), null, List.of("operation-group:" + first));
        var workspace = new GraphWorkspace(1, navigation, Map.of(key, view), false, "auto");
        var codec = new ProjectStore();
        var sqlite = new SqliteProjectStore(codec);
        Path file = temp.resolve("long.json"), database = temp.resolve("long.db");
        codec.save(file, List.of(), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), workspace);
        sqlite.save(database, List.of(), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), workspace);
        assertEquals(workspace, codec.load(file).graphWorkspace());
        assertEquals(workspace, sqlite.load(database).graphWorkspace());
        sqlite.saveGraphWorkspace(database, workspace);
        assertEquals(workspace, sqlite.load(database).graphWorkspace());
    }

    @Test void graphTextLimitCountsUtf8BytesAndStillRejectsSecrets() {
        String boundary = "x".repeat(64 * 1024);
        assertDoesNotThrow(() -> new GraphWorkspace.Navigation("operation", "", boundary, 18, 18, ""));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Navigation("operation", "", boundary + "x", 18, 18, ""));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Navigation("operation", "", "한".repeat(22_000), 18, 18, ""));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Navigation("operation", "", "GET /orders?token=SECRET", 18, 18, ""));
    }

    @Test void viewPatchMovesOneNodeAndPreservesHiddenNodesAndOtherViews() {
        var original = layout();
        var view = original.views().get(VIEW);
        var hidden = new GraphWorkspace.Point(700, 800);
        var withHidden = new GraphWorkspace.View(Map.of("visible", new GraphWorkspace.Point(700, 200), "hidden", hidden),
                Map.of("hidden", new GraphWorkspace.Size(300, 180)), view.viewport(), List.of("object-group:orders"));
        var workspace = new GraphWorkspace(1, original.navigation(), Map.of(VIEW, withHidden, "other", view), false, "auto");
        var patch = new GraphWorkspace.ViewPatch(Map.of("visible", new GraphWorkspace.Point(750, 250)), List.of(),
                Map.of(), List.of(), null, false, null);
        var changed = new GraphWorkspace.Change(null, Map.of(), List.of(), null, null, Map.of(VIEW, patch)).apply(workspace);
        assertEquals(new GraphWorkspace.Point(750, 250), changed.views().get(VIEW).positions().get("visible"));
        assertEquals(hidden, changed.views().get(VIEW).positions().get("hidden"));
        assertEquals(withHidden.sizes(), changed.views().get(VIEW).sizes());
        assertEquals(withHidden.viewport(), changed.views().get(VIEW).viewport());
        assertEquals(withHidden.expandedGroups(), changed.views().get(VIEW).expandedGroups());
        assertEquals(view, changed.views().get("other"));
        assertEquals(new GraphWorkspace.Point(700, 200), workspace.views().get(VIEW).positions().get("visible"));
    }

    @Test void viewPatchCanClearGeometryAndRejectsConflictingInstructions() {
        var original = layout();
        var patch = new GraphWorkspace.ViewPatch(Map.of(), List.of("operation:GET /orders"), Map.of(),
                List.of("operation:GET /orders"), null, true, List.of());
        var changed = new GraphWorkspace.Change(null, Map.of(), List.of(), null, null, Map.of(VIEW, patch)).apply(original);
        assertEquals(new GraphWorkspace.View(Map.of(), Map.of(), null, List.of()), changed.views().get(VIEW));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Change(null, original.views(), List.of(), null, null, Map.of(VIEW, patch)));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.Change(null, Map.of(), List.of(VIEW), null, null, Map.of(VIEW, patch)));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.ViewPatch(Map.of("a", new GraphWorkspace.Point(1, 2)), List.of("a"), Map.of(), List.of(), null, false, null));
        assertThrows(IllegalArgumentException.class, () -> new GraphWorkspace.ViewPatch(Map.of("__proto__", new GraphWorkspace.Point(1, 2)), List.of(), Map.of(), List.of(), null, false, null));
    }
}
