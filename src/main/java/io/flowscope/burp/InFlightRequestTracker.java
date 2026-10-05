package io.flowscope.burp;

import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;

import java.util.HashMap;
import java.util.Map;

/** 요청과 응답 사이에서 요청 시점의 run/account 문맥과 데이터셋 세대를 보존한다. */
final class InFlightRequestTracker {
    record Observation(RunContextRegistry.Context context, String humanCaptureAccountId,
                       boolean humanCaptureSuppressed, long datasetEpoch, long startedAt,
                       Source source, SourceDetail detail, int listenerPort, long humanCaptureGeneration) {
        boolean belongsTo(long currentDatasetEpoch) {
            return datasetEpoch == currentDatasetEpoch;
        }
    }

    private final int capacity;
    private final long ttlMillis;
    private final Map<Integer, Observation> observations = new HashMap<>();

    InFlightRequestTracker(int capacity, long ttlMillis) {
        if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
        if (ttlMillis < 1) throw new IllegalArgumentException("ttlMillis must be positive");
        this.capacity = capacity;
        this.ttlMillis = ttlMillis;
    }

    synchronized boolean remember(int messageId, RunContextRegistry.Context context, String humanCaptureAccountId,
                                  boolean humanCaptureSuppressed, long datasetEpoch, long now) {
        return remember(messageId, context, humanCaptureAccountId, humanCaptureSuppressed,
                datasetEpoch, now, Source.UNKNOWN, SourceDetail.UNKNOWN, -1);
    }

    synchronized boolean remember(int messageId, RunContextRegistry.Context context, String humanCaptureAccountId,
                                  boolean humanCaptureSuppressed, long datasetEpoch, long now,
                                  Source source, SourceDetail detail, int listenerPort) {
        return remember(messageId, context, humanCaptureAccountId, humanCaptureSuppressed,
                datasetEpoch, now, source, detail, listenerPort, -1);
    }

    synchronized boolean remember(int messageId, RunContextRegistry.Context context, String humanCaptureAccountId,
                                  boolean humanCaptureSuppressed, long datasetEpoch, long now,
                                  Source source, SourceDetail detail, int listenerPort, long humanCaptureGeneration) {
        if (observations.size() >= capacity) {
            observations.entrySet().removeIf(entry -> now - entry.getValue().startedAt() > ttlMillis);
        }
        if (observations.size() >= capacity) return false;
        observations.put(messageId, new Observation(context, humanCaptureAccountId,
                humanCaptureSuppressed, datasetEpoch, now, source, detail, listenerPort, humanCaptureGeneration));
        return true;
    }

    synchronized Observation get(int messageId) { return observations.get(messageId); }

    synchronized Observation remove(int messageId) {
        return observations.remove(messageId);
    }

    synchronized void clear() {
        observations.clear();
    }
}
