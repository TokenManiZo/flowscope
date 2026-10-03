package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.HarParser;
import io.flowscope.core.Masking;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RouteCandidate;
import io.flowscope.core.RouteCandidateExtractor;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.SampleProject;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.core.ValidationDecision;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.GraphWorkspace;
import io.flowscope.integration.ProjectWorkspace;
import io.flowscope.integration.RunExecutionLedger;
import io.flowscope.integration.SqliteProjectStore;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.web.FlowScopeWebServer;
import io.flowscope.core.discovery.JavascriptCallSiteAnalyzer;

import java.awt.Desktop;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;

/** Burp 없이 같은 Web UI를 확인하는 로컬 데모. 네트워크 대상 요청은 만들지 않는다. */
public final class Standalone {
    public static void main(String[] args) throws Exception {
        DemoState state = new DemoState(args);
        try (FlowScopeWebServer server = new FlowScopeWebServer(state,
                Integer.getInteger("flowscope.web.port", 17777))) {
            server.start();
            System.out.println("FlowScope Web UI: " + server.url());
            if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(URI.create(server.url()));
            new CountDownLatch(1).await();
        } finally {
            JavascriptCallSiteAnalyzer.clearCache();
        }
    }

    static final class DemoState implements FlowScopeWebServer.State {
        private final AnalysisConfig config = new AnalysisConfig();
        private final List<RequestRecord> records = new ArrayList<>();
        private final AtomicLong revision = new AtomicLong();
        private final AtomicLong datasetRevision = new AtomicLong();
        private final RunContextRegistry contexts = new RunContextRegistry();
        private final RunExecutionLedger executionLedger = new RunExecutionLedger();
        private final ProjectWorkspace projectWorkspace;
        private final ProjectStore projectStore = new ProjectStore();
        private final SqliteProjectStore sqliteProjectStore = new SqliteProjectStore(projectStore);
        private volatile Pipeline.Result result;
        private volatile List<RouteCandidate> routeCandidates = List.of();
        private volatile List<LegacyAssessment> archivedAssessments = List.of();
        private volatile List<ValidationDecision> archivedValidations = List.of();
        private volatile Path activeProjectDatabase;
        private volatile ProjectStore.ProjectContext activeProjectContext = ProjectStore.ProjectContext.empty();
        private volatile long savedRevision = -1;
        private GraphWorkspace graphWorkspace = GraphWorkspace.empty();
        private long graphWorkspaceRevision;
        private volatile Instant lastSavedAt;

        DemoState(String[] args) throws Exception {
            this(args, ProjectWorkspace.defaultWorkspace());
        }

