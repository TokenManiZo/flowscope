import { act, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
vi.mock("./useGraphWorkspace", async () => ({ useGraphWorkspace: (await import("@/test/graphWorkspace")).useMemoryGraphWorkspace }))

const cytoscapeState = vi.hoisted(() => {
  const cores: { add: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; elements: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; getElementById: ReturnType<typeof vi.fn>; layout: ReturnType<typeof vi.fn>; maxZoom: ReturnType<typeof vi.fn>; nodes: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; pan: ReturnType<typeof vi.fn>; viewport: ReturnType<typeof vi.fn>; zoom: ReturnType<typeof vi.fn> }[] = []
  const factory = vi.fn(() => {
    const core = { add: vi.fn(), destroy: vi.fn(), elements: vi.fn(() => ({ remove: vi.fn(), unselect: vi.fn(), forEach: vi.fn() })), fit: vi.fn(), getElementById: vi.fn(() => ({ select: vi.fn() })), layout: vi.fn(() => ({ run: vi.fn() })), maxZoom: vi.fn(() => 2), nodes: vi.fn(() => ({ forEach: vi.fn(), toArray: () => [] })), off: vi.fn(), on: vi.fn(), pan: vi.fn(() => ({ x: 0, y: 0 })), viewport: vi.fn(), zoom: vi.fn(() => 1) }
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

it("opens only the relationship hierarchy, without the removed priority tab", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { GraphPage } = await import("./GraphPage")
  render(<GraphPage />)
  expect(screen.queryByRole("tab", { name: "점검 우선순위" })).not.toBeInTheDocument()
  expect(screen.getByText("Site Overview")).toBeVisible()
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
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  expect(cytoscapeState.factory).toHaveBeenCalledTimes(1)
  await screen.findByLabelText("공격면 Cytoscape 그래프")
  act(() => { media.matches = true; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(cytoscapeState.cores[0].off).toHaveBeenCalledTimes(8)
  expect(cytoscapeState.cores[0].destroy).toHaveBeenCalledTimes(1)
  expect(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ })).toBeVisible()
  act(() => { media.matches = false; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(cytoscapeState.factory).toHaveBeenCalledTimes(2)
  expect(cytoscapeState.cores).toHaveLength(2)
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
}, 15_000)
