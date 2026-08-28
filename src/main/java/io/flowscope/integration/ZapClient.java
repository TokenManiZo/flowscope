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
    public String passiveRecordsToScan() { return get("/JSON/pscan/view/recordsToScan/", ""); }
    public String passiveTasks() { return get("/JSON/pscan/view/currentTasks/", ""); }
    public String alerts(String baseUrl, int start, int count) {
        String query = "start=" + Math.max(0, start) + "&count=" + Math.max(1, Math.min(500, count));
        if (baseUrl != null && !baseUrl.isBlank()) query = "baseurl=" + enc(baseUrl) + "&" + query;
        return get("/JSON/alert/view/alerts/", query);
    }
    public String installedAddons() { return get("/JSON/autoupdate/view/installedAddons/", ""); }

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
}
