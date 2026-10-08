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
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: ({ event }: { event: { eventId: string } }) => <div role="dialog" aria-label="Request Lab">{event.eventId}</div> }))

const service = "https://demo.test:443"
const confidence = (code: string, level: number, label = code) => ({ code, level, label, basis: `${code} basis` })
const base = { expected: "UNKNOWN" as const, blockingLayers: [] as const, actual: "UNTESTED" as const, policy: confidence("P0", 0, "정책 미정"), evidence: confidence("E0", 0, "미실행"), oracle: { type: "READ_SEMANTIC", label: "읽기 의미 응답", satisfied: false, requirement: "응답에 대상 객체 식별자가 포함되고 soft-deny가 아님" }, gates: [{ key: "session", label: "테스트 계정 유효", state: "PASS" as const, reason: "등록 계정 귀속" }, { key: "repeat", label: "독립 반복", state: "UNKNOWN" as const, reason: "자동 통제 반복 묶음이 없음" }], sourceVerdicts: {}, statusCodes: [], evidenceIds: [], validationVerdict: "NONE", recommendation: null, reviewStatus: "UNRESOLVED" as const, reviewNote: "", reviewEvidenceIds: [] }
const fn = (id: string, identity: string, operation: string, overrides: Partial<MatrixFunctionCell> = {}): MatrixFunctionCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation, status: "COVERAGE_GAP", statusLabel: "미점검", ...overrides })
const obj = (id: string, identity: string, resource: string, overrides: Partial<MatrixObjectCell> = {}): MatrixObjectCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation: `${service} GET /api/orders/{id}`, resource, owner: "a", ownerLabel: "A", relation: "SAME_ROLE_FOREIGN", techniques: ["BOLA", "IDOR"], resourcePolicy: "UNKNOWN", ownership: confidence("O3", 3, "확정"), status: "POLICY_ENFORCED", statusLabel: "차단 대상 · 차단 관측", ...overrides })
const recommendation = { type: "BOLA/IDOR", basisIdentity: "a", basisIdentityLabel: "A", testIdentity: "b", testIdentityLabel: "B", reason: "다른 계정에 연결된 객체를 교차 접근하는 조합입니다.", instruction: "B 세션으로 객체 요청을 Burp Repeater에서 수동 실행하세요.", stateChanging: false, basisEvidenceIds: ["ev-a"] }
const matrix: AuthorizationMatrix = {
  summary: { policyConfirmed: 1, policyReview: 0, bflaCandidates: 0, bolaIdorCandidates: 0, coverageGaps: 1, invalidExperiments: 0, bflaTestRecommendations: 1, bolaIdorTestRecommendations: 1, manualReviewPending: 2, humanConfirmed: 0, humanDismissed: 0 },
  identities: [{ id: "a", label: "A", role: "User", kind: "REGISTERED" }, { id: "b", label: "B", role: "User", kind: "REGISTERED" }],
  configurationWarnings: [],
  functions: [
    fn("function-a", "a", `${service} GET /api/admin/export`, { status: "EXPECTED_ACCESS", statusLabel: "허용 대상 · 접근 관측", policy: confidence("P3", 3, "사람 확인 정책"), expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    fn("function-b", "b", `${service} GET /api/admin/export`, { status: "BFLA_TEST_RECOMMENDED", statusLabel: "기능 접근 테스트 필요", policy: confidence("P3", 3, "사람 확인 정책"), expected: "DENY", recommendation: { ...recommendation, type: "BFLA", instruction: "B 세션으로 같은 기능 요청을 Burp Repeater에서 수동 실행하세요." } }),
  ],
  objects: [
    obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "허용 대상 · 접근 관측", relation: "OWNER", expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    obj("object-b", "b", `${service} orders:101`, { status: "BOLA_IDOR_TEST_RECOMMENDED", statusLabel: "객체 접근 테스트 필요", expected: "DENY", recommendation, reviewEvidenceIds: ["ev-a"] }),
  ],
  evidence: [{ ...obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "허용 대상 · 접근 관측", evidenceIds: ["ev-a"], statusCodes: [200] }), type: "BOLA/IDOR" }],
  policyLegend: [{ code: "P3", title: "사람 확인", description: "명시적으로 확인한 기대 역할" }],
  evidenceLegend: [{ code: "E0", title: "미점검", description: "응답 없음" }],
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
  expect(screen.queryByText("관측 결과의 계정·기능·객체 공백을 비교해 IDOR/BOLA/BFLA 테스트 조합을 추천합니다. 명시적으로 무장한 안전 재전송 외에는 자동 전송하지 않으며 점수를 합산하지 않습니다.")).not.toBeInTheDocument()
  expect(screen.queryByText("정책 P·실행 E·소유권 O를 합산하지 않습니다. 후보는 서버 권한 셀의 판정만 따릅니다.")).not.toBeInTheDocument()
  expect(within(table).getByText("GET")).toHaveClass("text-observation-human")
  expect(within(table).getByText("/api/admin/export")).toBeVisible()
  expect(within(table).queryByText("P3 · 사람 확인 정책")).not.toBeInTheDocument()
  const cell = within(table).getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" })
  expect(cell).toHaveAttribute("data-tone", "risk")
  expect(cell).not.toHaveTextContent("기대 차단 → 실제 미실행")
  expect(within(cell).queryByText("P3")).not.toBeInTheDocument()
  expect(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).queryByLabelText("정책 신뢰도 P")).not.toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: "실행 요청 기록" })).not.toBeInTheDocument()
  expect(screen.queryByText(/열=계정·역할/)).not.toBeInTheDocument()
  expect(screen.getByTestId("judgment-matrix-scroll")).toHaveClass("overflow-auto")
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
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).queryByText(`${service} orders:101 · 소유 A`)).not.toBeInTheDocument()
  await user.click(within(table).getByRole("button", { name: `객체 접근 테스트 필요: B · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  // 상세는 역할·정책 지정, Request Lab 전송, 사람 최종 판정 세 칸뿐이다.
  expect(within(inspector).getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["정책·역할 지정", "Request Lab 전송", "사람 최종 판정"])
  expect(within(inspector).getByRole("region", { name: "Request Lab 전송" })).toHaveTextContent("A → B: Request Lab의 전송 계정에서 B을(를) 고르세요.")
  expect(inspector).not.toHaveTextContent("ev-a")
  expect(within(inspector).queryByRole("region", { name: "독립 신뢰도 축" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "테스트 유효성 게이트" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "기대와 실제" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "결과 오라클" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "대상 요청 기록" })).not.toBeInTheDocument()
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  await user.click(within(review).getByRole("checkbox"))
  await user.type(within(review).getByLabelText("검증 메모"), "repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "판정 저장" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("object-b", "CONFIRMED", "repeater reproduced"))
  expect(await within(review).findByRole("status")).toHaveTextContent("saved object-b CONFIRMED repeater reproduced")
  await user.click(within(review).getByRole("button", { name: "정상·기각" }))
  await waitFor(() => expect(saveReview).toHaveBeenLastCalledWith("object-b", "DISMISSED", "repeater reproduced"))
})

it("opens the recommendation's basis record in Request Lab without the removed auto-replay controls", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
  expect(screen.queryByRole("region", { name: "안전 능동 재전송" })).not.toBeInTheDocument()
  expect(screen.queryByRole("checkbox", { name: "안전 자동 재전송 허용 (이번 1회)" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Repeater/ })).not.toBeInTheDocument()
  const lab = screen.getByRole("region", { name: "Request Lab 전송" })
  await user.click(within(lab).getByRole("button", { name: "Request Lab에서 보내기" }))
  // 추천의 근거 기록(ev-a)을 Request Lab으로 연다. 자동 재전송(run)은 부르지 않는다.
  expect(await screen.findByRole("dialog", { name: "Request Lab" })).toHaveTextContent("ev-a")
  expect(runAuthorizationReplay).not.toHaveBeenCalled()
})

it("opens a same-API record whose raw is still in memory when the basis record lost its raw", async () => {
  // 근거 기록(ev-a)은 원문이 일부만 남아 보낼 수 없다. 같은 API·같은 신원의 최신 원문 기록을 대신 연다.
  const live = { ...snapshot.events[0], eventId: "ev-live", clusterEvidenceIds: ["ev-live"], timestamp: 5, rawAvailable: true }
  current = { ...snapshot, events: [...snapshot.events, live] }
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `객체 접근 테스트 필요: B · GET /api/orders/{id} · ${service} orders:101` }))
  await user.click(within(screen.getByRole("region", { name: "Request Lab 전송" })).getByRole("button", { name: "Request Lab에서 보내기" }))
  expect(await screen.findByRole("dialog", { name: "Request Lab" })).toHaveTextContent("ev-live")
})

it("keeps the same sections on non-reviewable observed cells, locks review, and still opens Request Lab", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: `허용 대상 · 접근 관측: A · GET /api/orders/{id} · ${service} orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  const review = within(inspector).getByRole("region", { name: "사람 최종 판정" })
  expect(within(review).getByRole("button", { name: "판정 저장" })).toBeDisabled()
  expect(within(review).getByLabelText("검증 메모")).toBeDisabled()
  expect(review).toHaveTextContent("검토할 추천이 없는 셀입니다.")
  // 추천이 없는 셀도 그 칸의 기록을 Request Lab으로 열 수 있다.
  expect(within(inspector).getByRole("button", { name: "Request Lab에서 보내기" })).toBeEnabled()
  expect(within(inspector).queryByRole("region", { name: "대상 요청 기록" })).not.toBeInTheDocument()
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
  await user.click(screen.getByRole("button", { name: "허용 대상 · 접근 관측: A · GET /api/admin/export" }))
  current = { ...snapshot, revision: 5, authorizationMatrix: { ...matrix, functions: [matrix.functions[1]] } }
  rerender(<JudgmentMatrixView />)
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument())
})

