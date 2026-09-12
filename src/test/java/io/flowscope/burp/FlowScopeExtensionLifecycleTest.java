package io.flowscope.burp;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.ScopePolicy;
import io.flowscope.core.Source;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
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
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
}
