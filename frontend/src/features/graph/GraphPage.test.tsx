import { renderWithQueryClient as render } from "@/test/render"
import { act, screen, waitFor, within } from "@testing-library/react"
import { useEffect } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { GraphPage as CurrentGraphPage } from "./GraphPage"
vi.mock("./useGraphWorkspace", async () => ({ useGraphWorkspace: (await import("@/test/graphWorkspace")).useMemoryGraphWorkspace }))

vi.mock("./CytoscapeGraph", () => ({ CytoscapeGraph: ({ onSelect, selectedElementId, laneLayout, onLaneBoundsChange, highlight }: { highlight?: ReadonlyMap<string, string> | null; selectedElementId?: string | null; laneLayout?: { lane: number; version: number }; onLaneBoundsChange?(bounds: ReadonlyArray<{ left: number; right: number } | null>): void; onSelect(selection: { operation: string; resource: string; identity: string; source: "human"; evidenceIds: string[] }, elementId: string): void }) => {
  // 실제 캔버스 대신 레인 범위를 알리고, 받은 레인 정렬 요청을 그대로 노출한다.
  useEffect(() => { onLaneBoundsChange?.((globalThis as { graphLaneBounds?: ReadonlyArray<{ left: number; right: number } | null> }).graphLaneBounds ?? [{ left: 20, right: 300 }, { left: 400, right: 700 }]) }, [onLaneBoundsChange])
  return <button type="button" data-testid="cytoscape-graph" data-lane-layout={`${laneLayout?.lane ?? -1}:${laneLayout?.version ?? -1}`} data-selected-element={selectedElementId ?? ""} data-highlight={highlight ? "on" : "off"} onClick={() => onSelect({ operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }, "operation:GET /orders/{id}")}>그래프 작업 선택</button>
} }))
vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: (globalThis as { graphFixture?: Snapshot }).graphFixture, isLoading: false, isError: false }) }))
vi.mock("@/features/evidence/OperationDetail", () => ({ OperationDetail: () => null }))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: ["human"], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }], verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [],
  events: [{ eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow" }],
}

afterEach(() => { (globalThis as { graphLaneBounds?: unknown }).graphLaneBounds = undefined })

const hierarchyCell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["cell-evidence-not-an-event"] }

it("opens the graph on the full relationship view", () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  render(<CurrentGraphPage />)
  const toolbar = screen.getByRole("toolbar", { name: "그래프 상단 제어" })
  // 툴바 왼쪽 제목·스위치와 필터 레일의 "분석 필터" 제목 칸은 없앴다. 객체 접기는 묶음 노드가 맡는다.
  for (const removed of ["전체 관계 보기", "객체 펼치기", "꺾은 선"]) expect(within(toolbar).queryByText(removed)).not.toBeInTheDocument()
  expect(screen.queryByText("분석 필터")).not.toBeInTheDocument()
  expect(within(toolbar).queryByText(/identities|API groups/)).not.toBeInTheDocument()
  expect(within(toolbar).queryByText("ACCESS GRAPH")).not.toBeInTheDocument()
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.getByRole("button", { name: "그래프 맞추기" })).toBeVisible()
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
})

it("keeps an empty lane header at its anchor instead of overlapping the neighbour", () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  // API GROUP 레인에 노드가 없는 상태. 균등 분할이면 TARGET 노드 범위와 머리글이 겹친다.
  ;(globalThis as { graphLaneBounds?: ReadonlyArray<{ left: number; right: number } | null> }).graphLaneBounds = [{ left: 200, right: 900 }, null]
  render(<CurrentGraphPage />)

  const target = screen.getByRole("button", { name: "TARGET 레인 기준 정렬" })
  const group = screen.getByRole("button", { name: "API GROUP 레인 기준 정렬" })
  const right = (element: HTMLElement) => Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width)
  expect(right(target)).toBe(900)
  expect(Number.parseFloat(group.style.left)).toBeGreaterThanOrEqual(right(target))
  expect(Number.parseFloat(group.style.width)).toBeGreaterThan(0)
})

