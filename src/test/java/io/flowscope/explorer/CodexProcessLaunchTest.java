package io.flowscope.explorer;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

@DisabledOnOs(OS.WINDOWS)
class CodexProcessLaunchTest {
    @TempDir Path directory;

    @Test
    void findsSiblingRuntimeWithRestrictedGuiPathAndMergesDiagnostics() throws Exception {
        Path runtime = executable("flowscope-test-runtime", "#!/bin/sh\nprintf 'runtime-ready:%s' \"$FLOWSCOPE_MCP_TOKEN\"\nprintf 'diagnostic' >&2\n");
        Path wrapper = executable("codex", "#!/usr/bin/env flowscope-test-runtime\n");
        Process process = CodexAppServerProvider.launch(List.of(wrapper.toString()), directory,
                Map.of("PATH", "/usr/bin:/bin", "FLOWSCOPE_MCP_TOKEN", "test-token"),
                ProcessBuilder.Redirect.PIPE, true);
        assertTrue(process.waitFor(5, TimeUnit.SECONDS));
        assertEquals(0, process.exitValue());
        assertEquals("runtime-ready:test-tokendiagnostic", new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
        assertEquals(0, process.getErrorStream().readAllBytes().length);
    }

    @Test
    void appServerKeepsDiagnosticsSeparateFromProtocolOutput() throws Exception {
        Path wrapper = executable("codex", "#!/bin/sh\nprintf 'protocol'\nprintf 'diagnostic' >&2\n");
        Process process = CodexAppServerProvider.launch(List.of(wrapper.toString()), directory,
                Map.of(), ProcessBuilder.Redirect.PIPE, false);
        assertTrue(process.waitFor(5, TimeUnit.SECONDS));
        assertEquals(0, process.exitValue());
        assertEquals("protocol", new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
        assertEquals("diagnostic", new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8));
    }

    private Path executable(String name, String script) throws Exception {
        Path path = directory.resolve(name);
        Files.writeString(path, script);
        assertTrue(path.toFile().setExecutable(true));
        return path;
    }
}
