package io.flowscope.core;

import java.util.Map;
import java.util.Set;

/** Project-owned API marks and removed declaration links; never contains HTTP payloads. */
public record ApiState(Map<String, String> highlights, Map<String, Set<String>> removedDeclarations) {
    public static final Set<String> COLORS = Set.of("yellow", "orange", "red", "pink", "purple", "blue", "green", "gray");
    public ApiState {
        highlights = highlights == null ? Map.of() : Map.copyOf(highlights);
        removedDeclarations = removedDeclarations == null ? Map.of() : removedDeclarations.entrySet().stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey, e -> Set.copyOf(e.getValue())));
        if (highlights.size() > 20_000 || removedDeclarations.size() > 20_000) throw new IllegalArgumentException("API state limit exceeded");
        highlights.forEach((key, color) -> { coordinate(key); if (!COLORS.contains(color)) throw new IllegalArgumentException("invalid highlight color"); });
        removedDeclarations.forEach((key, links) -> { coordinate(key); if (links.size() > 20_000 || links.stream().anyMatch(v -> v == null || v.length() > 4096)) throw new IllegalArgumentException("invalid declaration links"); });
    }
    private static void coordinate(String key) {
        if (key == null || key.isBlank() || key.length() > 2048) throw new IllegalArgumentException("invalid API coordinate");
    }
    public static ApiState empty() { return new ApiState(Map.of(), Map.of()); }
}
