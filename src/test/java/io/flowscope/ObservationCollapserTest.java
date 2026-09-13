package io.flowscope;

import io.flowscope.core.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ObservationCollapserTest {
    @Test
    void 같은_의미만_표시상_접고_Evidence는_전부_보존한다() {
        RequestRecord first = record("acct-a", "/orders/1", 200, 10);
        RequestRecord second = record("acct-a", "/orders/1", 201, 20);
        RequestRecord otherAccount = record("acct-b", "/orders/1", 200, 30);
        List<RequestRecord> records = List.of(first, second, otherAccount);
        Normalizer.normalizeAll(records);
        first.idn = second.idn = "acct-a";
        otherAccount.idn = "acct-b";
        EvidenceIds.assign(records);

        Map<String, ObservationCollapser.Group> groups = ObservationCollapser.byEvidence(records);

        assertEquals(2, groups.get(first.evidenceId).count());
        assertEquals(groups.get(first.evidenceId).id(), groups.get(second.evidenceId).id());
        assertNotEquals(groups.get(first.evidenceId).id(), groups.get(otherAccount.evidenceId).id());
        assertEquals(3, records.size());
    }

    private RequestRecord record(String fp, String path, int status, long timestamp) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443", "GET", path, status, fp);
        record.hasResponse = true;
        record.timestamp = timestamp;
        record.phase = RunPhase.EXPLORATION;
        record.runId = "run-1";
        return record;
    }
}
