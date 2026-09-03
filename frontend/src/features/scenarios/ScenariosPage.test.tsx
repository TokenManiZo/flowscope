import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import { afterAll, expect, it, vi } from "vitest"

import type { AiPreview, AiScenariosEnvelope, Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { ScenariosPage } from "./ScenariosPage"

let currentSnapshot: Snapshot | undefined
let snapshotError = false
let apiCalls: Array<{ kind: "get" | "post"; path: string }> = []
let previewResponse: AiPreview = { notice: "서버 미리보기", records: 2, coverageCells: 1, findings: [], gaps: [] }
let scenarioResponse: AiScenariosEnvelope = { usedLlm: false, message: "MCP LLM 평가가 아직 없어 결정론적 후보만 표시합니다.", result: { scenarios: [] } }
let reviewFailure: Error | null = null
let previewFailure: Error | null = null
let generationFailure: Error | null = null
let reviewCalls: Array<{ itemId: string; status: string; note: string }> = []
let pendingPreview: Promise<AiPreview> | null = null
let pendingGeneration: Promise<AiScenariosEnvelope> | null = null
let pendingReview: Promise<{ success: true; message: string }> | null = null

vi.mock("@/lib/api/client", () => ({
  apiFetch: async (path: string) => { apiCalls.push({ kind: "get", path }); if (previewFailure) throw previewFailure; return pendingPreview ?? previewResponse },
  postForm: async (path: string, values: Record<string, string>) => {
    apiCalls.push({ kind: "post", path })
    if (path === "/api/review") {
      reviewCalls.push({ itemId: values.itemId, status: values.status, note: values.note })
      if (reviewFailure) throw reviewFailure
      return pendingReview ?? { success: true, message: "저장했습니다." }
    }
    if (generationFailure) throw generationFailure
    return pendingGeneration ?? scenarioResponse
  },
}))

vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: currentSnapshot, isLoading: currentSnapshot === undefined && !snapshotError, isError: snapshotError, error: new Error("snapshot unavailable"), isStale: true }),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const previousHasPointerCapture = Object.getOwnPropertyDescriptor(Element.prototype, "hasPointerCapture")
const previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")
if (!previousHasPointerCapture) Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false })
if (!previousScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
afterAll(() => {
  if (previousHasPointerCapture) Object.defineProperty(Element.prototype, "hasPointerCapture", previousHasPointerCapture)
  else delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture
  if (previousScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", previousScrollIntoView)
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

function event(eventId: string) {
  return { eventId, method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human" as const, op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "h", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [eventId], objects: [], verdict: "allow" as const }
}

function scenario(id: string, values: Partial<Snapshot["scenarios"][number]> = {}) {
  return { id, tag: "RULE", title: "규칙 후보", proposal: "서버 제안", evidence: "서버 근거", risk: "HIGH", evidenceIds: ["candidate-event"], reviewStatus: "UNRESOLVED" as const, reviewNote: "", ...values }
}

function snapshot(revision = 1, scenarios: Snapshot["scenarios"] = [scenario("rule-1")]): Snapshot {
  return { ...snapshotFixture, revision, events: [event("candidate-event"), event("validation-event"), event("control-event")], scenarios }
}

function renderPage() {
  const result = renderWithQueryClient(<ScenariosPage />)
  return { ...result, rerender: () => result.rerender(<QueryClientProvider client={result.client}><ScenariosPage /></QueryClientProvider>) }
}

function reset() {
  currentSnapshot = snapshot()
  snapshotError = false
  apiCalls = []
  reviewCalls = []
  reviewFailure = null
  previewFailure = null
  generationFailure = null
  pendingPreview = null
  pendingGeneration = null
  pendingReview = null
  previewResponse = { notice: "서버 미리보기", records: 2, coverageCells: 1, findings: [], gaps: [] }
  scenarioResponse = { usedLlm: false, message: "MCP LLM 평가가 아직 없어 결정론적 후보만 표시합니다.", result: { scenarios: [scenario("rule-1")] } }
}

it("gets the Judge input preview first, then posts the server scenario projection without duplicate pending actions", async () => {
  reset()
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }])
  expect(screen.getByText("서버 미리보기")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "post", path: "/api/ai-scenarios" }])
  expect(screen.getByText("결정론적 폴백")).toBeVisible()
  expect(screen.queryByText("LLM 실행 성공")).not.toBeInTheDocument()
})

