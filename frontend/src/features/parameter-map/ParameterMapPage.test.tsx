import { QueryClientProvider } from "@tanstack/react-query"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { renderWithQueryClient } from "@/test/render"
import { actualEvent, declaration, demoEndpoint, parameterGap, parameterSnapshot, statusParameter, surfaceSnapshot, validationCell } from "./parameterMapFixtures"
import { ParameterMapPage } from "./ParameterMapPage"

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown> }))
vi.mock("@/lib/query/hooks", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/query/hooks")>(), useSnapshotQuery: () => state.query }))
// Canvas is external to jsdom; the graph's real accessible fallback stays under test.
vi.mock("cytoscape", () => ({ default: () => { throw new Error("no canvas") } }))

// rerender must keep the QueryClientProvider: Evidence detail and Request Lab use query hooks.
const render = () => {
  const result = renderWithQueryClient(<ParameterMapPage />)
  return { ...result, rerender: () => result.rerender(<QueryClientProvider client={result.client}><ParameterMapPage /></QueryClientProvider>) }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  state.query = { data: parameterSnapshot(), isLoading: false, isError: false, dataUpdatedAt: 123456, refetch: vi.fn() }
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 })
})
afterEach(() => vi.unstubAllGlobals())

it("starts graph-first with only open risk paths, compact filters and the server-priority queue", () => {
  render()
  expect(screen.getByRole("heading", { name: "권한·파라미터 Gap 그래프" })).toBeVisible()
  expect(screen.getByRole("region", { name: "그래프 중심 점검 작업면" })).toHaveAttribute("data-layout", "focused-graph")
  expect(within(screen.getByRole("toolbar", { name: "Gap 그래프 필터" })).getByRole("checkbox", { name: "위험 Gap" })).toBeChecked()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  const queue = screen.getByRole("list", { name: "점검 우선순위 큐" })
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["auth", "source"])
  expect(within(queue).getAllByRole("button")[0]).toHaveTextContent("PATCH /orders/{id}")
  expect(within(queue).getAllByRole("button")[0]).toHaveTextContent("JSON /status")
  expect(screen.getByRole("region", { name: "우선 점검 이유" })).toHaveTextContent("타인 소유 값이 아직 검증되지 않았습니다")
  expect(screen.queryByText("closed")).not.toBeInTheDocument()
  expect(screen.queryByText("no-risk")).not.toBeInTheDocument()
})

it("collapses the queue and its GAP context while keeping the graph available", async () => {
  render()
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 접기" }))

  expect(screen.queryByRole("heading", { name: "권한·파라미터 Gap 그래프" })).not.toBeInTheDocument()
  expect(screen.queryByRole("toolbar", { name: "Gap 그래프 필터" })).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "우선 점검 이유" })).not.toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Gap 경로 목록" })).toBeVisible()
})

it("shows the top three projected priorities until expansion without changing their server order", async () => {
  const data = parameterSnapshot()
  data.surface!.parameterGaps = Array.from({ length: 5 }, (_, index) => parameterGap(`priority-${index}`, { summary: `priority ${index}` })) as never
  const original = JSON.stringify(data)
  state.query = { ...state.query, data }
  render()
  const queue = screen.getByRole("list", { name: "점검 우선순위 큐" })
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["priority-0", "priority-1", "priority-2"])
  await userEvent.click(screen.getByRole("button", { name: "전체 5개 보기" }))
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["priority-0", "priority-1", "priority-2", "priority-3", "priority-4"])
  expect(JSON.stringify(data)).toBe(original)
})

it("keeps no-match controls reachable and reveals unprioritized open gaps without changing server state", async () => {
  const data = surfaceSnapshot({ endpoints: [demoEndpoint()], gaps: [parameterGap("ordinary", { priorityReasons: [], summary: "추가 관측 확인" })] })
  const original = JSON.stringify(data)
  state.query = { ...state.query, data }
  render()
  expect(screen.getByText(/현재 조건에 맞는 열린 위험 Gap이 없습니다/)).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "필터 더보기" }))
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "놓친 주체" }), "SCANNER")
  await userEvent.click(screen.getByRole("button", { name: "다른 열린 Gap 보기" }))
  expect(screen.getByRole("checkbox", { name: "위험 Gap" })).not.toBeChecked()
  expect(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getByRole("button")).toHaveAttribute("data-gap-id", "ordinary")
  expect(JSON.stringify(data)).toBe(original)
})

