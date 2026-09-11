package io.flowscope.core.parameter;

import java.nio.charset.StandardCharsets;

/** Canonical coordinates for one request input location. */
public record ParameterKey(String service, String method, String operation,
                           ParameterObservation.Location location, String canonicalPath) {
    public ParameterKey {
        if (service == null || service.isBlank() || method == null || method.isBlank()
                || operation == null || operation.isBlank() || location == null
                || canonicalPath == null || canonicalPath.isBlank()) {
            throw new IllegalArgumentException("parameter key requires canonical coordinates");
        }
    }

    public String stableKey() {
        return "pk:v1:" + frame(service) + frame(method) + frame(operation)
                + frame(location.name()) + frame(canonicalPath);
    }

    private static String frame(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length + ":" + value;
    }
}
