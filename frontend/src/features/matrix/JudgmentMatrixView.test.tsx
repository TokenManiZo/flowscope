import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import type { AuthorizationMatrix, MatrixConfigurationWarning, MatrixFunctionCell, MatrixObjectCell, Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { JudgmentMatrixView } from "./JudgmentMatrixView"

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

let current: Snapshot | undefined
let queryError = false
const refetchSnapshot = vi.fn()
const saveReview = vi.fn(async (itemId: string, status: string, note: string) => ({ success: true, message: `saved ${itemId} ${status} ${note}` }))

vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: current, isLoading: current === undefined, isError: queryError, error: new Error("snapshot unavailable"), isStale: false, dataUpdatedAt: 1000, refetch: refetchSnapshot }),
}))
vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/endpoints")>(),
  saveReview: (itemId: string, status: string, note: string) => saveReview(itemId, status, note),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const service = "https://demo.test:443"
const confidence = (code: string, level: number, label = code) => ({ code, level, label, basis: `${code} basis` })
const base = { expected: "UNKNOWN" as const, actual: "UNTESTED" as const, policy: confidence("P0", 0, "정책 미정"), evidence: confidence("E0", 0, "미실행"), oracle: { type: "READ_SEMANTIC", label: "읽기 의미 응답", satisfied: false, requirement: "응답에 대상 객체 식별자가 포함되고 soft-deny가 아님" }, gates: [{ key: "session", label: "테스트 신원 유효", state: "PASS" as const, reason: "등록 계정 귀속" }, { key: "repeat", label: "독립 반복", state: "UNKNOWN" as const, reason: "자동 통제 반복 묶음이 없음" }], sourceVerdicts: {}, statusCodes: [], evidenceIds: [], validationVerdict: "NONE", recommendation: null, reviewStatus: "UNRESOLVED" as const, reviewNote: "", reviewEvidenceIds: [] }
const fn = (id: string, identity: string, operation: string, overrides: Partial<MatrixFunctionCell> = {}): MatrixFunctionCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation, status: "COVERAGE_GAP", statusLabel: "교차 실행 공백", ...overrides })
const obj = (id: string, identity: string, resource: string, overrides: Partial<MatrixObjectCell> = {}): MatrixObjectCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation: `${service} GET /api/orders/{id}`, resource, owner: "a", ownerLabel: "A", relation: "SAME_ROLE_FOREIGN", techniques: ["BOLA", "IDOR"], ownership: confidence("O3", 3, "확정"), status: "POLICY_ENFORCED", statusLabel: "기대 차단 관측", ...overrides })
const recommendation = { type: "BOLA/IDOR", basisIdentity: "a", basisIdentityLabel: "A", testIdentity: "b", testIdentityLabel: "B", reason: "다른 신원에 연결된 객체를 교차 접근하는 조합입니다.", instruction: "B 세션으로 객체 요청을 Burp Repeater에서 수동 실행하세요.", stateChanging: false, basisEvidenceIds: ["ev-a"] }
const matrix: AuthorizationMatrix = {
  summary: { policyConfirmed: 1, policyReview: 0, bflaCandidates: 0, bolaIdorCandidates: 0, coverageGaps: 1, invalidExperiments: 0, bflaTestRecommendations: 1, bolaIdorTestRecommendations: 1, manualReviewPending: 2, humanConfirmed: 0, humanDismissed: 0 },
  identities: [{ id: "a", label: "A", role: "User", kind: "REGISTERED" }, { id: "b", label: "B", role: "User", kind: "REGISTERED" }],
  configurationWarnings: [],
  functions: [
    fn("function-a", "a", `${service} GET /api/admin/export`, { status: "EXPECTED_ACCESS", statusLabel: "기대 허용 관측", policy: confidence("P3", 3, "사람 확인 정책"), expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    fn("function-b", "b", `${service} GET /api/admin/export`, { status: "BFLA_TEST_RECOMMENDED", statusLabel: "BFLA 수동 테스트 추천", policy: confidence("P3", 3, "사람 확인 정책"), expected: "DENY", recommendation: { ...recommendation, type: "BFLA", instruction: "B 세션으로 같은 기능 요청을 Burp Repeater에서 수동 실행하세요." } }),
  ],
  objects: [
    obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "기대 허용 관측", relation: "OWNER", expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    obj("object-b", "b", `${service} orders:101`, { status: "BOLA_IDOR_TEST_RECOMMENDED", statusLabel: "BOLA/IDOR 수동 테스트 추천", expected: "DENY", recommendation, reviewEvidenceIds: ["ev-a"] }),
  ],
  evidence: [{ ...obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "기대 허용 관측", evidenceIds: ["ev-a"], statusCodes: [200] }), type: "BOLA/IDOR" }],
  policyLegend: [{ code: "P3", title: "사람 확인", description: "명시적으로 확인한 기대 역할" }],
  evidenceLegend: [{ code: "E0", title: "미실행", description: "응답 없음" }],
  ownershipLegend: [{ code: "O3", title: "확정", description: "명시적 소유 필드" }],
}
const snapshot: Snapshot = {
  ...snapshotFixture,
  revision: 4,
  events: [{ eventId: "ev-a", method: "GET", path: "/api/orders/101", status: 200, fp: "fp", idn: "a", role: "USER", source: "human", op: `${service} GET /api/orders/{id}`, resource: `${service} orders:101`, timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "ACCOUNT_BOUND", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-a"], objects: [], verdict: "allow" }],
  authorizationMatrix: matrix,
}

function renderView(ui: ReactElement) {
  const result = renderWithQueryClient(ui)
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={result.client}>{next}</QueryClientProvider>) }
}

