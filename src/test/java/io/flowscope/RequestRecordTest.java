package io.flowscope;

import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RequestRecordTest {
    @Test
    void LF헤더의_가장_이른_구분자를_본문시작으로_쓴다() {
        RequestRecord record = new RequestRecord(Source.HUMAN, "https://t:443",
                "POST", "/echo", 200, "anon");
        record.reqText = "POST /echo HTTP/1.1\nHost: t\n\nfirst\r\n\r\nsecond";

        assertEquals("first\r\n\r\nsecond", record.requestBodyForAnalysis());
    }
}
