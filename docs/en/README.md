# FlowScope 1.2.0-beta.46

Current implementation and open gates: [handoff](../ko/HANDOFF.md). Document scope and audit results: [documentation inventory](../ko/documentation-status.md) (Korean).

The standalone Explorer and direct ZAP browser-authentication lane are unreleased source changes. Use a JAR built from this work; older Release assets do not include them.

**Current source / unreleased:** the old MCP server, Judge and browser harness remain removed. D-128 adds a standalone Codex Explorer through app-server dynamic tools and a Java exact-scope gateway. HUMAN/ZAP execution and H/S/L Evidence comparison remain; no replacement MCP or automatic verdict path was added. See the [Explorer contract](../ko/llm-explorer.md).

FlowScope is a Burp Suite Community-compatible extension that aligns declared API inputs and real target traffic from three actors—**HUMAN, SCANNER, and LLM**—into a shared endpoint/parameter surface. It shows which source observed each endpoint and parameter before opening the existing identity-aware BOLA/IDOR/BFLA graph as an API-level drill-down. An unobserved declaration is a review item, not a vulnerability or failed lane.

## Product objective and completion criteria

> Within an authorized exact scope, structure declared and observed APIs and inputs, expose HUMAN/SCANNER/LLM exploration deltas, and keep authorization candidates traceable to reproducible Evidence.

FlowScope does not promise discovery of every endpoint, object, or state in a black-box target, zero false positives or false negatives, or confirmation from LLM prose alone. Product maturity is judged on published fixtures and answer-isolated blind benchmarks that disclose endpoint, object, classification, and finding measurements together with human `REVIEW` workload, false positives, false negatives, and unresolved cases. Current rule candidates and human reviews link to Evidence; historical LLM verdicts are preserved as records, not revalidated conclusions. No automatic final-verdict executor is provided.

```
declarations(OpenAPI/HTML/JS) ─┐
HUMAN/SCANNER/LLM observations ┴─▶ endpoint/parameter delta ─▶ authorization drill-down
```

## What is included

