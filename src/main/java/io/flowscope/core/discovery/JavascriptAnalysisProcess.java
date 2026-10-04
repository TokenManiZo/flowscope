package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.DataOutputStream;
import java.io.BufferedOutputStream;
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
    private static final int MAX_REQUESTS_PER_WORKER = 128;
    private static volatile Worker worker;
    private static int processStarts;
    private static String workerClass = JavascriptAnalysisWorker.class.getName();

    private static final class Worker {
        final Process process;
        final Path directory;
        final Path error;
        final DataOutputStream commands;
        int requests;
        int nextId;

        Worker(Process process, Path directory, Path error) {
            this.process = process;
            this.directory = directory;
            this.error = error;
            this.commands = new DataOutputStream(new BufferedOutputStream(process.getOutputStream()));
        }
    }

    private JavascriptAnalysisProcess() {}

    static synchronized JavascriptAnalysis analyze(String script) {
        byte[] encoded = script.getBytes(StandardCharsets.UTF_8);
        long maxInputBytes = positiveLong("flowscope.javascript.workerBytes", DEFAULT_INPUT_BYTES);
        if (encoded.length > maxInputBytes) {
            return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                    "script exceeds isolated worker input budget " + maxInputBytes + " bytes");
        }
        Path input = null;
        Path output = null;
        Path ready = null;
        try {
            Worker current = worker();
            int requestId = ++current.nextId;
            input = Files.createTempFile(current.directory, "input-", ".js");
            output = current.directory.resolve("result-" + requestId + ".json");
            ready = current.directory.resolve("ready-" + requestId);
            Files.write(input, encoded);
            setOwnerOnly(input, false);
            current.commands.writeInt(requestId);
            current.commands.writeUTF(input.toString());
            current.commands.writeUTF(output.toString());
            current.commands.writeUTF(ready.toString());
            current.commands.flush();
            long timeoutSeconds = positiveLong("flowscope.javascript.workerTimeoutSeconds", 60);
            long started = System.nanoTime();
            long timeoutNanos = TimeUnit.SECONDS.toNanos(timeoutSeconds);
            while (!Files.isRegularFile(ready)) {
                if (!current.process.isAlive()) {
                    String detail = boundedError(current.error);
                    closeWorker();
                    return failure(JavascriptAnalysis.Status.PARSE_FAILED,
                            "isolated JavaScript parser failed: " + detail);
                }
                if (System.nanoTime() - started >= timeoutNanos) {
                    closeWorker();
                    return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                            "isolated JavaScript parser exceeded " + timeoutSeconds + " second budget");
                }
                TimeUnit.MILLISECONDS.sleep(5);
            }
            if (Integer.parseInt(Files.readString(ready, StandardCharsets.US_ASCII).trim()) != requestId
                    || !Files.isRegularFile(output)) throw new IOException("isolated worker response mismatch");
            long maxOutputBytes = positiveLong("flowscope.javascript.workerOutputBytes", DEFAULT_OUTPUT_BYTES);
            if (Files.size(output) > maxOutputBytes) {
                closeWorker();
                return failure(JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                        "isolated JavaScript index exceeds " + maxOutputBytes + " byte result budget");
            }
            JavascriptAnalysis result = JSON.readValue(output.toFile(), JavascriptAnalysis.class);
            if (++current.requests >= MAX_REQUESTS_PER_WORKER) closeWorker();
            return result;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            closeWorker();
            return failure(JavascriptAnalysis.Status.PARSE_FAILED, "isolated JavaScript parser interrupted");
        } catch (Exception error) {
            closeWorker();
            return failure(JavascriptAnalysis.Status.PARSE_FAILED,
                    "isolated JavaScript parser unavailable: " + error.getClass().getSimpleName());
        } finally {
            deleteFile(input);
            deleteFile(output);
            deleteFile(ready);
        }
    }

    private static Worker worker() throws IOException, URISyntaxException {
        if (worker != null && worker.process.isAlive()) return worker;
        closeWorker();
        Path directory = Files.createTempDirectory("flowscope-js-analysis-");
        setOwnerOnly(directory, true);
        Path error = directory.resolve("worker.err");
        try {
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
            copyProperty(command, "flowscope.javascript.maxRouteHints");
            command.add("-cp");
            command.add(workerClasspath());
            command.add(workerClass);
            worker = new Worker(new ProcessBuilder(command)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(error.toFile()).start(), directory, error);
            processStarts++;
            return worker;
        } catch (IOException | URISyntaxException errorValue) {
            deleteTree(directory);
            throw errorValue;
        }
    }

    static void closeWorker() {
        // A dataset switch or unload must not wait for the full per-script timeout.
        Worker active = worker;
        if (active != null) active.process.destroyForcibly();
        synchronized (JavascriptAnalysisProcess.class) {
            Worker current = worker;
            worker = null;
            if (current == null) return;
            current.process.destroyForcibly();
            try { current.process.waitFor(2, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            try { current.commands.close(); } catch (IOException ignored) { }
            deleteTree(current.directory);
        }
    }

    static synchronized int processStarts() { return processStarts; }

    static boolean workerAliveForTest() {
        Worker current = worker;
        return current != null && current.process.isAlive();
    }

    static synchronized void terminateWorkerForTest() {
        if (worker != null) {
            worker.process.destroyForcibly();
            try { worker.process.waitFor(2, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }

    static synchronized void setWorkerClassForTest(String className) {
        closeWorker();
        workerClass = className == null ? JavascriptAnalysisWorker.class.getName() : className;
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

    private static void deleteFile(Path path) {
        if (path == null) return;
        try { Files.deleteIfExists(path); } catch (IOException ignored) { }
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
