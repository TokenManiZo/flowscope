package io.flowscope;

import java.io.FileInputStream;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Driver;
import java.util.Properties;
import java.util.jar.Attributes;
import java.util.jar.JarInputStream;
import java.util.jar.Manifest;

/** Verify-phase smoke executed against the completed shaded JAR. */
public final class FatJarIsolationSmoke {
    private FatJarIsolationSmoke() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("Expected the release JAR path");
        }
        Path releaseJarPath = Path.of(args[0]).toAbsolutePath();
        assertStreamingManifest(releaseJarPath);
        URL releaseJar = releaseJarPath.toUri().toURL();
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

    private static void assertStreamingManifest(Path releaseJar) throws Exception {
        try (JarInputStream input = new JarInputStream(new FileInputStream(releaseJar.toFile()))) {
            Manifest manifest = input.getManifest();
            if (manifest == null) {
                throw new IllegalStateException("Release JAR manifest is not stream-readable");
            }
            Attributes attributes = manifest.getMainAttributes();
            assertManifestValue(attributes, Attributes.Name.MAIN_CLASS,
                    "io.flowscope.burp.FlowScopeExtension");
            assertManifestValue(attributes, new Attributes.Name("Created-By"),
                    "FlowScope reproducible build");
            assertManifestValue(attributes, new Attributes.Name("Java-Version"), "21");
            assertManifestValue(attributes, new Attributes.Name("Multi-Release"), "true");
        }
    }

    private static void assertManifestValue(Attributes attributes, Attributes.Name name, String expected) {
        String actual = attributes.getValue(name);
        if (!expected.equals(actual)) {
            throw new IllegalStateException("Unexpected manifest " + name + ": " + actual);
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
