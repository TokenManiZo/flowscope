package io.flowscope.explorer;

import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import com.pty4j.WinSize;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;

/** A real interactive process behind the local Web terminal, not an app-server chat imitation. */
public final class CodexCliTerminal implements AutoCloseable {
    private static final int OUTPUT_CAPACITY = 4 * 1024 * 1024;
    private static final int POLL_BYTES = 64 * 1024;
    private final byte[] output = new byte[OUTPUT_CAPACITY];
    private final Object inputMonitor = new Object();
    private PtyProcess process;
    private String runId = "";
    private long written;
    private boolean running;
    private boolean closed;
    private Integer exitCode;
    private int columns = 80;
    private int rows = 24;

    public record Poll(String runId, boolean running, Integer exitCode, long cursor,
                       long oldestCursor, boolean truncated, byte[] output) {
        public Poll { output = output.clone(); }
        @Override public byte[] output() { return output.clone(); }
    }

    public synchronized Poll start(String id, Path workspace, List<String> command,
                                   Map<String, String> environment, int cols, int lines,
                                   Consumer<String> onExit) throws IOException {
        if (closed) throw new IllegalStateException("터미널이 종료됐습니다.");
        if (running) throw new IllegalStateException("Codex CLI가 이미 실행 중입니다.");
        if (id == null || id.isBlank() || workspace == null || command == null || command.isEmpty()) {
            throw new IllegalArgumentException("실행 ID, 작업 폴더, Codex 명령이 필요합니다.");
        }
        int width = dimension(cols);
        int height = dimension(lines);
        PtyProcess started = new PtyProcessBuilder()
                .setCommand(command.toArray(String[]::new))
                .setEnvironment(environment)
                .setDirectory(workspace.toString())
                .setInitialColumns(width).setInitialRows(height)
                .setRedirectErrorStream(true).start();
        process = started;
        runId = id;
        written = 0;
        running = true;
        exitCode = null;
        columns = width;
        rows = height;
        Thread.ofVirtual().name("flowscope-codex-cli-output").start(() -> readOutput(started, id, onExit));
        return pollNow(0);
    }

    public synchronized Poll poll(long cursor) {
        if (cursor >= written && running) {
            try { wait(400); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
        return pollNow(cursor);
    }

    public synchronized boolean activeRun(String id) {
        return running && id != null && id.equals(runId);
    }

    public synchronized Poll status() { return pollNow(written); }

    public void input(byte[] data) throws IOException {
        if (data == null || data.length == 0 || data.length > 64 * 1024) {
            throw new IllegalArgumentException("터미널 입력은 1~65536바이트여야 합니다.");
        }
        PtyProcess active;
        synchronized (this) {
            if (!running || process == null) throw new IllegalStateException("실행 중인 Codex CLI가 없습니다.");
            active = process;
        }
        synchronized (inputMonitor) {
            active.getOutputStream().write(data);
            active.getOutputStream().flush();
        }
    }

    public void resize(int cols, int lines) {
        int width = dimension(cols);
        int height = dimension(lines);
        PtyProcess active;
        synchronized (this) {
            if (!running || process == null) throw new IllegalStateException("실행 중인 Codex CLI가 없습니다.");
            columns = width;
            rows = height;
            active = process;
        }
        active.setWinSize(new WinSize(width, height));
    }

    public synchronized int columns() { return columns; }
    public synchronized int rows() { return rows; }

    public static List<String> codexCommand(Path workspace, int proxyPort, boolean resume) {
        String executable = CodexAppServerProvider.resolveExecutable();
        if (executable == null) throw new IllegalStateException("Codex CLI를 찾지 못했습니다.");
        if (proxyPort < 1 || proxyPort > 65535) throw new IllegalArgumentException("수집 프록시 포트가 올바르지 않습니다.");
        String proxy = "http://127.0.0.1:" + proxyPort;
        List<String> command = new ArrayList<>();
        String lower = executable.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
            command.add("cmd.exe"); command.add("/d"); command.add("/c");
        }
        command.add(executable);
        command.add("--no-daemon");
        command.add("-C"); command.add(workspace.toString());
        command.add("-c"); command.add("sandbox_workspace_write.network_access=true");
        for (String name : List.of("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")) {
            command.add("-c"); command.add("shell_environment_policy.set." + name + "=\"" + proxy + "\"");
        }
        for (String name : List.of("NO_PROXY", "no_proxy")) {
            command.add("-c"); command.add("shell_environment_policy.set." + name + "=\"\"");
        }
        if (resume) { command.add("resume"); command.add("--last"); }
        return List.copyOf(command);
    }

    public synchronized void clear() {
        if (running) throw new IllegalStateException("실행 중인 Codex CLI는 지울 수 없습니다.");
        process = null;
        runId = "";
        written = 0;
        exitCode = null;
    }

    public void stop() {
        PtyProcess active;
        synchronized (this) { active = process; }
        if (active != null && active.isAlive()) {
            active.destroy();
            Thread.ofVirtual().name("flowscope-codex-cli-stop").start(() -> {
                try {
                    if (!active.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) active.destroyForcibly();
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    active.destroyForcibly();
                }
            });
        }
    }

    @Override public void close() {
        synchronized (this) { closed = true; }
        stop();
    }

    private void readOutput(PtyProcess started, String id, Consumer<String> onExit) {
        byte[] chunk = new byte[8192];
        try (InputStream input = started.getInputStream()) {
            int size;
            while ((size = input.read(chunk)) != -1) append(chunk, size);
        } catch (IOException ignored) {
            // A destroyed PTY may close its stream before returning EOF.
        } finally {
            int code = -1;
            try { code = started.waitFor(); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            synchronized (this) {
                if (process == started && id.equals(runId)) {
                    running = false;
                    exitCode = code;
                    notifyAll();
                }
            }
            started.destroy();
            if (onExit != null) onExit.accept(id);
        }
    }

    private synchronized void append(byte[] bytes, int length) {
        for (int i = 0; i < length; i++) output[(int) (written++ % output.length)] = bytes[i];
        notifyAll();
    }

    private Poll pollNow(long requested) {
        long oldest = Math.max(0, written - output.length);
        boolean truncated = requested < oldest || requested > written;
        long start = truncated ? oldest : requested;
        int length = (int) Math.min(POLL_BYTES, written - start);
        byte[] bytes = new byte[length];
        for (int i = 0; i < length; i++) bytes[i] = output[(int) ((start + i) % output.length)];
        return new Poll(runId, running, exitCode, start + length, oldest, truncated, bytes);
    }

    private static int dimension(int value) {
        if (value < 20 || value > 500) throw new IllegalArgumentException("터미널 크기는 20~500이어야 합니다.");
        return value;
    }
}
