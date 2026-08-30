package io.flowscope.core;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** ZAP이 내보낸 HAR 1.2 HTTP 메시지를 SCANNER Evidence로 가져온다. */
public final class HarParser {
    private static final int MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
    private static final int MAX_PAYLOAD_BYTES = Integer.getInteger(
            "flowscope.payload.maxBytes", 1024 * 1024);
    private static final long MAX_COMPRESSED_PAYLOAD_BYTES = Math.max(0L, Long.getLong(
            "flowscope.payload.memoryBytes", 48L * 1024 * 1024));
    private static final Pattern HTTP_TOKEN = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxDocumentLength(MAX_DOCUMENT_BYTES)
                    .maxNestingDepth(128)
                    .maxStringLength(MAX_DOCUMENT_BYTES)
                    .maxTokenCount(1_000_000)
                    .build())
            .build());

    private HarParser() {}

    public static BurpXmlParser.ParseResult parseDetailed(byte[] har) {
        if (har == null || har.length == 0 || har.length > MAX_DOCUMENT_BYTES) {
            throw new IllegalArgumentException("HAR 파일은 1 byte 이상 25 MiB 이하여야 합니다.");
        }
        JsonNode root;
        try {
            root = JSON.readTree(har);
        } catch (Exception error) {
            throw new IllegalArgumentException("HAR JSON 파싱 실패: " + error.getMessage(), error);
        }
        JsonNode entries = root == null ? null : root.path("log").path("entries");
        if (entries == null || !entries.isArray()) {
            throw new IllegalArgumentException("HAR log.entries 배열이 없습니다.");
        }

        BurpXmlParser.ParseResult result = new BurpXmlParser.ParseResult();
        long retainedPayloadBytes = 0L;
        Set<String> retainedPayloadDigests = new HashSet<>();
        for (int index = 0; index < entries.size(); index++) {
            try {
                RequestRecord record = parseEntry(entries.get(index));
                retainedPayloadBytes = retainWithinCapacity(record.requestPayload, retainedPayloadBytes,
                        retainedPayloadDigests, value -> record.requestPayload = value);
                retainedPayloadBytes = retainWithinCapacity(record.responsePayload, retainedPayloadBytes,
                        retainedPayloadDigests, value -> record.responsePayload = value);
                result.records.add(record);
            } catch (Exception error) {
                result.skipped.add("entry[" + index + "] 건너뜀: " + error.getMessage());
            }
        }
        return result;
    }

    private static RequestRecord parseEntry(JsonNode entry) {
        if (entry == null || !entry.isObject()) throw new IllegalArgumentException("entry 객체가 아님");
        JsonNode request = entry.path("request");
        String method = requiredText(request, "method").toUpperCase(Locale.ROOT);
        if (!HTTP_TOKEN.matcher(method).matches()) throw new IllegalArgumentException("요청 메서드 형식 오류");
        URI uri;
        try { uri = URI.create(requiredText(request, "url")); }
        catch (RuntimeException error) { throw new IllegalArgumentException("요청 URL 오류", error); }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!(scheme.equals("http") || scheme.equals("https")) || uri.getHost() == null) {
            throw new IllegalArgumentException("http(s) 절대 URL만 허용");
        }
        String path = uri.getRawPath();
        if (path == null || path.isBlank()) path = "/";
        String query = uri.getRawQuery();
        List<Header> requestHeaders = headers(request.path("headers"));
        String requestContentType = firstNonBlank(header(requestHeaders, "Content-Type"),
                text(request.path("postData"), "mimeType"));
        String requestBody = text(request.path("postData"), "text");
        String requestText = message(method + " " + path + (query == null ? "" : "?" + query)
                        + " " + httpVersion(text(request, "httpVersion")), requestHeaders, requestBody);

        JsonNode response = entry.path("response");
        int status = response.isObject() ? response.path("status").asInt(0) : 0;
        boolean hasResponse = response.isObject() && status > 0;
        List<Header> responseHeaders = hasResponse ? headers(response.path("headers")) : List.of();
        String responseContentType = hasResponse ? firstNonBlank(
                header(responseHeaders, "Content-Type"), text(response.path("content"), "mimeType")) : null;
        DecodedContent responseBody = hasResponse ? content(response.path("content"), responseContentType)
                : DecodedContent.empty();
        String responseHead = hasResponse ? message(httpVersion(text(response, "httpVersion")) + " " + status
                + " " + singleLine(text(response, "statusText")), responseHeaders, null) : null;
        String responseText = hasResponse && responseBody.text() != null
                ? responseHead + responseBody.text() : responseHead;

        RequestRecord record = new RequestRecord(Source.SCANNER, service(uri), method, path, status,
                BurpXmlParser.fingerprint(requestText));
        record.hasResponse = hasResponse;
        String maskedRequest = Masking.maskHeaders(requestText);
        String maskedResponse = hasResponse ? Masking.maskHeaders(responseText) : null;
        record.requestPayload = StoredPayload.capture(maskedRequest, requestContentType, MAX_PAYLOAD_BYTES);
        if (hasResponse && responseBody.binary() != null) {
            byte[] originalHead = responseHead.getBytes(StandardCharsets.UTF_8);
            byte[] maskedHead = Masking.maskHeaders(responseHead).getBytes(StandardCharsets.UTF_8);
            byte[] digestInput = new byte[maskedHead.length + responseBody.binary().length];
            System.arraycopy(maskedHead, 0, digestInput, 0, maskedHead.length);
            System.arraycopy(responseBody.binary(), 0, digestInput, maskedHead.length, responseBody.binary().length);
            record.responsePayload = StoredPayload.metadataOnly(digestInput,
                    originalHead.length + responseBody.binary().length,
                    StoredPayload.Retention.BINARY_METADATA_ONLY);
        } else {
            record.responsePayload = StoredPayload.capture(maskedResponse, responseContentType, MAX_PAYLOAD_BYTES);
        }
        record.query = Masking.truncate(Masking.maskSecrets(query), BurpXmlParser.MAX_BODY);
        record.reqBody = Masking.truncate(Masking.maskBody(requestBody, requestContentType), BurpXmlParser.MAX_BODY);
        record.reqText = Masking.truncate(maskedRequest, BurpXmlParser.MAX_BODY);
        record.body = hasResponse && responseBody.text() != null
                ? Masking.truncate(Masking.maskBody(responseBody.text(), responseContentType), BurpXmlParser.MAX_BODY)
                : null;
        record.respText = hasResponse ? Masking.truncate(maskedResponse, BurpXmlParser.MAX_BODY) : null;
        record.location = Masking.truncate(Masking.maskSecrets(header(responseHeaders, "Location")),
                BurpXmlParser.MAX_BODY);
        record.requestContentType = requestContentType;
        record.responseContentType = responseContentType;
        record.secFetchDest = header(requestHeaders, "Sec-Fetch-Dest");
        record.secFetchMode = header(requestHeaders, "Sec-Fetch-Mode");
        record.accessControlRequestMethod = header(requestHeaders, "Access-Control-Request-Method");
        record.timestamp = timestamp(text(entry, "startedDateTime"));
        record.sourceDetail = SourceDetail.HAR_IMPORT;
        record.phase = RunPhase.IMPORT;
        record.tool = ToolKind.ZAP;
        record.executionTrust = ExecutionTrust.IMPORTED;
        record.runId = "har-import";
        return record;
    }

    private static DecodedContent content(JsonNode content, String contentType) {
        String value = text(content, "text");
        if (value == null) return DecodedContent.empty();
        if (!"base64".equalsIgnoreCase(text(content, "encoding"))) return new DecodedContent(value, null);
        byte[] decoded;
        try { decoded = Base64.getDecoder().decode(value); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("응답 base64 디코드 실패", error); }
        if (!textual(contentType)) return new DecodedContent(null, decoded);
        try {
            String text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(decoded)).toString();
            return new DecodedContent(text, null);
        } catch (CharacterCodingException error) {
            return new DecodedContent(null, decoded);
        }
    }

    private static boolean textual(String contentType) {
        if (contentType == null || contentType.isBlank()) return true;
        String type = contentType.toLowerCase(Locale.ROOT);
        return type.startsWith("text/") || type.contains("json") || type.contains("xml")
                || type.contains("javascript") || type.contains("graphql")
                || type.contains("x-www-form-urlencoded");
    }

    private static List<Header> headers(JsonNode values) {
        if (values == null || !values.isArray()) return List.of();
        List<Header> result = new ArrayList<>();
        for (JsonNode value : values) {
            String name = text(value, "name");
            String headerValue = text(value, "value");
            if (name != null && HTTP_TOKEN.matcher(name).matches()) {
                result.add(new Header(name, singleLine(headerValue)));
            }
        }
        return result;
    }

    private static String message(String firstLine, List<Header> headers, String body) {
        StringBuilder result = new StringBuilder(singleLine(firstLine)).append("\r\n");
        for (Header header : headers) result.append(header.name()).append(": ").append(header.value()).append("\r\n");
        result.append("\r\n");
        if (body != null) result.append(body);
        return result.toString();
    }

    private static String header(List<Header> headers, String name) {
        return headers.stream().filter(value -> value.name().equalsIgnoreCase(name))
                .map(Header::value).findFirst().orElse(null);
    }

    private static String service(URI uri) {
        String host = uri.getHost().contains(":") ? "[" + uri.getHost() + "]" : uri.getHost();
        int port = uri.getPort() >= 0 ? uri.getPort() : uri.getScheme().equalsIgnoreCase("https") ? 443 : 80;
        return uri.getScheme().toLowerCase(Locale.ROOT) + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
    }

    private static String httpVersion(String value) {
        if (value == null || value.isBlank()) return "HTTP/1.1";
        String version = singleLine(value).toUpperCase(Locale.ROOT);
        return version.startsWith("HTTP/") ? version : version.equals("H2") ? "HTTP/2" : "HTTP/1.1";
    }

    private static String singleLine(String value) {
        return value == null ? "" : value.replace("\r", "").replace("\n", "");
    }

    private static String requiredText(JsonNode node, String field) {
        String value = text(node, field);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " 없음");
        return value;
    }

    private static String text(JsonNode node, String field) {
        if (node == null || !node.isObject()) return null;
        JsonNode value = node.get(field);
        return value == null || value.isNull() || !value.isValueNode() ? null : value.asText();
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) if (value != null && !value.isBlank()) return value;
        return null;
    }

    private static long timestamp(String value) {
        if (value == null || value.isBlank()) return 0L;
        try { return Instant.parse(value).toEpochMilli(); }
        catch (RuntimeException ignored) { return 0L; }
    }

    private static long retainWithinCapacity(StoredPayload payload, long retainedBytes, Set<String> digests,
                                             java.util.function.Consumer<StoredPayload> replace) {
        if (payload == null || !payload.retained() || digests.contains(payload.digest())) return retainedBytes;
        if (retainedBytes + payload.compressedBytes() > MAX_COMPRESSED_PAYLOAD_BYTES) {
            replace.accept(payload.metadataOnly(StoredPayload.Retention.CAPACITY_METADATA_ONLY));
            return retainedBytes;
        }
        digests.add(payload.digest());
        return retainedBytes + payload.compressedBytes();
    }

    private record Header(String name, String value) {}
    private record DecodedContent(String text, byte[] binary) {
        private static DecodedContent empty() { return new DecodedContent(null, null); }
    }
}
