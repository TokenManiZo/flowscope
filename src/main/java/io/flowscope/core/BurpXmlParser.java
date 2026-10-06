package io.flowscope.core;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Burp "Save items" XML 파서 (기능명세서 F-01/F-02 폴백 경로).
 * <item> 의 method/path/status 와 base64(=true/false) request/response 를 읽는다.
 * base64 HTTP header는 ISO-8859-1, body는 Content-Type charset 또는 UTF-8로 엄격히 디코딩한다.
 * fp(인증 지문)는 요청 헤더의 Authorization 또는 Cookie session= 에서 추출한다.
 */
public final class BurpXmlParser {

    private static final int MAX_PAYLOAD_BYTES = Integer.getInteger(
            "flowscope.payload.maxBytes", 1024 * 1024);
    private static final long MAX_COMPRESSED_PAYLOAD_BYTES = Math.max(0L, Long.getLong(
            "flowscope.payload.memoryBytes", 48L * 1024 * 1024));

    private static final Pattern COOKIE = Pattern.compile("(?im)^Cookie:\\s*(.+)$");
    private static final Pattern AUTH = Pattern.compile("(?im)^Authorization:\\s*(.+)$");
    private static final Pattern REQ_LINE = Pattern.compile("^(\\w+)\\s+(\\S+)");
    private static final Pattern RESP_LINE = Pattern.compile("(?i)^HTTP/\\S+\\s+(\\d{3})");
    private static final Pattern HOST = Pattern.compile("(?im)^Host:\\s*(.+)$");
    private static final Pattern LOCATION = Pattern.compile("(?im)^Location:\\s*(.+)$");
    private static final Pattern CONTENT_TYPE = Pattern.compile("(?im)^Content-Type:\\s*(.+)$");
    private static final Pattern CHARSET = Pattern.compile(
            "(?i)(?:^|;)\\s*charset\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|([^;\\s]+))");
    private static final Pattern SEC_FETCH_DEST = Pattern.compile("(?im)^Sec-Fetch-Dest:\\s*(.+)$");
    private static final Pattern SEC_FETCH_MODE = Pattern.compile("(?im)^Sec-Fetch-Mode:\\s*(.+)$");
    private static final Pattern ACCESS_CONTROL_REQUEST_METHOD = Pattern.compile(
            "(?im)^Access-Control-Request-Method:\\s*(.+)$");

    private BurpXmlParser() {}