it("re-sorts a single lane from its header placed on the bounds the canvas reports", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  render(<CurrentGraphPage />)
  const laneButton = screen.getByRole("button", { name: "API GROUP 레인 기준 정렬" })
  // 캔버스가 알린 범위(mock: 두 번째 레인 400~700)를 그대로 머리글 위치로 쓴다.
  expect(laneButton).toHaveStyle({ left: "400px", width: "300px" })
  expect(screen.getByRole("button", { name: "TARGET 레인 기준 정렬" })).toBeVisible()
  expect(screen.getByTestId("cytoscape-graph")).toHaveAttribute("data-lane-layout", "0:0")

  await userEvent.click(laneButton)

  expect(screen.getByTestId("cytoscape-graph")).toHaveAttribute("data-lane-layout", "1:1")
})

it("reconciles retained aggregate coordinates and 기록 번호 after two current cells shrink to one", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const old = { ...hierarchyCell, evidenceIds: ["ev-old"] }
  const survivor = { ...hierarchyCell, resource: "orders:202", overall: "deny" as const, reasons: { human: "surviving server reason" }, evidenceIds: ["ev-survivor"] }
  const fixture = { ...snapshot, cells: [old, survivor], events: [{ ...snapshot.events[0], idn: old.idn, op: old.op, resource: old.resource, eventId: "ev-old", clusterEvidenceIds: ["ev-old"] }, { ...snapshot.events[0], idn: survivor.idn, op: survivor.op, resource: survivor.resource, eventId: "ev-survivor", clusterEvidenceIds: ["ev-survivor"] }] }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = fixture
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  const { rerender } = render(<GraphPage />)
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  await userEvent.click(screen.getByRole("row", { name: /^GET \/api\/orders\/\{id\}/ }))
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...fixture, revision: 2, cells: [survivor] }
  rerender(<GraphPage />)
  expect(screen.getByRole("complementary", { name: "선택 작업" })).toHaveTextContent("orders:202")
  expect(screen.getByRole("complementary", { name: "선택 작업" })).not.toHaveTextContent("orders:101")
}, 15_000)

it("navigates Site→Group and selects API and Object in the list without leaving the group", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells: [hierarchyCell] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  expect(screen.getByText("Site Overview")).toBeVisible()
  expect(screen.queryByText("orders:101")).not.toBeInTheDocument()
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  const breadcrumb = screen.getByRole("navigation", { name: "그래프 계층" })
  expect(within(breadcrumb).getByText("ORDERS APIs")).toHaveAttribute("aria-current", "page")
  expect(within(breadcrumb).getByRole("button", { name: "Site Overview" })).toBeVisible()
  expect(screen.queryByText("orders:101")).not.toBeInTheDocument()
  // 목록 표에서 API를 눌러도 화면은 그룹에 머물고 선택만 바뀐다. 객체는 객체 칩으로 줄 아래에 펼친다.
  await userEvent.click(screen.getByRole("row", { name: /^GET \/api\/orders\/\{id\}/ }))
  expect(within(breadcrumb).getByText("ORDERS APIs")).toHaveAttribute("aria-current", "page")
  expect(breadcrumb).not.toHaveTextContent("https://api.example.test")
  await userEvent.click(screen.getByRole("button", { name: /^orders 객체 1개 펼치기/ }))
  await userEvent.click(screen.getByRole("row", { name: "orders:101" }))
  expect(within(screen.getByRole("complementary", { name: "선택 작업" })).getByText(/요청 기록|연결된 요청 기록이 없습니다/)).toBeVisible()
  expect(screen.queryByText("cell-evidence-not-an-event")).not.toBeInTheDocument()
  expect(within(breadcrumb).getByText("ORDERS APIs")).toHaveAttribute("aria-current", "page")
}, 15_000)

