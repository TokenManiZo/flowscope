package io.flowscope;

import io.flowscope.core.RecordMerge;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import io.flowscope.core.SourceDetail;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class RecordMergeTest {
    @Test
    void repeatedImportSkipsExistingMultiplicityButKeepsNewOccurrences() {
        RequestRecord first = observed("GET /orders/1", "HTTP/1.1 200 OK");
        RequestRecord sameOccurrence = observed("GET /orders/1", "HTTP/1.1 200 OK");
        RequestRecord repeatedRequest = observed("GET /orders/1", "HTTP/1.1 200 OK");

        List<RequestRecord> missing = RecordMerge.missing(
                List.of(first), List.of(sameOccurrence, repeatedRequest), 10);

        assertEquals(List.of(repeatedRequest), missing);
    }

    @Test
    void sourceAndResponseRemainPartOfTheObservationIdentityAndLimitIsApplied() {
        RequestRecord human = observed("GET /orders/1", "HTTP/1.1 200 OK");
        RequestRecord scanner = observed("GET /orders/1", "HTTP/1.1 200 OK");
        scanner.sourceDetail = SourceDetail.OTHER_SCANNER;
        RequestRecord changed = observed("GET /orders/1", "HTTP/1.1 403 Forbidden");

        assertEquals(List.of(scanner), RecordMerge.missing(List.of(human), List.of(scanner, changed), 1));
    }

    private static RequestRecord observed(String request, String response) {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://target.test:443",
                "GET", "/orders/1", response.contains("403") ? 403 : 200, "session-a");
        record.sourceDetail = SourceDetail.BROWSER;
        record.reqText = request;
        record.respText = response;
        record.hasResponse = true;
        return record;
    }
}
