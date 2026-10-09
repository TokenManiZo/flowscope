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
let projectId = "matrix-project"
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
  useProjectsQuery: () => ({ data: { directory: "/test/projects", active: { id: projectId }, projects: [] } }),
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
const obj = (id: string, identity: string, resource: string, overrides: Partial<MatrixObjectCell> = {}): MatrixObjectCell => ({ ...base, id, identity, identityLabel: identity.toUpperCase(), role: "User", operation: `${service} GET /api/orders/{id}`, resource, owner: "a", ownerLabel: "A", relation: "SAME_ROLE_FOREIGN", techniques: ["BOLA", "IDOR"], resourcePolicy: "UNKNOWN", ownership: confidence("O3", 3, "확정"), status: "POLICY_ENFORCED", statusLabel: "접근 차단됨", ...overrides })
const recommendation = { type: "BOLA/IDOR", basisIdentity: "a", basisIdentityLabel: "A", testIdentity: "b", testIdentityLabel: "B", reason: "다른 계정에 연결된 객체를 교차 접근하는 조합입니다.", instruction: "B 세션으로 객체 요청을 Burp Repeater에서 수동 실행하세요.", stateChanging: false, basisEvidenceIds: ["ev-a"] }
const matrix: AuthorizationMatrix = {
  summary: { policyConfirmed: 1, policyReview: 0, bflaCandidates: 0, bolaIdorCandidates: 0, coverageGaps: 1, invalidExperiments: 0, bflaTestRecommendations: 1, bolaIdorTestRecommendations: 1, manualReviewPending: 2, humanConfirmed: 0, humanDismissed: 0 },
  identities: [{ id: "a", label: "A", role: "User", kind: "REGISTERED" }, { id: "b", label: "B", role: "User", kind: "REGISTERED" }],
  configurationWarnings: [],
  functions: [
    fn("function-a", "a", `${service} GET /api/admin/export`, { status: "EXPECTED_ACCESS", statusLabel: "접근 허용됨", policy: confidence("P3", 3, "사람 확인 정책"), expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    fn("function-b", "b", `${service} GET /api/admin/export`, { status: "BFLA_TEST_RECOMMENDED", statusLabel: "접근 테스트 필요", policy: confidence("P3", 3, "사람 확인 정책"), expected: "DENY", recommendation: { ...recommendation, type: "BFLA", instruction: "B 세션으로 같은 기능 요청을 Burp Repeater에서 수동 실행하세요." } }),
  ],
  objects: [
    obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "접근 허용됨", relation: "OWNER", expected: "ALLOW", actual: "SUCCESS", evidenceIds: ["ev-a"], statusCodes: [200], sourceVerdicts: { HUMAN: "ALLOW" } }),
    obj("object-b", "b", `${service} orders:101`, { status: "BOLA_IDOR_TEST_RECOMMENDED", statusLabel: "접근 테스트 필요", expected: "DENY", recommendation, reviewEvidenceIds: ["ev-a"] }),
  ],
  evidence: [{ ...obj("object-a", "a", `${service} orders:101`, { status: "EXPECTED_ACCESS", statusLabel: "접근 허용됨", evidenceIds: ["ev-a"], statusCodes: [200] }), type: "BOLA/IDOR" }],
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

beforeEach(() => { localStorage.clear(); projectId = "matrix-project"; current = snapshot; queryError = false; humanRunActive = false; window.location.hash = ""; saveReview.mockClear(); refetchSnapshot.mockClear(); runAuthorizationReplay.mockClear(); })

it("renders the compact server summary and matrix without row subtitles or P/E/O cell chips", async () => {
  renderView(<JudgmentMatrixView />)
  const summary = screen.getByRole("list", { name: "판정 요약" })
  expect(within(summary).getByText("기능 권한 확인").nextElementSibling).toHaveTextContent("1")
  expect(within(summary).getByText("직접 확인 필요").nextElementSibling).toHaveTextContent("2")
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(screen.queryByText("관측 결과의 계정·기능·객체 공백을 비교해 IDOR/BOLA/BFLA 테스트 조합을 추천합니다. 명시적으로 무장한 안전 재전송 외에는 자동 전송하지 않으며 점수를 합산하지 않습니다.")).not.toBeInTheDocument()
  expect(screen.queryByText("정책 P·실행 E·소유권 O를 합산하지 않습니다. 후보는 서버 권한 셀의 판정만 따릅니다.")).not.toBeInTheDocument()
  expect(within(table).getByText("GET")).toHaveClass("text-observation-human")
  expect(within(table).getByText("/api/admin/export")).toBeVisible()
  expect(within(table).queryByText("P3 · 사람 확인 정책")).not.toBeInTheDocument()
  const cell = within(table).getByRole("button", { name: "접근 테스트 필요: B · GET /api/admin/export" })
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

it("resizes the API column from its boundary and keeps the width when switching matrix views", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  const handle = screen.getByRole("separator", { name: "API 열 너비 조절" })
  const column = screen.getByRole("table").querySelector("col")!
  expect(column).toHaveStyle({ width: "320px" })
  handle.focus()
  await user.keyboard("{ArrowLeft}")
  expect(column).toHaveStyle({ width: "304px" })
  await user.keyboard("{Home}{ArrowLeft}")
  expect(column).toHaveStyle({ width: "160px" })
  await user.keyboard("{End}{ArrowRight}")
  expect(column).toHaveStyle({ width: "640px" })
  await user.click(screen.getByRole("tab", { name: /객체 권한/ }))
  expect(screen.getByRole("table").querySelector("col")).toHaveStyle({ width: "640px" })
  await user.dblClick(screen.getByRole("separator", { name: "API 열 너비 조절" }))
  expect(screen.getByRole("table").querySelector("col")).toHaveStyle({ width: "320px" })
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
  expect(within(table).getAllByRole("button").filter(button => button.hasAttribute("aria-pressed"))).toHaveLength(2)
})

it("opens the recommendation detail, saves a human review against the server cell id, and shows the server message", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  expect(within(table).getByText("orders:101 · 객체 소유자 A")).toBeVisible()
  await user.click(within(table).getByRole("button", { name: `접근 테스트 필요: B · GET /api/orders/{id} · orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  expect(within(inspector).getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["접근 허용 기준", "객체 소유자", "요청·응답 확인", "취약점 확인"])
  expect(within(inspector).getByRole("region", { name: "요청·응답 확인" })).toHaveTextContent("열린 창에서 B 계정을 선택해 확인하세요.")
  expect(inspector).not.toHaveTextContent("ev-a")
  expect(within(inspector).queryByRole("region", { name: "독립 신뢰도 축" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "테스트 유효성 게이트" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "기대와 실제" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "결과 오라클" })).not.toBeInTheDocument()
  expect(within(inspector).queryByRole("region", { name: "대상 요청 기록" })).not.toBeInTheDocument()
  const review = within(inspector).getByRole("region", { name: "취약점 확인" })
  await user.click(within(review).getByRole("button", { name: "취약점으로 확정" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("object-b", "CONFIRMED", ""))
  expect(await within(review).findByRole("status")).toHaveTextContent("saved object-b CONFIRMED")
  expect(within(review).queryByLabelText("검증 메모")).not.toBeInTheDocument()
  expect(within(review).getAllByRole("button")).toHaveLength(1)
  await user.click(within(review).getByRole("button", { name: "취약점 확정 취소" }))
  await waitFor(() => expect(saveReview).toHaveBeenLastCalledWith("object-b", "UNRESOLVED", ""))
})

it("opens the latest API traffic directly without a registered account or cell selection", async () => {
  const operation = `${service} GET /api/admin/export`
  current = { ...snapshot, accounts: [], events: [
    { ...snapshot.events[0], op: operation, eventId: "newest", timestamp: 20, idn: "anonymous" },
    { ...snapshot.events[0], op: operation, eventId: "older", timestamp: 10, rawAvailable: true },
  ], authorizationMatrix: { ...matrix, identities: [{ id: "anonymous", label: "비로그인", role: "Anonymous", kind: "ANONYMOUS" }], functions: [fn("anon", "anonymous", operation)] } }
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "GET /api/admin/export 최신 요청을 Request Lab에서 열기" }))
  expect(await screen.findByRole("dialog", { name: "Request Lab" })).toHaveTextContent("newest")
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(runAuthorizationReplay).not.toHaveBeenCalled()
})

it("opens the recommendation's basis record in Request Lab without the removed auto-replay controls", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "접근 테스트 필요: B · GET /api/admin/export" }))
  expect(screen.queryByRole("region", { name: "안전 능동 재전송" })).not.toBeInTheDocument()
  expect(screen.queryByRole("checkbox", { name: "안전 자동 재전송 허용 (이번 1회)" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Repeater/ })).not.toBeInTheDocument()
  const lab = screen.getByRole("region", { name: "요청·응답 확인" })
  await user.click(within(lab).getByRole("button", { name: "Request Lab 열기" }))
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
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `접근 테스트 필요: B · GET /api/orders/{id} · orders:101` }))
  await user.click(within(screen.getByRole("region", { name: "요청·응답 확인" })).getByRole("button", { name: "Request Lab 열기" }))
  expect(await screen.findByRole("dialog", { name: "Request Lab" })).toHaveTextContent("ev-live")
})

it("keeps the same sections on non-reviewable observed cells, locks review, and still opens Request Lab", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  await user.click(within(table).getByRole("button", { name: `접근 허용됨: A · GET /api/orders/{id} · orders:101` }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  const review = within(inspector).getByRole("region", { name: "취약점 확인" })
  expect(within(review).getByRole("button", { name: "취약점으로 확정" })).toBeDisabled()
  expect(review).toHaveTextContent("이 결과는 취약점 확정 대상이 아닙니다.")
  // 추천이 없는 셀도 그 칸의 기록을 Request Lab으로 열 수 있다.
  expect(within(inspector).getByRole("button", { name: "Request Lab 열기" })).toBeEnabled()
  expect(within(inspector).queryByRole("region", { name: "대상 요청 기록" })).not.toBeInTheDocument()
})

it("filters attention rows with a separate switch and clears a selection whose server item disappears", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  const attention = screen.getByRole("switch", { name: "확인 필요한 결과만" })
  expect(attention).toHaveAttribute("aria-checked", "false")
  await user.click(attention)
  expect(attention).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("region", { name: "판정 매트릭스 표" })).toBeVisible()
  await user.click(attention)
  await user.click(screen.getByRole("button", { name: "접근 허용됨: A · GET /api/admin/export" }))
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
  expect(within(table).getByRole("button", { name: "접근 허용됨 · 사용자 확정: A · GET /api/admin/export" })).toHaveClass("border-red-500/50", "bg-red-500/10")
  await user.click(within(table).getByRole("button", { name: "요청 기록 없음: B · GET /api/admin/export" }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  // 이 API를 요청한 기록이 하나도 없으면 Request Lab을 열 수 없다고 알린다.
  expect(within(inspector).getByRole("button", { name: "Request Lab 열기" })).toBeDisabled()
  expect(within(inspector).getByRole("region", { name: "요청·응답 확인" })).toHaveTextContent("이 API의 요청 기록이 없어 Request Lab을 열 수 없습니다.")
  const review = within(inspector).getByRole("region", { name: "취약점 확인" })
  expect(within(review).getByRole("button", { name: "취약점으로 확정" })).toBeEnabled()
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
  await user.click(within(table).getByRole("button", { name: "접근 테스트 필요: B · GET /api/admin/export" }))
  await user.click(screen.getByRole("button", { name: "취약점으로 확정" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("function-b", "CONFIRMED", ""))
  await user.click(within(table).getByRole("button", { name: "응답 확인 필요: A · GET /api/admin/export" }))
  expect(screen.getByRole("button", { name: "취약점으로 확정" })).toBeEnabled()
  await act(async () => { if (outcome === "success") resolve({ success: true, message: "old B saved" }); else reject(new Error("old B failed")) })
  expect(screen.queryByText(/old B (saved|failed)/)).not.toBeInTheDocument()
})

it("retains the selected cell on traffic revisions and clears reused ids on dataset replacement", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, datasetRevision: 1 }
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "접근 테스트 필요: B · GET /api/admin/export" }))
  current = { ...current, revision: 5 }
  rerender(<JudgmentMatrixView />)
  expect(screen.getByRole("button", { name: "취약점으로 확정" })).toBeVisible()
  current = { ...current, revision: 6, datasetRevision: 2 }
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByRole("button", { name: "취약점으로 확정" })).not.toBeInTheDocument()
})

it("retains selection and suspends confirmation while the snapshot is unavailable", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "접근 테스트 필요: B · GET /api/admin/export" }))
  queryError = true
  rerender(<JudgmentMatrixView />)
  expect(screen.getByRole("button", { name: "취약점으로 확정" })).toBeDisabled()
  expect(screen.getByText("마지막으로 불러온 데이터를 표시하고 있습니다.")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  expect(refetchSnapshot).toHaveBeenCalledOnce()
  queryError = false
  rerender(<JudgmentMatrixView />)
  expect(screen.getByRole("button", { name: "취약점으로 확정" })).toBeEnabled()
})

it("sets the minimum access role without duplicating account role management", async () => {
  const user = userEvent.setup()
  const observed = { id: "c", label: "C", role: "Unknown", kind: "OBSERVED" }
  const unknownPolicy = fn("function-c", "c", `${service} GET /api/admin/export`, { role: "Unknown", status: "UNKNOWN_POLICY", statusLabel: "정책 미정", policy: confidence("P0", 0, "정책 미정") })
  current = { ...snapshot, authorizationMatrix: { ...matrix, identities: [...matrix.identities, observed], functions: [...matrix.functions, unknownPolicy] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  // 판단할 것 없는 흔한 상태는 짧은 회색 글자로만 보이고 서버 문구는 이름·툴팁에 남는다.
  const quiet = within(table).getByRole("button", { name: "허용 계정 확인 필요: C · GET /api/admin/export" })
  expect(quiet).toHaveTextContent(/^허용 계정 확인 필요$/)
  expect(quiet).toHaveAttribute("title", "어떤 권한의 계정이 접근할 수 있어야 하는지 정하세요.")
  expect(quiet).toHaveClass("text-muted-foreground")
  await user.click(quiet)
  const assignment = screen.getByRole("region", { name: "접근 허용 기준" })
  expect(within(assignment).getByRole("combobox", { name: "최소 권한" })).toHaveValue("")
  expect(within(assignment).getByRole("button", { name: "최소 권한 저장" })).toBeDisabled()
  await user.selectOptions(within(assignment).getByRole("combobox", { name: "최소 권한" }), "ADMIN")
  await user.click(within(assignment).getByRole("button", { name: "최소 권한 저장" }))
  await waitFor(() => expect(saveRequirement).toHaveBeenCalledWith(`${service} GET /api/admin/export`, "ADMIN"))
  expect(await within(assignment).findByRole("status")).toHaveTextContent(`requirement ${service} GET /api/admin/export ADMIN`)
  expect(within(assignment).queryByRole("combobox", { name: "계정 역할" })).not.toBeInTheDocument()
  expect(saveRole).not.toHaveBeenCalled()
  // 정책이 확인된 셀에도 같은 자리에 지정 칸이 있고, 현재 최소 권한이 미리 채워진다.
  await user.click(within(table).getByRole("button", { name: "접근 허용됨: A · GET /api/admin/export" }))
  expect(within(screen.getByRole("region", { name: "접근 허용 기준" })).getByRole("combobox", { name: "최소 권한" })).toBeVisible()
})

it("keeps object rules out of the panel and reveals status explanations only from the help button", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix, objects: matrix.objects.map((cell) =>
    cell.id === "object-b" ? { ...cell, blockingLayers: ["BOLA"], resourcePolicy: "OWNER_ONLY" } : cell) } }
  renderView(<JudgmentMatrixView />)
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  await user.click(within(screen.getByRole("region", { name: "판정 매트릭스 표" })).getByRole("button", { name: `접근 테스트 필요: B · GET /api/orders/{id} · orders:101` }))

  expect(screen.queryByText("차단층")).not.toBeInTheDocument()
  const assignment = screen.getByRole("region", { name: "접근 허용 기준" })
  expect(within(assignment).queryByRole("combobox", { name: "이 데이터에 접근할 수 있는 계정" })).not.toBeInTheDocument()
  expect(within(assignment).getAllByRole("combobox")).toHaveLength(1)
  expect(saveResourcePolicy).not.toHaveBeenCalled()
  const explanation = "다른 계정의 요청 기록이 있습니다. 이 계정으로도 해당 데이터에 접근되는지 확인하세요."
  expect(screen.queryByText(explanation)).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "접근 테스트 필요 설명" }))
  expect(await screen.findByText(explanation)).toBeVisible()
})

it("keeps the operation column unpinned and wraps long paths into two lines inside a bounded block", () => {
  const full = "/community/api/community/posts/verylongopaquestaticname/comments/anotherlongopaquestaticname"
  current = { ...snapshot, authorizationMatrix: { ...matrix, functions: [...matrix.functions, fn("function-long", "b", `${service} GET ${full}`)] } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("region", { name: "판정 매트릭스 표" })
  const label = within(table).getByTitle(full)
  const header = label.closest("th")!
  expect(header).not.toHaveClass("sticky")
  // 내용 폭(w-max) 표에서 퍼센트 폭 열은 표를 수만 px로 늘린다(1% 열이 내용을 담으려면 표 = 내용 ÷ 0.01).
  for (const column of within(table).getAllByRole("columnheader")) expect(column.className).not.toMatch(/w-\[\d+%\]/)
  // 폭 제한은 표 칸이 아니라 안쪽 블록에 건다.
  const block = label.querySelector(".font-mono.grid")!
  expect(block).not.toBeNull()
  const lines = [...block.querySelectorAll("[aria-hidden] > span")].map((line) => line.textContent)
  expect(lines).toHaveLength(2)
  expect(lines[0]!.startsWith("…/")).toBe(true)
  expect(lines[1]!.endsWith("/anotherlongopaquestaticname")).toBe(true)
  expect(within(header).getByText(full)).toHaveClass("sr-only")
})

it("keeps only the two judgment views above the table", async () => {
  const user = userEvent.setup()
  const { MatrixPage } = await import("./MatrixPage")
  renderView(<MatrixPage />)
  const workspace = screen.getByRole("region", { name: "판정 매트릭스 분석 영역" })
  expect(within(workspace).getByRole("heading", { name: "판정 매트릭스", level: 1 })).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
  const views = within(workspace).getByRole("tablist", { name: "판정 매트릭스 보기" })
  await user.click(within(views).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" }))
  expect(within(views).getByRole("tab", { name: "객체 권한 (BOLA/IDOR) · 계정 × 객체" })).toHaveAttribute("aria-selected", "true")
  expect(screen.queryByRole("button", { name: "다른 보기" })).not.toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "파라미터 커버리지" })).not.toBeInTheDocument()
})


it("renders only 50 rows per page and resets the page when switching dimensions", async () => {
  const user = userEvent.setup()
  current = { ...snapshot, authorizationMatrix: { ...matrix,
    functions: Array.from({ length: 120 }, (_, index) => fn(`bulk-${index}`, "a", `${service} GET /bulk/${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`)),
  } }
  renderView(<JudgmentMatrixView />)
  const table = screen.getByRole("table")
  expect(within(table).getAllByRole("row")).toHaveLength(51)
  expect(within(table).getByText("/bulk/aa")).toBeVisible()
  expect(within(table).queryByText("/bulk/by")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "다음 페이지" }))
  expect(within(table).getByText("/bulk/by")).toBeVisible()
  expect(within(table).queryByText("/bulk/aa")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "다음 페이지" }))
  expect(within(table).getAllByRole("row")).toHaveLength(21)
  expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled()
  await user.click(screen.getByRole("tab", { name: /객체 권한/ }))
  await user.click(screen.getByRole("tab", { name: /기능 권한/ }))
  expect(within(screen.getByRole("table")).getByText("/bulk/aa")).toBeVisible()
  expect(screen.getByRole("button", { name: "이전 페이지" })).toBeDisabled()
})

it("summarizes APIs, drills into all related objects, excludes an object and restores the API list position", async () => {
  const extra = obj("extra", "b", `${service} orders:102`, { status: "BOLA_IDOR_CANDIDATE", statusLabel: "BOLA/IDOR 후보" })
  const other = obj("other", "b", `${service} products:1`, { operation: `${service} GET /api/products` })
  current = { ...snapshot, authorizationMatrix: { ...matrix, objects: [...matrix.objects, extra, other] } }
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("tab", { name: /객체 권한/ }))
  const table = screen.getByRole("table")
  expect(within(table).getAllByRole("row")).toHaveLength(3)
  expect(within(table).getByText("객체 2개")).toBeVisible()
  expect(within(table).getByText("BOLA/IDOR 후보")).toBeVisible()
  const scroller = screen.getByTestId("judgment-matrix-scroll")
  scroller.scrollTop = 180
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  expect(within(table).queryByText("/api/products")).not.toBeInTheDocument()
  expect(within(table).getAllByRole("row")).toHaveLength(3)
  await user.click(screen.getByRole("button", { name: "orders:102 매트릭스에서 제외" }))
  expect(within(table).queryByText(/orders:102/)).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "실행 취소" }))
  expect(within(table).getByText("orders:102 · 객체 소유자 A")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "목록으로" }))
  expect(scroller.scrollTop).toBe(180)
  expect(within(table).getByText("/api/products")).toBeVisible()
  expect(within(table).getAllByRole("row")).toHaveLength(3)
})

it("persists API exclusions only for the active project and restores individual and all entries", async () => {
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("button", { name: "GET /api/admin/export 매트릭스에서 제외" }))
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
  projectId = "different-project"
  rerender(<JudgmentMatrixView />)
  expect(screen.getByRole("table")).toBeVisible()
  projectId = "matrix-project"
  rerender(<JudgmentMatrixView />)
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "제외한 항목 1" }))
  await user.click(screen.getByRole("button", { name: "GET /api/admin/export 복원" }))
  expect(screen.getByRole("table")).toBeVisible()
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("button", { name: "GET /api/admin/export 매트릭스에서 제외" }))
  await user.click(screen.getByRole("button", { name: "제외한 항목 1" }))
  await user.click(screen.getByRole("button", { name: "전체 복원" }))
  expect(screen.getByRole("table")).toBeVisible()
  expect(saveReview).not.toHaveBeenCalled()
})

it("explains short statuses through a separate keyboard-accessible help button without opening the inspector", async () => {
  const user = userEvent.setup()
  renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("tab", { name: /객체 권한/ }))
  const help = screen.getByRole("button", { name: "접근 테스트 필요 · B · GET /api/orders/{id} 설명" })
  help.focus()
  await user.keyboard("{Enter}")
  expect(screen.getByText("다른 계정의 요청 기록이 있습니다. 이 계정으로도 해당 데이터에 접근되는지 확인하세요.")).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(document.querySelector("button button")).toBeNull()
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("button", { name: "GET /api/orders/{id} 관련 결과 보기" }))
  await user.click(screen.getByRole("button", { name: "접근 테스트 필요: B · GET /api/orders/{id} · orders:101" }))
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  await user.click(within(inspector).getByRole("button", { name: "접근 테스트 필요 설명" }))
  expect(screen.getByText("다른 계정의 요청 기록이 있습니다. 이 계정으로도 해당 데이터에 접근되는지 확인하세요.")).toBeVisible()
  expect(saveReview).not.toHaveBeenCalled()
})

it("uses the graph API key for opaque paths, preserves object reviews and latest requests, and excludes the entire group", async () => {
  const first = `${service} GET /api/posts/aaaa`, second = `${service} GET /api/posts/bbbb`, api = `${service} GET /api/posts/{id}`
  const resourceA = `${service} observed-object:key-a`, resourceB = `${service} observed-object:key-b`
  const related = [obj("opaque-a", "a", resourceA, { operation: first, status: "EXPECTED_ACCESS" }), obj("opaque-b", "b", resourceB, { operation: second, status: "BOLA_IDOR_CANDIDATE", evidenceIds: ["newest"] }), obj("recent", "a", `${service} recent`, { operation: `${service} GET /api/posts/recent` })]
  const displayObjects = [first, second].map((operation, i) => ({ eventId: `event-${i}`, operation, apiKey: api, groupKey: "posts", objectKey: i ? "key-b" : "key-a", kind: "PATH" as const, fields: ["/segments/2"], legacyResource: null, ordinal: i + 1 }))
  current = { ...snapshot, displayObjects, events: [{ ...snapshot.events[0], eventId: "newest", op: second, timestamp: 10 }], authorizationMatrix: { ...matrix, objects: related } }
  const user = userEvent.setup()
  const { rerender } = renderView(<JudgmentMatrixView />)
  await user.click(screen.getByRole("tab", { name: /객체 권한/ }))
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3)
  expect(screen.getByText("객체 2개")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "GET /api/posts/{id} 최신 요청을 Request Lab에서 열기" }))
  expect(screen.getByRole("dialog", { name: "Request Lab" })).toHaveTextContent("newest")
  await user.click(screen.getByRole("button", { name: "GET /api/posts/{id} 관련 결과 보기" }))
  await user.click(screen.getByRole("button", { name: "BOLA/IDOR 후보: B · GET /api/posts/bbbb · PATH · OBJ 2" }))
  await user.click(within(screen.getByRole("region", { name: "취약점 확인" })).getByRole("button", { name: "취약점으로 확정" }))
  await waitFor(() => expect(saveReview).toHaveBeenCalledWith("opaque-b", "CONFIRMED", ""))
  await user.click(screen.getByRole("button", { name: "이 API 제외" }))
  expect(screen.queryByText("/api/posts/{id}")).not.toBeInTheDocument()
  current = { ...current!, revision: 5, authorizationMatrix: { ...matrix, objects: [...related, obj("opaque-new", "a", `${service} extra`, { operation: `${service} GET /api/posts/cccc` })] }, displayObjects: [...displayObjects, { ...displayObjects[0], operation: `${service} GET /api/posts/cccc`, objectKey: "key-c" }] }
  rerender(<JudgmentMatrixView />)
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2)
  await user.click(screen.getByRole("button", { name: "실행 취소" }))
  expect(screen.getByText("객체 3개")).toBeVisible()
})
