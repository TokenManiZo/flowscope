package io.flowscope.burp;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class TransientExchangeVaultTest {
    @Test
    void retainsRawTextOnlyInBoundedMemoryAndClearsIt() {
        TransientExchangeVault vault = new TransientExchangeVault(64, 64, 128);
        RequestRecord record = record("/one");

        vault.put(record, "GET /one HTTP/1.1\r\nAuthorization: Bearer raw-token", "HTTP/1.1 200 OK");

        TransientExchangeVault.Exchange exchange = vault.get(record).orElseThrow();
        assertTrue(exchange.request().contains("raw-token"));
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

        vault.put(record, "GET /large HTTP/1.1", "HTTP/1.1 200 OK");

        TransientExchangeVault.Exchange exchange = vault.get(record).orElseThrow();
        assertFalse(exchange.requestRetained());
        assertFalse(exchange.responseRetained());
        assertNull(exchange.request());
        assertTrue(exchange.requestBytes() > 8);
    }

    @Test
    void evictsOldestExchangeBeforeExceedingTotalLimit() {
        TransientExchangeVault vault = new TransientExchangeVault(64, 64, 24);
        RequestRecord first = record("/first");
        RequestRecord second = record("/second");
        vault.put(first, "123456789012", null);
        vault.put(second, "abcdefghijklm", null);

        assertTrue(vault.get(first).isEmpty());
        assertEquals("abcdefghijklm", vault.get(second).orElseThrow().request());
        assertTrue(vault.retainedBytes() <= 24);
    }

    private static RequestRecord record(String path) {
        return new RequestRecord(Source.HUMAN, "https://example.test:443", "GET", path, 200, "anon");
    }
}
