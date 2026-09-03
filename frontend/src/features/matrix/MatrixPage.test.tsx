import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { matrixCellKey } from "./matrixProjection"
import { MatrixPage } from "./MatrixPage"

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

let current: Snapshot | undefined
let queryError = false
let queryStale = false

vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: current, isLoading: current === undefined, isError: queryError, error: new Error("snapshot unavailable"), isStale: queryStale }),
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

it("projects server identity cells with requirement, owner, source text, miss, conflict, gap, and exact Evidence selection", async () => {
  current = matrixSnapshot()
  renderPage(<MatrixPage />)

  expect((await screen.findAllByText("/orders/{id}"))[0]).toBeVisible()
  const viewport = screen.getByRole("region", { name: "권한 매트릭스 표" })
  expect(viewport).toHaveAttribute("data-testid", "matrix-scroll-viewport")
  expect(viewport).toHaveClass("overflow-auto")
  expect(viewport.querySelector('[data-slot="table-container"]')).toHaveClass("overflow-visible")
  expect(screen.getByRole("columnheader", { name: /신원 \/ 역할/ })).toHaveClass("sticky", "top-0", "left-0", "z-40")
  expect(screen.getAllByRole("columnheader")[1]).toHaveClass("sticky", "top-0", "z-30")
  expect(screen.getByText("필수 역할: USER")).toBeVisible()
  expect(screen.getByText("소유자: alice")).toBeVisible()
  expect(screen.getByText("H · HUMAN · allow · 실선")).toHaveClass("border-solid")
  expect(screen.getByText("S · SCANNER · deny · 파선")).toHaveClass("border-dashed")
  expect(screen.getByText("L · LLM · suspicious · 점선 · 미관측/놓침")).toHaveClass("border-dotted")
  expect(screen.getByText("서버 충돌")).toBeVisible()
  expect(screen.getByText("서버 갭")).toBeVisible()
  expect(screen.getAllByText("<strong>server reason</strong>")[0]).toBeVisible()
  expect(screen.queryByRole("strong")).not.toBeInTheDocument()

  const cell = screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0]
  expect(cell).not.toHaveAccessibleName(/exact-human/)
  await userEvent.click(cell)
  expect((await screen.findAllByText(/exact-human/)).length).toBeGreaterThan(0)
  expect(document.querySelector("[aria-live='polite']")?.textContent ?? "").not.toContain("exact-human")
})

it("groups existing server cells by server role without inventing a role verdict, filters gaps only, and retains selection across the filter", async () => {
  current = matrixSnapshot()
  renderPage(<MatrixPage />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole("tab", { name: "역할별" }))
  expect(screen.getByText("역할: USER")).toBeVisible()
  expect(screen.getByText("alice")).toBeVisible()
  expect(screen.getByText("bob")).toBeVisible()
  expect(screen.getByText("전체 판정: allow")).toBeVisible()
  expect(screen.getByText("전체 판정: deny")).toBeVisible()
  await user.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
  await user.click(screen.getByRole("checkbox", { name: "갭만 표시" }))
  expect(screen.queryByText("bob-evidence")).not.toBeInTheDocument()
  expect(screen.getAllByText(/exact-human/)[0]).toBeVisible()
})

it("uses collision-safe null-aware coordinate keys and clears selected cell only after its server cell disappears", async () => {
  expect(matrixCellKey("identity", "a:b", "c", null)).not.toBe(matrixCellKey("identity", "a", "b:c", null))
  expect(matrixCellKey("identity", "alice", "GET /orders", null)).not.toBe(matrixCellKey("identity", "alice", "GET /orders", "null"))
  current = matrixSnapshot()
  const { rerender } = renderPage(<MatrixPage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "권한 셀 Evidence 열기" }))[0])
  current = { ...matrixSnapshot(), revision: 5, cells: matrixSnapshot().cells.slice(1) }
  rerender(<MatrixPage />)
  await waitFor(() => expect(screen.queryByText("Evidence 상세")).not.toBeInTheDocument())
})