it("marks confirmed cells red, keeps review available, and explains a gap without any request record", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [
    { ...matrix.functions[0], reviewStatus: "CONFIRMED" },
    fn("function-gap", "b", `${service} GET /api/admin/export`),
  ] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).getByRole("button", { name: "허용 대상 · 접근 관측 · 사용자 확정: A · GET /api/admin/export" })).toHaveClass("border-red-500/50", "bg-red-500/10")
  await user.click(within(table).getByRole("button", { name: "미점검: B · GET /api/admin/export" }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  // 이 API를 요청한 기록이 하나도 없으면 Request Lab을 열 수 없다고 알린다.
  expect(within(inspector).getByRole("button", { name: "Request Lab에서 보내기" })).toBeDisabled()
  expect(within(inspector).getByRole("region", { name: "Request Lab 전송" })).toHaveTextContent("이 API의 요청 기록이 없어 Request Lab을 열 수 없습니다.")
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
  await user.click(within(table).getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
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
  await user.click(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "unsaved old project")
  current = { ...current, revision: 5 }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("unsaved old project")
  current = { ...current, revision: 6, datasetRevision: 2 }
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByLabelText("검증 메모")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
  expect(screen.getByLabelText("검증 메모")).toHaveValue("")
})

it("starts a fresh review when the same cell has different server review 요청 기록", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "old 요청 기록 note")
  current = { ...snapshot, revision: 5, authorizationMatrix: { ...matrix, functions: [matrix.functions[0], { ...matrix.functions[1], reviewEvidenceIds: ["ev-new"] }] } }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("")
})

