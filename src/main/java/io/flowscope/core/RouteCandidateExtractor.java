package io.flowscope.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 저장된 exact-scope Evidence와 명시적 Burp Site Map seed만으로 route inventory를 만든다. */
public final class RouteCandidateExtractor {
    public record Seed(String url, String method, RouteCandidate.ProvenanceType provenanceType,
                       String evidenceId) {}

    private record Mutable(String service, String method, String pathTemplate,
                           Set<RouteCandidate.ProvenanceType> types, Set<String> evidence,
                           boolean observed, RouteCandidate.Applicability applicability,
                           String reviewReason) {}

    private static final Pattern LINK = Pattern.compile("(?is)<a\\b[^>]+href\\s*=\\s*(['\"])(.*?)\\1");
    private static final Pattern LINK_TAG = Pattern.compile("(?is)<link\\b([^>]*)>");
    private static final Pattern REL = Pattern.compile("(?is)\\brel\\s*=\\s*(['\"])(.*?)\\1");
    private static final Pattern HREF = Pattern.compile("(?is)\\bhref\\s*=\\s*(['\"])(.*?)\\1");
    private static final Pattern FORM = Pattern.compile("(?is)<form\\b([^>]*)>");
    private static final Pattern ACTION = Pattern.compile("(?is)\\baction\\s*=\\s*(['\"])(.*?)\\1");
    private static final Pattern METHOD = Pattern.compile("(?is)\\bmethod\\s*=\\s*(['\"])(.*?)\\1");
    private static final Pattern FETCH = Pattern.compile("(?is)\\bfetch\\s*\\(\\s*(['\"])(.*?)\\1");
    private static final Pattern FETCH_METHOD = Pattern.compile(
            "(?is)\\bmethod\\s*:\\s*(['\"])(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\1");
    private static final Pattern AXIOS = Pattern.compile("(?is)\\baxios\\.(get|post|put|patch|delete)\\s*\\(\\s*(['\"])(.*?)\\2");
    private static final Pattern XHR = Pattern.compile("(?is)\\.open\\s*\\(\\s*(['\"])(GET|POST|PUT|PATCH|DELETE)\\1\\s*,\\s*(['\"])(.*?)\\3");
    private static final Pattern LOC = Pattern.compile("(?is)<loc>\\s*(.*?)\\s*</loc>");
    private static final Pattern MANIFEST_URL = Pattern.compile("(?is)[\"'](?:start_url|scope)[\"']\\s*:\\s*([\"'])(.*?)\\1");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> STATE_CHANGING = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final int MAX_CANDIDATES = 20_000;

    private RouteCandidateExtractor() {}

    public static List<RouteCandidate> extract(List<RequestRecord> records, ScopePolicy scope, List<Seed> seeds) {
        Map<String, Mutable> candidates = new LinkedHashMap<>();
        List<RequestRecord> safeRecords = records == null ? List.of() : records;
        for (RequestRecord record : safeRecords) {
            if (!record.hasResponse || !scope.allows(record.service + record.path)) continue;
            if (record.trafficClassification.coverageEligible()) {
                add(candidates, scope, record.service + record.path, record.method,
                        RouteCandidate.ProvenanceType.OBSERVED_REQUEST, record.evidenceId, true,
                        RouteCandidate.Applicability.APPLICABLE, "실제 request/response 관측");
            }
        }
        for (RequestRecord record : safeRecords) {
            if (!record.hasResponse || !scope.allows(record.service + record.path)) continue;
            extractFromRecord(candidates, scope, record);
        }
        for (Seed seed : seeds == null ? List.<Seed>of() : seeds) {
            add(candidates, scope, seed.url(), seed.method(), seed.provenanceType(), seed.evidenceId(),
                    false, RouteCandidate.Applicability.REVIEW, "Burp Site Map에서 응답 없는 항목");
        }
        Set<String> observedPaths = candidates.values().stream().filter(Mutable::observed)
                .map(value -> value.service() + "\0" + value.pathTemplate())
                .collect(java.util.stream.Collectors.toSet());
        candidates.replaceAll((key, value) -> value.method().equals("UNKNOWN")
                && observedPaths.contains(value.service() + "\0" + value.pathTemplate())
                ? new Mutable(value.service(), value.method(), value.pathTemplate(), value.types(), value.evidence(),
                true, RouteCandidate.Applicability.APPLICABLE, "같은 path의 실제 request/response 관측") : value);
        return prioritized(candidates.values().stream().map(RouteCandidateExtractor::freeze).toList());
    }

