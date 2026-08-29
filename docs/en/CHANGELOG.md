# Changelog

## 1.2.0-beta.25 — 2026-08-29

- Replaced generic ZIP repacking with a manifest-aware JAR task so `JarInputStream` can discover the release manifest immediately.
- Replaced Java-version-specific Jackson, jsoup, and SnakeYAML MR-JAR moves with version-independent path mappings.
- Promoted streaming manifest metadata and isolated class loading to mandatory `mvn clean verify` release gates.

## 1.2.0-beta.24 — 2026-08-29

- Expanded the response-object oracle to resource-qualified `orderId`, `order_uuid`, and `pk` forms while keeping nested-resource matching on the final target ID.
- Restricted soft-deny matching to top-level error envelopes or a bounded non-JSON error prefix so normal payload data cannot silently invert a successful authorization result.
- Added response JSON size, depth, token, and traversal bounds with iterative object lookup.
- Applied the same bounded parsing and traversal contract to owner and data-flow readers, including a bounded malformed-text fallback.
- Separated fingerprint extraction failure from actual anonymous traffic and rejected account binding for either state; normalized session services and rejected unknown roles as BFLA control identities.
- Made policy replacement and account updates atomic and isolated Burp/Web/MCP/Standalone publication from mutable capture records and live policy updates.
- Replaced delimiter-based cell and Evidence digest inputs with length framing and fixed mixed LF/CRLF message-body splitting.

## 1.2.0-beta.23 — 2026-08-29

- Restored merged upstream Apache NOTICE content and corrected the bundled Jackson, FastDoubleParser, Schubfach, and SnakeYAML attribution inventory.
- Relocated Jackson, jsoup, and SnakeYAML base and Java 9/11/17/21 MR-JAR classes while preserving sqlite-jdbc versioned classes.
- Added a regression that opens SQLite connections concurrently from two isolated class loaders.
- Pinned Maven lifecycle plugins and GitHub Actions to explicit versions or commit SHAs.
- Added CI checks for exact single-JAR output, NOTICE/licenses, MR-JAR paths, relocation leaks, reproducible SHA-256, and all Bash helpers.

## 1.2.0-beta.22 — 2026-08-28

- Compressed Quick Start into four stages: Scope, HUMAN, ZAP, and LLM/Judge.
- Automatically selects the first incomplete stage from server-backed state and renders only that stage's controls.
- Preserved direct navigation to completed or advanced settings with a return to the current required stage.
- Split the README path into one-time setup and the four actions repeated for each assessment.
- Verified the single-panel stage navigator without horizontal overflow at a 390 px viewport.

## 1.2.0-beta.21 — 2026-08-28

- Treated ZAP Desktop and Docker as equal deployments behind the same loopback API contract, with pre-run connection/version/key status in Quick Start.
- Disabled ZAP campaigns until the API is connected and displayed both Desktop setup and optional Docker Quick Start in the same UI.
- Added `zap-key.sh` and `zap-key.ps1` to prepare an owner-only Desktop key without printing its value.
- Added `zap-up.ps1`, `zap-down.ps1`, and `doctor.ps1` for Windows 10/11, Docker Desktop Linux containers, and PowerShell 7.
- Added cryptographic key generation, protected current-user Windows ACLs, and custom-port-aware diagnostics.
- Replaced the OS-sensitive key bind syntax with a Compose file-backed secret.
- Added GitHub `windows-latest` PowerShell parser CI and synchronized Korean/English Windows setup and troubleshooting guides.
- Kept real Windows Docker/ZAP/Burp target capture as an explicit uncompleted validation gate.

## 1.2.0-beta.20 — 2026-08-28

- Distinguished the complete three-way runtime from reduced HUMAN-only mode and stopped requiring Maven for release-JAR users.
- Added an optional official ZAP 2.17.0 Compose setup pinned by manifest digest, loopback-only host publishing, and verified Docker-host Burp `8081` upstream configuration.
- Added one-command macOS/Linux ZAP lifecycle helpers and a listener/ZAP/add-on/provider/Web/MCP preflight check.
- Added owner-only default ZAP key-file discovery with explicit key, environment, and file precedence plus link and permission validation.
- Added reviewed Korean and English installation, first-run, Windows-manual, and troubleshooting guides and synchronized architecture and handoff documents.

## 1.2.0-beta.19 — 2026-08-28

- Replaced the `!important` override of Cytoscape-managed inline styles with a library-external `graphcanvas` wrapper that owns the desktop/narrow-screen visibility boundary.
- Locked the responsive contract so the canvas is actually absent and only the equivalent filtered API list remains at 600 px.

