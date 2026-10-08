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
    static final String CLIENT_BROWSER = "chrome-headless";
    private static final java.util.Set<String> SPIDER_INTEGER_OPTIONS = java.util.Set.of("MaxDepth", "MaxDuration");
    private static final java.util.Set<String> SPIDER_BOOLEAN_OPTIONS = java.util.Set.of(
            "PostForm", "ProcessForm", "ParseRobotsTxt", "ParseSitemapXml");
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
    /** 이름 없는 임시 세션. ZAP 자체는 user directory 아래에 untitled DB를 만들 수 있다. */
    public String newTemporarySession() {
        return post("/JSON/core/action/newSession/", "");
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
    public String setBrowserAuthentication(String contextId, String loginPageUrl, String browser) {
        String config = "loginPageUrl=" + enc(loginPageUrl)
                + "&browserId=" + enc(browser == null || browser.isBlank() ? CLIENT_BROWSER : browser);
        return post("/JSON/authentication/action/setAuthenticationMethod/",
                "contextId=" + enc(contextId) + "&authMethodName=browserBasedAuthentication"
                        + "&authMethodConfigParams=" + enc(config));
    }
    public String setAutoDetectSessionManagement(String contextId) {
        return post("/JSON/sessionManagement/action/setSessionManagementMethod/",
                "contextId=" + enc(contextId) + "&methodName=autoDetectSessionManagement");
    }
    /** 쿠키 세션 추적: 서버가 주는 Set-Cookie를 따라 세션 쿠키를 갱신한다(수동 주입 쿠키용). */
    public String setCookieBasedSessionManagement(String contextId) {
        return post("/JSON/sessionManagement/action/setSessionManagementMethod/",
                "contextId=" + enc(contextId) + "&methodName=cookieBasedSessionManagement");
    }
    /** 헤더 세션 추적: 주입한 인증 헤더로 세션을 따라간다. headers는 "Authorization: Bearer {%token%}" 같은 줄바꿈 구분 템플릿. */
    public String setHeaderBasedSessionManagement(String contextId, String headers) {
        if (headers == null || headers.isBlank()) {
            throw new IllegalArgumentException("header session template is required");
        }
        return postSensitive("/JSON/sessionManagement/action/setSessionManagementMethod/",
                "contextId=" + enc(contextId) + "&methodName=headerBasedSessionManagement"
                        + "&methodConfigParams=" + enc("headers=" + headers));
    }
    public String setLoggedInIndicator(String contextId, String pattern) {
        return post("/JSON/authentication/action/setLoggedInIndicator/",
                "contextId=" + enc(contextId) + "&loggedInIndicatorRegex=" + enc(pattern));
    }
    public String setLoggedOutIndicator(String contextId, String pattern) {
        return post("/JSON/authentication/action/setLoggedOutIndicator/",
                "contextId=" + enc(contextId) + "&loggedOutIndicatorRegex=" + enc(pattern));
    }
    public String newUser(String contextId, String name) {
        return post("/JSON/users/action/newUser/", "contextId=" + enc(contextId) + "&name=" + enc(name));
    }
    public String setUserCredentials(String contextId, String userId, String username, String password) {
        String credentials = "username=" + enc(username) + "&password=" + enc(password);
        return postSensitive("/JSON/users/action/setAuthenticationCredentials/",
                "contextId=" + enc(contextId) + "&userId=" + enc(userId)
                        + "&authCredentialsConfigParams=" + enc(credentials));
    }
    public String setUserEnabled(String contextId, String userId) {
        return post("/JSON/users/action/setUserEnabled/",
                "contextId=" + enc(contextId) + "&userId=" + enc(userId) + "&enabled=true");
    }
    public String authenticateAsUser(String contextId, String userId) {
        return post("/JSON/users/action/authenticateAsUser/",
                "contextId=" + enc(contextId) + "&userId=" + enc(userId), Duration.ofMinutes(2));
    }
    public String removeUser(String contextId, String userId) {
        return post("/JSON/users/action/removeUser/",
                "contextId=" + enc(contextId) + "&userId=" + enc(userId));
    }
    public String removeContext(String contextName) {
        return post("/JSON/context/action/removeContext/", "contextName=" + enc(contextName));
    }
    public String addRequestHeaderRule(String description, String urlRegex,
                                       String headerName, String replacement,
                                       java.util.List<Integer> initiators) {
        return addRequestHeaderRule(description, urlRegex, headerName, replacement, initiators, false);
    }
    /** sensitive면 실패 응답 본문을 예외에 넣지 않는다. 주입 인증값처럼 값이 비밀일 때 쓴다. */
    public String addRequestHeaderRule(String description, String urlRegex,
                                       String headerName, String replacement,
                                       java.util.List<Integer> initiators, boolean sensitive) {
        if (description == null || description.isBlank() || urlRegex == null || urlRegex.isBlank()
                || headerName == null || headerName.isBlank() || replacement == null || replacement.isBlank()
                || initiators == null || initiators.isEmpty()) {
            throw new IllegalArgumentException("ZAP Replacer capability rule fields are required");
        }
        String initiatorList = initiators.stream().map(String::valueOf)
                .collect(java.util.stream.Collectors.joining(","));
        String form = "description=" + enc(description)
                + "&enabled=true&matchType=REQ_HEADER&matchRegex=false&matchString=" + enc(headerName)
                + "&replacement=" + enc(replacement) + "&url=" + enc(urlRegex)
                + "&initiators=" + enc(initiatorList);
        return sensitive ? postSensitive("/JSON/replacer/action/addRule/", form)
                : post("/JSON/replacer/action/addRule/", form);
    }
    public String removeReplacerRule(String description) {
        if (description == null || description.isBlank()) {
            throw new IllegalArgumentException("ZAP Replacer rule description is required");
        }
        return post("/JSON/replacer/action/removeRule/", "description=" + enc(description));
    }
    // 수동 주입 쿠키를 ZAP 세션 쿠키잔에 심는다. 이후 ZAP이 Set-Cookie 회전을 따라가 세션을 유지한다.
    public String addSessionToken(String site, String token) {
        return post("/JSON/httpSessions/action/addSessionToken/",
                "site=" + enc(site) + "&sessionToken=" + enc(token));
    }
    public String createHttpSession(String site, String session) {
        return post("/JSON/httpSessions/action/createEmptySession/",
                "site=" + enc(site) + "&session=" + enc(session));
    }
    public String setSessionTokenValue(String site, String session, String token, String value) {
        return postSensitive("/JSON/httpSessions/action/setSessionTokenValue/",
                "site=" + enc(site) + "&session=" + enc(session)
                        + "&sessionToken=" + enc(token) + "&tokenValue=" + enc(value));
    }
    public String setActiveHttpSession(String site, String session) {
        return post("/JSON/httpSessions/action/setActiveSession/",
                "site=" + enc(site) + "&session=" + enc(session));
    }
    public String removeHttpSession(String site, String session) {
        return post("/JSON/httpSessions/action/removeSession/",
                "site=" + enc(site) + "&session=" + enc(session));
    }
    public String removeSessionToken(String site, String token) {
        return post("/JSON/httpSessions/action/removeSessionToken/",
                "site=" + enc(site) + "&sessionToken=" + enc(token));
    }
    /** 주어진 raw 요청을 ZAP이 그대로 한 번 보내고 응답(헤더·본문)을 돌려준다. 주입 인증값 검증용. 요청에 인증값이 실리므로 민감. */
    public String sendRequest(String rawRequest, boolean followRedirects) {
        if (rawRequest == null || rawRequest.isBlank()) {
            throw new IllegalArgumentException("ZAP sendRequest raw message is required");
        }
        return postSensitive("/JSON/core/action/sendRequest/",
                "request=" + enc(rawRequest) + "&followRedirects=" + (followRedirects ? "true" : "false"));
    }
    public String clientSpider(String target) {
        return clientSpider(target, "");
    }
    public String clientSpider(String target, String contextName) {
        String query = "browser=" + enc(CLIENT_BROWSER) + "&url=" + enc(target)
                + "&subtreeOnly=true&scopeCheck=FLEXIBLE&maxCrawlDepth=5"
                + "&numberOfBrowsers=1&logoutAvoidance=true";
        if (contextName != null && !contextName.isBlank()) query += "&contextName=" + enc(contextName);
        return get("/JSON/clientSpider/action/scan/", query);
    }
    public String clientSpider(String target, String contextName, String userName, String browser) {
        return get("/JSON/clientSpider/action/scan/", "url=" + enc(target)
                + "&subtreeOnly=true&scopeCheck=FLEXIBLE&contextName=" + enc(contextName)
                + "&maxCrawlDepth=5&numberOfBrowsers=1&logoutAvoidance=true"
                + "&userName=" + enc(userName) + "&browser=" + enc(browser));
    }
    public String clientSpiderStatus(String scanId) {
        return get("/JSON/clientSpider/view/status/", "scanId=" + enc(scanId));
    }
    public String stopClientSpider(String scanId) {
        return get("/JSON/clientSpider/action/stop/", "scanId=" + enc(scanId));
    }
    /** start-zap.sh가 등록한 standalone 스크립트를 실행한다. 스크립트 내용은 API로 보내지 않는다. */
    public String runStandAloneScript(String scriptName) {
        return get("/JSON/script/action/runStandAloneScript/", "scriptName=" + enc(scriptName));
    }
    public String setScriptGlobalVar(String key, String value) {
        return get("/JSON/script/action/setGlobalVar/", "varKey=" + enc(key) + "&varValue=" + enc(value));
    }
    public String scriptGlobalVar(String key) {
        return get("/JSON/script/view/globalVar/", "varKey=" + enc(key));
    }
    /** 일반(traditional) Spider 전역 옵션. 허용한 옵션 이름만 보낸다. */
    public String setSpiderOption(String option, int value) {
        if (!SPIDER_INTEGER_OPTIONS.contains(option)) throw new IllegalArgumentException("unsupported Spider option: " + option);
        return get("/JSON/spider/action/setOption" + option + "/", "Integer=" + value);
    }
    public String setSpiderOption(String option, boolean value) {
        if (!SPIDER_BOOLEAN_OPTIONS.contains(option)) throw new IllegalArgumentException("unsupported Spider option: " + option);
        return get("/JSON/spider/action/setOption" + option + "/", "Boolean=" + value);
    }
    public String clearSpiderExclusions() { return get("/JSON/spider/action/clearExcludedFromScan/", ""); }
    public String excludeFromSpider(String regex) {
        return get("/JSON/spider/action/excludeFromScan/", "regex=" + enc(regex));
    }
    public String spider(String target, String contextName) {
        return get("/JSON/spider/action/scan/", "url=" + enc(target)
                + "&maxChildren=0&recurse=true&subtreeOnly=true&contextName=" + enc(contextName));
    }
    public String spiderAsUser(String target, String contextId, String userId) {
        return get("/JSON/spider/action/scanAsUser/", "contextId=" + enc(contextId) + "&userId=" + enc(userId)
                + "&url=" + enc(target) + "&maxChildren=0&recurse=true&subtreeOnly=true");
    }
    public String spiderStatus(String scanId) {
        return get("/JSON/spider/view/status/", "scanId=" + enc(scanId));
    }
    public String stopSpider(String scanId) {
        return get("/JSON/spider/action/stop/", "scanId=" + enc(scanId));
    }
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
    public String zapHomePath() { return get("/JSON/core/view/zapHomePath/", ""); }
    /** ZAP 자신이 기록한 메시지 수(baseurl prefix). 0건 실패의 원인을 "ZAP이 안 냄"과 "Burp가 못 받음"으로 가르는 데 쓴다. */
    public String numberOfMessages(String baseUrl) {
        return get("/JSON/core/view/numberOfMessages/", "baseurl=" + enc(baseUrl), Duration.ofSeconds(5));
    }
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
                String detail = io.flowscope.core.TextLimits.truncate(
                        response.body(), 512);
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

    private String post(String path, String form) {
        return post(path, form, Duration.ofSeconds(20));
    }

    private String postSensitive(String path, String form) {
        return post(path, form, Duration.ofSeconds(20), false);
    }

    private String post(String path, String form, Duration timeout) {
        return post(path, form, timeout, true);
    }

    private String post(String path, String form, Duration timeout, boolean includeErrorBody) {
        URI uri = baseUri.resolve(path);
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(timeout)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form == null ? "" : form, StandardCharsets.UTF_8));
        if (!apiKey.isBlank()) builder.header("X-ZAP-API-Key", apiKey);
        return send(builder.build(), includeErrorBody);
    }

    private String send(HttpRequest request, boolean includeErrorBody) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String detail = includeErrorBody ? io.flowscope.core.TextLimits.truncate(
                        response.body(), 512) : "";
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