it("keeps preview and generation controls in the shared scenario context", async () => {
  reset()
  renderPage()

  const context = screen.getByRole("complementary", { name: "분석 필터" })
  expect(within(context).getByRole("button", { name: "MCP Judge 입력 미리보기" })).toBeVisible()
  expect(within(context).getByRole("button", { name: "시나리오 생성" })).toBeDisabled()
  expect(screen.getByRole("region", { name: "시나리오 분석 영역" })).toBeVisible()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
})

it("keeps snapshot scenarios out of cards until the current-revision preview succeeds and the server envelope is posted", async () => {
  reset()
  currentSnapshot = snapshot(1, [scenario("snapshot-only", { title: "snapshot 전용 후보" })])
  const user = userEvent.setup()
  renderPage()

  expect(screen.getByText("시나리오 생성을 시작하면 서버 반환 후보를 표시합니다.")).toBeVisible()
  expect(screen.queryByText("snapshot 전용 후보")).not.toBeInTheDocument()
  const generation = screen.getByRole("button", { name: "시나리오 생성" })
  expect(generation).toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([])

  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  expect(generation).not.toBeDisabled()
  scenarioResponse = { usedLlm: false, message: "서버 후보", result: { scenarios: [scenario("envelope", { title: "envelope 후보" })] } }
  await user.click(generation)
  expect(screen.getAllByText("envelope 후보").length).toBeGreaterThan(0)
  expect(screen.queryByText("snapshot 전용 후보")).not.toBeInTheDocument()
})

it("blocks direct generation, keeps it blocked after preview failure, and permits one post only after retry succeeds", async () => {
  reset()
  previewFailure = new Error("미리보기 서버 오류")
  const user = userEvent.setup()
  renderPage()
  const generation = screen.getByRole("button", { name: "시나리오 생성" })
  await user.click(generation)
  expect(apiCalls).toEqual([])

  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  expect(await screen.findByText("미리보기 서버 오류")).toBeVisible()
  expect(generation).toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }])

  previewFailure = null
  await user.click(screen.getByRole("button", { name: "미리보기 재시도" }))
  expect(generation).not.toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "get", path: "/api/ai-preview" }, { kind: "post", path: "/api/ai-scenarios" }])
})

it("revokes an earlier preview while its refresh is pending or rejected, then allows one post only after retry succeeds", async () => {
  reset()
  const user = userEvent.setup()
  renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  const generation = screen.getByRole("button", { name: "시나리오 생성" })
  expect(generation).not.toBeDisabled()

  let rejectRefresh!: (reason: Error) => void
  pendingPreview = new Promise<AiPreview>((_resolve, reject) => { rejectRefresh = reject })
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  expect(generation).toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "get", path: "/api/ai-preview" }])

  rejectRefresh(new Error("새 미리보기 서버 오류"))
  expect(await screen.findByText("새 미리보기 서버 오류")).toBeVisible()
  expect(generation).toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "get", path: "/api/ai-preview" }])

  pendingPreview = null
  await user.click(screen.getByRole("button", { name: "미리보기 재시도" }))
  expect(generation).not.toBeDisabled()
  await user.click(generation)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "get", path: "/api/ai-preview" }, { kind: "get", path: "/api/ai-preview" }, { kind: "post", path: "/api/ai-scenarios" }])
})

it("ignores a preview response that returns after the snapshot revision has changed", async () => {
  reset()
  let releasePreview!: (value: AiPreview) => void
  pendingPreview = new Promise<AiPreview>((resolve) => { releasePreview = resolve })
  const user = userEvent.setup()
  const { rerender } = renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  currentSnapshot = snapshot(2)
  rerender()
  releasePreview({ ...previewResponse, notice: "늦은 미리보기" })
  await waitFor(() => expect(screen.getByText("snapshot이 변경되어 미리보기와 생성 결과를 다시 확인해야 합니다.")).toBeVisible())
  expect(screen.queryByText("늦은 미리보기")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "시나리오 생성" })).toBeDisabled()
})

