import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import { parameterSnapshot } from "@/features/parameter-map/parameterMapFixtures"
import type { Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { matrixCellKey, operationDisplay } from "./matrixProjection"
import { LegacyMatrixView, MatrixPage, ParameterMatrixView } from "./MatrixPage"

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

let current: Snapshot | undefined
let queryError = false
let queryStale = false
const lastUpdated = Date.parse("2026-09-08T07:00:00Z")
const refetch = vi.fn()
beforeEach(() => { queryError = false; queryStale = false; refetch.mockClear() })

vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: current, isLoading: current === undefined && !queryError, isError: queryError, error: new Error("snapshot unavailable"), isStale: queryStale, dataUpdatedAt: current ? lastUpdated : 0, refetch }),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

function regexLiteral(value: string) { return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }

function renderPage(ui: ReactElement) {
  const result = renderWithQueryClient(ui)
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={result.client}>{next}</QueryClientProvider>) }
}

function expectCompleteValuesAbsent(container: HTMLElement, values: readonly string[]) {
  for (const value of values) {
    expect(container.textContent).not.toContain(value)
    for (const button of within(container).queryAllByRole("button")) {
      expect(button).not.toHaveAccessibleName(regexLiteral(value))
      expect(button).not.toHaveAccessibleDescription(regexLiteral(value))
    }
    for (const element of Array.from(container.querySelectorAll("[title], [aria-label], [aria-description], [aria-live]"))) {
      expect(element.getAttribute("title") ?? "").not.toContain(value)
      expect(element.getAttribute("aria-label") ?? "").not.toContain(value)
      expect(element.getAttribute("aria-description") ?? "").not.toContain(value)
      if (element.hasAttribute("aria-live")) expect(element.textContent).not.toContain(value)
    }
  }
}

function matrixSnapshot(): Snapshot {
  return {
    ...snapshotFixture,
    revision: 4,
    roles: { alice: "USER", bob: "USER", charlie: "ADMIN" },
    owners: { "order:1": "alice" },
    requiredRoles: { "GET /orders/{id}": "USER", "DELETE /orders/{id}": "ADMIN" },
    activeSources: ["human", "scanner", "llm"],
    events: [
      { eventId: "exact-human", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "h", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "h", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["exact-human"], objects: [], verdict: "allow" },
    ],
    cells: [
      { idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow", scanner: "deny", llm: "suspicious" }, reasons: { human: "<strong>server reason</strong>", scanner: "scanner reason", llm: "llm reason" }, overall: "allow", conflict: true, missedSources: ["llm"], evidenceIds: ["exact-human"] },
      { idn: "bob", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "deny" }, reasons: { human: "denied" }, overall: "deny", conflict: false, missedSources: [], evidenceIds: ["bob-evidence"] },
      { idn: "charlie", op: "DELETE /orders/{id}", resource: null, perSource: { scanner: "undecided" }, reasons: { scanner: "unknown-safe" }, overall: "undecided", conflict: false, missedSources: ["human", "llm"], evidenceIds: ["charlie-evidence"] },
    ],
    gaps: [{ id: "gap-1", type: "UNCROSSED", risk: 3, idn: "alice", op: "GET /orders/{id}", resource: "order:1", missedSources: ["llm"], summary: "server gap" }],
  }
}

it("removes only a leading HTTP origin from displayed operation labels", () => {
  expect(operationDisplay("https://demo.test:443 GET /orders/{id}")).toEqual({ method: "GET", path: "/orders/{id}" })
  expect(operationDisplay("PATCH /orders/{id}")).toEqual({ method: "PATCH", path: "/orders/{id}" })
  expect(operationDisplay("CUSTOM OPERATION")).toEqual({ method: "CUSTOM", path: "OPERATION" })
})