- A value-free, target-neutral `EndpointKey` and `ParameterKey` model that separates actual observations from OpenAPI, HTML-form, and static-JavaScript declarations. It covers path/query/nested-JSON/form/multipart locations without host, business-vocabulary, or framework-name branches.
- Live Burp capture with independent source, sub-source, orchestrator, tool, phase, and run metadata.
- Exact-scope Evidence capture for every source. HUMAN may browse other sites through Burp, but out-of-scope responses are not stored or graphed by FlowScope.
- HUMAN / SCANNER / LLM filters and an IDA-style hierarchical graph with bounded drill-down. Repeated edges for the same identity, API, folded object family, and source are collapsed visually while every original Object instance, Evidence item, and verdict remains available in the detail data.
- Raw paths are retained while operation templates are grouped only from categorical evidence: UUID/long-hex form, an exact matching ID in a successful JSON response, multiple values in the same position, or independent observations. Details expose `LITERAL / INFERRED / CORROBORATED` and the reason without a made-up confidence score.
- Explicit path/query/body object references remain primary evidence. Target-neutral semantic fields such as `customerNo`, `documentSeq`, and `accountRef` are promoted only after different values are observed at the same service, method, raw path, and field location; pagination/sort and API/auth/token/session fields remain excluded.
- Identity × operation × resource coverage matrix, uncrossed combinations, partial discovery, and source conflicts.
- Deterministic BOLA/IDOR and BFLA candidate engine using response taxonomy, explicit owner evidence, and user-supplied role policy.
- Secret-free test-account registry plus an explicit memory-only session broker for scoped HUMAN login capture, cookie rotation, expiry/suspect detection, and HUMAN Request Lab requests. ZAP login credentials use a separate process-memory vault and are verified by ZAP Browser Based Authentication. Rebinding one service-scoped HUMAN credential fingerprint to a different account fails closed instead of silently moving it.
- Query, request body, masked request/response, timestamp, redirect, GraphQL operation, and response-to-request data-flow capture. General textual messages are retained up to 1 MiB each, while discovery HTML/JavaScript/JSON/XML responses are retained up to 4 MiB; both share a 48 MiB deduplicated compressed-payload budget. The 8,192-character fields are UI previews, and analysis prefers the retained payload.
- Evidence-preserving traffic classification: every captured observation remains inspectable while only eligible API traffic enters the main graph. A bare 401/403 directory probe without independent API context stays `UNKNOWN/REVIEW`; JSON/API context, object evidence, or an unsafe method still promotes the record through the existing rules.
- Classifier v6 excludes authentication setup from analysis for every source, separates stable repeated polling as `POLLING`, separates manifests/source maps/service workers as discovery metadata, and recognizes the exact `/manifest.json` path even when its media type is generic JSON.
- A common route-discovery pipeline applies one scope, method, normalization, deduplication, and provenance gate to same-scope HTML, static JavaScript call sites, OpenAPI JSON/YAML, standard metadata, generic XML, and response-less Burp Site Map items. A method without evidence remains `UNKNOWN`; candidates never affect coverage, gaps, verdicts, or findings before a request/response is observed.
- Explicit `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` authentication state. Unbound cookie rotation no longer explodes graph identities, and verified account bindings remain service-scoped.
- System-owned bounded ZAP baseline: FlowScope first verifies that its Docker ZAP runtime uses the managed tmpfs home and that ZAP's outgoing proxy points to the Burp scanner listener. The bundled image supplies Chromium, matching ChromeDriver, Client, Selenium, Network, Replacer, and Authentication Helper integrations. For every isolated identity it may import operator-supplied, exact-scope OpenAPI, GraphQL, Postman, or SOAP definitions after a separate approval. An authenticated lane creates an unnamed temporary session and Context and uses Chrome Headless Browser Based Authentication with auto-detected session handling. It does not trust the ZAP action's `OK` result or authentication timestamp: it starts the account-scoped Client Spider only when an observed `ZAP_AUTHENTICATION` response for the same run and account matches the operator's required logged-in regex and no later response matches the optional logged-out regex. Both anonymous and authenticated lanes explicitly run one strict `chrome-headless` Client Spider, followed by bounded Passive processing and paginated native alerts. New campaigns do not invoke the Traditional or AJAX Spider. A failed login, Client error, or zero in-scope Client response fails the lane instead of being relabeled or silently falling back. The serial identity run reports campaign/stage elapsed time and deadline, worker signal and capture/status change, authentication state, each pending lane's queue position, Passive queue/task progress, and alert-snapshot completeness. A bounded in-memory activity feed reports real stage transitions, login outcome, Client progress, queue reductions, alert collection, and isolation cleanup once per second without storing credentials. A stalled Passive queue preserves captured Evidence and current alerts as a warning-complete partial result; the next identity does not start unless the old queue and current task are cleared. Up to 20,000 alert details are held in memory with an explicit truncation warning. Active Scan, fuzzing, and Forced Browse are not part of the default campaign.
- Single ZAP onboarding path: Quick Start requires the distribution bundle's FlowScope Docker Chromium runtime and checks API/version/key/tmpfs runtime before enabling a campaign. It does not accept an arbitrary ZAP Desktop/API instance as equivalent. Generic communication failures are `RETRYING` for two consecutive probes and become `UNREACHABLE` on the third; API-key errors remain immediate. `CONNECTED` describes control-plane readiness, not crawl completion.
- A compact four-stage Quick Start that displays only the first incomplete Scope, HUMAN, ZAP, or Evidence review panel while keeping every stage directly inspectable.
- Purpose-specific Evidence trust and exact-run completion remain for HUMAN/ZAP; imported and unverified runtime records cannot fabricate completed runs.
- One-click import of existing Burp Proxy history and response-less exact-scope Site Map candidates, with multiplicity-preserving duplicate suppression. The no-network onboarding sample is explicitly bannered as not being a real HUMAN/ZAP run.
- Scanner upload import for ZAP-exported HAR 1.2 request/response traffic. Method, URL, query, headers, body, status, and timestamp become SCANNER Evidence, but a HAR file never fabricates native ZAP alerts or campaign completion.
- A local relational `.flowscope.db` for masked records, account/session bindings, policies, historical LLM assessments/verdicts, and human audit decisions. Historical LLM conclusions never override current rule candidates. Once saved or opened it receives coalesced 30-second atomic checkpoints plus a final unload save; `.flowscope.json` remains the interchange import/export format.
- A Web request lab for explicit human validation. Raw live HTTP bytes stay only in a bounded in-process vault. The UI decodes textual bodies strictly from the Content-Type charset, replays an unchanged request byte-for-byte, and blocks Web editing of binary or undecodable bodies while retaining the Burp Repeater handoff. Results remain HUMAN `VALIDATION` Evidence rather than discovery coverage.
- Slash-aware operation labels, suppressed single-count edge labels, a readable filtered API list below 900 px, explicit Evidence-detail buttons, and separate wording for observed identities versus reusable registered-account sessions.
- Strict Burp XML import with XXE protection and item-level error skipping, plus bounded ZAP HAR import with entry-level error isolation.

