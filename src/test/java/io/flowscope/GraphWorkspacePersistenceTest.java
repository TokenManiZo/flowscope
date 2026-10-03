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
}
