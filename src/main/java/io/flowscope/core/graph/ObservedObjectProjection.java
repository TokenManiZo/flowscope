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
import java.net.URLDecoder;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import io.flowscope.core.parameter.ParameterExtractor;
import io.flowscope.core.parameter.ParameterObservation;

/** Display-only observations. Never changes operation/resource, authorization or replay targets. */
public final class ObservedObjectProjection {
    private ObservedObjectProjection() {}
    public record ObjectObservation(String eventId, String operation, String apiKey, String groupKey,
            String objectKey, String kind, List<String> fields, String legacyResource, int ordinal) {}
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(128).maxStringLength(1_000_000).build()).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
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
        Map<String, String> pathApis = new HashMap<>();
        for (ObjectObservation object : out) pathApis.put(object.eventId(), object.apiKey());
        unique.values().stream().sorted(Comparator.comparingLong((RequestRecord r) -> r.timestamp).thenComparing(r -> r.evidenceId))
                .forEach(r -> {
                    String api = pathApis.getOrDefault(r.evidenceId, r.op);
                    addQuery(out, ordinals, r, api);
                    addBody(out, ordinals, r, api);
                });
        return List.copyOf(out);
    }

    private static void addQuery(List<ObjectObservation> out, Map<String, LinkedHashMap<String, Integer>> ordinals,
                                 RequestRecord r, String api) {
        if (r.query == null || r.query.isBlank() || r.query.length() > 1_000_000) return;
        // Sorting names ignores query ordering, but repeated values retain their order and presence.
        Map<String, List<String>> values = new TreeMap<>();
        try {
            String[] pairs = r.query.split("&", -1);
            if (pairs.length > 10_000) return;
            for (String pair : pairs) {
                if (pair.isEmpty()) continue;
                String[] kv = pair.split("=", 2);
                String name = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
                if (name.length() > 8192) return;
                String value = kv.length == 1 ? "absent:" : "value:" + URLDecoder.decode(kv[1], StandardCharsets.UTF_8);
                values.computeIfAbsent(name, ignored -> new ArrayList<>()).add(sensitive(name) ? "[sensitive]" : value);
            }
            if (values.isEmpty()) return;
            List<String> fields = values.keySet().stream().map(name -> "/" + name.replace("~", "~0").replace("/", "~1")).toList();
            String group = key("QUERY", api, JSON.writeValueAsString(fields));
            String object = key("QUERY", api, JSON.writeValueAsString(values));
            add(out, ordinals, r, api, group, object, "QUERY", fields, legacy(r, "QUERY", fields));
        } catch (Exception ignored) { /* malformed percent encoding is not interpreted as a different value */ }
    }
    private static void addBody(List<ObjectObservation> out, Map<String, LinkedHashMap<String, Integer>> ordinals,
                                RequestRecord r, String api) {
        if (r.requestPayload != null && !r.requestPayload.retained()) return;
        String body = r.requestBodyForAnalysis();
        if (body == null || body.isBlank() || body.length() > 1_000_000) return;
        String contentType = r.requestContentType == null ? "" : r.requestContentType.toLowerCase(Locale.ROOT);
        try {
            SortedSet<String> fields = new TreeSet<>();
            String canonical;
            if (contentType.contains("json") || body.stripLeading().startsWith("{") || body.stripLeading().startsWith("[")) {
                JsonNode root = JSON.readTree(body);
                if (root == null) return;
                canonical = JSON.writeValueAsString(normalizeJson(root, "", fields, new int[]{0}));
            } else {
                // Reuse the bounded form/multipart/XML parser on body-only metadata, not retained raw messages.
                var probe = new RequestRecord(r.source, r.service, r.method, "/", r.status, r.fp);
                probe.op = r.op; probe.idn = r.idn; probe.evidenceId = r.evidenceId;
                probe.reqBody = body; probe.requestContentType = r.requestContentType;
                var extraction = ParameterExtractor.extract(probe);
                if (!extraction.parsedCompletely()) return;
                Map<String, List<String>> material = new TreeMap<>();
                for (var observation : extraction.observations()) {
                    if (observation.key().location() == ParameterObservation.Location.PATH || observation.key().location() == ParameterObservation.Location.QUERY) continue;
                    String path = observation.key().canonicalPath();
                    fields.add(path);
                    boolean hidden = Arrays.stream(path.split("/")).anyMatch(ObservedObjectProjection::sensitive);
                    var value = observation.value();
                    material.put(observation.key().location() + ":" + path, hidden ? List.of("[sensitive]", observation.shape().name())
                            : List.of(observation.shape().name(), value == null ? "container" : value.type().name(), value == null ? "" : value.digest()));
                }
                if (material.isEmpty()) return;
                canonical = JSON.writeValueAsString(material);
            }
            List<String> schema = List.copyOf(fields);
            String group = key("REQUEST_BODY", api, JSON.writeValueAsString(schema));
            add(out, ordinals, r, api, group, key("REQUEST_BODY", api, canonical), "REQUEST_BODY", schema, legacy(r, "BODY", schema));
        } catch (Exception ignored) { /* invalid, incomplete or over-limit bodies do not claim content equality */ }
    }
    private static JsonNode normalizeJson(JsonNode node, String path, SortedSet<String> fields, int[] visited) {
        if (++visited[0] > 100_000 || path.length() > 8192) throw new IllegalArgumentException("object projection limit");
        if (node.isObject()) {
            var normalized = JSON.createObjectNode();
            var names = new TreeSet<String>(); node.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                String childPath = path + "/" + name.replace("~", "~0").replace("/", "~1");
                if (sensitive(name)) {
                    fields.add(childPath);
                    JsonNode child = node.get(name);
                    normalized.put(name, "[sensitive:" + child.getNodeType().name() + "]");
                } else normalized.set(name, normalizeJson(node.get(name), childPath, fields, visited));
            }
            if (names.isEmpty()) fields.add(path.isEmpty() ? "/" : path);
            return normalized;
        }
        if (node.isArray()) {
            var normalized = JSON.createArrayNode();
            for (JsonNode child : node) normalized.add(normalizeJson(child, path + "/*", fields, visited));
            if (node.isEmpty()) fields.add(path.isEmpty() ? "/" : path);
            return normalized;
        }
        fields.add(path.isEmpty() ? "/" : path);
        return node;
    }

    private static boolean sensitive(String name) {
        String normalized = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return normalized.contains("password") || normalized.contains("passwd") || normalized.contains("secret")
                || normalized.contains("token") || normalized.contains("authorization") || normalized.contains("cookie")
                || normalized.contains("session") || normalized.equals("pwd") || normalized.equals("apikey")
                || normalized.equals("credential") || normalized.equals("credentials");
    }
    private static String legacy(RequestRecord r, String channel, List<String> fields) {
        if (fields.size() != 1 || r.resource == null) return null;
        var references = r.resourceReferences.stream().filter(ref -> ref.evidence().startsWith(channel)).toList();
        return references.size() == 1 && r.resource.equals(references.getFirst().resource()) ? r.resource : null;
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