FlowScope does not know the complete black-box attack surface, so it never reports a misleading coverage percentage.

Binary messages, general textual messages over 1 MiB, discovery HTML/JavaScript/JSON/XML responses over 4 MiB, and messages beyond the 48 MiB deduplicated compressed-payload budget retain only their original size, retention reason, and a length-framed SHA-256 identifier over the bounded masked representation, actual size, and reason. This is not claimed to be a checksum of the complete oversized original. Live capture stops at 20,000 records to protect Burp and reports dropped records and metadata-only messages; this beta does not promise unbounded capture.

## Requirements

- HUMAN-only mode: current Burp Suite Community or Professional with Montoya API support
- HUMAN + SCANNER: the distribution bundle, Burp, and OWASP ZAP 2.17.0 or Docker Compose v2
- LLM Explorer: the release JAR or bundle, Burp, the official Codex CLI, and a valid Codex login
- Source builds only: JDK 21 exactly and Maven 3.9 or newer
- Optional containerized ZAP: Docker Engine/Desktop with Docker Compose v2; Windows helper contract requires Windows 10/11, Docker Desktop Linux containers, and PowerShell 7

ZAP is required for the SCANNER campaign and optional for HUMAN-only use. The LLM lane requires the official logged-in Codex CLI; it does not require a provider API key, Chrome/Playwright, MCP, or a separately managed Node runtime. The measured runtime baseline is Burp Community 2026.7.3, ZAP 2.17.0, and JDK 21; this is not a compatibility claim for every older version or operating system.

## Build and install

Download `flowscope-1.2.0-beta.46-bundle.zip` from [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases) for the JAR, ZAP Dockerfile/Compose/helpers, doctors, and current manuals without cloning the repository. HUMAN/Explorer users may download just the JAR. If the asset has not been published yet, clone this source and build it with `mvn clean verify`; do not infer release availability from the documentation version alone. Published-release users do not need Maven, Node.js, npm, host Chrome/ChromeDriver, or ZAP Desktop.

The build leaves one Burp-loadable JAR, `target/flowscope-1.2.0-beta.46.jar`, and one download bundle, `target/flowscope-1.2.0-beta.46-bundle.zip`. Load the JAR in **Burp → Extensions → Installed → Add → Java**. The package phase removes the intermediate thin JAR and fails if the public JAR count is not one; CI also inspects and reproducibility-checks the bundle.

For the reproducible Burp listeners, optional Docker ZAP helper, provider sign-in, preflight checks, and first three-way run, follow the [English getting-started guide](getting-started.md). The canonical Korean guide is [docs/ko/getting-started.md](../ko/getting-started.md).

## Repository layout

