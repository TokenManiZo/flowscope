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
const saveRequirement = vi.fn(async (operation: string, role: string) => ({ success: true, message: `requirement ${operation} ${role}` }))
const saveResourcePolicy = vi.fn(async (target: string, policy: string) => ({ success: true, message: `resource ${target} ${policy}` }))
const saveRole = vi.fn(async (identity: string, role: string) => ({ success: true, message: `role ${identity} ${role}` }))
const runAuthorizationReplay = vi.fn(async (itemId: string, armed: boolean) => ({
  success: true, message: "안전 재전송 완료",
  run: { runId: "authorization-replay-ui", armed, sent: 1, drafted: 0, skipped: 0, items: [{ operation: `${service} GET /api/orders/{id}`, targetIdentity: "b", basisIdentity: "a", basisEvidenceId: "ev-a", outcome: "SENT", reason: "CONTROLLED_RESPONSE_RECORDED" }] },
}))

vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: current, isLoading: current === undefined, isError: queryError, error: new Error("snapshot unavailable"), isStale: false, dataUpdatedAt: 1000, refetch: refetchSnapshot }),
  useHumanRunQuery: () => ({ data: humanRunActive === undefined ? undefined : { active: humanRunActive, completed: false, runId: "", accountId: "", proxy: "" } }),
}))
let humanRunActive: boolean | undefined = false
vi.mock("@/lib/api/endpoints", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/endpoints")>(),
  saveReview: (itemId: string, status: string, note: string) => saveReview(itemId, status, note),
  saveRequirement: (operation: string, role: string) => saveRequirement(operation, role),
  saveResourcePolicy: (target: string, policy: string) => saveResourcePolicy(target, policy),
  saveRole: (identity: string, role: string) => saveRole(identity, role),
  runAuthorizationReplay: (itemId: string, armed: boolean) => runAuthorizationReplay(itemId, armed),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

const service = "https://demo.test:443"
const confidence = (code: string, level: number, label = code) => ({ code, level, label, basis: `${code} basis` })
const base = { expected: "UNKNOWN" as const, blockingLayers: [] as const, actual: "UNTESTED" as const, policy: confidence("P0", 0, "정책 미정"), evidence: confidence("E0", 0, "미실행"), oracle: { type: "READ_SEMANTIC", label: "읽기 의미 응답", satisfied: false, requirement: "응답에 대상 객체 식별자가 포함되고 soft-deny가 아님" }, gates: [{ key: "session", label: "테스트 신원 유효", state: "PASS" as const, reason: "등록 계정 귀속" }, { key: "repeat", label: "독립 반복", state: "UNKNOWN" as const, reason: "자동 통제 반복 묶음이 없음" }], sourceVerdicts: {}, statusCodes: [], evidenceIds: [], validationVerdict: "NONE", recommendation: null, reviewStatus: "UNRESOLVED" as const, reviewNote: "", reviewEvidenceIds: [] }
const fn = (id: string, identity: string, operation: string, overrides: Partial<MatrixFunctionCell> = {}): MatrixFunctionCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation, status: "COVERAGE_GAP", statusLabel: "교차 실행 공백", ...overrides })
const obj = (id: string, identity: string, resource: string, overrides: Partial<MatrixObjectCell> = {}): MatrixObjectCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation: `${service} GET /api/orders/{id}`, resource, owner: "a", ownerLabel: "A", relation: "SAME_ROLE_FOREIGN", techniques: ["BOLA", "IDOR"], resourcePolicy: "UNKNOWN", ownership: confidence("O3", 3, "확정"), status: "POLICY_ENFORCED", statusLabel: "기대 차단 관측", ...overrides })
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

beforeEach(() => { current = snapshot; queryError = false; humanRunActive = false; window.location.hash = ""; saveReview.mockClear(); refetchSnapshot.mockClear(); runAuthorizationReplay.mockClear(); })

