package io.flowscope.explorer;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Burp Montoya 전송 경계. Explorer 코어는 HTTP 구현과 Evidence 저장을 이 계약에 위임한다. */
public interface ExplorerTransport {
    record Request(String accountId, String method, String url, Map<String, String> headers,
                   byte[] body, String contentType, String runId, boolean sessionSetup) {
        public Request {
            headers = Map.copyOf(headers == null ? Map.of() : headers);
            body = body == null ? new byte[0] : body.clone();
        }
    }

    record Response(int status, String url, String location, String contentType,
                    Map<String, List<String>> headers, String body, boolean bodyTruncated, String evidenceId,
                    long durationMillis, Instant receivedAt) {
        public Response {
            headers = Map.copyOf(headers == null ? Map.of() : headers);
            body = body == null ? "" : body;
            receivedAt = receivedAt == null ? Instant.now() : receivedAt;
        }
    }

    Response send(Request request) throws Exception;
}