- [`src/main`](../../src/main) — Burp extension, analysis core, local Web workspace, ZAP integration, and bundled notices.
- [`src/test`](../../src/test) — deterministic security, parser, analysis, persistence, ZAP, and local-Web regression tests.
- [`infra/zap`](../../infra/zap) — optional official ZAP 2.17.0 Docker Compose setup.
- [`scripts`](../../scripts) — macOS/Linux Bash and Windows PowerShell ZAP key, optional Docker lifecycle, and environment preflight helpers.
- [`docs/ko`](../ko) — canonical Korean architecture, decisions, development log, validation, research, and functional specification.
- [`docs/en`](.) — English user, contribution, security, and changelog documents.
- [`.github`](../../.github) — root-level Maven CI and dependency updates.

Build artifacts live only under `target/`. User-selected local `.flowscope.db`/`.flowscope.json` projects, review packages, and machine-specific configuration are ignored and are not part of the public repository.

The exact beta test boundary and remaining target-phase gates are recorded in the Korean [`docs/ko/beta-validation.md`](../ko/beta-validation.md). A work-by-work account of what was developed, changed, why it changed, affected files, and verification is maintained in [`docs/ko/development-log.md`](../ko/development-log.md). Screen-by-screen design and presentation rationale is in [`docs/ko/ui-product-rationale.md`](../ko/ui-product-rationale.md). Those detailed documents are not presented as English translations.

Create the HUMAN and SCANNER Burp proxy listeners. Montoya cannot create them for the extension. The 8082 LLM listener is only a compatibility fallback; the new Explorer sends through Montoya and does not depend on it.

| Listener | Source | Intended client |
|---|---|---|
| `127.0.0.1:8080` | HUMAN | Browser or manual tester |
| `127.0.0.1:8081` | SCANNER | ZAP outgoing target traffic |
| `127.0.0.1:8082` | LLM | Optional direct-client observation fallback (`UNVERIFIED_RUNTIME`; retained Evidence only, never coverage/completion) |

Install Burp's CA certificate in each target client. Do not disable TLS validation as a permanent setup.

Open the **FlowScope** Burp tab, enter one exact authorized scope per line, and click **범위 적용**. A scope includes scheme, host, effective port, and an optional path prefix, for example:

```text
https://api.example.test/v1
http://127.0.0.1:3000/
```

An empty scope blocks ZAP campaign execution.

With zero observed Evidence, the Web UI shows only the exact-scope → login/HUMAN pass → ZAP baseline → Evidence review sequence and setup/sample actions. It reveals the existing analysis workspace automatically after Evidence arrives.

ZAP `scope-only` uses ZAP Context membership rather than FlowScope scope. Each identity lane therefore creates a fresh Context that includes only the selected target's origin and path subtree. Sibling paths, subdomains, and different ports or schemes are excluded; a Context or passive-rule verification failure prevents the spiders from starting.

## Typical assessment flow

1. Configure the exact scope and use ordinary anonymous or least-privileged test accounts. The Burp tab is the normal control; no MCP scope setter is exposed. An admin account is optional and only useful when the engagement requires an explicit role comparison.
2. In **계정·세션**, register secret-free HUMAN labels such as USER A/USER B. Each account is one primary card; Cookie, Authorization, and subject fingerprints from that login are grouped as collapsed technical evidence rather than displayed as extra accounts. Start login capture, log in through HUMAN port 8080, observe a successful authenticated-page response, then end capture. Only broker-`ACTIVE` accounts are selectable for a HUMAN pass, and the selected account is recorded only when the request credentials exactly match it. This HUMAN broker is not the ZAP login mechanism. Raw session material remains only in extension memory and is never returned to the LLM or saved in a project. Start the HUMAN pass, browse the authorized workflows, and end the same run. `Pass complete` reflects that exact run close, not a non-zero record count; Repeater and Intruder observations keep their actual Burp-tool provenance while sharing the pass context. Proxy, Repeater, and Intruder responses are correlated to their request-time pass/account by Montoya `messageId`; late responses from a reset or replaced dataset, and responses with no correlation, are excluded instead of guessed into the current pass. Two distinct least-privileged test accounts are recommended for BOLA comparison.