it("renders the compact server summary and matrix without row subtitles or P/E/O cell chips", async () => {
  renderView(<JudgmentMatrixView />)
  const summary = screen.getByRole("list", { name: "판정 요약" })
  expect(within(summary).getByText("BFLA 테스트 추천").nextElementSibling).toHaveTextContent("1")
  expect(within(summary).getByText("수동 검토 대기").nextElementSibling).toHaveTextContent("2")
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(screen.queryByText("관측 결과의 신원·기능·객체 공백을 비교해 IDOR/BOLA/BFLA 테스트 조합을 추천합니다. 명시적으로 무장한 안전 재전송 외에는 자동 전송하지 않으며 점수를 합산하지 않습니다.")).not.toBeInTheDocument()
  expect(screen.queryByText("정책 P·실행 E·소유권 O를 합산하지 않습니다. 후보는 서버 권한 셀의 판정만 따릅니다.")).not.toBeInTheDocument()
  expect(within(table).getByText("GET")).toHaveClass("text-observation-human")
  expect(within(table).getByText("/api/admin/export")).toBeVisible()
  expect(within(table).queryByText("P3 · 사람 확인 정책")).not.toBeInTheDocument()
  const cell = within(table).getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" })
  expect(cell).toHaveAttribute("data-tone", "risk")
  expect(cell).not.toHaveTextContent("기대 차단 → 실제 미실행")
  expect(within(cell).queryByText("P3")).not.toBeInTheDocument()
  expect(within(screen.getByRole("complementary", { name: "분석 필터" })).queryByLabelText("정책 신뢰도 P")).not.toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: "실행 Evidence" })).not.toBeInTheDocument()
  expect(screen.queryByText(/열=신원·역할/)).not.toBeInTheDocument()
  expect(screen.getByTestId("judgment-matrix-scroll")).toHaveClass("overflow-x-auto")
  expect(within(summary).queryByText("상위 역할 → 하위 역할")).not.toBeInTheDocument()
  expect(within(summary).queryByText("Burp Repeater 확인 필요")).not.toBeInTheDocument()
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
  expect(within(table).queryByText(`${service} orders:101 · 소유 A`)).not.toBeInTheDocument()
  await user.click(within(table).getByRole("button", { name: `BOLA/IDOR 수동 테스트 추천: B · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  // 상세는 역할·정책 지정, Repeater 전송, 사람 최종 판정 세 칸뿐이다.
  expect(within(inspector).getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["정책·역할 지정", "Burp Repeater 전송", "사람 최종 판정"])
  expect(within(inspector).getByRole("region", { name: "Burp Repeater 전송" })).toHaveTextContent("A → B")
  expect(inspector).not.toHaveTextContent("ev-a")
  expect(within(inspector).queryByRole("region", { name: "독립 신뢰도 축" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "테스트 유효성 게이트" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "기대와 실제" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "결과 오라클" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "대상 Evidence" })).not.toBeInTheDocument()
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  await user.click(within(review).getByRole("checkbox"))
  await user.type(within(review).getByLabelText("검증 메모"), "repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "판정 저장" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("object-b", "CONFIRMED", "repeater reproduced"))
  expect(await within(review).findByRole("status")).toHaveTextContent("saved object-b CONFIRMED repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "정상·기각" }))
  await waitFor(() => expect(saveReview).toHaveBeenLastCalledWith("object-b", "DISMISSED", "repeater reproduced"))
})

it("opens the selected recommendation in Burp Repeater as an unsent draft without the removed auto-replay controls", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  expect(screen.queryByRole("region", { name: "안전 능동 재전송" })).not.toBeInTheDocument()
  expect(screen.queryByRole("checkbox", { name: "안전 자동 재전송 허용 (이번 1회)" })).not.toBeInTheDocument()
  const replay = screen.getByRole("region", { name: "Burp Repeater 전송" })
  await user.click(within(replay).getByRole("button", { name: "Burp Repeater로 전송" }))
  await waitFor(() => expect(runAuthorizationReplay).toHaveBeenCalledWith("function-b", false))
  // HUMAN 탐색이 꺼진 안내와 전송 결과가 함께 보인다.
  expect(await within(replay).findAllByRole("status")).toHaveLength(2)
})

it("keeps the same sections on non-reviewable observed cells but locks review and Repeater", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: `기대 허용 관측: A · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  expect(within(review).getByRole("button", { name: "판정 저장" })).toBeDisabled()
  expect(within(review).getByLabelText("검증 메모")).toBeDisabled()
  expect(review).toHaveTextContent("검토할 추천이 없는 셀입니다.")
  expect(within(inspector).getByRole("button", { name: "Burp Repeater로 전송" })).toBeDisabled()
  expect(within(inspector).queryByRole("region", { name: "대상 Evidence" })).not.toBeInTheDocument()
})

it("filters attention rows with a separate switch and clears a selection whose server item disappears", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  const attention = screen.getByRole("switch", { name: "주의 항목만" })
  expect(attention).toHaveAttribute("aria-checked", "false")
  await user.click(attention)
  expect(attention).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("region", { name: "판정 매트릭스 표" })).toBeVisible()
  await user.click(attention)
  await user.click(screen.getByRole("button", { name: "기대 허용 관측: A · GET /api/admin/export" }))
  current = { ...snapshot, revision: 5, authorizationMatrix: { ...matrix, functions: [matrix.functions[1]] } }
  rerender(<JudgmentMatrixView />)
  await waitFor(() => expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("판정 셀을 선택하세요."))
})

