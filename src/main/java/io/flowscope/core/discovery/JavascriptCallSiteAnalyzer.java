package io.flowscope.core.discovery;

import com.google.javascript.jscomp.BlackHoleErrorManager;
import com.google.javascript.jscomp.CompilerOptions;
import com.google.javascript.jscomp.SourceFile;
import com.google.javascript.rhino.Node;
import com.google.javascript.rhino.Token;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static io.flowscope.core.discovery.JavascriptAnalysis.ParameterKind.FORM_BODY;
import static io.flowscope.core.discovery.JavascriptAnalysis.ParameterKind.JSON_BODY;
import static io.flowscope.core.discovery.JavascriptAnalysis.ParameterKind.QUERY;

/**
 * Closure Compiler parser로 JavaScript를 실행 없이 읽는 bounded call-site 분석기.
 * 직접 확인 가능한 Web API와 axios/jQuery 호출만 처리하며 임의 wrapper 의미는 추정하지 않는다.
 */
public final class JavascriptCallSiteAnalyzer {
    private static final Set<String> HTTP_METHODS = Set.of(
            "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD");
    private static final int MAX_SCRIPT_CHARS = 1_048_576;
    private static final int MAX_NODES = 250_000;
    private static final int MAX_CALL_SITES = 20_000;
    private static final int MAX_ASSETS = 20_000;
    private static final int MAX_PARAMETERS_PER_CALL = 1_024;
    private static final int MAX_RESOLUTION_DEPTH = 12;
    private static final int MAX_CACHE_ENTRIES = 128;
    private static final Map<String, JavascriptAnalysis> CACHE = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, JavascriptAnalysis> eldest) {
            return size() > MAX_CACHE_ENTRIES;
        }
    };

    private JavascriptCallSiteAnalyzer() {}

    public static JavascriptAnalysis analyze(String script) {
        if (script == null || script.isBlank()) {
            return new JavascriptAnalysis(List.of(), List.of(), JavascriptAnalysis.Status.PARSED, "empty script");
        }
        if (script.length() > MAX_SCRIPT_CHARS) {
            return new JavascriptAnalysis(List.of(), List.of(), JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                    "script exceeds 1048576 character parser limit");
        }
        String cacheKey = cacheKey(script);
        synchronized (CACHE) {
            JavascriptAnalysis cached = CACHE.get(cacheKey);
            if (cached != null) return cached;
        }
        JavascriptAnalysis analysis = parse(script);
        synchronized (CACHE) {
            CACHE.put(cacheKey, analysis);
        }
        return analysis;
    }

    public static void clearCache() {
        synchronized (CACHE) { CACHE.clear(); }
    }

    private static String cacheKey(String script) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(script.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static JavascriptAnalysis parse(String script) {
        try {
            CompilerOptions options = new CompilerOptions();
            options.setLanguageIn(CompilerOptions.LanguageMode.ECMASCRIPT_NEXT);
            options.skipAllCompilerPasses();
            options.setNumParallelThreads(1);
            var compiler = new com.google.javascript.jscomp.Compiler(new BlackHoleErrorManager());
            compiler.disableThreads();
            compiler.initOptions(options);
            Node root = compiler.parse(SourceFile.fromCode("flowscope-target.js", script));
            if (root == null) {
                return new JavascriptAnalysis(List.of(), List.of(), JavascriptAnalysis.Status.PARSE_FAILED,
                        "parser returned no AST");
            }
            Analyzer analyzer = new Analyzer();
            analyzer.collectBindings(root);
            analyzer.visit(root);
            JavascriptAnalysis.Status status = analyzer.limited ? JavascriptAnalysis.Status.LIMIT_EXCEEDED
                    : compiler.getErrorCount() == 0 ? JavascriptAnalysis.Status.PARSED
                    : JavascriptAnalysis.Status.PARTIAL;
            String detail = compiler.getErrorCount() == 0 ? ""
                    : "parser recovered with " + compiler.getErrorCount() + " syntax error(s)";
            if (analyzer.limited) detail = "AST exceeds 250000 node traversal limit";
            return new JavascriptAnalysis(analyzer.callSites, analyzer.assets, status, detail);
        } catch (RuntimeException | LinkageError | StackOverflowError exception) {
            return new JavascriptAnalysis(List.of(), List.of(), JavascriptAnalysis.Status.PARSE_FAILED,
                    exception.getClass().getSimpleName());
        }
    }

    private static final class Analyzer {
        private final Map<String, Node> constants = new LinkedHashMap<>();
        private final Set<String> axiosAliases = new LinkedHashSet<>(Set.of("axios"));
        private final Set<String> xhrNames = new LinkedHashSet<>();
        private final List<JavascriptAnalysis.CallSite> callSites = new ArrayList<>();
        private final List<JavascriptAnalysis.AssetReference> assets = new ArrayList<>();
        private int nodes;
        private int visited;
        private boolean limited;

        private void collectBindings(Node node) {
            if (node == null || nodes++ >= MAX_NODES) {
                limited = true;
                return;
            }
            if (node.isConst() || node.isLet()) {
                for (Node name : node.children()) {
                    if (!name.isName() || name.getFirstChild() == null) continue;
                    constants.putIfAbsent(name.getString(), name.getFirstChild());
                    if (isAxiosCreate(name.getFirstChild())) axiosAliases.add(name.getString());
                    if (isNewXmlHttpRequest(name.getFirstChild())) xhrNames.add(name.getString());
                }
            } else if (node.isImport()) {
                collectAxiosImport(node);
            }
            for (Node child : node.children()) {
                if (limited) return;
                collectBindings(child);
            }
        }

        private void visit(Node node) {
            if (node == null || limited) return;
            if (visited++ >= MAX_NODES || callSites.size() >= MAX_CALL_SITES || assets.size() >= MAX_ASSETS) {
                limited = true;
                return;
            }
            if (node.isCall()) inspectCall(node);
            if (node.isImport()) inspectStaticImport(node);
            if (node.getToken() == Token.DYNAMIC_IMPORT) inspectDynamicImport(node);
            for (Node child : node.children()) visit(child);
        }

        private void inspectStaticImport(Node node) {
            Node module = node.getLastChild();
            if (module == null || !module.isStringLit()) return;
            addAsset(module.getString(), "ECMAScript static import", node);
        }

        private void inspectDynamicImport(Node node) {
            addAsset(staticReference(node.getFirstChild(), 0), "ECMAScript dynamic import", node);
        }

        private void addAsset(String reference, String reason, Node node) {
            if (!scriptReference(reference) || assets.size() >= MAX_ASSETS) return;
            JavascriptAnalysis.AssetReference asset = new JavascriptAnalysis.AssetReference(reference, reason,
                    node.getLineno(), node.getCharno());
            if (!assets.contains(asset)) assets.add(asset);
        }

        private void inspectCall(Node call) {
            Node target = call.getFirstChild();
            if (target == null) return;
            String qualified = target.getQualifiedName();
            if (isFetch(qualified)) {
                inspectFetch(call);
                return;
            }
            if (qualified != null && qualified.endsWith(".sendBeacon")) {
                inspectBeacon(call);
                return;
            }
            if (qualified != null && qualified.endsWith(".open")) {
                inspectXhr(call, qualified.substring(0, qualified.length() - 5));
                return;
            }
            if (qualified != null && qualified.startsWith("$.")) {
                inspectJquery(call, qualified.substring(2).toLowerCase(Locale.ROOT));
                return;
            }
            inspectAxios(call, qualified);
        }

        private void inspectFetch(Node call) {
            List<Node> args = arguments(call);
            if (args.isEmpty()) return;
            String reference = staticReference(args.get(0), 0);
            if (!routeLike(reference)) return;
            Node options = args.size() > 1 ? resolve(args.get(1), 0) : null;
            String method = stringProperty(options, "method");
            if (method == null) method = args.size() == 1 ? "GET" : "UNKNOWN";
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            Node body = property(options, "body");
            addBodyParameters(parameters, body, bodyKind(body, options));
            add(reference, method, parameters, "fetch AST call-site", call);
        }

        private void inspectAxios(Node call, String qualified) {
            if (qualified == null) return;
            List<Node> args = arguments(call);
            int dot = qualified.indexOf('.');
            String receiver = dot < 0 ? qualified : qualified.substring(0, dot);
            if (!axiosAliases.contains(receiver)) return;
            String operation = dot < 0 ? "call" : qualified.substring(dot + 1).toLowerCase(Locale.ROOT);
            if (operation.equals("request") || operation.equals("call")) {
                if (args.isEmpty()) return;
                Node config = resolve(args.get(0), 0);
                String reference = staticReference(property(config, "url"), 0);
                if (!routeLike(reference)) return;
                String method = stringProperty(config, "method");
                List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
                addObjectParameters(parameters, property(config, "params"), QUERY, "");
                addObjectParameters(parameters, property(config, "data"), JSON_BODY, "");
                add(reference, method, parameters, "axios config AST call-site", call);
                return;
            }
            String method = operation.toUpperCase(Locale.ROOT);
            if (!HTTP_METHODS.contains(method) || args.isEmpty()) return;
            String reference = staticReference(args.get(0), 0);
            if (!routeLike(reference)) return;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            boolean bodyMethod = Set.of("POST", "PUT", "PATCH", "DELETE").contains(method);
            if (bodyMethod && args.size() > 1) addObjectParameters(parameters, args.get(1), JSON_BODY, "");
            Node config = args.size() > (bodyMethod ? 2 : 1) ? args.get(bodyMethod ? 2 : 1) : null;
            addObjectParameters(parameters, property(resolve(config, 0), "params"), QUERY, "");
            add(reference, method, parameters, "axios verb AST call-site", call);
        }

        private void inspectXhr(Node call, String receiver) {
            String root = receiver.contains(".") ? receiver.substring(0, receiver.indexOf('.')) : receiver;
            if (!xhrNames.contains(root)) return;
            List<Node> args = arguments(call);
            if (args.size() < 2) return;
            String method = staticString(args.get(0), 0);
            String reference = staticReference(args.get(1), 0);
            if (routeLike(reference)) add(reference, method, queryParameters(reference),
                    "XMLHttpRequest.open AST call-site", call);
        }

        private void inspectJquery(Node call, String operation) {
            List<Node> args = arguments(call);
            if (operation.equals("ajax")) {
                if (args.isEmpty()) return;
                Node config = resolve(args.get(0), 0);
                String reference = staticReference(property(config, "url"), 0);
                if (!routeLike(reference)) return;
                String method = firstNonBlank(stringProperty(config, "method"), stringProperty(config, "type"));
                List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
                JavascriptAnalysis.ParameterKind kind = "GET".equalsIgnoreCase(method) ? QUERY : FORM_BODY;
                addObjectParameters(parameters, property(config, "data"), kind, "");
                add(reference, method, parameters, "jQuery.ajax AST call-site", call);
                return;
            }
            if (!Set.of("get", "post").contains(operation) || args.isEmpty()) return;
            String reference = staticReference(args.get(0), 0);
            if (!routeLike(reference)) return;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            if (args.size() > 1) addObjectParameters(parameters, args.get(1),
                    operation.equals("get") ? QUERY : FORM_BODY, "");
            add(reference, operation, parameters, "jQuery verb AST call-site", call);
        }

        private void inspectBeacon(Node call) {
            List<Node> args = arguments(call);
            if (args.isEmpty()) return;
            String reference = staticReference(args.get(0), 0);
            if (!routeLike(reference)) return;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            if (args.size() > 1) addObjectParameters(parameters, args.get(1), FORM_BODY, "");
            add(reference, "POST", parameters, "sendBeacon AST call-site", call);
        }

        private void add(String reference, String method, List<JavascriptAnalysis.Parameter> parameters,
                         String reason, Node call) {
            String normalizedMethod = method == null ? "UNKNOWN" : method.toUpperCase(Locale.ROOT);
            if (!HTTP_METHODS.contains(normalizedMethod)) normalizedMethod = "UNKNOWN";
            callSites.add(new JavascriptAnalysis.CallSite(reference, normalizedMethod,
                    List.copyOf(new LinkedHashSet<>(parameters)), "javascript-ast", reason,
                    call.getLineno(), call.getCharno()));
        }

        private List<JavascriptAnalysis.Parameter> queryParameters(String reference) {
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>();
            try {
                String raw = URI.create(reference.replace("{expr}", "0")).getRawQuery();
                if (raw == null) return parameters;
                for (String pair : raw.split("&", -1)) {
                    String name = pair.split("=", 2)[0];
                    name = URLDecoder.decode(name, StandardCharsets.UTF_8).trim();
                    if (!name.isBlank()) parameters.add(new JavascriptAnalysis.Parameter(name, QUERY));
                }
            } catch (RuntimeException ignored) {
                // 경로 후보 자체는 유지하되 malformed query 이름은 선언하지 않는다.
            }
            return parameters;
        }

        private void addBodyParameters(List<JavascriptAnalysis.Parameter> out, Node body,
                                       JavascriptAnalysis.ParameterKind kind) {
            Node resolved = resolve(body, 0);
            if (resolved != null && resolved.isCall()
                    && "JSON.stringify".equals(resolved.getFirstChild().getQualifiedName())) {
                List<Node> args = arguments(resolved);
                if (!args.isEmpty()) addObjectParameters(out, args.get(0), JSON_BODY, "");
                return;
            }
            if (resolved != null && resolved.isNew()
                    && "URLSearchParams".equals(resolved.getFirstChild().getQualifiedName())) {
                List<Node> args = arguments(resolved);
                if (!args.isEmpty()) addObjectParameters(out, args.get(0), FORM_BODY, "");
                return;
            }
            addObjectParameters(out, resolved, kind, "");
        }

        private JavascriptAnalysis.ParameterKind bodyKind(Node body, Node options) {
            String contentType = staticString(property(resolve(options, 0), "contentType"), 0);
            if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("json")) return JSON_BODY;
            Node resolved = resolve(body, 0);
            if (resolved != null && resolved.isCall()
                    && "JSON.stringify".equals(resolved.getFirstChild().getQualifiedName())) return JSON_BODY;
            return FORM_BODY;
        }

        private void addObjectParameters(List<JavascriptAnalysis.Parameter> out, Node raw,
                                         JavascriptAnalysis.ParameterKind kind, String prefix) {
            if (out.size() >= MAX_PARAMETERS_PER_CALL) return;
            Node object = resolve(raw, 0);
            if (object == null || !object.isObjectLit()) return;
            for (Node property : object.children()) {
                if (out.size() >= MAX_PARAMETERS_PER_CALL || !property.isStringKey()) continue;
                String name = property.getString();
                if (name == null || name.isBlank()) continue;
                String path = prefix.isBlank() ? name : prefix + "." + name;
                Node value = property.getFirstChild();
                Node resolvedValue = resolve(value, 0);
                if (kind == JSON_BODY && resolvedValue != null && resolvedValue.isObjectLit()) {
                    addObjectParameters(out, resolvedValue, kind, path);
                } else {
                    out.add(new JavascriptAnalysis.Parameter(path, kind));
                }
            }
        }

        private Node resolve(Node node, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return node;
            if (node.isName()) {
                Node value = constants.get(node.getString());
                return value == null || value == node ? node : resolve(value, depth + 1);
            }
            return node;
        }

        private String staticReference(Node node, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, depth);
            if (value.isStringLit()) return value.getString();
            if (value.isTemplateLit()) return templateReference(value, depth + 1);
            if (value.isAdd()) {
                String left = referencePart(value.getFirstChild(), depth + 1);
                String right = referencePart(value.getLastChild(), depth + 1);
                if (left == null || right == null) return null;
                String joined = left + right;
                return hasStaticRouteShape(joined) ? collapsePlaceholders(joined) : null;
            }
            return null;
        }

        private String referencePart(Node node, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, depth);
            String exact = staticString(value, depth + 1);
            if (exact != null) return exact;
            if (value.isTemplateLit()) return templateReference(value, depth + 1);
            if (value.isAdd()) return staticReference(value, depth + 1);
            return "{expr}";
        }

        private String templateReference(Node template, int depth) {
            StringBuilder out = new StringBuilder();
            for (Node part : template.children()) {
                if (part.isTemplateLitString()) out.append(part.getCookedString());
                else if (part.isTemplateLitSub()) {
                    Node expression = part.getFirstChild();
                    String exact = staticString(expression, depth + 1);
                    out.append(exact == null ? "{expr}" : exact);
                }
            }
            String value = collapsePlaceholders(out.toString());
            return hasStaticRouteShape(value) ? value : null;
        }

        private String staticString(Node node, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, depth);
            if (value.isStringLit()) return value.getString();
            if (value.isTemplateLit()) {
                StringBuilder out = new StringBuilder();
                for (Node part : value.children()) {
                    if (part.isTemplateLitString()) out.append(part.getCookedString());
                    else if (part.isTemplateLitSub()) {
                        String exact = staticString(part.getFirstChild(), depth + 1);
                        if (exact == null) return null;
                        out.append(exact);
                    }
                }
                return out.toString();
            }
            if (value.isAdd()) {
                String left = staticString(value.getFirstChild(), depth + 1);
                String right = staticString(value.getLastChild(), depth + 1);
                return left == null || right == null ? null : left + right;
            }
            return null;
        }

        private Node property(Node object, String name) {
            if (object == null || !object.isObjectLit()) return null;
            for (Node child : object.children()) {
                if (child.isStringKey() && child.getString().equals(name)) return child.getFirstChild();
            }
            return null;
        }

        private String stringProperty(Node object, String name) {
            return staticString(property(object, name), 0);
        }

        private void collectAxiosImport(Node importNode) {
            Node module = importNode.getLastChild();
            if (module == null || !module.isStringLit() || !module.getString().equals("axios")) return;
            for (Node child : importNode.children()) {
                if (child.isName() && !child.getString().isBlank()) axiosAliases.add(child.getString());
            }
        }

        private boolean isAxiosCreate(Node node) {
            return node != null && node.isCall() && "axios.create".equals(node.getFirstChild().getQualifiedName());
        }

        private boolean isNewXmlHttpRequest(Node node) {
            return node != null && node.isNew() && node.getFirstChild() != null
                    && "XMLHttpRequest".equals(node.getFirstChild().getQualifiedName());
        }
    }

    private static List<Node> arguments(Node callOrNew) {
        List<Node> args = new ArrayList<>();
        Node child = callOrNew.getFirstChild();
        if (child == null) return args;
        for (child = child.getNext(); child != null; child = child.getNext()) args.add(child);
        return args;
    }

    private static boolean isFetch(String qualified) {
        return "fetch".equals(qualified) || "window.fetch".equals(qualified)
                || "globalThis.fetch".equals(qualified);
    }

    private static boolean routeLike(String value) {
        if (value == null || value.isBlank()) return false;
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.startsWith("/") || lower.startsWith("./") || lower.startsWith("../")
                || lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")
                || (!lower.contains(" ") && lower.contains("/"));
    }

    private static boolean scriptReference(String value) {
        if (value == null || value.isBlank()) return false;
        String clean = value.split("[?#]", 2)[0].toLowerCase(Locale.ROOT);
        return routeLike(value) && (clean.endsWith(".js") || clean.endsWith(".mjs")
                || clean.endsWith(".cjs") || !clean.substring(clean.lastIndexOf('/') + 1).contains("."));
    }

    private static boolean hasStaticRouteShape(String value) {
        if (value == null) return false;
        String staticPart = value.replace("{expr}", "");
        return routeLike(staticPart);
    }

    private static String collapsePlaceholders(String value) {
        return value.replaceAll("(?:\\{expr})+", "{expr}");
    }

    private static String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }
}
