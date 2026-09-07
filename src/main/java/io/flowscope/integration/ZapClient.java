package io.flowscope.integration;

import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 로컬 OWASP ZAP daemon API 어댑터. 대상 트래픽은 별도 Burp 리스너를 통과시켜야 한다. */
public final class ZapClient {
    private final URI baseUri;
    private final String apiKey;
    private final HttpClient client;

    public ZapClient(String baseUrl, String apiKey) {
        this.baseUri = URI.create(baseUrl == null || baseUrl.isBlank() ? "http://127.0.0.1:8089" : baseUrl);
        this.apiKey = apiKey == null ? "" : apiKey;
        validateLoopback(baseUri);
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    public String endpoint() { return baseUri.toString(); }
    public boolean apiKeyConfigured() { return !apiKey.isBlank(); }
    public String version() { return get("/JSON/core/view/version/", ""); }
    public String probeVersion() { return get("/JSON/core/view/version/", "", Duration.ofSeconds(3)); }
    public String newSession(String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("ZAP session name is required");
        return get("/JSON/core/action/newSession/", "name=" + enc(name) + "&overwrite=true");
    }
    public String newContext(String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("ZAP context name is required");
        return get("/JSON/context/action/newContext/", "contextName=" + enc(name));
    }
    public String includeInContext(String name, String regex) {
        if (name == null || name.isBlank() || regex == null || regex.isBlank()) {
            throw new IllegalArgumentException("ZAP context name and include regex are required");
        }
        return get("/JSON/context/action/includeInContext/",
                "contextName=" + enc(name) + "&regex=" + enc(regex));
    }
    public String setContextInScope(String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("ZAP context name is required");
        return get("/JSON/context/action/setContextInScope/",
                "contextName=" + enc(name) + "&booleanInScope=true");
    }
    public String addRequestHeaderRule(String description, String urlRegex,
                                       String headerName, String replacement) {
        if (description == null || description.isBlank() || urlRegex == null || urlRegex.isBlank()
                || headerName == null || headerName.isBlank() || replacement == null || replacement.isBlank()) {
            throw new IllegalArgumentException("ZAP Replacer capability rule fields are required");
        }
        return get("/JSON/replacer/action/addRule/", "description=" + enc(description)
                + "&enabled=true&matchType=REQ_HEADER&matchRegex=false&matchString=" + enc(headerName)
                + "&replacement=" + enc(replacement) + "&url=" + enc(urlRegex));
    }
    public String removeReplacerRule(String description) {
        if (description == null || description.isBlank()) {
            throw new IllegalArgumentException("ZAP Replacer rule description is required");
        }
        return get("/JSON/replacer/action/removeRule/", "description=" + enc(description));
    }
    public String spider(String target) {
        return get("/JSON/spider/action/scan/", "url=" + enc(target) + "&recurse=true&subtreeOnly=true");
    }
    public String ajaxSpider(String target) {
        return ajaxSpider(target, "");
    }
    public String ajaxSpider(String target, String contextName) {
        String query = "url=" + enc(target) + "&inScope=true&subtreeOnly=true";
        if (contextName != null && !contextName.isBlank()) query += "&contextName=" + enc(contextName);
        return get("/JSON/ajaxSpider/action/scan/", query);
    }
    public String clientSpider(String target) {
        return clientSpider(target, "");
    }
    public String clientSpider(String target, String contextName) {
        String query = "url=" + enc(target) + "&subtreeOnly=true&scopeCheck=STRICT";
        if (contextName != null && !contextName.isBlank()) query += "&contextName=" + enc(contextName);
        return get("/JSON/clientSpider/action/scan/", query);
    }
    public String spiderStatus(String scanId) {
        return get("/JSON/spider/view/status/", "scanId=" + enc(scanId));
    }
    public String ajaxSpiderStatus() { return get("/JSON/ajaxSpider/view/status/", ""); }
    public String clientSpiderStatus(String scanId) {
        return get("/JSON/clientSpider/view/status/", "scanId=" + enc(scanId));
    }
    public String stopSpider(String scanId) {
        return get("/JSON/spider/action/stop/", "scanId=" + enc(scanId));
    }
    public String stopClientSpider(String scanId) {
        return get("/JSON/clientSpider/action/stop/", "scanId=" + enc(scanId));
    }
    public String stopAjaxSpider() { return get("/JSON/ajaxSpider/action/stop/", ""); }
    public String passiveRecordsToScan() { return get("/JSON/pscan/view/recordsToScan/", ""); }
    public String passiveTasks() { return get("/JSON/pscan/view/currentTasks/", ""); }
    public String clearPassiveQueue() { return get("/JSON/pscan/action/clearQueue/", ""); }
    public String passiveScanners() { return get("/JSON/pscan/view/scanners/", ""); }
    public String enablePassiveScan() {
        return get("/JSON/pscan/action/setEnabled/", "enabled=true");
    }
    public String enableAllPassiveScanners() {
        return get("/JSON/pscan/action/enableAllScanners/", "");
    }
    public String restrictPassiveScanToScope() {
        return get("/JSON/pscan/action/setScanOnlyInScope/", "onlyInScope=true");
    }
    public String alerts(String baseUrl, int start, int count) {
        String query = "start=" + Math.max(0, start) + "&count=" + Math.max(1, Math.min(500, count));
        if (baseUrl != null && !baseUrl.isBlank()) query = "baseurl=" + enc(baseUrl) + "&" + query;
        return get("/JSON/alert/view/alerts/", query);
    }
    public String numberOfAlerts(String baseUrl) {
        String query = baseUrl == null || baseUrl.isBlank() ? "" : "baseurl=" + enc(baseUrl);
        return get("/JSON/alert/view/numberOfAlerts/", query);
    }
    public String installedAddons() { return get("/JSON/autoupdate/view/installedAddons/", ""); }
    public String httpProxyEnabled() { return get("/JSON/network/view/isHttpProxyEnabled/", ""); }
    public String httpProxy() { return get("/JSON/network/view/getHttpProxy/", ""); }
    public String importOpenApi(String definitionUrl, String hostOverride, String contextId, int maxMessages) {
        return get("/JSON/openapi/action/importUrl/", "url=" + enc(definitionUrl)
                + "&hostOverride=" + enc(hostOverride) + "&contextId=" + enc(contextId)
                + "&maxMessages=" + boundedMessages(maxMessages), Duration.ofMinutes(2));
    }
    public String importPostman(String definitionUrl, int maxMessages) {
        return get("/JSON/postman/action/importUrl/", "url=" + enc(definitionUrl)
                + "&maxMessages=" + boundedMessages(maxMessages), Duration.ofMinutes(2));
    }
    public String importSoap(String definitionUrl, int maxMessages) {
        return get("/JSON/soap/action/importUrl/", "url=" + enc(definitionUrl)
                + "&maxMessages=" + boundedMessages(maxMessages), Duration.ofMinutes(2));
    }
    public String importGraphQl(String endpointUrl, String schemaUrl, int maxMessages) {
        String query = "endurl=" + enc(endpointUrl) + "&url=" + enc(schemaUrl == null ? "" : schemaUrl)
                + "&maxMessages=" + boundedMessages(maxMessages);
        return get("/JSON/graphql/action/importUrl/", query, Duration.ofMinutes(2));
    }

    /**
     * 여러 exact-scope 항목을 한 규칙으로 덮는 union regex. Burp 8081이 스캐너 레인의 모든 요청에 capability
     * 헤더를 요구하므로, ZAP이 target 하위뿐 아니라 모든 in-scope 항목 요청에 헤더를 붙이도록 만든다.
     * 항목이 하나면 단일 target 버전과 완전히 동일한 regex를 돌려준다(기존 동작 불변).
     */
    public static String exactSubtreeRegex(java.util.Collection<String> targets) {
        if (targets == null || targets.isEmpty()) {
            throw new IllegalArgumentException("at least one ZAP context target is required");
        }
        java.util.LinkedHashSet<String> perTarget = new java.util.LinkedHashSet<>();
        for (String target : targets) {
            if (target != null && !target.isBlank()) perTarget.add(exactSubtreeRegex(target));
        }
        if (perTarget.isEmpty()) throw new IllegalArgumentException("at least one valid ZAP context target is required");
        if (perTarget.size() == 1) return perTarget.iterator().next();
        return perTarget.stream().map(regex -> "(?:" + regex + ")")
                .reduce((left, right) -> left + "|" + right).orElseThrow();
    }

    public static String exactSubtreeRegex(String target) {
        URI uri = URI.create(target);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
        if ((!"http".equals(scheme) && !"https".equals(scheme)) || host.isBlank()) {
            throw new IllegalArgumentException("ZAP context target must be an HTTP(S) URL");
        }
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        String displayHost = host.indexOf(':') >= 0 ? "[" + host + "]" : host;
        StringBuilder regex = new StringBuilder("^")
                .append("(?i:").append(java.util.regex.Pattern.quote(scheme + "://" + displayHost)).append(')');
        int defaultPort = "https".equals(scheme) ? 443 : 80;
        if (uri.getPort() >= 0 && uri.getPort() != defaultPort) {
            regex.append(java.util.regex.Pattern.quote(":" + uri.getPort()));
        } else {
            regex.append("(?::").append(defaultPort).append(")?");
        }
        String path = uri.getRawPath();
        if (path == null || path.isBlank() || "/".equals(path)) regex.append("(?:/.*)?");
        else {
            String prefix = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
            regex.append(java.util.regex.Pattern.quote(prefix)).append("(?:/.*)?");
        }
        return regex.append("(?:\\?.*)?$").toString();
    }

    private String get(String path, String query) {
        return get(path, query, Duration.ofSeconds(20));
    }

    private String get(String path, String query, Duration timeout) {
        StringBuilder q = new StringBuilder(query == null ? "" : query);
        URI uri = baseUri.resolve(path + (q.isEmpty() ? "" : "?" + q));
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(timeout).GET();
        if (!apiKey.isBlank()) builder.header("X-ZAP-API-Key", apiKey);
        HttpRequest request = builder.build();
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String detail = io.flowscope.core.Masking.truncate(
                        io.flowscope.core.Masking.maskSecrets(response.body()), 512);
                throw new IllegalStateException("ZAP API HTTP " + response.statusCode()
                        + (detail == null || detail.isBlank() ? "" : ": " + detail));
            }
            return response.body();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("ZAP API 호출 중단", e);
        } catch (IOException e) {
            throw new IllegalStateException("ZAP API 통신 실패: " + e.getMessage(), e);
        }
    }

    private static void validateLoopback(URI uri) {
        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("ZAP API는 HTTP(S)만 지원합니다");
        }
        try {
            if (uri.getHost() == null || !InetAddress.getByName(uri.getHost()).isLoopbackAddress()) {
                throw new IllegalArgumentException("ZAP API는 localhost에서만 연결할 수 있습니다");
            }
        } catch (java.net.UnknownHostException e) {
            throw new IllegalArgumentException("ZAP API 호스트를 확인할 수 없습니다", e);
        }
    }

    private static String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static int boundedMessages(int value) { return Math.max(1, Math.min(1_000, value)); }
}
