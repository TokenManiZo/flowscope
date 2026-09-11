import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"

const cytoscapeState = vi.hoisted(() => {
  const cores: { add: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; elements: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; getElementById: ReturnType<typeof vi.fn>; layout: ReturnType<typeof vi.fn>; maxZoom: ReturnType<typeof vi.fn>; nodes: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; pan: ReturnType<typeof vi.fn>; viewport: ReturnType<typeof vi.fn>; zoom: ReturnType<typeof vi.fn> }[] = []
  const factory = vi.fn(() => {
    const core = { add: vi.fn(), destroy: vi.fn(), elements: vi.fn(() => ({ remove: vi.fn(), unselect: vi.fn() })), fit: vi.fn(), getElementById: vi.fn(() => ({ select: vi.fn() })), layout: vi.fn(() => ({ run: vi.fn() })), maxZoom: vi.fn(() => 2), nodes: vi.fn(() => ({ forEach: vi.fn(), toArray: () => [] })), off: vi.fn(), on: vi.fn(), pan: vi.fn(() => ({ x: 0, y: 0 })), viewport: vi.fn(), zoom: vi.fn(() => 1) }
    cores.push(core)
    return core
  })
  return { cores, factory }
})

vi.mock("cytoscape", () => ({ default: cytoscapeState.factory }))
vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: (globalThis as { graphFixture?: Snapshot }).graphFixture, isLoading: false, isError: false }) }))

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: ["human"], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }], verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [],
  events: [{ eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow" }],
}

beforeEach(() => {
  cytoscapeState.cores.splice(0, cytoscapeState.cores.length)
  cytoscapeState.factory.mockClear()
})

it("renders the hierarchy controls and one Cytoscape canvas on the graph route", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.getByRole("checkbox", { name: "경로 후보 표시" })).toBeVisible()
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
  expect(screen.getByLabelText("공격면 Cytoscape 그래프")).toBeVisible()
  expect(cytoscapeState.factory).toHaveBeenCalledTimes(1)
  const siteElements = cytoscapeState.cores[0].add.mock.calls.at(-1)?.[0] as { data: { id: string; kind?: string } }[]
  expect(new Set(siteElements.filter(element => element.data.kind).map(element => element.data.kind))).toEqual(new Set(["target", "api-group"]))
})

it("destroys the actual Cytoscape instance for canvas→list and creates one replacement for list→canvas", async () => {
  const listeners = new Set<(event: Event) => void>()
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: (_: string, listener: (event: Event) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: Event) => void) => listeners.delete(listener), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)
  expect(cytoscapeState.factory).toHaveBeenCalledTimes(1)
  await screen.findByLabelText("공격면 Cytoscape 그래프")
  act(() => { media.matches = true; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(cytoscapeState.cores[0].off).toHaveBeenCalledTimes(5)
  expect(cytoscapeState.cores[0].destroy).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("button", { name: /ORDERS APIs/ })).toBeVisible()
  act(() => { media.matches = false; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(cytoscapeState.factory).toHaveBeenCalledTimes(2)
  expect(cytoscapeState.cores).toHaveLength(2)
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
}, 15_000)

it("opens the shared full candidate detail from a desktop Cytoscape tap", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = {
    ...snapshot,
    routeCandidates: [{ service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "run-1", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }],
  }
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)
  await userEvent.click(screen.getByRole("checkbox", { name: "경로 후보 표시" }))
  const tap = cytoscapeState.cores[0].on.mock.calls.find(([event]) => event === "tap")?.[2]
  if (typeof tap !== "function") throw new Error("tap listener was not registered")
  const siteElements = cytoscapeState.cores[0].add.mock.calls.at(-1)?.[0] as { data: { id: string; kind?: string; accessibleLabel?: string } }[]
  const groupId = siteElements.find(element => element.data.kind === "api-group" && element.data.accessibleLabel?.includes("UNSEEN APIs"))?.data.id
  if (!groupId) throw new Error("candidate group was not rendered")
  act(() => tap({ target: { id: () => groupId } }))
  const addedElements = cytoscapeState.cores[0].add.mock.calls.at(-1)?.[0] as { data: { id: string; kind?: string } }[] | undefined
  const candidateId = addedElements?.find((element) => element.data.kind === "route-candidate")?.data.id
  if (!candidateId) throw new Error("route candidate was not rendered")
  act(() => tap({ target: { id: () => candidateId } }))
  const detail = screen.getByRole("region", { name: "경로 후보 상세" })
  expect(detail).toHaveTextContent("https://api.example.test")
  expect(detail).toHaveTextContent("UNKNOWN /unseen/{id}")
  expect(detail).toHaveTextContent("미관측 후보 · REVIEW")
  expect(detail).toHaveTextContent("SITE_MAP")
  expect(detail).toHaveTextContent("route-evidence")
  expect(detail).toHaveTextContent("human · run-1 · burp · REVIEW · candidate")
  expect(detail).toHaveTextContent("needs review")
  expect(detail).toHaveTextContent("input")
})
