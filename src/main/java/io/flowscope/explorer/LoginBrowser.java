package io.flowscope.explorer;

import java.io.IOException;
import java.net.HttpCookie;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The one browser window FlowScope opens: the operator logs in there, and afterwards the Explorer drives the same
 * window so the operator can watch. The window reaches no Burp listener, so its traffic can never be mistaken for
 * HUMAN collection; FlowScope records it from the browser itself, and only while {@link Session#recording} is on.
 */
interface LoginBrowser {
    Session open(URI loginUrl, Consumer<Exchange> recorder) throws IOException;

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

        /** Null while the operator logs in or between runs; a run ID binds late exchanges to their origin. */
        void recording(String runId);

        Page navigate(String url) throws IOException;

        Page snapshot() throws IOException;

        Page click(String ref) throws IOException;

        Page type(String ref, String text) throws IOException;

        Page back() throws IOException;

        boolean alive();

        @Override void close();
    }
}
