package io.flowscope.core;

import io.flowscope.core.discovery.DiscoveredRoute;
import io.flowscope.core.discovery.HtmlRouteDiscoveryAdapter;
import io.flowscope.core.discovery.JavascriptRouteDiscoveryAdapter;
import io.flowscope.core.discovery.MetadataRouteDiscoveryAdapter;
import io.flowscope.core.discovery.OpenApiRouteDiscoveryAdapter;
import io.flowscope.core.discovery.RouteDiscoveryAdapter;
import io.flowscope.core.discovery.RouteDiscoveryDocument;
import io.flowscope.core.discovery.XmlRouteDiscoveryAdapter;

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
import java.util.regex.Pattern;

/** 저장된 exact-scope Evidence와 명시적 Burp Site Map seed만으로 route inventory를 만든다. */
public final class RouteCandidateExtractor {
    public record Seed(String url, String method, RouteCandidate.ProvenanceType provenanceType,
                       String evidenceId, Source source, String runId, String adapter) {
        public Seed(String url, String method, RouteCandidate.ProvenanceType provenanceType, String evidenceId) {
            this(url, method, provenanceType, evidenceId, Source.UNKNOWN, "burp-site-map", "burp-site-map");
        }

        public Seed {
            source = source == null ? Source.UNKNOWN : source;
            runId = runId == null || runId.isBlank() ? "burp-site-map" : runId;
            adapter = adapter == null || adapter.isBlank() ? "burp-site-map" : adapter;
        }
    }

    private record Mutable(String service, String method, String pathTemplate,
                           Set<RouteCandidate.Provenance> provenance, boolean observed,
                           RouteCandidate.Applicability applicability, String reviewReason) {}

