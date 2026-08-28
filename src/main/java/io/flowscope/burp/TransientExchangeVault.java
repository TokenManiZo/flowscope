package io.flowscope.burp;

import io.flowscope.core.RequestRecord;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Bounded process-memory copy of raw HTTP text for an operator-opened request lab.
 * Values never enter RequestRecord or project persistence and are overwritten on eviction/clear.
 */
final class TransientExchangeVault {
    record Exchange(String request, String response, int requestBytes, int responseBytes,
                    boolean requestRetained, boolean responseRetained) {}

    private static final class Entry {
        private final byte[] request;
        private final byte[] response;
        private final int requestBytes;
        private final int responseBytes;

        private Entry(byte[] request, byte[] response, int requestBytes, int responseBytes) {
            this.request = request;
            this.response = response;
            this.requestBytes = requestBytes;
            this.responseBytes = responseBytes;
        }

        private int retainedBytes() {
            return (request == null ? 0 : requestBytes) + (response == null ? 0 : responseBytes);
        }

        private Exchange view() {
            return new Exchange(request == null ? null : new String(request, StandardCharsets.UTF_8),
                    response == null ? null : new String(response, StandardCharsets.UTF_8), requestBytes, responseBytes,
                    request != null, response != null);
        }

        private void destroy() {
            if (request != null) Arrays.fill(request, (byte) 0);
            if (response != null) Arrays.fill(response, (byte) 0);
        }
    }

    private final int requestLimitBytes;
    private final int responseLimitBytes;
    private final long totalLimitBytes;
    private final LinkedHashMap<RequestRecord, Entry> entries = new LinkedHashMap<>();
    private long retainedBytes;

    TransientExchangeVault(int requestLimitBytes, int responseLimitBytes, long totalLimitBytes) {
        if (requestLimitBytes < 0 || responseLimitBytes < 0 || totalLimitBytes < 0) {
            throw new IllegalArgumentException("raw exchange limits must be non-negative");
        }
        this.requestLimitBytes = requestLimitBytes;
        this.responseLimitBytes = responseLimitBytes;
        this.totalLimitBytes = totalLimitBytes;
    }

    synchronized void put(RequestRecord record, String request, String response) {
        if (record == null) return;
        remove(record);
        int requestBytes = bytes(request);
        int responseBytes = bytes(response);
        byte[] retainedRequest = request != null && requestBytes <= requestLimitBytes
                ? request.getBytes(StandardCharsets.UTF_8) : null;
        byte[] retainedResponse = response != null && responseBytes <= responseLimitBytes
                ? response.getBytes(StandardCharsets.UTF_8) : null;
        Entry entry = new Entry(retainedRequest, retainedResponse, requestBytes, responseBytes);
        while (!entries.isEmpty() && retainedBytes + entry.retainedBytes() > totalLimitBytes) {
            Map.Entry<RequestRecord, Entry> oldest = entries.entrySet().iterator().next();
            entries.remove(oldest.getKey());
            retainedBytes -= oldest.getValue().retainedBytes();
            oldest.getValue().destroy();
        }
        if (entry.retainedBytes() > totalLimitBytes) {
            entry.destroy();
            entry = new Entry(null, null, requestBytes, responseBytes);
        }
        entries.put(record, entry);
        retainedBytes += entry.retainedBytes();
    }

    synchronized Optional<Exchange> get(RequestRecord record) {
        Entry entry = entries.get(record);
        return entry == null ? Optional.empty() : Optional.of(entry.view());
    }

    synchronized void clear() {
        entries.values().forEach(Entry::destroy);
        entries.clear();
        retainedBytes = 0;
    }

    synchronized long retainedBytes() {
        return retainedBytes;
    }

    private void remove(RequestRecord record) {
        Entry previous = entries.remove(record);
        if (previous == null) return;
        retainedBytes -= previous.retainedBytes();
        previous.destroy();
    }

    private static int bytes(String value) {
        return value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length;
    }
}