it("marks confirmed cells red and keeps gap replay and review actions available", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [
    { ...matrix.functions[0], reviewStatus: "CONFIRMED" },
    fn("function-gap", "b", `${service} GET /api/admin/export`),
  ] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).getByRole("button", { name: "기대 허용 관측 · 사용자 확정: A · GET /api/admin/export" })).toHaveClass("border-red-500/50", "bg-red-500/10")
  await user.click(within(table).getByRole("button", { name: "교차 실행 공백: B · GET /api/admin/export" }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  expect(within(inspector).getByRole("button", { name: "Burp Repeater로 전송" })).toBeEnabled()
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  expect(within(review).getByRole("checkbox", { name: "취약점으로 확정" })).toBeEnabled()
  expect(within(review).getByRole("button", { name: "판정 저장" })).toBeEnabled()
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
  current = { ...current, revision: 6, datasetRevision: 2 }
  rerender(<JudgmentMatrixView />)
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
})

it("retains the selected cell and unsaved review note while snapshot actions are suspended", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "keep during outage")
  queryError = true
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("keep during outage")
  expect(screen.getByLabelText("검증 메모")).toBeDisabled()
  expect(screen.getByText("마지막 성공 데이터 · 현재 상태 아님")).toBeVisible()
  expect(screen.getByRole("button", { name: "BFLA 수동 테스트 추천: B · GET /api/admin/export" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  expect(refetchSnapshot).toHaveBeenCalledOnce()
  queryError = false
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("keep during outage")
  expect(screen.getByLabelText("검증 메모")).toBeEnabled()
})

it("offers required-role and identity-role assignment on a P0 cell through the existing APIs and keeps it on confirmed cells", async () => {
  const user = userEvent.setup()
  const observed = { id: "c", label: "C", role: "Unknown", kind: "OBSERVED" }
  const unknownPolicy = fn("function-c", "c", `${service} GET /api/admin/export`, { role: "Unknown", status: "UNKNOWN_POLICY", statusLabel: "정책 미정", policy: confidence("P0", 0, "정책 미정") })
  current = { ...snapshot, authorizationMatrix: { ...matrix, identities: [...matrix.identities, observed], functions: [...matrix.functions, unknownPolicy] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: "정책 미정: C · GET /api/admin/export" }))
  const assignment = screen.getByRole("region", { name: "정책·역할 지정" })
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "필수 역할" }), "ADMIN")
  await user.click(within(assignment).getByRole("button", { name: "필수 역할 저장" }))
  await waitFor(() => expect(saveRequirement).toHaveBeenCalledWith(`${service} GET /api/admin/export`, "ADMIN"))
  expect(await within(assignment).findByRole("status")).toHaveTextContent(`requirement ${service} GET /api/admin/export ADMIN`)
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "신원 역할" }), "USER")
  await user.click(within(assignment).getByRole("button", { name: "신원 역할 저장" }))
  await waitFor(() => expect(saveRole).toHaveBeenCalledWith("c", "USER"))
  // 정책이 확인된 셀에도 같은 자리에 지정 칸이 있고, 현재 필수 역할이 미리 채워진다.
  await user.click(within(table).getByRole("button", { name: "기대 허용 관측: A · GET /api/admin/export" }))
  expect(within(screen.getByRole("region", { name: "정책·역할 지정" })).getByRole("combobox", { name: "필수 역할" })).toBeVisible()
})

