import { useEffect, useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { targetSnapshot } from "@/test/fixtures"
import type { Snapshot, EventRecord } from "@/lib/api/types"
import { RelationshipGraphView } from "./RelationshipGraphView"
import { emptyGraphWorkspace, graphViewKey, type GraphWorkspace } from "./graphWorkspace"
import { operationGroup, type HierarchyProjection, type HierarchyNode } from "./graphHierarchy"
import type { GraphSelection } from "./graphProjection"

const state = vi.hoisted(() => ({ snapshot: null as Snapshot | null, workspace: null as GraphWorkspace | null, changes: vi.fn(), projections: vi.fn() }))
vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: state.snapshot, isError: false, isLoading: false }) }))
vi.mock("./useGraphWorkspace", () => ({ useGraphWorkspace: () => {
  const [workspace, setWorkspace] = useState(state.workspace!)
  return { workspace, error: "", saving: false, reload: vi.fn(), retry: vi.fn(), update: (change: (current: GraphWorkspace) => GraphWorkspace) => setWorkspace(current => {
    const next = change(current)
    if (next !== current) state.changes(next)
    state.workspace = next
    return next
  }) }
} }))
vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ projection, selectedElementId, openObjectGroupId, onToggleObjectGroup, onSelect, onClearSelection, onOpenObject }: { projection: HierarchyProjection; selectedElementId: string | null; openObjectGroupId?: string | null; onToggleObjectGroup(id: string): void; onSelect(selection: GraphSelection, id: string): void; onClearSelection(): void; onOpenObject?(node: HierarchyNode): void }) => {
  useEffect(() => { state.projections(projection) }, [projection])
  return <div data-testid="search-canvas" data-selected={selectedElementId ?? ""} data-open-object={openObjectGroupId ?? ""} data-nodes={projection.nodes.filter(node => !node.hiddenInGraph).map(node => node.id).join("\n")}>
    {projection.nodes.filter(node => node.kind === "object-group").map(node => <button key={node.id} onClick={() => onToggleObjectGroup(node.id)}>toggle {node.id}</button>)}
    {projection.nodes.filter(node => node.kind === "resource" || node.kind === "operation").map(node => <button key={node.id} onClick={() => onSelect(node.selection, node.id)} onDoubleClick={() => onOpenObject?.(node)}>select {node.id}</button>)}
    <button onClick={onClearSelection}>clear canvas</button>
  </div>
} }))
vi.mock("./GraphInspectorPanel", () => ({ GraphViewOverview: () => null, GraphInspectorPanel: ({ selection, actions }: { selection: { operation: string | null; resource: string | null; evidenceIds: readonly string[] }; actions: { onOpenRequestLab(): void } }) => <><p data-testid="search-detail" data-evidence={selection.evidenceIds.join(",")}>{selection.operation} {selection.resource}</p><button onClick={actions.onOpenRequestLab}>open lab</button></> }))

vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: ({ event }: { event: EventRecord }) => <div role="dialog" data-testid="object-lab">{event.eventId}</div> }))

const service = "https://search.test:443"
const cells = Array.from({ length: 25 }, (_, index) => ({ idn: "USER A", op: `${service} GET /api/orders/${String(index).padStart(2, "0")}`, resource: `orders:${index}`, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [`ev-${index}`] }))

beforeEach(() => {
  state.changes.mockClear(); state.projections.mockClear()
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells })
  state.workspace = { ...emptyGraphWorkspace, views: { [graphViewKey(emptyGraphWorkspace.navigation)]: { positions: { [`target:${service}`]: { x: 200, y: 300 } }, sizes: {}, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, expandedGroups: [] } } }
  window.matchMedia = vi.fn(query => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

it("typing does not rebuild the graph or save workspace; selecting an off-page API reveals it", async () => {
  render(<RelationshipGraphView />)
  const projections = state.projections.mock.calls.length
  await userEvent.type(screen.getByRole("combobox"), "/orders/24")
  const option = await screen.findByRole("option", { name: /^API\s*GET \/api\/orders\/24/ })
  await waitFor(() => expect(option).toHaveAttribute("aria-disabled", "false"))
  expect(state.projections).toHaveBeenCalledTimes(projections)
  expect(state.changes).not.toHaveBeenCalled()
  await userEvent.click(option)
  await waitFor(() => expect(screen.getByTestId("search-canvas")).toHaveAttribute("data-selected", `operation:${cells[24].op}`))
  expect(screen.getByTestId("search-canvas").dataset.nodes).toContain(`operation:${cells[24].op}`)
  expect(state.workspace?.navigation).toMatchObject({ level: "group", groupId: operationGroup(cells[24].op).id, operationLimit: 18 })
  expect(state.workspace?.views[graphViewKey(emptyGraphWorkspace.navigation)].positions[`target:${service}`]).toEqual({ x: 200, y: 300 })
  expect(screen.getByText("검색으로 1개 추가 표시")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "노드 검색 지우기" }))
  expect(screen.getByTestId("search-canvas")).toHaveAttribute("data-selected", `operation:${cells[24].op}`)
  expect(state.workspace?.navigation.level).toBe("group")
})

