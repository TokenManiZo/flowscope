package io.flowscope.integration;

import java.io.IOException;
import java.nio.file.Path;

/** 선택적인 로컬 MCP 토큰 파일을 엄격하게 읽는다. 파일이 없으면 세션 토큰을 사용한다. */
public final class LocalMcpToken {
    private LocalMcpToken() {}

    public static String readIfPresent(Path path) throws IOException {
        return LocalSecretFile.readIfPresent(path, "MCP token");
    }
}
