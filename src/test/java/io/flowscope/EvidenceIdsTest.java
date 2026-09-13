package io.flowscope;

import io.flowscope.core.EvidenceIds;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class EvidenceIdsTest {
    @Test
    void 개행이_포함돼도_필드경계가_다른_관측은_다른_digest다() {
        RequestRecord left = record("/a\nb", "c");
        RequestRecord right = record("/a", "b\nc");

        EvidenceIds.assign(List.of(left, right));

        assertNotEquals(left.contentDigest, right.contentDigest);
    }

    @Test
    void 기존_newline_digest의_Evidence_ID를_보존하고_framed_digest로_이행한다() throws Exception {
        RequestRecord record = record("/orders/1", "a=1");
        record.evidenceId = "ev-0123456789abcdef";
        record.contentDigest = legacyDigest(record);
        String previousDigest = record.contentDigest;

        EvidenceIds.assign(List.of(record));

        assertEquals("ev-0123456789abcdef", record.evidenceId);
        assertNotEquals(previousDigest, record.contentDigest);
    }

    @Test
    void 원본에_먼저_부여한_Evidence_ID는_격리_분석_스냅샷에서도_같은_값으로_유지된다() {
        // 통제 실행기는 격리 분석(복사본) 직후 원본 레코드의 ID를 돌려주므로,
        // 원본에 먼저 ID를 붙이고 그 값이 스냅샷 복사본과 일치해야 MCP·원장·UI가 같은 ID를 본다.
        RequestRecord original = record("/orders/1", null);
        original.runId = "explore-1";

        EvidenceIds.assign(List.of(original));
        String assigned = original.evidenceId;
        io.flowscope.core.Pipeline.Result snapshot =
                io.flowscope.core.Pipeline.runIsolated(new java.util.ArrayList<>(List.of(original)),
                        new io.flowscope.core.AnalysisConfig());

        org.junit.jupiter.api.Assertions.assertNotNull(assigned);
        org.junit.jupiter.api.Assertions.assertTrue(assigned.startsWith("ev-"));
        assertEquals(assigned, snapshot.records.getFirst().evidenceId);
        assertEquals(assigned, original.evidenceId);
    }

    private static RequestRecord record(String path, String query) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443",
                "GET", path, 200, "anon");
        record.query = query;
        record.hasResponse = true;
        record.body = "{}";
        return record;
    }

    private static String legacyDigest(RequestRecord r) throws Exception {
        String material = String.join("\n",
                r.source.name(), r.sourceDetail.name(), r.orchestrator.name(), r.tool.name(), r.phase.name(),
                r.executionTrust.name(), String.valueOf(r.runId), r.service, r.method, r.path,
                String.valueOf(r.query), String.valueOf(r.reqBody) + "\n" + String.valueOf(r.reqText),
                String.valueOf(r.status), String.valueOf(r.body) + "\n" + String.valueOf(r.respText),
                String.valueOf(r.location), String.valueOf(r.hasResponse), String.valueOf(r.timestamp), r.fp);
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte value : bytes) out.append(String.format("%02x", value));
        return out.toString();
    }
}
