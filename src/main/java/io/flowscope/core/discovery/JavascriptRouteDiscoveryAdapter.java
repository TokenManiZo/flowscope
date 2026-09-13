package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;

import java.util.List;
import java.util.Locale;

/** 실행 없이 JavaScript AST의 직접 확인 가능한 HTTP call-site를 route 후보로 바꾼다. */
public final class JavascriptRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    @Override public String id() { return "javascript-ast"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        String path = document.path().toLowerCase(Locale.ROOT);
        return document.mediaType().contains("javascript") || path.endsWith(".js") || path.endsWith(".mjs");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument document) {
        return discoverScript(document.body(), id());
    }

    static List<DiscoveredRoute> discoverScript(String script, String adapterId) {
        JavascriptAnalysis analysis = JavascriptCallSiteAnalyzer.analyze(script);
        java.util.ArrayList<DiscoveredRoute> routes = new java.util.ArrayList<>();
        analysis.callSites().stream()
                .map(call -> new DiscoveredRoute(call.reference(), call.method(),
                        RouteCandidate.ProvenanceType.JAVASCRIPT_LITERAL, RouteCandidate.Applicability.REVIEW,
                        call.reason() + " @" + call.line() + ":" + call.column(), adapterId))
                .forEach(routes::add);
        analysis.assets().stream()
                .map(asset -> new DiscoveredRoute(asset.reference(), "GET",
                        RouteCandidate.ProvenanceType.SCRIPT_DEPENDENCY, RouteCandidate.Applicability.REVIEW,
                        asset.reason() + " @" + asset.line() + ":" + asset.column(), adapterId))
                .forEach(routes::add);
        return List.copyOf(routes);
    }
}
