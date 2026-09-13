# FlowScope Unified Analysis Workspace Implementation Plan

> **Historical implementation plan (2026-09-01).** The worker/skill commands, protected paths, unchecked steps and dependency versions below describe that task, not present instructions. D-126 retired the old Explorer/Judge/MCP runtime; do not restore those endpoints to satisfy this plan. Current work and UI gates are owned by [HANDOFF](../../ko/HANDOFF.md) and [UI parity](../../ko/web-ui-feature-parity.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global sidebar with a 90%-density top-navigation workspace, make the supplied reference layout the graph default, and improve Matrix, Sequence, Scenarios, and Request Lab without changing server-side authorization decisions.

**Architecture:** A shared top navigation and context bar own global navigation and status. Analysis routes use compact route-local controls and optional persistent inspector columns. Graph lane geometry is a pure tested module consumed by Cytoscape, while the other routes retain their existing server snapshot projections and change only presentation and stale-status behavior.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Cytoscape.js, Vitest/Testing Library, Java 21, JUnit 5, Maven Shade.

**Spec:** `docs/superpowers/specs/2026-09-01-unified-analysis-workspace-design.md`

## Global Constraints

- Default React UI density is 90%; do not use CSS transform scaling.
- `/` and `/app/` serve React; `/legacy/` preserves the existing UI.
- Do not change server verdict calculation, coverage calculation, Evidence identity, or raw-data retention rules.
- Do not address LLM Explorer/Judge execution in this work.
- Do not add a new frontend dependency.
- Preserve the five pre-existing user-owned dirty Java/test paths: `src/main/java/io/flowscope/burp/FlowScopeExtension.java`, `src/main/java/io/flowscope/integration/LocalLlmRunner.java`, `src/main/java/io/flowscope/integration/McpServer.java`, `src/test/java/io/flowscope/McpServerTest.java`, and `src/test/java/io/flowscope/integration/LocalLlmRunnerTest.java`.
- Every semantic color also has a text, icon, badge, or line-style label.
- Evidence IDs and raw request/response values remain out of ARIA labels and live regions.

---

### Task 1: React Default Route and Top-Navigation Shell

**Files:**
- Modify: `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- Modify: `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- Create: `frontend/src/components/layout/AppTopNavigation.tsx`
- Create: `frontend/src/components/layout/WorkspaceContextBar.tsx`
- Create: `frontend/src/components/layout/AppTopNavigation.test.tsx`
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/app/AppShell.test.tsx`
- Modify: `frontend/src/components/layout/TopBar.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `AppRoute`, `routeLabel`, `useSnapshotQuery`, `useHumanRunQuery`, `useZapStatusQuery`, and `useScannerRunQuery`.
- Produces: `AppTopNavigation({ route }: { route: AppRoute })`, `WorkspaceContextBar()`, and a React-first `FlowScopeWebServer` root.

- [ ] **Step 1: Finish the failing Java route test**

Keep the already-added real-server test and update the migration test so its literal expectations are:

```java
assertTrue(root.body().contains("<div id=\"root\"></div>"));
assertFalse(root.body().contains("<h1>FlowScope</h1>"));
assertTrue(legacy.body().contains("<h1>FlowScope</h1>"));
assertTrue(app.body().contains("<div id=\"root\"></div>"));
```

Move legacy-only branding assertions in `servesBrandedUiAndProtectsApiWithCapabilityAndOrigin` from `get("/")` to `get("/legacy/")`.

- [ ] **Step 2: Run the server test to verify RED**

Run:

```powershell
mvn -Dtest=FlowScopeWebServerTest test
```

Expected: FAIL because `/` contains `<h1>FlowScope</h1>` instead of the React mount.

- [ ] **Step 3: Add failing shell tests**

Add tests that render `AppShell` and assert:

```tsx
expect(screen.getByRole("navigation", { name: "FlowScope 상단 탐색" })).toBeVisible()
expect(screen.getByRole("link", { name: "분석 대시보드" })).toHaveAttribute("href", "#dashboard")
expect(screen.getByRole("region", { name: "현재 분석 컨텍스트" })).toBeVisible()
expect(screen.queryByRole("navigation", { name: "주요 탐색" })).not.toBeInTheDocument()
expect(document.documentElement).toHaveClass("flowscope-density-90")
```

- [ ] **Step 4: Run shell tests to verify RED**

Run:

```powershell
cd frontend
npx vitest run src/app/AppShell.test.tsx src/components/layout/AppTopNavigation.test.tsx --maxWorkers=1
```

Expected: FAIL because the sidebar is still mounted and the top navigation does not exist.

- [ ] **Step 5: Implement the React-first root**

Change the server asset selection to:

```java
private final ClasspathWebAssets webAssets = new ClasspathWebAssets(ClasspathWebAssets.DefaultUi.REACT);
```

Do not change `/legacy/` resolution.

- [ ] **Step 6: Implement the common shell**

`AppTopNavigation` must render a stable brand block, three primary links, an analysis menu for secondary routes, and right-side status/actions. `WorkspaceContextBar` renders Scope, run/dataset state, and collection state. `AppShell` becomes:

```tsx
<div className="min-h-svh bg-background text-foreground">
  <AppTopNavigation route={route} />
  <WorkspaceContextBar />
  <main className="min-w-0">{routeContent}</main>
</div>
```

Apply density with a class on `document.documentElement`:

```css
html.flowscope-density-90 { font-size: 90%; }
body { min-width: 320px; }
```

Remove `SidebarProvider`, `SidebarInset`, and `AppSidebar` from `AppShell`; leave the old component file intact for legacy reference but unreachable from React routing.

- [ ] **Step 7: Verify GREEN**

Run the Java test, focused frontend tests, and typecheck. Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- src/main/java/io/flowscope/web/FlowScopeWebServer.java src/test/java/io/flowscope/FlowScopeWebServerTest.java frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx frontend/src/components/layout/AppTopNavigation.tsx frontend/src/components/layout/AppTopNavigation.test.tsx frontend/src/components/layout/WorkspaceContextBar.tsx frontend/src/components/layout/TopBar.tsx frontend/src/index.css
git commit -m "feat(web): make React workspace the default"
```

---

### Task 2: Shared Analysis Workspace and Inspector Pattern

**Files:**
- Create: `frontend/src/components/layout/AnalysisWorkspace.tsx`
- Create: `frontend/src/components/layout/AnalysisWorkspace.test.tsx`
- Create: `frontend/src/components/layout/InspectorPanel.tsx`
- Modify: `frontend/src/components/layout/EvidenceSheet.tsx`
- Create: `frontend/src/components/layout/EvidenceSheet.test.tsx`

**Interfaces:**
- Produces:

```ts
interface AnalysisWorkspaceProps {
  filters?: React.ReactNode
  toolbar: React.ReactNode
  children: React.ReactNode
  inspector?: React.ReactNode
  inspectorOpen?: boolean
  ariaLabel: string
}
```

- `InspectorPanel` produces a desktop `<aside>` and accepts `title`, `description`, `tabs`, and `children`.

- [ ] **Step 1: Write failing responsive-layout tests**

Assert that desktop markup exposes `complementary` regions named `분석 필터` and `선택 상세`, while the main work surface remains a named region. Assert the inspector is rendered in normal document flow, not inside a dialog.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
cd frontend
npx vitest run src/components/layout/AnalysisWorkspace.test.tsx --maxWorkers=1
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement shared layout primitives**

Use a desktop grid equivalent to:

```tsx
<section className="grid min-h-[calc(100svh-5.5rem)] grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
  {filters && <aside aria-label="분석 필터">{filters}</aside>}
  <section aria-label={ariaLabel}>{toolbar}{children}</section>
  {inspectorOpen && <aside aria-label="선택 상세">{inspector}</aside>}
</section>
```

Below `xl`, keep the main surface full-width and use the existing Sheet primitive for selected detail. Keep all raw/Evidence fields in bounded ordinary body content.

- [ ] **Step 4: Run tests and typecheck to verify GREEN**

- [ ] **Step 5: Commit**

```powershell
git add -- frontend/src/components/layout/AnalysisWorkspace.tsx frontend/src/components/layout/AnalysisWorkspace.test.tsx frontend/src/components/layout/InspectorPanel.tsx frontend/src/components/layout/EvidenceSheet.tsx
git commit -m "feat(web): add shared analysis workspace"
```

---

### Task 3: Reference-Matched Attack Graph with Lane Constraints

**Files:**
- Create: `frontend/src/features/graph/graphLanes.ts`
- Create: `frontend/src/features/graph/graphLanes.test.ts`
- Create: `frontend/src/features/graph/GraphInspectorPanel.tsx`
- Create: `frontend/src/features/graph/GraphInspectorPanel.test.tsx`
- Modify: `frontend/src/features/graph/GraphPage.tsx`
- Modify: `frontend/src/features/graph/GraphPage.test.tsx`
- Modify: `frontend/src/features/graph/CytoscapeGraph.tsx`
- Modify: `frontend/src/features/graph/CytoscapeGraph.test.tsx`
- Modify: `frontend/src/features/graph/graphProjection.ts`

**Interfaces:**
- Produces:

```ts
export type GraphLane = "identity" | "resource" | "operation"
export interface LaneGeometry { left: number; right: number; anchor: number }
export function graphLaneForKind(kind: string): GraphLane
export function laneGeometry(width: number, lane: GraphLane, gutter?: number): LaneGeometry
export function clampRenderedPosition(position: { x: number; y: number }, lane: LaneGeometry): { x: number; y: number }
```

- `CytoscapeGraph` adds `onSelectionChange` only through the existing `onSelect` contract and keeps `onRendererUnavailable`.

- [ ] **Step 1: Write failing pure lane tests**

Use literal widths and expected ranges:

```ts
expect(laneGeometry(900, "identity", 24)).toEqual({ left: 24, right: 276, anchor: 150 })
expect(laneGeometry(900, "resource", 24)).toEqual({ left: 324, right: 576, anchor: 450 })
expect(laneGeometry(900, "operation", 24)).toEqual({ left: 624, right: 876, anchor: 750 })
expect(clampRenderedPosition({ x: 700, y: 120 }, laneGeometry(900, "identity", 24))).toEqual({ x: 276, y: 120 })
```

- [ ] **Step 2: Run lane tests to verify RED**

Expected: FAIL because `graphLanes.ts` does not exist.

- [ ] **Step 3: Write failing Cytoscape interaction tests**

Extend the core mock with node `renderedPosition`, `position`, and `data`. Simulate zoom, resize, and `dragfree`; assert the controller converts clamped rendered X back to model X with `(renderedX - pan.x) / zoom`, and never changes the node lane.

Assert the stylesheet keeps:

```ts
expect(edgeStyle).toMatchObject({ label: "data(label)", "text-rotation": "autorotate" })
expect(llmEdge.data.color).toBe("#e4e4e7")
```

- [ ] **Step 4: Implement the lane controller**

Divide the rendered canvas into thirds with a 24px gutter. Route candidates map to `operation`. On initial projection, resize, zoom, fit, and node drag, recompute model X from the lane anchor or clamped rendered position. Permit Y movement. Throttle viewport corrections with one `requestAnimationFrame` and cancel it during cleanup.

- [ ] **Step 5: Rebuild GraphPage with the shared workspace**

Use `AnalysisWorkspace` with:

- left filters: Source, Identity, Review State, Focus
- central toolbar: object counts, minus, zoom percentage, plus, fit, full-screen
- central canvas: lane titles and graph legend
- right `GraphInspectorPanel`: overview, Evidence, Request, Response, Access Check

The default desktop selection panel must not overlay the graph. The `API 목록 보기` keyboard alternative remains available.

- [ ] **Step 6: Verify graph GREEN**

Run:

```powershell
cd frontend
npx vitest run src/features/graph --maxWorkers=1
npm run typecheck
```

Expected: all graph tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- frontend/src/features/graph frontend/src/components/layout/AnalysisWorkspace.tsx frontend/src/components/layout/InspectorPanel.tsx
git commit -m "feat(web): constrain the reference attack graph"
```

---

### Task 4: Color-Coded Permission Matrix

**Files:**
- Create: `frontend/src/features/matrix/MatrixVerdictCell.tsx`
- Create: `frontend/src/features/matrix/MatrixVerdictCell.test.tsx`
- Modify: `frontend/src/features/matrix/MatrixPage.tsx`
- Modify: `frontend/src/features/matrix/MatrixPage.test.tsx`
- Modify: `frontend/src/features/matrix/matrixProjection.ts`

**Interfaces:**
- Produces:

```ts
export function matrixVerdictTone(verdict: Verdict | "unknown"): {
  label: string
  className: string
  accentClassName: string
}
```

- `MatrixVerdictCell` consumes one existing `MatrixMember` and emits the current Evidence selection through `onSelect(member)`.

- [ ] **Step 1: Write failing verdict and layout tests**

Assert literal mappings:

```ts
expect(matrixVerdictTone("allow").label).toBe("ALLOW")
expect(matrixVerdictTone("deny").className).toContain("bg-red-500/10")
expect(matrixVerdictTone("suspicious").className).toContain("bg-amber-500/10")
expect(matrixVerdictTone("undecided").className).toContain("bg-violet-500/10")
```

Render the page and assert sticky identity and operation headers, explicit HUMAN/SCANNER/LLM rows, and absence of `이전 snapshot을 표시 중입니다.` even when the query mock has `isStale: true`.

- [ ] **Step 2: Run tests to verify RED**

- [ ] **Step 3: Implement compact colored cells**

Replace repeated unstructured badge stacks with:

```tsx
<article className={`border-l-2 p-3 ${tone.className} ${tone.accentClassName}`}>
  <button onClick={() => onSelect(member)}>{tone.label}</button>
  {sourceOrder.map(source => <SourceResultRow key={source} source={source} member={member} />)}
  <CellStateBadges member={member} />
</article>
```

The first column uses `sticky left-0 z-20`; header cells use `sticky top-0 z-10`. Operation headers display method badge, compact path, required role, resource, and owner. Remove the page-local stale text only; preserve data and errors.

- [ ] **Step 4: Verify Matrix GREEN and accessibility**

Run focused tests and typecheck. Confirm every colored state includes readable text.

- [ ] **Step 5: Commit**

```powershell
git add -- frontend/src/features/matrix
git commit -m "feat(web): clarify the permission matrix"
```

---

### Task 5: Timeline Sequence and Split Scenario Workspace

**Files:**
- Create: `frontend/src/features/sequence/SequenceTimeline.tsx`
- Create: `frontend/src/features/sequence/SequenceTimeline.test.tsx`
- Modify: `frontend/src/features/sequence/SequencePage.tsx`
- Modify: `frontend/src/features/sequence/SequencePage.test.tsx`
- Create: `frontend/src/features/scenarios/ScenarioWorkspace.tsx`
- Create: `frontend/src/features/scenarios/ScenarioWorkspace.test.tsx`
- Modify: `frontend/src/features/scenarios/ScenariosPage.tsx`
- Modify: `frontend/src/features/scenarios/ScenariosPage.test.tsx`
- Modify: `frontend/src/features/scenarios/ScenarioCard.tsx`

**Interfaces:**
- `SequenceTimeline({ group, onSelect })` consumes an existing projected sequence group.
- `ScenarioWorkspace({ scenarios, selectedId, onSelect, onOpenEvidence })` consumes only the current generated scenario envelope.

- [ ] **Step 1: Write failing stale-status tests**

Set `isStale: true` in Matrix, Sequence, and Scenarios query doubles. Assert:

```tsx
expect(screen.queryByText("이전 snapshot을 표시 중입니다.")).not.toBeInTheDocument()
```

Keep the scenarios revision-change assertion:

```tsx
expect(screen.getByText("snapshot이 변경되어 미리보기와 생성 결과를 다시 확인해야 합니다.")).toBeVisible()
```

- [ ] **Step 2: Write failing presentation tests**

Sequence tests assert numbered producer/value/consumer segments and source labels. Scenario tests assert a candidate-list region and a selected-detail region, with severity and validation labels present as text.

- [ ] **Step 3: Run tests to verify RED**

- [ ] **Step 4: Implement the timeline and scenario split**

Sequence groups use one compact card with ordered timeline rows instead of one bordered card per link. Maintain exact selection keys and bounded values.

Scenarios retain preview-before-generate, revision eligibility, stale-response rejection, bounded lists, and review mutations. Only generated scenarios appear in the candidate list. Selecting a candidate updates the right detail without changing server data.

Remove page-local `isStale` copy from both pages. Do not remove snapshot error alerts or scenarios revision-change alerts.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
cd frontend
npx vitest run src/features/sequence src/features/scenarios --maxWorkers=1
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add -- frontend/src/features/sequence frontend/src/features/scenarios
git commit -m "feat(web): streamline flows and scenarios"
```

---

### Task 6: Two-Column Request Lab

**Files:**
- Create: `frontend/src/features/evidence/RequestLabMetadata.tsx`
- Create: `frontend/src/features/evidence/RequestLabMetadata.test.tsx`
- Modify: `frontend/src/features/evidence/RequestLabDialog.tsx`
- Modify: `frontend/src/features/evidence/RequestLabDialog.test.tsx`

**Interfaces:**
- `RequestLabMetadata` consumes service, identity, preservation, charset, credential mode, eligible accounts, and session status. It emits mode/account changes through controlled props.
- Existing `getRequestLabDraft`, send mutation, memory-owner, byte-limit, and cleanup contracts remain unchanged.

- [ ] **Step 1: Write failing desktop/mobile structure tests**

Render the dialog and assert regions named `Request Lab 메타데이터` and `Request Lab 원문 작업면`, tabs named `Request` and `Response`, and a sticky action footer. Assert the unavailable raw-data notice is a compact `status`, not a large content card.

- [ ] **Step 2: Run Request Lab tests to verify RED**

- [ ] **Step 3: Implement two-column layout**

Use:

```tsx
<DialogContent className="max-w-[70rem] p-0">
  <div className="grid max-h-[85svh] lg:grid-cols-[19rem_minmax(0,1fr)]">
    <RequestLabMetadata ... />
    <section aria-label="Request Lab 원문 작업면">
      <Tabs defaultValue="request">...</Tabs>
    </section>
  </div>
  <DialogFooter className="sticky bottom-0">...</DialogFooter>
</DialogContent>
```

Do not move raw values into persistent storage. Preserve byte counting, no-eligible-account behavior, pending guards, retry, cleanup on revision/unmount, and newest-first bounded history.

- [ ] **Step 4: Verify all Request Lab security regressions GREEN**

Run:

```powershell
cd frontend
npx vitest run src/features/evidence/RequestLabDialog.test.tsx src/lib/security/memoryOnlyRawState.test.ts --maxWorkers=1
npm run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add -- frontend/src/features/evidence/RequestLabDialog.tsx frontend/src/features/evidence/RequestLabDialog.test.tsx frontend/src/features/evidence/RequestLabMetadata.tsx frontend/src/features/evidence/RequestLabMetadata.test.tsx
git commit -m "feat(web): redesign Request Lab workspace"
```

---

### Task 7: Full Verification, Browser QA, and Clean JAR Packaging

**Files:**
- Modify: `frontend/e2e/parity.spec.ts`
- Modify: `docs/ko/web-ui-feature-parity.md`
- Output: `target/flowscope-1.2.0-beta.25-ui-final.jar`

**Interfaces:**
- Consumes all prior tasks.
- Produces one Burp-loadable fat JAR whose `/` opens the new UI.

- [ ] **Step 1: Update the packaged-browser journey**

The E2E must visit `/`, assert the top navigation, load sample data, open Matrix, Graph, Sequence, Scenarios, and Request Lab, and assert `/legacy/` still contains the old `<h1>FlowScope</h1>` document. Add graph fit/zoom assertions based on visible lane headings and selected inspector content rather than canvas pixels alone.

- [ ] **Step 2: Run the stable frontend suite**

```powershell
cd frontend
npx vitest run --exclude scripts/generate-notices.test.mjs --maxWorkers=1
npm run typecheck
npm run build
```

Expected: all tests PASS; the existing jsdom canvas notice and Vite chunk advisory may remain but no test failure is allowed.

- [ ] **Step 3: Run Java and packaging verification**

```powershell
mvn clean verify
```

Expected: JUnit, frontend Maven executions, fat-JAR isolation smoke, and packaging all PASS. Exactly one `target/flowscope-*.jar` remains.

- [ ] **Step 4: Run the packaged standalone UI**

```powershell
java -Djava.awt.headless=true -Dflowscope.web.port=17778 -cp target/flowscope-1.2.0-beta.25.jar io.flowscope.Standalone
```

Verify in the in-app browser:

- `/` displays the new top-navigation UI.
- `/legacy/` displays the old UI.
- sample Matrix is readable at 90% density with sticky headers and semantic color.
- Graph matches the reference three-column structure and lane constraints survive zoom, fit, resize, and Y-drag.
- Sequence and Scenarios do not flash the stale message.
- Request Lab uses the two-column desktop layout.

- [ ] **Step 5: Copy and hash the deliverable**

Copy the verified fat JAR to:

```text
C:\Users\심지운\Documents\ai api\flow\testflowscope\target\flowscope-1.2.0-beta.25-ui-final.jar
```

Compare SHA-256 of source and destination and fail if they differ.

- [ ] **Step 6: Final diff safety check**

```powershell
git diff --check
git status --short
```

Confirm the five protected dirty Java/test paths were not staged by this plan.

- [ ] **Step 7: Commit verification artifacts**

```powershell
git add -- frontend/e2e/parity.spec.ts docs/ko/web-ui-feature-parity.md
git commit -m "test(web): verify the unified analysis workspace"
```
