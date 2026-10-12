package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.StoredPayload;

import java.util.List;
import java.util.Locale;
import java.util.function.BiFunction;

/** Read-only, run-bound view of the current project's stored HTTP Evidence. */
public final class ProjectEvidenceReader {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_PAGE = 100;
    private static final int MAX_READ_CHARS = 65_536;
    private final BiFunction<String, String, List<RequestRecord>> recordsForRun;

    public ProjectEvidenceReader(BiFunction<String, String, List<RequestRecord>> recordsForRun) {
        this.recordsForRun = java.util.Objects.requireNonNull(recordsForRun);
    }

    public JsonNode execute(String runId, String workspace, String tool, JsonNode arguments) {
        if (arguments == null || !arguments.isObject()) {
            throw new IllegalArgumentException("Evidence 도구 인자는 JSON 객체여야 합니다.");
        }
        List<RequestRecord> records = List.copyOf(recordsForRun.apply(runId, workspace));
        return switch (tool) {
            case "flowscope_evidence_list" -> page(records, "", arguments);
            case "flowscope_evidence_search" -> page(records, required(arguments, "query"), arguments);
            case "flowscope_evidence_read" -> read(records, arguments);
            default -> throw new IllegalArgumentException("지원하지 않는 Evidence 조회 도구입니다.");
        };
    }

    private static ObjectNode page(List<RequestRecord> records, String query, JsonNode arguments) {
        if (query.length() > 256) throw new IllegalArgumentException("검색어는 256자 이하여야 합니다.");
        int offset = bounded(arguments, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = bounded(arguments, "limit", 50, 1, MAX_PAGE);
        String needle = query.toLowerCase(Locale.ROOT);
        ObjectNode result = JSON.createObjectNode();
        ArrayNode items = result.putArray("items");
        int total = 0;
        for (int index = records.size() - 1; index >= 0; index--) {
            RequestRecord record = records.get(index);
            if (record.evidenceId == null || record.evidenceId.isBlank() || !matches(record, needle)) continue;
            if (total >= offset && items.size() < limit) items.add(summary(record));
            total++;
        }
        result.put("total", total).put("offset", offset).put("limit", limit);
        if ((long) offset + items.size() < total) result.put("next_offset", offset + items.size());
        else result.putNull("next_offset");
        return result;
    }

    private static boolean matches(RequestRecord record, String needle) {
        if (needle.isBlank()) return true;
        return (record.evidenceId + " " + record.source + " " + record.method + " "
                + url(record) + " " + record.status + " " + record.selectedIdentity() + " "
                + record.runId + " " + record.op + " " + record.resource)
                .toLowerCase(Locale.ROOT).contains(needle);
    }

    private static ObjectNode summary(RequestRecord record) {
        ObjectNode item = JSON.createObjectNode();
        item.put("evidence_id", record.evidenceId);
        item.put("source", record.source.name());
        item.put("method", record.method);
        item.put("url", url(record));
        item.put("status", record.status);
        item.put("identity", record.selectedIdentity());
        item.put("run_id", record.runId);
        item.put("observed_at", record.timestamp);
        item.put("has_response", record.hasResponse);
        item.put("request_retained", retained(record.requestPayload));
        item.put("response_retained", retained(record.responsePayload));
        item.put("traffic_class", record.trafficClassification.trafficClass().name());
        item.put("disposition", record.trafficClassification.disposition().name());
        return item;
    }

    private static ObjectNode read(List<RequestRecord> records, JsonNode arguments) {
        String id = required(arguments, "evidence_id");
        String part = required(arguments, "part").toLowerCase(Locale.ROOT);
        if (!part.equals("request") && !part.equals("response")) {
            throw new IllegalArgumentException("part는 request 또는 response여야 합니다.");
        }
        int offset = bounded(arguments, "char_offset", 0, 0, Integer.MAX_VALUE);
        int maxChars = bounded(arguments, "max_chars", 16_384, 1, MAX_READ_CHARS);
        RequestRecord record = records.stream().filter(value -> id.equals(value.evidenceId))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("현재 프로젝트에서 Evidence ID를 찾을 수 없습니다."));
        StoredPayload payload = part.equals("request") ? record.requestPayload : record.responsePayload;
        String fullOrPreview = part.equals("request") ? record.requestTextForEvidence() : record.responseTextForEvidence();
        String text = fullOrPreview == null ? "" : fullOrPreview;
        int from = Math.min(offset, text.length());
        int to = (int) Math.min((long) text.length(), (long) from + maxChars);
        ObjectNode result = JSON.createObjectNode();
        result.put("evidence_id", id).put("part", part).put("text", text.substring(from, to));
        result.put("char_offset", from).put("next_char_offset", to).put("total_chars", text.length());
        result.put("end_of_text", to == text.length());
        result.put("complete", retained(payload));
        if (!retained(payload)) result.put("note", "저장된 원문이 없거나 일부만 보존된 기록입니다. 표시된 텍스트를 전체 원문으로 간주하지 마세요.");
        return result;
    }

    private static String url(RequestRecord record) {
        return record.service + record.path + (record.query == null || record.query.isBlank() ? "" : "?" + record.query);
    }

    private static boolean retained(StoredPayload payload) {
        return payload != null && payload.retained();
    }

    private static String required(JsonNode arguments, String name) {
        String value = arguments.path(name).asText("").trim();
        if (value.isEmpty()) throw new IllegalArgumentException(name + " 값이 필요합니다.");
        return value;
    }

    private static int bounded(JsonNode arguments, String name, int defaultValue, int minimum, int maximum) {
        if (!arguments.has(name)) return defaultValue;
        JsonNode value = arguments.get(name);
        if (!value.isIntegralNumber() || !value.canConvertToInt()) {
            throw new IllegalArgumentException(name + " 값의 범위가 올바르지 않습니다.");
        }
        int number = value.asInt();
        if (number < minimum || number > maximum) {
            throw new IllegalArgumentException(name + " 값의 범위가 올바르지 않습니다.");
        }
        return number;
    }
}
