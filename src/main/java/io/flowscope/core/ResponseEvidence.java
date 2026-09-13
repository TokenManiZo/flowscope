package io.flowscope.core;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.exc.StreamConstraintsException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** 상태코드와 구조화 응답에서 재사용하는 보수적 인가 증거 판독기. */
public final class ResponseEvidence {
    static final int MAX_ANALYSIS_CHARS = 1_000_000;
    private static final int MAX_JSON_DEPTH = 128;
    static final int MAX_VISITED_NODES = 100_000;
    private static final int MAX_TEXT_DENY_CHARS = 2_048;
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxDocumentLength(MAX_ANALYSIS_CHARS)
                    .maxNestingDepth(MAX_JSON_DEPTH)
                    .maxStringLength(MAX_ANALYSIS_CHARS)
                    .maxTokenCount(MAX_VISITED_NODES)
                    .build())
            .build());
    private static final Pattern SOFT_DENY = Pattern.compile(
            "(?i)(forbidden|unauthorized|access[ _-]?denied|permission[ _-]?denied|not[ _-]?allowed|로그인.*필요|권한.*없)");
    private static final Pattern LOGIN_REDIRECT = Pattern.compile(
            "(?i)/(?:login|signin|auth|authorize|error|forbidden|unauthorized)(?:[/?#]|$)");
    private static final Set<String> ERROR_ENVELOPE_FIELDS = Set.of(
            "error", "errors", "message", "errormessage", "detail", "title", "reason");

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
                || body.length() > MAX_ANALYSIS_CHARS || resource == null || owner == null) return false;
        ResourceTarget target = resourceTarget(resource);
        if (target == null) return false;
        try {
            return jsonShowsObject(parseBoundedJson(body), target);
        } catch (StreamConstraintsException rejected) {
            return false;
        } catch (Exception ignored) {
            String keys = target.keys().stream().map(Pattern::quote)
                    .reduce((left, right) -> left + "|" + right).orElse("id");
            Pattern keyed = Pattern.compile("(?i)(?:^|[&;,{\\s])(?:[\\\"']?(?:" + keys + ")[\\\"']?)"
                    + "\\s*[:=]\\s*[\\\"']?" + Pattern.quote(target.id())
                    + "(?=$|[\\\"'&,;}\\s])");
            Pattern xml = Pattern.compile("(?i)<(?:" + keys + ")[^>]*>\\s*"
                    + Pattern.quote(target.id()) + "\\s*</(?:" + keys + ")\\s*>");
            return keyed.matcher(body).find() || xml.matcher(body).find();
        }
    }

    private static boolean jsonShowsObject(JsonNode root, ResourceTarget target) {
        if (root == null) return false;
        ArrayDeque<JsonNode> pending = new ArrayDeque<>();
        pending.add(root);
        int visited = 0;
        while (!pending.isEmpty() && visited++ < MAX_VISITED_NODES) {
            JsonNode node = pending.removeFirst();
            if (node.isObject()) {
                if (objectIdMatches(node, target)) return true;
                node.elements().forEachRemaining(value -> {
                    if (value.isContainerNode()) pending.addLast(value);
                });
            } else if (node.isArray()) {
                node.elements().forEachRemaining(value -> {
                    if (value.isContainerNode()) pending.addLast(value);
                });
            }
        }
        return false;
    }

    private static boolean objectIdMatches(JsonNode node, ResourceTarget target) {
        var fields = node.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if (target.keys().contains(normalizedField(field.getKey())) && field.getValue().isValueNode()
                    && !field.getValue().isNull() && target.id().equals(field.getValue().asText())) return true;
        }
        return false;
    }

    private static boolean softDenied(String body) {
        if (body == null || body.isBlank()) return false;
        String leading = body.stripLeading();
        boolean structured = leading.startsWith("{") || leading.startsWith("[");
        if (structured) {
            if (body.length() > MAX_ANALYSIS_CHARS) return false;
            try {
                JsonNode root = parseBoundedJson(body);
                if (root != null && root.isObject()) return jsonSoftDenied(root);
                if (root != null) return false;
            } catch (Exception ignored) {
                return false;
            }
        }
        String prefix = body.substring(0, Math.min(body.length(), MAX_TEXT_DENY_CHARS));
        return SOFT_DENY.matcher(prefix).find();
    }

    private static boolean jsonSoftDenied(JsonNode root) {
        var fields = root.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            String key = normalizedField(field.getKey());
            if (!ERROR_ENVELOPE_FIELDS.contains(key)) continue;
            JsonNode value = field.getValue();
            if (value.isValueNode() && !value.isNull() && SOFT_DENY.matcher(value.asText()).find()) return true;
            if ((key.equals("error") || key.equals("errors")) && containerHasDenyText(value)) return true;
        }
        return false;
    }

    private static boolean containerHasDenyText(JsonNode root) {
        ArrayDeque<JsonNode> pending = new ArrayDeque<>();
        pending.add(root);
        int visited = 0;
        while (!pending.isEmpty() && visited++ < 1_000) {
            JsonNode value = pending.removeFirst();
            if (value.isValueNode() && !value.isNull() && SOFT_DENY.matcher(value.asText()).find()) return true;
            if (value.isContainerNode()) value.elements().forEachRemaining(pending::addLast);
        }
        return false;
    }

    private static ResourceTarget resourceTarget(String resource) {
        String references = resource;
        int serviceBoundary = references.indexOf(' ');
        if (serviceBoundary >= 0) references = references.substring(serviceBoundary + 1);
        int slash = references.lastIndexOf('/');
        String leaf = slash >= 0 ? references.substring(slash + 1) : references;
        int colon = leaf.lastIndexOf(':');
        if (colon <= 0 || colon == leaf.length() - 1) return null;
        String type = singular(normalizedField(leaf.substring(0, colon)));
        String id = leaf.substring(colon + 1);
        if (type.isBlank() || id.isBlank()) return null;
        Set<String> keys = new LinkedHashSet<>();
        keys.add("id");
        keys.add("uuid");
        keys.add("guid");
        keys.add("pk");
        for (String suffix : Set.of("id", "uuid", "guid", "pk", "number", "no", "seq", "key", "ref", "vin")) {
            keys.add(type + suffix);
        }
        return new ResourceTarget(id, Set.copyOf(keys));
    }

    private static String singular(String value) {
        if (value.endsWith("ies") && value.length() > 3) return value.substring(0, value.length() - 3) + "y";
        if (value.endsWith("s") && value.length() > 1) return value.substring(0, value.length() - 1);
        return value;
    }

    private static String normalizedField(String field) {
        return field == null ? "" : field.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
    }

    /** 응답 판정기가 공유하는 크기·중첩·토큰 상한을 적용한다. */
    static JsonNode parseBoundedJson(String body) throws IOException {
        if (body == null || body.length() > MAX_ANALYSIS_CHARS) return null;
        return JSON.readTree(body);
    }

    private record ResourceTarget(String id, Set<String> keys) {}
}