    public static List<RouteCandidate> prioritized(Collection<RouteCandidate> candidates) {
        return candidates.stream().sorted(candidateOrder()).toList();
    }

    /** 수치 confidence 대신 사용자가 확인할 수 있는 범주형 정렬 근거를 반환한다. */
    public static List<String> priorityReasons(RouteCandidate candidate) {
        List<String> reasons = new ArrayList<>();
        reasons.add(candidate.observed() ? "OBSERVED" : candidate.applicability().name());
        if (!candidate.method().equals("UNKNOWN")) reasons.add("METHOD_EXPLICIT");
        if (candidate.pathTemplate().contains("{id}")) reasons.add("OBJECT_TEMPLATE");
        if (STATE_CHANGING.contains(candidate.method())) reasons.add("STATE_CHANGING");
        if (candidate.provenanceTypes().size() > 1) reasons.add("MULTIPLE_PROVENANCE");
        return List.copyOf(reasons);
    }

    private static Comparator<RouteCandidate> candidateOrder() {
        return Comparator.comparing(RouteCandidate::observed).reversed()
                .thenComparing(candidate -> candidate.applicability() != RouteCandidate.Applicability.APPLICABLE)
                .thenComparing(candidate -> candidate.method().equals("UNKNOWN"))
                .thenComparing(candidate -> !candidate.pathTemplate().contains("{id}"))
                .thenComparing(candidate -> !STATE_CHANGING.contains(candidate.method()))
                .thenComparing(Comparator.comparingInt(
                        (RouteCandidate candidate) -> candidate.provenanceTypes().size()).reversed())
                .thenComparing(RouteCandidate::service)
                .thenComparing(RouteCandidate::pathTemplate)
                .thenComparing(RouteCandidate::method);
    }

