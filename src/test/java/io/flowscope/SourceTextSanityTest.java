package io.flowscope;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

final class SourceTextSanityTest {
    @Test
    void javaSourcesContainNoRawNulBytes() throws Exception {
        List<String> invalid = new ArrayList<>();
        try (var paths = Files.walk(Path.of("src"))) {
            for (Path path : paths.filter(Files::isRegularFile)
                    .filter(value -> value.toString().endsWith(".java")).toList()) {
                byte[] bytes = Files.readAllBytes(path);
                for (byte value : bytes) {
                    if (value == 0) {
                        invalid.add(path.toString());
                        break;
                    }
                }
            }
        }
        assertTrue(invalid.isEmpty(), "Java source files must remain text; raw NUL found in " + invalid);
    }
}