        DemoState(String[] args, ProjectWorkspace projectWorkspace) throws Exception {
            this.projectWorkspace = projectWorkspace;
            if (args.length >= 2) {
                records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[0])), Source.HUMAN));
                records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[1])), Source.SCANNER));
                if (args.length >= 3) records.addAll(BurpXmlParser.parse(Files.readAllBytes(Path.of(args[2])), Source.LLM));
            } else {
                replaceWithSample();
            }
            rebuild();
        }

        @Override public Pipeline.Result snapshot() { return result; }
        @Override public long revision() { return revision.get(); }
        @Override public long datasetRevision() { return datasetRevision.get(); }
        @Override public synchronized GraphWorkspace.State graphWorkspace() {
            return new GraphWorkspace.State(datasetRevision.get(), graphWorkspaceRevision, graphWorkspace);
        }
        @Override public synchronized GraphWorkspace.State updateGraphWorkspace(
                long expectedDataset, long expectedRevision, GraphWorkspace.Change change) {
            if (expectedDataset != datasetRevision.get() || expectedRevision != graphWorkspaceRevision) {
                throw new IllegalStateException("프로젝트 또는 그래프 배치가 변경되었습니다. 다시 불러와 주세요.");
            }
            GraphWorkspace next = change.apply(graphWorkspace);
            if (activeProjectDatabase != null) {
                try {
                    sqliteProjectStore.saveGraphWorkspace(activeProjectDatabase, next);
                    lastSavedAt = Instant.now();
                } catch (Exception error) {
                    throw projectFailure("그래프 배치 저장에 실패했습니다.", error);
                }
            }
            graphWorkspace = next;
            graphWorkspaceRevision++;
            return graphWorkspace();
        }
        @Override public AnalysisConfig config() { return config; }
        @Override public List<LegacyAssessment> assessments() { return archivedAssessments; }
        @Override public List<ValidationDecision> validations() { return archivedValidations; }
        @Override public RunContextRegistry contexts() { return contexts; }
        @Override public List<RunExecutionLedger.Summary> executionSummaries() {
            return executionLedger.summaries();
        }
        @Override public List<RunExecutionLedger.Attempt> manualAttempts() {
            return executionLedger.attempts().stream().filter(attempt -> attempt.originEvidenceId() != null).toList();
        }
        @Override public List<RouteCandidate> routeCandidates() { return routeCandidates; }
        @Override public ExplorerCoordinator.Snapshot explorerStatus() {
            return new ExplorerCoordinator.Snapshot(ExplorerCoordinator.Status.IDLE, "", "", null, null,
                    0, "Standalone 데모에서는 LLM Explorer를 실행할 수 없습니다.", "UNAVAILABLE",
                    List.of(), false, 0, 0, 0, 0, 0, List.of(), List.of());
        }
        @Override public void rebuild() {
            result = Pipeline.runIsolated(new ArrayList<>(records), config);
            String services = result.records.stream().map(record -> record.service + "/")
                    .distinct().collect(java.util.stream.Collectors.joining("\n"));
            routeCandidates = services.isBlank() ? List.of() : RouteCandidateExtractor.extract(
                    result.records, ScopePolicy.parse(services), List.of());
            revision.incrementAndGet();
        }
        @Override public synchronized void loadSample() {
            replaceWithSample();
            replaceGraphWorkspace(GraphWorkspace.empty());
            archivedAssessments = List.of();
            archivedValidations = List.of();
            contexts.reset();
            executionLedger.clear();
            JavascriptCallSiteAnalyzer.clearCache();
            datasetRevision.incrementAndGet();
            rebuild();
            saveActive();
        }
        @Override public synchronized BurpXmlParser.ParseResult importXml(byte[] xml, Source source) throws Exception {
            BurpXmlParser.ParseResult parsed = BurpXmlParser.parseDetailed(xml, source);
            records.addAll(parsed.records);
            rebuild();
            saveActive();
            return parsed;
        }
        @Override public synchronized BurpXmlParser.ParseResult importHar(byte[] har) {
            BurpXmlParser.ParseResult parsed = HarParser.parseDetailed(har);
            records.addAll(parsed.records);
            rebuild();
            saveActive();
            return parsed;
        }
        @Override public synchronized List<String> scopeEntries() {
            if (activeProjectContext.present()) return activeProjectContext.scope();
            return records.stream().map(record -> record.service).filter(value -> value != null && !value.isBlank())
                    .distinct().map(value -> value + "/").toList();
        }
        @Override public synchronized ProjectWorkspace.Status projectStatus() {
            ProjectWorkspace.Status status = projectWorkspace.status(
                    activeProjectDatabase, activeProjectContext, sqliteProjectStore);
            return status.withPersistence(activeProjectDatabase == null ? "UNMANAGED" : "SAVED",
                    lastSavedAt == null ? "" : lastSavedAt.toString(), "");
        }
        @Override public synchronized ProjectWorkspace.Status startProject(String name, String scope) {
            try {
                preserveCurrentProject();
                ProjectWorkspace.Allocation next = projectWorkspace.allocate(name, scope);
                try {
                    sqliteProjectStore.save(next.database(), List.of(), new AnalysisConfig(), List.of(), List.of(),
                            Map.of(), List.of(), List.of(), next.context());
                } catch (Exception error) {
                    projectWorkspace.removeEmptyAllocation(next);
                    throw error;
                }
                records.clear();
                config.replaceWith(new AnalysisConfig());
                archivedAssessments = List.of();
                archivedValidations = List.of();
                contexts.reset();
                executionLedger.clear();
                routeCandidates = List.of();
                activeProjectDatabase = next.database();
                activeProjectContext = next.context();
                replaceGraphWorkspace(GraphWorkspace.empty());
                datasetRevision.incrementAndGet();
                rebuild();
                markSaved();
                return projectStatus();
            } catch (Exception error) {
                throw projectFailure("새 진단 시작에 실패했습니다.", error);
            }
        }
        @Override public synchronized ProjectWorkspace.Status openProject(String id) {
            try {
                Path database = projectWorkspace.resolveDatabase(id);
                if (database.equals(activeProjectDatabase)) preserveCurrentProject();
                ProjectStore.ProjectData loaded = sqliteProjectStore.load(database);
                if (!database.equals(activeProjectDatabase)) preserveCurrentProject();
                records.clear();
                records.addAll(loaded.records());
                config.replaceWith(loaded.config());
                archivedAssessments = List.copyOf(loaded.assessments());
                archivedValidations = List.copyOf(loaded.validations());
                contexts.restoreCompletedRuns(loaded.completedRuns());
                executionLedger.replace(loaded.runAttempts());
                activeProjectDatabase = database;
                activeProjectContext = loaded.context();
                replaceGraphWorkspace(loaded.graphWorkspace());
                result = Pipeline.runIsolated(new ArrayList<>(records), config);
                routeCandidates = List.copyOf(loaded.routeCandidates());
                datasetRevision.incrementAndGet();
                revision.incrementAndGet();
                markSaved();
                return projectStatus();
            } catch (Exception error) {
                throw projectFailure("프로젝트 열기에 실패했습니다.", error);
            }
        }
        @Override public synchronized ProjectWorkspace.Status updateProject(String name, String scope) {
            if (activeProjectDatabase == null) throw new IllegalStateException("수정할 현재 프로젝트가 없습니다.");
            ProjectStore.ProjectContext next = ProjectWorkspace.updatedContext(activeProjectContext, name, scope);
            try {
                activeProjectContext = next;
                saveProject(activeProjectDatabase, activeProjectContext);
                markSaved();
                return projectStatus();
            } catch (Exception error) {
                throw projectFailure("프로젝트 수정에 실패했습니다.", error);
            }
        }
        @Override public synchronized ProjectWorkspace.Status resetProjectTraffic() {
            if (activeProjectDatabase == null) throw new IllegalStateException("초기화할 현재 프로젝트가 없습니다.");
            try {
                AnalysisConfig retainedConfig = config.snapshotCopy();
                retainedConfig.clearSessionBindings();
                retainedConfig.clearReviews();
                sqliteProjectStore.save(activeProjectDatabase, List.of(), retainedConfig, List.of(), List.of(),
                        Map.of(), List.of(), List.of(), activeProjectContext);
                records.clear();
                config.replaceWith(retainedConfig);
                archivedAssessments = List.of();
                archivedValidations = List.of();
                contexts.reset();
                executionLedger.clear();
                routeCandidates = List.of();
                JavascriptCallSiteAnalyzer.clearCache();
                replaceGraphWorkspace(GraphWorkspace.empty());
                datasetRevision.incrementAndGet();
                rebuild();
                markSaved();
                return projectStatus();
            } catch (Exception error) {
                throw projectFailure("트래픽 초기화에 실패했습니다.", error);
            }
        }
        @Override public synchronized ProjectWorkspace.Status deleteProject(String id) {
            try {
                projectWorkspace.delete(id, activeProjectDatabase);
                return projectStatus();
            } catch (Exception error) {
                throw projectFailure("프로젝트 삭제에 실패했습니다.", error);
            }
        }
        @Override public RequestRecord openInRepeater(String evidenceId, String request,
                                                      FlowScopeWebServer.CredentialMode credentialMode,
                                                      String accountId) {
            throw new IllegalStateException("Repeater 초안은 Burp Extension에서만 열 수 있습니다.");
        }
        @Override public FlowScopeWebServer.RequestLabDraft requestLabDraft(String evidenceId) {
            RequestRecord record = result.records.stream()
                    .filter(candidate -> candidate.evidenceId.equals(evidenceId))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("해당 Evidence를 찾을 수 없습니다."));
            String request = Masking.maskHeaders(record.requestTextForEvidence());
            String response = Masking.maskHeaders(record.responseTextForEvidence());
            return new FlowScopeWebServer.RequestLabDraft(record.evidenceId, record.service,
                    request, response, false, false, false,
                    request == null ? null : "UTF-8", response == null ? null : "UTF-8",
                    record.idn == null || record.idn.isBlank() ? "미확정" : record.idn, "없음", "",
                    "Standalone 데모에서는 마스킹된 읽기 전용 초안만 제공하며 Request Lab 전송을 사용할 수 없습니다.");
        }
        @Override public FlowScopeWebServer.RequestLabResult sendRequestLab(
                String evidenceId, String request, FlowScopeWebServer.CredentialMode credentialMode,
                String accountId) {
            throw new UnsupportedOperationException("Standalone 데모에서는 Request Lab 전송을 사용할 수 없습니다.");
        }

        private void replaceWithSample() {
            SampleProject.Data sample = SampleProject.create();
            records.clear();
            records.addAll(sample.records());
            config.replaceWith(sample.config());
        }

        private void preserveCurrentProject() throws Exception {
            if (isSampleDataset()) return;
            if (activeProjectDatabase != null) {
                if (savedRevision != revision.get()) saveProject(activeProjectDatabase, activeProjectContext);
                return;
            }
            if (records.isEmpty() && routeCandidates.isEmpty()) return;
            String scope = String.join("\n", scopeEntries());
            if (scope.isBlank()) throw new IllegalStateException("현재 진단을 보존할 scope를 확정할 수 없습니다.");
            ProjectWorkspace.Allocation archive = projectWorkspace.allocate("", scope);
            try { saveProject(archive.database(), archive.context()); }
            catch (Exception error) {
                projectWorkspace.removeEmptyAllocation(archive);
                throw error;
            }
        }

        private void saveActive() {
            if (activeProjectDatabase == null) return;
            try { saveProject(activeProjectDatabase, activeProjectContext); }
            catch (Exception error) { throw projectFailure("프로젝트 저장에 실패했습니다.", error); }
        }

        private void saveProject(Path database, ProjectStore.ProjectContext context) throws Exception {
            sqliteProjectStore.save(database, new ArrayList<>(records), config,
                    archivedAssessments, archivedValidations, contexts.completedRuns(),
                    routeCandidates, executionLedger.attempts(), context, graphWorkspace);
            markSaved();
        }

        private void markSaved() {
            savedRevision = revision.get();
            lastSavedAt = Instant.now();
        }

        private void replaceGraphWorkspace(GraphWorkspace workspace) {
            graphWorkspace = workspace;
            graphWorkspaceRevision++;
        }

        private boolean isSampleDataset() {
            return !records.isEmpty() && records.stream().allMatch(record ->
                    "https://demo.flowscope.test:443".equals(record.service)
                            && record.runId != null && record.runId.startsWith("demo-"));
        }

        private static IllegalStateException projectFailure(String message, Exception error) {
            return new IllegalStateException(error.getMessage() == null ? message : error.getMessage(), error);
        }
    }
}
