package io.flowscope;

import io.flowscope.integration.LocalZapApiKey;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class LocalZapApiKeyTest {
    @TempDir Path temp;

    @Test
    void usesExplicitThenEnvironmentThenOwnerOnlyDefaultFile() throws Exception {
        Path file = temp.resolve("zap-api-key");
        String fileKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // gitleaks:allow -- deterministic test fixture
        Files.writeString(file, fileKey + "\n");
        try {
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX test hosts rely on native owner ACLs.
        }

        assertEquals("explicit", LocalZapApiKey.resolve(" explicit ", "environment", "", file));
        assertEquals("environment", LocalZapApiKey.resolve("", " environment ", "", file));
        assertEquals(fileKey, LocalZapApiKey.resolve("", "", "", file));
        assertEquals("", LocalZapApiKey.resolve("", "", "", temp.resolve("missing")));

        Path configured = temp.resolve("custom-zap-key");
        Files.writeString(configured, fileKey);
        try {
            Files.setPosixFilePermissions(configured, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX test hosts rely on native owner ACLs.
        }
        assertEquals(fileKey, LocalZapApiKey.resolve("", "", configured.toString(), file));

        Path link = temp.resolve("linked-zap-key");
        try {
            Files.createSymbolicLink(link, configured.getFileName());
            assertThrows(IOException.class,
                    () -> LocalZapApiKey.resolve("", "", link.toString(), file));
        } catch (UnsupportedOperationException ignored) {
            // Some Windows test hosts do not permit symlink creation.
        } catch (IOException error) {
            if (!System.getProperty("os.name", "").toLowerCase().contains("windows")) throw error;
        }

        try {
            Files.setPosixFilePermissions(configured, PosixFilePermissions.fromString("rw-r-----"));
            assertThrows(IOException.class,
                    () -> LocalZapApiKey.resolve("", "", configured.toString(), file));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX test hosts rely on native owner ACLs.
        }
    }
}
