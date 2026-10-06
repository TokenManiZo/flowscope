package io.flowscope;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.GraphWorkspace;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.RequestLabWorkspace;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.web.FlowScopeWebServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

final class RequestLabWorkspacePersistenceTest {
    @TempDir Path temp;
    private static final String EVIDENCE = "evidence-1";
    private static final String REQUEST = "POST /orders?api%5Fkey=URL-SECRET HTTP/1.1\r\nHost: api.test\r\n"
            + "Cookie: sid=COOKIE-SECRET\r\nAuthorization: Bearer AUTH-SECRET\r\nX-Api-Key: KEY-SECRET\r\n"
            + "X-CSRF-Token: CSRF-SECRET\r\nContent-Type: application/json\r\n\r\n"
            + "{\"token\":\"BODY-SECRET\", \"amount\":1.2300,\"id\":9007199254740993,\"text\":\"\\u0041\"}";
    private static RequestLabWorkspace.Change create(int id) {
        return new RequestLabWorkspace.Change("create", id, "주문 확인", REQUEST, "ACCOUNT",
                new RequestLabWorkspace.Result("HTTP/1.1 200 OK\r\nSet-Cookie: sid=RES-SECRET\r\n\r\n{\"id\":7}", 200, 12, 400, 100), false, false, id);
    }
    private static RequestLabWorkspace.Change delete(int id) {
        return new RequestLabWorkspace.Change("delete", id, null, null, null, null, false, null, 0);
    }
    private void save(SqliteProjectStore store, Path path, RequestLabWorkspace workspace) throws Exception {
        RequestRecord original = new RequestRecord(Source.HUMAN, "https://api.test:443", "GET", "/orders", 200, "anon");
        store.save(path, List.of(original), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), GraphWorkspace.empty(), workspace);
    }

    @Test void maskedNamesRequestLatestResponseRoundTripWithoutChangingOtherJsonTokens() throws Exception {
        var codec = new ProjectStore();
        var sqlite = new SqliteProjectStore(codec);
        var workspace = create(1).apply(RequestLabWorkspace.empty(), EVIDENCE);
        var request = workspace.tab(EVIDENCE).entries().get(1).request();
        for (String secret : List.of("URL-SECRET", "COOKIE-SECRET", "AUTH-SECRET", "KEY-SECRET", "CSRF-SECRET", "BODY-SECRET")) assertFalse(request.contains(secret));
        assertTrue(request.contains("\"amount\":1.2300,\"id\":9007199254740993,\"text\":\"\\u0041\""));
        assertTrue(request.contains("\r\n\r\n"));
        assertFalse(workspace.tab(EVIDENCE).entries().get(1).result().response().contains("RES-SECRET"));
        Path file = temp.resolve("requests.json"), database = temp.resolve("requests.db");
        codec.save(file, List.of(), new AnalysisConfig(), List.of(), List.of(), Map.of(), List.of(), List.of(),
                ProjectStore.ProjectContext.empty(), GraphWorkspace.empty(), workspace);
        save(sqlite, database, workspace);
        assertEquals(workspace, codec.load(file).requestLabWorkspace());
        assertEquals(workspace, sqlite.load(database).requestLabWorkspace());
        assertFalse(Files.readString(file).contains("AUTH-SECRET"));
    }

    @Test void deletePhysicallyRemovesRowAndLateChangesCannotResurrectIt() throws Exception {
        var store = new SqliteProjectStore(new ProjectStore());
        Path database = temp.resolve("delete.db");
        var first = create(1).apply(RequestLabWorkspace.empty(), EVIDENCE);
        save(store, database, first);
        var removed = delete(1).apply(first, EVIDENCE);
        store.saveRequestLabWorkspace(database, EVIDENCE, first, removed);
        assertEquals(removed, store.load(database).requestLabWorkspace());
        assertEquals(1, store.load(database).records().size());
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT COUNT(*) FROM request_lab_requests")) {
            assertTrue(rows.next()); assertEquals(0, rows.getInt(1));
        }
        var late = new RequestLabWorkspace.Change("update", 1, "late", null, null, null, false, null, null);
        assertThrows(IllegalStateException.class, () -> late.apply(removed, EVIDENCE));
        assertThrows(IllegalStateException.class, () -> create(1).apply(removed, EVIDENCE));
        assertThrows(IllegalStateException.class, () -> store.saveRequestLabWorkspace(database, EVIDENCE, first, removed));
        // A subsequent full checkpoint carries the committed state, including the sequence tombstone.
        save(store, database, removed);
        assertTrue(store.load(database).requestLabWorkspace().tab(EVIDENCE).entries().isEmpty());
        var second = create(2).apply(removed, EVIDENCE);
        store.saveRequestLabWorkspace(database, EVIDENCE, removed, second);
        assertEquals(second, store.load(database).requestLabWorkspace());
    }

    @Test void partialNameSavePreservesLargeColumnsAndFailedTransactionKeepsTheRow() throws Exception {
        var store = new SqliteProjectStore(new ProjectStore());
        Path database = temp.resolve("partial.db");
        var first = create(1).apply(RequestLabWorkspace.empty(), EVIDENCE);
        save(store, database, first);
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement()) {
            statement.execute("CREATE TRIGGER forbid_http_update BEFORE UPDATE OF request,result ON request_lab_requests BEGIN SELECT RAISE(ABORT,'HTTP columns touched'); END");
        }
        var name = new RequestLabWorkspace.Change("update", 1, "수량 변경", null, null, null, false, null, null).apply(first, EVIDENCE);
        store.saveRequestLabWorkspace(database, EVIDENCE, first, name);
        assertEquals(name, store.load(database).requestLabWorkspace());
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement()) {
            statement.execute("CREATE TRIGGER forbid_delete BEFORE DELETE ON request_lab_requests BEGIN SELECT RAISE(ABORT,'disk failure'); END");
        }
        assertThrows(java.io.IOException.class, () -> store.saveRequestLabWorkspace(database, EVIDENCE, name, delete(1).apply(name, EVIDENCE)));
        assertEquals(name, store.load(database).requestLabWorkspace());
    }

    @Test void readsLegacyProjectsAndMigratesSqliteWithoutRewritingEvidence() throws Exception {
        var codec = new ProjectStore(); var store = new SqliteProjectStore(codec);
        Path file = temp.resolve("old.json");
        for (int version : List.of(1, 2, 3)) {
            Path database = temp.resolve("old-" + version + ".db");
            save(store, database, RequestLabWorkspace.empty());
            try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database); var statement = connection.createStatement()) {
                statement.execute("DROP TABLE request_lab_requests"); statement.execute("DROP TABLE request_lab_tabs");
                statement.execute("DELETE FROM metadata WHERE key='request_lab_revision'");
                statement.execute("UPDATE metadata SET value='" + version + "' WHERE key='storage_schema_version'");
                statement.execute("UPDATE metadata SET value='" + (version == 1 ? 2 : 7) + "' WHERE key='project_schema_version'");
                statement.execute("UPDATE schema_migrations SET version=" + version);
                if (version < 3) statement.execute("DROP TABLE run_attempts");
                if (version < 2) {
                    statement.execute("DROP TABLE completed_runs");
                    statement.execute("DELETE FROM metadata WHERE key='project_context'");
                    statement.execute("INSERT INTO completed_lanes(source) VALUES('HUMAN')");
                }
            }
            assertEquals(RequestLabWorkspace.empty(), store.load(database).requestLabWorkspace());
            var next = create(1).apply(RequestLabWorkspace.empty(), EVIDENCE);
            store.saveRequestLabWorkspace(database, EVIDENCE, RequestLabWorkspace.empty(), next);
            assertEquals(next, store.load(database).requestLabWorkspace());
            assertEquals(1, store.load(database).records().size());
        }
        codec.save(file, List.of(), new AnalysisConfig(), List.of());
        ObjectNode old = (ObjectNode) new ObjectMapper().readTree(Files.readString(file));
        old.put("schema_version", 7); old.remove("requestLabWorkspace"); Files.writeString(file, old.toString());
        assertEquals(RequestLabWorkspace.empty(), codec.load(file).requestLabWorkspace());
    }

    @Test void savesEveryRequestLabCredentialModeIncludingDirectInputAndRejectsUnknownModes() throws Exception {
        // 직접 입력(RAW)으로 보낸 요청도 저장돼야 한다. 거부되면 자동 저장이 실패하고 Request Lab 닫기가 막힌다.
        var workspace = RequestLabWorkspace.empty();
        int id = 1;
        for (FlowScopeWebServer.CredentialMode mode : FlowScopeWebServer.CredentialMode.values()) {
            workspace = new RequestLabWorkspace.Change("create", id, "모드 " + mode, REQUEST, mode.name(), null, false, false, id)
                    .apply(workspace, EVIDENCE);
            assertEquals(mode.name(), workspace.tab(EVIDENCE).entries().get(id).credentialMode());
            id++;
        }
        var raw = new RequestLabWorkspace.Change("update", 1, null, null, "RAW", null, false, null, null).apply(workspace, EVIDENCE);
        assertEquals("RAW", raw.tab(EVIDENCE).entries().get(1).credentialMode());
        assertFalse(raw.tab(EVIDENCE).entries().get(1).request().contains("AUTH-SECRET"), "직접 입력도 저장본의 인증값은 가린다");
        Path database = temp.resolve("modes.db");
        var sqlite = new SqliteProjectStore(new ProjectStore());
        save(sqlite, database, raw);
        assertEquals(raw, sqlite.load(database).requestLabWorkspace());
        var unchanged = raw;
        assertThrows(IllegalArgumentException.class, () -> new RequestLabWorkspace.Change("update", 1, null, null, "TYPO", null, false, null, null)
                .apply(unchanged, EVIDENCE));
    }

    @Test void masksFoldedHeadersAllDuplicateKeysAndSecretObjectsAndEnforcesLimits() {
        var entry = new RequestLabWorkspace.Entry("token=NAME-SECRET", "POST / HTTP/1.1\nX-Api-Key: FIRST\n SECOND\nContent-Type: application/json\n\n"
                + "{\"token\":{\"v\":\"NESTED\"},\"token\":\"DUPLICATE\",\"n\":1.2300}", "ORIGINAL", null, false);
        assertFalse(entry.name().contains("NAME-SECRET"));
        for (String secret : List.of("FIRST", "SECOND", "NESTED", "DUPLICATE")) assertFalse(entry.request().contains(secret));
        assertTrue(entry.request().contains("\"n\":1.2300"));
        assertThrows(IllegalArgumentException.class, () -> new RequestLabWorkspace.Entry("large", "x".repeat(1_048_577), "ORIGINAL", null, false));
        var workspace = RequestLabWorkspace.empty();
        for (int i = 1; i <= 32; i++) workspace = create(i).apply(workspace, EVIDENCE);
        var full = workspace;
        assertThrows(IllegalArgumentException.class, () -> create(33).apply(full, EVIDENCE));
    }
}
