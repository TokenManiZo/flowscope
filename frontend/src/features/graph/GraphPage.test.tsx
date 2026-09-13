import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { GraphPage as CurrentGraphPage } from "./GraphPage"

vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ onSelect, selectedElementId }: { selectedElementId?: string | null; onSelect(selection: { operation: string; resource: string; identity: string; source: "human"; evidenceIds: string[] }, elementId: string): void }) => <button type="button" data-testid="cytoscape-graph" data-selected-element={selectedElementId ?? ""} onClick={() => onSelect({ operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }, "operation:GET /orders/{id}")}>그래프 작업 선택</button> }))
vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: (globalThis as { graphFixture?: Snapshot }).graphFixture, isLoading: false, isError: false }) }))
vi.mock("@/features/evidence/OperationDetail", () => ({ OperationDetail: () => null }))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: ["human"], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }], verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [],
  events: [{ eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow" }],
}

const hierarchyCell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["cell-evidence-not-an-event"] }

it("keeps all relationship controls reachable from the secondary tab", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  render(<CurrentGraphPage />)
  expect(screen.getByRole("tab", { name: "점검 우선순위" })).toHaveAttribute("aria-selected", "true")
  expect(screen.queryByText("Site Overview")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("tab", { name: "전체 관계 보기" }))
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
  expect(screen.getByRole("checkbox", { name: "경로 후보 표시" })).toBeVisible()
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
})

it("refreshes every server-authored field of a stable selected route candidate", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const candidate = { service: "https://api.example.test", method: "GET", pathTemplate: "/orders/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["old-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "old-evidence", source: "human", runId: "old-run", adapter: "old-adapter", applicability: "REVIEW", reason: "old-reason" }], applicability: "REVIEW", reviewReason: "old-review", priorityReasons: ["old-priority"] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, routeCandidates: [candidate] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs.*https:\/\/api.example.test/ }))
  const button = screen.getByRole("button", { name: /경로 후보 https:\/\/api.example.test GET/ })
  await userEvent.click(button)
  const updated = { ...candidate, observed: true, applicability: "INCLUDE", provenanceTypes: ["OBSERVED"], provenanceEvidenceIds: ["new-evidence"], provenance: [{ type: "OBSERVED", evidenceId: "new-evidence", source: "scanner", runId: "new-run", adapter: "new-adapter", applicability: "INCLUDE", reason: "new-reason" }], reviewReason: "new-review", priorityReasons: ["new-priority"] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, revision: 2, routeCandidates: [updated] }
  rerender(<GraphPage />)
  const inspector = screen.getByRole("complementary", { name: "선택 작업" })
  await waitFor(() => expect(inspector).toHaveTextContent("new-review"))
  for (const value of ["관측됨", "INCLUDE", "OBSERVED", "new-evidence", "scanner", "new-run", "new-adapter", "new-reason", "new-priority"]) expect(inspector).toHaveTextContent(value)
  expect(inspector).not.toHaveTextContent("old-")
  expect(screen.getByRole("button", { name: /경로 후보 https:\/\/api.example.test GET.*관측됨.*INCLUDE/ })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).toHaveTextContent("new-evidence")
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).not.toHaveTextContent("old-evidence")
})

it("reconciles retained aggregate coordinates and Evidence IDs after two current cells shrink to one", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const old = { ...hierarchyCell, evidenceIds: ["ev-old"] }
  const survivor = { ...hierarchyCell, resource: "orders:202", overall: "deny" as const, reasons: { human: "surviving server reason" }, evidenceIds: ["ev-survivor"] }
  const fixture = { ...snapshot, cells: [old, survivor], events: [{ ...snapshot.events[0], idn: old.idn, op: old.op, resource: old.resource, eventId: "ev-old", clusterEvidenceIds: ["ev-old"] }, { ...snapshot.events[0], idn: survivor.idn, op: survivor.op, resource: survivor.resource, eventId: "ev-survivor", clusterEvidenceIds: ["ev-survivor"] }] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = fixture
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  await userEvent.click(screen.getByRole("button", { name: "USER A" }))
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("복수 셀")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...fixture, revision: 2, cells: [survivor] }
  rerender(<GraphPage />)
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("DENY")
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("surviving server reason")
  expect(screen.getByRole("complementary", { name: "선택 작업" })).toHaveTextContent("orders:202")
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).toHaveTextContent("ev-survivor")
  expect(screen.getByRole("tabpanel", { name: "Evidence" })).not.toHaveTextContent("ev-old")
}, 15_000)