it("requires explicit 18-item expansion for APIs and retains group paging on Back", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("900"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const cells = Array.from({ length: 19 }, (_, index) => ({ ...hierarchyCell, op: `GET /api/orders/${String(index + 1).padStart(2, "0")}`, resource: `orders:${String(index + 1).padStart(2, "0")}` }))
  cells.push(...Array.from({ length: 18 }, (_, index) => ({ ...hierarchyCell, op: "GET /api/orders/01", resource: `orders:${String(index + 20).padStart(2, "0")}` })))
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  expect(screen.queryByRole("row", { name: /^GET \/api\/orders\/19/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /노드 18개 더 보기/ }))
  // 목록 표는 숫자 ID만 다른 API를 /api/orders/{id} 한 줄로 묶어 접어 두므로, 펼치고 나머지까지 연다.
  const openAllOrders = async () => {
    await userEvent.click(screen.getByRole("row", { name: "GET /api/orders/{id} 묶음" }))
    await userEvent.click(screen.getByText(/^… \d+개 더$/))
  }
  await openAllOrders()
  expect(screen.getByRole("row", { name: /^GET \/api\/orders\/19/ })).toBeVisible()
  // 목록에서는 API로 들어가지 않으므로, 사이트로 나갔다가 뒤로 돌아와도 그룹 페이지 수가 유지되는지 본다.
  await userEvent.click(within(screen.getByRole("navigation", { name: "그래프 계층" })).getByRole("button", { name: "Site Overview" }))
  await userEvent.click(screen.getByRole("button", { name: "뒤로" }))
  await openAllOrders()
  expect(screen.getByRole("row", { name: /^GET \/api\/orders\/19/ })).toBeVisible()
})

it("switches the graph between judged APIs and every observed request including folded static resources, and resets to judged APIs", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  const page = { ...snapshot.events[0], eventId: "php-1", clusterEvidenceIds: ["php-1"], path: "/board/list.php", op: "GET /board/list.php", resource: null, trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE", coverageEligible: false }
  const style = { ...page, eventId: "css-1", clusterEvidenceIds: ["css-1"], path: "/theme/site.css", op: "GET /theme/site.css", trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE" }
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, events: [...snapshot.events, page, style] }
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  const rail = screen.getByRole("complementary", { name: "분석 필터" })
  expect(within(rail).getByRole("button", { name: "핵심 API만" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryAllByText("BOARD APIs")).toHaveLength(0)
  await userEvent.click(within(rail).getByRole("button", { name: "관측 전체" }))
  expect(within(rail).getByRole("button", { name: "관측 전체" })).toHaveAttribute("aria-pressed", "true")
  await userEvent.click(within(rail).getByRole("button", { name: "보기 범위 도움말" }))
  expect(screen.getByText(/판정에 쓰지 않습니다/)).toBeVisible()
  await userEvent.keyboard("{Escape}")
  // 관측 전체에서 정적 자원 묶음과 서버 렌더링 화면이 함께 추가된다.
  expect(screen.queryAllByText("BOARD APIs").length).toBeGreaterThan(0)
  expect(screen.queryAllByText("THEME APIs").length).toBeGreaterThan(0)
  await userEvent.click(within(rail).getByRole("button", { name: "초기화" }))
  expect(within(rail).getByRole("button", { name: "핵심 API만" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryAllByText("BOARD APIs")).toHaveLength(0)
})

it("destroys the canvas branch and exposes the same projection as a list across the 900px breakpoint", async () => {
  const listeners = new Set<(event: Event) => void>()
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: (_: string, listener: (event: Event) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: Event) => void) => listeners.delete(listener), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)
  expect(screen.getByRole("complementary", { name: "분석 필터" })).toBeVisible()
  const rail = screen.getByRole("complementary", { name: "분석 필터" })
  for (const section of ["보기 범위", "출처", "계정", "응답 코드", "그래프 조작"]) expect(within(rail).getByText(section)).toBeVisible()
  // 판정·Gap 목록·역할 개수·보기 전환은 그래프 필터에서 뺐다(판정은 매트릭스, 색 기준은 강조 필터가 맡는다).
  for (const removed of ["Verdict", "Gap", "Role · policy", "View options", "고급", "경로 후보 표시", "인증·화면·반복 보조 흐름 표시", "그래프 입력 방식"]) expect(within(rail).queryByText(removed)).not.toBeInTheDocument()
  expect(screen.getAllByText("TARGET")).toHaveLength(1)
  expect(screen.getAllByText("API GROUP")).toHaveLength(1)
  expect(screen.queryByText("OBJECT")).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "접근 그래프 작업면" })).toContainElement(screen.getByTestId("cytoscape-graph"))
  expect(screen.queryByText("ACCESS GRAPH")).not.toBeInTheDocument()
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
  await userEvent.click(screen.getByRole("button", { name: "목록" }))
  expect(screen.queryByTestId("cytoscape-graph")).not.toBeInTheDocument()
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  expect(screen.getByRole("row", { name: /^GET \/orders\/\{id\}/ })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: /^order 객체 1개 펼치기/ }))
  await userEvent.click(screen.getByRole("row", { name: "order:1" }))
  await userEvent.click(screen.getByRole("button", { name: "그래프" }))
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
  act(() => { media.matches = true; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.queryByTestId("cytoscape-graph")).not.toBeInTheDocument()
  const compactInspector = screen.getByRole("dialog", { name: "선택 상세" })
  await userEvent.click(within(compactInspector).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument())
  // 목록이 다시 그려지면 객체 목록은 접힌 상태로 돌아온다.
  expect(screen.getByRole("button", { name: /^order 객체 1개 펼치기/ })).toBeVisible()
  act(() => { media.matches = false; listeners.forEach((listener) => listener(new Event("change"))) })
  expect(screen.getByTestId("cytoscape-graph")).toBeVisible()
}, 15_000)

