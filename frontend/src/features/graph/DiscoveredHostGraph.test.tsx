import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import type { EventRecord, ProjectStatus, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { RelationshipGraphView } from "./RelationshipGraphView"

const state = vi.hoisted(() => ({ snapshot: null as Snapshot | null, project: null as ProjectStatus | null }))
vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: state.snapshot, isError: false, isLoading: false }),
  useProjectsQuery: () => ({ data: state.project }),
}))
vi.mock("./useGraphWorkspace", async () => ({ useGraphWorkspace: (await import("@/test/graphWorkspace")).useMemoryGraphWorkspace }))
vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: () => null }))

const host = "https://ko.example.test:443"
const traffic = (): EventRecord => ({ eventId: "child-traffic", method: "GET", path: "/api/orders/1", status: 200, fp: "anon", idn: "anon", role: "ANON", source: "human", op: `${host} GET /api/orders/{id}`, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "browser", authState: "ANON", trafficClass: "API", trafficDisposition: "EXCLUDE", coverageEligible: false, classificationOverride: false, classificationReasons: ["PASSIVE_SUBDOMAIN_TRAFFIC"], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "child-traffic", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["child-traffic"], objects: [], verdict: "untested" })
beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  state.snapshot = targetSnapshot({ datasetRevision: 7 })
  state.project = { directory: "", active: { id: "current", name: "Example", scope: ["https://example.test:443/"], createdAt: "", modifiedAtMillis: 0, sizeBytes: 0, active: true, readable: true, managed: true }, projects: [], datasetRevision: 7, discoveredOrigins: [host], observedOrigins: [host] }
})

it("draws newly observed hosts automatically, keeps them after registration, and explains their metadata", async () => {
  const view = render(<RelationshipGraphView />)
  const node = await screen.findByRole("button", { name: `발견된 호스트 ${host}; 범위 미등록` })
  await userEvent.click(node)
  expect(screen.getByRole("complementary", { name: "선택 작업" })).toHaveTextContent("브라우저에서 발견한 주소입니다.")
  state.project = { ...state.project!, discoveredOrigins: [] }
  view.rerender(<RelationshipGraphView />)
  await waitFor(() => expect(screen.getByRole("button", { name: `발견된 호스트 ${host}; 범위 등록됨` })).toBeVisible())
  expect(state.snapshot?.cells).toHaveLength(0)
  expect(state.snapshot?.events).toHaveLength(0)
})

it("does not mix cached host lists from another project dataset into the current graph", async () => {
  state.project = { ...state.project!, datasetRevision: 6 }
  const view = render(<RelationshipGraphView />)
  expect(screen.queryByRole("button", { name: /발견된 호스트/ })).not.toBeInTheDocument()
  state.project = { ...state.project!, datasetRevision: 7 }
  view.rerender(<RelationshipGraphView />)
  await screen.findByRole("button", { name: `발견된 호스트 ${host}; 범위 미등록` })
  state.project = { ...state.project!, observedOrigins: [], discoveredOrigins: [] }
  view.rerender(<RelationshipGraphView />)
  await waitFor(() => expect(screen.queryByRole("button", { name: /발견된 호스트/ })).not.toBeInTheDocument())
})

it("automatically replaces the empty discovered host with its collected request group", async () => {
  const view = render(<RelationshipGraphView />)
  await screen.findByRole("button", { name: `발견된 호스트 ${host}; 범위 미등록` })
  state.snapshot = targetSnapshot({ datasetRevision: 7, events: [traffic()] })
  view.rerender(<RelationshipGraphView />)
  const group = await screen.findByRole("button", { name: new RegExp(`ORDERS APIs; ${host}; API group`) })
  expect(group).toHaveTextContent("관측 1")
  expect(screen.queryByRole("button", { name: `발견된 호스트 ${host}; 범위 미등록` })).not.toBeInTheDocument()
  await userEvent.click(group)
  expect(await screen.findByRole("button", { name: /GET \/api\/orders\/\{id\}/ })).toBeVisible()
  expect(state.project?.active?.scope).toEqual(["https://example.test:443/"])
})
