package io.flowscope;

import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.Driver;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.jar.Attributes;
import java.util.jar.JarFile;
import java.util.jar.JarInputStream;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

/** Verify-phase smoke executed against the completed shaded JAR. */
public final class FatJarIsolationSmoke {
    private static final String MR_RELOCATION_MAP = "META-INF/flowscope-mr-relocation.txt";
    private static final String MR_VERSION_PREFIX = "META-INF/versions/";

    private FatJarIsolationSmoke() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 3 && "--relocate-mr-jar".equals(args[0])) {
            relocateMultiReleaseJar(Path.of(args[1]), Instant.parse(args[2]));
            return;
        }
        if (args.length != 1) {
            throw new IllegalArgumentException("Expected the release JAR path");
        }
        Path releaseJarPath = Path.of(args[0]).toAbsolutePath();
        assertStreamingManifest(releaseJarPath);
        assertFrontendReleaseAssets(releaseJarPath);
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
            Class.forName("io.flowscope.shaded.closure.jscomp.Compiler", true, firstLoader);

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

    private static void assertFrontendReleaseAssets(Path releaseJar) throws Exception {
        try (JarFile jar = new JarFile(releaseJar.toFile())) {
            List<String> entries = jar.stream().map(JarEntry::getName).toList();
            requireEntry(entries, "web/app/index.html");
            requireEntry(entries, "META-INF/NOTICE-frontend.txt");
            requireAny(entries, "hashed React JavaScript", name -> name.matches("web/app/assets/[^/]+-[A-Za-z0-9_-]+\\.js"));
            requireAny(entries, "hashed React CSS", name -> name.matches("web/app/assets/[^/]+-[A-Za-z0-9_-]+\\.css"));
            requireExactly(entries, "web/vendor/cytoscape-3.26.0.min.js", 1);
            requireNone(entries, "node_modules", name -> name.contains("node_modules/"));
            requireNone(entries, "Playwright", name -> name.toLowerCase(Locale.ROOT).contains("playwright"));
            requireNone(entries, "Vitest", name -> name.toLowerCase(Locale.ROOT).contains("vitest"));
            assertAllVersionedSourceNamespacesWereRelocated(jar, entries);
            assertNoForeignClassNamespace(entries);

            String legacyCytoscapeReference = "/vendor/cytoscape-3.26.0.min.js";
            assertDoesNotReference(jar, "web/app/index.html", legacyCytoscapeReference);
            for (String entry : entries) {
                if (entry.matches("web/app/assets/[^/]+-[A-Za-z0-9_-]+\\.js")) {
                    assertDoesNotReference(jar, entry, legacyCytoscapeReference);
                }
            }
        }
    }

    static void relocateMultiReleaseJar(Path releaseJar, Instant outputTimestamp) throws IOException {
        Path absoluteJar = releaseJar.toAbsolutePath();
        Path temporaryJar = Files.createTempFile(absoluteJar.getParent(), "flowscope-mr-relocation-", ".jar");
        boolean replaced = false;
        try {
            try (JarFile source = new JarFile(absoluteJar.toFile())) {
            Manifest manifest = source.getManifest();
            if (manifest == null) {
                throw new IOException("Cannot relocate a JAR without a manifest: " + absoluteJar);
            }
            manifest.getMainAttributes().putValue("Created-By", "FlowScope reproducible build");
            byte[] manifestBytes = manifestBytes(manifest);
            List<JarEntry> entries = source.stream()
                    .filter(entry -> !entry.isDirectory())
                    .filter(entry -> !JarFile.MANIFEST_NAME.equals(entry.getName()))
                    .filter(entry -> !MR_RELOCATION_MAP.equals(entry.getName()))
                    .sorted(Comparator.comparing(JarEntry::getName))
                    .toList();
            List<String> mappings = new ArrayList<>();
            Set<String> writtenEntries = new HashSet<>();
            try (JarOutputStream output = new JarOutputStream(Files.newOutputStream(temporaryJar))) {
                writeJarEntry(output, JarFile.MANIFEST_NAME, manifestBytes, outputTimestamp);
                for (JarEntry entry : entries) {
                    String relocatedName = relocatedMultiReleaseEntry(entry.getName());
                    if (!writtenEntries.add(relocatedName)) {
                        throw new IOException("MR relocation produced duplicate JAR entry: " + relocatedName);
                    }
                    if (!entry.getName().equals(relocatedName)) {
                        mappings.add(entry.getName() + "\t" + relocatedName);
                    }
                    JarEntry relocatedEntry = new JarEntry(relocatedName);
                    relocatedEntry.setTime(outputTimestamp.toEpochMilli());
                    output.putNextEntry(relocatedEntry);
                    try (var input = source.getInputStream(entry)) {
                        input.transferTo(output);
                    }
                    output.closeEntry();
                }
                writeJarEntry(output, MR_RELOCATION_MAP,
                        String.join("\n", mappings).concat(mappings.isEmpty() ? "" : "\n")
                                .getBytes(StandardCharsets.UTF_8), outputTimestamp);
            }
            }
            try {
                Files.move(temporaryJar, absoluteJar, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporaryJar, absoluteJar, StandardCopyOption.REPLACE_EXISTING);
            }
            replaced = true;
        } finally {
            if (!replaced) {
                Files.deleteIfExists(temporaryJar);
            }
        }
    }

    private static byte[] manifestBytes(Manifest manifest) throws IOException {
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            manifest.write(output);
            return output.toByteArray();
        }
    }

    private static void writeJarEntry(JarOutputStream output, String name, byte[] contents, Instant outputTimestamp)
            throws IOException {
        JarEntry entry = new JarEntry(name);
        entry.setTime(outputTimestamp.toEpochMilli());
        output.putNextEntry(entry);
        output.write(contents);
        output.closeEntry();
    }

    private static String relocatedMultiReleaseEntry(String entryName) {
        if (!entryName.startsWith(MR_VERSION_PREFIX)) {
            return entryName;
        }
        int versionEnd = entryName.indexOf('/', MR_VERSION_PREFIX.length());
        if (versionEnd < 0 || versionEnd == entryName.length() - 1) {
            return entryName;
        }
        String versionRoot = entryName.substring(0, versionEnd + 1);
        String classPath = entryName.substring(versionEnd + 1);
        if (classPath.startsWith("com/fasterxml/jackson/")) {
            return versionRoot + "io/flowscope/shaded/jackson/" + classPath.substring("com/fasterxml/jackson/".length());
        }
        if (classPath.startsWith("org/jsoup/")) {
            return versionRoot + "io/flowscope/shaded/jsoup/" + classPath.substring("org/jsoup/".length());
        }
        if (classPath.startsWith("org/yaml/snakeyaml/")) {
            return versionRoot + "io/flowscope/shaded/snakeyaml/" + classPath.substring("org/yaml/snakeyaml/".length());
        }
        if (classPath.startsWith("com/google/javascript/")) {
            return versionRoot + "io/flowscope/shaded/closure/" + classPath.substring("com/google/javascript/".length());
        }
        return entryName;
    }

    private static void assertAllVersionedSourceNamespacesWereRelocated(JarFile jar, List<String> entries) throws IOException {
        requireNone(entries, "unrelocated versioned dependency namespace", FatJarIsolationSmoke::isVersionedSourceNamespace);
        JarEntry relocationMap = jar.getJarEntry(MR_RELOCATION_MAP);
        if (relocationMap == null) {
            throw new IllegalStateException("Release JAR is missing the MR relocation map");
        }
        List<String> mappings = new String(jar.getInputStream(relocationMap).readAllBytes(), StandardCharsets.UTF_8).lines().toList();
        if (mappings.isEmpty()) {
            throw new IllegalStateException("Release JAR did not discover versioned dependency entries to relocate");
        }
        for (String mapping : mappings) {
            String[] paths = mapping.split("\\t", -1);
            if (paths.length != 2 || !isVersionedSourceNamespace(paths[0]) || !isRelocatedVersionedNamespace(paths[1])
                    || !relocatedMultiReleaseEntry(paths[0]).equals(paths[1])) {
                throw new IllegalStateException("Invalid MR relocation mapping: " + mapping);
            }
            if (jar.getJarEntry(paths[0]) != null || jar.getJarEntry(paths[1]) == null) {
                throw new IllegalStateException("Incomplete MR relocation mapping: " + mapping);
            }
        }
    }

    private static boolean isVersionedSourceNamespace(String entryName) {
        return entryName.matches("META-INF/versions/[^/]+/(?:com/fasterxml/jackson|org/jsoup|org/yaml/snakeyaml|com/google/javascript)/.*");
    }

    private static boolean isRelocatedVersionedNamespace(String entryName) {
        return entryName.matches("META-INF/versions/[^/]+/io/flowscope/shaded/(?:jackson|jsoup|snakeyaml|closure)/.*");
    }

    private static void requireEntry(List<String> entries, String requiredEntry) {
        requireExactly(entries, requiredEntry, 1);
    }

    private static void requireExactly(List<String> entries, String entry, int expectedCount) {
        long actualCount = entries.stream().filter(entry::equals).count();
        if (actualCount != expectedCount) {
            throw new IllegalStateException("Expected " + expectedCount + " entries named " + entry + ", found " + actualCount);
        }
    }

    private static void requireAny(List<String> entries, String description, java.util.function.Predicate<String> matches) {
        if (entries.stream().noneMatch(matches)) {
            throw new IllegalStateException("Release JAR is missing " + description);
        }
    }

    /**
     * 어떤 의존성이든 io.flowscope 밖의 원래 네임스페이스로 새면 빌드를 실패시킨다. 이름별 allowlist가 아니라
     * "낯선 최상위 네임스페이스가 하나라도 있으면 실패"라서, 알려진 것뿐 아니라 앞으로 추가될 누락도 잡는다.
     * org.sqlite는 네이티브 라이브러리를 고정 패키지명으로 로드해 relocate하면 깨지므로 명시적으로 허용한다.
     */
    private static void assertNoForeignClassNamespace(List<String> entries) {
        List<String> leaks = entries.stream()
                .filter(name -> name.endsWith(".class"))
                .map(name -> name.replaceFirst("^META-INF/versions/[^/]+/", ""))
                .filter(name -> !name.equals("module-info.class"))
                .filter(name -> !name.startsWith("io/flowscope/"))
                .filter(name -> !name.startsWith("org/sqlite/")) // 네이티브 로딩 때문에 의도적으로 미relocate
                .distinct()
                .toList();
        if (!leaks.isEmpty()) {
            throw new IllegalStateException("Release JAR leaks unshaded dependency classes at their original namespace "
                    + "(relocate them in pom.xml shade config, or add a documented exception): " + leaks);
        }
    }

    private static void requireNone(List<String> entries, String description, java.util.function.Predicate<String> matches) {
        String unexpected = entries.stream().filter(matches).findFirst().orElse(null);
        if (unexpected != null) {
            throw new IllegalStateException("Release JAR must not contain " + description + ": " + unexpected);
        }
    }

    private static void assertDoesNotReference(JarFile jar, String entryName, String forbiddenReference) throws Exception {
        JarEntry entry = jar.getJarEntry(entryName);
        if (entry == null) {
            throw new IllegalStateException("Release JAR is missing " + entryName);
        }
        String content = new String(jar.getInputStream(entry).readAllBytes(), StandardCharsets.UTF_8);
        if (content.contains(forbiddenReference)) {
            throw new IllegalStateException(entryName + " must not reference legacy Cytoscape vendor asset");
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