- Optional manual validation: select an API and open a specific Evidence item in **요청 실험실**. Choose original headers, anonymous stripping, or one active registered account; edit the path, query, headers, or body; then send explicitly. The network destination remains locked to the Evidence service, redirects are disabled, and the response, duration, and byte counts are displayed. The result is HUMAN `VALIDATION` Evidence and never inflates exploration coverage. Live raw text is bounded to 1 MiB per request, 4 MiB per response, and 32 MiB total in Burp process memory; reset, project replacement, and unload discard it. Imported or over-limit Evidence falls back to masked text.

3. Run the bundle's FlowScope Docker ZAP helper, which configures `host.docker.internal:8081`; FlowScope verifies this setting and the managed tmpfs runtime and the Client, Selenium, Network, Replacer, and Authentication Helper add-ons before target traffic. In Web quick-start, select an exact-scope target plus the anonymous lane and/or add a **ZAP browser-login account** with label, role, login URL, username, password, and a required logged-in response regex. Those credentials stay in current-process memory and are sent only to the local ZAP API. The optional logged-out regex should identify a failed or signed-out response. If definitions are already known, optionally enter `OPENAPI URL`, `POSTMAN URL`, `SOAP URL`, or `GRAPHQL ENDPOINT [SCHEMA_URL]`; FlowScope never guesses locations and rejects out-of-scope URLs. Each authenticated lane creates an unnamed temporary session and Context, runs Chrome Headless Browser Based Authentication, then requires same-run/account authentication-response Evidence to match the logged-in regex and not be superseded by a logged-out match before it runs strict account-bound `chrome-headless` Client Spider → bounded Passive processing → paginated alerts. A failed login, failed Client run, or zero in-scope Client response fails that lane. Passive processing waits up to 30 minutes and treats ten minutes without a decrease in recordsToScan as stalled; task/URL changes alone do not reset that timer. It snapshots current alerts and Evidence before clearing abandoned queue work; if cleanup cannot be verified, later identities remain `NOT_RUN` to prevent cross-identity attribution. Active Scan, fuzzing, and Forced Browse remain outside the default campaign.
   API definition imports may generate write-method example requests, so any non-empty definition list also requires a separate Burp approval dialog before the campaign starts.
4. Inspect endpoint/parameter deltas, Evidence and current authorization-rule candidates.
5. Open **Explorer**, select anonymous and/or memory-only HTML-form/JSON-API accounts, and start an independent run. Its feed distinguishes elapsed time, requests, response Evidence, unresolved items and failures; zero response Evidence cannot complete the run.
6. Compare H/S/L observations, then save explicit human review. The Explorer does not create an automatic LLM verdict.
7. Historical LLM assessments and verdicts appear only in the React read-only archive.
8. Use **로컬 DB 저장·연결** once to select a `.flowscope.db`; later changes are coalesced into atomic snapshots. Use **JSON 내보내기** for interchange. Raw HUMAN-broker, ZAP-login, or Explorer credentials are never persisted, so authentication must be prepared again after reload.

ZAP authentication exchanges remain auditable `ZAP_AUTHENTICATION / SESSION_SETUP` Evidence, but they do not count as scanner discovery, crawler capture, or lane completion. Authentication alone therefore cannot make an otherwise empty scanner lane appear complete.

## Standalone LLM Explorer

D-126 removed the old browser/Judge/MCP runtime. D-128 adds a separate Explorer that launches the locally authenticated Codex app-server in an isolated temporary workspace. It exposes one dynamic HTTP tool to the model; Java validates exact scope, method, protected headers, deduplication and budget before Burp Montoya sends the request. Credentials and live cookies/tokens stay in the in-process account vault and are represented to the model only by opaque account handles. Login setup traffic is not persisted. The activity feed supports steering and cancellation. See the [full contract](../ko/llm-explorer.md).

## Provenance model

`source` answers who generated the target request. `orchestrator` answers who initiated the tool that generated it. They are intentionally independent.