## 1.2.0-beta.18 — 2026-08-28

- Retained live HTTP requests and responses as bounded raw bytes plus body offsets instead of using Java String conversion as the canonical representation.
- Strictly decoded textual bodies from an explicit Content-Type charset or UTF-8, blocking Web edits for binary or undecodable bodies rather than inserting replacement characters.
- Replayed unchanged requests and Burp Repeater drafts from the original bytes; edited textual requests are strictly re-encoded with the declared charset.
- Wrapped operation labels at slash boundaries, removed meaningless single-count access labels, and replaced the off-screen graph with an equivalent filtered API list below 900 px.
- Added an explicit Evidence detail action that opens the exact selected Evidence item.
- Separated the wording and state of observed graph identities from reusable registered-account sessions.
- Passed 221 automated regressions and responsive browser checks at 1280 px and 600 px.

## 1.2.0-beta.17 — 2026-08-28

- Added a bounded in-process raw HTTP vault that is separate from RequestRecord, snapshots, projects, logs, and MCP output and is cleared on dataset replacement or unload.
- Added a full-screen Web request lab for a selected Evidence item with editable request, response viewer, and explicit original, anonymous, or active-account credential modes.
- Locked sends to the original service and exact scope, disabled redirects, retained upstream TLS verification and a 30-second timeout, and refreshed an existing Content-Length header after edits.
- Recorded request-lab results as HUMAN `MANUAL_HTTP / VALIDATION / CONTROLLED` Evidence so repeated manual probes cannot inflate discovery coverage or three-way gaps.
- Kept the unsent Burp Repeater handoff, preferring the in-memory original and honestly falling back to masked text for imported or over-limit Evidence.
- Added vault retention/eviction/clear and local Web API/UI regressions and documented the design against official Burp, ZAP, mitmproxy, and OWASP workflows.

## 1.2.0-beta.16 — 2026-08-28

- Correlate Repeater, Intruder, Target, and other non-Proxy Burp responses with their request-time run and account context by Montoya `messageId`, matching the existing Proxy guarantee.
- Fail closed when request-time correlation is unavailable instead of assigning a late response to whichever HUMAN pass happens to be active at response time.
- Reject responses from the previous dataset epoch after clear, sample replacement, or project load so late traffic cannot repopulate a reset workspace.
- Feed non-Proxy HUMAN responses back into the memory-only session broker, preserving cookie rotation during a pass without persisting raw credentials.
- Stop presenting Cookie, Authorization, and subject fingerprints as a count of login sessions in the role card; show one principal classification per graph identity and retain artifact counts only in advanced account diagnostics.
- Pass all 211 automated regressions, including concurrent in-flight capacity enforcement; actual beta.16 Burp Browser, Repeater late-response, and save/reopen gates remain explicitly pending.

## 1.2.0-beta.15 — 2026-08-28

- Treat a Client Spider completion with zero observed rendered captures as degraded execution and automatically run the AJAX Spider fallback.
- Preserve Traditional Spider evidence and native alerts when both rendered stages produce no traffic, while exposing `COMPLETED_WITH_WARNINGS` at campaign and identity-lane level.
- Keep warning-completed campaigns on the same frozen, masked post-lock alert snapshot contract instead of reading live ZAP alerts.
- Add a regression for the failure reproduced against local crAPI, where the Client Spider reported completion after its browser provider failed to start.
- Pass all 207 automated regressions and verify the single public beta.15 fat JAR as a valid ZIP archive.

## 1.2.0-beta.14 — 2026-08-28

- Changed the ZAP completion gate to count response-time raw Burp captures rather than the analysis snapshot that can lag by up to 400 ms, eliminating false zero-capture failures.
- Split per-identity scanner output into Traditional Spider and Client/AJAX rendered-browser capture counts and exposed live stage transitions.
- Replaced the single scanner status sentence with lane cards that follow the existing whs_flow-derived workbench grammar and expose stage, captures, alerts, warnings, and failures.
- Passed 206 automated regressions including stale-snapshot, stage attribution, three-lane failure/completion, and Web rendering contracts.

## 1.2.0-beta.13 — 2026-08-28