it("defaults to the judgment matrix and keeps the legacy cell matrix behind its own tab", async () => {
  current = { ...matrixSnapshot(), authorizationMatrix: { summary: { policyConfirmed: 0, policyReview: 0, bflaCandidates: 0, bolaIdorCandidates: 0, coverageGaps: 0, invalidExperiments: 0, bflaTestRecommendations: 0, bolaIdorTestRecommendations: 0, manualReviewPending: 0, humanConfirmed: 0, humanDismissed: 0 }, identities: [], functions: [], objects: [], evidence: [], policyLegend: [], evidenceLegend: [], ownershipLegend: [] } }
  renderPage(<MatrixPage />)
  expect(screen.getByRole("tab", { name: "판정 매트릭스" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("heading", { name: "판정 매트릭스" })).toBeVisible()
  expect(screen.queryByRole("region", { name: "권한 매트릭스 표" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("tab", { name: "기존 권한 매트릭스" }))
  expect(await screen.findByRole("region", { name: "권한 매트릭스 표" })).toBeVisible()
  expect(screen.getByRole("heading", { name: "권한 매트릭스" })).toBeVisible()
})

it("keeps parameter coverage and the legacy matrix behind their own tabs", async () => {
  current = parameterSnapshot()
  renderPage(<MatrixPage />)
  expect(screen.getByRole("tab", { name: "판정 매트릭스" })).toHaveAttribute("aria-selected", "true")
  await userEvent.click(screen.getByRole("tab", { name: "파라미터 커버리지" }))
  expect(await screen.findByRole("region", { name: "파라미터 커버리지 표" })).toBeVisible()
  expect(screen.getByRole("heading", { name: "파라미터 커버리지" })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "기존 권한 매트릭스" }))
  expect(await screen.findByRole("heading", { name: "권한 매트릭스" })).toBeVisible()
})

it("uses the shared parameter cell semantics and clears its 관측 기록 selection when the server cell disappears", async () => {
  current = parameterSnapshot()
  const { rerender } = renderPage(<ParameterMatrixView />)
  const matrix = screen.getByRole("region", { name: "파라미터 커버리지 표" })
  expect(matrix).not.toHaveTextContent("실행 관측 기록")
  expect(matrix).not.toHaveTextContent("좌표 근거")
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("/orders/{id}")
  expect(screen.getByRole("heading", { level: 2 })).not.toHaveTextContent("https://demo.test:443")
  const select = within(matrix).getByRole("button", { name: "UNTESTED · 미검증 상세 보기" })
  select.focus()
  await userEvent.keyboard("{Enter}")
  expect(screen.getByRole("dialog", { name: "관측 기록 상세" })).toBeVisible()
  expect(screen.getByRole("region", { name: "검증 좌표 상세" })).toHaveTextContent("실행 관측 기록: 0건")
  expect(screen.getByRole("region", { name: "검증 좌표 상세" })).toHaveTextContent("좌표 근거: 50건")
  expect(screen.queryByRole("button", { name: "Request Lab 열기" })).not.toBeInTheDocument()
  current = { ...current, revision: current.revision + 1, surface: { ...current.surface!, validationCells: [] } }
  rerender(<ParameterMatrixView />)
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "관측 기록 상세" })).not.toBeInTheDocument())
  current = parameterSnapshot()
  rerender(<ParameterMatrixView />)
  expect(screen.queryByRole("dialog", { name: "관측 기록 상세" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "UNTESTED · 미검증 상세 보기" }))
  expect(screen.getByRole("dialog", { name: "관측 기록 상세" })).toBeVisible()
})

it("shows only error and retry guidance for an initial parameter snapshot failure", async () => {
  current = undefined
  queryError = true
  renderPage(<ParameterMatrixView />)
  expect(screen.getByRole("alert")).toHaveTextContent("파라미터 커버리지를 불러오지 못했습니다.")
  expect(screen.queryByText("표시할 서버 파라미터 검증 좌표가 없습니다.")).not.toBeInTheDocument()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "파라미터 커버리지 표" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  expect(refetch).toHaveBeenCalledOnce()
})

