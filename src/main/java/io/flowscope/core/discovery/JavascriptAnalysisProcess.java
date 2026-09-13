package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/** Runs Closure parsing outside the Burp JVM so parser memory and time failures stay isolated. */
final class JavascriptAnalysisProcess {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long DEFAULT_INPUT_BYTES = 128L * 1024 * 1024;
    private static final long DEFAULT_OUTPUT_BYTES = 64L * 1024 * 1024;

    private JavascriptAnalysisProcess() {}

    static JavascriptAnalysis analyze(String script) {
        byte[] encoded = script.getBytes(StandardCharsets.UTF_8);
        long maxInputBytes = positiveLong("flowscope.javascript.workerBytes", DEFAULT_INPUT_BYTES);
        if (encoded.length > maxInputBytes) {
            return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                    "script exceeds isolated worker input budget " + maxInputBytes + " bytes");
        }
        Path directory = null;
        Process process = null;
        try {
            directory = Files.createTempDirectory("flowscope-js-analysis-");
            setOwnerOnly(directory, true);
            Path input = directory.resolve("input.js");
            Path output = directory.resolve("result.json");
            Path error = directory.resolve("worker.err");
            Files.write(input, encoded);
            setOwnerOnly(input, false);
            List<String> command = new ArrayList<>();
            command.add(javaExecutable());
            command.add("-Xms32m");
            command.add("-Xmx" + positiveInt("flowscope.javascript.workerHeapMiB", 1536) + "m");
            command.add("-XX:+ExitOnOutOfMemoryError");
            command.add("-Dfile.encoding=UTF-8");
            copyProperty(command, "flowscope.javascript.maxNodes");
            copyProperty(command, "flowscope.javascript.maxCallSites");
            copyProperty(command, "flowscope.javascript.maxAssets");
            copyProperty(command, "flowscope.javascript.maxIssues");
            copyProperty(command, "flowscope.javascript.maxParametersPerCall");
            copyProperty(command, "flowscope.javascript.maxResolutionDepth");
            command.add("-cp");
            command.add(workerClasspath());
            command.add(JavascriptAnalysisWorker.class.getName());
            command.add(input.toString());
            command.add(output.toString());
            process = new ProcessBuilder(command).redirectError(error.toFile()).start();
            long timeoutSeconds = positiveLong("flowscope.javascript.workerTimeoutSeconds", 60);
            if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
                return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                        "isolated JavaScript parser exceeded " + timeoutSeconds + " second budget");
            }
            if (process.exitValue() != 0 || !Files.isRegularFile(output)) {
                return failure(JavascriptAnalysis.Status.PARSE_FAILED,
                        "isolated JavaScript parser failed: " + boundedError(error));
            }
            long maxOutputBytes = positiveLong("flowscope.javascript.workerOutputBytes", DEFAULT_OUTPUT_BYTES);
            if (Files.size(output) > maxOutputBytes) {
                return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                        "isolated JavaScript index exceeds " + maxOutputBytes + " byte result budget");
            }
            return JSON.readValue(output.toFile(), JavascriptAnalysis.class);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return failure(JavascriptAnalysis.Status.PARSE_FAILED, "isolated JavaScript parser interrupted");
        } catch (Exception error) {
            return failure(JavascriptAnalysis.Status.PARSE_FAILED,
                    "isolated JavaScript parser unavailable: " + error.getClass().getSimpleName());
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
            deleteTree(directory);
        }
    }

    private static String workerClasspath() throws URISyntaxException {
        String testClasspath = System.getProperty("surefire.test.class.path", "").trim();
        if (!testClasspath.isBlank()) return testClasspath;
        String current = System.getProperty("java.class.path", "").trim();
        Path source = Path.of(JavascriptAnalysisWorker.class.getProtectionDomain()
                .getCodeSource().getLocation().toURI()).toAbsolutePath();
        if (current.isBlank()) return source.toString();
        String separator = System.getProperty("path.separator");
        for (String item : current.split(java.util.regex.Pattern.quote(separator))) {
            if (Path.of(item).toAbsolutePath().equals(source)) return current;
        }
        return source + separator + current;
    }

    private static String javaExecutable() {
        String executable = System.getProperty("os.name", "").toLowerCase().contains("win") ? "java.exe" : "java";
        return Path.of(System.getProperty("java.home"), "bin", executable).toString();
    }

    private static String boundedError(Path path) {
        try {
            if (!Files.isRegularFile(path)) return "no worker error output";
            String value = Files.readString(path, StandardCharsets.UTF_8).replace('\r', ' ').replace('\n', ' ').trim();
            return value.length() <= 500 ? value : value.substring(0, 500);
        } catch (IOException ignored) {
            return "worker error output unreadable";
        }
    }

    private static int positiveInt(String name, int fallback) {
        int value = Integer.getInteger(name, fallback);
        return value > 0 ? value : fallback;
    }

    private static void copyProperty(List<String> command, String name) {
        String value = System.getProperty(name, "").trim();
        if (!value.isBlank()) command.add("-D" + name + "=" + value);
    }

    private static long positiveLong(String name, long fallback) {
        long value = Long.getLong(name, fallback);
        return value > 0 ? value : fallback;
    }

    private static JavascriptAnalysis failure(JavascriptAnalysis.Status status, String detail) {
        return new JavascriptAnalysis(List.of(), List.of(), List.of(), status, detail);
    }

    private static void deleteTree(Path directory) {
        if (directory == null || !Files.exists(directory)) return;
        try (var paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) {}
            });
        } catch (IOException ignored) {}
    }

    private static void setOwnerOnly(Path path, boolean directory) {
        try {
            Files.setPosixFilePermissions(path, directory
                    ? Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE)
                    : Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows inherits ACLs from the current user's temporary directory.
        }
    }
}
