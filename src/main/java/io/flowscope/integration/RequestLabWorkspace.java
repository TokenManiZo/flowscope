package io.flowscope.integration;

import java.util.LinkedHashMap;
import java.util.Map;

/** Durable Request Lab editing state: saved requests and their latest responses, kept as written. */
public record RequestLabWorkspace(long revision, Map<String, Tab> tabs) {
    private static final long MAX_TEXT_BYTES = 40L * 1024 * 1024;
    public RequestLabWorkspace {
        if (revision < 0) throw new IllegalArgumentException("invalid Request Lab revision");
        tabs = Map.copyOf(tabs == null ? Map.of() : tabs);
        if (tabs.size() > 20_000) throw new IllegalArgumentException("Request Lab limit exceeded");
        long bytes = 0;
        for (var tab : tabs.entrySet()) {
            if (tab.getKey().isBlank() || tab.getKey().length() > 256) {
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
            name = name.trim();
            request = safeHttp(request, 1_048_576);
            // RAW는 Request Lab의 '직접 입력' 전송 인증이다. 웹 서버의 CredentialMode와 같은 목록을 받아야 저장이 실패하지 않는다.
            if (credentialMode == null || !java.util.Set.of("ORIGINAL", "ANONYMOUS", "ACCOUNT", "RAW").contains(credentialMode)) {
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
        return value;
    }
}
