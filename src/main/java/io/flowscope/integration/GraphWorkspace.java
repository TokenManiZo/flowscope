package io.flowscope.integration;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.flowscope.core.Masking;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;

/** Project-owned layout only. No HTTP text, selection or transient gesture state. */
public record GraphWorkspace(int version, Navigation navigation, Map<String, View> views,
                             boolean locked, String inputMode) {
    public record State(long datasetRevision, long revision, GraphWorkspace workspace) {}
    /** Only changed views/settings travel over the loopback API. */
    public record Change(Navigation navigation, Map<String, View> views, List<String> deletedViews, Boolean locked, String inputMode) {
        public Change {
            if (views == null || views.size() > 200) throw new IllegalArgumentException("invalid graph changes");
            views.keySet().forEach(GraphWorkspace::text);
            views = Map.copyOf(views);
            deletedViews = deletedViews == null ? List.of() : List.copyOf(deletedViews);
            if (deletedViews.size() > 200) throw new IllegalArgumentException("invalid graph changes");
            deletedViews.forEach(GraphWorkspace::text);
        }
        public GraphWorkspace apply(GraphWorkspace current) {
            Map<String, View> merged = new HashMap<>(current.views());
            deletedViews.forEach(merged::remove);
            merged.putAll(views);
            return new GraphWorkspace(1, navigation == null ? current.navigation() : navigation, merged,
                    locked == null ? current.locked() : locked, inputMode == null ? current.inputMode() : inputMode);
        }
    }
    public GraphWorkspace {
        if (version != 1 || navigation == null || views == null || views.size() > 200
                || !Set.of("auto", "mouse", "trackpad").contains(inputMode == null ? "" : inputMode)) {
            throw new IllegalArgumentException("invalid graph workspace");
        }
        int nodes = 0;
        for (var entry : views.entrySet()) {
            text(entry.getKey());
            if (entry.getValue() == null) throw new IllegalArgumentException("invalid graph view");
            nodes += entry.getValue().positions().size();
        }
        if (nodes > 20_000) throw new IllegalArgumentException("graph workspace node limit exceeded");
        views = Map.copyOf(views);
    }

    public static GraphWorkspace empty() {
        return new GraphWorkspace(1, new Navigation("site", "", "", 18, 18, ""), Map.of(), false, "auto");
    }

    public record Navigation(String level, String groupId, String operation, int operationLimit,
                             int objectLimit, String focusCandidateKey) {
        public Navigation {
            if (!Set.of("site", "group", "operation").contains(level == null ? "" : level)
                    || operationLimit < 1 || operationLimit > 20_018 || objectLimit < 1 || objectLimit > 20_018) {
                throw new IllegalArgumentException("invalid graph navigation");
            }
            text(groupId); text(operation); text(focusCandidateKey);
        }
    }

    public record Point(@JsonProperty(value = "x", required = true) @JsonSetter(nulls = Nulls.FAIL) double x,
                        @JsonProperty(value = "y", required = true) @JsonSetter(nulls = Nulls.FAIL) double y) {
        public Point { coordinate(x); coordinate(y); }
    }

    public record Size(@JsonProperty(value = "width", required = true) @JsonSetter(nulls = Nulls.FAIL) double width,
                       @JsonProperty(value = "height", required = true) @JsonSetter(nulls = Nulls.FAIL) double height) {
        public Size {
            if (!Double.isFinite(width) || !Double.isFinite(height)
                    || width < 160 || width > 640 || height < 60 || height > 480) {
                throw new IllegalArgumentException("invalid graph node size");
            }
        }
    }

    public record Viewport(double zoom, Point pan) {
        public Viewport {
            if (!Double.isFinite(zoom) || zoom < 0.4 || zoom > 2 || pan == null) {
                throw new IllegalArgumentException("invalid graph viewport");
            }
        }
    }

    public record View(Map<String, Point> positions, Map<String, Size> sizes, Viewport viewport,
                       List<String> expandedGroups) {
        public View {
            if (positions == null || sizes == null || expandedGroups == null
                    || positions.size() > 20_000 || sizes.size() > 20_000 || expandedGroups.size() > 20_000) {
                throw new IllegalArgumentException("invalid graph view");
            }
            positions.keySet().forEach(GraphWorkspace::text);
            sizes.keySet().forEach(GraphWorkspace::text);
            expandedGroups.forEach(GraphWorkspace::text);
            positions = Map.copyOf(positions);
            sizes = Map.copyOf(sizes);
            expandedGroups = List.copyOf(expandedGroups);
        }
    }

    private static void coordinate(double value) {
        if (!Double.isFinite(value) || Math.abs(value) > 10_000_000) {
            throw new IllegalArgumentException("invalid graph coordinate");
        }
    }

    private static void text(String value) {
        if (value == null || value.length() > 2048 || Set.of("__proto__", "constructor", "prototype").contains(value)
                || !Masking.maskSecrets(value).equals(value)) {
            throw new IllegalArgumentException("invalid graph key");
        }
    }
}
