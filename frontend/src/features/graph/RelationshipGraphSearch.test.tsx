import { useEffect, useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { targetSnapshot } from "@/test/fixtures"
import type { Snapshot } from "@/lib/api/types"
import { RelationshipGraphView } from "./RelationshipGraphView"
import { emptyGraphWorkspace, graphViewKey, type GraphWorkspace } from "./graphWorkspace"
import { operationGroup, type HierarchyProjection } from "./graphHierarchy"

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
vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ projection, selectedElementId }: { projection: HierarchyProjection; selectedElementId: string | null }) => {
  useEffect(() => { state.projections(projection) }, [projection])
  return <div data-testid="search-canvas" data-selected={selectedElementId ?? ""} data-nodes={projection.nodes.filter(node => !node.hiddenInGraph).map(node => node.id).join("\n")} />
} }))
vi.mock("./GraphInspectorPanel", () => ({ GraphViewOverview: () => null, GraphInspectorPanel: ({ selection }: { selection: { operation: string | null; resource: string | null } }) => <p data-testid="search-detail">{selection.operation} {selection.resource}</p> }))

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
  const option = await screen.findByRole("option", { name: /^API GET \/api\/orders\/24/ })
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
  await screen.findByRole("option", { name: /^객체 orders:24/ })
  state.snapshot = targetSnapshot({ datasetRevision: 5, cells: cells.slice(0, 24) })
  rerender(<RelationshipGraphView />)
  await screen.findByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
  state.snapshot = targetSnapshot({ datasetRevision: 6, cells })
  rerender(<RelationshipGraphView />)
  expect(screen.getByRole("combobox")).toHaveValue("")
})
