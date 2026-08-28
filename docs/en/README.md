# FlowScope 1.2.0-beta.22

This is the English user guide. The repository root [README](../../README.md) is the canonical Korean guide. See also the English [changelog](CHANGELOG.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

FlowScope is a Burp Suite Community-compatible extension that aligns real target traffic from three actors—**HUMAN, SCANNER, and LLM**—into one identity-aware authorization graph and coverage matrix. It highlights uncrossed object combinations inside the observed set and evidence-grounded BOLA/IDOR and BFLA candidates without treating an LLM guess as a confirmed vulnerability. Exact-scope routes referenced by stored responses or present as response-less Burp Site Map items are shown as neutral candidates, separate from observed coverage.

## Product objective and completion criteria

> Within an authorized exact scope, structure as much of the observable authorization attack surface as possible and use reproducible Evidence to expose missed paths and authorization candidates across identities, operations, objects, and state flows.

FlowScope does not promise discovery of every endpoint, object, or state in a black-box target, zero false positives or false negatives, or confirmation from LLM prose alone. Product maturity is judged on published fixtures and answer-isolated blind benchmarks that disclose endpoint, object, classification, and finding measurements together with human `REVIEW` workload, false positives, false negatives, and unresolved cases. Every candidate and final verdict must remain traceable to original Request/Response Evidence and to reproduction and authorized-control Evidence.

```
identity ──access──▶ resource ──calls──▶ operation
 user-b              orders:101          GET /api/orders/{id}
```

## What is included

- Live Burp capture with independent source, sub-source, orchestrator, tool, phase, and run metadata.
- Exact-scope Evidence capture for every source. HUMAN may browse other sites through Burp, but out-of-scope responses are not stored or graphed by FlowScope.
- HUMAN / SCANNER / LLM filters and an IDA-style hierarchical graph with orthogonal edges and bounded expandable groups. Repeated access edges for the same identity, resource, and source are folded into one labelled edge while retaining every original operation, Evidence item, and verdict in the detail view.
- Raw paths are retained while operation templates are grouped only from categorical evidence: UUID/long-hex form, an exact matching ID in a successful JSON response, multiple values in the same position, or independent observations. Details expose `LITERAL / INFERRED / CORROBORATED` and the reason without a made-up confidence score.
- Explicit path/query/body object references remain primary evidence. Target-neutral semantic fields such as `customerNo`, `documentSeq`, and `accountRef` are promoted only after different values are observed at the same service, method, raw path, and field location; pagination/sort and API/auth/token/session fields remain excluded.
- Identity × operation × resource coverage matrix, uncrossed combinations, partial discovery, and source conflicts.
- Deterministic BOLA/IDOR and BFLA candidate engine using response taxonomy, explicit owner evidence, and user-supplied role policy.
- Secret-free test-account registry plus an explicit memory-only session broker for scoped HUMAN login capture, cookie rotation, expiry/suspect detection, and account-bound ZAP/LLM requests. Rebinding one service-scoped credential fingerprint to a different account fails closed instead of silently moving it.
- Query, request body, masked request/response, timestamp, redirect, GraphQL operation, and response-to-request data-flow capture. Text messages are retained up to 1 MiB each and 48 MiB of deduplicated compressed payloads in aggregate, separate from 8 KiB UI previews.
- Evidence-preserving traffic classification: every captured observation remains inspectable while only high-confidence navigation, static assets, real CORS preflights, no-response records, and non-discovery phases stay out of coverage analysis by default.
- Classifier v4 separates authentication setup and stable repeated polling as `AUTH_SESSION` and `POLLING`, separates manifests/source maps/service workers as discovery metadata, and can corroborate an ambiguous record only with strong API evidence for the same service and normalized operation.
- A common route-discovery pipeline applies one scope, method, normalization, deduplication, and provenance gate to same-scope HTML, static JavaScript call sites, OpenAPI JSON/YAML, standard metadata, generic XML, and response-less Burp Site Map items. A method without evidence remains `UNKNOWN`; candidates never affect coverage, gaps, verdicts, or findings before a request/response is observed.
- Explicit `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` authentication state. Unbound cookie rotation no longer explodes graph identities, and verified account bindings remain service-scoped.
- Localhost-only authenticated MCP server for Codex and Claude Code subscription clients.
- System-owned ZAP baseline: Traditional Spider, strict Client Spider with AJAX fallback, passive queue completion, and native alerts. The completion gate reads the raw Burp capture store rather than a delayed analysis snapshot. A completed Client stage with zero rendered captures triggers AJAX; zero captures from both rendered stages is exposed as `COMPLETED_WITH_WARNINGS`. Active Scan remains separate and approval-gated.
- Deployment-neutral ZAP onboarding: Quick Start checks the loopback API/version/key before enabling a campaign and offers ZAP Desktop or optional Docker without pretending the API can identify its deployment type.
- A compact four-stage Quick Start that displays only the first incomplete Scope, HUMAN, ZAP, or LLM/Judge panel while keeping every stage directly inspectable.
- Closed-world LLM execution through an exact-scope FlowScope request tool; direct external traffic is never trusted for decisive verdicts.
- Server-enforced independent Explorer view, immutable three-lane dataset lock, and final LLM Judge synthesis.
- Web quick-start buttons that launch a fresh locally authenticated Codex or Claude CLI process for Explorer and a separate persistent Judge session that can be resumed explicitly.
- MCP route-candidate visibility limited to the active Explorer's own source/run provenance; pre-lock status hides cross-lane counts, runs, assessments, and validations, ZAP state/execution is blocked during exploration, and the route inventory is frozen with the dataset lock.
- One-click import of existing Burp Proxy history and response-less exact-scope Site Map candidates, with multiplicity-preserving duplicate suppression. The no-network onboarding sample is explicitly bannered as not being a real HUMAN/ZAP/LLM run.
- A local relational `.flowscope.db` for masked records, account/session bindings, policies, assessments, validated verdicts, and audit decisions. Once saved or opened it receives coalesced 30-second atomic checkpoints plus a final unload save; `.flowscope.json` remains the interchange import/export format.
- A Web request lab for explicit human validation. Raw live HTTP bytes stay only in a bounded in-process vault. The UI decodes textual bodies strictly from the Content-Type charset, replays an unchanged request byte-for-byte, and blocks Web editing of binary or undecodable bodies while retaining the Burp Repeater handoff. Results remain HUMAN `VALIDATION` Evidence rather than discovery coverage.
- Slash-aware operation labels, suppressed single-count edge labels, a readable filtered API list below 900 px, explicit Evidence-detail buttons, and separate wording for observed identities versus reusable registered-account sessions.
- Evidence-bound LLM validation using repeated reproduction and authorized-control observations, with human audit/override.
- Strict Burp XML import with XXE protection and item-level error skipping.

FlowScope does not know the complete black-box attack surface, so it never reports a misleading coverage percentage.

Binary messages, messages over the 1 MiB per-message limit, and messages beyond the 48 MiB deduplicated compressed-payload budget retain only their original size, SHA-256 digest, and retention reason. Live capture stops at 20,000 records to protect Burp and reports dropped records and metadata-only messages; this beta does not promise unbounded capture.

## Requirements

- HUMAN-only mode: current Burp Suite Community or Professional with Montoya API support
- HUMAN + SCANNER: Burp plus OWASP ZAP 2.17.0
- Complete HUMAN + SCANNER + LLM/Judge: the above plus either a signed-in Codex CLI or Claude Code client
- Source builds only: JDK 21 or newer and Maven 3.9 or newer
- Optional containerized ZAP: Docker Engine/Desktop with Docker Compose v2; Windows helper contract requires Windows 10/11, Docker Desktop Linux containers, and PowerShell 7

ZAP and a local model client are required for the complete three-way workflow. They are optional only when deliberately running a reduced HUMAN-only mode. The measured runtime baseline is Burp Community 2026.7.3, ZAP 2.17.0, and JDK 21; this is not a compatibility claim for every older version or operating system.

## Build and install

Clone `https://github.com/choewonwoo1817/testflowscope.git` when using the ZAP key helper or optional Docker Quick Start for a complete three-way setup; HUMAN-only users may download just the JAR. Download `flowscope-1.2.0-beta.22.jar` from [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases). Release users do not need Maven. Source contributors build with `mvn clean verify`.

The build leaves exactly one Burp-loadable artifact in `target/`: `flowscope-1.2.0-beta.22.jar`. Load it in **Burp → Extensions → Installed → Add → Java**. The package phase removes the intermediate thin JAR and fails if the public JAR count is not one.

For the reproducible Burp listeners, optional Docker ZAP helper, provider sign-in, preflight checks, and first three-way run, follow the [English getting-started guide](getting-started.md). The canonical Korean guide is [docs/ko/getting-started.md](../ko/getting-started.md).

## Repository layout

- [`src/main`](../../src/main) — Burp extension, analysis core, local Web workspace, MCP/ZAP integration, and bundled notices.
- [`src/test`](../../src/test) — deterministic security, parser, analysis, persistence, MCP, and local-Web regression tests.
- [`agent-workspace`](../../agent-workspace) — ready-to-copy Codex/Claude MCP configuration and Explorer/Judge instructions.
- [`infra/zap`](../../infra/zap) — optional official ZAP 2.17.0 Docker Compose setup.
- [`scripts`](../../scripts) — macOS/Linux Bash and Windows PowerShell ZAP key, optional Docker lifecycle, and environment preflight helpers.
- [`docs/ko`](../ko) — canonical Korean architecture, decisions, development log, validation, research, and functional specification.
- [`docs/en`](.) — English user, contribution, security, and changelog documents.
- [`.github`](../../.github) — root-level Maven CI and dependency updates.

Build artifacts live only under `target/`. User-selected local `.flowscope.db`/`.flowscope.json` projects, review packages, and machine-specific configuration are ignored and are not part of the public repository.

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

With zero observed Evidence, the Web UI shows only the exact-scope → login/HUMAN pass → ZAP baseline → independent LLM Explorer/Judge sequence and setup/sample actions. It reveals the existing analysis workspace automatically after Evidence arrives.

## Typical assessment flow

1. Configure the exact scope and use ordinary anonymous or least-privileged test accounts. The Burp tab is the normal control; an MCP client may call `flowscope_set_scope` only with the exact target explicitly authorized by the operator and only before an active SCANNER/LLM run. An admin account is optional and only useful when the engagement requires an explicit role comparison.
2. In **계정·세션**, register secret-free labels such as USER A/USER B. Each account is one primary card; Cookie, Authorization, and subject fingerprints from that login are grouped as collapsed technical evidence rather than displayed as extra accounts. Start login capture, log in through HUMAN port 8080, observe a successful authenticated-page response, then end capture. A credential-bearing capture without such a response remains unavailable and cannot be injected into ZAP or LLM requests. Only broker-`ACTIVE` accounts are selectable for a HUMAN pass, and the selected account is recorded only when the request credentials exactly match it. Raw session material remains only in extension memory and is never returned to the LLM or saved in a project. Start the HUMAN pass, browse the authorized workflows, and end the same run. `Pass complete` reflects that exact run close, not a non-zero record count; Repeater and Intruder observations keep their actual Burp-tool provenance while sharing the pass context. Proxy, Repeater, and Intruder responses are correlated to their request-time pass/account by Montoya `messageId`; late responses from a reset or replaced dataset, and responses with no correlation, are excluded instead of guessed into the current pass. Two distinct least-privileged test accounts are recommended for BOLA comparison.

- Optional manual validation: select an API and open a specific Evidence item in **요청 실험실**. Choose original headers, anonymous stripping, or one active registered account; edit the path, query, headers, or body; then send explicitly. The network destination remains locked to the Evidence service, redirects are disabled, and the response, duration, and byte counts are displayed. The result is HUMAN `VALIDATION` Evidence and never inflates exploration coverage. Live raw text is bounded to 1 MiB per request, 4 MiB per response, and 32 MiB total in Burp process memory; reset, project replacement, and unload discard it. Imported or over-limit Evidence falls back to masked text.

3. Configure ZAP's outgoing proxy as `127.0.0.1:8081`. In Web quick-start, select an exact-scope target plus anonymous and/or multiple ACTIVE accounts, then run the identity-isolated scanner campaign. Before each identity, FlowScope creates a fresh ZAP session and runs Traditional Spider → Client Spider (AJAX fallback) → passive completion → native alerts. A completed Client stage with zero observed rendered traffic triggers AJAX, and zero rendered traffic from both stages is shown as `COMPLETED_WITH_WARNINGS`. Account lanes replace existing auth state with that broker account. The anonymous lane keeps cookies/CSRF created inside its fresh session for stateful public flows, but its FlowScope identity remains `ANONYMOUS`. A zero-capture identity keeps the overall SCANNER completion gate closed. The FlowScope Web loopback control plane is excluded as a target. Active Scan is not part of this campaign and always requires a separate Burp approval.
4. In Web quick-start, select a locally logged-in Codex or Claude client, the exact-scope target, and optionally an ACTIVE account, then click **LLM Explorer 시작**. FlowScope creates a dedicated temporary workspace and a new process that never resumes an earlier conversation. It supplies the bundled rules, target, scope, and server-issued run ID over standard input. Explorer sees only its own MCP run and must end that exact run successfully. Web search, Wayback, external API docs/source repositories, direct curl, and browser networking remain forbidden.
5. Review ambiguous traffic, then click **Judge 시작** after all three exploration lanes completed. FlowScope starts a separate new Judge session, which locks the dataset, reads candidates and native ZAP alerts, submits non-final assessments, and captures narrow safe-GET validation/control Evidence. After completion, **Judge 계속** resumes that exact provider session ID; it does not keep a terminal process permanently open.
6. FlowScope accepts `CONFIRMED` or `REJECTED` only when that bundle matches the current candidate and passes the server checks: at least two same-run LLM reproductions, at least one authorized control, matching identity/operation/resource semantics, and response evidence. A BOLA read response must structurally contain the target object ID; an owner string alone is insufficient. Everything else remains `INCONCLUSIVE`. Review **시나리오** and Request/Response details; human records are an auditable override, not an unverified automatic finding.
7. Use **로컬 DB 저장·연결** once to select a `.flowscope.db`; later changes are coalesced into atomic snapshots. Use **JSON 내보내기** for interchange. Raw broker credentials are never persisted, so login capture must be repeated after a reload.

## Codex or Claude subscriptions—no model API key

FlowScope does not call a model API and does not receive a provider OAuth token. Codex or Claude authenticates with the user's existing local CLI login/subscription; FlowScope supplies only the local MCP endpoint and process arguments. The Web buttons look for an executable `codex` or `claude` in Burp's launch environment and remove inherited `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` values from the child. The random Bearer value copied in the FlowScope Burp tab protects only that localhost server. It is passed to the child environment, not command arguments, prompts, or project files, and remains masked in the UI.

The `agent-workspace` workflow below remains the manual fallback. Explorer uses Codex ephemeral execution or Claude no-persistence execution and is never resumed. Judge gets a separate provider session ID that is retained only for explicit follow-up. Some Claude Code versions may still leave provider metadata despite `--no-session-persistence`; FlowScope warns about that limitation, never logically reuses the Explorer session, and does not delete the user's provider home directory.

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
-Dflowscope.payload.maxBytes=1048576
-Dflowscope.payload.memoryBytes=50331648
-Dflowscope.mcp.token=<stable-local-token-if-required>
-Dflowscope.mcp.tokenFile=/absolute/path/to/owner-only-token
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
-Dflowscope.zap.keyFile=/absolute/path/to/owner-only-zap-api-key
-Dflowscope.llm.codex.path=/absolute/path/to/codex
-Dflowscope.llm.claude.path=/absolute/path/to/claude
```

The ZAP API endpoint is accepted only on a loopback address. Key precedence is `flowscope.zap.key`, `FLOWSCOPE_ZAP_API_KEY`, `flowscope.zap.keyFile`, then `~/.flowscope/zap-api-key`. The default file rejects symbolic links and group/other POSIX access. ZAP itself must be configured to proxy target traffic through the Burp SCANNER listener. Client status `100` and an AJAX API response of `OK` do not prove rendered traffic. FlowScope checks stage-specific raw captures: a zero-total-capture run fails, while a run with only Traditional captures completes with warnings.

## Product workspace

- **Burp tab** — exact scope, port mapping, live counts, MCP connection copy, Proxy-history import, project save/load, sample, reset, and a button that opens the canonical local Web workspace.
- **Web top modes** — 그래프, 판정 매트릭스, 흐름 순서, 시나리오, 파싱 결과, and 계정·세션 are stable views over one captured dataset.
- **Left rail** — captured/analysis/hidden/review counts without a fabricated percentage, HUMAN/SCANNER/LLM filters paired with actual main-Evidence counts, Evidence display classes, read-only authorization-policy state, three-way gaps, and graph verdict controls.
- **Flow Graph** — fixed identity → resource → operation lanes, with direct identity → operation edges when no object identifier was observed; both segments of each path use the HUMAN blue/solid/H, SCANNER red/dashed/S, or LLM black/dotted/L source encoding; neutral dashed unrequested-route candidates stay outside source coverage; response-to-request dependencies remain in the separate sequence view; plus authorization view, focus+context, zoom-to-fit, and 18-at-a-time expandable resource/API groups.
- **판정 매트릭스** — observed identity/role × operation × resource cells, per-source verdicts, uncrossed combinations, partial discovery, and conflicts.
- **흐름 순서** — response-to-request ID/token dependencies recovered from timestamped observations.
- **시나리오** — deterministic BOLA/BFLA candidates and gaps alongside non-final Judge assessments and server-validated final verdicts.
- **시나리오 감사·오버라이드** — a human audit surface with Evidence-bound status and masked notes; it does not bypass validation checks.
- **파싱 결과** — masked source, identity, method, normalized operation, resource, status, traffic class/disposition, repeat count, and stable Evidence ID. Selecting a row opens the operation detail and its paginated masked Evidence.
- **계정·세션** — a full-width workspace with secret-free account registration, explicit HUMAN login capture, safe broker status, discovered-session comparison, binding/unbinding, reauthentication, memory revocation, and account removal.
- **Right detail** — per-source verdicts and on-demand masked Request/Response for the selected API, plus the full-screen request lab and Burp Repeater handoff. The polling snapshot never transfers every stored message body or raw credential.

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
- UI previews are truncated to 8 KiB per field. Masked textual messages are retained up to 1 MiB each and 48 MiB of deduplicated compressed payloads in aggregate by default; binary and over-limit messages keep only size, digest, and retention metadata. Live capture is capped at 20,000 records and exposes dropped-record and metadata-only-message counts.
- Project files contain masked traffic but may still contain sensitive application data. POSIX files are written owner-read/write only; protect them under the engagement's data policy.
- Project writes use a temporary file and atomic replacement when the filesystem supports it.

## Honest limitations

- A FlowScope final verdict means the captured authorization behavior met the beta evidence oracle; it does not by itself prove business impact or eliminate the need for engagement reporting review.
- Owner extraction recognizes common scalar owner/user/account fields and explicit nested owner/user/author/account/customer principal objects. Domain-specific ownership should still be confirmed by the operator.
- Session automation covers ordinary cookies, bearer/CSRF headers, rotation, expiry hints, and suspect responses. CAPTCHA, MFA, WebAuthn, device binding, and application-specific refresh/login protocols can require manual recapture.
- `ACTIVE` is transport-level evidence that a credential-bearing capture observed an HTTP response that was not a 401, login redirect, or invalid-token response. It is not a generic proof of application-specific `/me` semantics, account ownership, or role; the operator must verify those mappings.
- Opaque rotating tokens cannot be correlated automatically without a stable signal; the operator can explicitly bind verified fingerprints to one registered account.
- Fetch Metadata and MIME signals can be absent or misleading, and business APIs can resemble documents, assets, or telemetry. The classifier therefore excludes only converging high-confidence signals, keeps ambiguous traffic in `REVIEW` outside the main graph, exposes reasons, and permits a reversible operation-level override. An unreviewed real API can therefore remain outside the main comparison; traffic-noise classification is not perfect.
- Up to 20,000 unrequested routes are extracted only from retained masked textual responses (falling back to the 8 KiB preview when the full message is metadata-only) and response-less Burp Site Map items. Dynamically composed JavaScript URLs and client-runtime-only routes are not guessed. Candidate priority is an inspectable categorical order, not a probability or vulnerability score.
- Data-flow links use bounded exact-value matching, not full semantic taint analysis.
- Repeater handoff uses the live in-memory original when available and otherwise falls back to the stored masked request; it never auto-sends. Explicit Web request-lab sends become HUMAN `VALIDATION` Evidence but cannot bypass the LLM verdict gate. Automated decisive validation uses FlowScope-controlled MCP requests plus a server-checked bundle.
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
