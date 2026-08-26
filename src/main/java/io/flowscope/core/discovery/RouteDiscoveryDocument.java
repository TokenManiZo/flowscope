package io.flowscope.core.discovery;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;

import java.util.Locale;

/** 한 Evidence 응답을 format adapter에 전달하는 불변 입력. */
public record RouteDiscoveryDocument(String service, String path, String mediaType, String body,
                                     String location, String evidenceId, Source source, String runId) {
    public RouteDiscoveryDocument {
        if (service == null || service.isBlank() || path == null || path.isBlank()
                || evidenceId == null || evidenceId.isBlank()) {
            throw new IllegalArgumentException("discovery document requires service, path, and evidence");
        }
        mediaType = normalizeMediaType(mediaType);
        body = body == null ? "" : body;
        source = source == null ? Source.UNKNOWN : source;
        runId = runId == null || runId.isBlank() ? "unknown-run" : runId;
    }

    public static RouteDiscoveryDocument from(RequestRecord record) {
        return new RouteDiscoveryDocument(record.service, record.path, record.responseContentType,
                record.body, record.location, record.evidenceId, record.source, record.runId);
    }

    public String baseUrl() { return service + path; }

    private static String normalizeMediaType(String value) {
        if (value == null) return "";
        String lower = value.toLowerCase(Locale.ROOT).trim();
        int semicolon = lower.indexOf(';');
        return semicolon < 0 ? lower : lower.substring(0, semicolon).trim();
    }
}
