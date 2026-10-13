package io.flowscope.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Project-scoped suppression of a matrix API group or one operation/object pair. */
public record MatrixExclusion(String key, String view, String operation, String resource, String label) {
    private static final ObjectMapper JSON = new ObjectMapper();

    public MatrixExclusion {
        if (!("function".equals(view) || "object".equals(view)) || operation == null || operation.isBlank()
                || operation.length() > 16_384 || resource != null && resource.length() > 16_384
                || label == null || label.length() > 16_384 || key == null || key.length() > 33_000
                || !key.equals(keyFor(view, operation, resource))) {
            throw new IllegalArgumentException("잘못된 매트릭스 제외 항목입니다.");
        }
    }

    public static String keyFor(String view, String operation, String resource) {
        try { return JSON.writeValueAsString(new String[] { view, operation, resource }); }
        catch (JsonProcessingException error) { throw new IllegalArgumentException(error); }
    }
}