it("opens the canonical inspector from queue or graph, preserving reasons and actual/basis counts", async () => {
  render()
  const queue = screen.getByRole("list", { name: "점검 우선순위 큐" })
  await userEvent.click(within(queue).getAllByRole("button")[0])
  const detail = screen.getByRole("region", { name: "Parameter Gap 상세" })
  expect(detail).toHaveAttribute("data-gap-id", "auth")
  expect(detail).toHaveTextContent("https://demo.test:443")
  expect(detail).toHaveTextContent("Canonical key: JSON_BODY /status")
  expect(within(detail).getByRole("list", { name: "서버 우선순위 근거" }).textContent).toMatch(/쓰기 메서드.*확인된 권한 경계/)
  expect(detail).toHaveTextContent("Gap 근거 31건")
  expect(within(detail).getByRole("region", { name: "입력과 권한 대상" })).toHaveTextContent("orders:101 · OBSERVED")
  expect(within(detail).getByRole("region", { name: "관측 프로파일" })).toHaveTextContent("관측 40건")
  await userEvent.click(within(detail).getByRole("button", { name: /검증표 펼치기/ }))
  await userEvent.click(within(detail).getByRole("button", { name: "UNTESTED · 미검증 상세 보기" }))
  expect(detail).toHaveTextContent("실행 Evidence 0건")
  expect(detail).toHaveTextContent("선택 셀 근거 · 미실행 포함 50건")
  expect(detail).toHaveTextContent("UNTESTED")
  expect(detail).toHaveTextContent("basis-a")
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 닫기" }))
  expect(screen.queryByRole("region", { name: "Parameter Gap 상세" })).not.toBeInTheDocument()
  const graph = screen.getByRole("list", { name: "Gap 경로 목록" })
  const node = within(graph).getAllByRole("button").find(button => button.getAttribute("data-gap-id") === "source")!
  node.focus()
  await userEvent.keyboard("{Enter}")
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "source")
})

it("links only actual events of the exact operation and opens Evidence detail and Request Lab from them", async () => {
  const data = parameterSnapshot()
  data.events = [actualEvent(), actualEvent({ eventId: "witness-a", op: "https://demo.test:443 GET /other" })]
  state.query = { ...state.query, data }
  render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("연결된 실제 EventRecord 1건")
  expect(screen.getByText(/파라미터 관측 · 선택 셀의 실행 근거 아님/)).toBeVisible()
  expect(screen.getByRole("button", { name: "Request Lab 열기" })).toBeEnabled()
  expect(screen.getByText(/대표 실제 Evidence: actual-a/)).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "Evidence 상세 actual-a" }))
  expect(await screen.findByRole("region", { name: "Evidence 상세" })).toHaveTextContent("actual-a")
})

it("compares two linked actual requests through the Evidence API metadata in the diff tab", async () => {
  const data = parameterSnapshot()
  const parameter = statusParameter({
    observationEvidenceIds: ["actual-a", "actual-b"],
    observations: [
      { evidenceId: "actual-a", source: "HUMAN", runId: "run", identity: "USER A", status: 200, shape: "STRING", presence: "PRESENT", valueType: "STRING", byteLength: 5, contextSignature: "ctx:v1:sha256:aa", confidence: "OBSERVED" },
      { evidenceId: "actual-b", source: "SCANNER", runId: "run", identity: "USER B", status: 403, shape: "NULL", presence: "EXPLICIT_NULL", valueType: "UNKNOWN", byteLength: 0, contextSignature: "ctx:v1:sha256:bb", confidence: "OBSERVED" },
    ],
  })
  const key = { service: demoEndpoint().key.service, method: "PATCH", operation: actualEvent().op, location: "JSON_BODY", canonicalPath: "/status", stableKey: "pk:v1:status" }
  const record = (eventId: string, status: number, observation: Record<string, unknown>) => ({ eventId, request: "LEGACY-REQUEST", response: "LEGACY-RESPONSE", parameterContext: { service: key.service, method: "PATCH", operation: key.operation, identity: eventId, role: "USER", source: "HUMAN", status, complete: true, retention: "RETAINED" }, parameterObservations: [{ key, confidence: "OBSERVED", occurrenceCount: null, contextSignature: null, digest: null, ...observation }] })
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ records: [record("actual-a", 200, { presence: "PRESENT", shape: "SCALAR", valueType: "STRING", byteLength: 5 }), record("actual-b", 403, { presence: "EXPLICIT_NULL", shape: "NULL", valueType: "UNKNOWN", byteLength: 0 })], total: 2, offset: 0, limit: 20, hasMore: false }), { headers: { "Content-Type": "application/json" } }))))
  data.surface!.endpoints = [demoEndpoint([parameter], { requestContexts: [{ evidenceId: "actual-a", complete: true, retained: true, discovery: true, contextSignature: "ctx:v1:sha256:aa" }, { evidenceId: "actual-b", complete: true, retained: true, discovery: true, contextSignature: "ctx:v1:sha256:bb" }] })] as never
  data.events = [actualEvent(), actualEvent({ eventId: "actual-b", idn: "USER B", source: "scanner", status: 403, verdict: "deny" })]
  state.query = { ...state.query, data }
  render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  expect(await screen.findByText(/선택 입력 연결 2건/)).toBeVisible()
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "기준 요청" }), "actual-a")
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "비교 요청" }), "actual-b")
  const table = screen.getByRole("region", { name: "요청 비교 표" })
  expect(within(table).getByRole("columnheader", { name: "기준 요청 actual-a" })).toBeVisible()
  expect(table).toHaveTextContent("STATUS_CHANGED VERDICT_CHANGED")
  expect(table).toHaveTextContent("PRESENCE_CHANGED · SHAPE_CHANGED · TYPE_CHANGED · UNKNOWN")
  expect(table).toHaveTextContent("길이: 5 bytes")
  expect(table).not.toHaveTextContent("READY")
  expect(document.body.textContent).not.toContain("LEGACY-")
})

