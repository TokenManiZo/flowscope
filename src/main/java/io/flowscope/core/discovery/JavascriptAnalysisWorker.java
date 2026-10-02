package io.flowscope.core.discovery;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** One isolated process handles bounded sequential requests, each with a fresh Compiler and Analyzer. */
public final class JavascriptAnalysisWorker {
    private static final ObjectMapper JSON = new ObjectMapper();

    private JavascriptAnalysisWorker() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 0) throw new IllegalArgumentException("worker takes no arguments");
        try (DataInputStream commands = new DataInputStream(new BufferedInputStream(System.in))) {
            while (true) {
                int requestId;
                try { requestId = commands.readInt(); }
                catch (EOFException closed) { return; }
                Path input = Path.of(commands.readUTF());
                Path output = Path.of(commands.readUTF());
                Path ready = Path.of(commands.readUTF());
                String script = Files.readString(input, StandardCharsets.UTF_8);
                JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyzeInWorker(script);
                JSON.writeValue(output.toFile(), analysis);
                Path pending = ready.resolveSibling(ready.getFileName() + ".pending");
                Files.writeString(pending, Integer.toString(requestId), StandardCharsets.US_ASCII);
                try { Files.move(pending, ready, StandardCopyOption.ATOMIC_MOVE); }
                catch (AtomicMoveNotSupportedException unsupported) {
                    Files.move(pending, ready);
                }
            }
        }
    }
}
