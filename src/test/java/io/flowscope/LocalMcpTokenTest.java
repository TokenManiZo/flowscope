package io.flowscope;

import io.flowscope.integration.LocalMcpToken;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class LocalMcpTokenTest {
    @TempDir Path temp;

    @Test
    void returnsEmptyWhenOptionalFileDoesNotExist() throws Exception {
        assertEquals("", LocalMcpToken.readIfPresent(temp.resolve("missing")));
    }

    @Test
    void readsOnlyAUrlSafeOwnerOnlyToken() throws Exception {
        Path file = temp.resolve("mcp-token");
        String token = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- deterministic test fixture
        Files.writeString(file, token + "\n");
        try {
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX test hosts rely on native owner ACLs.
        }
        assertEquals(token, LocalMcpToken.readIfPresent(file));

        Files.writeString(file, "too-short");
        assertThrows(IOException.class, () -> LocalMcpToken.readIfPresent(file));
    }
}
