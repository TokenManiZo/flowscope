package io.flowscope;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ZapStartupScriptTest {
    @TempDir Path temporaryDirectory;

    @Test
    void permitsTheBrowserExtensionsZapHostWithoutPermittingOtherHosts() throws Exception {
        Path routes = temporaryDirectory.resolve("browser-route");
        Files.writeString(routes, "Iface\tDestination\tGateway\neth0\t00000000\t01001EAC\n");
        Process process = new ProcessBuilder("bash", "-c",
                "source \"$1\"; flowscope_default_api_allowed_regex 192.168.65.254 \"$2\"",
                "zap-browser-host", Path.of("infra/zap/start-zap.sh").toAbsolutePath().toString(),
                routes.toString()).start();
        String regex = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();
        assertEquals(0, process.waitFor());
        assertTrue("zap".matches(regex), "ZAP validates the extension callback Host as well as its source IP");
        org.junit.jupiter.api.Assertions.assertFalse("zap.attacker.test".matches(regex));
        org.junit.jupiter.api.Assertions.assertFalse("172.30.0.20".matches(regex));
    }

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
        assertEquals("^(127\\.0\\.0\\.1|zap|192\\.168\\.65\\.254|172\\.30\\.0\\.1)$", output);
    }

    @Test
    void browserDriverCheckRejectsMissingAndUnrunnableDrivers() throws Exception {
        Path browser = workingBrowser();
        assertDriverCheck(browser, temporaryDirectory.resolve("missing"), 1,
                "ZAP Chromium driver cannot execute");
        Path driver = temporaryDirectory.resolve("driver");
        Files.writeString(driver, "#!/bin/sh\nexit 17\n");
        assertTrue(driver.toFile().setExecutable(true, true));
        assertDriverCheck(browser, driver, 1, "ZAP Chromium driver cannot execute");
    }

    @Test
    void browserDriverCheckStartsHeadlessChromium() throws Exception {
        Path browser = workingBrowser();
        Path driver = workingDriver("152");
        assertDriverCheck(browser, driver, 0, "");
    }

    @Test
    void browserDriverCheckRejectsAHeadlessLaunchFailure() throws Exception {
        Path browser = executable("browser", "#!/bin/sh\n"
                + "if [ \"$1\" = \"--version\" ]; then echo 'Chromium 152.0.1'; exit 0; fi\n"
                + "exit 19\n");
        assertDriverCheck(browser, workingDriver("152"), 1,
                "ZAP Chromium could not start in headless mode");
    }

    @Test
    void browserDriverCheckRejectsMismatchedMajorVersions() throws Exception {
        assertDriverCheck(workingBrowser(), workingDriver("151"), 1,
                "ZAP Chromium and ChromeDriver major versions do not match");
    }

    private Path workingBrowser() throws Exception {
        return executable("browser", "#!/bin/sh\n"
                + "if [ \"$1\" = \"--version\" ]; then echo 'Chromium 152.0.1'; exit 0; fi\n"
                + "case \"$*\" in *--headless=new*) exit 0;; *) exit 18;; esac\n");
    }

    private Path workingDriver(String major) throws Exception {
        return executable("driver-" + major, "#!/bin/sh\n"
                + "if [ \"$1\" = \"--version\" ]; then echo 'ChromeDriver " + major
                + ".0.2'; exit 0; fi\nexit 17\n");
    }

    private Path executable(String name, String content) throws Exception {
        Path path = temporaryDirectory.resolve(name);
        Files.writeString(path, content);
        assertTrue(path.toFile().setExecutable(true, true));
        return path;
    }

    private void assertDriverCheck(Path browser, Path driver, int expected, String expectedMessage) throws Exception {
        Path script = Path.of("infra/zap/start-zap.sh").toAbsolutePath();
        Process started = new ProcessBuilder("bash", "-c",
                "source \"$1\"; flowscope_check_chromium_runtime \"$2\" \"$3\"",
                "bash", script.toString(), browser.toString(), driver.toString()).redirectErrorStream(true).start();
        String output = new String(started.getInputStream().readAllBytes());
        assertEquals(expected, started.waitFor(), output);
        if (expected != 0) assertTrue(output.contains(expectedMessage), output);
    }
}
