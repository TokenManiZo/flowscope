package io.flowscope.core;

import io.flowscope.core.graph.ObservedObjectProjection;
import java.util.*;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** Shared, immutable OBJ identity/evidence index. Hashes remain those of the existing recognizer. */
public final class ObservedObjectIndex {
    public record Target(String resource, String operation, String kind, String label,
                         String responseReference, Set<String> evidenceIds) {}
    private final List<ObservedObjectProjection.ObjectObservation> observations;
    private final Map<String, Target> targets;
    private final Map<String, Set<String>> byEvidence;
    private final List<RequestRecord> projectionRecords;
    private ObservedObjectIndex(List<ObservedObjectProjection.ObjectObservation> observations,
                                Map<String, Target> targets, Map<String, Set<String>> byEvidence, List<RequestRecord> projectionRecords) {
        this.observations = List.copyOf(observations); this.targets = Map.copyOf(targets);
        this.byEvidence = Map.copyOf(byEvidence); this.projectionRecords = List.copyOf(projectionRecords);
    }
    public List<ObservedObjectProjection.ObjectObservation> observations() { return observations; }
    public Map<String, Target> targets() { return targets; }
    public Set<String> resources(String evidenceId) { return byEvidence.getOrDefault(evidenceId, Set.of()); }
    /** Match a stored manual response to an existing OBJ without creating a judgment target. */
    public boolean matchesInput(RequestRecord record, String resource) {
        if (!targets.containsKey(resource) || !targets.get(resource).operation().equals(record.op)) return false;
        boolean manualValidation = record.phase == RunPhase.VALIDATION && record.source == Source.HUMAN
                && record.executionTrust == ExecutionTrust.CONTROLLED;
        if (!coreApi(record) && !manualValidation) return false;
        RequestRecord probe = record.analysisCopy();
        probe.phase = RunPhase.EXPLORATION; probe.sourceDetail = SourceDetail.XML_IMPORT;
        List<RequestRecord> inputs = new ArrayList<>(projectionRecords); inputs.add(probe);
        return ObservedObjectProjection.build(inputs).stream().anyMatch(object -> object.eventId().equals(record.evidenceId)
                && resource.equals(resource(object)));
    }
    public boolean contains(String evidenceId, String resource) { return resources(evidenceId).contains(resource); }
    public String reference(String resource) { Target target = targets.get(resource); return target == null ? null : target.responseReference(); }
    public static String resource(ObservedObjectProjection.ObjectObservation object) {
        return object.operation().split(" ")[0] + " observed-object:" + object.objectKey();
    }
    public static ObservedObjectIndex build(List<RequestRecord> records) {
        // Judgment targets use core API traffic, independent of the observation-only graph scope.
        records = records.stream().filter(ObservedObjectIndex::coreApi).toList();
        var observations = ObservedObjectProjection.build(records);
        Map<String, RequestRecord> events = new LinkedHashMap<>();
        records.forEach(record -> events.putIfAbsent(record.evidenceId, record));
        Map<String, List<ObservedObjectProjection.ObjectObservation>> grouped = new LinkedHashMap<>();
        Map<String, Set<String>> byEvidence = new LinkedHashMap<>();
        for (var object : observations) {
            String resource = resource(object);
            grouped.computeIfAbsent(resource, ignored -> new ArrayList<>()).add(object);
            byEvidence.computeIfAbsent(object.eventId(), ignored -> new LinkedHashSet<>()).add(resource);
        }
        Map<String, Target> targets = new LinkedHashMap<>();
        for (var entry : grouped.entrySet()) {
            var first = entry.getValue().getFirst();
            var references = new HashSet<String>();
            Set<String> ids = new LinkedHashSet<>();
            for (var observation : entry.getValue()) {
                ids.add(observation.eventId()); references.add(reference(observation, events.get(observation.eventId())));
            }
            String reference = references.size() == 1 ? references.iterator().next() : null;
            String label = first.integerLabel() != null ? first.integerLabel() : "OBJ " + (first.displayOrdinal() > 0 ? first.displayOrdinal() : first.ordinal());
            targets.put(entry.getKey(), new Target(entry.getKey(), first.operation(), first.kind(), label, reference, Set.copyOf(ids)));
        }
        // Controlled authorization replays can reuse a collected target; they never create or renumber OBJ.
        List<RequestRecord> projectionInputs = new ArrayList<>(records);
        Set<String> replayIds = new HashSet<>();
        for (int index = 0; index < records.size(); index++) {
            RequestRecord record = records.get(index);
            if (record.phase != RunPhase.AUTHORIZATION_REPLAY || record.executionTrust != ExecutionTrust.CONTROLLED) continue;
            RequestRecord copy = record.analysisCopy();
            copy.phase = RunPhase.EXPLORATION; copy.sourceDetail = SourceDetail.XML_IMPORT;
            projectionInputs.set(index, copy);
            replayIds.add(record.evidenceId);
        }
        if (!replayIds.isEmpty()) for (var object : ObservedObjectProjection.build(projectionInputs)) {
            String target = resource(object);
            if (replayIds.contains(object.eventId()) && targets.containsKey(target))
                byEvidence.computeIfAbsent(object.eventId(), ignored -> new LinkedHashSet<>()).add(target);
        }
        byEvidence.replaceAll((key, value) -> Set.copyOf(value));
        return new ObservedObjectIndex(observations, targets, byEvidence, projectionInputs);
    }
    public static boolean coreApi(RequestRecord record) {
        if (record.trafficClassification == null || !record.trafficClassification.coverageEligible()
                || !SourceTrustPolicy.allows(record, SourceTrustPolicy.Use.ANALYSIS_COVERAGE)) return false;
        return record.trafficClassification.trafficClass() == TrafficClassification.TrafficClass.API;
    }
    /** A response target is explicit identifier metadata, never the display hash or pagination/credentials. */
    private static String reference(ObservedObjectProjection.ObjectObservation object, RequestRecord record) {
        if (record == null) return null;
        try {
            if (object.kind().equals("PATH")) {
                int position = Integer.parseInt(object.fields().getFirst().substring("/segments/".length())) + 1;
                String[] segments = record.path.split("/", -1);
                if (position <= 0 || position >= segments.length) return null;
                String value = new java.net.URI("/" + segments[position]).getPath().substring(1);
                String collection = position > 1 ? segments[position - 1] : "object";
                // Actual parent scope stays in the OBJ key; this reference is used only inside response matching.
                return record.service + " " + collection + ":" + value;
            }
            Map<String, String> candidates = new LinkedHashMap<>();
            if (object.kind().equals("QUERY")) {
                for (String pair : record.query.split("&", -1)) {
                    String[] parts = pair.split("=", 2);
                    String name = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
                    if (parts.length == 2 && identifier(name)) {
                        if (candidates.containsKey(name)) return null;
                        candidates.put(name, URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
                    }
                }
            } else if (object.kind().equals("REQUEST_BODY")) {
                var json = ResponseEvidence.parseBoundedJson(record.requestBodyForAnalysis());
                if (json != null) for (String pointer : object.fields()) {
                    String name = pointer.substring(pointer.lastIndexOf('/') + 1);
                    var value = json.at(pointer);
                    if (identifier(name) && value.isValueNode() && !value.isNull()) candidates.put(pointer, value.asText());
                }
                if (json == null) {
                    var probe = new RequestRecord(record.source, record.service, record.method, "/", record.status, record.fp);
                    probe.op = record.op; probe.idn = record.idn; probe.evidenceId = record.evidenceId;
                    probe.reqBody = record.requestBodyForAnalysis(); probe.requestContentType = record.requestContentType;
                    var extraction = io.flowscope.core.parameter.ParameterExtractor.extract(probe);
                    if (!extraction.parsedCompletely()) return null;
                    for (var field : extraction.observations()) {
                        String pointer = field.key().canonicalPath();
                        String name = pointer.substring(pointer.lastIndexOf('/') + 1);
                        var value = field.value();
                        if (object.fields().contains(pointer) && identifier(name) && value != null && value.preview() != null
                                && value.byteLength() == value.preview().getBytes(StandardCharsets.UTF_8).length && !value.preview().contains("***"))
                            candidates.put(pointer, value.preview());
                    }
                }
            }
            if (candidates.size() != 1) return null;
            var candidate = candidates.entrySet().iterator().next();
            if (candidate.getValue().isBlank() || candidate.getValue().length() > 4096 || candidate.getValue().contains("/")) return null;
            String name = candidate.getKey().substring(candidate.getKey().lastIndexOf('/') + 1);
            String type = name.replaceAll("(?i)[_-]?(id|uuid|guid|key|ref)$", "");
            return record.service + " " + (type.isBlank() ? "object" : type) + ":" + candidate.getValue();
        } catch (Exception unreadable) { return null; }
    }
    private static boolean identifier(String name) {
        String normalized = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (normalized.matches(".*(?:password|token|session|secret|apikey|credential).*" ) || Set.of("limit", "offset", "cursor").contains(normalized)) return false;
        return normalized.equals("id") || normalized.equals("uuid") || normalized.equals("guid")
                || normalized.endsWith("id") || normalized.endsWith("uuid") || normalized.endsWith("guid");
    }
}
