package io.flowscope.explorer;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

final class CodexCliTerminalTest {
    @TempDir Path directory;

    @Test
    void runsAnInteractiveProcessWithInputOutputResizeAndExit() throws Exception {
        String executable = Path.of(System.getProperty("java.home"), "bin",
                System.getProperty("os.name").toLowerCase().contains("win") ? "java.exe" : "java").toString();
        String classes = Path.of(EchoMain.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
        CountDownLatch exited = new CountDownLatch(1);
        try (CodexCliTerminal terminal = new CodexCliTerminal()) {
            terminal.start("llm-cli-test", directory,
                    List.of(executable, "-cp", classes, EchoMain.class.getName()),
                    Map.of("TERM", "xterm-256color"), 80, 24, ignored -> exited.countDown());
            String first = collectUntil(terminal, "READY");
            assertTrue(first.contains("READY"));
            terminal.resize(100, 32);
            assertEquals(100, terminal.columns());
            assertEquals(32, terminal.rows());
            terminal.input("hello\r".getBytes(StandardCharsets.UTF_8));
            assertTrue(collectUntil(terminal, "ECHO:hello").contains("ECHO:hello"));
            assertTrue(exited.await(5, TimeUnit.SECONDS));
            assertFalse(terminal.poll(0).running());
        }
    }

    private static String collectUntil(CodexCliTerminal terminal, String expected) throws Exception {
        long cursor = 0;
        StringBuilder text = new StringBuilder();
        for (int attempt = 0; attempt < 40; attempt++) {
            CodexCliTerminal.Poll poll = terminal.poll(cursor);
            cursor = poll.cursor();
            text.append(new String(poll.output(), StandardCharsets.UTF_8));
            if (text.toString().contains(expected)) return text.toString();
        }
        fail("terminal output did not contain " + expected);
        return "";
    }

    public static final class EchoMain {
        public static void main(String[] args) throws Exception {
            System.out.print("\u001b[2J\u001b[HREADY\r\n");
            System.out.flush();
            String line = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
            System.out.print("ECHO:" + line + "\r\n");
            System.out.flush();
        }
    }
}
