package io.flowscope.explorer;

import java.io.IOException;
import java.net.HttpCookie;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Predicate;

/**
 * Explorer browser session: a registered-account window keeps the operator's login, while an anonymous run opens a
 * separate throwaway window. Neither reaches a Burp listener; FlowScope records traffic directly from DevTools only
 * while {@link Session#recording} is on.
 */
interface LoginBrowser {
    Session open(URI loginUrl, Consumer<Exchange> recorder) throws IOException;

    /** Metadata available before Chromium sends a request; values are never exposed to the model. */
    record BrowserRequest(String method, String url, String resourceType, String initiatorUrl,
                          boolean credentialed) {}

    /** One request/response the window performed, as the browser saw it. */
    record Exchange(String runId, String method, String url, Map<String, String> requestHeaders, String requestBody,
                    int status, Map<String, String> responseHeaders, String responseBody) {}

    /** One interactive element the Explorer may click or type into. */
    record Element(String ref, String role, String name) {}

    /** What the window shows now. {@code text} is masked before it leaves FlowScope. */
    record Page(String url, String title, List<Element> elements, String text) {}

    interface Session extends AutoCloseable {
        /** Cookies the browser would send to {@code target}. */
        List<HttpCookie> cookies(URI target) throws IOException;

        /** The latest auth headers (Authorization, CSRF) the window's own requests sent to {@code target}'s origin. */
        Map<String, String> authHeaders(URI target);

        /** Null while the operator logs in or between runs; active capture requires a pre-dispatch scope guard. */
        void recording(String runId, Predicate<BrowserRequest> requestAllowed) throws IOException;

        Page navigate(String url) throws IOException;

        Page snapshot() throws IOException;

        Page click(String ref) throws IOException;

        Page type(String ref, String text) throws IOException;

        Page back() throws IOException;

        boolean alive();

        @Override void close();
    }
}