it("filters only display state and clears a stale selected Gap on refresh", async () => {
  const { rerender } = render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  const updated = parameterSnapshot()
  updated.surface!.parameterGaps = [parameterGap("auth", { summary: "새 서버 설명", evidenceCount: 99, evidenceIds: ["new-witness"] })] as never
  state.query = { ...state.query, data: updated }
  rerender()
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveTextContent("새 서버 설명")
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveTextContent("Gap 근거 99건")
  await userEvent.click(screen.getByRole("button", { name: "필터 더보기" }))
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "놓친 주체" }), "LLM")
  expect(screen.queryByRole("region", { name: "Parameter Gap 상세" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "필터 초기화" }))
  expect(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")).toHaveLength(1)
})

it("toggles the advanced disclosure while preserving its filter values and isolating every gap type", async () => {
  const types = ["DEFINED_NOT_OBSERVED", "SOURCE_MISSED", "IDENTITY_MISSED", "AUTH_VARIANT_UNTESTED", "CONDITION_COMBINATION_UNOBSERVED", "TYPE_VARIANT_UNOBSERVED"] as const
  const data = parameterSnapshot()
  data.surface!.parameterGaps = types.map(type => parameterGap(type, { type })) as never
  state.query = { ...state.query, data }
  render()
  const advancedButton = screen.getByRole("button", { name: "필터 더보기" })
  expect(advancedButton).toHaveAttribute("aria-expanded", "false")
  expect(advancedButton).toHaveAttribute("aria-controls", "parameter-advanced-filters")
  await userEvent.click(advancedButton)
  for (const type of types) {
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Gap 종류" }), type)
    expect(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual([type])
  }
  const applied = screen.getByRole("button", { name: "필터 더보기 · 1개 적용" })
  await userEvent.click(applied)
  expect(screen.queryByRole("combobox", { name: "Gap 종류" })).not.toBeInTheDocument()
  await userEvent.click(applied)
  expect(screen.getByRole("combobox", { name: "Gap 종류" })).toHaveValue("TYPE_VARIANT_UNOBSERVED")
  expect(screen.getByRole("checkbox", { name: "권한 검증" })).not.toBeChecked()
  expect(screen.getByRole("checkbox", { name: "발견 범위" })).toBeChecked()
})

it("keeps the queue persistent at 1280px and selects the identical Gap into an inspector sheet", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query === "(max-width: 1439px)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  render()
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toBeVisible()
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("region", { name: "Parameter Gap 상세" })).not.toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
})

