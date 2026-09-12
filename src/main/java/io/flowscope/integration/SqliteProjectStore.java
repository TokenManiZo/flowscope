package io.flowscope.integration;

import io.flowscope.core.LegacyAssessment;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import io.flowscope.core.ValidationDecision;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/** Local relational FlowScope project store. Raw broker credentials are never part of this schema. */
public final class SqliteProjectStore {
    private static final int STORAGE_SCHEMA_VERSION = 3;
    private static final long MAX_FILE_BYTES = 100L * 1024 * 1024;

    private final ProjectStore codec;
    private final ObjectMapper json = new ObjectMapper();

    public SqliteProjectStore(ProjectStore codec) {
        this.codec = codec;
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Set<Source> completedLanes,
                     List<RouteCandidate> routeCandidates) throws IOException {
        ObjectNode root = codec.toDocument(records, config, assessments, validations,
                completedLanes, routeCandidates);
        saveDocument(target, root);
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates) throws IOException {
        Map<Source, RunContextRegistry.CompletedRun> runs = completedRuns == null ? Map.of() : completedRuns;
        ObjectNode root = codec.toDocument(records, config, assessments, validations,
                runs.keySet(), runs, routeCandidates);
        saveDocument(target, root);
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates,
                     List<RunExecutionLedger.Attempt> runAttempts) throws IOException {
        save(target, records, config, assessments, validations, completedRuns, routeCandidates,
                runAttempts, ProjectStore.ProjectContext.empty());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments,
                     List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates,
                     List<RunExecutionLedger.Attempt> runAttempts,
                     ProjectStore.ProjectContext context) throws IOException {
        Map<Source, RunContextRegistry.CompletedRun> runs = completedRuns == null ? Map.of() : completedRuns;
        ObjectNode root = codec.toDocument(records, config, assessments, validations,
                runs.keySet(), runs, routeCandidates, runAttempts, context);
        saveDocument(target, root);
    }

