package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.MatrixExclusion;
import io.flowscope.core.MatrixExclusionMatcher;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class MatrixExclusionTest {
    @TempDir Path temp;

    private static MatrixExclusion exclusion(String view, String operation, String resource) {
        return new MatrixExclusion(MatrixExclusion.keyFor(view, operation, resource), view, operation, resource, operation);
    }

    @Test void apiAndObjectExclusionsShareOneProjectRuleWithoutErasingEvidence() {
        String service = "https://api.test:443";
        var first = new RequestRecord(Source.HUMAN, service, "GET", "/orders/101", 200, "a");
        first.hasResponse = true; first.body = "{\"id\":101}"; first.responseContentType = "application/json";
        var second = new RequestRecord(Source.HUMAN, service, "GET", "/orders/102", 200, "b");
        second.hasResponse = true; second.body = "{\"id\":102}"; second.responseContentType = "application/json";
        Pipeline.Result result = Pipeline.run(List.of(first, second));
        String op1 = service + " GET /orders/101", op2 = service + " GET /orders/102";
        var config = new AnalysisConfig().replaceMatrixExclusions(List.of(exclusion("function", service + " GET /orders/{id}", null)));
        var matcher = new MatrixExclusionMatcher(config, result);
        assertTrue(matcher.excluded(op1, null));
        assertTrue(matcher.excluded(op2, null));
        assertEquals(2, result.records.size(), "suppression must not delete historical traffic");
        config.replaceMatrixExclusions(List.of(exclusion("object", op1, "GET observed-object:one")));
        matcher = new MatrixExclusionMatcher(config, result);
        assertTrue(matcher.excluded(op1, "GET observed-object:one"));
        assertFalse(matcher.excluded(op1, "GET observed-object:two"));
        assertFalse(matcher.excluded(op2, "GET observed-object:one"));
        config.replaceMatrixExclusions(List.of());
        assertFalse(new MatrixExclusionMatcher(config, result).excluded(op1, "GET observed-object:one"));
    }

    @Test void sqliteStoresExclusionsAndFailedUpdateKeepsLastSavedState() throws Exception {
        var store = new SqliteProjectStore(new ProjectStore());
        Path db = temp.resolve("exclusions.db");
        var config = new AnalysisConfig();
        store.save(db, List.of(), config, List.of(), List.of(), Set.of(), List.of());
        var excluded = exclusion("function", "https://api.test:443 GET /orders/{id}", null);
        config.replaceMatrixExclusions(List.of(excluded));
        store.saveMatrixExclusions(db, config);
        assertEquals(excluded, store.load(db).config().matrixExclusions().get(excluded.key()));
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + db);
             var statement = connection.createStatement()) {
            statement.execute("CREATE TRIGGER reject_exclusion BEFORE DELETE ON policy_entries WHEN OLD.kind='matrix_exclusions' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
        }
        config.replaceMatrixExclusions(List.of());
        assertThrows(java.io.IOException.class, () -> store.saveMatrixExclusions(db, config));
        assertEquals(excluded, store.load(db).config().matrixExclusions().get(excluded.key()));
    }

    @Test void rejectsTamperedOrDuplicateKeys() {
        assertThrows(IllegalArgumentException.class, () -> new MatrixExclusion("wrong", "object", "GET /a", null, "label"));
        var entry = exclusion("object", "GET /a", "GET observed-object:x");
        assertThrows(IllegalArgumentException.class, () -> new AnalysisConfig().replaceMatrixExclusions(List.of(entry, entry)));
    }
}