- Added HUMAN run polling and made completion depend on an exact exploration-run close marker instead of record counts.
- Preserved Repeater, Intruder, and Target provenance while inheriting the active HUMAN run, phase, and account context.
- Added a target-neutral semantic object profiler for corroborated `*No`, `*Number`, `*Seq`, `*Key`, `*Ref`, `*Uuid`, `*Guid`, and `*Vin` fields.
- Kept single observations, pagination/sort controls, and API/auth/token/session fields out of automatic object promotion.
- Stopped treating ordinary lowercase words such as `guid`, `valid`, and `fluid` as explicit `*Id` fields merely because they end in the characters `id`.
- Added Human-run, provenance, semantic-object, and local Web state-transition regression coverage.

## 1.2.0-beta.12 — 2026-08-27

- Rejected silent reassignment of one service-scoped credential fingerprint to a different account and held the conflicting broker session in `SUSPECT`, excluding it from identity attribution and credential injection.
- Exposed a specific credential-conflict state and recovery guidance in the account UI and session JSON contract.
- Folded duplicate access edges for the same identity, resource, and source into one `H/S/L×count` edge while retaining all original operations, coverage cells, Evidence, and verdicts.
- Added aggregated-edge details with per-operation counts, verdicts, gaps, and navigation back to each original access cell.
- Wrapped complete operation/resource labels with dynamic node height instead of clipping or middle ellipsis, and separated access lanes deterministically by identity and source.
- Added regressions for binding conflicts, non-reactivating broker conflicts, aggregation, long labels, and detail navigation.

## 1.2.0-beta.11 — 2026-08-27

- Paired each HUMAN/SCANNER/LLM filter with its main-comparison Evidence count and disabled zero-count sources.
- Rebuilt the visible graph after source changes so source-only nodes and both segments of `identity → resource → operation` disappear together.
- Applied the full HUMAN blue/solid/H, SCANNER red/dashed/S, and LLM black/dotted/L encoding to both access-path segments.
- Removed response-to-request ID/token dependency edges from the main access graph; the existing sequence view remains their single presentation.
- Replaced arbitrary role cycling in the graph rail with read-only account-role and API-requirement policy status.
- Advanced the saved graph-layout key to v3 and added Web contract regressions for the corrected interaction model.

## 1.2.0-beta.10 — 2026-08-27

- Added relational `.flowscope.db` project storage for records, payloads, accounts, bindings, policy, reviews, assessments, validations, and routes while retaining JSON v1/v2 import/export compatibility.
- Coalesced revisions into 30-second transactional atomic database checkpoints plus a final unload save; raw broker credentials remain memory-only.
- Projected Cookie, Authorization, and subject fingerprints from one login into one account card, with collapsed technical evidence and a separate advanced unassigned-artifact diagnostic.
- Replaced broker enum jargon with actionable login-state guidance and fixed HUMAN account availability to read the managed broker status.
- Added Xerial SQLite JDBC notices and regressions for relational round-trip, secret absence, unsupported schema, and three-artifact/one-account projection.

## 1.2.0-beta.9 — 2026-08-27

- Kept the beta.8 `identity → resource → operation` graph UI and separated retained raw paths from canonical operations.
- Added evidence-tiered path templating based on UUID/long-hex form, an exact ID in a successful JSON response, multiple values in one structural position, or independent observations.
- Exposed categorical `LITERAL / INFERRED / CORROBORATED` status and reasons in Web and MCP records instead of claiming confirmation without a route declaration or showing a fabricated confidence score.
- Kept an unsupported single `/status/200` literal while preserving the object candidate from a single `/orders/101`, so conservative operation grouping does not erase authorization analysis.
- Reused the evidence-tiered canonical operation for observed route inventory entries, preventing a literal graph operation from being mislabeled as an observed `{id}` template.
- Added regressions for grouping, service boundaries, date/version exclusions, cross-method corroboration, and raw-path retention.

## 1.2.0-beta.8 — 2026-08-27

- Retained masked textual request and response messages as GZIP payloads up to 1 MiB each and 48 MiB of deduplicated compressed payloads in aggregate, separate from the 8 KiB UI previews.
- Added project schema v2 with SHA-256-keyed payload deduplication and digest/byte-length verification while retaining schema v1 read compatibility.
- Kept binary, per-message-over-limit, and aggregate-budget-over-limit messages as size/digest/reason metadata and exposed their count in the Web UI.
- Extracted all explicit object identifiers from paths, queries, nested JSON/arrays, XML, multipart, and GraphQL while keeping one conservative primary resource for authorization cells.
- Separated authentication setup and stable repeated polling as `AUTH_SESSION` and `POLLING` without deleting their Evidence.
- Added an optional neutral support-flow layer for authentication, navigation, polling, and background traffic without affecting coverage, gaps, or verdicts.
- Fixed source filtering so nodes backed only by a disabled source are hidden together with their edges.
- Exposed dropped-record counts and an explicit incomplete-analysis warning when the 20,000 live-record safety limit is reached.
- Added a prominent banner identifying bundled H/S/L sample records as synthetic, with zero target network requests.