it("retains the selected cell and unsaved review note while snapshot actions are suspended", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" }))
  await user.type(screen.getByLabelText("검증 메모"), "keep during outage")
  queryError = true
  rerender(<JudgmentMatrixView />)
  expect(screen.getByLabelText("검증 메모")).toHaveValue("keep during outage")
  expect(screen.getByLabelText("검증 메모")).toBeDisabled()
  expect(screen.getByText("마지막으로 불러온 데이터를 표시하고 있습니다.")).toBeVisible()
  expect(screen.getByRole("button", { name: "기능 접근 테스트 필요: B · GET /api/admin/export" })).toBeDisabled()
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
  // 판단할 것 없는 흔한 상태는 짧은 회색 글자로만 보이고 서버 문구는 이름·툴팁에 남는다.
  const quiet = within(table).getByRole("button", { name: "접근 정책 확인 필요: C · GET /api/admin/export" })
  expect(quiet).toHaveTextContent(/^접근 정책 확인 필요$/)
  expect(quiet).toHaveAttribute("title", "접근 정책 확인 필요")
  expect(quiet).toHaveClass("text-muted-foreground")
  await user.click(quiet)
  const assignment = screen.getByRole("region", { name: "정책·역할 지정" })
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "필수 역할" }), "ADMIN")
  await user.click(within(assignment).getByRole("button", { name: "필수 역할 저장" }))
  await waitFor(() => expect(saveRequirement).toHaveBeenCalledWith(`${service} GET /api/admin/export`, "ADMIN"))
  expect(await within(assignment).findByRole("status")).toHaveTextContent(`requirement ${service} GET /api/admin/export ADMIN`)
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "계정 역할" }), "USER")
  await user.click(within(assignment).getByRole("button", { name: "계정 역할 저장" }))
  await waitFor(() => expect(saveRole).toHaveBeenCalledWith("c", "USER"))
  // 정책이 확인된 셀에도 같은 자리에 지정 칸이 있고, 현재 필수 역할이 미리 채워진다.
  await user.click(within(table).getByRole("button", { name: "허용 대상 · 접근 관측: A · GET /api/admin/export" }))
  expect(within(screen.getByRole("region", { name: "정책·역할 지정" })).getByRole("combobox", { name: "필수 역할" })).toBeVisible()
})

