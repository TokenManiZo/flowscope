package io.flowscope.core;

import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Counts collected API facts. UNKNOWN methods and navigation/asset references never inflate operation counts. */
public final class CollectionProgress {
    public static final int UNIT_VERSION = 1;
    public static final String OPERATION_UNIT = "SERVICE_METHOD_TEMPLATE";
    public record PathKey(String service, String pathTemplate) {}
    public record Fact(SurfaceAnalysis.EndpointKey key, boolean observed, boolean declared) {}
    public record Inventory(List<SurfaceAnalysis.EndpointKey> observedOperations,
                            List<SurfaceAnalysis.EndpointKey> declaredUnobservedOperations,
                            List<PathKey> unknownMethodPaths) {}
    public record RunReport(String runId, long firstSeenMillis, int observedOperations,
                            int declaredUnobservedOperations, int unknownMethodPaths, int retainedHints) {}
    public record Change<T>(int count, List<T> items, boolean truncated) {}
    public record Diff(int unitVersion, String operationUnit, String beforeRunId, String afterRunId,
                       Change<SurfaceAnalysis.EndpointKey> observedAdded,
                       Change<SurfaceAnalysis.EndpointKey> observedRemoved,
                       Change<SurfaceAnalysis.EndpointKey> declaredUnobservedAdded,
                       Change<SurfaceAnalysis.EndpointKey> declaredUnobservedRemoved,
                       Change<PathKey> unknownMethodAdded, Change<PathKey> unknownMethodRemoved) {}

    private CollectionProgress() {}

    public static Inventory fromFacts(Collection<Fact> facts) {
        Set<SurfaceAnalysis.EndpointKey> observed = new LinkedHashSet<>();
        Set<SurfaceAnalysis.EndpointKey> declared = new LinkedHashSet<>();
        Set<PathKey> unknown = new LinkedHashSet<>();
        for (Fact fact : facts) {
            if (fact.key().method().equals("UNKNOWN")) {
                if (fact.declared()) unknown.add(new PathKey(fact.key().service(), fact.key().pathTemplate()));
            } else {
                if (fact.observed()) observed.add(fact.key());
                if (fact.declared()) declared.add(fact.key());
            }
        }
        declared.removeAll(observed);
        Comparator<SurfaceAnalysis.EndpointKey> order = Comparator.comparing(SurfaceAnalysis.EndpointKey::stableKey);
        return new Inventory(observed.stream().sorted(order).toList(), declared.stream().sorted(order).toList(),
                unknown.stream().sorted(Comparator.comparing(PathKey::service).thenComparing(PathKey::pathTemplate)).toList());
    }

    public static Inventory forRun(List<RouteCandidate> candidates, Source source, String runId) {
        return fromFacts(candidates.stream().map(candidate -> {
            var origins = candidate.provenance().stream()
                    .filter(origin -> origin.source() == source && runId.equals(origin.runId())).toList();
            return new Fact(new SurfaceAnalysis.EndpointKey(candidate.service(), candidate.method(), candidate.pathTemplate()),
                    origins.stream().anyMatch(origin -> origin.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST),
                    origins.stream().anyMatch(origin -> endpointDeclaration(candidate.method(), origin.type())));
        }).toList());
    }

    public static boolean endpointDeclaration(String method, RouteCandidate.ProvenanceType type) {
        return type == RouteCandidate.ProvenanceType.OPENAPI || type == RouteCandidate.ProvenanceType.HTML_FORM
                || type == RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL
                || type == RouteCandidate.ProvenanceType.LLM_ARTIFACT_ANALYSIS
                || type == RouteCandidate.ProvenanceType.XML_ROUTE && !method.equals("UNKNOWN");
    }

    public static List<RunReport> reports(List<RequestRecord> records, List<RouteCandidate> candidates,
                                        List<SurfaceAnalysis.RouteHint> hints, Collection<String> extraRunIds) {
        Set<String> ids = new LinkedHashSet<>(extraRunIds);
        Map<String, Long> firstSeen = new LinkedHashMap<>();
        Map<String, List<Fact>> factsByRun = new LinkedHashMap<>();
        Map<String, Integer> hintsByRun = new LinkedHashMap<>();
        for (RequestRecord record : records) {
            if (record.source != Source.LLM || record.phase != RunPhase.EXPLORATION) continue;
            ids.add(record.runId);
            if (record.timestamp > 0) firstSeen.merge(record.runId, record.timestamp, Math::min);
        }
        for (RouteCandidate candidate : candidates) {
            var originsByRun = candidate.provenance().stream().filter(origin -> origin.source() == Source.LLM)
                    .collect(java.util.stream.Collectors.groupingBy(RouteCandidate.Provenance::runId));
            originsByRun.forEach((id, origins) -> {
                ids.add(id);
                factsByRun.computeIfAbsent(id, ignored -> new java.util.ArrayList<>()).add(new Fact(
                        new SurfaceAnalysis.EndpointKey(candidate.service(), candidate.method(), candidate.pathTemplate()),
                        origins.stream().anyMatch(origin -> origin.type() == RouteCandidate.ProvenanceType.OBSERVED_REQUEST),
                        origins.stream().anyMatch(origin -> endpointDeclaration(candidate.method(), origin.type()))));
            });
        }
        hints.stream().filter(hint -> hint.source() == Source.LLM)
                .forEach(hint -> hintsByRun.merge(hint.runId(), 1, Integer::sum));
        return ids.stream().filter(id -> id != null && !id.isBlank() && !Set.of("default", "unknown-run").contains(id))
                .map(id -> {
                    Inventory inventory = fromFacts(factsByRun.getOrDefault(id, List.of()));
                    return new RunReport(id, firstSeen.getOrDefault(id, 0L), inventory.observedOperations().size(),
                            inventory.declaredUnobservedOperations().size(), inventory.unknownMethodPaths().size(), hintsByRun.getOrDefault(id, 0));
                }).sorted(Comparator.comparingLong(RunReport::firstSeenMillis).thenComparing(RunReport::runId)).toList();
    }

    public static Diff compare(String beforeRunId, Inventory before, String afterRunId, Inventory after) {
        return new Diff(UNIT_VERSION, OPERATION_UNIT, beforeRunId, afterRunId,
                difference(after.observedOperations(), before.observedOperations()),
                difference(before.observedOperations(), after.observedOperations()),
                difference(after.declaredUnobservedOperations(), before.declaredUnobservedOperations()),
                difference(before.declaredUnobservedOperations(), after.declaredUnobservedOperations()),
                difference(after.unknownMethodPaths(), before.unknownMethodPaths()),
                difference(before.unknownMethodPaths(), after.unknownMethodPaths()));
    }

    private static <T> Change<T> difference(List<T> left, List<T> right) {
        Set<T> excluded = new LinkedHashSet<>(right);
        List<T> values = left.stream().filter(value -> !excluded.contains(value)).toList();
        return new Change<>(values.size(), values.stream().limit(100).toList(), values.size() > 100);
    }
}
