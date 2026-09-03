import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"

vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ onSelect, selectedElementId }: { selectedElementId?: string | null; onSelect(selection: { operation: string; resource: string; identity: string; source: "human"; evidenceIds: string[] }, elementId: string): void }) => <button type="button" data-testid="cytoscape-graph" data-selected-element={selectedElementId ?? ""} onClick={() => onSelect({ operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }, "operation:GET /orders/{id}")}>그래프 작업 선택</button> }))
vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: (globalThis as { graphFixture?: Snapshot }).graphFixture, isLoading: false, isError: false }) }))
vi.mock("@/features/evidence/OperationDetail", () => ({ OperationDetail: () => null }))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: ["human"], cells: [], verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [],
  events: [{ eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow" }],
}

it("destroys the canvas branch and exposes the same projection as a list across the 900px breakpoint", async () => {
  const listeners = new Set<(event: Event) => void>()
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: (_: string, listener: (event: Event) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: Event) => void) => listeners.delete(listener), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { GraphPage } = await import("./GraphPage")
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
  expect(screen.getAllByText("IDENTITY")).toHaveLength(1)
  expect(screen.getAllByText("ENDPOINT")).toHaveLength(1)
  expect(screen.getAllByText("OBJECT")).toHaveLength(1)
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
  expect(screen.getByRole("button", { name: /GET \/orders\/\{id\}/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "그래프 보기" }))
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
  act(() => { media.matches = true; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.queryByTestId("cytoscape-graph")).not.toBeInTheDocument()
  const compactInspector = screen.getByRole("dialog", { name: "선택 상세" })
  await userEvent.click(within(compactInspector).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument())
  expect(screen.getByRole("button", { name: /GET \/orders\/\{id\}/ })).toBeVisible()
  act(() => { media.matches = false; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
}, 15_000)

it("keeps filter facets aligned with the default support-traffic projection", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [...snapshot.events, { ...snapshot.events[0], eventId: "ev-support", source: "scanner", trafficClass: "POLLING", clusterEvidenceIds: ["ev-support"] }] }
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)

  expect(screen.getByRole("checkbox", { name: /SCANNER\s*0/ })).toBeVisible()
  await userEvent.click(screen.getByRole("checkbox", { name: "인증·화면·반복 보조 흐름 표시" }))
  expect(screen.getByRole("checkbox", { name: /SCANNER\s*1/ })).toBeVisible()
})

it.each([900, 600])("owns compact inspector state independently, opens it on selection, and clears selection on close at %ipx", async (width) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") ? width < 1280 : width <= 900, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)

  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await userEvent.click(inspectorTrigger)
  const emptyInspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(emptyInspector).toHaveTextContent("그래프 노드 또는 Evidence를 선택하면")
  await userEvent.click(within(emptyInspector).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /GET \/orders\/\{id\}/ }))
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
  const { GraphPage } = await import("./GraphPage")
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
  const { GraphPage } = await import("./GraphPage")
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
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)

  expect(screen.getByRole("checkbox", { name: /ALLOW\s*0/ })).toBeVisible()
  expect(screen.getByRole("checkbox", { name: /DENY\s*1/ })).toBeVisible()
})

it("retains a selected candidate whose provenance Evidence ID is not an event ID", async () => {
  const media = { matches: true, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [], routeCandidates: [{ service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }] }
  const { GraphPage } = await import("./GraphPage")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
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
  const { GraphPage } = await import("./GraphPage")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /경로 후보 https:\/\/api\.example\.test GET \/orders\/\{id\}/ }))
  expect(screen.getAllByRole("region", { name: "경로 후보 상세" }).length).toBeGreaterThan(0)
  const current = (globalThis as { graphFixture?: Snapshot }).graphFixture
  if (!current) throw new Error("candidate fixture missing")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...current, revision: 2, routeCandidates: [] }
  rerender(<GraphPage />)
  await waitFor(() => expect(screen.queryAllByRole("complementary", { name: "선택 작업" })).toHaveLength(0))
})

it("retains a selected candidate when a preceding snapshot candidate disappears", async () => {
  const media = { matches: true, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  const precedingCandidate: Snapshot["routeCandidates"][number] = { service: "https://admin.example.test", method: "GET", pathTemplate: "/admin", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["preceding-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "preceding-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }
  const selectedCandidate: Snapshot["routeCandidates"][number] = { service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/selected/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["selected-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "selected-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "selected review", priorityReasons: ["input"] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [], routeCandidates: [precedingCandidate, selectedCandidate] }
  const { GraphPage } = await import("./GraphPage")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: "경로 후보 표시" }))
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(screen.getByRole("button", { name: /경로 후보 https:\/\/api\.example\.test UNKNOWN \/selected\/\{id\}/ }))
  expect(screen.getAllByRole("complementary", { name: "선택 작업" }).length).toBeGreaterThan(0)
  const current = (globalThis as { graphFixture?: Snapshot }).graphFixture
  if (!current) throw new Error("candidate fixture missing")
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...current, revision: 2, routeCandidates: [selectedCandidate] }
  rerender(<GraphPage />)
  await waitFor(() => expect(screen.getAllByRole("complementary", { name: "선택 작업" }).length).toBeGreaterThan(0))
  expect(screen.getAllByText("selected-evidence").length).toBeGreaterThan(0)
})
