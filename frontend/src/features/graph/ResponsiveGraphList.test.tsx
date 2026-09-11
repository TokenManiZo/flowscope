import { render, screen, within } from "@testing-library/react"
import { useState } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ResponsiveGraphList } from "./ResponsiveGraphList"
import type { GraphProjection, GraphFilters } from "./graphProjection"
import { projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { targetSnapshot } from "@/test/fixtures"

const hierarchyFilters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
const operationNavigation: GraphNavigation = { level: "operation", groupId: '["Target","orders"]', operation: "GET /api/orders/{id}", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const rawCell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["raw-a"] }

it("switches compact path focus from a gap to another candidate and an exact observed source path", async () => {
  const cells = [rawCell, { ...rawCell, resource: "orders:202", perSource: { human: "allow" as const, scanner: "allow" as const }, evidenceIds: ["raw-two"] }, { ...rawCell, idn: "USER B" }]
  const gaps = [303, 404].map(resource => ({ id: `gap-${resource}`, type: "UNCROSSED", risk: 1, idn: "USER B", op: rawCell.op, resource: `orders:${resource}`, missedSources: [], summary: "server" }))
  const hierarchy = projectHierarchy(targetSnapshot({ cells, gaps }), hierarchyFilters, { ...operationNavigation, focusCandidateKey: '["USER B","GET /api/orders/{id}","orders:303"]' })
  function Interactive() {
    const [selected, setSelected] = useState<string | null>(null)
    return <ResponsiveGraphList projection={hierarchy} selectedElementId={selected} onSelect={(_, id) => setSelected(id ?? null)} />
  }
  render(<Interactive />)
  const paths = within(screen.getByLabelText("Source Evidence 경로"))
  await userEvent.click(paths.getByRole("button", { name: /미교차 후보.*· orders:404/ }))
  expect(paths.getByRole("button", { name: /미교차 후보.*· orders:404/ })).toHaveAttribute("data-focused", "yes")
  expect(paths.getByRole("button", { name: /미교차 후보.*· orders:303/ })).toHaveAttribute("data-focused", "no")
  await userEvent.click(paths.getByRole("button", { name: /SCANNER.*USER A.*· orders:202/ }))
  expect(paths.getAllByText("포커스 경로")).toHaveLength(2)
  for (const button of paths.getAllByRole("button")) expect(button).toHaveAttribute("data-focused", button.textContent?.includes("SCANNER") ? "yes" : "no")
})

it("visibly and accessibly focuses only the selected identity's compact source paths", async () => {
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [rawCell, { ...rawCell, idn: "USER B", resource: "orders:202", evidenceIds: ["raw-b"] }] }), hierarchyFilters, operationNavigation)
  function InteractiveList() {
    const [selected, setSelected] = useState<string | null>(null)
    return <ResponsiveGraphList projection={hierarchy} selectedElementId={selected} onSelect={(_, id) => setSelected(id ?? null)} />
  }
  render(<InteractiveList />)
  await userEvent.click(screen.getByRole("button", { name: "USER A" }))
  expect(screen.getByRole("button", { name: "USER A" })).toHaveAttribute("aria-pressed", "true")
  const paths = within(screen.getByLabelText("Source Evidence 경로"))
  for (const button of paths.getAllByRole("button")) {
    expect(button).toHaveAttribute("data-focused", button.textContent?.includes("USER A") ? "yes" : "no")
    expect(within(button).queryByText("포커스 경로") !== null).toBe(button.textContent?.includes("USER A"))
  }
  await userEvent.click(screen.getByRole("button", { name: "USER B" }))
  for (const button of paths.getAllByRole("button")) expect(button).toHaveAttribute("data-focused", button.textContent?.includes("USER B") ? "yes" : "no")
})

