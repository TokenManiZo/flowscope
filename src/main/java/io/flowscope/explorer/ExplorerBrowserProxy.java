package io.flowscope.explorer;

import java.util.UUID;

/** Correlates our browser with Burp without adding a custom header that could trigger CORS preflights. */
public final class ExplorerBrowserProxy {
    public static final String HISTORY_NOTE = "FlowScope LLM browser: Evidence collected by CDP";
    private final int port;
    private final String suffix = " FlowScope/" + UUID.randomUUID();

    public ExplorerBrowserProxy(int port) {
        if (port < 1 || port > 65535) throw new IllegalArgumentException("LLM 프록시 포트가 올바르지 않습니다.");
        this.port = port;
    }

    public int port() { return port; }

    String tagUserAgent(String original) { return original + suffix; }

    /** Null for other clients; the suffix is stripped before forwarding and before CDP Evidence is stored. */
    public String originalUserAgent(String tagged) {
        return tagged != null && tagged.endsWith(suffix)
                ? tagged.substring(0, tagged.length() - suffix.length()) : null;
    }
}
