package io.flowscope;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Driver;
import java.util.Properties;

/** Package-phase smoke executed by CI against the completed shaded JAR. */
public final class FatJarIsolationSmoke {
    private FatJarIsolationSmoke() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("Expected the release JAR path");
        }
        URL releaseJar = Path.of(args[0]).toAbsolutePath().toUri().toURL();
        try (URLClassLoader firstLoader = isolatedLoader(releaseJar);
             URLClassLoader secondLoader = isolatedLoader(releaseJar)) {
            assertVersionedClass(firstLoader,
                    "io.flowscope.shaded.jackson.core.internal.shaded.fdp.v2_22_2.FastDoubleSwar",
                    "io/flowscope/shaded/jackson/core/internal/shaded/fdp/v2_22_2/FastDoubleSwar.class",
                    "META-INF/versions/21/");
            assertVersionedClass(firstLoader,
                    "io.flowscope.shaded.jsoup.helper.HttpClientExecutor",
                    "io/flowscope/shaded/jsoup/helper/HttpClientExecutor.class",
                    "META-INF/versions/11/");
            assertVersionedClass(firstLoader,
                    "io.flowscope.shaded.snakeyaml.internal.Logger",
                    "io/flowscope/shaded/snakeyaml/internal/Logger.class",
                    "META-INF/versions/9/");

            Object mapper = Class.forName("io.flowscope.shaded.jackson.databind.ObjectMapper", true, firstLoader)
                    .getDeclaredConstructor()
                    .newInstance();
            Object tree = mapper.getClass().getMethod("readTree", String.class)
                    .invoke(mapper, "{\"ok\":true}");
            Object ok = tree.getClass().getMethod("get", String.class).invoke(tree, "ok");
            if (!(boolean) ok.getClass().getMethod("asBoolean").invoke(ok)) {
                throw new IllegalStateException("Relocated Jackson runtime failed");
            }

            Driver firstDriver = sqliteDriver(firstLoader);
            Driver secondDriver = sqliteDriver(secondLoader);
            try (Connection first = firstDriver.connect("jdbc:sqlite::memory:", new Properties());
                 Connection second = secondDriver.connect("jdbc:sqlite::memory:", new Properties())) {
                if (first == null || second == null) {
                    throw new IllegalStateException("SQLite driver rejected its JDBC URL");
                }
                first.createStatement().execute("SELECT 1");
                second.createStatement().execute("SELECT 1");
            }
        }
    }

    private static URLClassLoader isolatedLoader(URL releaseJar) {
        return new URLClassLoader(new URL[]{releaseJar}, ClassLoader.getPlatformClassLoader());
    }

    private static Driver sqliteDriver(ClassLoader loader) throws Exception {
        Class<?> type = Class.forName("org.sqlite.JDBC", true, loader);
        return (Driver) type.getDeclaredConstructor().newInstance();
    }

    private static void assertVersionedClass(ClassLoader loader, String className,
                                             String resourceName, String expectedVersion) throws Exception {
        Class.forName(className, true, loader);
        URL resource = loader.getResource(resourceName);
        if (resource == null || !resource.toString().contains(expectedVersion)) {
            throw new IllegalStateException("MR-JAR class not selected: " + className + " -> " + resource);
        }
    }
}
