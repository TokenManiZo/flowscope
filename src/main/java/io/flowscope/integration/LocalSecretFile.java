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

/** 소유자 전용 로컬 secret 파일을 링크 추적 없이 제한된 크기로 읽는다. */
final class LocalSecretFile {
    private static final int MAX_BYTES = 512;

    private LocalSecretFile() {}

    static String readIfPresent(Path path, String label) throws IOException {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return "";
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException(label + " path must be a regular file, not a link: " + path);
        }
        rejectBroadPosixPermissions(path, label);
        byte[] bytes;
        try (InputStream input = Files.newInputStream(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            bytes = input.readNBytes(MAX_BYTES + 1);
        }
        if (bytes.length > MAX_BYTES) throw new IOException(label + " file is too large: " + path);
        String value = new String(bytes, StandardCharsets.UTF_8).trim();
        if (!value.matches("[A-Za-z0-9._~-]{32,256}")) {
            throw new IOException(label + " must be 32-256 URL-safe characters: " + path);
        }
        return value;
    }

    private static void rejectBroadPosixPermissions(Path path, String label) throws IOException {
        try {
            Set<PosixFilePermission> permissions = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
            boolean exposed = permissions.stream().anyMatch(permission ->
                    permission.name().startsWith("GROUP_") || permission.name().startsWith("OTHERS_"));
            if (exposed) throw new IOException(label + " file must not be accessible by group or others: " + path);
        } catch (UnsupportedOperationException ignored) {
            // Windows and non-POSIX filesystems use their native owner ACLs.
        }
    }
}
