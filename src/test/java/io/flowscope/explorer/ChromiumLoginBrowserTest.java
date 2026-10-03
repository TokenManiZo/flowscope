package io.flowscope.explorer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;

import static org.junit.jupiter.api.Assertions.*;

final class ChromiumLoginBrowserTest {
    @Test
    void readsBurpDevToolsTokenAndPlainChromeEndpoint() {
        Matcher burp = ChromiumLoginBrowser.DEVTOOLS_LINE.matcher(
                "DevTools listening on ws://127.0.0.1:9333/devtools/browser/abc with token 5913-fc9a");
        assertTrue(burp.find());
        assertEquals("ws://127.0.0.1:9333/devtools/browser/abc", burp.group(1));
        assertEquals("5913-fc9a", burp.group(2));
        Matcher chrome = ChromiumLoginBrowser.DEVTOOLS_LINE.matcher(
                "DevTools listening on ws://127.0.0.1:9222/devtools/browser/xyz");
        assertTrue(chrome.find());
        assertNull(chrome.group(2));
    }

    @Test
    void hostOnlyCookiesDoNotLeakToSiblingHosts() {
        assertTrue(ChromiumLoginBrowser.appliesTo("plane.localhost", "plane.localhost"));
        assertFalse(ChromiumLoginBrowser.appliesTo("plane.localhost", "api.plane.localhost"));
        assertTrue(ChromiumLoginBrowser.appliesTo(".example.test", "api.example.test"));
        assertTrue(ChromiumLoginBrowser.appliesTo(".example.test", "example.test"));
        assertFalse(ChromiumLoginBrowser.appliesTo(".example.test", "badexample.test"));
    }

    @Test
    void findsTheNewestBurpBrowserNextToBurpsJre(@TempDir Path burp) throws Exception {
        // macOS layout: Resources/jre.bundle/Contents/Home and Resources/app/burpbrowser/<version>/...
        Path javaHome = Files.createDirectories(burp.resolve("Resources/jre.bundle/Contents/Home"));
        for (String version : new String[]{"150.0.1", "151.0.7922.138"}) {
            Path exe = burp.resolve("Resources/app/burpbrowser/" + version
                    + "/Burp Browser.app/Contents/MacOS/Burp Browser");
            Files.createDirectories(exe.getParent());
            Files.createFile(exe);
            assertTrue(exe.toFile().setExecutable(true));
        }
        Path found = ChromiumLoginBrowser.resolveExecutable(javaHome);
        assertNotNull(found);
        assertTrue(found.toString().contains("151.0.7922.138"), found.toString());
    }

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Launch arguments decide what the target can detect and what the window trusts; they are not cosmetic. */
    @Test
    void loginWindowHidesAutomationAndBypassesEveryProxy() {
        List<String> arguments = ChromiumLoginBrowser.arguments(
                "/tmp/chrome", Path.of("/tmp/profile"), java.net.URI.create("https://app.example.test/login"));

        assertEquals("/tmp/chrome", arguments.getFirst());
        // navigator.webdriver stays false, so the target behaves as it did for the operator who just logged in.
        assertTrue(arguments.contains("--disable-blink-features=AutomationControlled"), arguments.toString());
        // No Burp listener: this window's traffic can never be mistaken for HUMAN collection.
        assertTrue(arguments.contains("--no-proxy-server"), arguments.toString());
        assertTrue(arguments.contains("--user-data-dir=/tmp/profile"), arguments.toString());
        assertTrue(arguments.contains("--remote-debugging-port=0"), arguments.toString());
        assertEquals("https://app.example.test/login", arguments.getLast());
    }

    private static JsonNode frame(String json) {
        try { return JSON.readTree(json); }
        catch (Exception error) { throw new AssertionError(error); }
    }

    private static JsonNode willBeSent(String requestId, String url, String redirect) {
        return frame("{\"method\":\"Network.requestWillBeSent\",\"sessionId\":\"S\",\"params\":{"
                + "\"requestId\":\"" + requestId + "\","
                + (redirect == null ? "" : "\"redirectResponse\":" + redirect + ",")
                + "\"request\":{\"method\":\"GET\",\"url\":\"" + url + "\","
                + "\"headers\":{\"Accept\":\"*/*\"},\"postData\":\"\"}}}");
    }

    private static JsonNode extraInfo(String requestId, String cookie) {
        return frame("{\"method\":\"Network.requestWillBeSentExtraInfo\",\"params\":{"
                + "\"requestId\":\"" + requestId + "\","
                + "\"headers\":{\"Cookie\":\"" + cookie + "\"}}}");
    }

    private static JsonNode responseReceived(String requestId, int status, String extraHeader) {
        return frame("{\"method\":\"Network.responseReceived\",\"params\":{"
                + "\"requestId\":\"" + requestId + "\",\"response\":{\"status\":" + status + ","
                + "\"headers\":{\"Content-Type\":\"application/json\"" + extraHeader + "}}}}");
    }

