package io.flowscope.integration;

import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
    public String spider(String target) {
        return get("/JSON/spider/action/scan/", "url=" + enc(target) + "&recurse=true&subtreeOnly=true");
    }
    public String activeScan(String target) {
        return get("/JSON/ascan/action/scan/", "url=" + enc(target) + "&recurse=true&inScopeOnly=true");
    }
    public String ajaxSpider(String target) {
        return get("/JSON/ajaxSpider/action/scan/", "url=" + enc(target));
    }
    public String clientSpider(String target) {
        return get("/JSON/clientSpider/action/scan/", "url=" + enc(target)
                + "&subtreeOnly=true&scopeCheck=STRICT");
    }
    public String spiderStatus(String scanId) {
        return get("/JSON/spider/view/status/", "scanId=" + enc(scanId));
    }
    public String activeScanStatus(String scanId) {
        return get("/JSON/ascan/view/status/", "scanId=" + enc(scanId));
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

    public static String exactSubtreeRegex(String target) {
        URI uri = URI.create(target);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
        if ((!"http".equals(scheme) && !"https".equals(scheme)) || host.isBlank()) {
            throw new IllegalArgumentException("ZAP context target must be an HTTP(S) URL");
        }
        String displayHost = host.indexOf(':') >= 0 ? "[" + host + "]" : host;
        StringBuilder regex = new StringBuilder("^")
                .append("(?i:").append(java.util.regex.Pattern.quote(scheme + "://" + displayHost)).append(')');
        if (uri.getPort() >= 0) regex.append(java.util.regex.Pattern.quote(":" + uri.getPort()));
        else regex.append("(?::").append("https".equals(scheme) ? 443 : 80).append(")?");
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
        if (!apiKey.isBlank()) {
            if (!q.isEmpty()) q.append('&');
            q.append("apikey=").append(enc(apiKey));
        }
        URI uri = baseUri.resolve(path + (q.isEmpty() ? "" : "?" + q));
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(timeout).GET().build();
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("ZAP API HTTP " + response.statusCode());
            }
            return response.body();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("ZAP API 호출 중단", e);
        } catch (Exception e) {
            throw new IllegalStateException("ZAP API 연결 실패: " + e.getMessage(), e);
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