it("retains parameter 관측 기록 detail while disabling actions after a refresh failure", async () => {
  current = parameterSnapshot()
  const { rerender } = renderPage(<ParameterMatrixView />)
  await userEvent.click(screen.getByRole("button", { name: "UNTESTED · 미검증 상세 보기" }))
  expect(screen.getByRole("dialog", { name: "관측 기록 상세" })).toBeVisible()
  queryError = true
  rerender(<ParameterMatrixView />)
  expect(screen.getByRole("dialog", { name: "관측 기록 상세" })).toBeVisible()
  const banner = screen.getByRole("alert")
  expect(banner).toHaveTextContent("마지막으로 불러온 데이터를 표시하고 있습니다.")
  expect(banner.querySelector("time")).toHaveAttribute("dateTime", new Date(lastUpdated).toISOString())
  expect(screen.getByRole("region", { name: "파라미터 커버리지 표" })).toBeVisible()
  for (const button of screen.getAllByRole("button", { name: /상세 보기$/ })) expect(button).toBeDisabled()
  rerender(<ParameterMatrixView />)
  expect(screen.getByRole("alert")).toBe(banner)
  await userEvent.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  expect(refetch).toHaveBeenCalledOnce()
  queryError = false
  rerender(<ParameterMatrixView />)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(screen.getByRole("dialog", { name: "관측 기록 상세" })).toBeVisible()
})

it("also retains failed legacy selection while disabling its 관측 기록 actions", async () => {
  current = matrixSnapshot()
  const { rerender } = renderPage(<LegacyMatrixView />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  queryError = true
  rerender(<LegacyMatrixView />)
  expect(screen.getByRole("alert")).toHaveTextContent("마지막으로 불러온 데이터를 표시하고 있습니다.")
  for (const button of screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })) expect(button).toBeDisabled()
  expect(screen.getByText("관측 기록 상세")).toBeVisible()
  expect(screen.getByLabelText("필수 역할")).toBeDisabled()
  queryError = false
  current = { ...snapshotFixture }
  rerender(<LegacyMatrixView />)
  await waitFor(() => expect(screen.queryByText("관측 기록 상세")).not.toBeInTheDocument())
  expect(screen.getByText("표시할 서버 권한 셀이 없습니다.")).toBeVisible()
})

it("projects server identity cells with requirement, owner, source text, miss, conflict, gap, and exact 관측 기록 selection", async () => {
  current = matrixSnapshot()
  renderPage(<LegacyMatrixView />)

  expect((await screen.findAllByText("/orders/{id}"))[0]).toBeVisible()
  const viewport = screen.getByRole("region", { name: "권한 매트릭스 표" })
  expect(viewport).toHaveAttribute("data-testid", "matrix-scroll-viewport")
  expect(viewport).toHaveClass("overflow-auto")
  expect(viewport.querySelector('[data-slot="table-container"]')).toHaveClass("overflow-visible")
  expect(screen.getByRole("columnheader", { name: /신원 \/ 역할/ })).toHaveClass("sticky", "top-0", "left-0", "z-40")
  expect(screen.getAllByRole("columnheader")[1]).toHaveClass("sticky", "top-0", "z-30")
  expect(screen.queryByText("필수 역할: USER")).not.toBeInTheDocument()
  expect(screen.queryByText("소유자: alice")).not.toBeInTheDocument()
  expect(screen.getAllByText("H · 탐지")[0]).toBeVisible()
  expect(screen.getAllByText("S · 탐지")[0]).toBeVisible()
  expect(screen.getAllByText("L · 탐지")[0]).toBeVisible()
  expect(screen.queryByText("서버 충돌")).not.toBeInTheDocument()
  expect(screen.queryByText("서버 갭")).not.toBeInTheDocument()
  expect(screen.queryByText("<strong>server reason</strong>")).not.toBeInTheDocument()
  expect(screen.queryByRole("strong")).not.toBeInTheDocument()

  const cell = screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0]
  expect(cell).not.toHaveAccessibleName(/exact-human/)
  await userEvent.click(cell)
  const detail = screen.getByRole("region", { name: "권한 셀 상세" })
  expect(detail).toHaveTextContent("필수 역할: USER")
  expect(detail).toHaveTextContent("소유자: alice")
  expect(detail).toHaveTextContent("충돌 · 갭")
  expect(detail).toHaveTextContent("<strong>server reason</strong>")
  expect((await screen.findAllByText(/exact-human/)).length).toBeGreaterThan(0)
  expect(document.querySelector("[aria-live='polite']")?.textContent ?? "").not.toContain("exact-human")
})

