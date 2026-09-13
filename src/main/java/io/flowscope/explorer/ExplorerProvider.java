package io.flowscope.explorer;

import java.time.Instant;
import java.util.List;

/** LLM 공급자와 Explorer 코어 사이의 streaming 계약. */
public interface ExplorerProvider extends AutoCloseable {
    record Request(String runId, String target, List<String> exactScope, List<String> accountHandles,
                   String gatewayUrl, String discoveryUrl, String gatewayToken, String prompt) {
        public Request { exactScope = List.copyOf(exactScope); accountHandles = List.copyOf(accountHandles); }
    }

    record Activity(Instant at, String kind, String title, String detail, String status,
                    Long durationMillis) {}

    record Result(String summary, List<Unresolved> unresolved, String threadId) {
        public Result { unresolved = List.copyOf(unresolved == null ? List.of() : unresolved); }
    }

    record Unresolved(String kind, String target, String reason) {}

    interface Listener {
        void activity(Activity activity);
        void completed(Result result);
        void failed(String message);
    }

    interface Handle {
        void steer(String message);
        void cancel();
    }

    String readiness();
    default void invalidateReadiness() {}
    Handle start(Request request, Listener listener);
    @Override void close();
}