it("replaces disappeared results with an empty state and resets search on dataset replacement", async () => {
  const { rerender } = render(<RelationshipGraphView />)
  await userEvent.type(screen.getByRole("combobox"), "orders:24")
  await screen.findByRole("option", { name: /^객체\s*orders:24/ })
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells: cells.slice(0, 24) })
  rerender(<RelationshipGraphView />)
  await screen.findByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
  state.snapshot = targetSnapshot({ datasetRevision: 6, cells })
  rerender(<RelationshipGraphView />)
  expect(screen.getByRole("combobox")).toHaveValue("")
})

it("keeps object expansion on single selection and folds it on background, Lab and remount", async () => {
  const navigation = { ...emptyGraphWorkspace.navigation, level: "group" as const, groupId: operationGroup(cells[0].op).id }
  state.workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: { positions: {}, sizes: {}, viewport: null, expandedGroups: ["object-group:|orders"] } } }
  let view = render(<RelationshipGraphView />)
  const canvas = () => screen.getByTestId("search-canvas")
  expect(canvas()).toHaveAttribute("data-open-object", "")
  expect(canvas().dataset.nodes).not.toContain("resource:orders:0")
  const open = () => userEvent.click(screen.getByRole("button", { name: "toggle object-group:|orders" }))
  await open()
  expect(canvas()).toHaveAttribute("data-open-object", "object-group:|orders")
  await userEvent.click(screen.getByRole("button", { name: "select resource:orders:0" }))
  expect(canvas()).toHaveAttribute("data-open-object", "object-group:|orders")
  await userEvent.click(screen.getByRole("button", { name: "clear canvas" }))
  expect(canvas()).toHaveAttribute("data-open-object", "")
  await open()
  await userEvent.click(screen.getByRole("button", { name: "select " + `operation:${cells[0].op}` }))
  expect(canvas()).toHaveAttribute("data-open-object", "object-group:|orders")
  await userEvent.click(screen.getByRole("button", { name: "open lab" }))
  expect(canvas()).toHaveAttribute("data-open-object", "")
  await open()
  view.unmount()
  view = render(<RelationshipGraphView />)
  expect(canvas()).toHaveAttribute("data-open-object", "")
  expect(state.changes).not.toHaveBeenCalled()
})

const observed = (changes: Partial<EventRecord> = {}): EventRecord => ({ eventId: "observed", method: "GET", path: "/api/orders/observed", status: 200, fp: "", idn: "USER B", role: "USER", source: "human", op: `${service} GET /api/orders/observed`, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [changes.eventId ?? "observed"], objects: [], verdict: "untested", ...changes })

it("refreshes event-only search results and selects an observed API outside the page limit", async () => {
  const view = render(<RelationshipGraphView />)
  await userEvent.click(screen.getByRole("button", { name: "관측 전체" }))
  await userEvent.type(screen.getByRole("combobox"), "/orders/observed")
  await screen.findByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells, events: [observed()] })
  view.rerender(<RelationshipGraphView />)
  const option = await screen.findByRole("option", { name: /^관측 API/ })
  await waitFor(() => expect(option).toHaveAttribute("aria-disabled", "false"))
  await userEvent.click(option)
  await waitFor(() => expect(screen.getByTestId("search-canvas")).toHaveAttribute("data-selected", `observed-operation:${observed().op}`))
  expect(screen.getByTestId("search-detail")).toHaveAttribute("data-evidence", "observed")
  expect(state.workspace?.navigation.operationLimit).toBe(18)
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells, events: [observed({ classificationOverride: true, trafficDisposition: "EXCLUDE", classificationReasons: ["USER_EXCLUDE"] })] })
  view.rerender(<RelationshipGraphView />)
  await userEvent.type(screen.getByRole("combobox"), " ")
  await screen.findByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")
  await waitFor(() => expect(screen.queryByTestId("search-detail")).not.toBeInTheDocument())
})

it("keeps judged and other-account evidence updated on the same API card", async () => {
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells, events: [observed({ op: cells[0].op })] })
  const view = render(<RelationshipGraphView />)
  await userEvent.click(screen.getByRole("button", { name: "관측 전체" }))
  await userEvent.type(screen.getByRole("combobox"), "/orders/00")
  const option = await screen.findByRole("option", { name: /^API\s*GET \/api\/orders\/00/ })
  await waitFor(() => expect(option).toHaveAttribute("aria-disabled", "false"))
  await userEvent.click(option)
  await waitFor(() => expect(screen.getByTestId("search-detail").dataset.evidence).toContain("ev-0"))
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells: cells.map(cell => ({ ...cell, evidenceIds: [...cell.evidenceIds, "new-judged"] })), events: [observed({ op: cells[0].op })] })
  view.rerender(<RelationshipGraphView />)
  await waitFor(() => expect(screen.getByTestId("search-detail").dataset.evidence).toContain("new-judged"))
  expect(screen.getByTestId("search-detail").dataset.evidence).toContain("observed")
})

