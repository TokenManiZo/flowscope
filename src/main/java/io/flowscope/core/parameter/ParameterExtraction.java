package io.flowscope.core.parameter;

import java.util.List;

/** Immutable, raw-free extraction output. */
public record ParameterExtraction(List<ParameterObservation> observations, List<ParameterDiagnostic> diagnostics) {
    public ParameterExtraction {
        observations = List.copyOf(observations);
        diagnostics = List.copyOf(diagnostics);
    }
}