it("groups existing server cells by server role without inventing a role verdict, filters gaps only, and retains selection across the filter", async () => {
  current = matrixSnapshot()
  renderPage(<LegacyMatrixView />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole("tab", { name: "역할별" }))
  expect(screen.getByText("역할: USER")).toBeVisible()
  expect(screen.getByText("alice")).toBeVisible()
  expect(screen.getByText("bob")).toBeVisible()
  expect(screen.getByText(/전체 판정: allow/)).toBeVisible()
  expect(screen.getByText(/전체 판정: deny/)).toBeVisible()
  await user.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  await user.click(screen.getByRole("checkbox", { name: "갭만 표시" }))
  expect(screen.queryByText("bob-evidence")).not.toBeInTheDocument()
  expect(screen.getAllByText(/exact-human/)[0]).toBeVisible()
})

it("uses collision-safe null-aware coordinate keys and clears selected cell only after its server cell disappears", async () => {
  expect(matrixCellKey("identity", "a:b", "c", null)).not.toBe(matrixCellKey("identity", "a", "b:c", null))
  expect(matrixCellKey("identity", "alice", "GET /orders", null)).not.toBe(matrixCellKey("identity", "alice", "GET /orders", "null"))
  current = matrixSnapshot()
  const { rerender } = renderPage(<LegacyMatrixView />)
  await userEvent.click((await screen.findAllByRole("button", { name: "권한 셀 관측 기록 열기" }))[0])
  current = { ...matrixSnapshot(), revision: 5, cells: matrixSnapshot().cells.slice(1) }
  rerender(<LegacyMatrixView />)
  await waitFor(() => expect(screen.queryByText("관측 기록 상세")).not.toBeInTheDocument())
})

it("states loading and empty snapshot outcomes without issuing a page-local request", async () => {
  queryError = false
  current = undefined
  const { rerender } = renderPage(<LegacyMatrixView />)
  expect(screen.getByText("권한 매트릭스를 불러오는 중입니다.")).toBeVisible()
  current = { ...snapshotFixture }
  rerender(<LegacyMatrixView />)
  expect(await screen.findByText("표시할 서버 권한 셀이 없습니다.")).toBeVisible()
})

it("keeps matrix controls and the bounded server matrix inside one reference workspace", async () => {
  current = matrixSnapshot()
  renderPage(<LegacyMatrixView />)

  expect(await screen.findByRole("complementary", { name: "분석 필터" })).toBeVisible()
  expect(screen.getByRole("region", { name: "권한 매트릭스 분석 영역" })).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 패널 열기" }))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveClass("overflow-hidden")
  expect(screen.getByRole("checkbox", { name: "갭만 표시" })).toBeVisible()
  expect(screen.getByTestId("matrix-scroll-viewport")).toHaveClass("overflow-auto")
})

it("keeps a server-query error separate from a zero-cell snapshot", () => {
  queryError = true
  current = matrixSnapshot()
  renderPage(<LegacyMatrixView />)
  expect(screen.getByText("권한 매트릭스를 불러오지 못했습니다.")).toBeVisible()
  expect(screen.getByText("snapshot unavailable")).toBeVisible()
  queryError = false
})

it("keeps retained stale snapshot data usable and bounds escaped long server text", async () => {
  const longReason = `<img src=x onerror=alert(1)>${"r".repeat(220)}`
  const longOperation = `<script>${"o".repeat(220)}</script>`
  const value = matrixSnapshot()
  current = { ...value, requiredRoles: { [longOperation]: "USER" }, cells: [{ ...value.cells[0], op: longOperation, reasons: { ...value.cells[0].reasons, human: longReason } }] }
  queryStale = true
  renderPage(<LegacyMatrixView />)
  expect(screen.queryByText("이전 snapshot을 표시 중입니다.")).not.toBeInTheDocument()
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  expect(screen.queryByRole("script")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "작업 더 보기" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "작업 더 보기" }))
  expect(document.body.textContent).toContain(longOperation)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  expect(screen.getByText("관측 기록 상세")).toBeVisible()
  expect(screen.getAllByRole("button", { name: "선택 상세 더 보기" }).length).toBeGreaterThan(0)
  queryStale = false
})

