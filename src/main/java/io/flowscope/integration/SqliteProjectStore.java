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
    private static final int STORAGE_SCHEMA_VERSION = 4;
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
        save(target, records, config, assessments, validations, completedRuns, routeCandidates,
                runAttempts, context, GraphWorkspace.empty());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates, List<RunExecutionLedger.Attempt> runAttempts,
                     ProjectStore.ProjectContext context, GraphWorkspace graphWorkspace) throws IOException {
        save(target, records, config, assessments, validations, completedRuns, routeCandidates,
                runAttempts, context, graphWorkspace, RequestLabWorkspace.empty());
    }

    public void save(Path target, List<RequestRecord> records, AnalysisConfig config,
                     List<LegacyAssessment> assessments, List<ValidationDecision> validations,
                     Map<Source, RunContextRegistry.CompletedRun> completedRuns,
                     List<RouteCandidate> routeCandidates, List<RunExecutionLedger.Attempt> runAttempts,
                     ProjectStore.ProjectContext context, GraphWorkspace graphWorkspace,
                     RequestLabWorkspace requestLabWorkspace) throws IOException {
        Map<Source, RunContextRegistry.CompletedRun> runs = completedRuns == null ? Map.of() : completedRuns;
        ObjectNode root = codec.toDocument(records, config, assessments, validations,
                runs.keySet(), runs, routeCandidates, runAttempts, context, graphWorkspace, requestLabWorkspace);
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

    /** Layout-only checkpoint: transactionally update metadata without re-encoding traffic/payloads. */
    public void saveGraphWorkspace(Path target, GraphWorkspace workspace) throws IOException {
        Path absolute = target.toAbsolutePath().normalize();
        if (!Files.isRegularFile(absolute)) throw new IOException("project database is missing");
        try (Connection connection = connect(absolute)) {
            int version = Integer.parseInt(readMetadata(connection, "storage_schema_version"));
            if (version < 1 || version > STORAGE_SCHEMA_VERSION) {
                throw new IllegalArgumentException("지원하지 않는 DB 구조입니다(파일 버전: " + version
                        + ", 현재 지원: 1~" + STORAGE_SCHEMA_VERSION
                        + "). 이 형식을 지원하는 JAR로 다시 열어 주세요. 버전 번호를 직접 바꾸면 데이터가 누락될 수 있습니다.");
            }
            connection.setAutoCommit(false);
            try (PreparedStatement metadata = connection.prepareStatement(
                    "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)")) {
                putMetadata(metadata, "graph_workspace", json.writeValueAsString(workspace));
                putMetadata(metadata, "saved_at", java.time.Instant.now().toString());
                long pages, pageSize;
                try (Statement statement = connection.createStatement(); ResultSet count = statement.executeQuery("PRAGMA page_count")) {
                    count.next(); pages = count.getLong(1);
                }
                try (Statement statement = connection.createStatement(); ResultSet size = statement.executeQuery("PRAGMA page_size")) {
                    size.next(); pageSize = size.getLong(1);
                }
                if (pages * pageSize > MAX_FILE_BYTES) throw new IllegalArgumentException("project database exceeds 100 MiB");
                connection.commit();
            } catch (SQLException | IOException | RuntimeException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) { throw new IOException("FlowScope graph workspace save failed", error); }
    }

    private static void createRequestLabTables(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE IF NOT EXISTS request_lab_tabs (evidence_id TEXT PRIMARY KEY, next_id INTEGER NOT NULL, selected_id INTEGER NOT NULL)");
            statement.execute("CREATE TABLE IF NOT EXISTS request_lab_requests (evidence_id TEXT NOT NULL, request_id INTEGER NOT NULL, name TEXT NOT NULL, request TEXT NOT NULL, credential_mode TEXT NOT NULL, result TEXT, dirty INTEGER NOT NULL, PRIMARY KEY(evidence_id, request_id))");
        }
    }

    /** Caller serializes this with full checkpoints. Commit succeeds before publishing the new state. */
    public void saveRequestLabWorkspace(Path target, String evidenceId, RequestLabWorkspace previous,
                                        RequestLabWorkspace next) throws IOException {
        Path absolute = target.toAbsolutePath().normalize();
        if (!Files.isRegularFile(absolute)) throw new IOException("프로젝트 DB가 없습니다. 먼저 프로젝트를 저장해 주세요.");
        try (Connection connection = connect(absolute)) {
            int version = Integer.parseInt(readMetadata(connection, "storage_schema_version"));
            if (version < 1 || version > STORAGE_SCHEMA_VERSION) throw new IllegalArgumentException("지원하지 않는 DB 구조입니다.");
            try (Statement statement = connection.createStatement()) { statement.execute("PRAGMA secure_delete=ON"); }
            connection.setAutoCommit(false);
            try {
                String savedRevision = readOptionalMetadata(connection, "request_lab_revision");
                if ((savedRevision == null ? 0 : Long.parseLong(savedRevision)) != previous.revision()) {
                    throw new IllegalStateException("다른 창에서 Request Lab을 변경했습니다. 다시 열어 주세요.");
                }
                createRequestLabTables(connection);
                if (version < 4) {
                    // Fill structures absent from versions 1/2 before advertising the new schema.
                    try (Statement statement = connection.createStatement()) {
                        statement.execute("CREATE TABLE IF NOT EXISTS completed_runs (source TEXT PRIMARY KEY, run_id TEXT NOT NULL, document TEXT NOT NULL)");
                        statement.execute("CREATE TABLE IF NOT EXISTS run_attempts (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, run_id TEXT NOT NULL, outcome TEXT NOT NULL, document TEXT NOT NULL)");
                        statement.execute("CREATE INDEX IF NOT EXISTS run_attempts_run_idx ON run_attempts(source, run_id)");
                        if (Integer.parseInt(readMetadata(connection, "project_schema_version")) < 3) {
                            // Pre-v3 completion hints cannot become trusted exact runs during migration.
                            statement.executeUpdate("DELETE FROM completed_lanes");
                            statement.executeUpdate("DELETE FROM completed_runs");
                        }
                    }
                }
                writeRequestLabTab(connection, evidenceId, next.tab(evidenceId), previous.tab(evidenceId));
                try (PreparedStatement metadata = connection.prepareStatement("INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)")) {
                    if (readOptionalMetadata(connection, "project_context") == null) {
                        ObjectNode context = json.createObjectNode();
                        context.put("name", ""); context.putArray("scope"); context.put("created_at", java.time.Instant.EPOCH.toString());
                        putMetadata(metadata, "project_context", json.writeValueAsString(context));
                    }
                    putMetadata(metadata, "request_lab_revision", Long.toString(next.revision()));
                    putMetadata(metadata, "storage_schema_version", Integer.toString(STORAGE_SCHEMA_VERSION));
                    putMetadata(metadata, "project_schema_version", "9");
                    putMetadata(metadata, "saved_at", java.time.Instant.now().toString());
                }
                try (PreparedStatement migration = connection.prepareStatement("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)")) {
                    migration.setInt(1, STORAGE_SCHEMA_VERSION);
                    migration.setString(2, java.time.Instant.now().toString());
                    migration.executeUpdate();
                }
                try (Statement statement = connection.createStatement(); ResultSet size = statement.executeQuery("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()")) {
                    if (size.next() && size.getLong(1) > MAX_FILE_BYTES) throw new IllegalArgumentException("project database exceeds 100 MiB");
                }
                connection.commit();
            } catch (SQLException | IOException | RuntimeException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) { throw new IOException("Request Lab DB 저장에 실패했습니다.", error); }
    }

    private void writeRequestLabTab(Connection connection, String evidenceId, RequestLabWorkspace.Tab tab,
                                    RequestLabWorkspace.Tab previous) throws SQLException, IOException {
        try (PreparedStatement metadata = connection.prepareStatement("INSERT OR REPLACE INTO request_lab_tabs(evidence_id, next_id, selected_id) VALUES(?, ?, ?)");
             PreparedStatement remove = connection.prepareStatement("DELETE FROM request_lab_requests WHERE evidence_id=? AND request_id=?");
             PreparedStatement entry = connection.prepareStatement("INSERT INTO request_lab_requests(evidence_id, request_id, name, request, credential_mode, result, dirty) VALUES(?, ?, ?, ?, ?, ?, ?)")) {
            metadata.setString(1, evidenceId); metadata.setInt(2, tab.nextId()); metadata.setInt(3, tab.selectedId()); metadata.executeUpdate();
            if (previous != null) for (int id : previous.entries().keySet()) if (!tab.entries().containsKey(id)) {
                remove.setString(1, evidenceId); remove.setInt(2, id); remove.executeUpdate();
            }
            for (var value : tab.entries().entrySet()) {
                var next = value.getValue();
                var old = previous == null ? null : previous.entries().get(value.getKey());
                if (old == null) {
                    entry.setString(1, evidenceId); entry.setInt(2, value.getKey()); entry.setString(3, next.name());
                    entry.setString(4, next.request()); entry.setString(5, next.credentialMode());
                    entry.setString(6, next.result() == null ? null : json.writeValueAsString(next.result()));
                    entry.setInt(7, next.dirty() ? 1 : 0); entry.executeUpdate();
                } else {
                    // A name change never serializes/transmits the stored large HTTP columns.
                    if (!old.name().equals(next.name())) updateRequestLabColumn(connection, evidenceId, value.getKey(), "name", next.name());
                    if (!old.request().equals(next.request())) updateRequestLabColumn(connection, evidenceId, value.getKey(), "request", next.request());
                    if (!old.credentialMode().equals(next.credentialMode())) updateRequestLabColumn(connection, evidenceId, value.getKey(), "credential_mode", next.credentialMode());
                    if (!java.util.Objects.equals(old.result(), next.result())) updateRequestLabColumn(connection, evidenceId, value.getKey(), "result", next.result() == null ? null : json.writeValueAsString(next.result()));
                    if (old.dirty() != next.dirty()) updateRequestLabColumn(connection, evidenceId, value.getKey(), "dirty", next.dirty() ? "1" : "0");
                }
            }
        }
    }

    private static void updateRequestLabColumn(Connection connection, String evidenceId, int id,
                                               String column, String value) throws SQLException {
        // column comes only from the fixed internal calls above, never request input.
        try (PreparedStatement update = connection.prepareStatement("UPDATE request_lab_requests SET " + column + "=? WHERE evidence_id=? AND request_id=?")) {
            update.setString(1, value); update.setString(2, evidenceId); update.setInt(3, id);
            if (update.executeUpdate() != 1) throw new SQLException("Request Lab request is missing");
        }
    }

    private RequestLabWorkspace readRequestLabWorkspace(Connection connection) throws SQLException, IOException {
        var tabs = new java.util.LinkedHashMap<String, RequestLabWorkspace.Tab>();
        try (Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery("SELECT evidence_id,next_id,selected_id FROM request_lab_tabs")) {
            while (rows.next()) {
                var entries = new java.util.LinkedHashMap<Integer, RequestLabWorkspace.Entry>();
                try (PreparedStatement query = connection.prepareStatement("SELECT request_id,name,request,credential_mode,result,dirty FROM request_lab_requests WHERE evidence_id=? ORDER BY request_id")) {
                    query.setString(1, rows.getString(1));
                    try (ResultSet values = query.executeQuery()) {
                        while (values.next()) {
                            if (entries.size() >= 32) throw new IllegalArgumentException("Request Lab request limit exceeded");
                            String result = values.getString(5);
                            entries.put(values.getInt(1), new RequestLabWorkspace.Entry(values.getString(2), values.getString(3),
                                    values.getString(4), result == null ? null : json.readValue(result, RequestLabWorkspace.Result.class), values.getInt(6) != 0));
                        }
                    }
                }
                tabs.put(rows.getString(1), new RequestLabWorkspace.Tab(rows.getInt(2), rows.getInt(3), entries));
                if (tabs.size() > 20_000) throw new IllegalArgumentException("Request Lab Evidence limit exceeded");
            }
        }
        String revision = readOptionalMetadata(connection, "request_lab_revision");
        return new RequestLabWorkspace(revision == null ? 0 : Long.parseLong(revision), tabs);
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
            statement.execute("PRAGMA secure_delete=ON");
            createRequestLabTables(connection);
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
            putMetadata(metadata, "graph_workspace", json.writeValueAsString(root.path("graphWorkspace")));
            putMetadata(metadata, "api_state", json.writeValueAsString(root.path("api_state")));

            RequestLabWorkspace workspace = json.convertValue(root.path("requestLabWorkspace"), RequestLabWorkspace.class);
            putMetadata(metadata, "request_lab_revision", Long.toString(workspace.revision()));
            for (var tab : workspace.tabs().entrySet()) writeRequestLabTab(connection, tab.getKey(), tab.getValue(), null);
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
            for (JsonNode value : policyRoot.path("account_verification_rules")) {
                policy.setString(1, "account_verification_rules");
                policy.setString(2, required(value, "account_id"));
                policy.setString(3, json.writeValueAsString(value));
                policy.addBatch();
            }
            policy.executeBatch();
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
        if (version < 1 || version > STORAGE_SCHEMA_VERSION) {
            throw new IllegalArgumentException("지원하지 않는 DB 구조입니다(파일 버전: " + version
                    + ", 현재 지원: 1~" + STORAGE_SCHEMA_VERSION
                    + "). 이 형식을 지원하는 JAR로 다시 열어 주세요. 버전 번호를 직접 바꾸면 데이터가 누락될 수 있습니다.");
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
        String graphWorkspace = readOptionalMetadata(connection, "graph_workspace");
        if (graphWorkspace != null) root.set("graphWorkspace", json.readTree(graphWorkspace));
        String apiState = readOptionalMetadata(connection, "api_state");
        if (apiState != null) root.set("api_state", json.readTree(apiState));
        if (version >= 4) root.set("requestLabWorkspace", json.valueToTree(readRequestLabWorkspace(connection)));
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
        ArrayNode verificationRules = policy.putArray("account_verification_rules");
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT entry_value FROM policy_entries WHERE kind='account_verification_rules' ORDER BY entry_key");
             ResultSet values = statement.executeQuery()) {
            while (values.next()) verificationRules.add(json.readTree(values.getString(1)));
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