it("keeps generation failure at its action and retries the exact current-revision envelope", async () => {
  reset()
  generationFailure = new Error("시나리오 서버 오류")
  const user = userEvent.setup()
  renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))
  expect(await screen.findByText("시나리오 서버 오류")).toBeVisible()
  expect(screen.queryByText("미리보기를 불러오지 못했습니다.")).not.toBeInTheDocument()
  generationFailure = null
  await user.click(screen.getByRole("button", { name: "시나리오 재시도" }))
  expect(screen.getByText("결정론적 폴백")).toBeVisible()
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "post", path: "/api/ai-scenarios" }, { kind: "post", path: "/api/ai-scenarios" }])
})

it("disables a pending preview or generation action so repeated clicks cannot duplicate either request", async () => {
  reset()
  let releasePreview!: (value: AiPreview) => void
  let releaseGeneration!: (value: AiScenariosEnvelope) => void
  pendingPreview = new Promise<AiPreview>((resolve) => { releasePreview = resolve })
  pendingGeneration = new Promise<AiScenariosEnvelope>((resolve) => { releaseGeneration = resolve })
  const user = userEvent.setup()
  renderPage()

  const previewButton = screen.getByRole("button", { name: "MCP Judge 입력 미리보기" })
  await user.click(previewButton)
  expect(previewButton).toBeDisabled()
  await user.click(previewButton)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }])
  releasePreview(previewResponse)
  await waitFor(() => expect(previewButton).not.toBeDisabled())

  const generationButton = screen.getByRole("button", { name: "시나리오 생성" })
  await user.click(generationButton)
  expect(generationButton).toBeDisabled()
  await user.click(generationButton)
  expect(apiCalls).toEqual([{ kind: "get", path: "/api/ai-preview" }, { kind: "post", path: "/api/ai-scenarios" }])
  releaseGeneration(scenarioResponse)
  await waitFor(() => expect(generationButton).not.toBeDisabled())
})

it("rejects a generation response that returns after the snapshot revision has changed", async () => {
  reset()
  let releaseGeneration!: (value: AiScenariosEnvelope) => void
  pendingGeneration = new Promise<AiScenariosEnvelope>((resolve) => { releaseGeneration = resolve })
  const user = userEvent.setup()
  const { rerender } = renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))

  currentSnapshot = snapshot(2)
  rerender()
  await act(async () => {
    releaseGeneration({ usedLlm: true, message: "늦은 생성", result: { scenarios: [scenario("late", { title: "늦은 생성 후보" })] } })
    await pendingGeneration
  })

  await waitFor(() => expect(screen.getByText("snapshot이 변경되어 미리보기와 생성 결과를 다시 확인해야 합니다.")).toBeVisible())
  expect(screen.queryByText("늦은 생성 후보")).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "시나리오 후보 목록" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "시나리오 생성" })).toBeDisabled()
})

