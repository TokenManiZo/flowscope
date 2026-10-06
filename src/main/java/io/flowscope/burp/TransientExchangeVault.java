package io.flowscope.burp;

import io.flowscope.core.RequestRecord;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Bounded process-memory copy of raw HTTP bytes for an operator-opened request lab.
 * Values never enter RequestRecord or project persistence and are overwritten on eviction/clear.
 */
final class TransientExchangeVault {
    record Exchange(byte[] request, int requestBodyOffset, byte[] response, int responseBodyOffset,
                    int requestBytes, int responseBytes, boolean requestRetained, boolean responseRetained) {
        Exchange {
            request = request == null ? null : request.clone();
            response = response == null ? null : response.clone();
        }

        @Override public byte[] request() { return request == null ? null : request.clone(); }
        @Override public byte[] response() { return response == null ? null : response.clone(); }
    }

    private static final class Entry {
        private final byte[] request;
        private final byte[] response;
        private final int requestBodyOffset;
        private final int responseBodyOffset;
        private final int requestBytes;
        private final int responseBytes;

        private Entry(byte[] request, int requestBodyOffset, byte[] response, int responseBodyOffset,
                      int requestBytes, int responseBytes) {
            this.request = request;
            this.response = response;
            this.requestBodyOffset = requestBodyOffset;
            this.responseBodyOffset = responseBodyOffset;
            this.requestBytes = requestBytes;
            this.responseBytes = responseBytes;
        }

        private int retainedBytes() {
            return (request == null ? 0 : requestBytes) + (response == null ? 0 : responseBytes);
        }

        private Exchange view() {
            return new Exchange(request, requestBodyOffset, response, responseBodyOffset,
                    requestBytes, responseBytes, request != null, response != null);
        }

        private void destroy() {
            if (request != null) Arrays.fill(request, (byte) 0);
            if (response != null) Arrays.fill(response, (byte) 0);
        }
    }

    private final int requestLimitBytes;
    private final int responseLimitBytes;
    private final long totalLimitBytes;
    private final LinkedHashMap<Long, Entry> entries = new LinkedHashMap<>();
    private long retainedBytes;

    TransientExchangeVault(int requestLimitBytes, int responseLimitBytes, long totalLimitBytes) {
        if (requestLimitBytes < 0 || responseLimitBytes < 0 || totalLimitBytes < 0) {
            throw new IllegalArgumentException("raw exchange limits must be non-negative");
        }
        this.requestLimitBytes = requestLimitBytes;
        this.responseLimitBytes = responseLimitBytes;
        this.totalLimitBytes = totalLimitBytes;
    }

    synchronized void put(RequestRecord record, byte[] request, int requestBodyOffset,
                          byte[] response, int responseBodyOffset) {
        put(record, request, requestBodyOffset, request == null ? 0 : request.length,
                response, responseBodyOffset, response == null ? 0 : response.length);
    }

    synchronized void put(RequestRecord record, byte[] request, int requestBodyOffset, int requestBytes,
                          byte[] response, int responseBodyOffset, int responseBytes) {
        if (record == null) return;
        if (requestBytes < 0 || responseBytes < 0
                || (request != null && request.length != requestBytes)
                || (response != null && response.length != responseBytes)) {
            throw new IllegalArgumentException("raw exchange metadata is inconsistent");
        }
        remove(record);
        byte[] retainedRequest = request != null && requestBytes <= requestLimitBytes ? request.clone() : null;
        byte[] retainedResponse = response != null && responseBytes <= responseLimitBytes ? response.clone() : null;
        Entry entry = new Entry(retainedRequest, clampOffset(requestBodyOffset, requestBytes), retainedResponse,
                clampOffset(responseBodyOffset, responseBytes), requestBytes, responseBytes);
        while (!entries.isEmpty() && retainedBytes + entry.retainedBytes() > totalLimitBytes) {
            Map.Entry<Long, Entry> oldest = entries.entrySet().iterator().next();
            entries.remove(oldest.getKey());
            retainedBytes -= oldest.getValue().retainedBytes();
            oldest.getValue().destroy();
        }
        if (entry.retainedBytes() > totalLimitBytes) {
            entry.destroy();
            entry = new Entry(null, clampOffset(requestBodyOffset, requestBytes), null,
                    clampOffset(responseBodyOffset, responseBytes), requestBytes, responseBytes);
        }
        entries.put(record.runtimeId(), entry);
        retainedBytes += entry.retainedBytes();
    }

    /** 원문을 꺼내지 않고 요청 원문이 남아 있는지만 본다. 스냅샷마다 모든 기록에 대해 부르므로 복사하지 않는다. */
    synchronized boolean requestRetained(RequestRecord record) {
        Entry entry = record == null ? null : entries.get(record.runtimeId());
        return entry != null && entry.request != null;
    }

    synchronized Optional<Exchange> get(RequestRecord record) {
        Entry entry = record == null ? null : entries.get(record.runtimeId());
        return entry == null ? Optional.empty() : Optional.of(entry.view());
    }

    synchronized void discard(java.util.Set<Long> runtimeIds) {
        for (long id : runtimeIds) {
            Entry entry = entries.remove(id);
            if (entry != null) { retainedBytes -= entry.retainedBytes(); entry.destroy(); }
        }
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
        Entry previous = entries.remove(record.runtimeId());
        if (previous == null) return;
        retainedBytes -= previous.retainedBytes();
        previous.destroy();
    }

    private static int clampOffset(int offset, int length) {
        return Math.max(0, Math.min(offset, length));
    }
}
