import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ResponsiveGraphList } from "./ResponsiveGraphList"
import type { GraphProjection, GraphFilters } from "./graphProjection"
import { projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex, searchKey } from "./graphSearch"
import { targetSnapshot } from "@/test/fixtures"

const hierarchyFilters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
const operationNavigation: GraphNavigation = { level: "operation", groupId: '["Target","orders"]', operation: "GET /api/orders/{id}", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const rawCell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["raw-a"] }

it("omits the redundant breakpoint notice and source-요청 기록 path list", () => {
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [rawCell] }), hierarchyFilters, operationNavigation)
  render(<ResponsiveGraphList projection={hierarchy} onSelect={vi.fn()} />)
  expect(screen.queryByText(/900px 이하/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText("Source 요청 기록 경로")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /^orders:101/ })).toBeVisible()
})

const selection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human" as const, evidenceIds: ["e-1", "e-2"] }
const candidateSelection = { operation: "UNKNOWN /unseen/{id}", resource: null, identity: null, source: "human" as const, evidenceIds: ["route-evidence"], routeCandidate: { id: "route-candidate:1", service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "run-1", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], reviewReason: "needs review", priorityReasons: ["input"] } }
const projection: GraphProjection = {
  identities: [], resources: [], routeCandidates: [{ ...candidateSelection.routeCandidate, id: "route-candidate:1", label: "UNKNOWN /unseen/{id}", observedText: "미관측 후보", selection: candidateSelection }], edges: [{ id: "edge", sourceId: "identity:alice", targetId: "operation:GET /orders/{id}", relation: "identity-operation", source: "human", sourceText: "HUMAN", line: "solid", color: "#2563eb", count: 2, countLabel: "×2", selection }],
  operations: [{ id: "operation:GET /orders/{id}", kind: "operation", label: "GET /orders/{id}", wrappedLabel: "GET\n/orders\n/{id}", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
  listItems: [{ id: "operation:GET /orders/{id}", kind: "operation", label: "GET /orders/{id}", wrappedLabel: "GET\n/orders\n/{id}", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
}

it("presents the same projected operation semantics as a keyboard-accessible list", async () => {
  const select = vi.fn()
  render(<ResponsiveGraphList projection={projection} onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /GET \/orders\/\{id\}/ }))
  expect(screen.getByText("HUMAN · ALLOW · ×2")).toBeVisible()
  expect(screen.getByText("alice · order:1")).toBeVisible()
  expect(select).toHaveBeenCalledWith(selection)
})

it("uses the same compact card hierarchy as the relationship graph nodes", () => {
  render(<ResponsiveGraphList projection={projection} onSelect={vi.fn()} />)
  const operation = screen.getByRole("button", { name: /^GET \/orders\/\{id\}/ })
  expect(within(operation).getByText("GET")).toHaveAttribute("data-node-badge", "GET")
  expect(within(operation).getByText("/orders/{id}")).toBeVisible()
  expect(within(operation).queryByText("2 요청 기록")).not.toBeInTheDocument()
})

it("keeps candidate 기록 번호 outside the candidate button name while rendering full provenance detail", () => {
  render(<ResponsiveGraphList projection={projection} onSelect={vi.fn()} />)
  const candidate = screen.getByRole("button", { name: /UNKNOWN \/unseen\/\{id\}/ })
  expect(candidate).not.toHaveAccessibleName(/route-evidence/)
  const evidenceId = screen.getByText("route-evidence")
  expect(evidenceId).toBeVisible()
  expect(evidenceId.closest("button")).toBeNull()
  expect(screen.getAllByText(/https:\/\/api\.example\.test/).length).toBeGreaterThan(0)
  expect(screen.getByText(/burp/)).toBeVisible()
})

it("keeps site structure neutral and routes the original group node into navigation", async () => {
  const navigation: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [{ idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["raw-evidence"] }] }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, navigation)
  const navigate = vi.fn()
  render(<ResponsiveGraphList projection={hierarchy} onSelect={vi.fn()} onNavigate={navigate} />)
  expect(screen.queryByText(/UNKNOWN/)).not.toBeInTheDocument()
  expect(screen.queryByText(/orders:101/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /ORDERS APIs/ }))
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: "api-group", groupId: '["Target","orders"]' }))
})

it("keeps observed-only GET nodes selectable in the compact group list", async () => {
  const op = "https://api.test GET /account/edit"
  const snapshot = targetSnapshot({ events: [{
    eventId: "observed-1", method: "GET", path: "/account/edit?ticket=alpha", status: 200, fp: "", idn: "alice", role: "USER", source: "human", op, resource: null, timestamp: 1,
    sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", coverageEligible: false,
    classificationOverride: false, classificationReasons: ["AMBIGUOUS_KEEP"], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["observed-1"], objects: [], verdict: "untested",
  }] })
  const group = projectHierarchy(snapshot, { ...hierarchyFilters, includeSupportTraffic: true }, { level: "group", groupId: '["https://api.test","account"]', operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }, { operations: [op] })
  const select = vi.fn()
  render(<ResponsiveGraphList projection={group} snapshot={snapshot} onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /Observed operation/ }))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ operation: op, evidenceIds: ["observed-1"] }), `observed-operation:${op}`)
})

it("preserves support identity as a search destination", async () => {
  const snapshot = targetSnapshot({ cells: [rawCell], events: [{
    eventId: "poll-b", method: "GET", path: "/api/orders/1", status: 200, fp: "", idn: "USER B", role: "USER", source: "human", op: rawCell.op, resource: null, timestamp: 1,
    sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "POLLING", trafficDisposition: "EXCLUDE", coverageEligible: false,
    classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["poll-b"], objects: [], verdict: "untested",
  }] })
  const filters = { ...hierarchyFilters, includeSupportTraffic: true }
  const index = buildGraphSearchIndex(snapshot, filters)
  expect(index.byKey.has(searchKey("identity", "Target", "USER B"))).toBe(true)
  expect(snapshot.events[0].eventId).toBe("poll-b")
})