it("keeps a matching long matrix 기록 번호 out of the entire Sheet until explicit expansion", async () => {
  const ids = Array.from({ length: 6 }, (_, index) => `<img-${index}>${"x".repeat(220)}`)
  const value = matrixSnapshot()
  current = {
    ...value,
    events: [{ ...value.events[0], eventId: ids[0], clusterEvidenceIds: [ids[0]] }],
    cells: [{ ...value.cells[0], evidenceIds: ids }],
  }
  renderPage(<LegacyMatrixView />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  const sheet = await screen.findByRole("complementary", { name: "선택 상세" })
  expect(await screen.findByRole("button", { name: "기록 번호 더 보기" })).toBeVisible()
  expectCompleteValuesAbsent(sheet, [ids[0]])
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "기록 번호 더 보기" }))
  expect(screen.getByRole("button", { name: "기록 번호 접기" })).toBeVisible()
  expect(sheet.textContent).toContain(ids[0])
  expect(document.body.textContent).toContain(ids[5])
  expect(screen.queryByRole("img-0")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "기록 번호 접기" }))
  expectCompleteValuesAbsent(sheet, [ids[0]])
})

it("bounds selected long matrix context until the operator explicitly expands escaped text", async () => {
  const longOperation = `<matrix-op>${"m".repeat(220)}</matrix-op>`
  const value = matrixSnapshot()
  current = { ...value, cells: [{ ...value.cells[0], op: longOperation }] }
  renderPage(<LegacyMatrixView />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  expect(document.body.textContent).not.toContain(longOperation)
  expect(await screen.findByRole("button", { name: "선택 상세 더 보기" })).toBeVisible()
  expect(screen.queryByRole("matrix-op")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 더 보기" }))
  expect(screen.getByRole("button", { name: "선택 상세 접기" })).toBeVisible()
  expect(document.body.textContent).toContain(longOperation)
})

it("bounds every selected matrix coordinate field until the operator expands escaped text", async () => {
  const longIdentity = `<matrix-identity>${"i".repeat(220)}</matrix-identity>`
  const longResource = `<matrix-resource>${"r".repeat(220)}</matrix-resource>`
  const value = matrixSnapshot()
  current = { ...value, cells: [{ ...value.cells[0], idn: longIdentity, resource: longResource }] }
  renderPage(<LegacyMatrixView />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  const detail = screen.getByText("매트릭스 선택 좌표").closest("section")
  expect(detail?.textContent).not.toContain(longIdentity)
  expect(detail?.textContent).not.toContain(longResource)
  expect(screen.queryByRole("matrix-identity")).not.toBeInTheDocument()
  expect(screen.queryByRole("matrix-resource")).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: "선택 상세 더 보기" }))
  expect(detail?.textContent).toContain(longIdentity)
  expect(detail?.textContent).toContain(longResource)
})

it.each([900, 600])("keeps matrix context and inspector journeys functional at compact %ipx", async (width) => {
  const previousMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") && width < 1280, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  current = matrixSnapshot()
  const user = userEvent.setup()
  renderPage(<LegacyMatrixView />)

  const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await user.click(contextTrigger)
  const context = screen.getByRole("dialog", { name: "분석 필터" })
  await user.click(within(context).getByRole("tab", { name: "역할별" }))
  expect(await screen.findByText("역할: USER")).toBeVisible()
  await user.click(within(context).getByRole("button", { name: "Close" }))
  expect(contextTrigger).toHaveFocus()

  await user.click(inspectorTrigger)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("분석 결과에서 항목을 선택하면")
  await user.click(within(screen.getByRole("dialog", { name: "선택 상세" })).getByRole("button", { name: "Close" }))
  expect(inspectorTrigger).toHaveFocus()
  await user.click(screen.getAllByRole("button", { name: "권한 셀 관측 기록 열기" })[0])
  const inspector = await screen.findByRole("dialog", { name: "선택 상세" })
  expect(within(inspector).getByText("매트릭스 선택 좌표")).toBeVisible()
  await user.click(within(inspector).getByRole("button", { name: "Close" }))
  expect(screen.queryByText("매트릭스 선택 좌표")).not.toBeInTheDocument()
  expect(inspectorTrigger).toHaveFocus()
  window.matchMedia = previousMatchMedia
})