| Activity | Source | Detail | Orchestrator |
|---|---|---|---|
| Manual browser | HUMAN | BROWSER | HUMAN |
| Burp Repeater | HUMAN | BURP_REPEATER | HUMAN |
| ZAP started by tester | SCANNER | ZAP_* | HUMAN |
| Deterministic ZAP baseline | SCANNER | ZAP_* | SYSTEM |
| Standalone Codex Explorer | LLM | LLM_EXPLORER | LLM (`CONTROLLED`) |
| Direct 8082 fallback | LLM | configured listener detail | LLM (`UNVERIFIED_RUNTIME`) |

Port defaults can be changed before Burp starts:

```text
-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
-Dflowscope.web.port=17777
-Dflowscope.payload.maxBytes=1048576
-Dflowscope.payload.memoryBytes=50331648
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
-Dflowscope.zap.keyFile=/absolute/path/to/owner-only-zap-api-key
```

The ZAP API endpoint is accepted only on a loopback address. Key precedence is `flowscope.zap.key`, `FLOWSCOPE_ZAP_API_KEY`, `flowscope.zap.keyFile`, then `~/.flowscope/zap-api-key`. The default file rejects symbolic links and group/other POSIX access. The provided Docker helper limits ZAP API clients to loopback, the resolved `host.docker.internal` address, and the container's default Compose bridge gateway; it does not use a wildcard address rule. ZAP itself must be configured to proxy target traffic through the Burp SCANNER listener. Client status `100` alone does not prove target traffic: FlowScope checks raw `ZAP_CLIENT_SPIDER` responses for the same run and fails a zero-capture lane. An incomplete alert snapshot is explicitly partial and must not be treated as the full set ZAP could eventually produce.

## Product workspace

- **Burp tab** — exact scope, port mapping, live counts, Proxy-history import, project save/load, sample, reset, and a button that opens the canonical local Web workspace.
- **Web top modes** — the default API·입력 차이 surface, 인가 그래프 drill-down, 판정 매트릭스, 흐름 순서, 시나리오, 파싱 결과, and 계정·세션 are stable views over one captured dataset.
- **API·입력 차이** — declaration-versus-observation endpoint/parameter facts with source badges, Evidence/provenance links, and artifact parsing status; it does not fabricate a black-box completion percentage.
- **Left rail** — captured/analysis/hidden/review counts without a fabricated percentage, HUMAN/SCANNER/LLM filters paired with actual main-Evidence counts, Evidence display classes, read-only authorization-policy state, three-way gaps, and graph verdict controls.
- **Flow Graph** — The default is Identity → API, selecting an API opens Identity → API → Object, and Site → API Group is an optional overview. The retained analytical relation is Identity × API × Object × Source; high-cardinality objects are folded into families and expanded on demand. HUMAN blue/solid/H, SCANNER red/dashed/S, and LLM black/dotted/L remain provenance encodings. Unrequested-route candidates stay outside observed coverage, HTTP status remains an outcome rather than an authorization verdict, and response-to-request dependencies stay in the separate sequence view.
- **판정 매트릭스** — observed identity/role × operation × resource cells, per-source verdicts, uncrossed combinations, partial discovery, and conflicts.
- **흐름 순서** — response-to-request ID/token dependencies recovered from timestamped observations.
- **시나리오** — current deterministic candidates and human review; historical LLM records are separate and read-only.
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
- The old automated Judge validation path is removed. Explicit HUMAN Request Lab sends remain separate from discovery, and stored legacy verdicts are not new automated conclusions.

## Local Web boundary

The Web server binds to loopback and retains Host/Origin/capability, request-size and CSP checks. There is no MCP endpoint or port 8787 listener.

## Data handling

