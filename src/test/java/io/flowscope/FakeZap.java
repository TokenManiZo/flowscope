package io.flowscope;

import com.sun.net.httpserver.HttpServer;

/** ZAP API 응답만 모사한다. 실제 브라우저·로그인·크롤링 검증이 아니다. */
final class FakeZap {
    private FakeZap() {}

    static void zapReply(com.sun.net.httpserver.HttpExchange exchange, String value) throws java.io.IOException {
        byte[] body = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    static void registerSafeZapEnvironment(HttpServer server, int alertCount) {
        server.createContext("/JSON/core/view/version/", exchange -> zapReply(exchange,
                "{\"version\":\"2.17.0\"}"));
        server.createContext("/JSON/core/view/zapHomePath/", exchange -> zapReply(exchange,
                "{\"zapHomePath\":\"/run/flowscope-zap/test/home/\"}"));
        server.createContext("/JSON/autoupdate/view/installedAddons/", exchange -> zapReply(exchange,
                "{\"installedAddons\":["
                        + "{\"id\":\"client\"},{\"id\":\"spider\"},"
                        + "{\"id\":\"pscan\"},{\"id\":\"pscanrules\"},{\"id\":\"selenium\"},"
                        + "{\"id\":\"openapi\"},{\"id\":\"websocket\"},{\"id\":\"network\"},"
                        + "{\"id\":\"replacer\"},{\"id\":\"authhelper\"}]}"));
        server.createContext("/JSON/network/view/isHttpProxyEnabled/", exchange -> zapReply(exchange,
                "{\"isHttpProxyEnabled\":\"true\"}"));
        server.createContext("/JSON/network/view/getHttpProxy/", exchange -> zapReply(exchange,
                "{\"getHttpProxy\":{\"host\":\"127.0.0.1\",\"port\":8081}}"));
        server.createContext("/JSON/pscan/action/setEnabled/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/context/action/newContext/", exchange -> zapReply(exchange,
                "{\"contextId\":\"1\"}"));
        server.createContext("/JSON/context/action/includeInContext/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/context/action/setContextInScope/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/context/action/removeContext/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/authentication/action/setAuthenticationMethod/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/authentication/action/setLoggedInIndicator/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/authentication/action/setLoggedOutIndicator/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/sessionManagement/action/setSessionManagementMethod/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/users/action/newUser/", exchange -> zapReply(exchange,
                "{\"userId\":\"7\"}"));
        server.createContext("/JSON/users/action/setAuthenticationCredentials/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/users/action/setUserEnabled/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/users/action/authenticateAsUser/", exchange -> zapReply(exchange,
                "{\"authSuccessful\":true}"));
        server.createContext("/JSON/users/action/removeUser/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/replacer/action/addRule/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/replacer/action/removeRule/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/enableAllScanners/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/action/setScanOnlyInScope/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/view/currentTasks/", exchange -> zapReply(exchange,
                "{\"currentTasks\":[]}"));
        server.createContext("/JSON/pscan/action/clearQueue/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/pscan/view/scanners/", exchange -> zapReply(exchange,
                "{\"scanners\":[{\"id\":\"10020\",\"enabled\":\"true\"}]}"));
        server.createContext("/JSON/alert/view/numberOfAlerts/", exchange -> zapReply(exchange,
                "{\"numberOfAlerts\":\"" + alertCount + "\"}"));
        // 주입 인증: 쿠키 세션 심기(httpSessions)와 세션 제거. 모두 OK로 응답한다.
        for (String action : new String[] {"addSessionToken", "createEmptySession", "setSessionTokenValue",
                "setActiveSession", "removeSession", "removeSessionToken"}) {
            server.createContext("/JSON/httpSessions/action/" + action + "/", exchange -> zapReply(exchange,
                    "{\"Result\":\"OK\"}"));
        }
        // 주입 인증값 검증 프로브: 기본은 로그인된 200 응답. 테스트가 context를 바꿔 끼워 401·리다이렉트를 모사한다.
        server.createContext("/JSON/core/action/sendRequest/", exchange -> zapReply(exchange,
                "{\"sendRequest\":[{\"responseHeader\":\"HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\","
                        + "\"responseBody\":\"{\\\"user\\\":\\\"ok\\\"}\"}]}"));
        registerTraditionalSpider(server);
        registerClientMapReset(server);
    }

    /** start-zap.sh가 등록한 Client Map 비우기 스크립트: 실행하면 "요청번호:등록한 노드 수"를 완료 변수로 돌려준다. */
    static void registerClientMapReset(HttpServer server) {
        registerClientMapReset(server, script -> { });
    }

    static void registerClientMapReset(HttpServer server, java.util.function.Consumer<String> onRun) {
        registerClientMapReset(server, onRun, new java.util.concurrent.ConcurrentHashMap<>());
    }

    static void registerClientMapReset(HttpServer server, java.util.function.Consumer<String> onRun,
                                       java.util.Map<String, String> vars) {
        server.createContext("/JSON/script/action/setGlobalVar/", exchange -> {
            java.util.Map<String, String> query = query(exchange);
            vars.put(query.get("varKey"), query.get("varValue"));
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/script/action/runStandAloneScript/", exchange -> {
            onRun.accept(query(exchange).get("scriptName"));
            String seeds = vars.getOrDefault("flowscope.clientMap.seeds", "");
            long added = seeds.lines().filter(line -> !line.isBlank()).count();
            vars.put("flowscope.clientMap.cleared", vars.getOrDefault("flowscope.clientMap.request", "") + ":" + added);
            zapReply(exchange, "{\"Result\":\"OK\"}");
        });
        server.createContext("/JSON/script/view/globalVar/", exchange -> {
            String value = vars.get(query(exchange).get("varKey"));
            zapReply(exchange, value == null ? "{\"code\":\"does_not_exist\",\"message\":\"Does Not Exist\"}"
                    : "{\"globalVar\":\"" + value + "\"}");
        });
    }

    static java.util.Map<String, String> query(com.sun.net.httpserver.HttpExchange exchange) {
        java.util.Map<String, String> values = new java.util.HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null) return values;
        for (String pair : raw.split("&")) {
            int equals = pair.indexOf('=');
            if (equals < 0) continue;
            values.put(java.net.URLDecoder.decode(pair.substring(0, equals), java.nio.charset.StandardCharsets.UTF_8),
                    java.net.URLDecoder.decode(pair.substring(equals + 1), java.nio.charset.StandardCharsets.UTF_8));
        }
        return values;
    }

