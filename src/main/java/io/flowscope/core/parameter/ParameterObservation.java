package io.flowscope.core.parameter;

import io.flowscope.core.AccessRole;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import io.flowscope.core.Masking;

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

    public record ValueSummary(ValueType type, int byteLength, String digest, String maskedPreview) {
        public ValueSummary {
            if (type == null || byteLength < 0) {
                throw new IllegalArgumentException("parameter value summary requires type and non-negative byte length");
            }
            if (maskedPreview != null && maskedPreview.length() > 64) {
                throw new IllegalArgumentException("parameter preview exceeds 64 characters");
            }
            maskedPreview = Masking.maskSecrets(maskedPreview);
            if (maskedPreview != null && maskedPreview.length() > 64) maskedPreview = maskedPreview.substring(0, 64);
        }
    }

    public ParameterObservation {
        if (key == null || evidenceId == null || evidenceId.isBlank()) {
            throw new IllegalArgumentException("parameter observation requires key and evidence id");
        }
        if (Masking.isSensitiveParameterPath(key.canonicalPath())) {
            throw new IllegalArgumentException("sensitive parameter paths are not retained");
        }
        if (value != null && value.maskedPreview() != null && value.maskedPreview().length() > 64) {
            throw new IllegalArgumentException("parameter preview exceeds 64 characters");
        }
        source = source == null ? Source.UNKNOWN : source;
        role = role == null ? AccessRole.UNKNOWN : role;
        phase = phase == null ? RunPhase.UNKNOWN : phase;
        confidence = confidence == null ? Confidence.UNKNOWN : confidence;
    }
}
