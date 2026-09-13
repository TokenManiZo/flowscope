package io.flowscope;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MultiReleaseJarRelocatorTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void relocatesEveryDiscoveredVersionedSourceNamespaceAndRecordsMappings() throws Exception {
        Path jar = temporaryDirectory.resolve("release.jar");
        writeJar(jar, List.of(
                "META-INF/versions/9/org/yaml/snakeyaml/internal/Logger.class",
                "META-INF/versions/11/org/jsoup/helper/HttpClientExecutor.class",
                "META-INF/versions/22/com/fasterxml/jackson/core/Arbitrary.class",
                "META-INF/versions/23/com/fasterxml/jackson/databind/Other.class",
                "META-INF/versions/24/com/google/javascript/jscomp/Future.class",
                "META-INF/versions/19/com/example/Unchanged.class"));

        FatJarIsolationSmoke.relocateMultiReleaseJar(jar, Instant.parse("2026-08-31T00:00:00Z"));

        try (JarFile relocated = new JarFile(jar.toFile())) {
            List<String> entries = relocated.stream().map(JarEntry::getName).toList();
            assertFalse(entries.stream().anyMatch(name -> name.matches(
                    "META-INF/versions/[^/]+/(?:com/fasterxml/jackson|org/jsoup|org/yaml/snakeyaml)/.*")));
            assertTrue(entries.contains("META-INF/versions/22/io/flowscope/shaded/jackson/core/Arbitrary.class"));
            assertTrue(entries.contains("META-INF/versions/23/io/flowscope/shaded/jackson/databind/Other.class"));
            assertTrue(entries.contains("META-INF/versions/24/io/flowscope/shaded/closure/jscomp/Future.class"));
            assertTrue(entries.contains("META-INF/versions/11/io/flowscope/shaded/jsoup/helper/HttpClientExecutor.class"));
            assertTrue(entries.contains("META-INF/versions/9/io/flowscope/shaded/snakeyaml/internal/Logger.class"));
            assertTrue(entries.contains("META-INF/versions/19/com/example/Unchanged.class"));

            JarEntry relocationMap = relocated.getJarEntry("META-INF/flowscope-mr-relocation.txt");
            assertNotNull(relocationMap);
            List<String> mappings = new String(relocated.getInputStream(relocationMap).readAllBytes(), StandardCharsets.UTF_8)
                    .lines().toList();
            assertEquals(List.of(
                    "META-INF/versions/11/org/jsoup/helper/HttpClientExecutor.class\tMETA-INF/versions/11/io/flowscope/shaded/jsoup/helper/HttpClientExecutor.class",
                    "META-INF/versions/22/com/fasterxml/jackson/core/Arbitrary.class\tMETA-INF/versions/22/io/flowscope/shaded/jackson/core/Arbitrary.class",
                    "META-INF/versions/23/com/fasterxml/jackson/databind/Other.class\tMETA-INF/versions/23/io/flowscope/shaded/jackson/databind/Other.class",
                    "META-INF/versions/24/com/google/javascript/jscomp/Future.class\tMETA-INF/versions/24/io/flowscope/shaded/closure/jscomp/Future.class",
                    "META-INF/versions/9/org/yaml/snakeyaml/internal/Logger.class\tMETA-INF/versions/9/io/flowscope/shaded/snakeyaml/internal/Logger.class"), mappings);
            assertEquals("true", relocated.getManifest().getMainAttributes().getValue("Multi-Release"));
            assertEquals("FlowScope reproducible build", relocated.getManifest().getMainAttributes().getValue("Created-By"));
        }
    }

    @Test
    void writesEveryEntryAtTheConfiguredTimestampAndReproducesEquivalentArchives() throws Exception {
        Instant outputTimestamp = Instant.parse("2026-08-31T00:00:00Z");
        List<String> entryNames = List.of(
                "META-INF/versions/31/com/fasterxml/jackson/core/Future.class",
                "META-INF/versions/32/com/google/javascript/jscomp/Future.class",
                "META-INF/versions/12/org/jsoup/helper/Future.class",
                "META-INF/versions/10/org/yaml/snakeyaml/Future.class");
        Path firstJar = temporaryDirectory.resolve("first.jar");
        Path secondJar = temporaryDirectory.resolve("second.jar");
        writeJar(firstJar, entryNames);
        writeJar(secondJar, entryNames);

        FatJarIsolationSmoke.relocateMultiReleaseJar(firstJar, outputTimestamp);
        FatJarIsolationSmoke.relocateMultiReleaseJar(secondJar, outputTimestamp);

        try (JarFile relocated = new JarFile(firstJar.toFile())) {
            assertTrue(relocated.stream().allMatch(entry -> entry.getTime() == outputTimestamp.toEpochMilli()));
            assertEquals(outputTimestamp.toEpochMilli(), relocated.getJarEntry("META-INF/MANIFEST.MF").getTime());
        }
        assertArrayEquals(Files.readAllBytes(firstJar), Files.readAllBytes(secondJar));
    }

    private static void writeJar(Path jar, List<String> entryNames) throws IOException {
        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        manifest.getMainAttributes().putValue("Multi-Release", "true");
        try (JarOutputStream output = new JarOutputStream(Files.newOutputStream(jar), manifest)) {
            for (String entryName : entryNames) {
                JarEntry entry = new JarEntry(entryName);
                entry.setTime(0L);
                output.putNextEntry(entry);
                output.write(entryName.getBytes(StandardCharsets.UTF_8));
                output.closeEntry();
            }
        }
    }
}