it("reveals and highlights observed search cards in the compact list", async () => {
  window.matchMedia = vi.fn(query => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells, events: [observed()] })
  render(<RelationshipGraphView />)
  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  await userEvent.click(screen.getByRole("button", { name: "관측 전체" }))
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await userEvent.type(screen.getByRole("combobox"), "/orders/observed")
  const option = await screen.findByRole("option", { name: /^관측 API/ })
  await waitFor(() => expect(option).toHaveAttribute("aria-disabled", "false"))
  await userEvent.click(option)
  expect(await screen.findByTestId("search-detail")).toHaveAttribute("data-evidence", "observed")
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  const card = await screen.findByRole("button", { name: /Observed operation/ })
  expect(card).toHaveAttribute("data-graph-node-id", `observed-operation:${observed().op}`)
  expect(card.className).toContain("outline-dashed")
})

it("switches to a separate resend graph of Request Lab and Repeater sends without touching the saved collected layout", async () => {
  const resendOp = `${service} GET /api/orders/{id}`
  const repeater = { ...observed(), eventId: "rep-1", idn: "USER B", op: resendOp, path: "/api/orders/3", resource: "orders:3", sourceDetail: "BURP_REPEATER", phase: "BASELINE", status: 403 } as EventRecord
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells, events: [repeater], manualVerifications: [{ eventId: "lab-1", originEvidenceId: "ev-0", operation: cells[0].op, resource: "orders:0", identity: "anon", identityId: "anon", timestamp: 2, status: 401, durationMs: 5 }] })
  render(<RelationshipGraphView />)
  expect(screen.getByRole("button", { name: "재전송 보기" })).toBeVisible()
  expect(screen.queryByText(/건은 이 그래프에 없음/)).not.toBeInTheDocument()
  expect(screen.getByTestId("search-canvas").dataset.nodes).not.toContain("resend-operation:")
  const changes = state.changes.mock.calls.length

  await userEvent.click(screen.getByRole("button", { name: "재전송 보기" }))

  const nodes = screen.getByTestId("search-canvas").dataset.nodes!.split(String.fromCharCode(10))
  expect(nodes).toEqual(expect.arrayContaining([`resend-operation:lab:${cells[0].op}`, `resend-operation:repeater:${resendOp}`, "identity:anon", "identity:USER B"]))
  expect(nodes.some(id => id.startsWith("target:") || id.startsWith("api-group:"))).toBe(false)
  expect(screen.getByRole("status")).toHaveTextContent("Repeater는 원본을 알 수 없어 응답 코드만 보여 줍니다")
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("checkbox", { name: /Repeater/ }))
  expect(screen.getByTestId("search-canvas").dataset.nodes).not.toContain("resend-operation:repeater:")

  await userEvent.click(screen.getByRole("button", { name: "수집 그래프" }))
  expect(screen.getByTestId("search-canvas").dataset.nodes).toContain(`target:${service}`)
  expect(state.changes.mock.calls.length).toBe(changes)
})


it("opens the object's latest actual Evidence in Request Lab after a double click", async () => {
  const op = cells[0].op
  const events = [1,2].map(i => ({ eventId: `obj-event-${i}`, op, path: "/api/orders/00", method: "GET", idn: "USER A", source: "human", timestamp: i, status: 200, trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, executionTrust: "OBSERVED", sourceDetail: "BROWSER", phase: "EXPLORATION", classificationReasons: [], objects: [] } as unknown as EventRecord))
  state.snapshot = targetSnapshot({ datasetRevision: 5, events, cells: [{ ...cells[0], evidenceIds: events.map(e => e.eventId) }], displayObjects: events.map(event => ({ eventId: event.eventId, operation: op, apiKey: `${service} GET /api/orders/{id}`, kind: "PATH", groupKey: "path", objectKey: "one-object", ordinal: 1, fields: ["/segments/2"], legacyResource: null })) })
  state.workspace!.navigation = { level: "group", groupId: operationGroup(op).id, operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  render(<RelationshipGraphView />)
  await userEvent.click(screen.getByRole("button", { name: "toggle object-group:path" }))
  await userEvent.dblClick(screen.getByRole("button", { name: "select resource:one-object" }))
  expect(await screen.findByTestId("object-lab")).toHaveTextContent("obj-event-2")
})
