package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Locale;
import java.util.regex.Pattern;

/** 상태코드와 구조화 응답에서 재사용하는 보수적 인가 증거 판독기. */
public final class ResponseEvidence {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern SOFT_DENY = Pattern.compile(
            "(?i)(forbidden|unauthorized|access[ _-]?denied|permission[ _-]?denied|not[ _-]?allowed|로그인.*필요|권한.*없)");
    private static final Pattern LOGIN_REDIRECT = Pattern.compile(
            "(?i)/(?:login|signin|auth|authorize|error|forbidden|unauthorized)(?:[/?#]|$)");

    private ResponseEvidence() {}

    public static boolean successful(RequestRecord record) {
        return record != null && record.hasResponse && record.status >= 200 && record.status < 300
                && !softDenied(record.responseBodyForAnalysis());
    }

    public static boolean denied(RequestRecord record) {
        if (record == null || !record.hasResponse) return false;
        if (record.status == 401 || record.status == 403
                || softDenied(record.responseBodyForAnalysis())) return true;
        return record.status >= 300 && record.status < 400 && record.location != null
                && LOGIN_REDIRECT.matcher(record.location).find();
    }

    public static boolean loginRedirect(RequestRecord record) {
        return record != null && record.hasResponse && record.status >= 300 && record.status < 400
                && record.location != null && LOGIN_REDIRECT.matcher(record.location).find();
    }

    public static boolean showsObject(String body, String resource, String owner) {
        if (body == null || body.isBlank() || body.equals("{}") || body.equals("[]")
                || resource == null || owner == null) return false;
        String id = resource.substring(resource.lastIndexOf(':') + 1);
        try {
            return jsonShowsObject(JSON.readTree(body), id);
        } catch (Exception ignored) {
            Pattern keyed = Pattern.compile("(?i)(?:^|[&;,{\\s])(?:[\\\"']?id[\\\"']?)"
                    + "\\s*[:=]\\s*[\\\"']?" + Pattern.quote(id)
                    + "(?=$|[\\\"'&,;}\\s])");
            Pattern xml = Pattern.compile("(?i)<id[^>]*>\\s*" + Pattern.quote(id) + "\\s*</id\\s*>");
            return keyed.matcher(body).find() || xml.matcher(body).find();
        }
    }

    private static boolean jsonShowsObject(JsonNode node, String resourceId) {
        if (node == null) return false;
        if (node.isObject()) {
            if (objectIdMatches(node, resourceId)) return true;
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                JsonNode value = field.getValue();
                if (value.isContainerNode() && jsonShowsObject(value, resourceId)) return true;
            }
        } else if (node.isArray()) {
            for (JsonNode value : node) if (jsonShowsObject(value, resourceId)) return true;
        }
        return false;
    }

    private static boolean objectIdMatches(JsonNode node, String resourceId) {
        var fields = node.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if ("id".equals(normalizedField(field.getKey())) && field.getValue().isValueNode()
                    && resourceId.equals(field.getValue().asText())) return true;
        }
        return false;
    }

    private static boolean softDenied(String body) {
        return body != null && SOFT_DENY.matcher(body).find();
    }

    private static String normalizedField(String field) {
        return field == null ? "" : field.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
    }
}
