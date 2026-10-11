package io.flowscope;

import io.flowscope.core.AnalysisConfig;
import io.flowscope.core.BurpXmlParser;
import io.flowscope.core.LegacyAssessment;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.RunContextRegistry;
import io.flowscope.core.ValidationDecision;
import io.flowscope.explorer.CodexCliTerminal;
import io.flowscope.explorer.ExplorerCoordinator;
import io.flowscope.explorer.ExplorerProvider;
import io.flowscope.web.FlowScopeWebServer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

/** Opt-in browser gate: real Codex TUI behind the shipped Web UI, with no model prompt or target request. */
public final class CodexTerminalWebHarness {
    private CodexTerminalWebHarness() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("an isolated work directory is required");
        Path workspace = Path.of(args[0]).toAbsolutePath().normalize();
        Files.createDirectories(workspace);
        CodexCliTerminal terminal = new CodexCliTerminal();
        RunContextRegistry contexts = new RunContextRegistry();
        FlowScopeWebServer.State state = new FlowScopeWebServer.State() {
            @Override public Pipeline.Result snapshot() { return Pipeline.run(List.of()); }
            @Override public long revision() { return 1; }
            @Override public AnalysisConfig config() { return new AnalysisConfig(); }
            @Override public List<LegacyAssessment> assessments() { return List.of(); }
            @Override public List<ValidationDecision> validations() { return List.of(); }
            @Override public RunContextRegistry contexts() { return contexts; }
            @Override public List<String> scopeEntries() { return List.of("https://fixture.example.test"); }
            @Override public void rebuild() { }
            @Override public void loadSample() { }
            @Override public BurpXmlParser.ParseResult importHar(byte[] har) { throw new UnsupportedOperationException(); }
            @Override public RequestRecord openInRepeater(String evidenceId, String request,
                    FlowScopeWebServer.CredentialMode mode, String accountId) {
                throw new UnsupportedOperationException();
            }
            @Override public ExplorerCoordinator.Snapshot explorerStatus() {
                return new ExplorerCoordinator.Snapshot(ExplorerCoordinator.Status.IDLE, "", "", null, null,
                        0, "Explorer 실행 대기", "READY", List.of(), false,
                        0, 0, 0, 0, 0, List.of(), List.of());
            }
            @Override public ExplorerProvider.ModelCatalog explorerModels() {
                return new ExplorerProvider.ModelCatalog("", List.of());
            }
            @Override public CodexCliTerminal.Poll codexTerminalPoll(long cursor) { return terminal.poll(cursor); }
            @Override public CodexCliTerminal.Poll codexTerminalStatus() { return terminal.status(); }
            @Override public CodexCliTerminal.Poll startCodexTerminal(int columns, int rows, boolean resume) {
                Map<String, String> environment = new LinkedHashMap<>(System.getenv());
                environment.put("TERM", "xterm-256color");
                environment.put("COLORTERM", "truecolor");
                try {
                    return terminal.start("real-cli-web-smoke", workspace,
                            CodexCliTerminal.codexCommand(workspace, 19999, resume), environment,
                            columns, rows, ignored -> {});
                } catch (IOException error) { throw new IllegalStateException(error); }
            }
            @Override public void inputCodexTerminal(byte[] input) {
                try { terminal.input(input); }
                catch (IOException error) { throw new IllegalStateException(error); }
            }
            @Override public void resizeCodexTerminal(int columns, int rows) { terminal.resize(columns, rows); }
            @Override public void stopCodexTerminal() { terminal.stop(); }
        };
        try (FlowScopeWebServer server = new FlowScopeWebServer(state, 17778)) {
            server.start();
            System.out.println("FlowScope CLI Web gate: " + server.url());
            new CountDownLatch(1).await();
        } finally { terminal.close(); }
    }
}