beforeEach(() => { current = snapshot; queryError = false; saveReview.mockClear(); refetchSnapshot.mockClear() })

it("renders server summary, function rows and P/E/O chips without recomputing status", async () => {
  renderView(<JudgmentMatrixView />)
  const summary = screen.getByRole("list", { name: "판정 요약" })
  expect(within(summary).getByText("BFLA 테스트 추천").nextElementSibling).toHaveTextContent("1")
  expect(within(summary).getByText("수동 검토 대기").nextElementSibling).toHaveTextContent("2")
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).getByText("GET /api/admin/export")).toBeVisible()
  expect(within(table).getByText("P3 · 사람 확인 정책")).toBeVisible()
  const cell = within(table).getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" })
  expect(cell).toHaveAttribute("data-tone", "risk")
  expect(cell).toHaveTextContent("기대 차단 → 실제 미실행")
  expect(within(cell).getByText("P3")).toBeVisible()
  expect(within(screen.getByRole("complementary", { name: "분석 필터" })).getByLabelText("정책 신뢰도 P")).toHaveTextContent("P3 사람 확인")
})

it("shows an unmatched registered account service as a warning without adding a matrix column", () => {
  const warning: MatrixConfigurationWarning = {
    code: "ACCOUNT_SERVICE_NOT_IN_MATRIX",
    accountId: "foreign-user",
    accountLabel: "Foreign user",
    configuredService: "https://other.test:443",
    message: "현재 판정 매트릭스의 관측·정책 작업 중 설정 서비스와 일치하는 작업이 없어 판정 조합에서 제외했습니다.",
  }
  current = { ...snapshot, authorizationMatrix: { ...matrix, configurationWarnings: [warning] } }

  renderView(<JudgmentMatrixView />)

  const alert = screen.getByRole("alert", { name: "계정 서비스 설정 경고" })
  expect(within(alert).getByText("계정 서비스 설정 확인")).toBeVisible()
  expect(within(alert).getByText("Foreign user")).toBeVisible()
  expect(within(alert).getByText("https://other.test:443")).toBeVisible()
  expect(within(alert).getByText(warning.message)).toBeVisible()
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).queryByText("Foreign user")).not.toBeInTheDocument()
  expect(within(table).getAllByRole("button")).toHaveLength(2)
})

it("opens the recommendation detail, saves a human review against the server cell id, and shows the server message", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).getByText(`${service} orders:101 · 소유 A`)).toBeVisible()
  await user.click(within(table).getByRole("button", { name: `BOLA/IDOR 수동 테스트 추천: B · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  const recommendationSection = within(inspector).getByRole("region", { name: "테스트 추천 조합" })
  expect(recommendationSection).toHaveTextContent("BOLA/IDOR 테스트 추천 조합")
  expect(recommendationSection).toHaveTextContent("A → B")
  expect(recommendationSection).toHaveTextContent("ev-a")
  expect(within(inspector).getByRole("region", { name: "독립 신뢰도 축" })).toHaveTextContent("O3 · 확정")
  expect(within(inspector).getByRole("region", { name: "테스트 유효성 게이트" })).toHaveTextContent("독립 반복")
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  await user.click(within(review).getByRole("checkbox"))
  await user.type(within(review).getByLabelText("검증 메모"), "repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "판정 저장" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("object-b", "CONFIRMED", "repeater reproduced"))
  expect(await within(review).findByRole("status")).toHaveTextContent("saved object-b CONFIRMED repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "정상·기각" }))
  await waitFor(() => expect(saveReview).toHaveBeenLastCalledWith("object-b", "DISMISSED", "repeater reproduced"))
})

it("opens the basis Evidence sheet from a recommendation and keeps non-reviewable cells without a review form", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: `기대 허용 관측: A · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  expect(within(inspector).queryByRole("region", { name: "사람 최종 판정" })).not.toBeInTheDocument()
  await user.click(within(inspector).getByRole("button", { name: "Evidence 상세 열기" }))
  expect(await screen.findByText("매트릭스 선택 좌표")).toBeVisible()
})

it("filters attention rows, lists evidence rows, and clears a selection whose server item disappears", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("checkbox", { name: "주의 항목만" }))
  expect(screen.getByRole("region", { name: "판정 매트릭스 표" })).toBeVisible()
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "실행 Evidence" }))
  expect(screen.getByText("현재 필터에 표시할 실행 Evidence가 없습니다.")).toBeVisible()
  await user.click(screen.getByRole("checkbox", { name: "주의 항목만" }))
  const list = screen.getByRole("list", { name: "실행 Evidence 목록" })
  await user.click(within(list).getByRole("button"))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("기대 허용 관측")
  // Evidence 행은 객체 cell과 서버 id를 공유하므로 둘 다 사라져야 선택이 풀린다.
  current = { ...snapshot, revision: 5, authorizationMatrix: { ...matrix, objects: [matrix.objects[1]], evidence: [] } }
  rerender(<JudgmentMatrixView />)
  await waitFor(() => expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("판정 셀을 선택하면"))
})

