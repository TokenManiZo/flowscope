package io.flowscope.integration;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

/** 선택적인 로컬 MCP 토큰 파일을 엄격하게 읽는다. 파일이 없으면 세션 토큰을 사용한다. */
public final class LocalMcpToken {
    private static final int MAX_BYTES = 512;

    private LocalMcpToken() {}

    public static String readIfPresent(Path path) throws IOException {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return "";
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("MCP token path must be a regular file, not a link: " + path);
        }
        rejectBroadPosixPermissions(path);
        byte[] bytes;
        try (InputStream input = Files.newInputStream(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            bytes = input.readNBytes(MAX_BYTES + 1);
        }
        if (bytes.length > MAX_BYTES) throw new IOException("MCP token file is too large: " + path);
        String token = new String(bytes, StandardCharsets.UTF_8).trim();
        if (!token.matches("[A-Za-z0-9._~-]{32,256}")) {
            throw new IOException("MCP token must be 32-256 URL-safe characters: " + path);
        }
        return token;
    }

    private static void rejectBroadPosixPermissions(Path path) throws IOException {
        try {
            Set<PosixFilePermission> permissions = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
            boolean exposed = permissions.stream().anyMatch(permission ->
                    permission.name().startsWith("GROUP_") || permission.name().startsWith("OTHERS_"));
            if (exposed) throw new IOException("MCP token file must not be accessible by group or others: " + path);
        } catch (UnsupportedOperationException ignored) {
            // Windows and non-POSIX filesystems use their native owner ACLs.
        }
    }
}

