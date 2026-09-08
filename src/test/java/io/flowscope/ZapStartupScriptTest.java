package io.flowscope;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class ZapStartupScriptTest {
    @TempDir Path temporaryDirectory;

    @Test
    void allowsTheDockerBridgeGatewaySeenByPublishedPortRequests() throws Exception {
        Path routes = temporaryDirectory.resolve("route");
        Files.writeString(routes, "Iface\tDestination\tGateway\neth0\t00000000\t01001EAC\n");
        Path script = Path.of("infra/zap/start-zap.sh").toAbsolutePath();
        ProcessBuilder process = new ProcessBuilder("bash", "-c",
                "source \"$1\"; flowscope_default_api_allowed_regex \"$2\" \"$3\"",
                "bash", script.toString(), "192.168.65.254", routes.toString());
        Process started = process.start();
        String output = new String(started.getInputStream().readAllBytes()).trim();
        String error = new String(started.getErrorStream().readAllBytes());

        assertEquals(0, started.waitFor(), error);
        assertEquals("^(127\\.0\\.0\\.1|192\\.168\\.65\\.254|172\\.30\\.0\\.1)$", output);
    }
}
