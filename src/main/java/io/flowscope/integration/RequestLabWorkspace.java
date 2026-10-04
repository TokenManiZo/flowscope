package io.flowscope.integration;

import io.flowscope.core.Masking;
import java.util.LinkedHashMap;
import java.util.Map;

/** Durable, masked editing state. Live credentials never belong to this model. */
public record RequestLabWorkspace(long revision, Map<String, Tab> tabs) {
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();
    private static final long MAX_TEXT_BYTES = 40L * 1024 * 1024;
    public RequestLabWorkspace {
        if (revision < 0) throw new IllegalArgumentException("invalid Request Lab revision");
        tabs = Map.copyOf(tabs == null ? Map.of() : tabs);
        if (tabs.size() > 20_000) throw new IllegalArgumentException("Request Lab limit exceeded");
        long bytes = 0;
        for (var tab : tabs.entrySet()) {
            if (tab.getKey().isBlank() || tab.getKey().length() > 256
                    || !tab.getKey().equals(Masking.maskSecrets(tab.getKey()))) {
                throw new IllegalArgumentException("invalid Request Lab Evidence ID");
            }
            for (Entry entry : tab.getValue().entries().values()) {
                bytes += 2L * (entry.name().length() + entry.request().length()
                        + (entry.result() == null ? 0 : entry.result().response().length()));
            }
        }
        if (bytes > MAX_TEXT_BYTES) throw new IllegalArgumentException("Request Lab 저장 한도(40MiB)를 초과했습니다. 사용하지 않는 요청을 삭제해 주세요.");
    }
    public static RequestLabWorkspace empty() { return new RequestLabWorkspace(0, Map.of()); }
    public Tab tab(String evidenceId) { return tabs.getOrDefault(evidenceId, Tab.empty()); }
    public record State(long datasetRevision, long revision, boolean persisted, Tab tab) {}
    public record Tab(int nextId, int selectedId, Map<Integer, Entry> entries) {
        public Tab {
            entries = Map.copyOf(entries == null ? Map.of() : entries);
            if (nextId < 1 || entries.size() > 32 || selectedId < 0
                    || selectedId != 0 && !entries.containsKey(selectedId)
                    || entries.keySet().stream().anyMatch(id -> id < 1 || id >= nextId)) {
                throw new IllegalArgumentException("invalid Request Lab requests");
            }
        }
        public static Tab empty() { return new Tab(1, 0, Map.of()); }
    }
    public record Result(String response, int status, long durationMs, long requestBytes, long responseBytes) {
        public Result {
            response = safeHttp(response, 10 * 1024 * 1024);
            if (status < 0 || status > 999 || durationMs < 0 || requestBytes < 0 || responseBytes < 0) {
                throw new IllegalArgumentException("invalid Request Lab response");
            }
        }
    }
    public record Entry(String name, String request, String credentialMode, Result result, boolean dirty) {
        public Entry {
            if (name == null || name.isBlank() || name.length() > 80) throw new IllegalArgumentException("invalid Request Lab name");
            name = Masking.maskSecrets(name.trim());
            if (name.length() > 80 || !name.equals(Masking.maskSecrets(name))) throw new IllegalArgumentException("invalid masked Request Lab name");
            request = safeHttp(request, 1_048_576);
            if (credentialMode == null || !java.util.Set.of("ORIGINAL", "ANONYMOUS", "ACCOUNT").contains(credentialMode)) {
                throw new IllegalArgumentException("invalid Request Lab credentials");
            }
        }
    }
    /** Null fields preserve values; clearResult explicitly removes the previous response. */
    public record Change(String action, int id, String name, String request, String credentialMode,
                         Result result, boolean clearResult, Boolean dirty, Integer selectedId) {
        public RequestLabWorkspace apply(RequestLabWorkspace workspace, String evidenceId) {
            Tab old = workspace.tab(evidenceId);
            var entries = new LinkedHashMap<>(old.entries());
            int next = old.nextId(), selected = selectedId == null ? old.selectedId() : selectedId;
            switch (action == null ? "" : action) {
                case "create" -> {
                    // Sequence survives deletion: a late update/create cannot resurrect an old item.
                    if (id != next || next == Integer.MAX_VALUE) throw new IllegalStateException("요청 목록이 변경되었습니다. 다시 열어 주세요.");
                    entries.put(id, new Entry(name, request, credentialMode, result, Boolean.TRUE.equals(dirty)));
                    next++;
                }
                case "update" -> {
                    Entry entry = entries.get(id);
                    if (entry == null) throw new IllegalStateException("요청이 삭제되었거나 변경되었습니다. 다시 열어 주세요.");
                    entries.put(id, new Entry(name == null ? entry.name() : name, request == null ? entry.request() : request,
                            credentialMode == null ? entry.credentialMode() : credentialMode,
                            clearResult ? null : result == null ? entry.result() : result,
                            dirty == null ? entry.dirty() : dirty));
                }
                case "delete" -> {
                    if (entries.remove(id) == null) throw new IllegalStateException("요청 목록이 변경되었습니다. 다시 열어 주세요.");
                    if (selected == id) selected = 0;
                }
                case "select" -> {}
                default -> throw new IllegalArgumentException("invalid Request Lab change");
            }
            var tabs = new LinkedHashMap<>(workspace.tabs());
            tabs.put(evidenceId, new Tab(next, selected, entries));
            return new RequestLabWorkspace(Math.addExact(workspace.revision(), 1), tabs);
        }
    }
    private static String safeHttp(String value, int limit) {
        if (value == null || value.length() > limit) throw new IllegalArgumentException("Request Lab text limit exceeded");
        String masked = maskHttp(value);
        if (masked.length() > limit) throw new IllegalArgumentException("Request Lab masked text limit exceeded");
        if (!masked.equals(maskHttp(masked))) throw new IllegalArgumentException("Request Lab 마스킹을 완료하지 못했습니다.");
        return masked;
    }