    /** Cookie only ever arrives on requestWillBeSentExtraInfo, and it may arrive on either side of the request. */
    @Test
    void cookieFromExtraInfoIsMergedWhicheverEventArrivesFirst() {
        for (boolean extraFirst : new boolean[]{true, false}) {
            List<LoginBrowser.Exchange> recorded = new ArrayList<>();
            ChromiumLoginBrowser.Cdp cdp = ChromiumLoginBrowser.Cdp.forEvents(recorded::add);
            if (extraFirst) {
                cdp.event(extraInfo("r1", "session=abc123"));
                cdp.event(willBeSent("r1", "https://app.example.test/api/me", null));
            } else {
                cdp.event(willBeSent("r1", "https://app.example.test/api/me", null));
                cdp.event(extraInfo("r1", "session=abc123"));
            }
            cdp.event(responseReceived("r1", 200, ""));
            // The redirect path is the one emit that needs no socket; drive it to read the merged headers back.
            cdp.event(willBeSent("r1", "https://app.example.test/next",
                    "{\"status\":302,\"headers\":{\"Location\":\"/next\"}}"));
            assertEquals(1, recorded.size(), "extraFirst=" + extraFirst);
            assertEquals("session=abc123", recorded.get(0).requestHeaders().get("Cookie"),
                    "extraFirst=" + extraFirst);
            assertEquals("*/*", recorded.get(0).requestHeaders().get("Accept"));
        }
    }

    /** A redirect reuses the requestId; overwriting it would drop the 3xx and its Location (D-015). */
    @Test
    void redirectHopIsRecordedBeforeTheNextHopReusesTheRequestId() {
        List<LoginBrowser.Exchange> recorded = new ArrayList<>();
        ChromiumLoginBrowser.Cdp cdp = ChromiumLoginBrowser.Cdp.forEvents(recorded::add);
        cdp.event(willBeSent("r1", "https://app.example.test/old", null));
        cdp.event(willBeSent("r1", "https://app.example.test/new",
                "{\"status\":302,\"headers\":{\"Location\":\"/new\",\"Content-Length\":\"0\"}}"));

        assertEquals(1, recorded.size());
        LoginBrowser.Exchange hop = recorded.get(0);
        assertEquals("https://app.example.test/old", hop.url());
        assertEquals(302, hop.status());
        assertEquals("/new", hop.responseHeaders().get("Location"));
        // The next hop took its place in flight rather than both being lost.
        assertEquals(1, cdp.inFlight.size());
    }

    /** CDP hands back decoded bodies, so framing headers that describe the encoded bytes must not survive. */
    @Test
    void headersDescribingTheEncodedBodyAreDropped() {
        List<LoginBrowser.Exchange> recorded = new ArrayList<>();
        ChromiumLoginBrowser.Cdp cdp = ChromiumLoginBrowser.Cdp.forEvents(recorded::add);
        cdp.event(willBeSent("r1", "https://app.example.test/a", null));
        cdp.event(responseReceived("r1", 200,
                ",\"content-encoding\":\"gzip\",\"Content-Length\":\"31\",\"Transfer-Encoding\":\"chunked\""));
        cdp.event(willBeSent("r1", "https://app.example.test/b",
                "{\"status\":302,\"headers\":{\"Content-Encoding\":\"br\"}}"));

        assertEquals(1, recorded.size());
        java.util.Map<String, String> headers = recorded.get(0).responseHeaders();
        assertFalse(headers.containsKey("Content-Encoding"), headers.toString());
        assertFalse(headers.containsKey("Content-Length"), headers.toString());
        assertFalse(headers.containsKey("Transfer-Encoding"), headers.toString());
    }

    /** A long run must not grow a map of cookies for requests that never completed. */
    @Test
    void pendingCookieHeadersAreReleasedWhenTheRequestEnds() {
        ChromiumLoginBrowser.Cdp cdp = ChromiumLoginBrowser.Cdp.forEvents(exchange -> { });
        cdp.event(extraInfo("gone", "session=abc"));
        cdp.event(frame("{\"method\":\"Network.loadingFailed\",\"params\":{\"requestId\":\"gone\"}}"));
        assertTrue(cdp.inFlight.isEmpty());
        assertEquals(0, cdp.pendingCookieHeaders());
    }

    @Test
    void lateResponseFromPreviousRecordingGenerationCannotEnterNextRun() throws Exception {
        List<LoginBrowser.Exchange> recorded = new ArrayList<>();
        ChromiumLoginBrowser.Cdp cdp = ChromiumLoginBrowser.Cdp.forEvents(recorded::add);
        cdp.event(willBeSent("old", "https://app.example.test/old", null));
        cdp.event(responseReceived("old", 200, ""));
        var old = cdp.inFlight.get("old");

        cdp.setRecording(null, null, "");
        cdp.setRecording("next-run", request -> true, "https://app.example.test/");
        cdp.emitExchange(old, "{}");
        assertTrue(recorded.isEmpty(), "late body from the previous run must be discarded");

        cdp.event(willBeSent("new", "https://app.example.test/new", null));
        cdp.event(responseReceived("new", 200, ""));
        cdp.emitExchange(cdp.inFlight.get("new"), "{}");
        assertEquals(List.of("https://app.example.test/new"),
                recorded.stream().map(LoginBrowser.Exchange::url).toList());
    }
}