it("hides the blocking-layer subtitle and saves an object policy from the object cell", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix, objects: matrix.objects.map((cell) =>
    cell.id === "object-b" ? { ...cell, blockingLayers: ["BOLA"], resourcePolicy: "OWNER_ONLY" } : cell) } }
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `객체 접근 테스트 필요: B · GET /api/orders/{id} · ${service} orders:101` }))

  expect(screen.queryByText("차단층")).not.toBeInTheDocument()
  const assignment = screen.getByRole("region", { name: "정책·역할 지정" })
  expect(within(assignment).getByRole("combobox", { name: "객체 접근 정책" })).toHaveValue("OWNER_ONLY")
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "객체 접근 정책" }), "PUBLIC")
  await user.click(within(assignment).getByRole("button", { name: "객체 정책 저장" }))
  await waitFor(() => expect(saveResourcePolicy).toHaveBeenCalledWith(`${service} orders:101`, "PUBLIC"))
})

it("keeps the operation column unpinned and wraps long paths into two lines inside a bounded block", () => {
  const full = "/community/api/v2/community/posts/7weVqm2Pmn3gC6T2gdzpm4/comments/0123456789abcdef"
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [...matrix.functions, fn("function-long", "b", `${service} GET ${full}`)] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  const label = within(table).getByTitle(full)
  const header = label.closest("th")!
  expect(header).not.toHaveClass("sticky")
  // 내용 폭(w-max) 표에서 퍼센트 폭 열은 표를 수만 px로 늘린다(1% 열이 내용을 담으려면 표 = 내용 ÷ 0.01).
  for (const column of within(table).getAllByRole("columnheader")) expect(column.className).not.toMatch(/w-\[\d+%\]/)
  // 폭 제한은 표 칸이 아니라 안쪽 블록에 건다.
  const block = label.querySelector(".max-w-\\[24rem\\]")!
  expect(block).not.toBeNull()
  const lines = [...block.querySelectorAll("[aria-hidden] > span")].map((line) => line.textContent)
  expect(lines).toHaveLength(2)
  expect(lines[0]!.startsWith("…/")).toBe(true)
  expect(lines[1]!.endsWith("/0123456789abcdef")).toBe(true)
  expect(within(header).getByText(full)).toHaveClass("sr-only")
})

it("puts judgment controls above the table with the function and object tabs, and no other-view switcher", async () => {
  const user = userEvent.setup()
  const { MatrixPage } = await import("./MatrixPage")
  renderView(<MatrixPage />)
  const workspace = screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })
  expect(within(workspace).getByRole("heading", { name: "판정 매트릭스", level: 1 })).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
  const views = within(workspace).getByRole("tablist", { name: "판정 매트릭스 보기" })
  await user.click(within(views).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  expect(within(views).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" })).toHaveAttribute("aria-selected", "true")
  expect(within(workspace).queryByRole("button", { name: "다른 보기" })).not.toBeInTheDocument()
})
