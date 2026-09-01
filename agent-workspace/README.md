# Agent workspace

This directory contains the repeatable manual fallback for FlowScope Explorer and final Judge with Codex or Claude Code subscriptions. The beta.38 primary flow is the Web quick-start `LLM Explorer 시작` and `Judge 시작` buttons. FlowScope discovers standard CLI installations, checks the provider's official sign-in status, creates isolated role-specific workspaces, injects the MCP contract, and starts Explorer and Judge as separate CLI sessions. Explorer may open FlowScope's isolated installed-Chrome worker for rendered discovery; browser output must be replayed through the controlled executor to become Evidence. This directory does not contain model-provider credentials.

Use the steps below only when the Web launcher cannot find or start the local CLI. Do not run this manual workflow at the same time as a button-launched Explorer or Judge.

1. Load FlowScope in Burp and use **연결 문자열 복사** in the **FlowScope** Burp tab.
2. Export it only in the terminal that will start the agent: `export FLOWSCOPE_MCP_TOKEN='…'`. For unattended local startup, create `~/.flowscope/mcp-token` with mode `0600` before loading FlowScope, then export that same value.
3. Trust this project in Codex, then start `codex` or `claude` from this directory so its project instructions and MCP configuration apply. Codex intentionally ignores project-scoped `.codex/` configuration in an untrusted project.
4. Before a run, verify discovery with `codex mcp get flowscope` (Codex) or the client's MCP server list. It must show `http://127.0.0.1:8787/mcp` and bearer-token environment variable `FLOWSCOPE_MCP_TOKEN`. Do not add a duplicate global server when the project entry is already present.
5. In the FlowScope Web UI, capture each test-account session through HUMAN port 8080. Give the agent only the exact authorized target, safe account IDs, and safety constraints; never paste raw cookies or tokens.
6. Run `prompts/explorer.md` as an independent-first lane. It may configure only the exact operator-supplied target before a run and starts with `flowscope_target_read`; FlowScope's isolated browser is an optional rendered-app fallback, not the primary API transport. Browser-discovered routes are replayed through the controlled executor, and browser interactions and writes retain Burp approval. It must first exhaust concrete safe routes derived from its own run. FlowScope then exposes source- and Evidence-free route hints from the other collection lanes to improve recall. It cannot complete until both frontiers have no unrequested concrete safe route and controlled response Evidence exists for that exact run.
7. After HUMAN, deterministic ZAP, and Explorer have each completed, run `prompts/judge.md` in a separate fresh session. Judge locks only the frozen Evidence IDs from the three exact completed runs, correlates gaps, unrequested routes, and ZAP alerts, captures controlled validation Evidence, and submits final bundles itself.

Example: `codex "Read AGENTS.md, then execute prompts/explorer.md against the authorized target I provide."`

Do not export a global HTTP proxy. The agent never performs direct target networking; FlowScope sends exact-scope target requests through Burp and injects only an explicitly selected memory-only account session.
Raw session material is never returned to the agent or written to a FlowScope project. Reauthenticate in the Web UI when the broker marks a session suspect or expired.

Codex MCP configuration behavior is documented by OpenAI at <https://developers.openai.com/codex/mcp>. FlowScope uses the project-scoped trusted-project form so cloning the repository does not mutate the user's global Codex configuration.
