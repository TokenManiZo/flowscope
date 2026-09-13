package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Process entry point for isolated Closure parsing. */
public final class JavascriptAnalysisWorker {
    private static final ObjectMapper JSON = new ObjectMapper();

    private JavascriptAnalysisWorker() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("input and output paths are required");
        String script = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyzeInWorker(script);
        JSON.writeValue(Path.of(args[1]).toFile(), analysis);
    }
}