    private static void extractFromRecord(Map<String, Mutable> out, ScopePolicy scope, RequestRecord record) {
        String evidence = record.evidenceId;
        if (record.location != null) add(out, scope, resolve(record, record.location), "UNKNOWN",
                RouteCandidate.ProvenanceType.LOCATION, evidence, false,
                RouteCandidate.Applicability.REVIEW, "Location은 method를 증명하지 않음");
        String body = record.body == null ? "" : record.body;
        String mime = mediaType(record.responseContentType);
        if (mime.equals("text/html")) {
            Matcher links = LINK.matcher(body);
            while (links.find()) add(out, scope, resolve(record, links.group(2)), "UNKNOWN",
                    RouteCandidate.ProvenanceType.HTML_LINK, evidence, false,
                    RouteCandidate.Applicability.REVIEW, "HTML 링크는 method를 증명하지 않음");
            Matcher linkTags = LINK_TAG.matcher(body);
            while (linkTags.find()) {
                Matcher rel = REL.matcher(linkTags.group(1));
                Matcher href = HREF.matcher(linkTags.group(1));
                if (rel.find() && containsToken(rel.group(2), "manifest") && href.find()) {
                    add(out, scope, resolve(record, href.group(2)), "UNKNOWN",
                            RouteCandidate.ProvenanceType.WEB_MANIFEST, evidence, false,
                            RouteCandidate.Applicability.REVIEW, "manifest link는 method를 증명하지 않음");
                }
            }
            Matcher forms = FORM.matcher(body);
            while (forms.find()) {
                Matcher action = ACTION.matcher(forms.group(1));
                if (!action.find()) continue;
                Matcher method = METHOD.matcher(forms.group(1));
                String verb = method.find() ? method.group(2).toUpperCase(Locale.ROOT) : "GET";
                add(out, scope, resolve(record, action.group(2)), verb,
                        RouteCandidate.ProvenanceType.HTML_FORM, evidence, false,
                        RouteCandidate.Applicability.APPLICABLE, "HTML form action/method");
            }
        }
        if (mime.contains("javascript") || record.path.endsWith(".js")) extractJavascript(out, scope, record, body);
        if (mime.equals("text/plain") && record.path.endsWith("robots.txt")) {
            for (String line : body.split("\\R")) {
                String[] pair = line.split(":", 2);
                if (pair.length == 2 && Set.of("allow", "disallow", "sitemap")
                        .contains(pair[0].trim().toLowerCase(Locale.ROOT))) {
                    add(out, scope, resolve(record, pair[1].trim()), "UNKNOWN",
                            RouteCandidate.ProvenanceType.ROBOTS_OR_SITEMAP, evidence, false,
                            RouteCandidate.Applicability.REVIEW, "robots/sitemap 참조는 method를 증명하지 않음");
                }
            }
        }
        if (mime.contains("xml") || record.path.endsWith("sitemap.xml")) {
            Matcher locs = LOC.matcher(body);
            while (locs.find()) add(out, scope, resolve(record, locs.group(1)), "UNKNOWN",
                    RouteCandidate.ProvenanceType.ROBOTS_OR_SITEMAP, evidence, false,
                    RouteCandidate.Applicability.REVIEW, "sitemap URL은 method를 증명하지 않음");
        }
        if (mime.equals("application/manifest+json") || record.path.endsWith(".webmanifest")) {
            Matcher urls = MANIFEST_URL.matcher(body);
            while (urls.find()) add(out, scope, resolve(record, urls.group(2)), "UNKNOWN",
                    RouteCandidate.ProvenanceType.WEB_MANIFEST, evidence, false,
                    RouteCandidate.Applicability.REVIEW, "manifest URL은 method를 증명하지 않음");
        }
        extractOpenApi(out, scope, record, body);
    }

    private static void extractJavascript(Map<String, Mutable> out, ScopePolicy scope,
                                          RequestRecord record, String body) {
        Matcher fetch = FETCH.matcher(body);
        while (fetch.find()) if (!concatenated(body, fetch.end())) {
            String method = fetchMethod(body, fetch.end());
            add(out, scope, resolve(record, fetch.group(2)), method,
                    RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, record.evidenceId, false,
                    RouteCandidate.Applicability.REVIEW, method.equals("UNKNOWN")
                            ? "fetch literal; method를 정적으로 확인할 수 없음"
                            : "fetch literal의 명시/default method");
        }
        Matcher axios = AXIOS.matcher(body);
        while (axios.find()) if (!concatenated(body, axios.end())) add(out, scope, resolve(record, axios.group(3)),
                axios.group(1).toUpperCase(Locale.ROOT), RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL,
                record.evidenceId, false, RouteCandidate.Applicability.REVIEW, "JavaScript literal; 실행 여부 미관측");
        Matcher xhr = XHR.matcher(body);
        while (xhr.find()) if (!concatenated(body, xhr.end())) add(out, scope, resolve(record, xhr.group(4)),
                xhr.group(2).toUpperCase(Locale.ROOT), RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL,
                record.evidenceId, false, RouteCandidate.Applicability.REVIEW, "JavaScript literal; 실행 여부 미관측");
    }

