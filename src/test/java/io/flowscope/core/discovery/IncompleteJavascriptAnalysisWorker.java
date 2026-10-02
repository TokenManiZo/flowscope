package io.flowscope.core.discovery;

import java.io.DataInputStream;
import java.io.EOFException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Test process that acknowledges a request without writing its result. */
public final class IncompleteJavascriptAnalysisWorker {
    public static void main(String[] args) throws Exception {
        try (DataInputStream commands = new DataInputStream(System.in)) {
            int requestId;
            try { requestId = commands.readInt(); }
            catch (EOFException closed) { return; }
            commands.readUTF();
            commands.readUTF();
            Path ready = Path.of(commands.readUTF());
            Files.writeString(ready, Integer.toString(requestId), StandardCharsets.US_ASCII);
        }
    }
}
