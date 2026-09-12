package io.flowscope.burp;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.parameter.ParameterExtraction;
import io.flowscope.core.parameter.ParameterExtractor;
import io.flowscope.integration.ProjectStore;
import io.flowscope.integration.SqliteProjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class TransientExchangeVaultTest {
    @TempDir Path temp;

    /** PR #11 raw-isolation contract: a populated vault never reaches JSON/SQLite, while derived parameter facts survive reopen. */
    @Test
    void populatedRawVaultNeverEntersJsonOrSqliteProjects() throws Exception {
        TransientExchangeVault vault = new TransientExchangeVault(1024, 1024, 2048);
        RequestRecord record = record("/search");
        record.query = "status=open";
        byte[] raw = "GET /search?status=open HTTP/1.1\r\nAuthorization: Bearer vault-only-private-value\r\n\r\n"
                .getBytes(StandardCharsets.UTF_8);
        vault.put(record, raw, raw.length, null, 0);
        List<RequestRecord> analyzed = Pipeline.runIsolated(List.of(record), new AnalysisConfig()).records;
        assertArrayEquals(raw, vault.get(analyzed.getFirst()).orElseThrow().request());
        ParameterExtraction extraction = ParameterExtractor.extract(analyzed.getFirst());
        assertEquals("/status", extraction.observations().getFirst().key().canonicalPath());

        ProjectStore codec = new ProjectStore();
        Path jsonFile = temp.resolve("raw-isolation.json");
        Path database = temp.resolve("raw-isolation.db");
        codec.save(jsonFile, analyzed, new AnalysisConfig(), List.of());
        new SqliteProjectStore(codec).save(database, analyzed, new AnalysisConfig(), List.of(), List.of(),
                Set.of(), List.of());
        for (Path file : List.of(jsonFile, database)) {
            String bytes = new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1);
            assertFalse(bytes.contains("vault-only-private-value"), file.toString());
            assertFalse(bytes.contains(Base64.getEncoder().encodeToString(raw)), file.toString());
        }
        RequestRecord reopened = Pipeline.runIsolated(codec.load(jsonFile).records(), new AnalysisConfig())
                .records.getFirst();
        assertEquals(extraction.observations(), ParameterExtractor.extract(reopened).observations());
        vault.clear();
    }

    @Test
    void 분석복사본으로도_같은_메모리원문을_찾는다() {
        TransientExchangeVault vault = new TransientExchangeVault(100, 100, 200);
        RequestRecord record = record("/copy");
        vault.put(record, "request".getBytes(), 0, "response".getBytes(), 0);

        assertTrue(vault.get(record.analysisCopy()).isPresent());
    }
    @Test
    void retainsRawBytesOnlyInBoundedMemoryAndClearsIt() {
        TransientExchangeVault vault = new TransientExchangeVault(64, 64, 128);
        RequestRecord record = record("/one");
        byte[] request = "GET /one HTTP/1.1\r\nAuthorization: Bearer raw-token".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] response = "HTTP/1.1 200 OK".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        vault.put(record, request, request.length, response, response.length);

        TransientExchangeVault.Exchange exchange = vault.get(record).orElseThrow();
        assertArrayEquals(request, exchange.request());
        assertTrue(exchange.requestRetained());
        assertTrue(exchange.responseRetained());
        vault.clear();
        assertTrue(vault.get(record).isEmpty());
        assertEquals(0, vault.retainedBytes());
    }

    @Test
    void reportsOversizedPartsWithoutRetainingTheirContents() {
        TransientExchangeVault vault = new TransientExchangeVault(8, 8, 32);
        RequestRecord record = record("/large");

        byte[] request = "GET /large HTTP/1.1".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] response = "HTTP/1.1 200 OK".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        vault.put(record, request, request.length, response, response.length);

        TransientExchangeVault.Exchange exchange = vault.get(record).orElseThrow();
        assertFalse(exchange.requestRetained());
        assertFalse(exchange.responseRetained());
        assertNull(exchange.request());
        assertTrue(exchange.requestBytes() > 8);
    }

    @Test
    void acceptsOversizedMetadataWithoutReceivingTheOversizedArray() {
        TransientExchangeVault vault = new TransientExchangeVault(8, 8, 32);
        RequestRecord record = record("/large-metadata");

        vault.put(record, null, 100, 1_000_000, null, 200, 2_000_000);

        TransientExchangeVault.Exchange exchange = vault.get(record).orElseThrow();
        assertFalse(exchange.requestRetained());
        assertFalse(exchange.responseRetained());
        assertEquals(1_000_000, exchange.requestBytes());
        assertEquals(2_000_000, exchange.responseBytes());
    }

    @Test
    void evictsOldestExchangeBeforeExceedingTotalLimit() {
        TransientExchangeVault vault = new TransientExchangeVault(64, 64, 24);
        RequestRecord first = record("/first");
        RequestRecord second = record("/second");
        byte[] firstBytes = "123456789012".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] secondBytes = "abcdefghijklm".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        vault.put(first, firstBytes, firstBytes.length, null, 0);
        vault.put(second, secondBytes, secondBytes.length, null, 0);

        assertTrue(vault.get(first).isEmpty());
        assertArrayEquals(secondBytes, vault.get(second).orElseThrow().request());
        assertTrue(vault.retainedBytes() <= 24);
    }

    @Test
    void preservesNonAsciiBytesExactly() {
        TransientExchangeVault vault = new TransientExchangeVault(128, 128, 256);
        RequestRecord record = record("/unicode");
        byte[] request = "POST /unicode HTTP/1.1\r\n\r\n한글 🧪".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        vault.put(record, request, "POST /unicode HTTP/1.1\r\n\r\n".length(), null, 0);

        assertArrayEquals(request, vault.get(record).orElseThrow().request());
    }

    private static RequestRecord record(String path) {
        return new RequestRecord(Source.HUMAN, "https://example.test:443", "GET", path, 200, "anon");
    }
}
