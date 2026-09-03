# Reference Analysis Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the user-provided reference workspace structure to every FlowScope analysis route while retaining the current black/emerald palette and all existing behavior.

**Architecture:** A new shared application frame owns the top status bar and route icon rail. Each route renders through a slot-based analysis workspace with a context pane, a main surface, and an inspector; domain projections and mutations remain inside their existing feature modules. The Graph is the highest-fidelity reference implementation, while other routes use the same panes without inventing data or moving security decisions client-side.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Tailwind CSS 4, shadcn/Radix primitives, TanStack Query, Cytoscape, Vitest/Testing Library, Playwright, Java 21/Maven 3.9.11.

**Spec:** `docs/superpowers/specs/2026-09-02-reference-analysis-shell-design.md`

## Global Constraints

- Apply the common shell to Dashboard, Inspection, Attack Graph, Permission Matrix, Sequence, Scenarios, Evidence, Accounts, and Runs.
- Preserve Korean-first copy; keep `IDENTITY`, `ENDPOINT`, `OBJECT`, HTTP methods, HUMAN, ZAP, and LLM in English.
- Preserve all backend endpoints, query hooks, exact-scope rules, snapshot semantics, Request Lab memory-only/abort isolation, and `/legacy/` behavior.
- Preserve `html.flowscope-density-90` as the default density.
- Use the current near-black/emerald palette, solid blue HUMAN, dashed red ZAP/SCANNER, dotted gray LLM, and amber review semantics; never encode state by color alone.
- Desktop uses persistent panes. Intermediate/compact widths use accessible route, context, and inspector Sheets without removing controls.
- Graph nodes remain inside `IDENTITY → ENDPOINT → OBJECT` lane bounds through restore, zoom, fit, resize, and diagonal drag; unlocked nodes may move vertically.
- Do not store or expose credentials, authorization values, raw payload markers, or Request Lab memory-only data in URLs, local storage, fixtures, logs, or snapshots.
- Do not edit, stage, discard, or commit the six protected pre-existing Java/test paths or the dirty unreachable `frontend/src/components/layout/AppSidebar.tsx`.

---

### Task 1: Build the reference application frame

**Files:**
- Create: `frontend/src/components/layout/WorkspaceTopBar.tsx`
- Create: `frontend/src/components/layout/WorkspaceTopBar.test.tsx`
- Create: `frontend/src/components/layout/RouteIconRail.tsx`
- Create: `frontend/src/components/layout/RouteIconRail.test.tsx`
- Create: `frontend/src/components/layout/RouteContextPanel.tsx`
- Create: `frontend/src/components/layout/ReferenceAppShell.tsx`
- Create: `frontend/src/components/layout/ReferenceAppShell.test.tsx`
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/app/AppShell.test.tsx`
- Modify: `frontend/src/app/routes.ts`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `AppRoute`, `routeHash`, `routeLabel`, existing run/snapshot query hooks.
- Produces:

```ts
export interface ReferenceAppShellProps {
  route: AppRoute
  children: React.ReactNode
}