it("keeps rule, non-final assessment, server final validation, and human review separate without inferred confirmation", async () => {
  reset()
  currentSnapshot = snapshot(1, [
    scenario("rule-1", { title: "규칙 후보", risk: "CRITICAL", reviewStatus: "UNRESOLVED" }),
    scenario("llm-1", { tag: "LLM ALLOW", title: "평가", reviewStatus: "UNRESOLVED" }),
    scenario("final-1", { title: "최종", finalVerdict: "INCONCLUSIVE", validationReason: "증거 부족", validationRunId: "run-1", validationEvidenceIds: ["validation-event"], controlEvidenceIds: ["control-event"], reviewStatus: "UNRESOLVED" }),
  ])
  scenarioResponse = { usedLlm: true, message: "서버 반환", result: { scenarios: currentSnapshot.scenarios } }
  const user = userEvent.setup()
  renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))

  const candidateList = screen.getByRole("region", { name: "시나리오 후보 목록" })
  const selectedDetail = screen.getByRole("region", { name: "선택한 시나리오 상세" })
  expect(within(candidateList).getByText("CRITICAL")).toBeVisible()
  expect(within(candidateList).getAllByText("LLM 비최종 평가").length).toBeGreaterThan(0)
  expect(within(candidateList).getByText("서버 최종 검증")).toBeVisible()
  expect(within(selectedDetail).getByText("사람 검토")).toBeVisible()
  expect(screen.getAllByText("규칙 후보").length).toBeGreaterThan(0)
  expect(within(selectedDetail).getAllByText("LLM 비최종 평가").length).toBeGreaterThan(0)
  expect(screen.getAllByText("사람 검토")).toHaveLength(1)
  await user.click(within(candidateList).getByRole("button", { name: /^최종HIGH서버 최종 검증$/ }))
  expect(within(selectedDetail).getAllByText("서버 최종 검증").length).toBeGreaterThan(0)
  expect(within(selectedDetail).getByText("INCONCLUSIVE")).toBeVisible()
  expect(screen.getAllByText("사람 검토")).toHaveLength(1)
  expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument()
})

it("sends the exact capped review form, keeps failure local, and reconciles only the successful card", async () => {
  reset()
  currentSnapshot = snapshot(1, [scenario("rule-1"), scenario("rule-2", { title: "다른 후보" })])
  const user = userEvent.setup()
  scenarioResponse = { usedLlm: true, message: "서버 반환", result: { scenarios: currentSnapshot.scenarios } }
  renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))
  const candidateList = screen.getByRole("region", { name: "시나리오 후보 목록" })
  const selectedDetail = screen.getByRole("region", { name: "선택한 시나리오 상세" })
  const first = within(selectedDetail).getByRole("article")
  const second = within(candidateList).getByRole("button", { name: /다른 후보/ })

  await user.click(within(first).getByRole("combobox", { name: "사람 검토 상태" }))
  await user.click(screen.getByRole("option", { name: "확인됨" }))
  fireEvent.change(within(first).getByLabelText("검토 메모"), { target: { value: "x".repeat(2100) } })
  reviewFailure = new Error("서버 검토 오류")
  await user.click(within(first).getByRole("button", { name: "검토 저장" }))
  await waitFor(() => expect(within(first).getByText("서버 검토 오류")).toBeVisible())
  expect(reviewCalls[0]).toEqual({ itemId: "rule-1", status: "CONFIRMED", note: "x".repeat(2000) })
  expect(within(second).queryByText("서버 검토 오류")).not.toBeInTheDocument()

  reviewFailure = null
  await user.click(within(first).getByRole("button", { name: "검토 저장" }))
  await waitFor(() => expect(within(first).getByText("저장했습니다.")).toBeVisible())
  expect(within(first).getByRole("combobox", { name: "사람 검토 상태" })).toHaveTextContent("확인됨")
})

it("does not leak a pending review completion into a newly selected candidate", async () => {
  reset()
  currentSnapshot = snapshot(1, [scenario("rule-a", { title: "후보 A" }), scenario("rule-b", { title: "후보 B", reviewNote: "B 원래 메모" })])
  scenarioResponse = { usedLlm: true, message: "서버 반환", result: { scenarios: currentSnapshot.scenarios } }
  let releaseReview!: (value: { success: true; message: string }) => void
  pendingReview = new Promise((resolve) => { releaseReview = resolve })
  const user = userEvent.setup()
  renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))

  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  const detail = screen.getByRole("region", { name: "선택한 시나리오 상세" })
  fireEvent.change(within(detail).getByLabelText("검토 메모"), { target: { value: "A 보류 메모" } })
  await user.click(within(detail).getByRole("button", { name: "검토 저장" }))
  await user.click(within(list).getByRole("button", { name: /후보 B/ }))
  expect(within(detail).getByLabelText("검토 메모")).toHaveValue("B 원래 메모")

  await act(async () => {
    releaseReview({ success: true, message: "A 저장 완료" })
    await pendingReview
  })
  expect(reviewCalls).toEqual([{ itemId: "rule-a", status: "UNRESOLVED", note: "A 보류 메모" }])
  expect(within(detail).getByLabelText("검토 메모")).toHaveValue("B 원래 메모")
  expect(within(detail).queryByText("A 저장 완료")).not.toBeInTheDocument()
})

