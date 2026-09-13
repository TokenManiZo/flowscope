package io.flowscope.core;

import com.fasterxml.jackson.core.exc.StreamConstraintsException;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** F-09: 응답에서 생성된 ID/토큰이 뒤 요청에 실제 사용될 때만 절차 Flow를 만든다. */
public final class DataFlowAnalyzer {
    private static final long MAX_GAP_MS = 30 * 60 * 1000L;
    private static final int MAX_TEXT_SCAN_CHARS = 64 * 1024;
    private static final int MAX_VALUES_PER_RESPONSE = 1_000;
    private static final int MAX_INDEXED_VALUES = 100_000;
    private static final Pattern VALUE_FIELD = Pattern.compile("(?i)(?:id|[A-Za-z][A-Za-z0-9_-]*(?:id|token))");
    private static final Pattern VALUE_TOKEN = Pattern.compile("[A-Za-z0-9._:-]{3,}");
    private static final Pattern VALUE = Pattern.compile(
            "(?i)(?:^|[\\s,{;&])[\\\"']?(?:id|[A-Za-z][A-Za-z0-9_-]{0,125}(?:id|token))"
                    + "[\\\"']?\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]{3,})");

    public record Link(RequestRecord producer, RequestRecord consumer, String value) {}
    private record ValueKey(String identity, String value) {}

    private DataFlowAnalyzer() {}

    public static List<Link> analyze(List<RequestRecord> records) {
        List<RequestRecord> ordered = new ArrayList<>(records);
        ordered.sort(Comparator.comparingLong(r -> r.timestamp == 0 ? Long.MAX_VALUE : r.timestamp));
        List<Link> links = new ArrayList<>();
        Set<String> dedup = new LinkedHashSet<>();
        Map<ValueKey, RequestRecord> latestProducer = new LinkedHashMap<>();
        for (RequestRecord consumer : ordered) {
            for (String value : consumedValues(consumer)) {
                RequestRecord producer = latestProducer.get(new ValueKey(consumer.idn, value));
                if (producer == null || tooFar(producer, consumer)) continue;
                String key = producer.evidenceId + "|" + consumer.evidenceId + "|" + value;
                if (dedup.add(key)) links.add(new Link(producer, consumer, value));
            }
            String producerBody = consumer.responseBodyForAnalysis();
            if (consumer.hasResponse && producerBody != null) {
                for (String value : producedValues(producerBody)) {
                    ValueKey valueKey = new ValueKey(consumer.idn, value);
                    latestProducer.remove(valueKey);
                    latestProducer.put(valueKey, consumer);
                    if (latestProducer.size() > MAX_INDEXED_VALUES) {
                        latestProducer.remove(latestProducer.keySet().iterator().next());
                    }
                }
            }
        }
        return links;
    }

    private static Set<String> producedValues(String body) {
        if (body == null || body.isBlank() || body.length() > ResponseEvidence.MAX_ANALYSIS_CHARS) return Set.of();
        Set<String> values = new LinkedHashSet<>();
        String leading = body.stripLeading();
        if (leading.startsWith("{") || leading.startsWith("[")) {
            try {
                collectJsonValues(ResponseEvidence.parseBoundedJson(body), values);
                return values;
            } catch (StreamConstraintsException rejected) {
                return Set.of();
            } catch (Exception ignored) {
                // 잘못된 구조화 응답만 bounded text fallback으로 보수적으로 처리한다.
            }
        }
        String bounded = body.substring(0, Math.min(body.length(), MAX_TEXT_SCAN_CHARS));
        Matcher matcher = VALUE.matcher(bounded);
        while (matcher.find() && values.size() < MAX_VALUES_PER_RESPONSE) {
            addValue(values, matcher.group(1));
        }
        return values;
    }

    private static void collectJsonValues(JsonNode root, Set<String> values) {
        if (root == null) return;
        ArrayDeque<JsonNode> pending = new ArrayDeque<>();
        pending.add(root);
        int visited = 0;
        while (!pending.isEmpty() && visited++ < ResponseEvidence.MAX_VISITED_NODES
                && values.size() < MAX_VALUES_PER_RESPONSE) {
            JsonNode node = pending.removeFirst();
            if (node.isObject()) {
                var fields = node.fields();
                while (fields.hasNext()) {
                    var field = fields.next();
                    JsonNode value = field.getValue();
                    if (VALUE_FIELD.matcher(field.getKey()).matches() && value.isValueNode() && !value.isNull()) {
                        addValue(values, value.asText());
                    }
                    if (value.isContainerNode()) pending.addLast(value);
                }
            } else if (node.isArray()) {
                node.elements().forEachRemaining(pending::addLast);
            }
        }
    }

    private static void addValue(Set<String> values, String value) {
        if (value != null && VALUE_TOKEN.matcher(value).matches() && !value.contains("***")
                && !Set.of("true", "false", "null").contains(value.toLowerCase())) {
            values.add(value);
        }
    }

    private static Set<String> consumedValues(RequestRecord record) {
        Set<String> values = new LinkedHashSet<>();
        collectTokens(record.path, values);
        collectTokens(record.query, values);
        collectTokens(record.requestBodyForAnalysis(), values);
        return values;
    }

    private static void collectTokens(String text, Set<String> values) {
        if (text == null || text.isBlank() || values.size() >= MAX_VALUES_PER_RESPONSE) return;
        String bounded = text.substring(0, Math.min(text.length(), MAX_TEXT_SCAN_CHARS));
        Matcher matcher = VALUE_TOKEN.matcher(bounded);
        while (matcher.find() && values.size() < MAX_VALUES_PER_RESPONSE) {
            addValue(values, matcher.group());
        }
    }

    private static boolean tooFar(RequestRecord a, RequestRecord b) {
        return a.timestamp > 0 && b.timestamp > 0 && b.timestamp - a.timestamp > MAX_GAP_MS;
    }
}