    /**
     * XXE 차단 파서 생성. 입력 XML 은 점검 대상 트래픽이 담긴 **신뢰할 수 없는 파일**이므로
     * DOCTYPE 자체를 거부한다(엔티티 확장 DoS·로컬 파일 유출 차단).
     */
    static DocumentBuilder newSecureBuilder() throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        // 1순위: DOCTYPE 선언 자체를 금지 → 외부/내부 엔티티 공격 표면 제거
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        // 방어적 이중화 (구현체가 위 기능을 무시할 경우 대비)
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        f.setXIncludeAware(false);
        f.setExpandEntityReferences(false);
        f.setNamespaceAware(false);
        f.setValidating(false);
        // 외부 리소스 접근 자체를 차단 (JAXP 표준 속성)
        try {
            f.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
            f.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        } catch (IllegalArgumentException ignored) {
            // 일부 구현체는 미지원 — 위 feature 들로 이미 차단됨
        }
        DocumentBuilder b = f.newDocumentBuilder();
        b.setEntityResolver((publicId, systemId) -> {
            throw new org.xml.sax.SAXException("외부 엔티티 차단: " + systemId);
        });
        return b;
    }

    /** 파싱 결과 + 건너뛴 항목 사유(F-02: 형식 오류 항목은 skip 하고 사유 표시). */
    public static final class ParseResult {
        public final List<RequestRecord> records = new ArrayList<>();
        public final List<String> skipped = new ArrayList<>();
    }

    public static List<RequestRecord> parse(byte[] xml, Source source) {
        return parseDetailed(xml, source).records;
    }

    public static ParseResult parseDetailed(byte[] xml, Source source) {
        ParseResult res = new ParseResult();
        Document doc;
        try {
            doc = newSecureBuilder().parse(new ByteArrayInputStream(xml));
        } catch (Exception e) {
            throw new RuntimeException("Burp XML 파싱 실패(문서 단위): " + e.getMessage(), e);
        }
        NodeList items = doc.getElementsByTagName("item");
        long retainedPayloadBytes = 0L;
        Set<String> retainedPayloadDigests = new HashSet<>();
        for (int i = 0; i < items.getLength(); i++) {
            try {   // 항목 단위 skip (F-02)
                Element it = (Element) items.item(i);
                String reqText = decode(child(it, "request"));
                String method = firstNonBlank(text(it, "method"), reqMethod(reqText));
                String rawPath = firstNonBlank(text(it, "path"), reqPath(reqText));
                if (method.isBlank()) throw new IllegalArgumentException("메서드 없음");
                if (rawPath.isBlank()) throw new IllegalArgumentException("경로 없음");
                String[] pq = rawPath.split("\\?", 2);
                String path = pq[0];
                String query = pq.length > 1 ? pq[1] : null;   // F-06: 쿼리도 객체 식별 근거
                if (path.isBlank()) throw new IllegalArgumentException("경로 없음");
                Element respEl = child(it, "response");
                String respText = decode(respEl);
                int status = parseInt(firstNonBlank(text(it, "status"), responseStatus(respText)));
                if (respEl != null && respText != null && !respText.isBlank() && status <= 0) {
                    throw new IllegalArgumentException("응답 상태 없음");
                }
                RequestRecord rec = new RequestRecord(
                        source, serviceOf(it, reqText), method, path, status, fingerprint(reqText));
                rec.hasResponse = respEl != null && respText != null && !respText.isBlank();
                String requestContentType = headerValue(CONTENT_TYPE, reqText);
                String responseContentType = headerValue(CONTENT_TYPE, respText);
                String storedRequest = reqText;
                String storedResponse = rec.hasResponse ? respText : null;
                rec.requestPayload = StoredPayload.capture(storedRequest, requestContentType, MAX_PAYLOAD_BYTES);
                rec.responsePayload = StoredPayload.capture(storedResponse, responseContentType, MAX_PAYLOAD_BYTES);
                if (rec.requestPayload != null && rec.requestPayload.retained()
                        && !retainedPayloadDigests.contains(rec.requestPayload.digest())) {
                    if (retainedPayloadBytes + rec.requestPayload.compressedBytes() > MAX_COMPRESSED_PAYLOAD_BYTES) {
                        rec.requestPayload = rec.requestPayload.metadataOnly(
                                StoredPayload.Retention.CAPACITY_METADATA_ONLY);
                    } else {
                        retainedPayloadBytes += rec.requestPayload.compressedBytes();
                        retainedPayloadDigests.add(rec.requestPayload.digest());
                    }
                }
                if (rec.responsePayload != null && rec.responsePayload.retained()
                        && !retainedPayloadDigests.contains(rec.responsePayload.digest())) {
                    if (retainedPayloadBytes + rec.responsePayload.compressedBytes() > MAX_COMPRESSED_PAYLOAD_BYTES) {
                        rec.responsePayload = rec.responsePayload.metadataOnly(
                                StoredPayload.Retention.CAPACITY_METADATA_ONLY);
                    } else {
                        retainedPayloadBytes += rec.responsePayload.compressedBytes();
                        retainedPayloadDigests.add(rec.responsePayload.digest());
                    }
                }
                rec.body = rec.hasResponse ? TextLimits.truncate(responseBody(respText), MAX_BODY) : null;
                rec.respText = rec.hasResponse ? TextLimits.truncate(storedResponse, MAX_BODY) : null;
                rec.location = TextLimits.truncate(headerValue(LOCATION, respText), MAX_BODY);
                // 명세가 입력으로 요구하는 것들 (F-06 쿼리·본문 / F-18·22 원요청)
                rec.query = TextLimits.truncate(query, MAX_BODY);
                rec.reqBody = TextLimits.truncate(requestBody(reqText), MAX_BODY);
                rec.reqText = TextLimits.truncate(storedRequest, MAX_BODY);
                rec.requestContentType = requestContentType;
                rec.responseContentType = responseContentType;
                rec.secFetchDest = headerValue(SEC_FETCH_DEST, reqText);
                rec.secFetchMode = headerValue(SEC_FETCH_MODE, reqText);
                rec.accessControlRequestMethod = headerValue(ACCESS_CONTROL_REQUEST_METHOD, reqText);
                rec.timestamp = parseTime(text(it, "time"));
                rec.sourceDetail = SourceDetail.XML_IMPORT;
                rec.phase = RunPhase.IMPORT;
                rec.tool = ToolKind.OTHER;
                rec.runId = "xml-import";
                res.records.add(rec);
            } catch (Exception e) {
                res.skipped.add("item[" + i + "] 건너뜀: " + e.getMessage());
            }
        }
        return res;
    }

    /** XML fallback도 live LLM lane과 같은 exact scope를 적용한다. 범위 밖 항목은 관측에 넣지 않는다. */
    public static void retainInScope(ParseResult result, ScopePolicy scope) {
        for (int i = result.records.size() - 1; i >= 0; i--) {
            RequestRecord record = result.records.get(i);
            String target = record.service + (record.path.startsWith("/") ? record.path : "/" + record.path);
            if (!scope.allows(target)) {
                result.records.remove(i);
                result.skipped.add("scope 밖 항목 건너뜀: " + target);
            }
        }
    }

    /** 타깃 서비스(scheme://host:port). Burp XML 의 host/port/protocol 또는 Host 헤더에서. */
    static String serviceOf(Element it, String reqText) {
        String authority = text(it, "host");
        if (authority == null || authority.isBlank()) {
            Matcher m = HOST.matcher(reqText == null ? "" : reqText);
            authority = m.find() ? m.group(1).trim() : null;
        }
        if (authority == null || authority.isBlank()) return "unknown-service";
        HostAndPort parsed = parseAuthority(authority);
        String proto = firstNonBlank(text(it, "protocol"), "").toLowerCase(Locale.ROOT);
        String port = text(it, "port");
        if (port == null || port.isBlank()) port = parsed.port();
        if (proto.isBlank()) proto = "443".equals(port) ? "https" : "http";
        if (port == null || port.isBlank()) port = "https".equals(proto) ? "443" : "80";
        return proto + "://" + parsed.host().toLowerCase(Locale.ROOT) + ":" + port;
    }

    private static HostAndPort parseAuthority(String value) {
        String authority = value.trim();
        if (authority.startsWith("[")) {
            int closing = authority.indexOf(']');
            if (closing < 0) throw new IllegalArgumentException("IPv6 host 대괄호가 닫히지 않음");
            String host = authority.substring(0, closing + 1);
            String suffix = authority.substring(closing + 1);
            String port = suffix.startsWith(":") ? suffix.substring(1) : null;
            return new HostAndPort(host, port);
        }
        int firstColon = authority.indexOf(':');
        int lastColon = authority.lastIndexOf(':');
        if (firstColon >= 0 && firstColon == lastColon) {
            return new HostAndPort(authority.substring(0, firstColon), authority.substring(firstColon + 1));
        }
        if (firstColon >= 0) return new HostAndPort("[" + authority + "]", null);
        return new HostAndPort(authority, null);
    }

    private record HostAndPort(String host, String port) {}

    /** 저장 본문 상한 — 메모리 폭증 방지. */
    static final int MAX_BODY = 8192;

    /** 요청 전문에서 본문만 (F-06: 본문의 객체 식별값). */
    static String requestBody(String reqText) {
        return responseBody(reqText);   // 헤더/본문 분리 규칙 동일
    }

    /** Burp <time> 파싱. 실패하면 0(미상). */
    static long parseTime(String t) {
        if (t == null || t.isBlank()) return 0L;
        for (String fmt : new String[]{"EEE MMM dd HH:mm:ss zzz yyyy", "yyyy-MM-dd'T'HH:mm:ss"}) {
            try {
                return new java.text.SimpleDateFormat(fmt, java.util.Locale.ROOT).parse(t.trim()).getTime();
            } catch (java.text.ParseException ignored) { }
        }
        return 0L;
    }

    /** 헤더/본문 구분 후 본문 전체를 돌려준다(본문 내 빈 줄로 잘리지 않게). */
    static String responseBody(String respText) {
        if (respText == null) return null;
        Separator separator = separator(respText);
        return separator.index() < 0 ? "" : respText.substring(separator.index() + separator.length());
    }

    private static String responseStatus(String respText) {
        if (respText == null) return null;
        Matcher m = RESP_LINE.matcher(respText.stripLeading());
        return m.find() ? m.group(1) : null;
    }

    private static String headerValue(Pattern pattern, String text) {
        if (text == null) return null;
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1).trim() : null;
    }

    static String fingerprint(String reqText) {
        if (reqText == null) return "anon";
        Matcher a = AUTH.matcher(reqText);
        String auth = a.find() ? a.group(1) : null;
        Matcher c = COOKIE.matcher(reqText);
        String cookie = c.find() ? c.group(1) : null;
        return Fingerprints.of(auth, cookie);
    }

    private static String reqMethod(String reqText) {
        if (reqText == null) return null;
        Matcher m = REQ_LINE.matcher(reqText.stripLeading());
        return m.find() ? m.group(1) : null;
    }

    private static String reqPath(String reqText) {
        if (reqText == null) return null;
        Matcher m = REQ_LINE.matcher(reqText.stripLeading());
        return m.find() ? m.group(2) : null;
    }

    // --- DOM helpers ---
    private static Element child(Element parent, String tag) {
        NodeList nl = parent.getElementsByTagName(tag);
        return nl.getLength() == 0 ? null : (Element) nl.item(0);
    }

    private static String text(Element parent, String tag) {
        Element e = child(parent, tag);
        return e == null ? null : e.getTextContent().trim();
    }

    /** base64="true" 면 디코드, 아니면 원문. */
    private static String decode(Element e) {
        if (e == null) return null;
        String raw = rawText(e);
        String b64 = e.getAttribute("base64");
        if ("true".equalsIgnoreCase(b64)) {
            try {
                return decodeHttpMessage(Base64.getMimeDecoder().decode(raw.trim()));
            } catch (IllegalArgumentException ex) {
                throw new IllegalArgumentException("base64 디코드 실패", ex);
            }
        }
        return raw;
    }

    private static String decodeHttpMessage(byte[] message) {
        ByteSeparator separator = separator(message);
        if (separator.index() < 0) return new String(message, StandardCharsets.ISO_8859_1);
        int bodyOffset = separator.index() + separator.length();
        String headers = new String(message, 0, bodyOffset, StandardCharsets.ISO_8859_1);
        if (bodyOffset == message.length) return headers;
        String contentType = headerValue(CONTENT_TYPE, headers);
        Charset charset = bodyCharset(contentType);
        try {
            String body = charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(message, bodyOffset, message.length - bodyOffset)).toString();
            return headers + body;
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException("HTTP 본문 " + charset.name() + " 디코드 실패", error);
        }
    }

    private static Charset bodyCharset(String contentType) {
        Matcher matcher = CHARSET.matcher(contentType == null ? "" : contentType);
        if (!matcher.find()) return StandardCharsets.UTF_8;
        String value = matcher.group(1) != null ? matcher.group(1)
                : matcher.group(2) != null ? matcher.group(2) : matcher.group(3);
        try {
            return Charset.forName(value.trim());
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("지원하지 않는 HTTP 본문 문자셋: " + value.trim(), error);
        }
    }

    private static Separator separator(String message) {
        int crlf = message.indexOf("\r\n\r\n");
        int lf = message.indexOf("\n\n");
        if (crlf < 0 || (lf >= 0 && lf < crlf)) return new Separator(lf, 2);
        return new Separator(crlf, 4);
    }

    private static ByteSeparator separator(byte[] message) {
        int crlf = indexOf(message, new byte[]{'\r', '\n', '\r', '\n'});
        int lf = indexOf(message, new byte[]{'\n', '\n'});
        if (crlf < 0 || (lf >= 0 && lf < crlf)) return new ByteSeparator(lf, 2);
        return new ByteSeparator(crlf, 4);
    }

    private static int indexOf(byte[] value, byte[] needle) {
        outer:
        for (int i = 0; i <= value.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) if (value[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    private record Separator(int index, int length) {}
    private record ByteSeparator(int index, int length) {}

    private static String rawText(Element e) {
        StringBuilder sb = new StringBuilder();
        NodeList kids = e.getChildNodes();
        for (int i = 0; i < kids.getLength(); i++) {
            Node k = kids.item(i);
            if (k.getNodeType() == Node.CDATA_SECTION_NODE || k.getNodeType() == Node.TEXT_NODE) {
                sb.append(k.getNodeValue());
            }
        }
        return sb.toString();
    }

    private static String firstNonBlank(String... vals) {
        for (String v : vals) if (v != null && !v.isBlank()) return v;
        return "";
    }

    private static int parseInt(String s) {
        try { return s == null || s.isBlank() ? 0 : Integer.parseInt(s.trim()); }
        catch (NumberFormatException e) { return 0; }
    }
}
