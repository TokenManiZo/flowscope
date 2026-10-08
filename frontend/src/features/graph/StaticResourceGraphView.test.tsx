import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { renderWithQueryClient as render } from "@/test/render"
import { targetSnapshot } from "@/test/fixtures"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import type { HierarchyNode, HierarchyProjection, HierarchySelection } from "./graphHierarchy"
import { staticResourceEntries } from "./staticResourceGraph"
import type { GraphFilters } from "./graphProjection"

const fixture = vi.hoisted(() => ({ data: null as Snapshot | null }))
vi.mock("./useGraphWorkspace", async () => ({ useGraphWorkspace: (await import("@/test/graphWorkspace")).useMemoryGraphWorkspace }))
vi.mock("@/lib/query/hooks", () => ({ useProjectsQuery: () => ({ data: undefined }), useSnapshotQuery: () => ({ data: fixture.data, isLoading: false, isError: false }) }))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: ({ event }: { event: EventRecord }) => <div role="dialog" aria-label="자원 Request Lab">{event.eventId} {event.path}</div> }))
vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ projection, onNavigate, onSelect, onToggleObjectGroup, onOpenObject }: {
  projection: HierarchyProjection; onNavigate(node: HierarchyNode): void; onSelect(selection: HierarchySelection, id: string): void;
  onToggleObjectGroup(id: string): void; onOpenObject(node: HierarchyNode): void;
}) => <div data-testid="static-canvas">{projection.nodes.map(node => <button key={node.id} data-testid={node.id}
  onClick={() => onSelect(node.selection, node.id)} onDoubleClick={() => {
    if (node.kind === "resource") onOpenObject(node)
    else if (node.objectGroup) onToggleObjectGroup(node.id)
    else onNavigate(node)
  }}>{node.kind} {node.label}</button>)}</div> }))

import { RelationshipGraphView } from "./RelationshipGraphView"
const service = "https://static.test:443"
const filters: GraphFilters = { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: true, expanded: false }
beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  fixture.data = targetSnapshot({ displayObjects: [], events: [
    { eventId: "a", path: "/images/101/a.gif", op: `${service} GET /images/{id}/{id}`, method: "GET", idn: "user-a", source: "human", phase: "DISCOVERY", status: 200, classificationReasons: [], trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE", sourceDetail: "BROWSER", timestamp: 1, resource: "legacy:a", clusterEvidenceIds: ["a"] },
    { eventId: "b", path: "/images/202/b.gif", op: `${service} GET /images/{id}/{id}`, method: "GET", idn: "user-a", source: "human", phase: "DISCOVERY", status: 200, classificationReasons: [], trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE", sourceDetail: "BROWSER", timestamp: 2, resource: "legacy:b", clusterEvidenceIds: ["b"] },
  ] as unknown as EventRecord[] })
  fixture.data.events = fixture.data.events.map(event => ({ ...event, clusterEvidenceIds: ["a", "b"] }))
})

it.each(["API", "resource"])("double-clicking the folded %s opens both lists, then only the chosen resource list opens its Lab", async side => {
  const user = userEvent.setup(), entries = staticResourceEntries(fixture.data!, filters)
  render(<RelationshipGraphView />)
  const rail = screen.getByRole("complementary", { name: "분석 필터" })
  await user.click(within(rail).getByRole("button", { name: "전체" }))
  await user.dblClick(within(screen.getByTestId("static-canvas")).getByText("api-group IMAGES APIs"))
  const familyId = `operation-group:${entries[0].familyId}`
  const summaryId = `object-group:static-family-objects:${entries[0].familyId}`
  await user.click(screen.getByTestId(familyId))
  for (const name of ["API 하이라이트", "취약점으로 표시", "API 삭제"]) expect(screen.getByRole("button", { name })).toBeEnabled()
  await user.dblClick(screen.getByTestId(side === "API" ? familyId : summaryId))
  expect(screen.queryByTestId(summaryId)).not.toBeInTheDocument()
  for (const entry of entries) {
    expect(screen.getByTestId(`operation:${entry.apiId}`)).toBeVisible()
    expect(screen.getByTestId(`object-group:${entry.groupKey}`)).toBeVisible()
    expect(screen.queryByTestId(`resource:${entry.objectKey}`)).not.toBeInTheDocument()
  }
  await user.click(screen.getByTestId(`operation:${entries[0].apiId}`))
  for (const name of ["API 하이라이트", "취약점으로 표시", "API 삭제"]) expect(screen.getByRole("button", { name })).toBeEnabled()
  await user.dblClick(screen.getByTestId(`object-group:${entries[0].groupKey}`))
  expect(screen.queryByTestId(`resource:${entries[1].objectKey}`)).not.toBeInTheDocument()
  await user.dblClick(screen.getByTestId(`resource:${entries[0].objectKey}`))
  expect(screen.getByRole("dialog", { name: "자원 Request Lab" })).toHaveTextContent("a /images/101/a.gif")
  expect(fixture.data!.cells).toEqual([])
})
