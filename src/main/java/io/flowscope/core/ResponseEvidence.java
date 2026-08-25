package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** 상태코드와 구조화 응답에서 재사용하는 보수적 인가 증거 판독기. */
public final class ResponseEvidence {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> OWNER_FIELDS = Set.of(
            "owner", "ownerid", "userid", "authorid", "accountid");
    private static final Pattern SOFT_DENY = Pattern.compile(
            "(?i)(forbidden|unauthorized|access[ _-]?denied|permission[ _-]?denied|not[ _-]?allowed|로그인.*필요|권한.*없)");
    private static final Pattern LOGIN_REDIRECT = Pattern.compile(
            "(?i)(/login|/signin|/auth|/error|/forbidden|/unauthorized)");

    private ResponseEvidence() {}

    public static boolean successful(RequestRecord record) {
        return record != null && record.hasResponse && record.status >= 200 && record.status < 300
                && !softDenied(record.body);
    }

    public static boolean denied(RequestRecord record) {
        if (record == null || !record.hasResponse) return false;
        if (record.status == 401 || record.status == 403 || softDenied(record.body)) return true;
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
            return jsonShowsObject(JSON.readTree(body), id, owner);
        } catch (Exception ignored) {
            String names = "id|owner|owner[_-]?id|user[_-]?id|account[_-]?id";
            String expected = Pattern.quote(id) + "|" + Pattern.quote(owner);
            Pattern keyed = Pattern.compile("(?i)(?:^|[&;,{\\s])(?:[\\\"']?(?:" + names
                    + ")[\\\"']?)\\s*[:=]\\s*[\\\"']?(?:" + expected
                    + ")(?=$|[\\\"'&,;}\\s])");
            Pattern xml = Pattern.compile("(?i)<(?:" + names + ")[^>]*>\\s*(?:" + expected
                    + ")\\s*</(?:" + names + ")\\s*>");
            return keyed.matcher(body).find() || xml.matcher(body).find();
        }
    }

    private static boolean jsonShowsObject(JsonNode node, String resourceId, String owner) {
        if (node == null) return false;
        if (node.isObject()) {
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                JsonNode value = field.getValue();
                String name = normalizedField(field.getKey());
                if (value.isValueNode()) {
                    String scalar = value.asText();
                    if (("id".equals(name) && resourceId.equals(scalar))
                            || (OWNER_FIELDS.contains(name) && owner.equalsIgnoreCase(scalar))) return true;
                }
                if (value.isContainerNode() && jsonShowsObject(value, resourceId, owner)) return true;
            }
        } else if (node.isArray()) {
            for (JsonNode value : node) if (jsonShowsObject(value, resourceId, owner)) return true;
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