    private static String maskHttp(String value) {
        int separator = value.indexOf("\r\n\r\n");
        if (separator < 0) separator = value.indexOf("\n\n");
        int separatorLength = separator < 0 ? 0 : value.startsWith("\r\n\r\n", separator) ? 4 : 2;
        String headers = Masking.maskHeaders(separator < 0 ? value : value.substring(0, separator));
        var pattern = java.util.regex.Pattern.compile("(?m)^([^:\r\n \t]+):[ \t]*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]+)*)");
        headers = pattern.matcher(headers).replaceAll(match -> {
            String name = match.group(1);
            return java.util.regex.Matcher.quoteReplacement(Masking.isSensitiveParameterPath(name)
                    || SessionBroker.managedHeaderNames().stream().anyMatch(name::equalsIgnoreCase)
                    || name.equalsIgnoreCase("Set-Cookie")
                    ? name + ": ***MASKED***" : match.group());
        });
        headers = java.util.regex.Pattern.compile("([?&])([^=&\\s]+)=([^&\\s]*)").matcher(headers).replaceAll(match ->
                java.util.regex.Matcher.quoteReplacement(Masking.isSensitiveParameterPath(match.group(2))
                        ? match.group(1) + match.group(2) + "=***MASKED***" : match.group()));
        if (separator < 0) return headers;
        String body = value.substring(separator + separatorLength);
        var type = java.util.regex.Pattern.compile("(?im)^Content-Type:[ \t]*([^\r\n]+)").matcher(headers);
        String contentType = type.find() ? type.group(1) : "";
        String trimmed = body.stripLeading();
        String maskedBody = contentType.toLowerCase(java.util.Locale.ROOT).contains("json")
                || trimmed.startsWith("{") || trimmed.startsWith("[") ? maskJsonTokens(body) : Masking.maskBody(body, contentType);
        return headers + value.substring(separator, separator + separatorLength) + maskedBody;
    }

    /** Replace only secret values; retain whitespace, duplicate keys and numeric/string tokens. */
    private static String maskJsonTokens(String body) {
        try (var parser = JSON.getFactory().createParser(body)) {
            StringBuilder result = new StringBuilder(body.length());
            int copied = 0, depth = 0, roots = 0;
            com.fasterxml.jackson.core.JsonToken token;
            while ((token = parser.nextToken()) != null) {
                if (depth == 0) roots++;
                if (roots > 1) throw new IllegalArgumentException("multiple JSON values");
                if (token == com.fasterxml.jackson.core.JsonToken.FIELD_NAME
                        && Masking.isSensitiveParameterPath(parser.currentName())) {
                    token = parser.nextToken();
                    if (token == null) throw new IllegalArgumentException("missing JSON value");
                    int start = (int) parser.currentTokenLocation().getCharOffset();
                    parser.skipChildren();
                    if (token == com.fasterxml.jackson.core.JsonToken.VALUE_STRING) parser.getText();
                    int end = (int) parser.currentLocation().getCharOffset();
                    result.append(body, copied, start).append("\"***MASKED***\"");
                    copied = end;
                } else if (token == com.fasterxml.jackson.core.JsonToken.VALUE_STRING) {
                    String text = parser.getText();
                    String masked = Masking.maskSecrets("text: " + text).substring(6);
                    if (!text.equals(masked)) {
                        int start = (int) parser.currentTokenLocation().getCharOffset();
                        int end = (int) parser.currentLocation().getCharOffset();
                        result.append(body, copied, start).append(JSON.writeValueAsString(masked));
                        copied = end;
                    }
                } else if (token.isStructStart()) {
                    if (++depth > 128) throw new IllegalArgumentException("JSON depth exceeded");
                } else if (token.isStructEnd()) depth--;
            }
            if (roots == 0 || depth != 0) throw new IllegalArgumentException("invalid JSON");
            return result.append(body, copied, body.length()).toString();
        } catch (java.io.IOException | RuntimeException error) {
            // Do not retain a malformed or too deeply nested secret-bearing JSON body.
            return "[BODY REDACTED: JSON could not be safely masked]";
        }
    }
}
