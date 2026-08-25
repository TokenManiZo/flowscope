# Changelog

## 1.2.0-beta.3 — 2026-08-25

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
- Added Web quick-start session controls and ZAP target/account/progress controls with responsive long-text handling.
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
