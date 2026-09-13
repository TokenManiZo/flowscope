package io.flowscope.core.parameter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Bounded parser diagnostic that never carries request values. */
public record ParameterDiagnostic(String operation, String reasonCode, int droppedCount) {
    static List<ParameterDiagnostic> aggregate(List<ParameterDiagnostic> diagnostics) {
        var counts = new TreeMap<String, Map<String, Integer>>();
        diagnostics.forEach(d -> counts.computeIfAbsent(d.operation(), ignored -> new TreeMap<>())
                .merge(d.reasonCode(), d.droppedCount(), Integer::sum));
        var combined = new ArrayList<ParameterDiagnostic>();
        counts.forEach((op, reasons) -> reasons.forEach((reason, count) -> combined.add(new ParameterDiagnostic(op, reason, count))));
        return List.copyOf(combined);
    }

    public ParameterDiagnostic {
        if (operation == null || operation.isBlank() || reasonCode == null || reasonCode.isBlank()
                || droppedCount < 0) {
            throw new IllegalArgumentException("parameter diagnostic requires operation, reason code, and non-negative count");
        }
    }
}