## 1.2.0-beta.7 — 2026-08-27

- Added Web quick-start controls that launch the user's locally authenticated Codex or Claude CLI as a new LLM Explorer, a separate Judge, cancellation, and explicit Judge follow-up.
- Isolated Explorer in a dedicated temporary workspace with Codex ephemeral or Claude no-persistence execution and no prior-session resume.
- Started Judge as a separate provider session and allowed exact-ID follow-up only after the MCP dataset lock actually succeeded.
- Passed the FlowScope MCP token only through the child environment and added shell-free execution, regular-executable validation, temporary-workspace permissions/cleanup, and bounded masked output.
- Removed inherited `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` values from subscription-CLI children, excluded the MCP token from Codex model-spawned shells, and explicitly disabled Codex web search.
- Excluded Claude user/project/local settings and auto-memory from Explorer, and closed cancellation/unload races before child registration.
- Added regressions for missing exact-run completion, incomplete three-lane gates, inactive accounts, locked datasets, and Codex session IDs at the beginning of oversized output.
- Invalidated a source's previous completion when a new exploration starts, keeping both the Judge UI and server lock closed after a failed retry.
- Rejected Burp-UI scope changes while any run is active or a Judge dataset is locked.
- Disclosed possible Claude no-persistence metadata residue instead of deleting the user's provider home or claiming physical zero-persistence.

## 1.2.0-beta.6 — 2026-08-26

- Attached applicability and reason to each provenance item so a source/run-filtered view can recompute state without inheriting another lane's conclusion.
- Added `flowscope_list_route_candidates`: an independent Explorer sees only its own run provenance, while a Judge sees the route inventory frozen at dataset lock.
- Removed pre-lock MCP leakage of cross-source counts, coverage, gaps, findings, and active runs; an Explorer receives only its own run metrics.
- Rejected ZAP state/execution and prior assessment/validation reads during independent exploration.
- Included route candidates in the immutable dataset lock so validation traffic or later rebuilds cannot change Judge route input.

## 1.2.0-beta.5 — 2026-08-26

- Split route discovery into document inputs, stateless format adapters, and one common exact-scope/method/normalization/deduplication gate.
- Added local HTML5 DOM parsing for malformed markup and `<base>`, conservative JavaScript call sites, OpenAPI/Swagger JSON and YAML, standard metadata, and product-neutral generic XML adapters.
- Kept an observed `GET` distinct from an unproven `UNKNOWN` method for the same path, preventing an untried combination from being promoted to observed.
- Persisted route provenance as `(type, Evidence ID, source, run, adapter)` mappings, exposed the mapping in Web details, and conservatively migrated legacy projects.
- Added a seven-case generic protocol corpus with 18 truth routes, XML external-entity regressions, and fat-JAR HTML/YAML/XML runtime smoke. These fixtures are not a blind-target performance claim.
- Added bundled notices for jsoup, Jackson YAML, and SnakeYAML and merged service metadata in the shaded artifact.

## 1.2.0-beta.4 — 2026-08-26

- Added classifier v3, separating web manifests, source maps, and service workers as discovery metadata and corroborating eligible ambiguous records only with strong API evidence for the same service and operation.
- Added provenance-backed exact-scope route candidates from stored HTML/forms, Location, robots/sitemaps, manifests, conservative JavaScript literals, observed OpenAPI, and response-less Burp Site Map items.
- Kept unrequested routes outside source coverage, three-way gaps, authorization verdicts, findings, and lane completion; exposed them as neutral graph nodes with dedicated count, filter, and detail.
- Persisted route candidates and exposed categorical priority reasons instead of an invented confidence score.
- Replaced the fixed object confidence with extraction evidence and added nested/array JSON and multipart object-ID regressions.
- Verified the standalone UI at 1280×720 and 600×800 with no horizontal overflow or console warnings/errors. Loading the beta.4 JAR in Burp Community, response-less Site Map behavior, and a real Burp Browser pass remain manual gates.

## 1.2.0-beta.3 — 2026-08-25

