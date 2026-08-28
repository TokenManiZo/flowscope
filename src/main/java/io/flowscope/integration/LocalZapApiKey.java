package io.flowscope.integration;

import java.io.IOException;
import java.nio.file.Path;

/** 시스템 속성, 환경 변수, 소유자 전용 파일 순으로 로컬 ZAP API key를 해석한다. */
public final class LocalZapApiKey {
    private LocalZapApiKey() {}

    public static String resolve(String configuredKey, String environmentKey, String configuredPath,
                                 Path defaultPath) throws IOException {
        String value = configuredKey == null ? "" : configuredKey.trim();
        if (!value.isBlank()) return value;
        value = environmentKey == null ? "" : environmentKey.trim();
        if (!value.isBlank()) return value;
        Path path = configuredPath == null || configuredPath.isBlank()
                ? defaultPath
                : Path.of(configuredPath.trim());
        return LocalSecretFile.readIfPresent(path, "ZAP API key");
    }
}
