package io.flowscope.core.parameter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** PATH identity is structural, never a declared name or an observed value. */
public final class PathSlotCanonicalizer {
    public record Slot(int segment, String declaredName, String canonicalPath) {}
    private PathSlotCanonicalizer() {}

    public static List<Slot> slots(String template) {
        String[] segments = Arrays.stream(template.split("/")).filter(s -> !s.isEmpty()).toArray(String[]::new);
        var positions = new ArrayList<Integer>();
        for (int i = 0; i < segments.length; i++) {
            if (segments[i].startsWith("{") && segments[i].endsWith("}") && segments[i].length() > 2) positions.add(i);
        }
        var result = new ArrayList<Slot>();
        for (int position : positions) result.add(new Slot(position,
                segments[position].substring(1, segments[position].length() - 1),
                "/segments/" + position));
        return List.copyOf(result);
    }
}
