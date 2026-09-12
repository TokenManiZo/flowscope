package io.flowscope;

import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/** Runs without product dependencies on the host classpath; never preloads the SQLite driver. */
public final class SqliteProjectStoreIsolationProbe {
    public static void main(String[] args) throws Exception {
        URL[] entries = Arrays.stream(args[0].split(File.pathSeparator))
                .map(Path::of).map(path -> {
                    try { return path.toUri().toURL(); }
                    catch (java.net.MalformedURLException error) { throw new IllegalArgumentException(error); }
                }).toArray(URL[]::new);
        verify(entries, Path.of(args[1]));
        System.out.println("SQLite project save/load: two isolated extension loaders passed");
    }

    static void verify(URL[] entries, Path directory) throws Exception {
        // Burp may initialize JDBC before loading any extension. Do not change its context loader.
        DriverManager.drivers().count();
        ClassLoader context = Thread.currentThread().getContextClassLoader();
        Path database = directory.resolve("isolated.flowscope.db");
        try (URLClassLoader first = new URLClassLoader(entries, ClassLoader.getPlatformClassLoader());
             URLClassLoader second = new URLClassLoader(entries, ClassLoader.getPlatformClassLoader())) {
            Object firstStore = store(first);
            Object secondStore = store(second);
            String firstId = save(first, firstStore, database, "/first");
            assertLoaded(firstStore, database, "/first", firstId);
            assertLoaded(secondStore, database, "/first", firstId);
            String secondId = save(second, secondStore, database, "/second");
            assertLoaded(firstStore, database, "/second", secondId);
            assertLoaded(secondStore, database, "/second", secondId);
            if (Thread.currentThread().getContextClassLoader() != context) {
                throw new AssertionError("Project storage changed the host context classloader");
            }
        } finally {
            Files.deleteIfExists(database);
        }
    }

    private static Object store(ClassLoader loader) throws Exception {
        Class<?> codec = Class.forName("io.flowscope.integration.ProjectStore", true, loader);
        return Class.forName("io.flowscope.integration.SqliteProjectStore", true, loader)
                .getConstructor(codec).newInstance(codec.getConstructor().newInstance());
    }

    private static String save(ClassLoader loader, Object store, Path database, String path) throws Exception {
        Class<?> source = Class.forName("io.flowscope.core.Source", true, loader);
        Class<?> config = Class.forName("io.flowscope.core.AnalysisConfig", true, loader);
        Object record = Class.forName("io.flowscope.core.RequestRecord", true, loader)
                .getConstructor(source, String.class, String.class, String.class, int.class, String.class)
                .newInstance(source.getField("HUMAN").get(null), "https://example.test:443",
                        "GET", path, 200, "anon");
        Class.forName("io.flowscope.core.EvidenceIds", true, loader).getMethod("assign", List.class)
                .invoke(null, List.of(record));
        String evidenceId = (String) record.getClass().getField("evidenceId").get(record);
        store.getClass().getMethod("save", Path.class, List.class, config, List.class,
                        List.class, Set.class, List.class)
                .invoke(store, database, List.of(record), config.getConstructor().newInstance(),
                        List.of(), List.of(), Set.of(), List.of());
        return evidenceId;
    }

    private static void assertLoaded(Object store, Path database, String path, String evidenceId) throws Exception {
        Object project = store.getClass().getMethod("load", Path.class).invoke(store, database);
        List<?> records = (List<?>) project.getClass().getMethod("records").invoke(project);
        if (records.size() != 1 || !path.equals(records.getFirst().getClass().getField("path").get(records.getFirst()))
                || !evidenceId.equals(records.getFirst().getClass().getField("evidenceId").get(records.getFirst()))) {
            throw new AssertionError("Stored Evidence did not survive an isolated loader round trip");
        }
        store.getClass().getMethod("readContext", Path.class).invoke(store, database);
    }
}
