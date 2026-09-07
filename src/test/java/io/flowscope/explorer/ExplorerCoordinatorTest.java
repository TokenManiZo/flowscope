package io.flowscope.explorer;

import io.flowscope.core.ExecutionTrust;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.RunPhase;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

final class ExplorerCoordinatorTest {
    @Test
    void completesOnlyAfterTrustedResponseEvidenceExists() throws Exception {
        FakeProvider provider = new FakeProvider();
        AtomicReference<Pipeline.Result> published = new AtomicReference<>(Pipeline.run(List.of()));
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"), published::get, ignored -> {})) {
            ExplorerCoordinator.Snapshot started = coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true));
            await(() -> provider.request.get() != null);
            String runId = provider.request.get().runId();
            RequestRecord evidence = new RequestRecord(Source.LLM, "https://app.example.test:443",
                    "GET", "/api/orders/1", 200, "anon");
            evidence.hasResponse = true;
            evidence.body = "{\"id\":1}";
            evidence.phase = RunPhase.EXPLORATION;
            evidence.runId = runId;
            evidence.executionTrust = ExecutionTrust.CONTROLLED;
            published.set(Pipeline.run(List.of(evidence)));

            provider.listener.get().completed(new ExplorerProvider.Result("탐색 완료", List.of(), "thread-1"));

            await(() -> coordinator.current().status() == ExplorerCoordinator.Status.COMPLETED);
            assertEquals(ExplorerCoordinator.Status.COMPLETED, coordinator.current().status());
            assertNull(contexts.current(Source.LLM));
        }
    }

    @Test
    void lateProviderCompletionCannotOverwriteCancellation() throws Exception {
        FakeProvider provider = new FakeProvider();
        RunContextRegistry contexts = new RunContextRegistry();
        try (ExplorerCoordinator coordinator = new ExplorerCoordinator(new ExplorerAccountVault(),
                request -> { throw new AssertionError("gateway transport should not be called"); }, provider, contexts,
                value -> value.startsWith("https://app.example.test/"),
                () -> Pipeline.run(List.of()), ignored -> {})) {
            coordinator.start(new ExplorerCoordinator.StartRequest(
                    "https://app.example.test/", List.of(), true));
            await(() -> provider.listener.get() != null);

            coordinator.cancel();
            provider.listener.get().completed(new ExplorerProvider.Result("late", List.of(), "thread-late"));

            assertEquals(ExplorerCoordinator.Status.CANCELLED, coordinator.current().status());
            assertNull(contexts.current(Source.LLM));
        }
    }

    private static void await(java.util.function.BooleanSupplier ready) throws InterruptedException {
        for (int count = 0; count < 100 && !ready.getAsBoolean(); count++) Thread.sleep(10);
        assertTrue(ready.getAsBoolean());
    }

    private static final class FakeProvider implements ExplorerProvider {
        private final AtomicReference<Request> request = new AtomicReference<>();
        private final AtomicReference<Listener> listener = new AtomicReference<>();
        @Override public String readiness() { return "READY"; }
        @Override public Handle start(Request request, Listener listener) {
            this.request.set(request);
            this.listener.set(listener);
            return new Handle() { @Override public void steer(String message) { } @Override public void cancel() { } };
        }
        @Override public void close() { }
    }
}
