package io.flowscope.integration;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Burp의 축소 JRE에서도 동작하는 loopback 전용 최소 HTTP/1.1 서버. */
public final class LoopbackHttpServer implements AutoCloseable {
    public interface Handler {
        Response handle(Request request) throws Exception;
    }

    public record Request(String method, String path, InetAddress remoteAddress,
                          Map<String, String> headers, byte[] body) {
        public String header(String name) { return headers.get(name.toLowerCase(Locale.ROOT)); }
    }

    public record Response(int status, Map<String, String> headers, byte[] body, long contentLength) {
        public Response(int status, Map<String, String> headers, byte[] body) {
            this(status, headers, body, body == null ? 0 : body.length);
        }
    }

    private static final int MAX_HEADERS = 32 * 1024;
    private static final int DEFAULT_MAX_BODY = 1024 * 1024;
    private static final int SOCKET_TIMEOUT_MS = 10_000;
    private final ServerSocket server;
    private final Handler handler;
    private final int maxBody;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final AtomicBoolean running = new AtomicBoolean();

    public LoopbackHttpServer(int port, Handler handler) throws IOException {
        this(port, DEFAULT_MAX_BODY, handler);
    }

    public LoopbackHttpServer(int port, int maxBody, Handler handler) throws IOException {
        if (maxBody < 0) throw new IllegalArgumentException("maxBody must not be negative");
        this.handler = handler;
        this.maxBody = maxBody;
        this.server = new ServerSocket();
        this.server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 50);
    }

    public void start() {
        if (running.compareAndSet(false, true)) executor.submit(this::acceptLoop);
    }

    public int port() { return server.getLocalPort(); }

    @Override public void close() {
        running.set(false);
        try { server.close(); } catch (IOException ignored) {}
        executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket socket = server.accept();
                executor.submit(() -> handle(socket));
            } catch (SocketException e) {
                if (running.get()) running.set(false);
            } catch (IOException e) {
                running.set(false);
            }
        }
    }

    private void handle(Socket socket) {
        try (socket) {
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);
            socket.setTcpNoDelay(true);
            Response response;
            try {
                response = handler.handle(readRequest(socket));
            } catch (HttpFailure e) {
                response = jsonError(e.status, e.code, e.getMessage());
            } catch (Exception e) {
                response = jsonError(500, -32603, "internal server error");
            }
            writeResponse(socket.getOutputStream(), response);
        } catch (IOException ignored) {
            // Client disconnects and timeouts are isolated to one loopback connection.
        }
    }

    private Request readRequest(Socket socket) throws IOException {
        InputStream input = socket.getInputStream();
        String head = new String(readHeaderBlock(input), StandardCharsets.ISO_8859_1);
        String[] lines = head.split("\\r\\n");
        if (lines.length == 0) throw new HttpFailure(400, -32600, "invalid HTTP request");
        String[] requestLine = lines[0].split(" ", 3);
        if (requestLine.length != 3 || !requestLine[2].startsWith("HTTP/1.")) {
            throw new HttpFailure(400, -32600, "invalid HTTP request line");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) throw new HttpFailure(400, -32600, "invalid HTTP header");
            String name = lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = lines[i].substring(colon + 1).trim();
            headers.merge(name, value, (left, right) -> left + "," + right);
        }
        byte[] body = readBody(input, headers, maxBody);
        return new Request(requestLine[0], requestLine[1], socket.getInetAddress(), Map.copyOf(headers), body);
    }

    private static byte[] readHeaderBlock(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int matched = 0;
        while (out.size() <= MAX_HEADERS) {
            int value = input.read();
            if (value < 0) throw new EOFException("connection closed before headers");
            out.write(value);
            matched = switch (matched) {
                case 0 -> value == '\r' ? 1 : 0;
                case 1 -> value == '\n' ? 2 : value == '\r' ? 1 : 0;
                case 2 -> value == '\r' ? 3 : 0;
                case 3 -> value == '\n' ? 4 : 0;
                default -> 4;
            };
            if (matched == 4) {
                byte[] bytes = out.toByteArray();
                return java.util.Arrays.copyOf(bytes, bytes.length - 4);
            }
        }
        throw new HttpFailure(431, -32600, "request headers too large");
    }

    private static byte[] readBody(InputStream input, Map<String, String> headers, int maxBody) throws IOException {
        String transferEncoding = headers.get("transfer-encoding");
        String contentLength = headers.get("content-length");
        if (transferEncoding != null && contentLength != null) {
            throw new HttpFailure(400, -32600, "ambiguous request framing");
        }
        if (transferEncoding != null) {
            if (!transferEncoding.equalsIgnoreCase("chunked")) {
                throw new HttpFailure(400, -32600, "unsupported transfer encoding");
            }
            return readChunked(input, maxBody);
        }
        if (contentLength == null) return new byte[0];
        int length;
        try { length = Integer.parseInt(contentLength); }
        catch (NumberFormatException e) { throw new HttpFailure(400, -32600, "invalid content length"); }
        if (length < 0 || length > maxBody) throw new HttpFailure(413, -32600, "request too large");
        return readExactly(input, length);
    }

    private static byte[] readChunked(InputStream input, int maxBody) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (true) {
            String line = readLine(input, 128);
            int semicolon = line.indexOf(';');
            String sizeText = (semicolon >= 0 ? line.substring(0, semicolon) : line).trim();
            int size;
            try { size = Integer.parseInt(sizeText, 16); }
            catch (NumberFormatException e) { throw new HttpFailure(400, -32600, "invalid chunk size"); }
            if (size < 0 || out.size() + (long) size > maxBody) {
                throw new HttpFailure(413, -32600, "request too large");
            }
            if (size == 0) {
                while (!readLine(input, MAX_HEADERS).isEmpty()) {}
                return out.toByteArray();
            }
            out.write(readExactly(input, size));
            if (input.read() != '\r' || input.read() != '\n') {
                throw new HttpFailure(400, -32600, "invalid chunk terminator");
            }
        }
    }

    private static String readLine(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (out.size() <= limit) {
            int value = input.read();
            if (value < 0) throw new EOFException("connection closed during line");
            if (value == '\r') {
                if (input.read() != '\n') throw new HttpFailure(400, -32600, "invalid line ending");
                return out.toString(StandardCharsets.ISO_8859_1);
            }
            out.write(value);
        }
        throw new HttpFailure(431, -32600, "request line too large");
    }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] bytes = input.readNBytes(length);
        if (bytes.length != length) throw new EOFException("connection closed during request body");
        return bytes;
    }

    private static void writeResponse(OutputStream output, Response response) throws IOException {
        byte[] body = response.body() == null ? new byte[0] : response.body();
        StringBuilder head = new StringBuilder("HTTP/1.1 ").append(response.status()).append(' ')
                .append(reason(response.status())).append("\r\n")
                .append("Content-Length: ").append(response.contentLength()).append("\r\n")
                .append("Connection: close\r\n")
                .append("X-Content-Type-Options: nosniff\r\n");
        response.headers().forEach((name, value) -> head.append(name).append(": ").append(value).append("\r\n"));
        head.append("\r\n");
        output.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    private static Response jsonError(int status, int code, String message) {
        String safe = message.replace("\\", "\\\\").replace("\"", "\\\"");
        byte[] body = ("{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":" + code
                + ",\"message\":\"" + safe + "\"}}") .getBytes(StandardCharsets.UTF_8);
        return new Response(status, Map.of("Content-Type", "application/json; charset=utf-8"), body);
    }

    private static String reason(int status) {
        return switch (status) {
            case 200 -> "OK";
            case 308 -> "Permanent Redirect";
            case 202 -> "Accepted";
            case 400 -> "Bad Request";
            case 401 -> "Unauthorized";
            case 403 -> "Forbidden";
            case 404 -> "Not Found";
            case 405 -> "Method Not Allowed";
            case 409 -> "Conflict";
            case 413 -> "Content Too Large";
            case 431 -> "Request Header Fields Too Large";
            default -> "Internal Server Error";
        };
    }

    private static final class HttpFailure extends IOException {
        final int status;
        final int code;

        HttpFailure(int status, int code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }
}