it("states loading, missing matrix, and query error without a local recalculation", () => {
  current = undefined
  const { rerender } = renderView(<JudgmentMatrixView />)
  expect(screen.getByText("판정 매트릭스를 불러오는 중입니다.")).toBeVisible()
  current = { ...snapshotFixture }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByText("이 snapshot에는 판정 매트릭스가 없습니다.")).toBeVisible()
  queryError = true
  current = snapshot
  rerender(<JudgmentMatrixView />)
  expect(screen.getByText("판정 매트릭스를 불러오지 못했습니다.")).toBeVisible()
  expect(screen.getByText("snapshot unavailable")).toBeVisible()
})

it.each(["success", "failure"])("does not carry a late review %s or pending state to a different cell", async outcome => {
  const user = userEvent.setup()
  let resolve!: (value: { success: boolean; message: string }) => void
  let reject!: (error: Error) => void
  saveReview.mockImplementationOnce(() => new Promise((accept, fail) => { resolve = accept; reject = fail }))
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [
    { ...matrix.functions[0], status: "BFLA_REVIEW_REQUIRED", statusLabel: "수동 검토 필요" }, matrix.functions[1],
  ] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "B review")
  await user.click(screen.getByRole("button", { name: "판정 저장" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("function-b", "UNRESOLVED", "B review"))
  await user.click(within(table).getByRole("button", { name: "수동 검토 필요: A · GET /api/admin/export" }))
  expect(screen.getByLabelText("검증 메모")).toHaveValue("")
  expect(screen.getByRole("button", { name: "판정 저장" })).toBeEnabled()
  await act(async () => { if (outcome === "success") resolve({ success: true, message: "old B saved" }); else reject(new Error("old B failed")) })
  expect(screen.queryByText(/old B (saved|failed)/)).not.toBeInTheDocument()
})

it("preserves review drafts on traffic revisions and clears reused ids on dataset replacement", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, datasetRevision: 1 }
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "unsaved old project")
  current = { ...current, revision: 5 }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("unsaved old project")
  await user.click(screen.getByRole("button", { name: "기준 Evidence 상세 열기" }))
  expect(screen.getByText("매트릭스 선택 좌표")).toBeVisible()
  current = { ...current, revision: 6, datasetRevision: 2 }
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByText("매트릭스 선택 좌표")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("검증 메모")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  expect(screen.getByLabelText("검증 메모")).toHaveValue("")
})

it("starts a fresh review when the same cell has different server review Evidence", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "old Evidence note")
  current = { ...snapshot, revision: 5, authorizationMatrix: { ...matrix, functions: [matrix.functions[0], { ...matrix.functions[1], reviewEvidenceIds: ["ev-new"] }] } }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("")
  expect(screen.getByRole("region", { name: "사람 최종 판정" })).toHaveTextContent("Evidence 1건")
})

it("closes stale Evidence actions, retains the last matrix with a retry, and does not restore selection", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  await user.click(screen.getByRole("button", { name: "기준 Evidence 상세 열기" }))
  expect(screen.getByText("매트릭스 선택 좌표")).toBeVisible()
  queryError = true
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByText("매트릭스 선택 좌표")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("검증 메모")).not.toBeInTheDocument()
  expect(screen.getByText("마지막 성공 데이터 · 현재 상태 아님")).toBeVisible()
  expect(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  expect(refetchSnapshot).toHaveBeenCalledOnce()
  queryError = false
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByText("매트릭스 선택 좌표")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("검증 메모")).not.toBeInTheDocument()
})
