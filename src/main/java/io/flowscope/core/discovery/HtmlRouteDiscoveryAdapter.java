package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 실제 브라우저와 가까운 HTML5 DOM 파싱으로 link/form/embed를 추출한다. */
public final class HtmlRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final Pattern REFRESH_URL = Pattern.compile("(?i)(?:^|;)\\s*url\\s*=\\s*['\"]?([^'\";]+)");

    @Override public String id() { return "html-dom"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        String body = document.body().stripLeading().toLowerCase(Locale.ROOT);
        return document.mediaType().equals("text/html") || document.mediaType().equals("application/xhtml+xml")
                || body.startsWith("<!doctype html") || body.startsWith("<html")
                || body.startsWith("<form") || body.startsWith("<a ");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument input) {
        Document document = Jsoup.parse(input.body(), input.baseUrl());
        List<DiscoveredRoute> routes = new ArrayList<>();
        for (Element element : document.select("a[href], area[href]")) {
            add(routes, reference(element, "href"), "UNKNOWN", RouteCandidate.ProvenanceType.HTML_LINK,
                    RouteCandidate.Applicability.REVIEW, "HTML navigation은 method를 증명하지 않음");
        }
        for (Element element : document.select("link[href]")) {
            String rel = element.attr("rel");
            if (tokens(rel).contains("manifest")) {
                add(routes, reference(element, "href"), "UNKNOWN", RouteCandidate.ProvenanceType.WEB_MANIFEST,
                        RouteCandidate.Applicability.REVIEW, "manifest link는 method를 증명하지 않음");
            } else if (tokens(rel).contains("modulepreload")) {
                add(routes, reference(element, "href"), "GET", RouteCandidate.ProvenanceType.HTML_SCRIPT,
                        RouteCandidate.Applicability.REVIEW, "HTML modulepreload script 참조");
            }
        }
        for (Element element : document.select("script[src]")) {
            add(routes, reference(element, "src"), "GET", RouteCandidate.ProvenanceType.HTML_SCRIPT,
                    RouteCandidate.Applicability.REVIEW, "HTML script src 참조");
        }
        for (Element element : document.select("iframe[src], frame[src]")) {
            add(routes, reference(element, "src"), "UNKNOWN", RouteCandidate.ProvenanceType.HTML_EMBED,
                    RouteCandidate.Applicability.REVIEW, "HTML embedded navigation은 method를 증명하지 않음");
        }
        for (Element form : document.select("form")) {
            String action = form.hasAttr("action") ? reference(form, "action") : input.baseUrl();
            String method = form.attr("method").isBlank() ? "GET" : form.attr("method");
            add(routes, action, method, RouteCandidate.ProvenanceType.HTML_FORM,
                    RouteCandidate.Applicability.APPLICABLE, "HTML form action/method");
        }
        for (Element control : document.select("button[formaction], input[formaction]")) {
            String method = control.attr("formmethod");
            if (method.isBlank() && control.closest("form") != null) method = control.closest("form").attr("method");
            add(routes, reference(control, "formaction"), method.isBlank() ? "GET" : method,
                    RouteCandidate.ProvenanceType.HTML_FORM, RouteCandidate.Applicability.APPLICABLE,
                    "HTML form control action/method");
        }
        for (Element meta : document.select("meta[http-equiv=refresh][content]")) {
            Matcher matcher = REFRESH_URL.matcher(meta.attr("content"));
            if (matcher.find()) add(routes, resolve(document, matcher.group(1).trim()), "UNKNOWN",
                    RouteCandidate.ProvenanceType.HTML_LINK, RouteCandidate.Applicability.REVIEW,
                    "HTML refresh는 method를 증명하지 않음");
        }
        for (Element script : document.select("script:not([src])")) {
            for (DiscoveredRoute route : JavascriptRouteDiscoveryAdapter.discoverScript(script.data(), id())) {
                routes.add(new DiscoveredRoute(resolve(document, route.reference()), route.method(),
                        route.provenanceType(), route.applicability(), route.reason(), route.adapter()));
            }
        }
        return List.copyOf(routes);
    }

    private String reference(Element element, String attribute) {
        String absolute = element.absUrl(attribute);
        return absolute.isBlank() ? element.attr(attribute) : absolute;
    }

    private static String resolve(Document document, String reference) {
        try {
            Element base = document.selectFirst("base[href]");
            String baseUrl = base == null ? document.baseUri() : base.absUrl("href");
            return URI.create(baseUrl).resolve(reference).toString();
        } catch (RuntimeException ignored) { return reference; }
    }

    private void add(List<DiscoveredRoute> routes, String reference, String method,
                     RouteCandidate.ProvenanceType type, RouteCandidate.Applicability applicability, String reason) {
        if (reference == null || reference.isBlank()) return;
        routes.add(new DiscoveredRoute(reference.trim(), method, type, applicability, reason, id()));
    }

    private static java.util.Set<String> tokens(String value) {
        java.util.Set<String> values = new java.util.HashSet<>();
        for (String token : value.toLowerCase(Locale.ROOT).trim().split("\\s+")) if (!token.isBlank()) values.add(token);
        return values;
    }
}
