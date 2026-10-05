import { QueryClientProvider } from "@tanstack/react-query"
import { act, screen, within } from "@testing-library/react"
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
  expect(screen.getByRole("heading", { name: "권한·파라미터 Gap 그래프" })).toHaveClass("sr-only")
  expect(screen.getByRole("region", { name: "그래프 중심 점검 작업면" })).toHaveAttribute("data-layout", "focused-graph")
  expect(within(screen.getByRole("toolbar", { name: "Gap 그래프 필터" })).getByRole("checkbox", { name: "위험 Gap" })).toBeChecked()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(screen.getAllByRole("combobox").map(box => box.getAttribute("aria-label"))).toEqual(["정렬"])
  const queue = screen.getByRole("list", { name: "점검 우선순위 큐" })
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["auth", "source"])
  expect(within(queue).getAllByRole("button")[0]).toHaveTextContent("PATCH /orders/{id}")
  expect(within(queue).getAllByRole("button")[0]).toHaveTextContent("JSON /status")
  expect(screen.queryByText("closed")).not.toBeInTheDocument()
  expect(screen.queryByText("no-risk")).not.toBeInTheDocument()
})

it("collapses the queue and its GAP context while keeping the graph available", async () => {
  render()
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 접기" }))

  expect(screen.getByRole("heading", { name: "권한·파라미터 Gap 그래프" })).toHaveClass("sr-only")
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
  expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent("PATCH /orders/{id}")
  expect(within(detail).getByRole("region", { name: "관측 기록" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 닫기" }))
  expect(screen.queryByRole("region", { name: "Parameter Gap 상세" })).not.toBeInTheDocument()
  const graph = screen.getByRole("list", { name: "Gap 경로 목록" })
  const node = within(graph).getAllByRole("button").find(button => button.getAttribute("data-gap-id") === "source")!
  node.focus()
  await userEvent.keyboard("{Enter}")
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "source")
})

it("links only actual events of the exact operation and offers raw view from them", async () => {
  const data = parameterSnapshot()
  data.events = [actualEvent(), actualEvent({ eventId: "witness-a", op: "https://demo.test:443 GET /other" })]
  state.query = { ...state.query, data }
  render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  const rows = within(screen.getByRole("region", { name: "관측 기록" })).getAllByRole("listitem")
  // 관측 기록은 신원별 카드로 묶인다. 다른 operation의 witness-a는 목록에 없다.
  expect(rows.map(row => row.getAttribute("aria-label"))).toEqual(["USER A 관측 기록 1건"])
  expect(within(rows[0]).getByRole("button", { name: "원문 보기" })).toBeEnabled()
})

it("filters only display state and clears a stale selected Gap on refresh", async () => {
  const { rerender } = render()
  await userEvent.click(within(screen.getByRole("list", { name: "점검 우선순위 큐" })).getAllByRole("button")[0])
  const updated = parameterSnapshot()
  updated.surface!.parameterGaps = [parameterGap("auth", { summary: "새 서버 설명", evidenceCount: 99, evidenceIds: ["new-witness"] })] as never
  state.query = { ...state.query, data: updated }
  rerender()
  expect(screen.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
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
  expect(within(screen.getByRole("region", { name: "Parameter Gap 상세" })).getByRole("heading", { level: 2 })).toHaveTextContent("PATCH /orders/{id}")
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
  expect(screen.getByRole("button", { name: "원문 보기" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "현재 세션으로 Repeater" })).toBeDisabled()
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
  expect(within(statePanel).getByRole("button", { name: "계정·세션에서 브라우저 열기" })).toBeVisible()
  expect(statePanel).not.toHaveTextContent("범위를 확인하고 HUMAN 관측 기록을 수집하세요")
})

it("keeps the definitions-only message instead of replacing it with the run-gap hint", () => {
  const base = surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ observationEvidenceIds: [], observations: [], declarations: [declaration()], profile: undefined })])] })
  state.query = { ...state.query, data: { ...base, trafficStats: { ...base.trafficStats, humanApiOutsideRun: 3 } } }
  render()
  const statePanel = screen.getByRole("status", { name: "" })
  expect(statePanel).toHaveTextContent("아직 요청으로 관측되지 않음")
  expect(within(statePanel).queryByRole("status", { name: "run 밖 API 트래픽 안내" })).not.toBeInTheDocument()
})

it.each([["UNKNOWN", "근거 부족으로 아직 알 수 없음"], ["INFERRED", "추론 (미관측)"]])("explains %s in the help popover opened by keyboard focus", async (stateName, meaning) => {
  render()
  act(() => { screen.getByRole("button", { name: "범례·도움말" }).focus() })
  const term = await screen.findByText(stateName, { selector: "dt" })
  expect(term.nextElementSibling).toHaveTextContent(meaning)
})
