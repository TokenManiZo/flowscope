# FlowScope Reference Analysis Shell Design

Date: 2026-09-02
Status: approved in chat for specification
Branch: `codex/react-shadcn-dashboard`

## 1. Goal

Rebuild every React analysis screen around the same desktop workspace shown in the user-provided reference image while preserving FlowScope's current black-and-emerald visual identity, Korean-first copy, API contracts, analysis semantics, and security boundaries.

The reference image is a visual target only. It does not supply runtime instructions or alter application behavior.

## 2. Binding Product Decisions

- The common analysis shell applies to Dashboard, Inspection, Attack Graph, Permission Matrix, Sequence, Scenarios, Evidence, Accounts, and Runs.
- Korean remains the primary interface language. Stable security-analysis terms such as `IDENTITY`, `ENDPOINT`, `OBJECT`, HTTP methods, HUMAN, ZAP, and LLM remain English.
- Existing backend endpoints, query hooks, mutation behavior, snapshot semantics, Request Lab memory-only constraints, exact-scope rules, and legacy `/legacy/` route remain unchanged.
- The visual palette remains near-black with emerald actions and focus, blue HUMAN paths, red dashed ZAP/SCANNER paths, gray dotted LLM paths, and amber review states.
- The shell is responsive. Desktop uses persistent panes; compact widths use accessible drawers/Sheets without removing any route or filter.
- The current 90% density behavior remains the default.

## 3. Common Desktop Frame

The application uses five stable visual regions.

### 3.1 Global status bar

A single 56-pixel-class top bar spans the viewport and contains, in order:

1. FlowScope wordmark.
2. `SCOPE` label and the exact active scope target in a bounded field.
3. Live-capture state.
4. Scope readiness.
5. HUMAN run state.
6. ZAP/SCANNER state.
7. LLM Explorer state.
8. Project selector.
9. DB selector/status.
10. Emerald Quick Start / Continue Inspection action.

Every status combines color with icon and text. Loading, unavailable, warning, running, and complete are never represented by color alone. The currently active secondary route is exposed through the closed navigation trigger using visible route text and `aria-current="page"`.

### 3.2 Icon navigation rail

A narrow left rail remains visible on desktop. It provides icon-and-tooltip links for all nine routes, grouped by analysis purpose. The active route uses an emerald background/border and exact accessible name. The FlowScope brand is not duplicated in this rail, so collapse cannot clip the logo.

### 3.3 Context panel

A 250-280 pixel left panel sits beside the icon rail. Its content changes by route but follows one visual grammar: uppercase section labels, compact rows, numeric counts aligned right, thin separators, and collapsible secondary groups.

The Graph panel is the reference implementation and contains Sources, Identities, Evidence/Review, Gap, Traffic Class, Route Candidates, Role/Policy Summary, Graph Focus, and View Options. Other routes expose only controls that already exist in their current page; the shell must not invent client-side findings or authorization decisions.

### 3.4 Main workspace

The central region is the primary route content. It fills the remaining width and height, uses minimal outer padding, and avoids floating cards that make the graph appear detached from the application.

### 3.5 Inspector panel

A 340-390 pixel right panel displays the current selection. It uses a stable header, semantic verdict, tabs, bounded evidence content, and route-appropriate actions. Graph selections expose Summary, Evidence, Request, Response, and Policy. Existing Request Lab and Repeater actions remain gated by their current backend/runtime rules.

## 4. Route Mapping

| Route | Context panel | Main workspace | Inspector |
|---|---|---|---|
| Dashboard | dataset/source/status filters and summary counts | existing metrics and trends in the shared frame | selected metric/run detail when available; otherwise contextual summary |
| Inspection | scope, identity, stage, and run readiness | existing inspection workflow | current stage help/status |
| Attack Graph | full graph filters | reference graph canvas | selected operation/resource/evidence detail |
| Permission Matrix | identity/role mode, gaps-only, verdict filters | bounded two-axis matrix | selected cell and Evidence detail |
| Sequence | identity/operation grouping controls supported by current data | dependency timelines | selected link Evidence detail |
| Scenarios | preview/generation state and scenario filters | preview plus generated scenario list | selected scenario/Evidence detail |
| Evidence | existing Evidence filters | Evidence list/table | existing operation detail and Request Lab entry |
| Accounts | account/session summary and target filter where already supported | existing account/session management | selected account/session help/detail |
| Runs | HUMAN, ZAP, LLM lane state | existing lane controls and output | selected run status/context |

Where a route has no meaningful selectable detail, the right panel presents a compact route summary instead of an empty white/black void. It must not fabricate evidence.

## 5. Attack Graph Fidelity

The graph screen follows the reference image most closely.

