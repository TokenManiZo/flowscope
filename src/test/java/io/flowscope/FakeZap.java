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
                        + "{\"id\":\"client\"},"
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
    }

}
