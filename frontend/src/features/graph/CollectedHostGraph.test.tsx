import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { RelationshipGraphView } from "./RelationshipGraphView"

const state = vi.hoisted(() => ({ snapshot: null as Snapshot | null }))
vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: state.snapshot, isError: false, isLoading: false }),
}))
vi.mock("./useGraphWorkspace", async () => ({ useGraphWorkspace: (await import("@/test/graphWorkspace")).useMemoryGraphWorkspace }))
vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: () => null }))

const host = "https://ko.example.test:443"
const traffic = (): EventRecord => ({ eventId: "child-traffic", method: "GET", path: "/api/orders/1", status: 200, fp: "anon", idn: "anon", role: "ANON", source: "human", op: `${host} GET /api/orders/{id}`, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "browser", authState: "ANON", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "child-traffic", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["child-traffic"], objects: [], verdict: "untested" })
beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  state.snapshot = targetSnapshot({ datasetRevision: 7 })

})

it("shows collected wildcard subdomain requests under their actual service", async () => {
  const event = traffic()
  state.snapshot = targetSnapshot({ datasetRevision: 7, events: [event], cells: [{
    idn: "anon", op: event.op, resource: "", perSource: { human: "allow" }, reasons: {},
    overall: "allow", conflict: false, missedSources: [], evidenceIds: [event.eventId],
  }] })
  render(<RelationshipGraphView />)
  const group = await screen.findByRole("button", { name: new RegExp(`ORDERS APIs; ${host}; API group`) })
  expect(screen.queryByRole("button", { name: /발견된 호스트/ })).not.toBeInTheDocument()
  expect(group).toBeVisible()
})
