package io.flowscope.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** 원본 Evidence를 보존한 채 동일 의미 관측의 표시 메타데이터만 계산한다. */
public final class ObservationCollapser {
    public record Group(String id, int count, long firstSeen, long lastSeen, List<String> evidenceIds) {}

    private ObservationCollapser() {}

    public static Map<String, Group> byEvidence(List<RequestRecord> records) {
        Map<String, MutableGroup> groups = new LinkedHashMap<>();
        for (RequestRecord record : records) {
            String key = key(record);
            MutableGroup group = groups.computeIfAbsent(key,
                    ignored -> new MutableGroup("cluster-" + Fingerprints.hash(key)));
            group.add(record);
        }
        Map<String, Group> out = new LinkedHashMap<>();
        for (MutableGroup group : groups.values()) {
            Group value = group.freeze();
            for (String evidenceId : value.evidenceIds()) out.put(evidenceId, value);
        }
        return Map.copyOf(out);
    }

    private static String key(RequestRecord record) {
        return String.join("\u0000", record.source.name(), String.valueOf(record.idn), String.valueOf(record.runId),
                record.phase.name(), record.method, String.valueOf(record.op), String.valueOf(record.resource),
                String.valueOf(record.query), String.valueOf(record.reqBody), Integer.toString(record.status / 100),
                String.valueOf(record.body), String.valueOf(record.location));
    }

    private static final class MutableGroup {
        final String id;
        final List<String> evidenceIds = new ArrayList<>();
        long first;
        long last;

        MutableGroup(String id) { this.id = id; }

        void add(RequestRecord record) {
            evidenceIds.add(Objects.requireNonNull(record.evidenceId));
            if (record.timestamp > 0) {
                first = first == 0 ? record.timestamp : Math.min(first, record.timestamp);
                last = Math.max(last, record.timestamp);
            }
        }

        Group freeze() { return new Group(id, evidenceIds.size(), first, last, List.copyOf(evidenceIds)); }
    }
}