    private void saveDocument(Path target, ObjectNode root) throws IOException {
        Path absolute = target.toAbsolutePath().normalize();
        Path parent = absolute.getParent();
        if (parent == null) throw new IllegalArgumentException("project database needs a parent directory");
        Files.createDirectories(parent);
        Path temporary = Files.createTempFile(parent, ".flowscope-", ".db.tmp");
        try {
            Files.deleteIfExists(temporary);
            try (Connection connection = connect(temporary)) {
                initialize(connection);
                connection.setAutoCommit(false);
                try {
                    write(connection, root);
                    connection.commit();
                } catch (SQLException | IOException | RuntimeException error) {
                    connection.rollback();
                    throw error;
                }
            } catch (SQLException error) {
                throw new IOException("FlowScope SQLite save failed", error);
            }
            if (Files.size(temporary) > MAX_FILE_BYTES) {
                throw new IllegalArgumentException("project database exceeds 100 MiB");
            }
            try {
                Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException error) {
                Files.move(temporary, absolute, StandardCopyOption.REPLACE_EXISTING);
            }
            ProjectStore.restrictPermissions(absolute);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public ProjectStore.ProjectData load(Path source) throws IOException {
        Path absolute = source.toAbsolutePath().normalize();
        if (Files.size(absolute) > MAX_FILE_BYTES) {
            throw new IllegalArgumentException("project database exceeds 100 MiB");
        }
        try (Connection connection = connect(absolute)) {
            return codec.fromDocument(read(connection));
        } catch (SQLException error) {
            throw new IOException("FlowScope SQLite load failed", error);
        }
    }

    /** Reads only non-secret project metadata for the workspace picker. */
    public ProjectStore.ProjectContext readContext(Path source) throws IOException {
        Path absolute = source.toAbsolutePath().normalize();
        if (Files.size(absolute) > MAX_FILE_BYTES) {
            throw new IllegalArgumentException("project database exceeds 100 MiB");
        }
        try (Connection connection = connect(absolute)) {
            String value = readOptionalMetadata(connection, "project_context");
            if (value == null) return ProjectStore.ProjectContext.empty();
            JsonNode node = json.readTree(value);
            List<String> scope = new java.util.ArrayList<>();
            JsonNode scopeNode = node.path("scope");
            if (!scopeNode.isArray()) throw new IllegalArgumentException("invalid project scope");
            for (JsonNode entry : scopeNode) scope.add(entry.asText());
            return new ProjectStore.ProjectContext(node.path("name").asText(""), scope,
                    java.time.Instant.parse(required(node, "created_at")));
        } catch (SQLException error) {
            throw new IOException("FlowScope SQLite metadata read failed", error);
        }
    }

    private static Connection connect(Path path) throws SQLException {
        // Burp may initialize DriverManager before the extension exists. Use our bundled driver,
        // independent of the host's service discovery, driver ordering and context classloader.
        return org.sqlite.JDBC.createConnection("jdbc:sqlite:" + path.toAbsolutePath().normalize(),
                new Properties());
    }

    private static void initialize(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("PRAGMA foreign_keys=ON");
            statement.execute("PRAGMA journal_mode=DELETE");
            statement.execute("PRAGMA synchronous=FULL");
            statement.execute("PRAGMA trusted_schema=OFF");
            statement.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
            statement.execute("CREATE TABLE records (seq INTEGER PRIMARY KEY, evidence_id TEXT, service TEXT NOT NULL, source TEXT NOT NULL, phase TEXT NOT NULL, run_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, observed_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE INDEX records_evidence_idx ON records(evidence_id)");
            statement.execute("CREATE INDEX records_route_idx ON records(service, method, path)");
            statement.execute("CREATE INDEX records_run_idx ON records(source, phase, run_id)");
            statement.execute("CREATE TABLE payloads (digest TEXT PRIMARY KEY, compressed BLOB NOT NULL)");
            statement.execute("CREATE TABLE policy_entries (kind TEXT NOT NULL, entry_key TEXT NOT NULL, entry_value TEXT NOT NULL, PRIMARY KEY(kind, entry_key))");
            statement.execute("CREATE TABLE accounts (account_id TEXT PRIMARY KEY, label TEXT NOT NULL, service TEXT NOT NULL, role TEXT NOT NULL)");
            statement.execute("CREATE TABLE session_bindings (service TEXT NOT NULL, fingerprint TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE, PRIMARY KEY(service, fingerprint))");
            statement.execute("CREATE TABLE reviews (seq INTEGER PRIMARY KEY, item_id TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE TABLE assessments (seq INTEGER PRIMARY KEY, assessment_id TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE TABLE validations (seq INTEGER PRIMARY KEY, candidate_id TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE TABLE completed_lanes (source TEXT PRIMARY KEY)");
            statement.execute("CREATE TABLE completed_runs (source TEXT PRIMARY KEY, run_id TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE TABLE route_candidates (seq INTEGER PRIMARY KEY, service TEXT NOT NULL, method TEXT NOT NULL, path_template TEXT NOT NULL, observed INTEGER NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE TABLE run_attempts (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, run_id TEXT NOT NULL, outcome TEXT NOT NULL, document TEXT NOT NULL)");
            statement.execute("CREATE INDEX run_attempts_run_idx ON run_attempts(source, run_id)");
        }
    }

    private void write(Connection connection, ObjectNode root) throws SQLException, IOException {
        try (PreparedStatement migration = connection.prepareStatement(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)");
             PreparedStatement metadata = connection.prepareStatement(
                     "INSERT INTO metadata(key, value) VALUES(?, ?)");
             PreparedStatement record = connection.prepareStatement(
                     "INSERT INTO records(seq, evidence_id, service, source, phase, run_id, method, path, status, observed_at, fingerprint, document) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
             PreparedStatement payload = connection.prepareStatement(
                     "INSERT INTO payloads(digest, compressed) VALUES(?, ?)");
             PreparedStatement policy = connection.prepareStatement(
                     "INSERT INTO policy_entries(kind, entry_key, entry_value) VALUES(?, ?, ?)");
             PreparedStatement account = connection.prepareStatement(
                     "INSERT INTO accounts(account_id, label, service, role) VALUES(?, ?, ?, ?)");
             PreparedStatement binding = connection.prepareStatement(
                     "INSERT INTO session_bindings(service, fingerprint, account_id) VALUES(?, ?, ?)");
             PreparedStatement review = connection.prepareStatement(
                     "INSERT INTO reviews(seq, item_id, document) VALUES(?, ?, ?)");
             PreparedStatement assessment = connection.prepareStatement(
                     "INSERT INTO assessments(seq, assessment_id, document) VALUES(?, ?, ?)");
             PreparedStatement validation = connection.prepareStatement(
                     "INSERT INTO validations(seq, candidate_id, document) VALUES(?, ?, ?)");
             PreparedStatement lane = connection.prepareStatement(
                     "INSERT INTO completed_lanes(source) VALUES(?)");
             PreparedStatement completedRun = connection.prepareStatement(
                     "INSERT INTO completed_runs(source, run_id, document) VALUES(?, ?, ?)");
             PreparedStatement candidate = connection.prepareStatement(
                     "INSERT INTO route_candidates(seq, service, method, path_template, observed, document) VALUES(?, ?, ?, ?, ?, ?)");
             PreparedStatement runAttempt = connection.prepareStatement(
                     "INSERT INTO run_attempts(seq, source, run_id, outcome, document) VALUES(?, ?, ?, ?, ?)")) {
            migration.setInt(1, STORAGE_SCHEMA_VERSION);
            migration.setString(2, root.path("saved_at").asText());
            migration.executeUpdate();
            putMetadata(metadata, "storage_schema_version", Integer.toString(STORAGE_SCHEMA_VERSION));
            putMetadata(metadata, "project_schema_version", root.path("schema_version").asText());
            putMetadata(metadata, "traffic_classifier_version", root.path("traffic_classifier_version").asText());
            putMetadata(metadata, "saved_at", root.path("saved_at").asText());
            putMetadata(metadata, "project_context", json.writeValueAsString(root.path("project")));

            int index = 0;
            for (JsonNode value : root.path("records")) {
                record.setInt(1, index++);
                setNullable(record, 2, value.get("evidence_id"));
                record.setString(3, required(value, "service"));
                record.setString(4, required(value, "source"));
                record.setString(5, required(value, "phase"));
                record.setString(6, required(value, "run_id"));
                record.setString(7, required(value, "method"));
                record.setString(8, required(value, "path"));
                record.setInt(9, value.path("status").asInt());
                record.setLong(10, value.path("timestamp").asLong());
                record.setString(11, required(value, "fingerprint"));
                record.setString(12, json.writeValueAsString(value));
                record.addBatch();
            }
            record.executeBatch();

            root.path("payloads").properties().forEach(entry -> {
                try {
                    payload.setString(1, entry.getKey());
                    payload.setBytes(2, Base64.getDecoder().decode(entry.getValue().asText()));
                    payload.addBatch();
                } catch (SQLException error) {
                    throw new SqlWriteFailure(error);
                }
            });
            payload.executeBatch();

            JsonNode policyRoot = root.path("policy");
            writePolicyEntries(policy, "identity_roles", policyRoot.path("identity_roles"));
            writePolicyEntries(policy, "endpoint_requirements", policyRoot.path("endpoint_requirements"));
            writePolicyEntries(policy, "resource_owners", policyRoot.path("resource_owners"));
            writePolicyEntries(policy, "resource_policies", policyRoot.path("resource_policies"));
            writePolicyEntries(policy, "traffic_overrides", policyRoot.path("traffic_overrides"));
            for (JsonNode value : policyRoot.path("accounts")) {
                account.setString(1, required(value, "id"));
                account.setString(2, required(value, "label"));
                account.setString(3, required(value, "service"));
                account.setString(4, required(value, "role"));
                account.addBatch();
            }
            account.executeBatch();
            for (JsonNode value : policyRoot.path("session_bindings")) {
                binding.setString(1, required(value, "service"));
                binding.setString(2, required(value, "fingerprint"));
                binding.setString(3, required(value, "account_id"));
                binding.addBatch();
            }
            binding.executeBatch();
            writeDocuments(root.path("reviews"), review, "item_id");
            writeDocuments(root.path("assessments"), assessment, "id");
            writeDocuments(root.path("validations"), validation, "candidate_id");
            for (JsonNode value : root.path("completed_lanes")) {
                lane.setString(1, value.asText());
                lane.addBatch();
            }
            lane.executeBatch();
            for (JsonNode value : root.path("completed_runs")) {
                completedRun.setString(1, required(value, "source"));
                completedRun.setString(2, required(value, "run_id"));
                completedRun.setString(3, json.writeValueAsString(value));
                completedRun.addBatch();
            }
            completedRun.executeBatch();
            index = 0;
            for (JsonNode value : root.path("route_candidates")) {
                candidate.setInt(1, index++);
                candidate.setString(2, required(value, "service"));
                candidate.setString(3, required(value, "method"));
                candidate.setString(4, required(value, "path_template"));
                candidate.setInt(5, value.path("observed").asBoolean() ? 1 : 0);
                candidate.setString(6, json.writeValueAsString(value));
                candidate.addBatch();
            }
            candidate.executeBatch();
            index = 0;
            for (JsonNode value : root.path("run_attempts")) {
                runAttempt.setInt(1, index++);
                runAttempt.setString(2, required(value, "source"));
                runAttempt.setString(3, required(value, "run_id"));
                runAttempt.setString(4, required(value, "outcome"));
                runAttempt.setString(5, json.writeValueAsString(value));
                runAttempt.addBatch();
            }
            runAttempt.executeBatch();
        } catch (SqlWriteFailure failure) {
            throw failure.cause;
        }
    }

    private ObjectNode read(Connection connection) throws SQLException, IOException {
        int version = Integer.parseInt(readMetadata(connection, "storage_schema_version"));
        if (version != STORAGE_SCHEMA_VERSION && version != 1 && version != 2) {
            throw new IllegalArgumentException("unsupported FlowScope SQLite schema version: " + version);
        }
        try (Statement statement = connection.createStatement();
             ResultSet migrations = statement.executeQuery("SELECT MAX(version) FROM schema_migrations")) {
            if (!migrations.next() || migrations.getInt(1) != version) {
                throw new IllegalArgumentException("inconsistent FlowScope SQLite migration state");
            }
        }
        ObjectNode root = json.createObjectNode();
        root.put("schema_version", Integer.parseInt(readMetadata(connection, "project_schema_version")));
        root.put("traffic_classifier_version", Integer.parseInt(readMetadata(connection, "traffic_classifier_version")));
        root.put("saved_at", readMetadata(connection, "saved_at"));
        String projectContext = readOptionalMetadata(connection, "project_context");
        if (projectContext != null) root.set("project", json.readTree(projectContext));
        ArrayNode records = root.putArray("records");
        readDocuments(connection, "SELECT document FROM records ORDER BY seq", records);
        ObjectNode payloads = root.putObject("payloads");
        try (Statement statement = connection.createStatement();
             ResultSet values = statement.executeQuery("SELECT digest, compressed FROM payloads ORDER BY digest")) {
            while (values.next()) payloads.put(values.getString(1), Base64.getEncoder().encodeToString(values.getBytes(2)));
        }
        ObjectNode policy = root.putObject("policy");
        readPolicyEntries(connection, policy, "identity_roles");
        readPolicyEntries(connection, policy, "endpoint_requirements");
        readPolicyEntries(connection, policy, "resource_owners");
        readPolicyEntries(connection, policy, "resource_policies");
        readPolicyEntries(connection, policy, "traffic_overrides");
        ArrayNode accounts = policy.putArray("accounts");
        try (Statement statement = connection.createStatement();
             ResultSet values = statement.executeQuery(
                     "SELECT account_id, label, service, role FROM accounts ORDER BY account_id")) {
            while (values.next()) {
                ObjectNode account = accounts.addObject();
                account.put("id", values.getString(1));
                account.put("label", values.getString(2));
                account.put("service", values.getString(3));
                account.put("role", values.getString(4));
            }
        }
        ArrayNode bindings = policy.putArray("session_bindings");
        try (Statement statement = connection.createStatement();
             ResultSet values = statement.executeQuery(
                     "SELECT service, fingerprint, account_id FROM session_bindings ORDER BY service, fingerprint")) {
            while (values.next()) {
                ObjectNode binding = bindings.addObject();
                binding.put("service", values.getString(1));
                binding.put("fingerprint", values.getString(2));
                binding.put("account_id", values.getString(3));
            }
        }
        readDocuments(connection, "SELECT document FROM reviews ORDER BY seq", root.putArray("reviews"));
        readDocuments(connection, "SELECT document FROM assessments ORDER BY seq", root.putArray("assessments"));
        readDocuments(connection, "SELECT document FROM validations ORDER BY seq", root.putArray("validations"));
        ArrayNode lanes = root.putArray("completed_lanes");
        try (Statement statement = connection.createStatement();
             ResultSet values = statement.executeQuery("SELECT source FROM completed_lanes ORDER BY source")) {
            while (values.next()) lanes.add(values.getString(1));
        }
        ArrayNode completedRuns = root.putArray("completed_runs");
        if (version >= 2) {
            readDocuments(connection, "SELECT document FROM completed_runs ORDER BY source", completedRuns);
        }
        readDocuments(connection, "SELECT document FROM route_candidates ORDER BY seq",
                root.putArray("route_candidates"));
        ArrayNode runAttempts = root.putArray("run_attempts");
        if (version >= 3) readDocuments(connection, "SELECT document FROM run_attempts ORDER BY seq", runAttempts);
        return root;
    }

    private void writeDocuments(JsonNode values, PreparedStatement statement, String idField)
            throws SQLException, IOException {
        int index = 0;
        for (JsonNode value : values) {
            statement.setInt(1, index++);
            statement.setString(2, required(value, idField));
            statement.setString(3, json.writeValueAsString(value));
            statement.addBatch();
        }
        statement.executeBatch();
    }

    private static void writePolicyEntries(PreparedStatement statement, String kind, JsonNode values)
            throws SQLException {
        for (var entry : values.properties()) {
            statement.setString(1, kind);
            statement.setString(2, entry.getKey());
            statement.setString(3, entry.getValue().asText());
            statement.addBatch();
        }
        statement.executeBatch();
    }

    private void readDocuments(Connection connection, String sql, ArrayNode target)
            throws SQLException, IOException {
        try (Statement statement = connection.createStatement(); ResultSet values = statement.executeQuery(sql)) {
            while (values.next()) target.add(json.readTree(values.getString(1)));
        }
    }

    private static void readPolicyEntries(Connection connection, ObjectNode policy, String kind)
            throws SQLException {
        ObjectNode target = policy.putObject(kind);
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT entry_key, entry_value FROM policy_entries WHERE kind=? ORDER BY entry_key")) {
            statement.setString(1, kind);
            try (ResultSet values = statement.executeQuery()) {
                while (values.next()) target.put(values.getString(1), values.getString(2));
            }
        }
    }

    private static void putMetadata(PreparedStatement statement, String key, String value) throws SQLException {
        statement.setString(1, key);
        statement.setString(2, value);
        statement.executeUpdate();
    }

    private static String readMetadata(Connection connection, String key) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT value FROM metadata WHERE key=?")) {
            statement.setString(1, key);
            try (ResultSet values = statement.executeQuery()) {
                if (!values.next()) throw new IllegalArgumentException("missing FlowScope SQLite metadata: " + key);
                return values.getString(1);
            }
        }
    }

    private static String readOptionalMetadata(Connection connection, String key) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT value FROM metadata WHERE key=?")) {
            statement.setString(1, key);
            try (ResultSet values = statement.executeQuery()) {
                return values.next() ? values.getString(1) : null;
            }
        }
    }

    private static String required(JsonNode value, String field) {
        String result = value.path(field).asText();
        if (result.isBlank()) throw new IllegalArgumentException(field + " is required");
        return result;
    }

    private static void setNullable(PreparedStatement statement, int index, JsonNode value) throws SQLException {
        if (value == null || value.isNull() || value.asText().isBlank()) statement.setNull(index, java.sql.Types.VARCHAR);
        else statement.setString(index, value.asText());
    }

    private static final class SqlWriteFailure extends RuntimeException {
        final SQLException cause;
        SqlWriteFailure(SQLException cause) { this.cause = cause; }
    }
}
