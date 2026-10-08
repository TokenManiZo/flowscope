import { act, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, expect, it, vi } from "vitest"
import type { Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { ScenariosPage } from "./ScenariosPage"

let currentSnapshot: Snapshot | undefined
let snapshotError = false
const post = vi.fn()
vi.mock("@/lib/api/client", () => ({ postForm: (...args: unknown[]) => post(...args) }))
vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: currentSnapshot, isLoading: currentSnapshot === undefined && !snapshotError, isError: snapshotError, error: new Error("snapshot unavailable") }),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

function event(eventId: string) {
  return { eventId, method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human" as const, op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "h", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [eventId], objects: [], verdict: "allow" as const }
}

function scenario(id: string, values: Partial<Snapshot["scenarios"][number]> = {}) {
  return { id, tag: "RULE", title: "규칙 후보", proposal: "서버 제안", evidence: "서버 근거", risk: "HIGH", evidenceIds: ["candidate-event"], reviewStatus: "UNRESOLVED" as const, reviewNote: "", ...values }
}

function snapshot(revision = 1, scenarios: Snapshot["scenarios"] = [scenario("rule-1")]): Snapshot {
  return { ...snapshotFixture, revision, events: [event("candidate-event"), event("validation-event"), event("control-event")], evidenceOrdinals: { "candidate-event": 1, "validation-event": 2, "control-event": 3 }, scenarios }
}


function renderPage() {
  const view = renderWithQueryClient(<ScenariosPage />)
  return { ...view, refresh: () => view.rerender(<QueryClientProvider client={view.client}><ScenariosPage /></QueryClientProvider>) }
}
beforeEach(() => {
  currentSnapshot = snapshot()
  snapshotError = false
  post.mockReset().mockResolvedValue({ success: true, message: "저장했습니다." })
})

it("shows current rule candidates directly without calling a Judge or generation endpoint", async () => {
  renderPage()
  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  expect(within(list).getByRole("button", { name: /규칙 후보/ })).toBeVisible()
  expect(screen.queryByRole("button", { name: /Judge|미리보기|시나리오 생성/ })).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

it("keeps restored LLM verdicts in a read-only archive, never in the current candidate list", async () => {
  currentSnapshot = { ...snapshot(), legacyLlm: { readOnly: true,
    assessments: [{ id: "old", type: "BOLA", verdict: "LIKELY", title: "옛 평가", reason: "<img src=x onerror=alert(1)>", evidenceIds: ["missing"], createdAt: "2025-01-01T00:00:00Z" }],
    validations: [{ candidateId: "rule-1", verdict: "CONFIRMED", reason: "옛 결과", originalEvidenceIds: ["candidate-event"], validationEvidenceIds: [], controlEvidenceIds: [], runId: "retired-run", decidedAt: "2025-01-02T00:00:00Z" }],
  } }
  renderPage()
  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  expect(within(list).queryByText(/옛 평가|CONFIRMED/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByText("과거 LLM 기록 · 읽기 전용 (2개)"))
  expect(screen.getByText("이전 프로젝트에서 가져온 읽기 전용 기록입니다.")).toBeVisible()
  expect(document.querySelector("img")).toBeNull()
  expect(screen.queryByRole("button", { name: "Judge 시작" })).not.toBeInTheDocument()
  // 지금 프로젝트에 없는 기록(missing)과 실행 ID는 보이지 않고, 남은 기록만 #번호로 보인다.
  expect(document.body).not.toHaveTextContent("missing")
  expect(document.body).not.toHaveTextContent("retired-run")
  expect(screen.getByText("요청 기록 1건")).toBeInTheDocument()
  expect(screen.getAllByText("요청 기록").length).toBeGreaterThan(0)
})

it("opens exact candidate 요청 기록 and clears selection when revision changes", async () => {
  const view = renderPage()
  await userEvent.click(screen.getByRole("button", { name: /규칙 후보/ }))
  await userEvent.click(screen.getByRole("button", { name: "요청 기록 #1 열기" }))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("요청 기록 1건#1")
  currentSnapshot = snapshot(2, [])
  view.refresh()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
})

it("keeps the open 요청 기록 when new traffic only bumps the revision", async () => {
  const view = renderPage()
  await userEvent.click(screen.getByRole("button", { name: /규칙 후보/ }))
  await userEvent.click(screen.getByRole("button", { name: "요청 기록 #1 열기" }))
  currentSnapshot = snapshot(2)
  view.refresh()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("요청 기록 1건#1")
  currentSnapshot = { ...snapshot(3), datasetRevision: 9 }
  view.refresh()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
})

it("saves capped human review independently of removed LLM execution", async () => {
  renderPage()
  await userEvent.click(screen.getByRole("button", { name: /규칙 후보/ }))
  fireEvent.change(screen.getByLabelText("검토 메모"), { target: { value: "x".repeat(2200) } })
  await userEvent.click(screen.getByRole("button", { name: "검토 저장" }))
  expect(post).toHaveBeenCalledWith("/api/review", { itemId: "rule-1", status: "UNRESOLVED", note: "x".repeat(2000) })
  expect(await screen.findByText("저장했습니다.")).toBeVisible()
})

it("does not apply a pending review response to another candidate", async () => {
  let resolve!: (value: unknown) => void
  post.mockReturnValue(new Promise((done) => { resolve = done }))
  currentSnapshot = snapshot(1, [scenario("one", { title: "첫 후보" }), scenario("two", { title: "둘째 후보" })])
  renderPage()
  await userEvent.click(screen.getByRole("button", { name: /첫 후보/ }))
  await userEvent.click(screen.getByRole("button", { name: "검토 저장" }))
  await userEvent.click(screen.getByRole("button", { name: /둘째 후보/ }))
  await act(async () => resolve({ success: true, message: "이전 후보 저장" }))
  expect(screen.queryByText("이전 후보 저장")).not.toBeInTheDocument()
})

it("reports snapshot failure without inventing an empty successful analysis", () => {
  snapshotError = true
  currentSnapshot = undefined
  renderPage()
  expect(screen.getByText("snapshot unavailable")).toBeVisible()
  expect(screen.queryByText("규칙에 해당하는 후보가 없습니다.")).not.toBeInTheDocument()
})

it("retains an open 요청 기록 detail but suspends its actions during a refresh failure", async () => {
  const view = renderPage()
  await userEvent.click(screen.getByRole("button", { name: /규칙 후보/ }))
  await userEvent.click(screen.getByRole("button", { name: "요청 기록 #1 열기" }))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("요청 기록 1건#1")
  snapshotError = true
  view.refresh()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("요청 기록 1건#1")
  expect(screen.getByLabelText("필수 역할")).toBeDisabled()
})

it("shows empty rule results as absence of candidates, not safety", () => {
  currentSnapshot = snapshot(1, [])
  renderPage()
  expect(screen.getByText("규칙에 해당하는 후보가 없습니다.")).toBeVisible()
})