it("keeps only the exact UNCROSSED coordinate focused in compact mode, including while its Evidence action is selected", async () => {
  const gaps = [202, 303].map(resource => ({ id: `gap-${resource}`, type: "UNCROSSED", risk: 1, idn: "USER B", op: rawCell.op, resource: `orders:${resource}`, missedSources: [], summary: "server candidate" }))
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [rawCell], gaps }), hierarchyFilters, { ...operationNavigation, focusCandidateKey: '["USER B","GET /api/orders/{id}","orders:202"]' })
  const select = vi.fn()
  const { rerender } = render(<ResponsiveGraphList projection={hierarchy} onSelect={select} />)
  const paths = within(screen.getByLabelText("Source Evidence 경로"))
  expect(paths.getAllByText("포커스 경로")).toHaveLength(2)
  const exactObject = paths.getByRole("button", { name: /미교차 후보.*· orders:202/ })
  const otherObject = paths.getByRole("button", { name: /미교차 후보.*· orders:303/ })
  expect(exactObject).toHaveAttribute("data-focused", "yes")
  expect(otherObject).toHaveAttribute("data-focused", "no")
  await userEvent.click(exactObject)
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ identity: "USER B", operation: rawCell.op, resource: "orders:202", source: null, evidenceIds: [], cellKeys: ['["USER B","GET /api/orders/{id}","orders:202"]'], gapIds: ["gap-202"] }), expect.any(String))
  const selectedId = select.mock.calls[0][1]
  rerender(<ResponsiveGraphList projection={hierarchy} selectedElementId={selectedId} onSelect={select} />)
  expect(exactObject).toHaveAttribute("aria-pressed", "true")
  expect(paths.getAllByText("포커스 경로")).toHaveLength(2)
  rerender(<ResponsiveGraphList projection={hierarchy} selectedElementId={null} onSelect={select} />)
  expect(paths.getAllByText("포커스 경로")).toHaveLength(2)
})

it("distinguishes same-source same-identity group Evidence actions by raw operation and keeps H/S/L styles", async () => {
  const cells = [rawCell, { ...rawCell, op: "PATCH /api/orders/{id}", evidenceIds: ["patch-raw"], perSource: { human: "allow" as const, scanner: "allow" as const, llm: "allow" as const } }]
  const hierarchy = projectHierarchy(targetSnapshot({ cells }), hierarchyFilters, { ...operationNavigation, level: "group", operation: "" })
  const select = vi.fn()
  render(<ResponsiveGraphList projection={hierarchy} onSelect={select} />)
  const paths = within(screen.getByLabelText("Source Evidence 경로"))
  const get = paths.getByRole("button", { name: /HUMAN.*USER A.*GET \/api\/orders\/\{id\}/ })
  const patch = paths.getByRole("button", { name: /HUMAN.*USER A.*PATCH \/api\/orders\/\{id\}/ })
  await userEvent.click(get)
  await userEvent.click(patch)
  expect(select.mock.calls[0][0]).toMatchObject({ operation: rawCell.op, identity: "USER A", source: "human", cells: [rawCell], cellKeys: ['["USER A","GET /api/orders/{id}","orders:101"]'], evidenceIds: ["raw-a"] })
  expect(select.mock.calls[1][0]).toMatchObject({ operation: "PATCH /api/orders/{id}", cells: [cells[1]], evidenceIds: ["patch-raw"] })
  for (const [source, line, color] of [["HUMAN", "solid", "#2563eb"], ["SCANNER", "dashed", "#dc2626"], ["LLM", "dotted", "#e4e4e7"]]) {
    const marker = within(paths.getByRole("button", { name: new RegExp(`${source}.*PATCH`) })).getByLabelText(`${source} ${line}`)
    expect(marker).toHaveStyle({ borderTopStyle: line, borderTopColor: color })
  }
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
  expect(within(operation).getByText("2 Evidence")).toBeVisible()
})

it("keeps candidate Evidence IDs outside the candidate button name while rendering full provenance detail", () => {
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
