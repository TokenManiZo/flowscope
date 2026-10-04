package io.flowscope.explorer;

import java.time.Instant;
import java.util.List;

/** LLM 공급자와 Explorer 코어 사이의 streaming 계약. */
public interface ExplorerProvider extends AutoCloseable {
    record Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                   String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt, String model) {
        public Request {
            exactScope = List.copyOf(exactScope);
            accountHandles = List.copyOf(accountHandles);
            model = model == null ? "" : model;
        }
        public Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                       String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt) {
            this(runId, target, exactScope, accountHandles, gatewayUrl, discoveryUrl, gatewayToken, prompt, "");
        }
    }

    record ModelOption(String id, String label, boolean recommended) {}
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
        /** Empty accepts the turn; otherwise start one bounded repair turn in the same provider thread. */
        default String review(Result result, int completedTurns) { return ""; }
        /** The turn is over, but its browser, gateway and provider thread remain available for operator follow-up. */
        default void paused(Result result) {}
        void completed(Result result);
        void failed(String message);
    }

    interface Handle {
        void steer(String message);
        default void finish() { throw new UnsupportedOperationException("Explorer 완료를 지원하지 않습니다."); }
        void cancel();
    }

    String readiness();
    default ModelCatalog models() { return new ModelCatalog("", List.of()); }
    default void invalidateReadiness() {}
    Handle start(Request request, Listener listener);
    @Override void close();
}