export interface RouteContextPanelProps {
  title: string
  count?: string
  children: React.ReactNode
  className?: string
}
```

- `WorkspaceTopBar` receives `{ route: AppRoute }` and derives existing status data only through current hooks.
- `RouteIconRail` receives `{ route: AppRoute }` and exposes all nine exact route links.

- [ ] **Step 1: Write failing frame tests**

Add tests asserting that every route renders `FlowScope 상단 상태`, `주요 분석 탐색`, and a `main` landmark; that the active rail link has `aria-current="page"`; and that a secondary route such as Matrix is announced while any compact menu is closed.

```tsx
for (const route of appRoutes) {
  it(`${route.route} uses the reference frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)
    expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
    expect(screen.getByRole("navigation", { name: "주요 분석 탐색" })).toBeVisible()
    expect(screen.getByRole("link", { name: route.label })).toHaveAttribute("aria-current", "page")
  })
}
```

- [ ] **Step 2: Run the frame tests and verify RED**

Run:

```powershell
npm.cmd test -- src/components/layout/ReferenceAppShell.test.tsx src/components/layout/WorkspaceTopBar.test.tsx src/components/layout/RouteIconRail.test.tsx src/app/AppShell.test.tsx --maxWorkers=1
```

Expected: FAIL because the new frame components and landmarks do not exist.

- [ ] **Step 3: Implement the shared frame**

Use a fixed-height top status bar, `3.75rem` icon rail, and a route viewport that fills `100svh` without document-level horizontal overflow. Build route metadata once in `routes.ts`:

```ts
export interface AppRouteDefinition {
  route: AppRoute
  label: string
  group: "overview" | "analysis" | "evidence" | "operations"
  icon: LucideIcon
}
```

Render scope, live capture, HUMAN, ZAP, and LLM states with icon + text. The compact route button shows the exact active route label and `aria-current="page"` before its menu opens. Project and DB controls remain non-destructive selectors/statuses unless an existing endpoint provides behavior.

- [ ] **Step 4: Apply reference visual tokens**

Add named CSS variables under `.dark` for pane, canvas, divider, HUMAN, SCANNER, LLM, REVIEW, and emerald focus. Keep Geist and the 90% root density. Use square-to-small radii and continuous borders; do not add gradients.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command, then:

```powershell
npm.cmd run typecheck
```

Expected: all frame tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```powershell
git add -- frontend/src/components/layout/WorkspaceTopBar.tsx frontend/src/components/layout/WorkspaceTopBar.test.tsx frontend/src/components/layout/RouteIconRail.tsx frontend/src/components/layout/RouteIconRail.test.tsx frontend/src/components/layout/RouteContextPanel.tsx frontend/src/components/layout/ReferenceAppShell.tsx frontend/src/components/layout/ReferenceAppShell.test.tsx frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx frontend/src/app/routes.ts frontend/src/index.css
git commit -m "feat(web): add reference analysis frame"
```

### Task 2: Generalize the context-main-inspector workspace

**Files:**
- Create: `frontend/src/components/layout/ReferenceAnalysisWorkspace.tsx`
- Create: `frontend/src/components/layout/ReferenceAnalysisWorkspace.test.tsx`
- Modify: `frontend/src/components/layout/AnalysisWorkspace.tsx`
- Modify: `frontend/src/components/layout/AnalysisWorkspace.test.tsx`
- Modify: `frontend/src/components/layout/InspectorPanel.tsx`

**Interfaces:**
- Consumes: `RouteContextPanel`, shadcn `Sheet`, route-owned rendered controls and inspector content.
- Produces:

```ts
export interface ReferenceAnalysisWorkspaceProps {
  ariaLabel: string
  context: React.ReactNode
  toolbar?: React.ReactNode
  children: React.ReactNode
  inspector: React.ReactNode
  inspectorOpen?: boolean
  contextOpen?: boolean
  onInspectorOpenChange?(open: boolean): void
  onContextOpenChange?(open: boolean): void
}
```

- [ ] **Step 1: Write failing workspace tests**

Assert persistent desktop landmarks, the exact grid columns, compact context/inspector triggers, Sheet titles/descriptions, focus restoration, and absence of horizontal document overflow at simulated 900px and 600px media states.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- src/components/layout/ReferenceAnalysisWorkspace.test.tsx src/components/layout/AnalysisWorkspace.test.tsx --maxWorkers=1
```

Expected: FAIL because `ReferenceAnalysisWorkspace` is missing.

- [ ] **Step 3: Implement the slot-based workspace**

Desktop grid after the icon rail is:

```css
grid-template-columns: minmax(15.5rem, 17rem) minmax(0, 1fr) minmax(22rem, 25rem);
```

The center surface must remain `min-width: 0`. Context and inspector use continuous borders and `overflow-y: auto`. Below the desktop breakpoint, render the same supplied nodes in named Sheets; do not duplicate route logic or maintain separate filter state.

- [ ] **Step 4: Adapt the legacy `AnalysisWorkspace` wrapper**

Keep its public props working for temporary callers, delegating rendering to `ReferenceAnalysisWorkspace`. This prevents a flag-day migration and keeps Task 3 independently runnable.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm.cmd test -- src/components/layout/ReferenceAnalysisWorkspace.test.tsx src/components/layout/AnalysisWorkspace.test.tsx --maxWorkers=1
npm.cmd run typecheck
git add -- frontend/src/components/layout/ReferenceAnalysisWorkspace.tsx frontend/src/components/layout/ReferenceAnalysisWorkspace.test.tsx frontend/src/components/layout/AnalysisWorkspace.tsx frontend/src/components/layout/AnalysisWorkspace.test.tsx frontend/src/components/layout/InspectorPanel.tsx
git commit -m "feat(web): add shared reference workspace"
```

### Task 3: Rebuild the Attack Graph to match the reference

**Files:**
- Modify: `frontend/src/features/graph/GraphPage.tsx`
- Modify: `frontend/src/features/graph/GraphPage.test.tsx`
- Modify: `frontend/src/features/graph/CytoscapeGraph.tsx`
- Modify: `frontend/src/features/graph/CytoscapeGraph.test.tsx`
- Modify: `frontend/src/features/graph/graphLanes.ts`
- Modify: `frontend/src/features/graph/graphLanes.test.ts`
- Modify: `frontend/src/features/graph/GraphInspectorPanel.tsx`
- Modify: `frontend/src/features/graph/GraphInspectorPanel.test.tsx`
- Modify: `frontend/src/features/graph/ResponsiveGraphList.tsx`

**Interfaces:**
- Consumes: `ReferenceAnalysisWorkspace`, existing `GraphProjection`, `GraphPreferences`, and selection callbacks.
- Produces a visual mapping where projection operations render in `ENDPOINT` and projection resources render in `OBJECT`; domain names in the API remain unchanged.

- [ ] **Step 1: Write failing graph structure tests**

Assert `SOURCES`, `IDENTITIES`, `EVIDENCE`, `GAP`, `TRAFFIC CLASS`, `ROUTE CANDIDATES`, `ROLE - POLICY SUMMARY`, `GRAPH FOCUS`, and `VIEW OPTIONS` context groups. Assert visible lane labels are exactly `IDENTITY`, `ENDPOINT`, `OBJECT`, and the inspector tabs are Summary, Evidence, Request, Response, Policy.

- [ ] **Step 2: Write failing geometry tests**

For a 1,200px canvas, assert identity centers stay in the first lane, endpoint centers in the second, and object centers in the third. Simulate restore, zoom, fit, resize, and diagonal drag; assert X remains clamped while Y changes when unlocked.

```ts
expect(center.x).toBeGreaterThanOrEqual(bounds.left + nodeWidth / 2)
expect(center.x).toBeLessThanOrEqual(bounds.right - nodeWidth / 2)
expect(afterDrag.y).not.toBe(beforeDrag.y)
```

- [ ] **Step 3: Run graph tests and verify RED**

```powershell
npm.cmd test -- src/features/graph/GraphPage.test.tsx src/features/graph/CytoscapeGraph.test.tsx src/features/graph/graphLanes.test.ts src/features/graph/GraphInspectorPanel.test.tsx --maxWorkers=1
```

Expected: FAIL on the old RESOURCE/OPERATION order, missing context groups, and missing Policy tab.

- [ ] **Step 4: Implement the reference graph composition**

Move operation nodes to the middle visual lane and resources to the right visual lane without renaming server fields. Keep source edge styles, preference persistence, renderer fallback, and selection retention. Align filter rows, counts, dividers, toolbar controls, legend, node cards, and the inspector with the reference image.

- [ ] **Step 5: Complete inspector actions safely**

Add the Policy tab from existing `requiredRoles`, `owners`, and selected server cells only. Show Request Lab/Repeater actions only through the current evidence/action components and their existing runtime gating; do not create direct network behavior in the graph.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm.cmd test -- src/features/graph/GraphPage.test.tsx src/features/graph/CytoscapeGraph.test.tsx src/features/graph/graphLanes.test.ts src/features/graph/GraphInspectorPanel.test.tsx --maxWorkers=1
npm.cmd run typecheck
git add -- frontend/src/features/graph/GraphPage.tsx frontend/src/features/graph/GraphPage.test.tsx frontend/src/features/graph/CytoscapeGraph.tsx frontend/src/features/graph/CytoscapeGraph.test.tsx frontend/src/features/graph/graphLanes.ts frontend/src/features/graph/graphLanes.test.ts frontend/src/features/graph/GraphInspectorPanel.tsx frontend/src/features/graph/GraphInspectorPanel.test.tsx frontend/src/features/graph/ResponsiveGraphList.tsx
git commit -m "feat(web): match the reference attack graph"
```

### Task 4: Move Matrix, Sequence, Scenarios, and Evidence into the shared workspace

**Files:**
- Modify: `frontend/src/features/matrix/MatrixPage.tsx`
- Modify: `frontend/src/features/matrix/MatrixPage.test.tsx`
- Modify: `frontend/src/features/sequence/SequencePage.tsx`
- Modify: `frontend/src/features/sequence/SequencePage.test.tsx`
- Modify: `frontend/src/features/scenarios/ScenariosPage.tsx`
- Modify: `frontend/src/features/scenarios/ScenariosPage.test.tsx`
- Modify: `frontend/src/features/evidence/EvidencePage.tsx`
- Modify: `frontend/src/features/evidence/EvidencePage.test.tsx`
- Modify: `frontend/src/components/layout/EvidenceSheet.tsx`
- Modify: `frontend/src/components/layout/EvidenceSheet.test.tsx`

**Interfaces:**
- Consumes: `ReferenceAnalysisWorkspace` and existing per-route local state/projections.
- Produces: route context controls rendered from the same state as the center content, and persistent desktop inspector content using the existing selection types.

- [ ] **Step 1: Write failing route-frame tests**

For each route assert the shared context, center, and inspector landmarks. Assert Matrix mode/gaps controls, Evidence filters, and scenario preview/generation controls appear in the context pane or a compact Sheet and still update the same projection.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- src/features/matrix/MatrixPage.test.tsx src/features/sequence/SequencePage.test.tsx src/features/scenarios/ScenariosPage.test.tsx src/features/evidence/EvidencePage.test.tsx src/components/layout/EvidenceSheet.test.tsx --maxWorkers=1
```

Expected: FAIL because these routes still render standalone page stacks/Sheets.

- [ ] **Step 3: Adapt Matrix and Sequence**

Move Matrix display controls into the shared context slot while keeping the single bounded two-axis scroll viewport and sticky corner. Render selected Matrix/Sequence detail in the desktop inspector and the same detail in compact Sheet mode. Preserve server verdicts, link ordering, and stale-selection invalidation.

- [ ] **Step 4: Adapt Scenarios and Evidence**

Move only existing filters/actions to the context pane. Preserve revision-token isolation and preview eligibility. Reuse `EvidenceSheet` content as a desktop inspector body without duplicating Request Lab ownership; compact mode retains its Sheet behavior.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm.cmd test -- src/features/matrix/MatrixPage.test.tsx src/features/sequence/SequencePage.test.tsx src/features/scenarios/ScenariosPage.test.tsx src/features/evidence/EvidencePage.test.tsx src/components/layout/EvidenceSheet.test.tsx --maxWorkers=1
npm.cmd run typecheck
git add -- frontend/src/features/matrix/MatrixPage.tsx frontend/src/features/matrix/MatrixPage.test.tsx frontend/src/features/sequence/SequencePage.tsx frontend/src/features/sequence/SequencePage.test.tsx frontend/src/features/scenarios/ScenariosPage.tsx frontend/src/features/scenarios/ScenariosPage.test.tsx frontend/src/features/evidence/EvidencePage.tsx frontend/src/features/evidence/EvidencePage.test.tsx frontend/src/components/layout/EvidenceSheet.tsx frontend/src/components/layout/EvidenceSheet.test.tsx
git commit -m "feat(web): unify core analysis routes"
```

### Task 5: Move Dashboard, Inspection, Accounts, and Runs into the shared workspace

**Files:**
- Modify: `frontend/src/features/dashboard/DashboardPage.tsx`
- Modify: `frontend/src/features/dashboard/DashboardPage.test.tsx`
- Modify: `frontend/src/features/inspection/InspectionPage.tsx`
- Modify: `frontend/src/features/inspection/InspectionPage.test.tsx`
- Modify: `frontend/src/features/accounts/AccountsPage.tsx`
- Modify: `frontend/src/features/accounts/AccountsPage.test.tsx`
- Modify: `frontend/src/features/runs/RunsPage.tsx`
- Modify: `frontend/src/features/runs/RunsPage.test.tsx`

**Interfaces:**
- Consumes: `ReferenceAnalysisWorkspace`, existing mutations, run/status projections, and charts.
- Produces: the same reference panes on all remaining routes with non-fabricated contextual summaries where no selection exists.

- [ ] **Step 1: Write failing shared-frame tests**

Assert each route renders a context pane and inspector/summary pane. Assert existing Dashboard metrics/chart, Inspection stage controls, Accounts mutations, and Runs HUMAN/ZAP/LLM controls remain present and callable.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- src/features/dashboard/DashboardPage.test.tsx src/features/inspection/InspectionPage.test.tsx src/features/accounts/AccountsPage.test.tsx src/features/runs/RunsPage.test.tsx --maxWorkers=1
```

Expected: FAIL because these pages are not composed through the shared workspace.

- [ ] **Step 3: Adapt route layouts**

Place existing route controls or compact summaries in the left context pane, retain the main functional content in the center, and render a status/help summary on the right when no real selected item exists. Do not add inactive buttons that imply unsupported server operations.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm.cmd test -- src/features/dashboard/DashboardPage.test.tsx src/features/inspection/InspectionPage.test.tsx src/features/accounts/AccountsPage.test.tsx src/features/runs/RunsPage.test.tsx --maxWorkers=1
npm.cmd run typecheck
git add -- frontend/src/features/dashboard/DashboardPage.tsx frontend/src/features/dashboard/DashboardPage.test.tsx frontend/src/features/inspection/InspectionPage.tsx frontend/src/features/inspection/InspectionPage.test.tsx frontend/src/features/accounts/AccountsPage.tsx frontend/src/features/accounts/AccountsPage.test.tsx frontend/src/features/runs/RunsPage.tsx frontend/src/features/runs/RunsPage.test.tsx
git commit -m "feat(web): unify operational routes"
```

### Task 6: Verify responsive fidelity, accessibility, documentation, and final JAR

**Files:**
- Modify: `frontend/e2e/parity.spec.ts`
- Modify: `frontend/src/components/layout/ReferenceAppShell.test.tsx`
- Modify: `frontend/src/components/layout/ReferenceAnalysisWorkspace.test.tsx`
- Modify: `docs/ko/architecture.md`
- Modify: `docs/ko/development-log.md`
- Modify: `docs/ko/ui-product-rationale.md`
- Modify: `docs/ko/web-ui-feature-parity.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: final component behavior from Tasks 1-5 and external-origin Playwright support.
- Produces: verified source JAR and copied delivery JAR with matching SHA-256.

- [ ] **Step 1: Write failing packaged browser assertions**

Assert the reference frame on all routes at desktop, 900px, and 600px; exact active-route semantics while compact menus are closed; no horizontal document overflow; context/inspector Sheet access; Graph lane geometry/diagonal drag; Matrix sticky retention; Request Lab behavior; and `/legacy/` availability.

- [ ] **Step 2: Run focused E2E against the existing packaged JAR and verify RED**

Start the current JAR on a free loopback port and run:

```powershell
$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$e2ePort = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$jarPath = (Resolve-Path '..\target\flowscope-1.2.0-beta.25.jar').Path
$jarProcess = Start-Process java -ArgumentList @('-Djava.awt.headless=true', "-Dflowscope.web.port=$e2ePort", '-cp', $jarPath, 'io.flowscope.Standalone') -PassThru -WindowStyle Hidden
$env:FLOWSCOPE_E2E_ORIGIN="http://127.0.0.1:$e2ePort/app/?reference-shell=red"
$env:PWTEST_CACHE_DIR='C:\CodexPwDiag\pw-cache-reference-shell'
npm.cmd run e2e
Stop-Process -Id $jarProcess.Id -Force
```

Expected: new reference-frame assertions fail before the final route adaptations are packaged.

- [ ] **Step 3: Run complete frontend gates**

```powershell
npm.cmd test -- --maxWorkers=1
npm.cmd run typecheck
npm.cmd run notices
npm.cmd run build
```

Expected: 0 failing tests, typecheck exit 0, notices generated, Vite build exit 0.

- [ ] **Step 4: Update documentation**

Document the five-region frame, route mapping, responsive Sheets, semantic colors, persistent current-route accessibility, Graph visual lane mapping, and the distinction between standalone browser verification and real Burp/target validation. Record exact final test counts rather than copying historical counts.

- [ ] **Step 5: Build and verify the fat JAR**

```powershell
& 'C:\Users\심지운\AppData\Local\Temp\flowscope-maven-3.9.11\apache-maven-3.9.11\bin\mvn.cmd' -B '-Dskip.npm=true' verify
```

Expected: Java tests report 0 failures, fat-JAR release isolation passes, and exactly one public JAR remains in `target`.

- [ ] **Step 6: Run packaged Chromium GREEN**

Start the new fat JAR on a free loopback port and rerun the Step 2 Playwright command with a fresh ASCII cache directory. Expected: all packaged journeys pass with 0 console/page errors.

- [ ] **Step 7: Copy and hash the deliverable**

Copy the verified worktree JAR to:

```text
C:\Users\심지운\Documents\ai api\flow\testflowscope\target\flowscope-1.2.0-beta.25-ui-final.jar
```

Use `Get-FileHash -Algorithm SHA256` and `Get-Item` to prove source/destination hashes and sizes match.

- [ ] **Step 8: Commit tracked verification artifacts**

```powershell
git add -- frontend/e2e/parity.spec.ts frontend/src/components/layout/ReferenceAppShell.test.tsx frontend/src/components/layout/ReferenceAnalysisWorkspace.test.tsx docs/ko/architecture.md docs/ko/development-log.md docs/ko/ui-product-rationale.md docs/ko/web-ui-feature-parity.md CHANGELOG.md
git commit -m "test(web): verify reference analysis shell"
```

Before committing, run `git diff --cached --name-only` and prove none of the protected paths are staged.
