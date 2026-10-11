package io.flowscope.integration;

import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

final class RunExecutionLedgerTest {
    @Test
    void distinguishesNoAttemptAllFailedPartialAndResponseOnlyRuns() {
        RunExecutionLedger ledger = new RunExecutionLedger();
        assertEquals(RunExecutionLedger.Quality.NOT_ATTEMPTED,
                ledger.summarize(Source.LLM, "not-started").quality());

        ledger.record(Source.LLM, "failed", null, "GET",
                "https://api.test/orders?token=raw-secret", RunExecutionLedger.Outcome.TLS_FAILURE,
                0, null, Instant.parse("2026-09-03T00:00:00Z"), 12);
        RunExecutionLedger.Summary failed = ledger.summarize(Source.LLM, "failed");
        assertEquals(RunExecutionLedger.Quality.ALL_FAILED, failed.quality());
        assertEquals(1, failed.attempted());
        assertEquals(0, failed.responses());
        assertEquals(1, failed.failures());

        ledger.record(Source.LLM, "partial", "user-a", "GET", "https://api.test/orders/1",
                RunExecutionLedger.Outcome.HTTP_RESPONSE, 200, "ev-0123456789abcdef",
                Instant.parse("2026-09-03T00:00:01Z"), 15);
        ledger.record(Source.LLM, "partial", "user-a", "GET", "https://api.test/orders/2",
                RunExecutionLedger.Outcome.TIMEOUT, 0, null,
                Instant.parse("2026-09-03T00:00:02Z"), 30_000);
        assertEquals(RunExecutionLedger.Quality.PARTIAL_FAILURE,
                ledger.summarize(Source.LLM, "partial").quality());
        assertEquals(Instant.parse("2026-09-03T00:00:01Z").toEpochMilli(),
                ledger.summarize(Source.LLM, "partial").startedAt());
        assertEquals(0, ledger.summarize(Source.LLM, "not-started").startedAt());

        ledger.record(Source.LLM, "responded", null, "GET", "https://api.test/health",
                RunExecutionLedger.Outcome.HTTP_RESPONSE, 204, "ev-fedcba9876543210",
                Instant.parse("2026-09-03T00:00:03Z"), 7);
        assertEquals(RunExecutionLedger.Quality.RESPONSES_OBSERVED,
                ledger.summarize(Source.LLM, "responded").quality());

        RunExecutionLedger.Attempt stored = ledger.attempts().getFirst();
        assertEquals("/orders", stored.path());
        assertFalse(stored.path().contains("raw-secret"));
    }

    @Test
    void evictsOldestAttemptAtBoundWithoutChangingSequence() {
        RunExecutionLedger ledger = new RunExecutionLedger(2);
        for (int index = 0; index < 3; index++) {
            ledger.record(Source.LLM, "bounded", null, "GET", "https://api.test/" + index,
                    RunExecutionLedger.Outcome.NO_RESPONSE, 0, null, Instant.EPOCH, index);
        }
        assertEquals(2, ledger.attempts().size());
        assertEquals(2, ledger.attempts().getFirst().sequence());
        assertEquals(3, ledger.attempts().getLast().sequence());
    }

    @Test
    void exposesOnlyTheLatestHundredRunSummaries() {
        RunExecutionLedger ledger = new RunExecutionLedger(200);
        for (int index = 0; index < 101; index++) {
            ledger.record(Source.LLM, "run-" + index, null, "GET", "https://api.test/" + index,
                    RunExecutionLedger.Outcome.NO_RESPONSE, 0, null, Instant.EPOCH, index);
        }

        assertEquals(100, ledger.summaries().size());
        assertEquals("run-1", ledger.summaries().getFirst().runId());
        assertEquals("run-100", ledger.summaries().getLast().runId());
    }
}
