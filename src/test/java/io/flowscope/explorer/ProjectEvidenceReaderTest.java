package io.flowscope.explorer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.StoredPayload;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

final class ProjectEvidenceReaderTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void listsAndSearchesCurrentProjectMetadataWithoutCopyingRawContent() throws Exception {
        RequestRecord first = record("ev-1", Source.HUMAN, "GET", "/api/orders/101", 200,
                "Authorization: Bearer local-test-secret\r\n\r\n", "HTTP/1.1 200 OK\r\n\r\nfirst");
        RequestRecord second = record("ev-2", Source.LLM, "POST", "/api/search", 401,
                "POST /api/search HTTP/1.1\r\n\r\nkeyword=second", "HTTP/1.1 401 Unauthorized\r\n\r\nsecond");
        ProjectEvidenceReader reader = new ProjectEvidenceReader((run, workspace) -> List.of(first, second));

        var page = reader.execute("run-1", "/project/codex-raw", "flowscope_evidence_list",
                JSON.readTree("{\"offset\":0,\"limit\":1}"));
        assertEquals(2, page.path("total").asInt());
        assertEquals(1, page.path("items").size());
        assertEquals("ev-2", page.at("/items/0/evidence_id").asText());
        assertEquals("LLM", page.at("/items/0/source").asText());
        assertEquals(1, page.path("next_offset").asInt());
        assertFalse(page.toString().contains("local-test-secret"));

        var searched = reader.execute("run-1", "/project/codex-raw", "flowscope_evidence_search",
                JSON.readTree("{\"query\":\"/api/search\",\"offset\":0,\"limit\":20}"));
        assertEquals(1, searched.path("total").asInt());
        assertEquals("ev-2", searched.at("/items/0/evidence_id").asText());
    }

    @Test
    void readsBoundedUnmaskedRequestAndResponseAndReportsRetention() throws Exception {
        RequestRecord record = record("ev-7", Source.SCANNER, "GET", "/api/me", 200,
                "GET /api/me HTTP/1.1\r\nAuthorization: Bearer local-test-secret\r\n\r\n",
                "HTTP/1.1 200 OK\r\n\r\n{\"id\":7}");
        ProjectEvidenceReader reader = new ProjectEvidenceReader((run, workspace) -> List.of(record));

        var request = reader.execute("run-1", "workspace", "flowscope_evidence_read",
                JSON.readTree("{\"evidence_id\":\"ev-7\",\"part\":\"request\",\"char_offset\":0,\"max_chars\":64}"));
        assertTrue(request.path("text").asText().contains("local-test-secret"));
        assertTrue(request.path("complete").asBoolean());
        assertTrue(request.path("next_char_offset").asInt() <= 64);
        var response = reader.execute("run-1", "workspace", "flowscope_evidence_read",
                JSON.readTree("{\"evidence_id\":\"ev-7\",\"part\":\"response\",\"char_offset\":0,\"max_chars\":64}"));
        assertTrue(response.path("text").asText().contains("{\"id\":7}"));
        assertThrows(IllegalArgumentException.class, () -> reader.execute("run-1", "workspace",
                "flowscope_evidence_read", JSON.readTree("{\"evidence_id\":\"ev-missing\",\"part\":\"request\"}")));
    }

    @Test
    void refusesAnExpiredProjectBindingInsteadOfReadingAnotherProject() throws Exception {
        AtomicBoolean active = new AtomicBoolean(true);
        ProjectEvidenceReader reader = new ProjectEvidenceReader((run, workspace) -> {
            if (!active.get()) throw new IllegalStateException("project changed");
            return List.of(record("ev-original", Source.HUMAN, "GET", "/api/one", 200,
                    "GET /api/one HTTP/1.1\r\n\r\n", "HTTP/1.1 200 OK\r\n\r\n"));
        });
        active.set(false);
        assertThrows(IllegalStateException.class, () -> reader.execute("run-1", "workspace",
                "flowscope_evidence_list", JSON.readTree("{}")));
    }

    private static RequestRecord record(String id, Source source, String method, String path, int status,
                                        String request, String response) {
        RequestRecord record = new RequestRecord(source, "https://app.example.test:443", method, path, status, "anon");
        record.evidenceId = id;
        record.runId = "saved-run";
        record.hasResponse = true;
        record.requestPayload = StoredPayload.capture(request, "text/plain", 1024 * 1024);
        record.responsePayload = StoredPayload.capture(response, "text/plain", 1024 * 1024);
        return record;
    }
}