    /** 일반 Spider: 옵션 설정은 모두 OK, 시작하면 곧바로 완료(100)로 응답한다. 테스트가 필요하면 context를 바꿔 끼운다. */
    static void registerTraditionalSpider(HttpServer server) {
        for (String option : new String[] {"MaxDepth", "MaxDuration", "PostForm", "ProcessForm", "ParseRobotsTxt", "ParseSitemapXml"}) {
            server.createContext("/JSON/spider/action/setOption" + option + "/", exchange -> zapReply(exchange,
                    "{\"Result\":\"OK\"}"));
        }
        server.createContext("/JSON/spider/action/clearExcludedFromScan/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/spider/action/excludeFromScan/", exchange -> zapReply(exchange,
                "{\"Result\":\"OK\"}"));
        server.createContext("/JSON/spider/action/scan/", exchange -> zapReply(exchange, "{\"scan\":\"3\"}"));
        server.createContext("/JSON/spider/action/scanAsUser/", exchange -> zapReply(exchange, "{\"scanAsUser\":\"3\"}"));
        server.createContext("/JSON/spider/view/status/", exchange -> zapReply(exchange, "{\"status\":\"100\"}"));
        server.createContext("/JSON/spider/action/stop/", exchange -> zapReply(exchange, "{\"Result\":\"OK\"}"));
    }

}
