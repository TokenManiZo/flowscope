package io.flowscope.core.graph;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.SourceTrustPolicy;
import io.flowscope.core.Source;
import io.flowscope.core.RunPhase;
import java.util.*;
import java.util.regex.Pattern;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Display-only observations. Never changes operation/resource, authorization or replay targets. */
public final class ObservedObjectProjection {
    private ObservedObjectProjection() {}
    public record ObjectObservation(String eventId, String operation, String apiKey, String groupKey,
            String objectKey, String kind, List<String> fields, String legacyResource, int ordinal) {}
    private record PathRow(RequestRecord record, List<String> segments, Set<Integer> positions) {}
    private static final Pattern TOKEN = Pattern.compile("(?:\\d+|(?=[A-Za-z0-9._~-]*[A-Za-z])(?=[A-Za-z0-9._~-]*\\d)[A-Za-z0-9._~-]+)");
    private static boolean token(String value) { return !value.matches("(?i)v\\d+(?:\\.\\d+)?") && TOKEN.matcher(value).matches(); }

    public static List<ObjectObservation> build(List<RequestRecord> input) {
        // One captured event counts once, including when two rows accidentally reference it.
        Map<String, RequestRecord> unique = new LinkedHashMap<>();
        for (RequestRecord r : input) if (eligible(r)) unique.putIfAbsent(r.evidenceId, r);
        List<PathRow> rows = new ArrayList<>();
        Map<String, Set<String>> siblings = new HashMap<>();
        Map<String, Boolean> strongSibling = new HashMap<>();
        for (RequestRecord r : unique.values()) {
            List<String> segments = Arrays.asList(r.path.split("/", -1));
            if (segments.size() > 128 || r.path.length() > 8192) continue;
            Set<Integer> positions = new TreeSet<>();
            for (int i = 2; i < segments.size(); i++) if (token(segments.get(i))) positions.add(i);
            PathRow row = new PathRow(r, segments, positions);
            rows.add(row);
            for (int i = 2; i < segments.size(); i++) {
                if (segments.get(i).isEmpty()) continue;
                String key = siblingKey(row, i);
                siblings.computeIfAbsent(key, ignored -> new HashSet<>()).add(segments.get(i));
                if (token(segments.get(i))) strongSibling.put(key, true);
            }
        }
        // Infer string slots from structure, not a numeric/hex admission filter.
        for (PathRow row : rows) for (int i = 2; i < row.segments.size(); i++) {
            String key = siblingKey(row, i);
            if (!row.segments.get(i).isEmpty() && !strongSibling.getOrDefault(key, false)
                    && siblings.getOrDefault(key, Set.of()).size() > 1) row.positions.add(i);
        }
        Map<String, Set<String>> counts = new HashMap<>();
        for (PathRow row : rows) if (!row.positions.isEmpty()) {
            counts.computeIfAbsent(family(row), ignored -> new HashSet<>()).add(row.record.evidenceId);
        }
        List<ObjectObservation> out = new ArrayList<>();
        Map<String, LinkedHashMap<String, Integer>> ordinals = new HashMap<>();
        rows.sort(Comparator.comparingLong((PathRow row) -> row.record.timestamp).thenComparing(row -> row.record.evidenceId));
        for (PathRow row : rows) {
            if (row.positions.isEmpty() || counts.get(family(row)).size() < 2) continue;
            int position = row.positions.stream().mapToInt(Integer::intValue).max().orElseThrow();
            List<String> api = new ArrayList<>(row.segments);
            api.set(position, "{id}");
            String apiKey = row.record.service + " " + row.record.method + " " + String.join("/", api);
            String group = key("PATH", apiKey);
            // Actual parent scope and coordinate survive future family refinement.
            String object = key("PATH", row.record.service, row.record.method, row.record.path, Integer.toString(position));
            String legacy = row.record.resource;
            add(out, ordinals, row.record, apiKey, group, object, "PATH", List.of("/segments/" + (position - 1)), legacy);
        }
        return List.copyOf(out);
    }

    private static String siblingKey(PathRow row, int position) {
        List<String> shaped = new ArrayList<>(row.segments);
        row.positions.forEach(i -> shaped.set(i, "{id}"));
        shaped.set(position, "{id}");
        return row.record.service + "\0" + row.record.method + "\0" + position + "\0" + String.join("/", shaped);
    }
    private static String family(PathRow row) {
        List<String> shaped = new ArrayList<>(row.segments);
        row.positions.forEach(i -> shaped.set(i, "{id}"));
        return row.record.service + "\0" + row.record.method + "\0" + String.join("/", shaped);
    }
    private static void add(List<ObjectObservation> out, Map<String, LinkedHashMap<String, Integer>> ordinals,
            RequestRecord r, String api, String group, String object, String kind, List<String> fields, String legacy) {
        var members = ordinals.computeIfAbsent(group, ignored -> new LinkedHashMap<>());
        int number = members.computeIfAbsent(object, ignored -> members.size() + 1);
        out.add(new ObjectObservation(r.evidenceId, r.op, api, group, object, kind, fields, legacy, number));
    }
    private static String key(String... parts) {
        StringBuilder framed = new StringBuilder();
        for (String part : parts) framed.append(part.length()).append(':').append(part);
        try {
            return "obj-v1-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(framed.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static boolean eligible(RequestRecord r) {
        if (r == null || r.evidenceId == null || r.op == null || r.path == null
                || !SourceTrustPolicy.allows(r, SourceTrustPolicy.Use.ANALYSIS_COVERAGE)
                || !r.hasResponse || r.status < 100 || r.status > 599) return false;
        if (Set.of(RunPhase.SESSION_SETUP, RunPhase.AUTHORIZATION_REPLAY, RunPhase.COACH_PROBE, RunPhase.VALIDATION).contains(r.phase)) return false;
        if (r.sourceDetail.name().contains("REPEATER") || r.sourceDetail.name().contains("INTRUDER") || r.sourceDetail.name().contains("REQUEST_LAB")) return false;
        var c = r.trafficClassification;
        return !Set.of("STATIC_ASSET", "PREFLIGHT", "DISCOVERY_METADATA").contains(c.trafficClass().name())
                && !c.reasons().contains("USER_EXCLUDE") && !(c.userOverride() && c.disposition().name().equals("EXCLUDE"))
                && !r.path.matches("(?i).*\\.(?:m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|mp3|mp4|webm)$");
    }
}