it("opens only exact existing Evidence in the shared sheet, marks missing IDs unavailable, and clears a stale selection after refresh", async () => {
  reset()
  currentSnapshot = snapshot(1, [scenario("final-1", { evidenceIds: ["candidate-event", "missing-event"], finalVerdict: "INCONCLUSIVE", validationReason: "검증 Evidence 확인", validationRunId: "run-1", validationEvidenceIds: ["validation-event"], controlEvidenceIds: ["control-event"] })])
  const user = userEvent.setup()
  scenarioResponse = { usedLlm: true, message: "서버 반환", result: { scenarios: currentSnapshot.scenarios } }
  const { rerender } = renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))

  expect(screen.getByText("후보/평가 Evidence")).toBeVisible()
  expect(screen.getByText("서버 최종 검증 Evidence")).toBeVisible()
  expect(screen.getByText("정상 제어 Evidence")).toBeVisible()
  expect(screen.getByText("missing-event")).toBeVisible()
  expect(screen.getByText("사용 불가")).toBeVisible()
  await user.click(screen.getAllByRole("button", { name: "Evidence 열기" })[0])
  expect(await screen.findByText("Evidence 상세")).toBeVisible()
  currentSnapshot = { ...snapshot(2, [scenario("final-1", { evidenceIds: ["missing-event"] })]), events: [] }
  rerender()
  await waitFor(() => expect(screen.queryByText("Evidence 상세")).not.toBeInTheDocument())
})

it("escapes and bounds untrusted scenario text and resets preview and generated results on snapshot revision changes", async () => {
  reset()
  const dangerous = `<img src=x onerror=alert(1)>${"x".repeat(220)}`
  currentSnapshot = snapshot(1, [scenario("rule-1", { title: dangerous, proposal: dangerous, evidence: dangerous, validationReason: dangerous })])
  previewResponse = { notice: dangerous, records: 1, coverageCells: 1, findings: [{ id: dangerous, type: dangerous, severity: "HIGH", title: dangerous, cell: { identity: dangerous, operation: dangerous, resource: null }, reason: dangerous, evidenceIds: [], confirmed: false }], gaps: [] }
  const user = userEvent.setup()
  const { rerender } = renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: /더 보기/ }).length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toContain(dangerous)
  currentSnapshot = snapshot(2)
  rerender()
  await waitFor(() => expect(screen.getByText("snapshot이 변경되어 미리보기와 생성 결과를 다시 확인해야 합니다.")).toBeVisible())
  expect(screen.queryByText("결정론적 폴백")).not.toBeInTheDocument()
  expect(screen.queryByText("사람 검토")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "시나리오 생성" })).toBeDisabled()
})

it("shows snapshot loading, page error, empty generation, and action-local retry states truthfully", async () => {
  reset()
  currentSnapshot = undefined
  const { rerender } = renderPage()
  expect(screen.getByText("시나리오 데이터를 불러오는 중입니다.")).toBeVisible()
  snapshotError = true
  rerender()
  expect(screen.getByText("snapshot unavailable")).toBeVisible()
  snapshotError = false
  currentSnapshot = snapshot()
  scenarioResponse = { usedLlm: true, message: "기존 MCP 상태", result: { scenarios: [] } }
  rerender()
  await userEvent.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await userEvent.click(screen.getByRole("button", { name: "시나리오 생성" }))
  expect(screen.getByText("반환된 시나리오가 없습니다.")).toBeVisible()
  expect(screen.getByText("기존 MCP 평가·검증 상태 포함")).toBeVisible()
})

