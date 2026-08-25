# FlowScope 1.2 Beta

This is the English user guide. The repository root [README](../../README.md) is the canonical Korean guide. See also the English [changelog](CHANGELOG.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

FlowScope is a Burp Suite Community-compatible extension that aligns real target traffic from three actors—**HUMAN, SCANNER, and LLM**—into one identity-aware authorization graph and coverage matrix. It highlights missed endpoint/object combinations and evidence-grounded BOLA/IDOR and BFLA candidates without treating an LLM guess as a confirmed vulnerability.

```
identity ──access──▶ resource ──calls──▶ operation
 user-b              orders:101          GET /api/orders/{id}
```

## What is included

- Live Burp capture with independent source, sub-source, orchestrator, tool, phase, and run metadata.
- Exact-scope Evidence capture for every source. HUMAN may browse other sites through Burp, but out-of-scope responses are not stored or graphed by FlowScope.
- HUMAN / SCANNER / LLM filters and an IDA-style hierarchical graph with orthogonal edges and bounded expandable groups.
- Identity × operation × resource coverage matrix, uncrossed combinations, partial discovery, and source conflicts.
- Deterministic BOLA/IDOR and BFLA candidate engine using response taxonomy, explicit owner evidence, and user-supplied role policy.
- Secret-free test-account registry plus an explicit memory-only session broker for scoped HUMAN login capture, cookie rotation, expiry/suspect detection, and account-bound ZAP/LLM requests.
- Query, request body, masked request/response, timestamp, redirect, GraphQL operation, and response-to-request data-flow capture.
- Evidence-preserving traffic classification: every captured observation remains inspectable while only high-confidence navigation, static assets, real CORS preflights, no-response records, and non-discovery phases stay out of coverage analysis by default.
- Explicit `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` authentication state. Unbound cookie rotation no longer explodes graph identities, and verified account bindings remain service-scoped.
- Localhost-only authenticated MCP server for Codex and Claude Code subscription clients.
- System-owned ZAP baseline: Traditional Spider, strict Client Spider with AJAX fallback, passive queue completion, and native alerts. Active Scan remains separate and approval-gated.
- Closed-world LLM execution through an exact-scope FlowScope request tool; direct external traffic is never trusted for decisive verdicts.
- Server-enforced independent Explorer view, immutable three-lane dataset lock, and final LLM Judge synthesis.
- One-click import of existing Burp Proxy history with multiplicity-preserving duplicate suppression, plus a no-network onboarding sample.
- Masked, versioned `.flowscope.json` project save/load with account/session bindings, policies, LLM assessments, server-validated final verdicts, and human audit decisions.
- Evidence-to-Repeater handoff that opens a masked, unsent draft for explicit human validation.
- Evidence-bound LLM validation using repeated reproduction and authorized-control observations, with human audit/override.
- Strict Burp XML import with XXE protection and item-level error skipping.

FlowScope does not know the complete black-box attack surface, so it never reports a misleading coverage percentage.

## Requirements

- JDK 21 or newer
- Maven 3.9 or newer to build from source
- Burp Suite Community or Professional with Montoya API support
- Optional: OWASP ZAP for the scanner lane
- Optional: a locally authenticated Codex or Claude Code client for the LLM lane and final Judge

## Build and install

```bash
mvn clean verify
```

Load **only** `target/flowscope-1.2.0-beta.3.jar` in **Burp → Extensions → Installed → Add → Java**. Maven Shade also creates `target/original-flowscope-1.2.0-beta.3.jar`; that is an unbundled intermediate JAR and is not a Burp distribution. Loading it produces a generic `Extension class is not a recognized type` error. This confusing intermediate artifact is a recorded beta packaging issue and will be removed from the public install surface.

## Repository layout

- [`src/main`](../../src/main) — Burp extension, analysis core, local Web workspace, MCP/ZAP integration, and bundled notices.
- [`src/test`](../../src/test) — deterministic security, parser, analysis, persistence, MCP, and local-Web regression tests.
- [`agent-workspace`](../../agent-workspace) — ready-to-copy Codex/Claude MCP configuration and Explorer/Judge instructions.
- [`docs/ko`](../ko) — canonical Korean architecture, decisions, development log, validation, research, and functional specification.
- [`docs/en`](.) — English user, contribution, security, and changelog documents.
- [`.github`](../../.github) — root-level Maven CI and dependency updates.

Generated files live only under `target/`. Local review packages and machine-specific configuration belong under the ignored `.local/` directory and are not part of the public repository.

The exact beta test boundary and remaining target-phase gates are recorded in the Korean [`docs/ko/beta-validation.md`](../ko/beta-validation.md). A work-by-work account of what was developed, changed, why it changed, affected files, and verification is maintained in [`docs/ko/development-log.md`](../ko/development-log.md). Screen-by-screen design and presentation rationale is in [`docs/ko/ui-product-rationale.md`](../ko/ui-product-rationale.md). Those detailed documents are not presented as English translations.

Create the HUMAN and SCANNER Burp proxy listeners. Montoya cannot create them for the extension. The LLM listener is an optional compatibility fallback; the product workflow uses the controlled MCP executor.

| Listener | Source | Intended client |
|---|---|---|
| `127.0.0.1:8080` | HUMAN | Browser or manual tester |
| `127.0.0.1:8081` | SCANNER | ZAP outgoing target traffic |
| `127.0.0.1:8082` | LLM | Optional direct-client fallback (`UNVERIFIED_RUNTIME`) |

Install Burp's CA certificate in each target client. Do not disable TLS validation as a permanent setup.

Open the **FlowScope** Burp tab, enter one exact authorized scope per line, and click **범위 적용**. A scope includes scheme, host, effective port, and an optional path prefix, for example:

```text
https://api.example.test/v1
http://127.0.0.1:3000/
```

An empty scope blocks MCP-triggered ZAP execution.

## Typical assessment flow

1. Configure the exact scope and use ordinary anonymous or least-privileged test accounts. The Burp tab is the normal control; an MCP client may call `flowscope_set_scope` only with the exact target explicitly authorized by the operator and only before an active SCANNER/LLM run. An admin account is optional and only useful when the engagement requires an explicit role comparison.
2. In **계정·세션**, register secret-free labels such as USER A/USER B. For each account, start login capture, log in through HUMAN port 8080, then end capture. Raw session material remains only in extension memory and is never returned to the LLM or saved in a project. Start the HUMAN pass, browse the authorized workflows, and end the same run. Set identity roles, endpoint requirements, and confirmed resource owners where the target's behavior does not establish them. Two distinct least-privileged test accounts are recommended for BOLA comparison.
3. Configure ZAP's outgoing proxy as `127.0.0.1:8081`. In Web quick-start, select an exact-scope target and optional active account, then run **안전 기준선 실행**. FlowScope fixes the order to Traditional Spider → Client Spider (AJAX fallback) → passive completion → native alerts, and fails the lane if no in-scope scanner traffic was captured. Active Scan is not part of this baseline and always requires a separate Burp approval.
4. Run `agent-workspace/prompts/explorer.md`. The server hides HUMAN/SCANNER results; Explorer uses only `flowscope_target_request`, and FlowScope performs exact-scope routing, session injection, and Evidence capture. The supplied workspace forbids web search, Wayback, external API docs/source repositories, curl, and browser networking.
5. Run `agent-workspace/prompts/judge.md`. Judge locks the completed HUMAN/SCANNER/LLM dataset, reads candidates and native ZAP alerts, submits non-final assessments, and captures narrow safe-GET validation/control Evidence through the same controlled executor.
6. FlowScope accepts `CONFIRMED` or `REJECTED` only when that bundle matches the current candidate and passes the server checks: at least two same-run LLM reproductions, at least one authorized control, matching identity/operation/resource semantics, and response evidence. Everything else remains `INCONCLUSIVE`. Review **시나리오** and Request/Response details; human records are an auditable override, not an unverified automatic finding.
7. Save the session as `.flowscope.json` before unloading Burp if it must be resumed later.

## Codex or Claude subscriptions—no model API key

FlowScope does not call a model API and does not receive a provider OAuth token. Codex or Claude authenticates with the user's own subscription; FlowScope only exposes a local MCP server. The random Bearer value copied with **연결 문자열 복사** in the FlowScope Burp tab protects that localhost server and is not an OpenAI or Anthropic credential. The tab masks it on screen.

For unattended local setup, FlowScope reads `~/.flowscope/mcp-token` when that optional regular file exists and is not accessible by group or others. The token must contain 32-256 URL-safe characters. Delete the file to return to a new random token per Burp session.

```bash
cd agent-workspace
export FLOWSCOPE_MCP_TOKEN='copy-the-value-shown-in-burp'
codex mcp get flowscope
codex     # or: claude
```

Trust the repository when Codex asks before using the project-scoped configuration; Codex ignores `.codex/config.toml` for untrusted projects. `codex mcp get flowscope` must show the local URL and `FLOWSCOPE_MCP_TOKEN` before the run. This check verifies configuration discovery, not that the Burp-hosted MCP server is running or that Explorer/Judge has completed.

The directory contains:

- `.codex/config.toml` for Codex Streamable HTTP MCP.
- `.mcp.json` for Claude Code HTTP MCP.
- `AGENTS.md` and `CLAUDE.md` safety/provenance rules.
- `prompts/explorer.md` and `prompts/judge.md` repeatable workflows (`coach.md` is a compatibility pointer).

Codex clients share MCP configuration through `config.toml` and support Streamable HTTP Bearer authentication; see the [official Codex MCP guide](https://developers.openai.com/codex/mcp). Claude Code supports an HTTP MCP server with an Authorization header; see the [official Claude Code MCP guide](https://docs.anthropic.com/en/docs/claude-code/mcp).

Do not export a global `HTTP_PROXY` or `HTTPS_PROXY`: that can capture model-provider authentication/control traffic. The supplied agent instructions prohibit direct target networking and use the local controlled MCP tool instead.

## Provenance model

`source` answers who generated the target request. `orchestrator` answers who initiated the tool that generated it. They are intentionally independent.

| Activity | Source | Detail | Orchestrator |
|---|---|---|---|
| Manual browser | HUMAN | BROWSER | HUMAN |
| Burp Repeater | HUMAN | BURP_REPEATER | HUMAN |
| ZAP started by tester | SCANNER | ZAP_* | HUMAN |
| Deterministic ZAP baseline | SCANNER | ZAP_* | SYSTEM |
| Approval-gated ZAP Active Scan | SCANNER | ZAP_ACTIVE_SCAN | LLM |
| FlowScope-controlled LLM probe | LLM | LLM_EXPLORER / COACH_PROBE / VALIDATION | LLM |
| Direct 8082 fallback | LLM | configured listener detail | LLM (`UNVERIFIED_RUNTIME`) |

Port defaults can be changed before Burp starts:

```text
-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
-Dflowscope.mcp.port=8787
-Dflowscope.web.port=17777
-Dflowscope.mcp.token=<stable-local-token-if-required>
-Dflowscope.mcp.tokenFile=/absolute/path/to/owner-only-token
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
```

The ZAP API endpoint is accepted only on a loopback address. ZAP itself must be configured to proxy target traffic through the Burp SCANNER listener. An AJAX API response of `OK` means only that ZAP accepted the start request; a stopped run with zero captured records is not a successful assessment.

## Product workspace

- **Burp tab** — exact scope, port mapping, live counts, MCP connection copy, Proxy-history import, project save/load, sample, reset, and a button that opens the canonical local Web workspace.
- **Web top modes** — 그래프, 판정 매트릭스, 흐름 순서, 시나리오, 파싱 결과, and 계정·세션 are stable views over one captured dataset.
- **Left rail** — captured/analysis/hidden/review counts without a fabricated percentage, HUMAN/SCANNER/LLM source filters, Evidence display classes, pseudonymous sessions and roles, three-way gaps, and graph verdict controls.
- **Flow Graph** — fixed identity → resource → operation lanes, with direct identity → operation edges when no object identifier was observed; parallel source overlays using HUMAN blue/solid/H, SCANNER red/dashed/S, and LLM black/dotted/L; a separate authorization-verdict view; focus+context selection; zoom-to-fit; and 18-at-a-time expandable resource/API groups.
- **판정 매트릭스** — observed identity/role × operation × resource cells, per-source verdicts, uncrossed combinations, partial discovery, and conflicts.
- **흐름 순서** — response-to-request ID/token dependencies recovered from timestamped observations.
- **시나리오** — deterministic BOLA/BFLA candidates and gaps alongside non-final Judge assessments and server-validated final verdicts.
- **시나리오 감사·오버라이드** — a human audit surface with Evidence-bound status and masked notes; it does not bypass validation checks.
- **파싱 결과** — masked source, identity, method, normalized operation, resource, status, traffic class/disposition, repeat count, and stable Evidence ID. Selecting a row opens the operation detail and its paginated masked Evidence.
- **계정·세션** — a full-width workspace with secret-free account registration, explicit HUMAN login capture, safe broker status, discovered-session comparison, binding/unbinding, reauthentication, memory revocation, and account removal.
- **Right detail** — per-source verdicts and on-demand masked Request/Response for the selected API, plus a safe Burp Repeater draft handoff. The polling snapshot never transfers every stored message body.

## Decision rules and trust boundary

- A 2xx status is not sufficient by itself.
- 401/403, login redirects, and soft-deny response text are treated as denial evidence.
- OPTIONS/HEAD are excluded from ownership success evidence.
- A write success against a confirmed foreign-owned resource is a high-risk BOLA candidate even with an empty body.
- BFLA requires an explicit identity role and endpoint requirement; FlowScope does not infer admin status from paths or tokens.
- Automatic owner extraction is deliberately conservative. Conflicts and low-confidence first accessors do not produce a vulnerability finding. The operator can confirm a resource owner from its Web graph detail.
- JWT payload fields are unverified grouping hints, never authentication proof. Identities are namespaced by service plus issuer/audience/subject when available.
- Ordinary LLM assessments cannot mark a finding confirmed. Final validation rejects missing, stale, cross-run, cross-candidate, semantically mismatched, or non-`CONTROLLED` Evidence IDs.
- In this beta, decisive automated validation is restricted to safe GET candidates. Write-method validation remains `INCONCLUSIVE` and must not be auto-sent.

## Local MCP tools

Read-only: status, safe session metadata, paginated locked candidates and Evidence, one masked Evidence record, assessments, validated decisions, ZAP environment/passive status, and post-lock native alerts.

State-changing: replace exact scope before active runs, begin/end an LLM run, send a controlled exact-scope target request, lock the completed three-lane dataset, start the deterministic ZAP baseline, submit a non-confirming assessment, submit a server-checked validation bundle, and request approval-gated ZAP Active Scan. The Explorer cannot read cross-source candidates before lock. State-changing target methods require both `confirmed=true` and a separate Burp approval.

The MCP and Web servers bind only to `127.0.0.1`, validate host/origin, require independent random capability tokens for their protected APIs, limit request size, and stop when the extension unloads.

## Data handling

- Raw Authorization/Cookie/CSRF values selected by explicit login capture exist only in the in-memory broker, are never exposed by Web/MCP views, and are wiped from broker buffers on replacement/revocation/unload. They are not written to project files. Java and HTTP libraries may still create short-lived immutable string copies, so this is process-memory containment rather than a hardware secret vault.
- Authorization, Cookie, Set-Cookie, password, token, secret, and API-key values are masked before Evidence storage.
- Authentication grouping uses a subject or a short one-way fingerprint; raw opaque tokens are not retained. Cookie presence alone is not login proof: an unbound cookie fingerprint is retained for audit/binding but shown as one service-scoped `UNRESOLVED` graph identity until a controlled broker match or explicit account binding proves the account.
- Traffic classification never deletes stored Evidence. User `include/exclude/auto` overrides are operation-scoped but cannot turn no-response, unknown-source, or non-discovery validation traffic into discovery coverage; repeated observations are collapsed only in the display and retain every Evidence ID, count, and first/last timestamp.
- Bodies and message detail are truncated to 8 KiB per field; live capture is capped at 20,000 records.
- Project files contain masked traffic but may still contain sensitive application data. POSIX files are written owner-read/write only; protect them under the engagement's data policy.
- Project writes use a temporary file and atomic replacement when the filesystem supports it.

## Honest limitations

- A FlowScope final verdict means the captured authorization behavior met the beta evidence oracle; it does not by itself prove business impact or eliminate the need for engagement reporting review.
- Owner extraction recognizes common scalar owner/user/account fields and explicit nested owner/user/author/account/customer principal objects. Domain-specific ownership should still be confirmed by the operator.
- Session automation covers ordinary cookies, bearer/CSRF headers, rotation, expiry hints, and suspect responses. CAPTCHA, MFA, WebAuthn, device binding, and application-specific refresh/login protocols can require manual recapture.
- Opaque rotating tokens cannot be correlated automatically without a stable signal; the operator can explicitly bind verified fingerprints to one registered account.
- Fetch Metadata and MIME signals can be absent or misleading, and business APIs can resemble documents, assets, or telemetry. The classifier therefore excludes only converging high-confidence signals, keeps ambiguous traffic in `REVIEW`, exposes reasons, and permits a reversible operation-level override; it cannot make traffic noise classification perfect.
- Data-flow links use bounded exact-value matching, not full semantic taint analysis.
- Repeater handoff uses the stored masked request and never auto-sends it. Automated decisive validation uses only FlowScope-controlled MCP requests, not Repeater or direct 8082 traffic.
- Closed-world execution prevents the supplied agent from using external discovery by instruction and tool choice, but FlowScope cannot control a separately modified agent installation or other local processes. Server-side scope, evidence visibility, and verdict gates remain authoritative.
- Only one active metadata context per source is allowed; overlapping LLM or ZAP runs are rejected.
- Graph folding is presentation pagination, not semantic clustering: each click exposes 18 more eligible resource/API nodes, while the 20,000-record capture bound still protects Burp.
- Live compatibility is compiled against Montoya `2026.7`; verify the release JAR in the Burp version used by the engagement.

## Standalone demo

```bash
mvn exec:java
mvn exec:java -Dexec.args="human.xml scanner.xml llm.xml"
```

## License and security

FlowScope is MIT licensed. The fat JAR bundles Cytoscape.js under MIT and Jackson under Apache-2.0; full notices are included under `META-INF/`.

Use only on systems you own or are explicitly authorized to test. See the English [security policy](SECURITY.md) for private vulnerability reporting and operational safety.