it("preserves exact candidate navigation focus after closing the compact inspector", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const gaps = [202, 404].map(resource => ({ id: `gap-${resource}`, type: "UNCROSSED", idn: "USER B", op: hierarchyCell.op, resource: `orders:${resource}`, risk: 1, summary: "server", missedSources: [] }))
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells: [hierarchyCell, { ...hierarchyCell, idn: "USER B", resource: "orders:303" }], gaps }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  await userEvent.click(screen.getByRole("button", { name: /미교차 후보 USER B.*orders:202/ }))
  const paths = within(screen.getByLabelText("Source Evidence 경로"))
  const exact = paths.getByRole("button", { name: /미교차 후보.*· orders:202/ })
  expect(exact).toHaveAttribute("data-focused", "yes")
  expect(paths.getByRole("button", { name: /미교차 후보.*· orders:404/ })).toHaveAttribute("data-focused", "no")
  await userEvent.click(exact)
  const inspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(inspector).toHaveTextContent("gap-202")
  await userEvent.click(within(inspector).getByRole("button", { name: "Close" }))
  expect(paths.getAllByText("포커스 경로")).toHaveLength(2)
  expect(exact).toHaveAttribute("data-focused", "yes")
  await userEvent.click(screen.getByRole("button", { name: "USER A" }))
  await userEvent.click(within(screen.getByRole("dialog", { name: "선택 상세" })).getByRole("button", { name: "Close" }))
  expect(exact).toHaveAttribute("data-focused", "yes")
}, 15_000)

it("offers explicit expansion for a candidate-only group with no observed operations", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const routeCandidates = Array.from({ length: 19 }, (_, index) => ({ service: "https://api.example.test", method: "UNKNOWN", pathTemplate: `/unseen/${String(index + 1).padStart(2, "0")}`, observed: false, provenanceTypes: [], provenanceEvidenceIds: [], provenance: [], applicability: "REVIEW", reviewReason: "server candidate", priorityReasons: [] }))
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells: [], events: [], routeCandidates }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  await userEvent.click(screen.getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(screen.getByRole("button", { name: /UNSEEN APIs/ }))
  expect(screen.queryByRole("button", { name: /경로 후보.*UNKNOWN \/unseen\/19/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /API 18개 더 보기/ }))
  expect(screen.getByRole("button", { name: /경로 후보.*UNKNOWN \/unseen\/19/ })).toBeVisible()
}, 15_000)

it("navigates Site→Group→API→Object and back without leaking objects into overview", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells: [hierarchyCell] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.queryByText("orders:101")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  expect(screen.getByText("API View")).toBeVisible()
  expect(screen.queryByText("orders:101")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /^GET \/api\/orders\/\{id\}/ }))
  expect(screen.getByText("Object View")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /^orders:101/ }))
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  expect(screen.getByText("cell-evidence-not-an-event")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /Back/ }))
  expect(screen.getByText("API View")).toBeVisible()
}, 15_000)

it("requires explicit 18-item expansion for APIs and Objects and retains group paging on Back", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const cells = Array.from({ length: 19 }, (_, index) => ({ ...hierarchyCell, op: `GET /api/orders/${String(index + 1).padStart(2, "0")}`, resource: `orders:${String(index + 1).padStart(2, "0")}` }))
  cells.push(...Array.from({ length: 18 }, (_, index) => ({ ...hierarchyCell, op: "GET /api/orders/01", resource: `orders:${String(index + 20).padStart(2, "0")}` })))
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  expect(screen.queryByRole("button", { name: /^GET \/api\/orders\/19/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /API 18개 더 보기/ }))
  expect(screen.getByRole("button", { name: /^GET \/api\/orders\/19/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /^GET \/api\/orders\/01/ }))
  expect(screen.queryByRole("button", { name: /^orders:37/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Object 18개 더 보기/ }))
  expect(screen.getByRole("button", { name: /^orders:37/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /Back/ }))
  expect(screen.getByRole("button", { name: /^GET \/api\/orders\/19/ })).toBeVisible()
})