it("hides the blocking-layer subtitle and saves an object policy from the object cell", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix, objects: matrix.objects.map((cell) =>
    cell.id === "object-b" ? { ...cell, blockingLayers: ["BOLA"], resourcePolicy: "OWNER_ONLY" } : cell) } }
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `BOLA/IDOR 수동 테스트 추천: B · GET /api/orders/{id} · ${service} orders:101` }))

  expect(screen.queryByText("차단층")).not.toBeInTheDocument()
  const assignment = screen.getByRole("region", { name: "정책·역할 지정" })
  expect(within(assignment).getByRole("combobox", { name: "객체 접근 정책" })).toHaveValue("OWNER_ONLY")
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "객체 접근 정책" }), "PUBLIC")
  await user.click(within(assignment).getByRole("button", { name: "객체 정책 저장" }))
  await waitFor(() => expect(saveResourcePolicy).toHaveBeenCalledWith(`${service} orders:101`, "PUBLIC"))
})

it("tells the operator whether a Repeater confirmation will count, and routes to start a HUMAN pass when it is off", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `BOLA/IDOR 수동 테스트 추천: B · GET /api/orders/{id} · ${service} orders:101` }))
  const guidance = screen.getByRole("status", { name: "확인 재전송 조건" })
  expect(guidance).toHaveTextContent("HUMAN 탐색이 꺼져 있어 결과가 이 셀에 반영되지 않습니다.")
  expect(guidance).not.toHaveTextContent("D-071")
  await user.click(within(guidance).getByRole("button", { name: "탐색 시작" }))
  expect(window.location.hash).toBe("#inspection")
})

it("shows no HUMAN-pass notice while a HUMAN pass is active", async () => {
  humanRunActive = true
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("complementary", { name: "분석 필터" })).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `BOLA/IDOR 수동 테스트 추천: B · GET /api/orders/{id} · ${service} orders:101` }))
  expect(screen.getByRole("region", { name: "Burp Repeater 전송" })).toBeVisible()
  expect(screen.queryByRole("status", { name: "확인 재전송 조건" })).not.toBeInTheDocument()
})

it("keeps the operation column unpinned and wraps long paths into two lines inside a bounded block", () => {
  const full = "/community/api/v2/community/posts/7weVqm2Pmn3gC6T2gdzpm4/comments/0123456789abcdef"
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [...matrix.functions, fn("function-long", "b", `${service} GET ${full}`)] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  const label = within(table).getByTitle(full)
  const header = label.closest("th")!
  expect(header).not.toHaveClass("sticky")
  // 폭 제한은 표 칸이 아니라 안쪽 블록에 건다.
  const block = label.querySelector(".max-w-\\[20rem\\]")!
  expect(block).not.toBeNull()
  const lines = [...block.querySelectorAll("[aria-hidden] > span")].map((line) => line.textContent)
  expect(lines).toHaveLength(2)
  expect(lines[0]!.startsWith("…/")).toBe(true)
  expect(lines[1]!.endsWith("/0123456789abcdef")).toBe(true)
  expect(within(header).getByText(full)).toHaveClass("sr-only")
})

it("puts the view tabs in place of the large title and removes the filter panel caption", async () => {
  const user = userEvent.setup()
  const { MatrixPage } = await import("./MatrixPage")
  renderView(<MatrixPage />)
  const workspace = screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })
  expect(within(workspace).getByRole("tablist", { name: "매트릭스 보기" })).toBeVisible()
  expect(screen.getByRole("heading", { name: "판정 매트릭스", level: 1 })).toHaveClass("sr-only")
  const filters = screen.getByRole("complementary", { name: "분석 필터" })
  expect(within(filters).queryByRole("heading", { name: "분석 필터" })).not.toBeInTheDocument()
  const views = within(filters).getByRole("tablist", { name: "판정 매트릭스 보기" })
  expect(views).toHaveClass("grid-cols-2")
  await user.click(within(views).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" }))
  expect(within(views).getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체" })).toHaveAttribute("aria-selected", "true")
})
