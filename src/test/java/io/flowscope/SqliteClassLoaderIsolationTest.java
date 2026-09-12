package io.flowscope;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Driver;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SqliteClassLoaderIsolationTest {
    @Test
    void productionStoreWorksAfterHostJdbcInitializationWithoutPreloadingDriver(@TempDir Path directory) throws Exception {
        String productClasspath = System.getProperty("surefire.test.class.path", System.getProperty("java.class.path"));
        String probeClasspath = Path.of(SqliteProjectStoreIsolationProbe.class.getProtectionDomain()
                .getCodeSource().getLocation().toURI()).toString();
        Path output = directory.resolve("probe.log");
        Process process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", probeClasspath, SqliteProjectStoreIsolationProbe.class.getName(), productClasspath,
                directory.toString()).redirectErrorStream(true).redirectOutput(output.toFile()).start();
        try {
            assertTrue(process.waitFor(30, TimeUnit.SECONDS), "SQLite isolated store probe timed out");
            assertEquals(0, process.exitValue(), Files.readString(output));
        } finally {
            if (process.isAlive()) process.destroyForcibly().waitFor(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void sqliteNativeLibraryLoadsInTwoIndependentExtensionClassLoaders() throws Exception {
        URL sqliteJar = Class.forName("org.sqlite.JDBC")
                .getProtectionDomain()
                .getCodeSource()
                .getLocation();

        try (URLClassLoader firstLoader = isolatedLoader(sqliteJar);
             URLClassLoader secondLoader = isolatedLoader(sqliteJar)) {
            Driver firstDriver = driver(firstLoader);
            Driver secondDriver = driver(secondLoader);

            try (Connection first = firstDriver.connect("jdbc:sqlite::memory:", new Properties());
                 Connection second = secondDriver.connect("jdbc:sqlite::memory:", new Properties())) {
                assertNotNull(first);
                assertNotNull(second);
                first.createStatement().execute("SELECT 1");
                second.createStatement().execute("SELECT 1");
            }
        }
    }

    private static URLClassLoader isolatedLoader(URL sqliteJar) {
        return new URLClassLoader(new URL[]{sqliteJar}, ClassLoader.getPlatformClassLoader());
    }

    private static Driver driver(ClassLoader loader) throws Exception {
        Class<?> type = Class.forName("org.sqlite.JDBC", true, loader);
        return (Driver) type.getDeclaredConstructor().newInstance();
    }
}