it.each([900, 600])("owns compact inspector state independently, opens it on selection, and clears selection on close at %ipx", async (width) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") ? width < 1280 : width <= 900, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await userEvent.click(inspectorTrigger)
  const emptyInspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(emptyInspector).toHaveTextContent("현재 보기")
  await userEvent.click(within(emptyInspector).getByRole("button", { name: "Close" }))
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  // 좁은 화면에서는 선택하면 상세 대화상자가 열리므로, 객체 목록을 먼저 펼친 뒤 객체를 고른다.
  await userEvent.click(screen.getByRole("button", { name: /^order 객체 1개 펼치기/ }))
  await userEvent.click(screen.getByRole("row", { name: "order:1" }))
  const inspector = screen.getByRole("dialog", { name: "선택 상세" })
  expect(inspector).toBeVisible()
  expect(screen.queryByRole("button", { name: "축소" })).not.toBeInTheDocument()

  await userEvent.click(within(inspector).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument())
  expect(inspectorTrigger).toHaveFocus()
  await userEvent.click(inspectorTrigger)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("현재 보기")
})

it.each([900, 600])("opens the shared graph filters and keeps every meaningful toggle operable at %ipx", async (width) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") ? width < 1280 : width <= 900, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  await userEvent.click(screen.getByRole("button", { name: "그래프 필터" }))
  const filters = screen.getByRole("dialog", { name: "분석 필터" })
  // 강조 필터는 아무것도 고르지 않은 상태로 시작하고, 고른 조건만 강조한다(데이터를 숨기지 않는다).
  const scanner = within(filters).getByRole("checkbox", { name: /스캐너\s*0/ })
  const identity = within(filters).getByRole("checkbox", { name: /alice\s*1/ })
  const success = within(filters).getByRole("checkbox", { name: /2xx\s*1/ })
  const redirect = within(filters).getByRole("checkbox", { name: /3xx\s*0/ })
  const reset = within(filters).getByRole("button", { name: "초기화" })
  expect(scanner).not.toBeChecked()
  // 맨 아래 "초기화" 하나가 필터·펼친 묶음·배치를 모두 되돌리며, 항상 누를 수 있다.
  expect(within(filters).getAllByRole("button", { name: "초기화" })).toHaveLength(1)
  expect(reset).toBeEnabled()
  expect(redirect).toBeDisabled()
  await userEvent.click(scanner)
  await userEvent.click(identity)
  await userEvent.click(within(filters).getByRole("button", { name: "2xx 펼치기" }))
  await userEvent.click(within(filters).getByRole("checkbox", { name: /^200\s*1/ }))
  expect(scanner).toBeChecked()
  expect(identity).toBeChecked()
  expect(success).toBeChecked()
  await userEvent.click(reset)
  expect(scanner).not.toBeChecked()
  expect(identity).not.toBeChecked()
  expect(success).not.toBeChecked()
})