- Raw Authorization/Cookie/CSRF values selected by explicit HUMAN login capture and ZAP/Explorer account usernames and passwords exist only in their in-memory vaults, are never exposed by Web snapshots, and are wiped from owned char/byte buffers on replacement/revocation/unload. ZAP credentials are sent to the local ZAP API in a POST body, not a URL or logged error body. They are not written to project files. Java and HTTP libraries may still create short-lived immutable string copies, so this is process-memory containment rather than a hardware secret vault.
- Authorization, Cookie, Set-Cookie, password, token, secret, and API-key values are masked before Evidence storage.
- Authentication grouping uses a subject or a short one-way fingerprint; raw opaque tokens are not retained. Cookie presence alone is not login proof: an unbound cookie fingerprint is retained for audit/binding but shown as one service-scoped `UNRESOLVED` graph identity until a controlled broker match or explicit account binding proves the account.
- Traffic classification never deletes stored Evidence. User `include/exclude/auto` overrides are operation-scoped but cannot turn no-response, unknown-source, or non-discovery validation traffic into discovery coverage; repeated observations are collapsed only in the display and retain every Evidence ID, count, and first/last timestamp.
- UI previews are truncated to 8,192 characters per field. Masked general textual messages are retained up to 1 MiB, discovery HTML/JavaScript/JSON/XML responses up to 4 MiB, and deduplicated compressed payloads up to 48 MiB in aggregate by default; binary and over-limit messages keep only size, retention reason, and a bounded-representation identifier rather than a full-original checksum. Live capture is capped at 20,000 records and exposes dropped-record and metadata-only-message counts.
- Project files contain masked traffic but may still contain sensitive application data. POSIX files are written owner-read/write only; protect them under the engagement's data policy.
- Project writes use a temporary file and atomic replacement when the filesystem supports it.

## Honest limitations

- Current results are deterministic rule candidates and human reviews. Legacy LLM verdicts are historical records, not current validation. Neither automatically proves business impact or replaces engagement review.
- Owner extraction recognizes common scalar owner/user/account fields and explicit nested owner/user/author/account/customer principal objects. Domain-specific ownership should still be confirmed by the operator.
- Session automation covers ordinary cookies, bearer/CSRF headers, rotation, expiry hints, and suspect responses. CAPTCHA, MFA, WebAuthn, device binding, and application-specific refresh/login protocols can require manual recapture.
- `ACTIVE` is transport-level evidence that a credential-bearing capture observed an HTTP response that was not a 401, login redirect, or invalid-token response. It is not a generic proof of application-specific `/me` semantics, account ownership, or role; the operator must verify those mappings.
- Opaque rotating tokens cannot be correlated automatically without a stable signal; the operator can explicitly bind verified fingerprints to one registered account.
- Fetch Metadata and MIME signals can be absent or misleading, and business APIs can resemble documents, assets, or telemetry. The classifier therefore excludes only converging high-confidence signals, keeps ambiguous traffic in `REVIEW` outside the main graph, exposes reasons, and permits a reversible operation-level override. An unreviewed real API can therefore remain outside the main comparison; traffic-noise classification is not perfect.
- Up to 20,000 unrequested routes are extracted only from retained masked textual responses (general limit 1 MiB, discovery MIME limit 4 MiB, falling back to the 8,192-character preview when the full message is metadata-only) and response-less Burp Site Map items. Dynamically composed JavaScript URLs and client-runtime-only routes are not guessed. Candidate priority is an inspectable categorical order, not a probability or vulnerability score.
- Discovery HTML/JavaScript/JSON/XML responses are retained and delivered to analysis up to 4 MiB by default; a 1.4 MiB capture-to-record regression covers a call site after the former limit. Responses above 4 MiB remain metadata-only, and the 4,194,304-character parser limit does not prove support for dynamically composed routes or unreceived lazy chunks.
- Data-flow links use bounded exact-value matching, not full semantic taint analysis.
- Repeater handoff opens an unsent draft. Explicit Request Lab sends produce HUMAN VALIDATION Evidence, not discovery coverage or an automatic LLM verdict.
- The old agent workspace, browser executor, Judge and MCP remain removed. The new Explorer depends on an experimental Codex app-server dynamic-tool contract, so CLI compatibility is checked and protocol failure is reported as failure rather than “nothing found.”
- One active metadata context per source and exact run-ID completion/cancellation checks remain. The Explorer requires at least one actual same-run response Evidence item to complete.
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