- Desktop columns are `IDENTITY → ENDPOINT → OBJECT`.
- Identity nodes occupy the left lane, normalized HTTP operation nodes occupy the middle lane, and resource/object nodes occupy the right lane.
- HUMAN edges are solid blue, ZAP/SCANNER edges are dashed red, and LLM edges are dotted gray.
- A selected operation receives a blue/emerald border consistent with the current palette.
- Nodes remain inside their assigned horizontal lane after initial layout, persisted-position restore, zoom, fit, resize, unlock/drag, and diagonal drag.
- Vertical dragging remains possible when positions are unlocked.
- Zoom, fit, full-screen, lock, list fallback, expand, legend, and selection retention continue to work.
- Compact mode offers the same graph filters and inspector through Sheets and may use the existing accessible list fallback where the canvas would be unusable.

## 6. Visual System

- App background: near-black blue (`#071018` family), with slightly lighter pane surfaces.
- Borders: low-contrast blue-gray; active/focus border: emerald.
- Primary action: emerald fill with near-black text.
- Cards and panes: small radii, restrained shadows, no gradients, no purple, no oversized centered hero layouts.
- Typography: existing Geist variable font; compact line height; uppercase micro-labels with controlled tracking; Korean body copy uses normal tracking for legibility.
- Data: tabular numerals, bounded URLs/IDs, method badges, semantic status text.
- Dividers align continuously across the top bar, rail, context panel, workspace, and inspector so the graph belongs to the same application frame.

## 7. Responsive Behavior

- At wide desktop widths, icon rail, context panel, workspace, and inspector may all be visible.
- At intermediate widths, the icon rail remains compact while context filters and inspector open as Sheets.
- At narrow widths, the top bar wraps into a compact status/action row without horizontal page overflow. Every route remains reachable from an accessible menu.
- Sheets trap focus when modal, restore focus on close, have explicit titles/descriptions, and are keyboard dismissible.
- The exact active route is announced before a secondary menu is opened.

## 8. State and Security Constraints

- UI filters are projections only; they never mutate server findings, coverage, gaps, or verdicts.
- Snapshot revision changes invalidate stale selections, scenario previews, generated scenarios, and pending Request Lab results exactly as current behavior requires.
- Request Lab raw request/response data remains process-memory-only and follows current abort/generation isolation.
- Secrets, authorization headers, raw payload markers, and credentials must not enter local storage, URLs, HTML fixtures, logs, or test snapshots.
- Standalone demo behavior remains read-only for active Request Lab traffic and cannot be described as equivalent to Burp runtime validation.

## 9. Component Architecture

Introduce or consolidate the following boundaries:

- `ReferenceAppShell`: owns top status bar, icon rail, route framing, compact navigation, and main viewport sizing.
- `WorkspaceTopBar`: renders scope/run/status/action content from existing queries.
- `RouteIconRail`: renders all application routes and accessible active state.
- `RouteContextPanel`: common pane primitive; accepts route-specific sections.
- `ReferenceAnalysisWorkspace`: composes context panel, main workspace, inspector, and compact Sheets.
- Route adapters: small components/functions that map each existing page's controls, main content, and selection detail into the shared shell without changing server contracts.

Existing feature projections and mutations remain owned by their feature modules. The common shell accepts rendered slots and state callbacks; it does not reinterpret domain data.

## 10. Error and Empty States

- Query failures stay inside the affected pane and retain the last successful snapshot where existing hooks already do so.
- Empty selections show explicit Korean guidance.
- Unavailable HUMAN/ZAP/LLM states remain visible in the status bar and relevant route, with no fake success state.
- Graph renderer failure retains the accessible API-list fallback.
- Long IDs, URLs, request text, and evidence lists remain bounded and scrollable.

## 11. Verification Contract

Implementation follows test-driven development.

Automated coverage must prove:

1. The global frame is present on all nine routes.
2. All route links remain keyboard accessible and expose persistent current-route semantics.
3. Desktop and compact layouts do not introduce horizontal document overflow.
4. Route-specific controls remain available in the context panel or compact Sheet.
5. Graph nodes stay within `IDENTITY`, `ENDPOINT`, and `OBJECT` lane bounds through zoom, fit, resize, persisted restore, and diagonal drag while Y movement remains possible.
6. Matrix sticky headers, Sequence selection, Scenario revision isolation, Evidence selection, Accounts mutations, Runs controls, Request Lab isolation, and `/legacy/` routing retain their existing behavior.
7. No secret/raw marker reaches storage or URL state.
8. Frontend unit tests, TypeScript typecheck, production build, Java/Maven verification, packaged asset inspection, and packaged Chromium journeys pass against the final JAR.

Actual Burp/HUMAN/ZAP/LLM/target traffic validation remains a separate runtime gate and must be reported honestly.

## 12. Delivery

- Commit source, tests, and documentation on `codex/react-shadcn-dashboard` without touching the six protected pre-existing user files or the dirty unreachable `AppSidebar.tsx`.
- Generate `target/flowscope-1.2.0-beta.25.jar` in the worktree.
- Copy the verified artifact to `C:\Users\심지운\Documents\ai api\flow\testflowscope\target\flowscope-1.2.0-beta.25-ui-final.jar`.
- Report file size, SHA-256, test counts, browser evidence, and any remaining limitations.