    private static void extractOpenApi(Map<String, Mutable> out, ScopePolicy scope,
                                       RequestRecord record, String body) {
        if (body.isBlank() || !(body.contains("\"openapi\"") || body.contains("\"swagger\""))) return;
        try {
            JsonNode paths = JSON.readTree(body).path("paths");
            if (!paths.isObject()) return;
            paths.properties().forEach(path -> path.getValue().properties().forEach(operation -> {
                String method = operation.getKey().toUpperCase(Locale.ROOT);
                if (!Set.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD").contains(method)) return;
                add(out, scope, resolve(record, path.getKey()), method, RouteCandidate.ProvenanceType.OPENAPI,
                        record.evidenceId, false, RouteCandidate.Applicability.APPLICABLE,
                        "대상 내부에서 관측한 OpenAPI paths");
            }));
        } catch (Exception ignored) {
            // 파싱 불가 문서는 후보를 꾸며내지 않는다. 원 Evidence는 그대로 남는다.
        }
    }

    private static boolean concatenated(String body, int end) {
        int cursor = end;
        while (cursor < body.length() && Character.isWhitespace(body.charAt(cursor))) cursor++;
        return cursor < body.length() && body.charAt(cursor) == '+';
    }

    private static String fetchMethod(String body, int end) {
        int cursor = end;
        while (cursor < body.length() && Character.isWhitespace(body.charAt(cursor))) cursor++;
        if (cursor < body.length() && body.charAt(cursor) == ')') return "GET";
        int close = body.indexOf(')', cursor);
        if (close < 0 || close - cursor > 512) return "UNKNOWN";
        Matcher method = FETCH_METHOD.matcher(body.substring(cursor, close));
        return method.find() ? method.group(2).toUpperCase(Locale.ROOT) : "UNKNOWN";
    }

    private static boolean containsToken(String value, String token) {
        for (String part : value.trim().split("\\s+")) if (part.equalsIgnoreCase(token)) return true;
        return false;
    }

    private static String resolve(RequestRecord record, String reference) {
        try {
            if (reference == null || reference.isBlank() || reference.startsWith("#")
                    || reference.toLowerCase(Locale.ROOT).startsWith("javascript:")) return null;
            URI base = URI.create(record.service + record.path);
            return base.resolve(reference.trim()).toString();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static void add(Map<String, Mutable> out, ScopePolicy scope, String rawUrl, String method,
                            RouteCandidate.ProvenanceType type, String evidenceId, boolean observed,
                            RouteCandidate.Applicability applicability, String reason) {
        if (rawUrl == null || evidenceId == null || evidenceId.isBlank() || !scope.allows(rawUrl)) return;
        try {
            URI uri = URI.create(rawUrl);
            String service = service(uri);
            String verb = method == null || method.isBlank() ? "UNKNOWN" : method.toUpperCase(Locale.ROOT);
            String template = Normalizer.normalize(verb.equals("UNKNOWN") ? "GET" : verb,
                    uri.getPath() == null || uri.getPath().isBlank() ? "/" : uri.getPath()).op;
            template = template.substring(template.indexOf(' ') + 1);
            String key = service + "\0" + verb + "\0" + template;
            Mutable current = out.get(key);
            if (current == null) {
                if (out.size() >= MAX_CANDIDATES) return;
                out.put(key, new Mutable(service, verb, template, new LinkedHashSet<>(Set.of(type)),
                        new LinkedHashSet<>(Set.of(evidenceId)), observed, applicability, reason));
            } else {
                current.types().add(type);
                current.evidence().add(evidenceId);
                if (observed && !current.observed()) out.put(key, new Mutable(service, verb, template,
                        current.types(), current.evidence(), true, RouteCandidate.Applicability.APPLICABLE,
                        "실제 request/response 관측"));
            }
        } catch (RuntimeException ignored) {
            // malformed URL은 후보로 승격하지 않는다.
        }
    }

    private static RouteCandidate freeze(Mutable value) {
        return new RouteCandidate(value.service(), value.method(), value.pathTemplate(), value.observed(),
                value.types(), new ArrayList<>(value.evidence()), value.applicability(), value.reviewReason());
    }

    private static String service(URI uri) {
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }

    private static String mediaType(String value) {
        if (value == null) return "";
        String lower = value.toLowerCase(Locale.ROOT).trim();
        int semicolon = lower.indexOf(';');
        return semicolon < 0 ? lower : lower.substring(0, semicolon).trim();
    }
}