it("destroys the canvas branch and exposes the same projection as a list across the 900px breakpoint", async () => {
  const listeners = new Set<(event: Event) => void>()
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: (_: string, listener: (event: Event) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: Event) => void) => listeners.delete(listener), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  expect(screen.getByRole("complementary", { name: "분석 필터" })).toBeVisible()
  expect(screen.getByText("SOURCES")).toBeVisible()
  expect(screen.getByText("IDENTITIES")).toBeVisible()
  expect(screen.getByText("EVIDENCE")).toBeVisible()
  expect(screen.getByText("GAP")).toBeVisible()
  expect(screen.getByText("TRAFFIC CLASS")).toBeVisible()
  expect(screen.getByText("ROUTE CANDIDATES")).toBeVisible()
  expect(screen.getByText("ROLE - POLICY SUMMARY")).toBeVisible()
  expect(screen.getByText("GRAPH FOCUS")).toBeVisible()
  expect(screen.getByText("VIEW OPTIONS")).toBeVisible()
  expect(screen.getAllByText("TARGET")).toHaveLength(1)
  expect(screen.getAllByText("API GROUP")).toHaveLength(1)
  expect(screen.queryByText("OBJECT")).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "접근 그래프 작업면" })).toContainElement(screen.getByTestId("cytoscape-graph"))
  expect(screen.getByText("ACCESS GRAPH")).toBeVisible()
  expect(screen.getByText("EVIDENCE")).toBeVisible()
  expect(screen.getByRole("button", { name: "축소" })).toBeVisible()
  expect(screen.getByText("100%")).toBeVisible()
  expect(screen.getByRole("button", { name: "확대" })).toBeVisible()
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
  expect(screen.getByRole("button", { name: "전체 화면" })).toBeVisible()
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
  await userEvent.click(screen.getByTestId("cytoscape-graph"))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  expect(screen.getByRole("complementary", { name: "선택 작업" })).toHaveTextContent("GET /orders/{id}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "API 목록 보기" }))
  expect(screen.queryByTestId("cytoscape-graph")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  expect(screen.getByRole("button", { name: /^GET \/orders\/\{id\}/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /HUMAN · alice.*API 접근/ }))
  await userEvent.click(screen.getByRole("button", { name: "그래프 보기" }))
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
  act(() => { media.matches = true; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.queryByTestId("cytoscape-graph")).not.toBeInTheDocument()
  const compactInspector = screen.getByRole("dialog", { name: "선택 상세" })
  await userEvent.click(within(compactInspector).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument())
  expect(screen.getByRole("button", { name: /^GET \/orders\/\{id\}/ })).toBeVisible()
  act(() => { media.matches = false; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
}, 15_000)

it("keeps filter facets aligned with the default support-traffic projection", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [...snapshot.events, { ...snapshot.events[0], eventId: "ev-support", source: "scanner", trafficClass: "POLLING", clusterEvidenceIds: ["ev-support"] }] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  expect(screen.getByRole("checkbox", { name: /SCANNER\s*0/ })).toBeVisible()
  await userEvent.click(screen.getByRole("checkbox", { name: "인증·화면·반복 보조 흐름 표시" }))
  expect(screen.getByRole("checkbox", { name: /SCANNER\s*1/ })).toBeVisible()
})

it.each([900, 600])("owns compact inspector state independently, opens it on selection, and clears selection on close at %ipx", async (width) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") ? width < 1280 : width <= 900, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await userEvent.click(inspectorTrigger)
  const emptyInspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(emptyInspector).toHaveTextContent("그래프 노드 또는 Evidence를 선택하면")
  await userEvent.click(within(emptyInspector).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  await userEvent.click(screen.getByRole("button", { name: /^GET \/orders\/\{id\}/ }))
  await userEvent.click(screen.getByRole("button", { name: /^order:1/ }))
  const inspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(inspector).toBeVisible()
  expect(screen.queryByRole("button", { name: "축소" })).not.toBeInTheDocument()

  await userEvent.click(within(inspector).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument())
  expect(inspectorTrigger).toHaveFocus()
  await userEvent.click(inspectorTrigger)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("그래프 노드 또는 Evidence를 선택하면")
})

it.each([900, 600])("opens the shared graph filters and keeps every meaningful toggle operable at %ipx", async (width) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") ? width < 1280 : width <= 900, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  const scanner = within(filters).getByRole("checkbox", { name: /SCANNER\s*0/ })
  const identity = within(filters).getByRole("checkbox", { name: /alice\s*1/ })
  const allow = within(filters).getByRole("checkbox", { name: /ALLOW\s*1/ })
  const routeCandidate = within(filters).getByRole("checkbox", { name: "경로 후보 표시" })
  const support = within(filters).getByRole("checkbox", { name: "인증·화면·반복 보조 흐름 표시" })
  await userEvent.click(scanner)
  await userEvent.click(identity)
  await userEvent.click(allow)
  await userEvent.click(routeCandidate)
  await userEvent.click(support)
  expect(scanner).not.toBeChecked()
  expect(identity).toBeChecked()
  expect(allow).not.toBeChecked()
  expect(routeCandidate).toBeChecked()
  expect(support).toBeChecked()
  await userEvent.click(within(filters).getByRole("button", { name: "권한 판정" }))
  expect(within(filters).getByRole("button", { name: "권한 판정" })).toHaveAttribute("data-variant", "default")
  await userEvent.click(within(filters).getByRole("button", { name: "소스 보기" }))
  expect(within(filters).getByRole("button", { name: "소스 보기" })).toHaveAttribute("data-variant", "default")
})

it("uses exact HUMAN, SCANNER, and LLM source semantics in the canvas legend", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  const legend = screen.getByRole("list", { name: "그래프 소스 범례" })
  expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["HUMAN", "SCANNER", "LLM"])
})