    private static final List<RouteDiscoveryAdapter> ADAPTERS = List.of(
            new MetadataRouteDiscoveryAdapter(),
            new HtmlRouteDiscoveryAdapter(),
            new JavascriptRouteDiscoveryAdapter(),
            new OpenApiRouteDiscoveryAdapter(),
            new XmlRouteDiscoveryAdapter());
    private static final Set<String> STATE_CHANGING = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final Pattern METHOD_TOKEN = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}");
    private static final Pattern SCHEMA_PARAMETER = Pattern.compile("\\{[^/{}]+}");
    private static final int MAX_CANDIDATES = 20_000;

    private RouteCandidateExtractor() {}

    public static List<RouteCandidate> extract(List<RequestRecord> records, ScopePolicy scope, List<Seed> seeds) {
        Map<String, Mutable> candidates = new LinkedHashMap<>();
        List<RequestRecord> safeRecords = records == null ? List.of() : records;
        for (RequestRecord record : safeRecords) {
            if (!record.hasResponse || !scope.allows(record.service + record.path)) continue;
            if (record.trafficClassification.coverageEligible()) {
                addObserved(candidates, scope, record,
                        provenance(RouteCandidate.ProvenanceType.OBSERVED_REQUEST, record.evidenceId,
                                record.source, record.runId, "observed-request",
                                RouteCandidate.Applicability.APPLICABLE, "실제 request/response 관측"));
            }
            RouteDiscoveryDocument document = RouteDiscoveryDocument.from(record);
            for (RouteDiscoveryAdapter adapter : ADAPTERS) {
                if (!adapter.supports(document)) continue;
                List<DiscoveredRoute> discovered;
                try { discovered = adapter.discover(document); }
                catch (RuntimeException ignored) { continue; }
                for (DiscoveredRoute route : discovered) {
                    add(candidates, scope, resolve(document.baseUrl(), route.reference()), route.method(),
                            provenance(route.provenanceType(), document.evidenceId(), document.source(),
                                    document.runId(), route.adapter(), route.applicability(), route.reason()),
                            false, route.applicability(), route.reason());
                }
            }
        }
        for (Seed seed : seeds == null ? List.<Seed>of() : seeds) {
            add(candidates, scope, seed.url(), seed.method(),
                    provenance(seed.provenanceType(), seed.evidenceId(), seed.source(), seed.runId(), seed.adapter(),
                            RouteCandidate.Applicability.REVIEW, "Burp Site Map에서 응답 없는 항목"),
                    false, RouteCandidate.Applicability.REVIEW, "Burp Site Map에서 응답 없는 항목");
        }
        return prioritized(candidates.values().stream().map(RouteCandidateExtractor::freeze).toList());
    }

    private static String canonicalPath(RequestRecord record) {
        String prefix = record.service + " " + record.method + " ";
        if (record.op == null || !record.op.startsWith(prefix)) return record.path;
        String path = record.op.substring(prefix.length());
        int operationName = path.indexOf('#');
        return operationName < 0 ? path : path.substring(0, operationName);
    }

    private static void addObserved(Map<String, Mutable> out, ScopePolicy scope, RequestRecord record,
                                    RouteCandidate.Provenance provenance) {
        add(out, scope, record.service + record.path, record.method, provenance, true,
                RouteCandidate.Applicability.APPLICABLE, "실제 request/response 관측", canonicalPath(record));
    }

    public static List<RouteCandidate> prioritized(Collection<RouteCandidate> candidates) {
        Map<String, RouteCandidate> merged = new LinkedHashMap<>();
        for (RouteCandidate candidate : candidates == null ? List.<RouteCandidate>of() : candidates) {
            String key = candidate.service() + "\0" + candidate.method() + "\0" + candidate.pathTemplate();
            RouteCandidate current = merged.get(key);
            if (current == null) {
                merged.put(key, candidate);
                continue;
            }
            LinkedHashSet<RouteCandidate.Provenance> provenance = new LinkedHashSet<>(current.provenance());
            provenance.addAll(candidate.provenance());
            boolean observed = current.observed() || candidate.observed();
            RouteCandidate.Applicability applicability = observed
                    || current.applicability() == RouteCandidate.Applicability.APPLICABLE
                    || candidate.applicability() == RouteCandidate.Applicability.APPLICABLE
                    ? RouteCandidate.Applicability.APPLICABLE : RouteCandidate.Applicability.REVIEW;
            String reason = observed ? "실제 request/response 관측"
                    : current.applicability() != applicability ? candidate.reviewReason() : current.reviewReason();
            merged.put(key, new RouteCandidate(candidate.service(), candidate.method(), candidate.pathTemplate(),
                    observed, new ArrayList<>(provenance), applicability, reason));
        }
        return merged.values().stream().sorted(candidateOrder()).toList();
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

    private static void add(Map<String, Mutable> out, ScopePolicy scope, String rawUrl, String rawMethod,
                            RouteCandidate.Provenance provenance, boolean observed,
                            RouteCandidate.Applicability applicability, String reason) {
        add(out, scope, rawUrl, rawMethod, provenance, observed, applicability, reason, null);
    }

    private static void add(Map<String, Mutable> out, ScopePolicy scope, String rawUrl, String rawMethod,
                            RouteCandidate.Provenance provenance, boolean observed,
                            RouteCandidate.Applicability applicability, String reason, String explicitTemplate) {
        String method = normalizeMethod(rawMethod);
        String scopeUrl = rawUrl == null ? null : SCHEMA_PARAMETER.matcher(rawUrl).replaceAll("1");
        if (rawUrl == null || method == null || provenance == null || !scope.allows(scopeUrl)) return;
        try {
            URI uri = URI.create(rawUrl.replace("{", "%7B").replace("}", "%7D"));
            String service = service(uri);
            String path = uri.getPath() == null || uri.getPath().isBlank() ? "/" : uri.getPath();
            String template;
            if (explicitTemplate != null) {
                template = explicitTemplate;
            } else if (SCHEMA_PARAMETER.matcher(path).find()) {
                template = SCHEMA_PARAMETER.matcher(path).replaceAll("{id}");
            } else {
                String normalized = Normalizer.normalize(method.equals("UNKNOWN") ? "GET" : method, path).op;
                template = normalized.substring(normalized.indexOf(' ') + 1);
            }
            String key = service + "\0" + method + "\0" + template;
            Mutable current = out.get(key);
            if (current == null) {
                if (out.size() >= MAX_CANDIDATES) return;
                out.put(key, new Mutable(service, method, template,
                        new LinkedHashSet<>(Set.of(provenance)), observed, applicability, reason));
                return;
            }
            current.provenance().add(provenance);
            boolean nowObserved = current.observed() || observed;
            RouteCandidate.Applicability nowApplicable = nowObserved
                    || current.applicability() == RouteCandidate.Applicability.APPLICABLE
                    || applicability == RouteCandidate.Applicability.APPLICABLE
                    ? RouteCandidate.Applicability.APPLICABLE : RouteCandidate.Applicability.REVIEW;
            String nowReason = nowObserved ? "실제 request/response 관측"
                    : nowApplicable != current.applicability() ? reason : current.reviewReason();
            out.put(key, new Mutable(service, method, template, current.provenance(),
                    nowObserved, nowApplicable, nowReason));
        } catch (RuntimeException ignored) {
            // malformed/unsupported URL은 후보로 승격하지 않는다.
        }
    }

    private static String normalizeMethod(String value) {
        if (value == null || value.isBlank() || value.equalsIgnoreCase("UNKNOWN")) return "UNKNOWN";
        String method = value.trim().toUpperCase(Locale.ROOT);
        return METHOD_TOKEN.matcher(method).matches() ? method : null;
    }

    private static RouteCandidate.Provenance provenance(RouteCandidate.ProvenanceType type, String evidenceId,
                                                        Source source, String runId, String adapter,
                                                        RouteCandidate.Applicability applicability, String reason) {
        if (type == null || evidenceId == null || evidenceId.isBlank()) return null;
        return new RouteCandidate.Provenance(type, evidenceId, source, runId, adapter, applicability, reason);
    }

    private static String resolve(String base, String reference) {
        try {
            if (reference == null || reference.isBlank() || reference.startsWith("#")) return null;
            String lower = reference.stripLeading().toLowerCase(Locale.ROOT);
            if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("mailto:")
                    || lower.startsWith("tel:")) return null;
            String encoded = reference.trim().replace("{", "%7B").replace("}", "%7D");
            return URI.create(base).resolve(encoded).toString()
                    .replace("%7B", "{").replace("%7D", "}")
                    .replace("%7b", "{").replace("%7d", "}");
        } catch (RuntimeException ignored) { return null; }
    }

    private static RouteCandidate freeze(Mutable value) {
        return new RouteCandidate(value.service(), value.method(), value.pathTemplate(), value.observed(),
                new ArrayList<>(value.provenance()), value.applicability(), value.reviewReason());
    }

    private static String service(URI uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ((!scheme.equals("http") && !scheme.equals("https")) || uri.getHost() == null) {
            throw new IllegalArgumentException("unsupported route URI");
        }
        int port = uri.getPort() >= 0 ? uri.getPort() : scheme.equals("https") ? 443 : 80;
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }
}
