package io.flowscope.core;

import java.util.Locale;
import java.util.Set;

/** 원 Evidence ID에 연결된 그래프 표시용 관측 관계. */
public record GraphObservationFact(
        String evidenceId,
        String identity,
        String service,
        String operation,
        String method,
        String apiGroup,
        String apiGroupBasis,
        String object,
        String objectFamily,
        Source source,
        String runId,
        RunPhase phase,
        int status,
        boolean hasResponse,
        HttpOutcome outcome) {

    private static final Set<String> STRUCTURAL_SEGMENTS = Set.of("api", "rest", "graphql");

    public enum HttpOutcome {
        REQUEST_ONLY, HTTP_2XX, HTTP_3XX, HTTP_4XX, HTTP_5XX, HTTP_OTHER
    }

    public static GraphObservationFact from(RequestRecord record) {
        if (record == null || record.evidenceId == null || record.evidenceId.isBlank()
                || record.op == null || record.op.isBlank()) {
            throw new IllegalArgumentException("graph fact requires normalized Evidence");
        }
        return new GraphObservationFact(record.evidenceId, record.idn, record.service, record.op,
                record.method, apiGroup(record), "PATH_SEGMENT", record.resource,
                objectFamily(record.resource), record.source, record.runId, record.phase,
                record.status, record.hasResponse, outcome(record));
    }

    private static String apiGroup(RequestRecord record) {
        String path = operationPath(record);
        for (String segment : path.split("/")) {
            String value = segment.trim();
            if (value.isEmpty()) continue;
            String lower = value.toLowerCase(Locale.ROOT);
            if (STRUCTURAL_SEGMENTS.contains(lower) || lower.matches("v\\d+(?:\\.\\d+)?")) continue;
            if (value.startsWith("{") && value.endsWith("}")) continue;
            return value.toUpperCase(Locale.ROOT) + " APIs";
        }
        return "ROOT APIs";
    }

    private static String operationPath(RequestRecord record) {
        String prefix = record.service + " " + record.method + " ";
        String value = record.op.startsWith(prefix) ? record.op.substring(prefix.length()) : record.op;
        if (value.startsWith(record.method + " ")) value = value.substring(record.method.length() + 1);
        int graphqlOperation = value.indexOf('#');
        return graphqlOperation < 0 ? value : value.substring(0, graphqlOperation);
    }

    private static String objectFamily(String resource) {
        if (resource == null || resource.isBlank()) return null;
        int colon = resource.indexOf(':');
        int slash = resource.indexOf('/');
        int end = colon < 0 ? slash : slash < 0 ? colon : Math.min(colon, slash);
        return end < 0 ? resource : resource.substring(0, end);
    }

    private static HttpOutcome outcome(RequestRecord record) {
        if (!record.hasResponse) return HttpOutcome.REQUEST_ONLY;
        if (record.status >= 200 && record.status < 300) return HttpOutcome.HTTP_2XX;
        if (record.status >= 300 && record.status < 400) return HttpOutcome.HTTP_3XX;
        if (record.status >= 400 && record.status < 500) return HttpOutcome.HTTP_4XX;
        if (record.status >= 500 && record.status < 600) return HttpOutcome.HTTP_5XX;
        return HttpOutcome.HTTP_OTHER;
    }
}
