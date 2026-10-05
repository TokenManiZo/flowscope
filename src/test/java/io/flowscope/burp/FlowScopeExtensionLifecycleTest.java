package io.flowscope.burp;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import burp.api.montoya.MontoyaApi;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlowScopeExtensionLifecycleTest {
    @TempDir Path temp;

    @Test
    void shutdownCheckpointsEvidenceAcceptedBeforeItsRebuildWasScheduled() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        SqliteProjectStore store = new SqliteProjectStore(new ProjectStore());
        Path database = temp.resolve("last-capture.flowscope.db");
        ProjectStore.ProjectContext context = context();
        store.save(database, List.of(), new AnalysisConfig(), List.of(), List.of(),
                Map.of(), List.of(), List.of(), context);
        field("activeProjectDatabase").set(extension, database);
        field("activeProjectContext").set(extension, context);
        ((AtomicLong) field("databaseSavedRevision").get(extension)).set(0);
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        RequestRecord lastCapture = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                "GET", "/last-evidence", 200, "anon");
        lastCapture.hasResponse = true;
        // Reproduce capture's handoff gap: the record is accepted, but unload wins
        // before scheduleRebuild can invalidate the analysis publication epoch.
        synchronized (records) { records.add(lastCapture); }
        try {
            invoke(extension, "shutdown");
            ProjectStore.ProjectData reopened = store.load(database);
            assertEquals(List.of("/last-evidence"), reopened.records().stream().map(record -> record.path).toList());
            assertEquals(1, ((Pipeline.Result) field("latest").get(extension)).records.size());
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void sampleReplacementReportsPreservationFailureBeforeReturning() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        Path parentFile = Files.createFile(temp.resolve("not-a-directory"));
        field("activeProjectDatabase").set(extension, parentFile.resolve("project.flowscope.db"));
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        RequestRecord original = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                "GET", "/saved-user-evidence", 200, "anon");
        records.add(original);
        try {
            InvocationTargetException failure = assertThrows(InvocationTargetException.class,
                    () -> invoke(extension, "loadSampleProject"));
            assertInstanceOf(IOException.class, failure.getCause());
            assertEquals(List.of(original), records);
            assertEquals(0, ((AtomicLong) field("datasetEpoch").get(extension)).get());
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void projectPreparationDoesNotHoldTheRecordMonitorAcrossCallbacks() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        Object records = field("records").get(extension);
        CountDownLatch preparing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<RequestRecord> loaded = new ArrayList<>() {
            @Override public void forEach(Consumer<? super RequestRecord> action) {
                preparing.countDown();
                try { release.await(); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new RuntimeException(error); }
                super.forEach(action);
            }
        };
        AnalysisConfig config = new AnalysisConfig();
        ProjectStore.ProjectData data = new ProjectStore.ProjectData(List.of(), config, List.of(), List.of(),
                Set.of(), Map.of(), List.of(), List.of(), context());
        Method install = FlowScopeExtension.class.getDeclaredMethod("applyLoadedProject", ProjectStore.ProjectData.class,
                List.class, Pipeline.Result.class, ScopePolicy.class, ProjectStore.ProjectContext.class, Path.class);
        install.setAccessible(true);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var installation = executor.submit(() -> install.invoke(extension, data, loaded,
                    Pipeline.runIsolated(List.of(), config), ScopePolicy.parse("https://api.example.test"),
                    context(), temp.resolve("loaded.flowscope.db")));
            try {
                assertTrue(preparing.await(2, TimeUnit.SECONDS));
                CountDownLatch recordsAvailable = new CountDownLatch(1);
                executor.submit(() -> { synchronized (records) { recordsAvailable.countDown(); } });
                assertTrue(recordsAvailable.await(1, TimeUnit.SECONDS),
                        "dataset preparation must not block a completion callback that needs the record monitor");
            } finally {
                release.countDown();
                installation.get(2, TimeUnit.SECONDS);
            }
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void controlledToolRecordIsRejectedAfterShutdownBegins() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        ((AtomicBoolean) field("shuttingDown").get(extension)).set(true);
        RequestRecord late = new RequestRecord(Source.LLM, "https://api.example.test:443",
                "GET", "/late-tool-response", 200, "anon");
        AtomicBoolean retained = new AtomicBoolean(false);
        try {
            assertThrows(IllegalStateException.class,
                    () -> extension.appendControlledToolRecord(late, () -> retained.set(true)));
            assertTrue(records.isEmpty());
            assertEquals(false, retained.get());
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void requestLabResponseIsNotRecordedIntoAProjectOpenedDuringTheSend() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        long epochAtSend = ((AtomicLong) field("datasetEpoch").get(extension)).get();
        ((AtomicLong) field("datasetEpoch").get(extension)).incrementAndGet();
        RequestRecord late = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                "GET", "/orders/7", 200, "anon");
        AtomicBoolean retained = new AtomicBoolean(false);
        try {
            assertThrows(FlowScopeExtension.DatasetReplacedException.class,
                    () -> extension.appendRequestLabRecord(late, epochAtSend, () -> retained.set(true)));
            assertTrue(records.isEmpty());
            assertEquals(false, retained.get());
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void newProxyRecordsDoNotDiscardTheAnalysisAlreadyRunningButConfigChangesDo() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        AnalysisPublicationGate gate = (AnalysisPublicationGate) field("analysisPublication").get(extension);
        try {
            long running = gate.current();
            java.lang.reflect.Method forRecords = FlowScopeExtension.class.getDeclaredMethod("scheduleRebuildForNewRecords");
            forRecords.setAccessible(true);
            forRecords.invoke(extension);
            // Continuous traffic (e.g. notification polling) must not keep throwing away every finished analysis.
            assertEquals(running, gate.current());

            java.lang.reflect.Method rebuild = FlowScopeExtension.class.getDeclaredMethod("scheduleRebuild");
            rebuild.setAccessible(true);
            rebuild.invoke(extension);
            assertTrue(gate.current() > running);
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void requestLabEvidenceIdSurvivesLosingThePublicationRace() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        AnalysisPublicationGate gate = (AnalysisPublicationGate) field("analysisPublication").get(extension);
        // A proxy capture lands while the Request Lab rebuild copies the records: its epoch bump wins publication.
        List<RequestRecord> racing = new ArrayList<>() {
            private boolean raced;
            @Override public Object[] toArray() {
                if (!raced) { raced = true; gate.invalidate(); }
                return super.toArray();
            }
        };
        field("records").set(extension, racing);
        RequestRecord manual = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                "GET", "/orders/7", 200, "anon");
        manual.hasResponse = true;
        try {
            extension.appendRequestLabRecord(manual, 0, () -> {});
            RequestRecord analyzed = extension.analyzedRecord(manual);
            assertTrue(analyzed.evidenceId != null && !analyzed.evidenceId.isBlank());
            assertTrue(((Pipeline.Result) field("latest").get(extension)).records.isEmpty(), "the racing rebuild owns publication");
            RequestRecord republished = extension.analyzedRecord(manual);
            assertEquals(analyzed.evidenceId, republished.evidenceId);
            assertEquals(List.of(analyzed.evidenceId),
                    ((Pipeline.Result) field("latest").get(extension)).records.stream().map(record -> record.evidenceId).toList());
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void projectOpenRequestedAfterShutdownIsNotQueued() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        try {
            invoke(extension, "shutdown");
            assertDoesNotThrow(() -> invoke(extension, "loadProjectFile",
                    new Class<?>[]{java.io.File.class}, temp.resolve("not-opened.db").toFile()));
            assertEquals(null, field("activeProjectDatabase").get(extension));
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void shutdownWinnerDiscardsAPreparedProjectCandidate() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        RequestRecord current = new RequestRecord(Source.HUMAN, "https://current.test:443",
                "GET", "/current", 200, "anon");
        records.add(current);
        ((AtomicBoolean) field("shuttingDown").get(extension)).set(true);
        AnalysisConfig candidateConfig = new AnalysisConfig();
        RequestRecord candidate = new RequestRecord(Source.HUMAN, "https://candidate.test:443",
                "GET", "/candidate", 200, "anon");
        ProjectStore.ProjectData data = new ProjectStore.ProjectData(List.of(candidate), candidateConfig,
                List.of(), List.of(), Set.of(), Map.of(), List.of(), List.of(), context());
        Method apply = FlowScopeExtension.class.getDeclaredMethod("applyLoadedProject",
                ProjectStore.ProjectData.class, List.class, Pipeline.Result.class, ScopePolicy.class,
                ProjectStore.ProjectContext.class, Path.class);
        apply.setAccessible(true);
        try {
            assertEquals(false, apply.invoke(extension, data, new ArrayList<>(data.records()),
                    Pipeline.runIsolated(data.records(), candidateConfig),
                    ScopePolicy.parse("https://candidate.test"), context(), temp.resolve("candidate.db")));
            assertEquals(List.of(current), records);
        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    @Test
    void successfulProjectOpenInstallsTheCandidateDatabase() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        field("api").set(extension, loggingApi());
        ScheduledExecutorService worker = (ScheduledExecutorService) field("worker").get(extension);
        Path database = temp.resolve("candidate.flowscope.db");
        AnalysisConfig config = new AnalysisConfig().upsertAccount(new io.flowscope.core.AccountProfile(
                "acct-candidate", "Candidate", "https://api.example.test:443",
                io.flowscope.core.AccessRole.USER));
        RequestRecord candidate = new RequestRecord(Source.HUMAN, "https://api.example.test:443",
                "GET", "/candidate", 200, "anon");
        candidate.hasResponse = true;
        ProjectStore.ProjectContext candidateContext = new ProjectStore.ProjectContext(
                "Candidate", List.of("https://api.example.test"), Instant.EPOCH);
        new SqliteProjectStore(new ProjectStore()).save(database, List.of(candidate), config,
                List.of(), List.of(), Map.of(), List.of(), List.of(), candidateContext);
        try {
            invoke(extension, "loadProjectFile", new Class<?>[]{java.io.File.class}, database.toFile());
            worker.submit(() -> { }).get(5, TimeUnit.SECONDS);
            assertEquals(database.toAbsolutePath(), field("activeProjectDatabase").get(extension));
            @SuppressWarnings("unchecked")
            List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
            assertEquals(List.of("/candidate"), records.stream().map(record -> record.path).toList());
            assertEquals("Candidate", ((AnalysisConfig) field("analysisConfig").get(extension))
                    .account("acct-candidate").orElseThrow().label());
        } finally {
            worker.shutdownNow();
        }
    }

    @Test
    void accountPauseActuallySuppressesRecordsAndLateResponsesThenResumeCollectsAgain() throws Exception {
        FlowScopeExtension extension = new FlowScopeExtension();
        field("api").set(extension, loggingApi());
        field("scope").set(extension, ScopePolicy.parse("https://api.example.test/"));
        var contexts = (io.flowscope.core.RunContextRegistry) field("runContexts").get(extension);
        var a = new io.flowscope.core.RunContextRegistry.Context(io.flowscope.core.SourceDetail.BROWSER,
                io.flowscope.core.Orchestrator.HUMAN, io.flowscope.core.ToolKind.BROWSER,
                io.flowscope.core.RunPhase.EXPLORATION, "a", "A");
        var b = new io.flowscope.core.RunContextRegistry.Context(io.flowscope.core.SourceDetail.BROWSER,
                io.flowscope.core.Orchestrator.HUMAN, io.flowscope.core.ToolKind.BROWSER,
                io.flowscope.core.RunPhase.EXPLORATION, "b", "B");
        contexts.activateHuman(a);
        contexts.activateHuman(b);
        var profile = new FlowScopeExtension.PortProfile(Source.HUMAN, io.flowscope.core.SourceDetail.BROWSER);
        var tracker = new InFlightRequestTracker(10, 60_000);
        Method remember = FlowScopeExtension.class.getDeclaredMethod("rememberObservation", InFlightRequestTracker.class,
                int.class, io.flowscope.core.RunContextRegistry.Context.class, String.class, boolean.class,
                String.class, FlowScopeExtension.PortProfile.class, int.class);
        remember.setAccessible(true);
        Method capture = FlowScopeExtension.class.getDeclaredMethod("capture",
                burp.api.montoya.http.message.requests.HttpRequest.class,
                burp.api.montoya.http.message.responses.HttpResponse.class,
                FlowScopeExtension.PortProfile.class, InFlightRequestTracker.Observation.class);
        capture.setAccessible(true);
        var request = (burp.api.montoya.http.message.requests.HttpRequest) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{burp.api.montoya.http.message.requests.HttpRequest.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "url" -> "https://api.example.test/orders";
                    case "method" -> "GET";
                    case "pathWithoutQuery" -> "/orders";
                    case "query" -> "";
                    case "headers" -> List.of();
                    case "bodyOffset" -> 0;
                    case "toByteArray" -> testMessageBytes("GET /orders HTTP/1.1\r\n\r\n");
                    case "httpService" -> null;
                    case "headerValue" -> null;
                    default -> throw new AssertionError(method.getName());
                });
        var response = (burp.api.montoya.http.message.responses.HttpResponse) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{burp.api.montoya.http.message.responses.HttpResponse.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "statusCode" -> (short) 200;
                    case "bodyOffset" -> 0;
                    case "headerValue" -> "Content-Type".equals(args[0]) ? "application/json" : null;
                    case "toByteArray" -> testMessageBytes("HTTP/1.1 200 OK\r\n\r\n{}");
                    default -> throw new AssertionError(method.getName());
                });
        @SuppressWarnings("unchecked")
        List<RequestRecord> records = (List<RequestRecord>) field("records").get(extension);
        try {
            remember.invoke(extension, tracker, 1, a, null, true, "test", profile, 18080);
            assertEquals(true, capture.invoke(extension, request, response, profile, tracker.remove(1)));
            remember.invoke(extension, tracker, 2, a, null, true, "test", profile, 18080);
            contexts.pauseHuman("a", true);
            remember.invoke(extension, tracker, 3, a, null, true, "test", profile, 18080);
            var pausedRequest = tracker.remove(3);
            assertEquals(false, capture.invoke(extension, request, response, profile, pausedRequest));
            remember.invoke(extension, tracker, 4, b, null, true, "test", profile, 18081);
            assertEquals(true, capture.invoke(extension, request, response, profile, tracker.remove(4)));
            contexts.pauseHuman("a", false);
            assertEquals(false, capture.invoke(extension, request, response, profile, tracker.remove(2)));
            assertEquals(false, capture.invoke(extension, request, response, profile, pausedRequest));
            remember.invoke(extension, tracker, 5, a, null, true, "test", profile, 18080);
            assertEquals(true, capture.invoke(extension, request, response, profile, tracker.remove(5)));
            remember.invoke(extension, tracker, 6, a, null, true, "test", profile, 18080);
            contexts.abort(Source.HUMAN, "a");
            assertEquals(false, capture.invoke(extension, request, response, profile, tracker.remove(6)));
            assertEquals(List.of("a", "b", "a"), records.stream().map(record -> record.runId).toList());
            // Pause must wait for a response already committing, then reject every later response.
            contexts.activateHuman(a);
            var committing = new CountDownLatch(1);
            var releaseCommit = new CountDownLatch(1);
            List<RequestRecord> blockedRecords = new ArrayList<>() {
                @Override public boolean add(RequestRecord value) {
                    committing.countDown();
                    try { releaseCommit.await(); }
                    catch (InterruptedException error) { throw new RuntimeException(error); }
                    return super.add(value);
                }
            };
            field("records").set(extension, blockedRecords);
            remember.invoke(extension, tracker, 7, a, null, true, "test", profile, 18080);
            var committingObservation = tracker.remove(7);
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var saving = executor.submit(() -> capture.invoke(extension, request, response, profile, committingObservation));
                assertTrue(committing.await(2, TimeUnit.SECONDS));
                var pauseStarted = new CountDownLatch(1);
                var pausing = executor.submit(() -> { pauseStarted.countDown(); contexts.pauseHuman("a", true); });
                try {
                    assertTrue(pauseStarted.await(2, TimeUnit.SECONDS));
                    assertThrows(java.util.concurrent.TimeoutException.class, () -> pausing.get(100, TimeUnit.MILLISECONDS));
                } finally { releaseCommit.countDown(); }
                assertEquals(true, saving.get(2, TimeUnit.SECONDS));
                pausing.get(2, TimeUnit.SECONDS);
                assertEquals(false, capture.invoke(extension, request, response, profile, committingObservation));
                assertEquals(1, blockedRecords.size());
            }

        } finally {
            ((ScheduledExecutorService) field("worker").get(extension)).shutdownNow();
        }
    }

    private static burp.api.montoya.core.ByteArray testMessageBytes(String text) {
        byte[] bytes = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return (burp.api.montoya.core.ByteArray) Proxy.newProxyInstance(
                FlowScopeExtensionLifecycleTest.class.getClassLoader(), new Class<?>[]{burp.api.montoya.core.ByteArray.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "length" -> bytes.length;
                    case "getBytes" -> bytes.clone();
                    default -> throw new AssertionError(method.getName());
                });
    }

    private static ProjectStore.ProjectContext context() {
        return new ProjectStore.ProjectContext("Lifecycle regression", List.of("https://api.example.test"), Instant.EPOCH);
    }

    private static Field field(String name) throws Exception {
        Field field = FlowScopeExtension.class.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    private static void invoke(FlowScopeExtension extension, String name) throws Exception {
        Method method = FlowScopeExtension.class.getDeclaredMethod(name);
        method.setAccessible(true);
        method.invoke(extension);
    }

    private static void invoke(FlowScopeExtension extension, String name,
                               Class<?>[] parameterTypes, Object... arguments) throws Exception {
        Method method = FlowScopeExtension.class.getDeclaredMethod(name, parameterTypes);
        method.setAccessible(true);
        method.invoke(extension, arguments);
    }

    private static MontoyaApi loggingApi() {
        return (MontoyaApi) Proxy.newProxyInstance(MontoyaApi.class.getClassLoader(),
                new Class<?>[]{MontoyaApi.class}, (proxy, method, args) -> {
                    if (!method.getName().equals("logging")) throw new AssertionError(method.getName());
                    Class<?> type = method.getReturnType();
                    return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type},
                            (logging, call, values) -> null);
                });
    }
}