- Correlated Proxy responses with request-time `messageId` context so late responses cannot cross ZAP account lanes or a HUMAN pass boundary.
- Restricted account-bound HUMAN passes to `ACTIVE` sessions and record the selected account only when the observed request credentials exactly match it.
- Kept SYSTEM anonymous ZAP lanes `ANONYMOUS` while preserving lane-local server cookies/CSRF needed for stateful public flows.
- Exercised the current beta.3 JAR against Burp Community 2026.7.3, ZAP 2.17, crAPI, and the local MCP server for HUMAN-listener/SCANNER/LLM routing and out-of-scope LLM blocking. The HUMAN check used `curl` through listener 8080, not Burp Browser.
- Added a SYSTEM scanner campaign that isolates anonymous and multiple ACTIVE accounts with a fresh ZAP session per identity, reports per-identity capture/alert state, replaces account-lane authentication from the broker, and keeps the SCANNER completion gate closed if any identity fails.
- Kept login captures `UNVERIFIED` until a non-suspicious response is observed, prevented simultaneous same-service account capture, and surfaced recapture guidance in the Web account workflow.
- Locked LLM `account_id` propagation to the controlled executor with regression coverage and excluded the FlowScope Web loopback control plane from ZAP targets.
- Hardened the authorization oracle so denied or HEAD response owner fields cannot establish ownership, login redirects require exact path segments, and an owner string without the target object ID cannot satisfy BOLA object Evidence.
- Replaced the zero-Evidence analysis dashboard with an action-first exact-scope → HUMAN pass → ZAP baseline → LLM Explorer/Judge onboarding state, then reveals the existing analysis workspace once Evidence exists.
- Removed the Shade `original-*` intermediate from the public `target/` surface and made repeated package runs leave one identical Burp fat JAR.
- Moved ambiguous `REVIEW` Evidence out of the main graph and 3-way gaps into a review queue, with mutually exclusive `INCLUDE/REVIEW/EXCLUDE` counts and display filters.
- Separated HUMAN login capture as `SESSION_SETUP`; same-scope traffic outside an explicit HUMAN exploration pass remains Evidence but no longer contributes to 3-way coverage or gaps.
- Made the project-root README, changelog, contribution guide, and security policy Korean; separated detailed Korean documents under `docs/ko` and maintained English public guides under `docs/en`.
- Standardized source visualization as HUMAN blue/solid/H, SCANNER red/dashed/S, and LLM black/dotted/L, while separating generic interaction accents from source semantics.
- Restricted stored HUMAN and Burp-tool Evidence to the configured exact scope without blocking ordinary out-of-scope browser navigation.
- Replaced destructive traffic-noise filtering with an Evidence-preserving deterministic classifier that separates captured records from coverage input, exposes reasons and counts, and supports reversible operation-level overrides.
- Added `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` auth state and service-scoped stabilization of unbound rotating-cookie identities without discarding their safe fingerprints.
- Added display-only repeat clustering that retains every Evidence ID and first/last timestamp, plus classification/repeat/Evidence columns and direct detail navigation in the parsing table.
- Added HTTP context capture for request/response media types, Fetch Metadata, and CORS preflight detection; normal OPTIONS, misleading extensions, private image APIs, and telemetry-named endpoints remain conservatively reviewable.
- Kept captured/coverage/classification counts inside the existing independent-Explorer visibility boundary so they cannot reveal HUMAN or SCANNER activity before dataset lock.
- Added explicit memory-only account session capture with scoped Cookie/Bearer/CSRF injection, Set-Cookie rotation, suspect/expiry handling, safe metadata views, and revocation on unload.
- Added the FlowScope-controlled exact-scope LLM request executor and execution-trust provenance; decisive validation now rejects direct/unverified traffic.
- Enforced independent Explorer visibility on the MCP server and required exact HUMAN/SCANNER/LLM completion before an immutable Judge dataset lock.
- Fixed the real post-lock validation order so new controlled probe/control Evidence is read from current storage while candidates and authorization oracles remain locked.
- Added a deterministic SYSTEM ZAP baseline using Traditional Spider, strict Client Spider with AJAX fallback, passive queue completion, native alerts, and a zero-capture failure gate.
- Added Web quick-start session controls and ZAP target/multiple-account/per-identity progress controls with responsive long-text handling.
- Persisted explicit completed-lane metadata without inferring completion from interrupted exploration records; raw broker sessions remain non-persistent.
- Replaced direct curl/proxy agent guidance with closed-world Explorer/Judge prompts that prohibit external search and direct target networking.
- Added a detailed development log and repository-wide documentation contract so each behavior change records its reason, affected files, verification, limitations, and release/gate impact.
- Added presentation-ready screen rationale and corrected current beta documentation for the thin-JAR install trap, empty-state onboarding debt, missing raw-table Evidence entry, and trusted-project Codex MCP onboarding.

