# Changelog

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
