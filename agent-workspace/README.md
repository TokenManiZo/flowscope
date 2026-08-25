# Agent workspace

This directory contains the repeatable FlowScope Explorer and final Judge workflow for Codex or Claude Code subscriptions. It does not contain model-provider credentials.

1. Load FlowScope in Burp and use **연결 문자열 복사** in the **FlowScope** Burp tab.
2. Export it only in the terminal that will start the agent: `export FLOWSCOPE_MCP_TOKEN='…'`. For unattended local startup, create `~/.flowscope/mcp-token` with mode `0600` before loading FlowScope, then export that same value.
3. Start `codex` or `claude` from this directory so its project instructions and MCP configuration apply.
4. In the FlowScope Web UI, capture each test-account session through HUMAN port 8080. Give the agent only the exact authorized target, safe account IDs, and safety constraints; never paste raw cookies or tokens.
5. After the HUMAN and deterministic ZAP lanes complete, ask the agent to execute `prompts/explorer.md`. It may configure only the exact operator-supplied target before a run and uses `flowscope_target_request` exclusively.
6. After Explorer ends, ask it to execute `prompts/judge.md`. Judge locks the three-lane dataset, correlates gaps and ZAP alerts, captures controlled validation Evidence, and submits final bundles itself.

Example: `codex "Read AGENTS.md, then execute prompts/explorer.md against the authorized target I provide."`

Do not export a global HTTP proxy. The agent never performs direct target networking; FlowScope sends exact-scope target requests through Burp and injects only an explicitly selected memory-only account session.
Raw session material is never returned to the agent or written to a FlowScope project. Reauthenticate in the Web UI when the broker marks a session suspect or expired.