## 1.2.0-beta.2 — 2026-08-25

- Added authenticated MCP exact-scope replacement before active runs, with atomic validation and active SCANNER/LLM lease protection.
- Added explicit HUMAN pass start/end tracking in the Web quick-start.
- Added ZAP AJAX Spider orchestration and scan-ID-free status polling compatible with ZAP 2.17.
- Reported stopped AJAX runs with zero captured in-scope traffic as `NO_SCANNER_TRAFFIC_CAPTURED` instead of silently implying success.
- Reserved ZAP run provenance before start calls and cleared it on start failure or completion.
- Added conservative ownership extraction from explicit nested principal objects without trusting arbitrary scalar fields.

## 1.2.0-beta.1 — 2026-08-25

- Added server-validated LLM final verdict bundles with separate original, repeated reproduction, and authorized-control Evidence sets; ordinary LLM assessments remain non-final.
- Restricted decisive beta validation to safe GET candidates and revalidated persisted decisions against current findings and Evidence on load.
- Added paginated MCP Evidence discovery and 200-record Web Request/Response pages.
- Enforced exact-scope SCANNER/LLM capture, encoded traversal rejection, loopback Host validation, non-overlapping run leases, and exact run-id termination.
- Added structured JSON, form, multipart, and XML secret masking with fail-closed handling for malformed secret-bearing JSON.
- Removed request-body ownership trust, quarantined UNKNOWN traffic from analysis, and required exact structured object evidence for BOLA decisions.
- Made backend coverage cells, gaps, and per-source verdicts the Web UI source of truth, with stable Evidence content digests across valid project round trips.
- Added a compact first-run wizard and responsive 1280/900/600-pixel UI fixes while retaining on-demand masked Request/Response and Repeater drafts.
- Masked the MCP Bearer in the Burp control tab while keeping the explicit clipboard-copy workflow.

## 1.1.0 — 2026-08-25

- Replaced the duplicated Swing/JGraphX analysis workspace with the selected `whs_flow`-based bundled Web UI and a small Burp control tab.
- Added localhost Web capability authentication, Host/Origin validation, CSP/no-store/frame protections, and bounded XML/form bodies on the Burp-compatible custom HTTP server.
- Added graph, matrix, flow, scenario, raw-record, account/session, required-role, owner, and Evidence-bound human review workflows to one canonical responsive workspace.
- Added on-demand masked Request/Response loading so the polling snapshot remains lightweight at the 20,000-record product bound.
- Added safe masked unsent Burp Repeater draft handoff without fabricating replay responses or automatic correlation.
- Added direct identity-to-operation graph edges for objectless endpoints and collision-safe cell keys.
- Replaced JGraphX with locally bundled Cytoscape.js and updated third-party notices.

## 1.0.0 — 2026-08-24

- Added three-lane HUMAN / SCANNER / LLM live capture and provenance filters.
- Added identity-aware graph, coverage matrix, BOLA/IDOR and BFLA candidate rules, and Evidence detail.
- Added query/body/GraphQL normalization, redirects, response taxonomy, and bounded data-flow links.
- Added localhost authenticated MCP integration for Codex and Claude Code subscription clients.
- Added scope-guarded ZAP Spider and approval-gated Active Scan orchestration.
- Added LLM Explorer/Coach run contexts and non-confirming Evidence-linked assessments.
- Added masked versioned project save/load and strict Burp XML import.
- Added security hardening, dependency notices, and regression/integration/UI tests.
- Added Burp-native Request/Response Evidence viewers, related-record navigation, side-by-side expansion, masked copy actions, and current-Evidence Repeater handoff.
- Added secret-free per-service test accounts and explicit discovered/rotating-session bindings throughout graph, matrix, policy, and project persistence.
- Added an explicit Burp Proxy-history import that preserves observation multiplicity while suppressing already imported copies.
- Added a no-network HUMAN/SCANNER/LLM onboarding sample whose BOLA/BFLA candidates are produced by the real analysis pipeline.
- Added Evidence-bound human `confirmed / unresolved / dismissed` decisions and masked review notes for both rule and LLM candidates.
- Added a full-width `whs_flow`-inspired account/session workspace while retaining native Burp Request/Response editors and explicit secret-free bindings.
- Added large-graph presentation folding with 18-at-a-time resource/API group nodes, click-to-expand, and reset-to-folded controls.