it("keeps retained stale snapshot usable and exposes all bounded preview fields and scenario cards only after explicit expansion", async () => {
  reset()
  const dangerous = `<scenario-field>${"x".repeat(220)}</scenario-field>`
  currentSnapshot = snapshot(1, Array.from({ length: 8 }, (_, index) => scenario(`snapshot-${index}`, { title: `snapshot ${index}` })))
  previewResponse = {
    notice: dangerous,
    records: 2,
    coverageCells: 3,
    findings: Array.from({ length: 4 }, (_, index) => ({ id: `finding-${index}-${dangerous}`, type: `TYPE-${index}`, severity: "HIGH", title: `제목 ${index}`, cell: { identity: `identity-${index}`, operation: `GET /${index}`, resource: index === 0 ? null : `resource-${index}` }, reason: `reason-${index}-${dangerous}`, evidenceIds: [`e-${index}`], confirmed: index % 2 === 0 })),
    gaps: Array.from({ length: 4 }, (_, index) => ({ id: `gap-${index}-${dangerous}`, type: `GAP-${index}`, identity: `gap-identity-${index}`, operation: `POST /${index}`, resource: index === 0 ? null : `gap-resource-${index}`, missedBy: ["human", "llm"], risk: index, reason: `gap-reason-${index}-${dangerous}` })),
  }
  scenarioResponse = { usedLlm: true, message: "서버 반환", result: { scenarios: Array.from({ length: 8 }, (_, index) => scenario(`envelope-${index}`, { title: `envelope ${index}` })) } }
  const user = userEvent.setup()
  const { rerender } = renderPage()
  await user.click(screen.getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  expect(screen.getByText("서버 finding: 4 · gap: 4")).toBeVisible()
  expect(screen.queryByText(`제목 3`)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "미리보기 목록 더 보기" })).toBeVisible()
  expect(document.body.textContent).not.toContain(dangerous)
  await user.click(screen.getByRole("button", { name: "미리보기 목록 더 보기" }))
  expect(screen.getByText(/title: 제목 3/)).toBeVisible()
  expect(screen.getByText(/cell resource: resource-1/)).toBeVisible()
  expect(screen.getAllByText(/객체 없음/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/missedBy: human, llm/).length).toBe(4)
  expect(screen.queryByRole("scenario-field")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "시나리오 생성" }))
  expect(screen.queryByText("envelope 7")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "시나리오 목록 더 보기" }))
  expect(screen.getByText("envelope 7")).toBeVisible()
  rerender()
  expect(screen.queryByText("이전 snapshot을 표시 중입니다.")).not.toBeInTheDocument()
  expect(screen.getByText("envelope 7")).toBeVisible()
})

it.each([900, 600])("keeps scenario controls and Evidence inspection functional at compact %ipx", async (width) => {
  const previousMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") && width < 1280, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  reset()
  scenarioResponse = { usedLlm: false, message: "서버 후보", result: { scenarios: [scenario("compact")] } }
  const user = userEvent.setup()
  renderPage()

  const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await user.click(contextTrigger)
  const context = screen.getByRole("dialog", { name: "분석 필터" })
  await user.click(within(context).getByRole("button", { name: "MCP Judge 입력 미리보기" }))
  await user.click(within(context).getByRole("button", { name: "시나리오 생성" }))
  await user.click(within(context).getByRole("button", { name: "Close" }))
  expect(contextTrigger).toHaveFocus()
  expect(await screen.findByText("서버 미리보기")).toBeVisible()
  expect(await screen.findByRole("region", { name: "시나리오 후보 목록" })).toBeVisible()

  await user.click(inspectorTrigger)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("분석 결과에서 항목을 선택하면")
  await user.click(within(screen.getByRole("dialog", { name: "선택 상세" })).getByRole("button", { name: "Close" }))
  await user.click(screen.getByRole("button", { name: "Evidence 열기" }))
  const inspector = await screen.findByRole("dialog", { name: "선택 상세" })
  expect(within(inspector).getByText("시나리오 Evidence 선택")).toBeVisible()
  await user.click(within(inspector).getByRole("button", { name: "Close" }))
  expect(screen.queryByText("시나리오 Evidence 선택")).not.toBeInTheDocument()
  expect(inspectorTrigger).toHaveFocus()
  window.matchMedia = previousMatchMedia
})