it("states loading and empty snapshot outcomes without issuing a page-local request", async () => {
  queryError = false
  current = undefined
  const { rerender } = renderPage(<MatrixPage />)
  expect(screen.getByText("권한 매트릭스를 불러오는 중입니다.")).toBeVisible()
  current = { ...snapshotFixture }
  rerender(<MatrixPage />)
  expect(await screen.findByText("표시할 서버 권한 셀이 없습니다.")).toBeVisible()
})

it("keeps matrix controls and the bounded server matrix inside one reference workspace", async () => {
  current = matrixSnapshot()
  renderPage(<MatrixPage />)

  expect(await screen.findByRole("complementary", { name: "분석 필터" })).toBeVisible()
  expect(screen.getByRole("region", { name: "권한 매트릭스 분석 영역" })).toBeVisible()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  expect(screen.getByRole("checkbox", { name: "갭만 표시" })).toBeVisible()
  expect(screen.getByTestId("matrix-scroll-viewport")).toHaveClass("overflow-auto")
})

it("keeps a server-query error separate from a zero-cell snapshot", () => {
  queryError = true
  current = matrixSnapshot()
  renderPage(<MatrixPage />)
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
  renderPage(<MatrixPage />)
  expect(screen.queryByText("이전 snapshot을 표시 중입니다.")).not.toBeInTheDocument()
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  expect(screen.queryByRole("script")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "작업 더 보기" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "작업 더 보기" }))
  expect(document.body.textContent).toContain(longOperation)
  expect(screen.getAllByRole("button", { name: "사유 더 보기" }).length).toBeGreaterThan(0)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
  expect(screen.getByText("Evidence 상세")).toBeVisible()
  queryStale = false
})

it("keeps a matching long matrix Evidence ID out of the entire Sheet until explicit expansion", async () => {
  const ids = Array.from({ length: 6 }, (_, index) => `<img-${index}>${"x".repeat(220)}`)
  const value = matrixSnapshot()
  current = {
    ...value,
    events: [{ ...value.events[0], eventId: ids[0], clusterEvidenceIds: [ids[0]] }],
    cells: [{ ...value.cells[0], evidenceIds: ids }],
  }
  renderPage(<MatrixPage />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
  const sheet = await screen.findByRole("complementary", { name: "선택 상세" })
  expect(await screen.findByRole("button", { name: "Evidence ID 더 보기" })).toBeVisible()
  expectCompleteValuesAbsent(sheet, [ids[0]])
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Evidence ID 더 보기" }))
  expect(screen.getByRole("button", { name: "Evidence ID 접기" })).toBeVisible()
  expect(sheet.textContent).toContain(ids[0])
  expect(document.body.textContent).toContain(ids[5])
  expect(screen.queryByRole("img-0")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Evidence ID 접기" }))
  expectCompleteValuesAbsent(sheet, [ids[0]])
})

it("bounds selected long matrix context until the operator explicitly expands escaped text", async () => {
  const longOperation = `<matrix-op>${"m".repeat(220)}</matrix-op>`
  const value = matrixSnapshot()
  current = { ...value, cells: [{ ...value.cells[0], op: longOperation }] }
  renderPage(<MatrixPage />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
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
  renderPage(<MatrixPage />)
  await userEvent.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
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
  renderPage(<MatrixPage />)

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
  await user.click(screen.getAllByRole("button", { name: "권한 셀 Evidence 열기" })[0])
  const inspector = await screen.findByRole("dialog", { name: "선택 상세" })
  expect(within(inspector).getByText("매트릭스 선택 좌표")).toBeVisible()
  await user.click(within(inspector).getByRole("button", { name: "Close" }))
  expect(screen.queryByText("매트릭스 선택 좌표")).not.toBeInTheDocument()
  expect(inspectorTrigger).toHaveFocus()
  window.matchMedia = previousMatchMedia
})
