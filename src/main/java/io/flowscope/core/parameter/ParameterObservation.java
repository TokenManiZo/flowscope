package io.flowscope.core.parameter;

import io.flowscope.core.AccessRole;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;

/** Bounded, non-raw evidence that a request input location was observed. */
public record ParameterObservation(
        ParameterKey key, String evidenceId, String runId, Source source, String identity,
        AccessRole role, RunPhase phase, Presence presence, Shape shape,
        ValueSummary value, String contextSignature, Confidence confidence) {
    public enum Location { PATH, QUERY, FORM, JSON_BODY, GRAPHQL_VARIABLE, MULTIPART_FIELD, XML_PATH }
    public enum Presence { PRESENT, EXPLICIT_NULL }
    public enum Shape { SCALAR, ARRAY, OBJECT, NULL, UNKNOWN }
    public enum ValueType { STRING, INTEGER, NUMBER, BOOLEAN, UUID, DATE_TIME, BINARY, UNKNOWN }
    public enum Confidence { OBSERVED, CORROBORATED, INFERRED, UNKNOWN }

    /** 값 문자열의 형식 신호. 실제 타입({@link ValueType})을 덮어쓰지 않는 별도 메타데이터다. */
    public enum Format { NONE, UUID, INTEGER_LIKE, DECIMAL_LIKE, BOOLEAN_LIKE }

    public record ValueSummary(ValueType type, int byteLength, String digest, String preview, Format format) {
        public ValueSummary(ValueType type, int byteLength, String digest, String preview) {
            this(type, byteLength, digest, preview, Format.NONE);
        }
        public ValueSummary {
            format = format == null ? Format.NONE : format;
            if (type == null || byteLength < 0) {
                throw new IllegalArgumentException("parameter value summary requires type and non-negative byte length");
            }
            if (preview != null && preview.length() > 64) {
                throw new IllegalArgumentException("parameter preview exceeds 64 characters");
            }
            if (preview != null && preview.length() > 64) preview = preview.substring(0, 64);
        }
    }

    public ParameterObservation {
        if (key == null || evidenceId == null || evidenceId.isBlank()) {
            throw new IllegalArgumentException("parameter observation requires key and evidence id");
        }
        if (value != null && value.preview() != null && value.preview().length() > 64) {
            throw new IllegalArgumentException("parameter preview exceeds 64 characters");
        }
        source = source == null ? Source.UNKNOWN : source;
        role = role == null ? AccessRole.UNKNOWN : role;
        phase = phase == null ? RunPhase.UNKNOWN : phase;
        confidence = confidence == null ? Confidence.UNKNOWN : confidence;
    }
}
