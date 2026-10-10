package io.flowscope.explorer;

import java.time.Instant;
import java.util.List;

/** LLM 공급자와 Explorer 코어 사이의 streaming 계약. */
public interface ExplorerProvider extends AutoCloseable {
    record Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                   String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt, String model,
                   String effort, String threadId, String userMessage) {
        public Request {
            exactScope = List.copyOf(exactScope);
            accountHandles = List.copyOf(accountHandles);
            model = model == null ? "" : model;
            effort = effort == null ? "" : effort;
            threadId = threadId == null ? "" : threadId;
            userMessage = userMessage == null ? "" : userMessage;
        }
        public Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                       String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt, String model,
                       String threadId, String userMessage) {
            this(runId, target, exactScope, accountHandles, gatewayUrl, discoveryUrl, gatewayToken, prompt,
                    model, "", threadId, userMessage);
        }
        public Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                       String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt, String model) {
            this(runId, target, exactScope, accountHandles, gatewayUrl, discoveryUrl, gatewayToken, prompt,
                    model, "", "", "");
        }
        public Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                       String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt) {
            this(runId, target, exactScope, accountHandles, gatewayUrl, discoveryUrl, gatewayToken, prompt, "");
        }
    }

    record ReasoningOption(String effort, String description) {
        public ReasoningOption { description = description == null ? "" : description; }
    }
    record ModelOption(String id, String label, boolean recommended,
                       String defaultEffort, List<ReasoningOption> efforts) {
        public ModelOption {
            defaultEffort = defaultEffort == null ? "" : defaultEffort;
            efforts = List.copyOf(efforts == null ? List.of() : efforts);
        }
        public ModelOption(String id, String label, boolean recommended) {
            this(id, label, recommended, "", List.of());
        }
    }
    record ModelCatalog(String configuredModel, List<ModelOption> models) {
        public ModelCatalog { models = List.copyOf(models); }
    }

    record Activity(Instant at, String kind, String title, String detail, String status,
                    Long durationMillis) {}

    record Result(String summary, List<Unresolved> unresolved, String threadId) {
        public Result { unresolved = List.copyOf(unresolved == null ? List.of() : unresolved); }
    }

    record Unresolved(String kind, String target, String reason) {}

    interface Listener {
        void activity(Activity activity);
        default void threadReady(String threadId) {}
        default void assistantDelta(String delta) {}
        void completed(Result result);
        void failed(String message);
    }

    interface Handle {
        void steer(String message);
        void cancel();
    }

    String readiness();
    default ModelCatalog models() { return new ModelCatalog("", List.of()); }
    default void invalidateReadiness() {}
    Handle start(Request request, Listener listener);
    @Override void close();
}
