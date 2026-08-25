package io.flowscope.core;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** F-09: 응답에서 생성된 ID/토큰이 뒤 요청에 실제 사용될 때만 절차 Flow를 만든다. */
public final class DataFlowAnalyzer {
    private static final long MAX_GAP_MS = 30 * 60 * 1000L;
    private static final Pattern VALUE = Pattern.compile(
            "(?i)[\\\"']?(?:id|[A-Za-z][A-Za-z0-9_-]*(?:id|token))[\\\"']?\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]{3,})");

    public record Link(RequestRecord producer, RequestRecord consumer, String value) {}

    private DataFlowAnalyzer() {}

    public static List<Link> analyze(List<RequestRecord> records) {
        List<RequestRecord> ordered = new ArrayList<>(records);
        ordered.sort(Comparator.comparingLong(r -> r.timestamp == 0 ? Long.MAX_VALUE : r.timestamp));
        List<Link> links = new ArrayList<>();
        Set<String> dedup = new LinkedHashSet<>();
        for (int i = 0; i < ordered.size(); i++) {
            RequestRecord producer = ordered.get(i);
            if (!producer.hasResponse || producer.body == null) continue;
            for (String value : producedValues(producer.body)) {
                for (int j = i + 1; j < ordered.size(); j++) {
                    RequestRecord consumer = ordered.get(j);
                    if (!producer.idn.equals(consumer.idn)) continue;
                    if (tooFar(producer, consumer)) continue;
                    if (!consumes(consumer, value)) continue;
                    String key = producer.evidenceId + "|" + consumer.evidenceId + "|" + value;
                    if (dedup.add(key)) links.add(new Link(producer, consumer, value));
                }
            }
        }
        return links;
    }

    private static Set<String> producedValues(String body) {
        Set<String> values = new LinkedHashSet<>();
        Matcher matcher = VALUE.matcher(body);
        while (matcher.find()) {
            String value = matcher.group(1);
            if (!value.contains("***") && !Set.of("true", "false", "null").contains(value.toLowerCase())) values.add(value);
        }
        return values;
    }

    private static boolean consumes(RequestRecord record, String value) {
        return contains(record.path, value) || contains(record.query, value)
                || contains(record.reqBody, value) || contains(record.reqText, value);
    }

    private static boolean contains(String text, String value) {
        return text != null && text.contains(value);
    }

    private static boolean tooFar(RequestRecord a, RequestRecord b) {
        return a.timestamp > 0 && b.timestamp > 0 && b.timestamp - a.timestamp > MAX_GAP_MS;
    }
}