it("uses the compact queue sheet and opens the same inspector from a narrow path list", async () => {
  window.matchMedia = vi.fn((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 })
  render()
  expect(screen.queryByRole("complementary", { name: "점검 우선순위" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 열기" }))
  const filters = screen.getByRole("dialog", { name: "점검 우선순위" })
  await userEvent.click(within(filters).getByRole("button", { name: "Close" }))
  await userEvent.click(within(screen.getByRole("list", { name: "Gap 경로 목록" })).getAllByRole("button")[0])
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("Gap 근거 31건")
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
})

it("distinguishes initial errors and preserves a selected refresh-error inspector with actions suspended", async () => {
  state.query = { ...state.query, data: undefined, isPending: true }
  const { rerender } = render()
  expect(screen.getByRole("status")).toHaveTextContent("불러오는 중")
  state.query = { ...state.query, isPending: false, isError: true, error: new Error("offline"), dataUpdatedAt: 0 }
  rerender()
  expect(screen.getByRole("alert")).toHaveTextContent("offline")
  expect(screen.getAllByRole("button")).toHaveLength(1)
  state.query = { data: parameterSnapshot(), isError: false, dataUpdatedAt: 123456, refetch: vi.fn() }
  rerender()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  state.query = { ...state.query, isError: true, error: new Error("refresh failed") }
  rerender()
  expect(screen.getByRole("alert")).toHaveTextContent("refresh failed")
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  expect(screen.getByRole("button", { name: "Evidence 상세 actual-a" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Request Lab 열기" })).toBeDisabled()
})

it.each(["empty", "definitions", "diagnostic"])("gives one next action for %s without fabricated results", (kind) => {
  const data = kind === "definitions"
    ? surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ observationEvidenceIds: [], observations: [], declarations: [declaration()], profile: undefined })])] })
    : kind === "diagnostic" ? surfaceSnapshot({ diagnostics: [{ evidenceId: "ev", operation: "PATCH /orders/{id}", reasonCode: "INPUT_LIMIT", droppedCount: 7 }] }) : surfaceSnapshot()
  state.query = { ...state.query, data }
  render()
  const statePanel = screen.getByRole("status", { name: "" })
  expect(within(statePanel).getAllByRole("button")).toHaveLength(1)
  expect(screen.queryByRole("list", { name: "점검 우선순위 큐" })).not.toBeInTheDocument()
  expect(statePanel).not.toHaveTextContent(/%|취약점 확정/)
  if (kind === "diagnostic") expect(statePanel).toHaveTextContent("INPUT_LIMIT (7)")
  if (kind === "definitions") expect(statePanel).toHaveTextContent("아직 요청으로 관측되지 않음")
})

it("explains an empty graph as run-less traffic and offers to start a HUMAN pass when the server reports it", () => {
  const base = surfaceSnapshot()
  state.query = { ...state.query, data: { ...base, trafficStats: { ...base.trafficStats, humanApiOutsideRun: 4 } } }
  render()
  const statePanel = screen.getByRole("status", { name: "" })
  expect(within(statePanel).getByRole("status", { name: "run 밖 API 트래픽 안내" })).toHaveTextContent("인증된 API 요청 4건")
  expect(within(statePanel).getByRole("button", { name: "점검에서 HUMAN 탐색 시작" })).toBeVisible()
  expect(statePanel).not.toHaveTextContent("범위를 확인하고 HUMAN Evidence를 수집하세요")
})

it("keeps the definitions-only message instead of replacing it with the run-gap hint", () => {
  const base = surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ observationEvidenceIds: [], observations: [], declarations: [declaration()], profile: undefined })])] })
  state.query = { ...state.query, data: { ...base, trafficStats: { ...base.trafficStats, humanApiOutsideRun: 3 } } }
  render()
  const statePanel = screen.getByRole("status", { name: "" })
  expect(statePanel).toHaveTextContent("아직 요청으로 관측되지 않음")
  expect(within(statePanel).queryByRole("status", { name: "run 밖 API 트래픽 안내" })).not.toBeInTheDocument()
})

it("identifies each validation row by its own identity and role, including unknown values", async () => {
  const data = parameterSnapshot()
  data.surface!.validationCells = [validationCell({ identity: "alice", role: "USER" }), validationCell({ identity: "bob", role: "ADMIN" }), validationCell({ identity: null, role: "UNKNOWN" })] as never
  state.query = { ...state.query, data }
  render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  const rows = screen.getByRole("region", { name: "선택 입력 검증 근거" })
  for (const [identity, role] of [["alice", "USER"], ["bob", "ADMIN"], ["UNKNOWN", "UNKNOWN"]]) {
    const row = within(rows).getByRole("group", { name: `검증 좌표 ${identity} / ${role} / SCANNER / OTHER_OWNER / https://demo.test:443 orders:101` })
    expect(within(row).getByRole("button", { name: "UNTESTED · 미검증 상세 보기" })).toBeVisible()
    expect(row).not.toHaveTextContent("실행 Evidence")
    expect(row).not.toHaveTextContent("좌표 근거")
  }
})

it.each(["UNKNOWN", "INFERRED"])("explains %s on keyboard focus without hiding visible state", async (stateName) => {
  render()
  const help = screen.getByRole("button", { name: `${stateName} 도움말` })
  expect(help).toHaveTextContent(stateName)
  help.focus()
  expect(await screen.findByRole("tooltip")).toHaveTextContent(/Gap을 선택해 정의와 Evidence를 확인/)
})
