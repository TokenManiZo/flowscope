package io.flowscope.core.parameter;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.core.exc.StreamConstraintsException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.flowscope.core.Masking;
import io.flowscope.core.Normalizer;
import io.flowscope.core.RequestRecord;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;
import org.xml.sax.SAXParseException;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import static io.flowscope.core.parameter.ParameterObservation.*;

/** Passive bounded extraction; never consults responses or retains HTTP messages. */
public final class ParameterExtractor {
    static final int MAX_INPUT_CHARS = 1_000_000;
    static final int MAX_DEPTH = 128;
    static final int MAX_VISITED_NODES = 100_000;
    static final int MAX_PARAMETERS_PER_RECORD = 10_000;
    static final int MAX_PREVIEW_CHARS = 64;
    static final int MAX_COORDINATE_CHARS_PER_FIELD = 8_192;
    static final int MAX_TOTAL_COORDINATE_CHARS = MAX_INPUT_CHARS;

    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(MAX_DEPTH)
                    .maxStringLength(MAX_INPUT_CHARS).maxNameLength(MAX_INPUT_CHARS)
                    .maxNumberLength(MAX_INPUT_CHARS).build()).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final Pattern UUID = Pattern.compile(
            "(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    private static final Pattern INTEGER = Pattern.compile("-?\\d+");
    private static final Pattern DECIMAL = Pattern.compile("-?(?:\\d+\\.\\d*|\\d*\\.\\d+)(?:[eE][+-]?\\d+)?");
    private static final Pattern BOUNDARY = Pattern.compile("(?i)(?:^|;)\\s*boundary=(?:\"([^\"]+)\"|([^;\\s]+))");
    private static final Pattern NAME = Pattern.compile("(?i)(?:^|;)\\s*name=\"([^\"]*)\"");
    private static final Pattern FILE = Pattern.compile("(?i)(?:^|;)\\s*filename\\*?\\s*=");
    private static final Pattern PART_TYPE = Pattern.compile("(?im)^Content-Type:\\s*([^;\\r\\n]+)");
    private static final Pattern CONTINUED_HEADER = Pattern.compile("(?m)^[ \\t]");

    private ParameterExtractor() {}

    public static ParameterExtraction extract(RequestRecord record) {
        if (record == null) throw new IllegalArgumentException("request record is required");
        return new Extraction(record).extract();
    }

    private static final class Extraction {
        private final RequestRecord record;
        private final String operation;
        private final boolean invalidMetadata;
        private final Map<ParameterKey, Values> parameters = new LinkedHashMap<>();
        private final Map<String, Integer> diagnostics = new LinkedHashMap<>();
        private int visited;
        private int coordinateChars;
        private boolean coordinateLimit;

        private Extraction(RequestRecord record) {
            this.record = record;
            String candidate = record.op == null || record.op.isBlank()
                    ? record.service + " " + record.method + " /" : record.op;
            invalidMetadata = candidate.length() > MAX_COORDINATE_CHARS_PER_FIELD
                    || record.service.length() > MAX_COORDINATE_CHARS_PER_FIELD
                    || record.method.length() > MAX_COORDINATE_CHARS_PER_FIELD;
            operation = invalidMetadata ? "UNKNOWN_OPERATION" : candidate;
        }

        private ParameterExtraction extract() {
            if (invalidMetadata) {
                diagnostic("COORDINATE_LIMIT", 1);
                return result();
            }
            if (record.evidenceId == null || record.evidenceId.isBlank()) {
                diagnostic("MISSING_EVIDENCE", 1);
                return result();
            }
            if (bounded(record.path)) path();
            if (bounded(record.query)) form(record.query, Location.QUERY);
            // The analysis accessor selects the retained, already-masked request body when available.
            String body = record.requestBodyForAnalysis();
            if (bounded(body) && body != null && !body.isBlank()) {
                String type = record.requestContentType == null ? "" : record.requestContentType.toLowerCase(Locale.ROOT);
                if (type.contains("multipart/form-data")) multipart(body);
                else if (type.contains("application/x-www-form-urlencoded")) form(body, Location.FORM);
                else if (type.contains("json") || body.stripLeading().startsWith("{") || body.stripLeading().startsWith("[")) json(body);
                else if (type.contains("xml") || body.stripLeading().startsWith("<")) xml(body);
            }
            return result();
        }

        private boolean bounded(String input) {
            if (input != null && input.length() > MAX_INPUT_CHARS) {
                diagnostic("INPUT_LIMIT", 1);
                return false;
            }
            return true;
        }

        private boolean visit() {
            if (visited >= MAX_VISITED_NODES) {
                diagnostics.putIfAbsent("NODE_LIMIT", 1);
                return false;
            }
            visited++;
            return true;
        }

        private void path() {
            String[] original = java.util.Arrays.stream(record.path.split("/")).filter(s -> !s.isEmpty()).toArray(String[]::new);
            String normalized = Normalizer.normalize(record.method, record.path).op;
            String prefix = record.service + " " + record.method + " ";
            String templatePath = operation.startsWith(prefix) && operation.contains("{")
                    ? operation.substring(prefix.length()).split("#", 2)[0] : normalized.substring(normalized.indexOf(' ') + 1);
            for (var slot : PathSlotCanonicalizer.slots(templatePath)) {
                if (!visit()) return;
                int i = slot.segment();
                if (i < original.length) {
                    if (omittedSensitivePath(String.join("/", java.util.Arrays.copyOf(original, i)))) continue;
                    if (omittedSensitivePath(slot.declaredName())) continue;
                    try {
                        String pathValue = decode(original[i].replace("+", "%2B"));
                        add(Location.PATH, slot.canonicalPath(), Shape.SCALAR, scalarType(pathValue), pathValue);
                    } catch (IllegalArgumentException ignored) { diagnostic("INVALID_ENCODING", 1); }
                }
            }
        }

        private void form(String text, Location location) {
            if (text == null || text.isEmpty()) return;
            int start = text.startsWith("?") ? 1 : 0;
            while (start <= text.length()) {
                if (!visit()) return;
                int end = text.indexOf('&', start);
                if (end < 0) end = text.length();
                String field = text.substring(start, end);
                int eq = field.indexOf('=');
                if (!field.isEmpty()) {
                    try {
                        String name = decode(eq < 0 ? field : field.substring(0, eq));
                        String value = decode(eq < 0 ? "" : field.substring(eq + 1));
                        add(location, "/" + pointer(name), Shape.SCALAR, scalarType(value), value);
                    } catch (IllegalArgumentException ignored) { diagnostic("INVALID_ENCODING", 1); }
                }
                if (end == text.length()) return;
                start = end + 1;
            }
        }

        private void json(String body) {
            final JsonNode root;
            try { root = JSON.readTree(body); }
            catch (StreamConstraintsException ignored) { diagnostic("JSON_LIMIT", 1); return; }
            catch (JsonParseException rejected) {
                // Jackson has no distinct duplicate-member exception type. Inspect only the fixed prefix;
                // never retain or emit its message, which can contain the rejected member name.
                String message = rejected.getOriginalMessage();
                diagnostic(message != null && message.startsWith("Duplicate field ")
                        ? "DUPLICATE_JSON_MEMBER" : "INVALID_JSON", 1);
                return;
            }
            catch (Exception ignored) { diagnostic("INVALID_JSON", 1); return; }
            if (root == null) return;
            boolean graphql = record.path.equalsIgnoreCase("/graphql");
            JsonNode start = graphql ? root.get("variables") : root;
            if (start == null) return;
            Location location = graphql ? Location.GRAPHQL_VARIABLE : Location.JSON_BODY;
            var stack = new ArrayDeque<JsonEntry>();
            stack.push(new JsonEntry(start, "", ""));
            while (!stack.isEmpty()) {
                if (!visit()) return;
                JsonEntry entry = stack.pop();
                String path = coordinateLimit ? "/" : entry.parent + entry.segment;
                if (omittedSensitivePath(path)) continue;
                JsonNode node = entry.node;
                Shape shape = node.isObject() ? Shape.OBJECT : node.isArray() ? Shape.ARRAY : node.isNull() ? Shape.NULL : Shape.SCALAR;
                if (!path.isEmpty()) add(location, path, shape, type(node), node.isContainerNode() ? null : scalar(node));
                if (node.isObject()) {
                    var children = new ArrayList<Map.Entry<String, JsonNode>>();
                    node.fields().forEachRemaining(children::add);
                    for (int i = children.size() - 1; i >= 0; i--) {
                        var child = children.get(i);
                        stack.push(new JsonEntry(child.getValue(), path, "/" + pointer(child.getKey())));
                    }
                } else if (node.isArray()) {
                    for (int i = node.size() - 1; i >= 0; i--) stack.push(new JsonEntry(node.get(i), path, "/*"));
                }
            }
        }

        private void multipart(String body) {
            var boundaryMatch = BOUNDARY.matcher(record.requestContentType == null ? "" : record.requestContentType);
            if (!boundaryMatch.find()) { diagnostic("INVALID_MULTIPART", 1); return; }
            String boundary = boundaryMatch.group(1) == null ? boundaryMatch.group(2) : boundaryMatch.group(1);
            String delimiter = "--" + boundary;
            int current = body.indexOf(delimiter);
            while (current >= 0) {
                if (!visit()) return;
                int start = current + delimiter.length();
                if (body.startsWith("--", start)) return;
                int next = body.indexOf("\r\n" + delimiter, start);
                if (next < 0) { diagnostic("INVALID_MULTIPART", 1); return; }
                String part = body.substring(start, next);
                int split = part.indexOf("\r\n\r\n");
                if (split >= 0) {
                    String headers = part.substring(0, split);
                    if (CONTINUED_HEADER.matcher(headers).find()) {
                        diagnostic("INVALID_MULTIPART", 1);
                        current = next + 2;
                        continue;
                    }
                    var partType = PART_TYPE.matcher(headers);
                    boolean textField = !partType.find() || partType.group(1).trim().toLowerCase(Locale.ROOT).startsWith("text/");
                    for (String header : headers.split("\r\n")) {
                        if (!header.toLowerCase(Locale.ROOT).startsWith("content-disposition:")) continue;
                        var name = NAME.matcher(header);
                        if (textField && !FILE.matcher(header).find() && name.find()) {
                            add(Location.MULTIPART_FIELD, "/" + pointer(name.group(1)), Shape.SCALAR, ValueType.STRING, part.substring(split + 4));
                        }
                    }
                }
                current = next + 2;
            }
        }

        private void xml(String body) {
            final Element root;
            try {
                var factory = DocumentBuilderFactory.newInstance();
                factory.setNamespaceAware(true);
                factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
                factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
                factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
                factory.setXIncludeAware(false);
                factory.setExpandEntityReferences(false);
                factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
                factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
                factory.setAttribute("http://www.oracle.com/xml/jaxp/properties/maxElementDepth", MAX_DEPTH);
                var builder = factory.newDocumentBuilder();
                builder.setErrorHandler(new DefaultHandler() {
                    @Override public void error(SAXParseException e) throws SAXParseException { throw e; }
                    @Override public void fatalError(SAXParseException e) throws SAXParseException { throw e; }
                });
                root = builder.parse(new InputSource(new StringReader(body))).getDocumentElement();
            } catch (Exception ignored) { diagnostic("INVALID_XML", 1); return; }
            if (omittedSensitivePath(xmlName(root))) return;
            var stack = new ArrayDeque<XmlEntry>();
            stack.push(new XmlEntry(root, "", ""));
            while (!stack.isEmpty()) {
                if (!visit()) return;
                XmlEntry entry = stack.pop();
                String path = coordinateLimit ? "/" : entry.parent + entry.segment;
                if (omittedSensitivePath(path)) continue;
                var children = new ArrayList<Element>();
                StringBuilder scalar = new StringBuilder();
                for (Node child = entry.node.getFirstChild(); child != null; child = child.getNextSibling()) {
                    if (child instanceof Element element) children.add(element);
                    else if (child.getNodeType() == Node.TEXT_NODE || child.getNodeType() == Node.CDATA_SECTION_NODE) scalar.append(child.getNodeValue());
                }
                if (!path.isEmpty()) add(Location.XML_PATH, path, children.isEmpty() ? Shape.SCALAR : Shape.OBJECT,
                        ValueType.STRING, children.isEmpty() ? scalar.toString() : null);
                var attributes = entry.node.getAttributes();
                for (int i = 0; i < attributes.getLength(); i++) {
                    if (!visit()) return;
                    Node attribute = attributes.item(i);
                    if (!XMLConstants.XMLNS_ATTRIBUTE_NS_URI.equals(attribute.getNamespaceURI()))
                        add(Location.XML_PATH, path + "/@" + pointer(xmlName(attribute)), Shape.SCALAR, ValueType.STRING, attribute.getNodeValue());
                }
                for (int i = children.size() - 1; i >= 0; i--) {
                    Element child = children.get(i);
                    stack.push(new XmlEntry(child, path, "/" + pointer(xmlName(child))));
                }
            }
        }

        private void add(Location location, String path, Shape shape, ValueType type, String scalar) {
            if (coordinateLimit || path.length() > MAX_COORDINATE_CHARS_PER_FIELD) {
                coordinateLimit = true;
                diagnostic("COORDINATE_LIMIT", 1);
                return;
            }
            if (omittedSensitivePath(path)) return;
            var key = new ParameterKey(record.service, record.method, operation, location, path);
            Values values = parameters.get(key);
            if (values == null) {
                if (parameters.size() >= MAX_PARAMETERS_PER_RECORD) { diagnostic("PARAMETER_LIMIT", 1); return; }
                int cost = record.service.length() + record.method.length() + operation.length() + location.name().length() + path.length();
                if (coordinateChars + cost > MAX_TOTAL_COORDINATE_CHARS) {
                    coordinateLimit = true;
                    diagnostic("COORDINATE_LIMIT", 1);
                    return;
                }
                coordinateChars += cost;
                values = new Values(location == Location.JSON_BODY || location == Location.GRAPHQL_VARIABLE);
                parameters.put(key, values);
            }
            values.add(shape, type, scalar);
        }

        private void diagnostic(String reason, int count) { diagnostics.merge(reason, count, Integer::sum); }

        private boolean omittedSensitivePath(String path) {
            if (!Masking.isSensitiveParameterPath(path)) return false;
            diagnostic("SENSITIVE_PARAMETER_OMITTED", 1);
            return true;
        }

        private ParameterExtraction result() {
            StringBuilder context = new StringBuilder("ctx:v1;").append(record.role).append(';').append(record.phase).append(';');
            parameters.entrySet().stream().sorted(Comparator.comparing(e -> e.getKey().stableKey())).forEach(e -> {
                String key = e.getKey().stableKey();
                Values v = e.getValue();
                context.append(key.length()).append(':').append(key).append(';').append(v.presence()).append(';')
                        .append(v.shape()).append(';').append(v.count).append(';');
            });
            String signature = "ctx:v1:" + digest(context.toString());
            List<ParameterObservation> observations = new ArrayList<>();
            parameters.forEach((key, values) -> observations.add(new ParameterObservation(key, record.evidenceId,
                    record.runId, record.source, record.idn, record.role, record.phase, values.presence(), values.shape(),
                    values.summary(), signature, Confidence.OBSERVED)));
            return new ParameterExtraction(observations, diagnostics.entrySet().stream()
                    .map(e -> new ParameterDiagnostic(operation, e.getKey(), e.getValue())).toList());
        }
    }

    private static final class Values {
        private final boolean nativeShapes;
        private int count;
        private Shape firstShape;
        private boolean mixedShapes;
        private ValueType type;
        private boolean allNull = true;
        private boolean container;
        private String firstScalar;
        private final StringBuilder sequence = new StringBuilder("[");

        private Values(boolean nativeShapes) { this.nativeShapes = nativeShapes; }

        private void add(Shape shape, ValueType nextType, String scalar) {
            if (count == 0) { firstShape = shape; type = nextType; firstScalar = scalar; }
            else {
                mixedShapes |= firstShape != shape;
                if (type != nextType) type = ValueType.UNKNOWN;
            }
            if (count > 0) sequence.append(',');
            if (scalar != null) sequence.append(nextType == ValueType.STRING ? quote(scalar) : scalar);
            else container = true;
            allNull &= shape == Shape.NULL;
            count++;
        }
        private Shape shape() {
            // A wildcard combines occurrences of an element coordinate, not a new array container.
            if (nativeShapes) return mixedShapes ? Shape.UNKNOWN : firstShape;
            return count > 1 ? Shape.ARRAY : firstShape;
        }
        private Presence presence() { return allNull ? Presence.EXPLICIT_NULL : Presence.PRESENT; }
        private ValueSummary summary() {
            if (container) return null;
            String canonical = count == 1 ? firstScalar : sequence + "]";
            byte[] utf8 = canonical.getBytes(StandardCharsets.UTF_8);
            String masked = Masking.maskSecrets(canonical);
            boolean sensitive = !canonical.equals(masked) || containsSensitiveValue(canonical);
            // Encoded nested secrets may not be changed by the ordinary text masker.
            if (sensitive && canonical.equals(masked)) masked = "***MASKED***";
            String preview = Masking.maskSecrets(masked.substring(0, Math.min(MAX_PREVIEW_CHARS, masked.length())));
            preview = preview.substring(0, Math.min(MAX_PREVIEW_CHARS, preview.length()));
            if (!isSafeMaskedPreview(preview)) preview = "***MASKED***";
            return new ValueSummary(type, utf8.length, sensitive ? null : digest(canonical), preview);
        }
    }

    /** Inspect the complete value, never only the preview; bounded decoding handles nested URL expressions. */
    public static boolean containsSensitiveValue(String value) {
        if (value == null) return false;
        return value.contains("***MASKED***") || value.contains("[BODY REDACTED:") || !isSafeMaskedPreview(value);
    }

    /** A masking marker never exempts the rest of the value from validation. */
    public static boolean isSafeMaskedPreview(String value) {
        if (value == null) return true;
        for (int pass = 0; pass < 8; pass++) {
            if (!value.equals(Masking.maskHeaders(value))) return false;
            if (value.indexOf('%') < 0) return true;
            try { value = decode(value); }
            catch (IllegalArgumentException malformed) { return false; }
        }
        return false; // Ambiguous deeper encodings cannot safely support a preview or digest.
    }

    // Siblings share the parent string; long prefixes are not multiplied in the work stack.
    private record JsonEntry(JsonNode node, String parent, String segment) {}
    private record XmlEntry(Element node, String parent, String segment) {}
    private static String pointer(String value) { return value.replace("~", "~0").replace("/", "~1").replace("*", "~2"); }
    private static String decode(String value) { return URLDecoder.decode(value, StandardCharsets.UTF_8); }
    private static ValueType type(JsonNode node) {
        if (node.isTextual()) return scalarType(node.textValue());
        if (node.isIntegralNumber()) return ValueType.INTEGER;
        if (node.isNumber()) return ValueType.NUMBER;
        if (node.isBoolean()) return ValueType.BOOLEAN;
        return ValueType.UNKNOWN;
    }

    /** 요청 값 문자열의 형식만 분류한다(응답 미참조). PATH/QUERY/FORM/JSON 문자열 스칼라에 공통 적용. */
    private static ValueType scalarType(String value) {
        if (value == null || value.isEmpty()) return ValueType.STRING;
        if (UUID.matcher(value).matches()) return ValueType.UUID;
        if (INTEGER.matcher(value).matches()) return ValueType.INTEGER;
        if (DECIMAL.matcher(value).matches()) return ValueType.NUMBER;
        if (value.equalsIgnoreCase("true") || value.equalsIgnoreCase("false")) return ValueType.BOOLEAN;
        return ValueType.STRING;
    }
    private static String scalar(JsonNode node) { return node.isTextual() ? node.textValue() : node.toString(); }
    private static String xmlName(Node node) {
        return node.getNamespaceURI() == null ? node.getNodeName() : "{" + node.getNamespaceURI() + "}" + node.getLocalName();
    }
    private static String quote(String value) {
        try { return JSON.writeValueAsString(value); }
        catch (Exception impossible) { throw new IllegalStateException("scalar encoding failed"); }
    }
    private static String digest(String value) {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
}
