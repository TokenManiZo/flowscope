package io.flowscope.core;

import io.flowscope.core.graph.ObservedObjectProjection.ObjectObservation;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** One exclusion rule for the matrix UI and every MCP entry point. */
public final class MatrixExclusionMatcher {
    private record Target(String operation, String resource) {}
    private final Set<String> apiExclusions = new HashSet<>();
    private final Set<Target> objectExclusions = new HashSet<>();
    private final Set<String> objectOperations = new HashSet<>();
    private final Map<String, Set<String>> apiKeys = new HashMap<>();

    public MatrixExclusionMatcher(AnalysisConfig config, Pipeline.Result snapshot) {
        for (MatrixExclusion entry : config.matrixExclusions().values()) {
            if (entry.resource() == null) apiExclusions.add(entry.operation());
            else {
                objectExclusions.add(new Target(entry.operation(), snapshot.objects.canonicalResource(entry.resource())));
                objectOperations.add(entry.operation());
            }
        }
        Map<String, String> families = new HashMap<>();
        for (ObjectObservation object : snapshot.objects.observations()) {
            if (object.apiFamily() != null) families.put(object.apiKey(), object.apiFamily());
        }
        for (ObjectObservation object : snapshot.objects.observations()) {
            apiKeys.computeIfAbsent(object.operation(), ignored -> new HashSet<>())
                    .add(object.apiFamily() == null ? families.getOrDefault(object.apiKey(), object.apiKey()) : object.apiFamily());
        }
    }

    public boolean excluded(String operation, String resource) {
        if (operation == null) return false;
        Set<String> keys = apiKeys.get(operation);
        String api = keys == null ? shape(operation) : keys.size() == 1 ? keys.iterator().next() : operation;
        return apiExclusions.contains(operation) || apiExclusions.contains(api)
                || resource != null && objectExclusions.contains(new Target(operation, resource));
    }

    public boolean hasObjectExclusion(String operation) {
        return objectOperations.contains(operation);
    }

    private static String shape(String operation) {
        int path = operation.lastIndexOf(" /");
        if (path < 0) return operation;
        String[] segments = operation.substring(path + 1).split("/", -1);
        for (int i = 0; i < segments.length; i++) {
            String segment;
            try { segment = java.net.URLDecoder.decode(segments[i].replace("+", "%2B"), java.nio.charset.StandardCharsets.UTF_8); }
            catch (IllegalArgumentException error) { continue; }
            if (segment.matches("[0-9]+") || segment.matches("(?i)(?=.*[a-z])(?=.*[0-9])[a-z0-9._~-]+")
                    && !segment.matches("(?i)v[0-9]+(?:\\.[0-9]+)?")) segments[i] = "{id}";
        }
        return operation.substring(0, path + 1) + String.join("/", segments);
    }
}
