package io.flowscope.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Preserves observation multiplicity while avoiding duplicates on repeated history imports. */
public final class RecordMerge {
    private RecordMerge() {}

    public static List<RequestRecord> missing(List<RequestRecord> existing,
                                              List<RequestRecord> incoming,
                                              int limit) {
        if (limit <= 0 || incoming.isEmpty()) return List.of();

        Map<Key, Integer> remaining = new HashMap<>();
        for (RequestRecord record : existing) {
            remaining.merge(Key.of(record), 1, Integer::sum);
        }

        List<RequestRecord> result = new ArrayList<>(Math.min(limit, incoming.size()));
        for (RequestRecord record : incoming) {
            Key key = Key.of(record);
            int count = remaining.getOrDefault(key, 0);
            if (count > 0) {
                remaining.put(key, count - 1);
                continue;
            }
            result.add(record);
            if (result.size() == limit) break;
        }
        return List.copyOf(result);
    }

    private record Key(Source source, SourceDetail detail, String service, String method,
                       String path, int status, String fingerprint, String laneAccountId, String supportingPageUrl,
                       String runId, String request, String response) {
        static Key of(RequestRecord record) {
            return new Key(record.source, record.sourceDetail, record.service, record.method,
                    record.path, record.status, record.fp, record.laneAccountId, record.supportingPageUrl, record.runId,
                    payloadKey(record.requestPayload, record.reqText),
                    payloadKey(record.responsePayload, record.respText));
        }

        private static String payloadKey(StoredPayload payload, String preview) {
            return payload == null ? preview : payload.digest();
        }
    }
}
