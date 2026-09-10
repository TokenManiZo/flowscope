package io.flowscope.core.discovery;

import com.google.javascript.jscomp.BlackHoleErrorManager;
import com.google.javascript.jscomp.CompilerOptions;
import com.google.javascript.jscomp.NodeTraversal;
import com.google.javascript.jscomp.NodeUtil;
import com.google.javascript.jscomp.Scope;
import com.google.javascript.jscomp.SourceFile;
import com.google.javascript.jscomp.Var;
import com.google.javascript.rhino.Node;
import com.google.javascript.rhino.Token;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.IdentityHashMap;
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
    private static final int MAX_NODES = Integer.getInteger("flowscope.javascript.maxNodes", 2_000_000);
    private static final int MAX_CALL_SITES = Integer.getInteger("flowscope.javascript.maxCallSites", 100_000);
    private static final int MAX_ASSETS = Integer.getInteger("flowscope.javascript.maxAssets", 100_000);
    private static final int MAX_ISSUES = Integer.getInteger("flowscope.javascript.maxIssues", 100_000);
    private static final int MAX_PARAMETERS_PER_CALL = Integer.getInteger(
            "flowscope.javascript.maxParametersPerCall", 4_096);
    private static final int MAX_RESOLUTION_DEPTH = Integer.getInteger(
            "flowscope.javascript.maxResolutionDepth", 32);
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
        String cacheKey = cacheKey(script);
        synchronized (CACHE) {
            JavascriptAnalysis cached = CACHE.get(cacheKey);
            if (cached != null) return cached;
        }
        JavascriptAnalysis analysis = JavascriptAnalysisProcess.analyze(script);
        synchronized (CACHE) {
            CACHE.put(cacheKey, analysis);
        }
        return analysis;
    }

    public static void clearCache() {
        synchronized (CACHE) { CACHE.clear(); }
    }

    static JavascriptAnalysis analyzeInWorker(String script) {
        return parse(script);
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
            MutationCollector mutationCollector = new MutationCollector();
            NodeTraversal.traverse(compiler, root, mutationCollector);
            if (mutationCollector.limited) {
                return new JavascriptAnalysis(List.of(), List.of(), List.of(),
                        JavascriptAnalysis.Status.LIMIT_EXCEEDED,
                        "AST exceeds " + MAX_NODES + " node traversal limit");
            }
            Analyzer analyzer = new Analyzer(mutationCollector.mutatedDeclarations);
            NodeTraversal.traverse(compiler, root, analyzer);
            JavascriptAnalysis.Status status = analyzer.limited ? JavascriptAnalysis.Status.LIMIT_EXCEEDED
                    : compiler.getErrorCount() == 0 ? JavascriptAnalysis.Status.PARSED
                    : JavascriptAnalysis.Status.PARTIAL;
            String detail = compiler.getErrorCount() == 0 ? ""
                    : "parser recovered with " + compiler.getErrorCount() + " syntax error(s)";
            if (analyzer.limited) detail = "AST or extracted facts exceed configured worker budget";
            return new JavascriptAnalysis(analyzer.callSites, analyzer.assets, analyzer.issues, status, detail);
        } catch (RuntimeException | LinkageError | StackOverflowError exception) {
            return new JavascriptAnalysis(List.of(), List.of(), JavascriptAnalysis.Status.PARSE_FAILED,
                    exception.getClass().getSimpleName());
        }
    }

    private static final class MutationCollector implements NodeTraversal.Callback {
        private final Set<Node> mutatedDeclarations = Collections.newSetFromMap(new IdentityHashMap<>());
        private int nodes;
        private boolean limited;

        @Override
        public boolean shouldTraverse(NodeTraversal traversal, Node node, Node parent) {
            if (limited || nodes++ >= MAX_NODES) {
                limited = true;
                return false;
            }
            return true;
        }

        @Override
        public void visit(NodeTraversal traversal, Node node, Node parent) {
            if (!NodeUtil.isAssignmentOp(node) && !node.isInc() && !node.isDec()) return;
            Node target = node.getFirstChild();
            while (target != null && (target.isGetProp() || target.isGetElem())) {
                target = target.getFirstChild();
            }
            if (target == null || !target.isName()) return;
            Var variable = traversal.getScope().getVar(target.getString());
            if (variable != null && variable.getNameNode() != null) {
                mutatedDeclarations.add(variable.getNameNode());
            }
        }
    }

    private static final class Analyzer implements NodeTraversal.Callback {
        private final Set<Node> mutatedDeclarations;
        private final Set<Var> axiosImports = Collections.newSetFromMap(new IdentityHashMap<>());
        private final List<JavascriptAnalysis.CallSite> callSites = new ArrayList<>();
        private final List<JavascriptAnalysis.AssetReference> assets = new ArrayList<>();
        private final List<JavascriptAnalysis.ResolutionIssue> issues = new ArrayList<>();
        private int nodes;
        private boolean limited;

        private Analyzer(Set<Node> mutatedDeclarations) {
            this.mutatedDeclarations = mutatedDeclarations;
        }

        @Override
        public boolean shouldTraverse(NodeTraversal traversal, Node node, Node parent) {
            if (nodes++ >= MAX_NODES || callSites.size() >= MAX_CALL_SITES || assets.size() >= MAX_ASSETS) {
                limited = true;
                return false;
            }
            return true;
        }

        @Override
        public void visit(NodeTraversal traversal, Node node, Node parent) {
            if (limited) return;
            Scope scope = traversal.getScope();
            if (node.isImport()) collectAxiosImport(node, scope);
            if (node.isCall()) inspectCall(node, scope);
            if (node.isImport()) inspectStaticImport(node);
            if (node.getToken() == Token.DYNAMIC_IMPORT) inspectDynamicImport(node, scope);
        }

        private void inspectStaticImport(Node node) {
            Node module = node.getLastChild();
            if (module == null || !module.isStringLit()) return;
            addAsset(module.getString(), "ECMAScript static import", node);
        }

        private void inspectDynamicImport(Node node, Scope scope) {
            addAsset(staticReference(node.getFirstChild(), scope, 0), "ECMAScript dynamic import", node);
        }

        private void addAsset(String reference, String reason, Node node) {
            if (!scriptReference(reference) || assets.size() >= MAX_ASSETS) return;
            JavascriptAnalysis.AssetReference asset = new JavascriptAnalysis.AssetReference(reference, reason,
                    node.getLineno(), node.getCharno());
            if (!assets.contains(asset)) assets.add(asset);
        }

        private void inspectCall(Node call, Scope scope) {
            Node target = call.getFirstChild();
            if (target == null) return;
            String qualified = target.getQualifiedName();
            if (isFetch(qualified)) {
                inspectFetch(call, scope);
                return;
            }
            if (qualified != null && qualified.endsWith(".sendBeacon")) {
                inspectBeacon(call, scope);
                return;
            }
            if (qualified != null && qualified.endsWith(".open")) {
                inspectXhr(call, qualified.substring(0, qualified.length() - 5), scope);
                return;
            }
            if (qualified != null && qualified.startsWith("$.")) {
                inspectJquery(call, qualified.substring(2).toLowerCase(Locale.ROOT), scope);
                return;
            }
            if (!inspectAxios(call, qualified, scope)) inspectUnknownWrapper(call, qualified, scope);
        }

        private void inspectFetch(Node call, Scope scope) {
            List<Node> args = arguments(call);
            if (args.isEmpty()) return;
            String reference = staticReference(args.get(0), scope, 0);
            if (!routeLike(reference)) {
                addReferenceIssue(args.get(0), scope, "fetch", call);
                return;
            }
            Node options = args.size() > 1 ? resolve(args.get(1), scope, 0) : null;
            String method = stringProperty(options, "method", scope);
            if (method == null) method = args.size() == 1 ? "GET" : "UNKNOWN";
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            Node body = property(options, "body", scope);
            addBodyParameters(parameters, body, bodyKind(body, options, scope), scope);
            add(reference, method, parameters, "fetch AST call-site", call);
        }

        private boolean inspectAxios(Node call, String qualified, Scope scope) {
            if (qualified == null) return false;
            List<Node> args = arguments(call);
            int dot = qualified.indexOf('.');
            String receiver = dot < 0 ? qualified : qualified.substring(0, dot);
            AxiosDefaults defaults = axiosDefaults(receiver, scope, 0);
            if (defaults == null) return false;
            String operation = dot < 0 ? "call" : qualified.substring(dot + 1).toLowerCase(Locale.ROOT);
            if (operation.equals("request") || operation.equals("call")) {
                if (args.isEmpty()) return true;
                Node config = resolve(args.get(0), scope, 0);
                Node url = property(config, "url", scope);
                String reference = axiosReference(url, config, defaults, scope, call);
                if (!routeLike(reference)) return true;
                String method = stringProperty(config, "method", scope);
                List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
                addObjectParameters(parameters, property(config, "params", scope), QUERY, "", scope);
                addObjectParameters(parameters, property(config, "data", scope), JSON_BODY, "", scope);
                add(reference, method, parameters, "axios config AST call-site", call);
                return true;
            }
            String method = operation.toUpperCase(Locale.ROOT);
            if (!HTTP_METHODS.contains(method) || args.isEmpty()) return true;
            boolean bodyMethod = Set.of("POST", "PUT", "PATCH", "DELETE").contains(method);
            Node config = args.size() > (bodyMethod ? 2 : 1) ? args.get(bodyMethod ? 2 : 1) : null;
            Node resolvedConfig = resolve(config, scope, 0);
            String reference = axiosReference(args.get(0), resolvedConfig, defaults, scope, call);
            if (!routeLike(reference)) return true;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            if (bodyMethod && args.size() > 1) {
                addObjectParameters(parameters, args.get(1), JSON_BODY, "", scope);
            }
            addObjectParameters(parameters, property(resolvedConfig, "params", scope), QUERY, "", scope);
            add(reference, method, parameters, "axios verb AST call-site", call);
            return true;
        }

        private void inspectXhr(Node call, String receiver, Scope scope) {
            String root = receiver.contains(".") ? receiver.substring(0, receiver.indexOf('.')) : receiver;
            Var variable = scope.getVar(root);
            if (variable == null || mutatedDeclarations.contains(variable.getNameNode())
                    || !isNewXmlHttpRequest(variable.getInitialValue())) return;
            List<Node> args = arguments(call);
            if (args.size() < 2) return;
            String method = staticString(args.get(0), scope, 0);
            String reference = staticReference(args.get(1), scope, 0);
            if (routeLike(reference)) add(reference, method, queryParameters(reference),
                    "XMLHttpRequest.open AST call-site", call);
        }

        private void inspectJquery(Node call, String operation, Scope scope) {
            List<Node> args = arguments(call);
            if (operation.equals("ajax")) {
                if (args.isEmpty()) return;
                Node config = resolve(args.get(0), scope, 0);
                String reference = staticReference(property(config, "url", scope), scope, 0);
                if (!routeLike(reference)) return;
                String method = firstNonBlank(stringProperty(config, "method", scope),
                        stringProperty(config, "type", scope));
                List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
                JavascriptAnalysis.ParameterKind kind = "GET".equalsIgnoreCase(method) ? QUERY : FORM_BODY;
                addObjectParameters(parameters, property(config, "data", scope), kind, "", scope);
                add(reference, method, parameters, "jQuery.ajax AST call-site", call);
                return;
            }
            if (!Set.of("get", "post").contains(operation) || args.isEmpty()) return;
            String reference = staticReference(args.get(0), scope, 0);
            if (!routeLike(reference)) return;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            if (args.size() > 1) addObjectParameters(parameters, args.get(1),
                    operation.equals("get") ? QUERY : FORM_BODY, "", scope);
            add(reference, operation, parameters, "jQuery verb AST call-site", call);
        }

        private void inspectBeacon(Node call, Scope scope) {
            List<Node> args = arguments(call);
            if (args.isEmpty()) return;
            String reference = staticReference(args.get(0), scope, 0);
            if (!routeLike(reference)) return;
            List<JavascriptAnalysis.Parameter> parameters = new ArrayList<>(queryParameters(reference));
            if (args.size() > 1) addObjectParameters(parameters, args.get(1), FORM_BODY, "", scope);
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
                                       JavascriptAnalysis.ParameterKind kind, Scope scope) {
            Node resolved = resolve(body, scope, 0);
            if (resolved != null && resolved.isCall()
                    && "JSON.stringify".equals(resolved.getFirstChild().getQualifiedName())) {
                List<Node> args = arguments(resolved);
                if (!args.isEmpty()) addObjectParameters(out, args.get(0), JSON_BODY, "", scope);
                return;
            }
            if (resolved != null && resolved.isNew()
                    && "URLSearchParams".equals(resolved.getFirstChild().getQualifiedName())) {
                List<Node> args = arguments(resolved);
                if (!args.isEmpty()) addObjectParameters(out, args.get(0), FORM_BODY, "", scope);
                return;
            }
            addObjectParameters(out, resolved, kind, "", scope);
        }

        private JavascriptAnalysis.ParameterKind bodyKind(Node body, Node options, Scope scope) {
            String contentType = staticString(property(resolve(options, scope, 0), "contentType", scope), scope, 0);
            if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("json")) return JSON_BODY;
            Node resolved = resolve(body, scope, 0);
            if (resolved != null && resolved.isCall()
                    && "JSON.stringify".equals(resolved.getFirstChild().getQualifiedName())) return JSON_BODY;
            return FORM_BODY;
        }

        private void addObjectParameters(List<JavascriptAnalysis.Parameter> out, Node raw,
                                         JavascriptAnalysis.ParameterKind kind, String prefix, Scope scope) {
            if (out.size() >= MAX_PARAMETERS_PER_CALL) return;
            Node object = resolve(raw, scope, 0);
            if (object == null || !object.isObjectLit()) return;
            for (Node property : object.children()) {
                if (out.size() >= MAX_PARAMETERS_PER_CALL || !property.isStringKey()) continue;
                String name = property.getString();
                if (name == null || name.isBlank()) continue;
                String path = prefix.isBlank() ? name : prefix + "." + name;
                Node value = property.getFirstChild();
                Node resolvedValue = resolve(value, scope, 0);
                if (kind == JSON_BODY && resolvedValue != null && resolvedValue.isObjectLit()) {
                    addObjectParameters(out, resolvedValue, kind, path, scope);
                } else {
                    out.add(new JavascriptAnalysis.Parameter(path, kind));
                }
            }
        }

        private Node resolve(Node node, Scope scope, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return node;
            if (node.isName()) {
                Var variable = scope.getVar(node.getString());
                if (variable != null && mutatedDeclarations.contains(variable.getNameNode())) return node;
                Node value = variable == null ? null : variable.getInitialValue();
                return value == null || value == node ? node : resolve(value, scope, depth + 1);
            }
            if (node.isGetProp() || node.isGetElem()) {
                Node object = resolve(node.getFirstChild(), scope, depth + 1);
                String name = memberName(node, scope, depth + 1);
                Node value = property(object, name, scope);
                return value == null ? node : resolve(value, scope, depth + 1);
            }
            return node;
        }

        private String staticReference(Node node, Scope scope, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, scope, depth);
            if (value.isStringLit()) return value.getString();
            if (value.isTemplateLit()) return templateReference(value, scope, depth + 1);
            if (value.isAdd()) {
                String left = referencePart(value.getFirstChild(), scope, depth + 1);
                String right = referencePart(value.getLastChild(), scope, depth + 1);
                if (left == null || right == null) return null;
                String joined = left + right;
                return hasStaticRouteShape(joined) ? collapsePlaceholders(joined) : null;
            }
            return null;
        }

        private String referencePart(Node node, Scope scope, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, scope, depth);
            String exact = staticString(value, scope, depth + 1);
            if (exact != null) return exact;
            if (value.isTemplateLit()) return templateReference(value, scope, depth + 1);
            if (value.isAdd()) return staticReference(value, scope, depth + 1);
            return "{expr}";
        }

        private String templateReference(Node template, Scope scope, int depth) {
            StringBuilder out = new StringBuilder();
            for (Node part : template.children()) {
                if (part.isTemplateLitString()) out.append(part.getCookedString());
                else if (part.isTemplateLitSub()) {
                    Node expression = part.getFirstChild();
                    String exact = staticString(expression, scope, depth + 1);
                    out.append(exact == null ? "{expr}" : exact);
                }
            }
            String value = collapsePlaceholders(out.toString());
            return hasStaticRouteShape(value) ? value : null;
        }

        private String staticString(Node node, Scope scope, int depth) {
            if (node == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Node value = resolve(node, scope, depth);
            if (value.isStringLit()) return value.getString();
            if (value.isTemplateLit()) {
                StringBuilder out = new StringBuilder();
                for (Node part : value.children()) {
                    if (part.isTemplateLitString()) out.append(part.getCookedString());
                    else if (part.isTemplateLitSub()) {
                        String exact = staticString(part.getFirstChild(), scope, depth + 1);
                        if (exact == null) return null;
                        out.append(exact);
                    }
                }
                return out.toString();
            }
            if (value.isAdd()) {
                String left = staticString(value.getFirstChild(), scope, depth + 1);
                String right = staticString(value.getLastChild(), scope, depth + 1);
                return left == null || right == null ? null : left + right;
            }
            return null;
        }

        private Node property(Node object, String name, Scope scope) {
            Node resolved = resolve(object, scope, 0);
            if (resolved == null || name == null || !resolved.isObjectLit()) return null;
            for (Node child : resolved.children()) {
                if (child.isStringKey() && child.getString().equals(name)) return child.getFirstChild();
            }
            return null;
        }

        private String stringProperty(Node object, String name, Scope scope) {
            return staticString(property(object, name, scope), scope, 0);
        }

        private void collectAxiosImport(Node importNode, Scope scope) {
            Node module = importNode.getLastChild();
            if (module == null || !module.isStringLit() || !module.getString().equals("axios")) return;
            for (Node child : importNode.children()) {
                collectImportedNames(child, scope);
            }
        }

        private void collectImportedNames(Node node, Scope scope) {
            if (node == null || node.isStringLit()) return;
            if (node.isName() && !node.getString().isBlank()) {
                Var variable = scope.getVar(node.getString());
                if (variable != null) axiosImports.add(variable);
            }
            for (Node child : node.children()) collectImportedNames(child, scope);
        }

        private String memberName(Node member, Scope scope, int depth) {
            if (member == null) return null;
            if (member.isGetProp()) return member.getString();
            Node key = member.getLastChild();
            if (key == null || key == member.getFirstChild()) return null;
            return member.isGetElem() ? staticString(key, scope, depth + 1) : null;
        }

        private AxiosDefaults axiosDefaults(String receiver, Scope scope, int depth) {
            if (receiver == null || depth >= MAX_RESOLUTION_DEPTH) return null;
            Var variable = scope.getVar(receiver);
            if (variable != null && axiosImports.contains(variable)) return AxiosDefaults.library();
            if ("axios".equals(receiver) && variable == null) return AxiosDefaults.library();
            if (variable == null) return null;
            if (mutatedDeclarations.contains(variable.getNameNode())) return null;
            Node initial = variable.getInitialValue();
            if (initial == null) return null;
            if (initial.isName()) return axiosDefaults(initial.getString(), scope, depth + 1);
            if (!initial.isCall()) return null;
            Node target = initial.getFirstChild();
            if (target == null || !(target.isGetProp() || target.isGetElem())
                    || !"create".equals(memberName(target, scope, depth + 1))) return null;
            Node creator = target.getFirstChild();
            if (creator == null || !creator.isName()
                    || axiosDefaults(creator.getString(), scope, depth + 1) == null) return null;
            List<Node> args = arguments(initial);
            Node config = args.isEmpty() ? null : resolve(args.get(0), scope, depth + 1);
            return axiosConfig(AxiosDefaults.library(), config, scope);
        }

        private AxiosDefaults axiosConfig(AxiosDefaults defaults, Node config, Scope scope) {
            Node resolved = resolve(config, scope, 0);
            if (resolved == null || !resolved.isObjectLit()) return defaults;
            Node base = property(resolved, "baseURL", scope);
            boolean basePresent = hasProperty(resolved, "baseURL");
            String baseUrl = basePresent ? staticString(base, scope, 0) : defaults.baseUrl();
            boolean baseKnown = basePresent ? baseUrl != null : defaults.baseKnown();
            Node allow = property(resolved, "allowAbsoluteUrls", scope);
            boolean allowPresent = hasProperty(resolved, "allowAbsoluteUrls");
            Boolean allowAbsolute = allowPresent ? staticBoolean(allow, scope) : defaults.allowAbsoluteUrls();
            return new AxiosDefaults(baseUrl, baseKnown, allowAbsolute);
        }

        private String axiosReference(Node url, Node requestConfig, AxiosDefaults defaults,
                                      Scope scope, Node call) {
            String requested = staticReference(url, scope, 0);
            if (requested == null || requested.isBlank()) {
                addReferenceIssue(url, scope, "axios", call);
                return null;
            }
            AxiosDefaults effective = axiosConfig(defaults, requestConfig, scope);
            boolean absolute = absoluteUrl(requested);
            if (absolute && Boolean.TRUE.equals(effective.allowAbsoluteUrls())) return requested;
            if (!effective.baseKnown()) {
                addIssue(JavascriptAnalysis.ResolutionIssueKind.UNRESOLVED_AXIOS_BASE_URL,
                        "axios", "axios baseURL is not statically resolvable", call);
                return null;
            }
            if (effective.baseUrl() == null || effective.baseUrl().isBlank()) return requested;
            if (absolute && effective.allowAbsoluteUrls() == null) {
                addIssue(JavascriptAnalysis.ResolutionIssueKind.UNRESOLVED_AXIOS_BASE_URL,
                        "axios", "axios allowAbsoluteUrls is not statically resolvable", call);
                return null;
            }
            return normalizeReference(combineUrls(effective.baseUrl(), requested));
        }

        private boolean hasProperty(Node object, String name) {
            if (object == null || !object.isObjectLit()) return false;
            for (Node child : object.children()) {
                if (child.isStringKey() && child.getString().equals(name)) return true;
            }
            return false;
        }

        private Boolean staticBoolean(Node node, Scope scope) {
            Node resolved = resolve(node, scope, 0);
            if (resolved == null) return null;
            if (resolved.isTrue()) return true;
            if (resolved.isFalse()) return false;
            return null;
        }

        private void addReferenceIssue(Node raw, Scope scope, String adapter, Node call) {
            Node resolved = resolve(raw, scope, 0);
            JavascriptAnalysis.ResolutionIssueKind kind;
            String detail;
            if (raw != null && (raw.isGetProp() || raw.isGetElem())) {
                kind = JavascriptAnalysis.ResolutionIssueKind.UNRESOLVED_MEMBER_REFERENCE;
                detail = "member URL reference is not statically resolvable";
            } else if (resolved != null && resolved.isCall()) {
                kind = JavascriptAnalysis.ResolutionIssueKind.UNSUPPORTED_INTERPROCEDURAL_FLOW;
                detail = "URL returned by a function is not followed";
            } else {
                kind = JavascriptAnalysis.ResolutionIssueKind.DYNAMIC_URL;
                detail = "URL expression is not statically resolvable";
            }
            addIssue(kind, adapter, detail, call);
        }

        private void inspectUnknownWrapper(Node call, String qualified, Scope scope) {
            if (qualified == null || qualified.indexOf('.') < 0) return;
            String receiver = qualified.substring(0, qualified.indexOf('.')).toLowerCase(Locale.ROOT);
            if (!(receiver.contains("api") || receiver.contains("http")
                    || receiver.contains("client") || receiver.contains("request"))) return;
            List<Node> args = arguments(call);
            if (args.isEmpty() || !routeLike(staticReference(args.get(0), scope, 0))) return;
            addIssue(JavascriptAnalysis.ResolutionIssueKind.UNRECOGNIZED_APPLICATION_WRAPPER,
                    "javascript-ast", "HTTP-like application wrapper has no declared adapter", call);
        }

        private void addIssue(JavascriptAnalysis.ResolutionIssueKind kind, String adapter,
                              String detail, Node node) {
            if (issues.size() >= MAX_ISSUES) return;
            JavascriptAnalysis.ResolutionIssue issue = new JavascriptAnalysis.ResolutionIssue(
                    kind, adapter, detail, node.getLineno(), node.getCharno());
            if (!issues.contains(issue)) issues.add(issue);
        }

        private boolean isNewXmlHttpRequest(Node node) {
            return node != null && node.isNew() && node.getFirstChild() != null
                    && "XMLHttpRequest".equals(node.getFirstChild().getQualifiedName());
        }

        private record AxiosDefaults(String baseUrl, boolean baseKnown, Boolean allowAbsoluteUrls) {
            private static AxiosDefaults library() { return new AxiosDefaults(null, true, true); }
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

    private static boolean absoluteUrl(String value) {
        return value != null && value.matches("(?i)^([a-z][a-z0-9+.-]*:)?//.*");
    }

    private static String combineUrls(String baseUrl, String relativeUrl) {
        if (relativeUrl == null || relativeUrl.isBlank()) return baseUrl;
        String base = baseUrl.replaceFirst("/+$", "");
        String relative = relativeUrl.replaceFirst("^/+", "");
        return base + "/" + relative;
    }

    private static String normalizeReference(String value) {
        if (value.startsWith("/") && value.indexOf("://") > 0) return value;
        try {
            return URI.create(value.replace("{expr}", "flowscope-expression"))
                    .normalize().toString().replace("flowscope-expression", "{expr}");
        } catch (RuntimeException ignored) {
            return value;
        }
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