it("counts Review State facets with the same matching-cell verdict used by filtering", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = {
    ...snapshot,
    cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "deny" }, reasons: {}, overall: "deny", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }],
  }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  expect(screen.getByRole("checkbox", { name: /ALLOW\s*0/ })).toBeVisible()
  expect(screen.getByRole("checkbox", { name: /DENY\s*1/ })).toBeVisible()
})

it("retains a selected candidate whose provenance Evidence ID is not an event ID", async () => {
  const media = { matches: true, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [], routeCandidates: [{ service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /UNSEEN APIs/ }))
  await userEvent.click(screen.getByRole("button", { name: /UNKNOWN \/unseen\/\{id\}/ }))
  expect(screen.getAllByRole("complementary", { name: "선택 작업" }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole("region", { name: "경로 후보 상세" }).length).toBeGreaterThan(0)
  expect(screen.getAllByText("route-evidence").length).toBeGreaterThan(0)
  const current = (globalThis as { graphFixture?: Snapshot }).graphFixture
  if (!current) throw new Error("candidate fixture missing")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...current }
  rerender(<GraphPage />)
  expect(screen.getAllByText("route-evidence").length).toBeGreaterThan(0)
})

it("clears a selected candidate when its snapshot entry disappears even if a provenance event remains", async () => {
  const media = { matches: true, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, routeCandidates: [{ service: "https://api.example.test", method: "GET", pathTemplate: "/orders/{id}", observed: true, provenanceTypes: ["OBSERVED"], provenanceEvidenceIds: ["ev-1"], provenance: [{ type: "OBSERVED", evidenceId: "ev-1", source: "human", runId: "r", adapter: "burp", applicability: "INCLUDE", reason: "source event" }], applicability: "INCLUDE", reviewReason: "", priorityReasons: [] }] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs.*https:\/\/api.example.test/ }))
  await userEvent.click(screen.getByRole("button", { name: /경로 후보 https:\/\/api\.example\.test GET \/orders\/\{id\}/ }))
  expect(screen.getAllByRole("region", { name: "경로 후보 상세" }).length).toBeGreaterThan(0)
  const current = (globalThis as { graphFixture?: Snapshot }).graphFixture
  if (!current) throw new Error("candidate fixture missing")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...current, revision: 2, routeCandidates: [] }
  rerender(<GraphPage />)
  await waitFor(() => expect(screen.queryAllByRole("complementary", { name: "선택 작업" })).toHaveLength(0))
})

it("enters the exact UNCROSSED operation from Site and falls back to Site when its filtered group disappears", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const fixture: Snapshot = { ...snapshot, cells: [hierarchyCell], gaps: [{ id: "gap-original", type: "UNCROSSED", idn: "USER B", op: hierarchyCell.op, resource: "orders:202", risk: 1, summary: "server candidate", missedSources: [] }] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = fixture
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: /미교차 후보 USER B/ }))
  expect(screen.getByText("Object View")).toBeVisible()
  expect(screen.getByRole("button", { name: /미교차 후보 · USER B.*· orders:202/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /미교차 후보 · USER B.*· orders:202/ }))
  expect(screen.getByRole("complementary", { name: "선택 작업" })).toHaveTextContent("USER B")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...fixture, cells: [] }
  rerender(<GraphPage />)
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "선택 작업" })).not.toBeInTheDocument()
})

it("retains a selected candidate when a preceding snapshot candidate disappears", async () => {
  const media = { matches: true, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  const precedingCandidate: Snapshot["routeCandidates"][number] = { service: "https://admin.example.test", method: "GET", pathTemplate: "/admin", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["preceding-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "preceding-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }
  const selectedCandidate: Snapshot["routeCandidates"][number] = { service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/selected/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["selected-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "selected-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "selected review", priorityReasons: ["input"] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [], routeCandidates: [precedingCandidate, selectedCandidate] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /SELECTED APIs/ }))
  await userEvent.click(screen.getByRole("button", { name: /경로 후보 https:\/\/api\.example\.test UNKNOWN \/selected\/\{id\}/ }))
  expect(screen.getAllByRole("complementary", { name: "선택 작업" }).length).toBeGreaterThan(0)
  const current = (globalThis as { graphFixture?: Snapshot }).graphFixture
  if (!current) throw new Error("candidate fixture missing")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...current, revision: 2, routeCandidates: [selectedCandidate] }
  rerender(<GraphPage />)
  await waitFor(() => expect(screen.getAllByRole("complementary", { name: "선택 작업" }).length).toBeGreaterThan(0))
  expect(screen.getAllByText("selected-evidence").length).toBeGreaterThan(0)
})