it("applies highlight filters on Site Overview and retains them inside an API group", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  render(<CurrentGraphPage />)
  const filters = screen.getByRole("complementary", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: /사람\s*1/ }))
  expect(screen.getByTestId("cytoscape-graph")).toHaveAttribute("data-highlight", "on")
  await userEvent.click(screen.getByRole("button", { name: "목록" }))
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  await userEvent.click(screen.getByRole("button", { name: "그래프" }))
  expect(screen.getByTestId("cytoscape-graph")).toHaveAttribute("data-highlight", "on")
})

it("dims unmatched Site Overview list cards and restores them when the filter is cleared", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = { ...snapshot, cells: [...snapshot.cells, { ...hierarchyCell, op: "GET /api/products/list", idn: "bob", perSource: { scanner: "allow" } }] }
  render(<CurrentGraphPage />)
  await userEvent.click(screen.getByRole("button", { name: "목록" }))
  const list = screen.getByRole("region", { name: "공격면 API 목록" })
  const orders = within(list).getByRole("button", { name: /ORDERS APIs/ })
  const products = within(list).getByRole("button", { name: /PRODUCTS APIs/ })
  const filters = screen.getByRole("complementary", { name: "분석 필터" })
  await userEvent.click(within(filters).getByRole("checkbox", { name: /사람\s*1/ }))
  expect(orders).not.toHaveClass("opacity-30")
  expect(products).toHaveClass("opacity-30")
  expect(products).toBeEnabled()
  await userEvent.click(within(filters).getByRole("checkbox", { name: /사람\s*1/ }))
  expect(products).not.toHaveClass("opacity-30")
  await userEvent.click(within(filters).getByRole("checkbox", { name: /LLM\s*0/ }))
  expect(orders).toHaveClass("opacity-30")
  expect(products).toHaveClass("opacity-30")
  await userEvent.click(within(filters).getByRole("button", { name: "초기화" }))
  expect(orders).not.toHaveClass("opacity-30")
  expect(products).not.toHaveClass("opacity-30")
})

it("moves back and forward through graph levels from the toolbar", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  render(<CurrentGraphPage />)
  const breadcrumb = screen.getByRole("navigation", { name: "그래프 계층" })
  const toolbar = screen.getByRole("toolbar", { name: "그래프 상단 제어" })
  const back = within(toolbar).getByRole("button", { name: "뒤로" }), forward = within(toolbar).getByRole("button", { name: "앞으로" })
  expect(back).toBeDisabled()
  expect(forward).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: "목록" }))
  await userEvent.click(within(screen.getByRole("region", { name: "공격면 API 목록" })).getByRole("button", { name: /ORDERS APIs/ }))
  expect(within(breadcrumb).getByText("ORDERS APIs")).toHaveAttribute("aria-current", "page")
  await userEvent.click(back)
  expect(within(breadcrumb).getByText("Site Overview")).toHaveAttribute("aria-current", "page")
  expect(forward).toBeEnabled()
  await userEvent.click(forward)
  expect(within(breadcrumb).getByText("ORDERS APIs")).toHaveAttribute("aria-current", "page")
  expect(forward).toBeDisabled()
})

it("uses exact HUMAN, SCANNER, and LLM source semantics in the canvas legend", async () => {
  const media = { matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
  ;(globalThis as { graphFixture?: Snapshot }).graphFixture = snapshot
  const { RelationshipGraphView: GraphPage } = await import("./RelationshipGraphView")
  render(<GraphPage />)

  const legend = screen.getByRole("list", { name: "그래프 소스 범례" })
  expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["사람", "스캐너", "LLM"])
})
