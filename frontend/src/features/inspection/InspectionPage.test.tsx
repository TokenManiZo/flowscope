import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { InspectionPage } from "./InspectionPage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import { queryKeys } from "@/lib/query/hooks"

const target = "https://demo.flowscope.test"

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

type PollResponse = unknown | readonly unknown[] | ((read: number) => unknown)

function installTransport(options: { human?: PollResponse; humanPending?: boolean; humanError?: { message: string; status: number }; zap?: unknown; scanner?: PollResponse; scannerAccounts?: readonly unknown[]; scannerPollError?: { message: string; status: number }; scannerPost?: { message: string; status: number }; managedSessions?: readonly unknown[] } = {}) {
  let humanReads = 0
  let scannerReads = 0
  const next = (value: PollResponse | undefined, reads: number, fallback: unknown) => typeof value === "function" ? value(reads) : Array.isArray(value) ? value[Math.min(reads, value.length - 1)] : value ?? fallback
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") {
      return Promise.resolve(response({
        ...snapshotFixture,
        accounts: [{ id: "active-account", label: "활성 계정", role: "USER", target, color: "", authArtifactCount: 1 }],
        sessions: [{ fingerprint: "observed-secret", idn: "관측 신원", accountId: null, artifactKind: "COOKIE", evidence: "e-1", confidence: "LOW", firstSeen: 0, lastSeen: 0, registered: false, service: target }],
        managedSessions: options.managedSessions ?? [
          { handle: "active", accountId: "active-account", accountLabel: "활성 계정", service: target, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
          { handle: "expired", accountId: "expired-account", accountLabel: "만료 계정", service: target, status: "EXPIRED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
        ],
      }))
    }
    if (path === "/api/human-run") {
      if (options.humanPending) return new Promise<Response>(() => undefined)
      if (options.humanError) return Promise.resolve(response({ success: false, message: options.humanError.message }, options.humanError.status))
      return Promise.resolve(response(next(options.human, humanReads++, { active: false, completed: false, runId: "", accountId: "", proxy: "http://127.0.0.1:8080" })))
    }
    if (path === "/api/zap-status") return Promise.resolve(response(options.zap ?? { connected: true, state: "READY", message: "ZAP 연결됨" }))
    if (path === "/api/scanner-run") {
      if (init?.method === "POST") {
        if (options.scannerPost) return Promise.resolve(response({ success: false, message: options.scannerPost.message }, options.scannerPost.status))
        const form = init.body as URLSearchParams
        return Promise.resolve(response({ run: { status: form.get("action") === "cancel" ? "CANCEL_REQUESTED" : "RUNNING", target } }, form.get("action") === "cancel" ? 200 : 202))
      }
      if (scannerReads > 0 && options.scannerPollError) return Promise.resolve(response({ success: false, message: options.scannerPollError.message }, options.scannerPollError.status))
      return Promise.resolve(response(next(options.scanner, scannerReads++, { run: { status: "NOT_STARTED" }, accounts: options.scannerAccounts ?? [], scope: [target] })))
    }
    if (path === "/api/zap-accounts" && init?.method === "POST") return Promise.resolve(response({ success: true, message: "saved", account: { id: "zap-a", label: "ZAP A", role: "USER", service: target, loginUrl: `${target}/login`, status: "UNVERIFIED", message: "확인 전", updatedAt: "", hasPassword: true } }))
    return Promise.reject(new Error(`unexpected endpoint: ${path} ${init?.method ?? "GET"}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  return fetchStub
}

function renderInspection(options?: Parameters<typeof installTransport>[0]) {
  const meta = document.createElement("meta")
  meta.name = "flowscope-capability"
  meta.content = "a".repeat(64)
  document.head.append(meta)
  const fetchStub = installTransport(options)
  const { client } = renderWithQueryClient(<InspectionPage />, createTestQueryClient())
  return { client, fetchStub }
}

function setCompactViewport(width: number) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("1279") && width < 1280,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia)
}

afterEach(() => {
  document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const previousHasPointerCapture = Object.getOwnPropertyDescriptor(Element.prototype, "hasPointerCapture")
const previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")

if (!previousHasPointerCapture) {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false })
}

if (!previousScrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
}

afterAll(() => {
  if (previousHasPointerCapture) Object.defineProperty(Element.prototype, "hasPointerCapture", previousHasPointerCapture)
  else delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture
  if (previousScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", previousScrollIntoView)
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe("four-stage inspection controls", () => {
  it("preserves a manual stage until the current-stage action restores the automatic recommendation", async () => {
    const user = userEvent.setup()
    renderInspection()

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    expect(screen.getByRole("tab", { name: /HUMAN/ })).toHaveAttribute("data-state", "active")
    await user.click(screen.getByRole("tab", { name: /범위/ }))
    expect(screen.getByText("허가된 exact scope를 Burp FlowScope 탭에서 적용하세요.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "현재 단계로" }))
    expect(screen.getAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")[0]).toBeVisible()
  })

  it("sends exact HUMAN begin and current-run end forms without offering observed or inactive credentials", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection({ human: { active: true, completed: false, runId: "human-current", accountId: "active-account", proxy: "http://127.0.0.1:8080" } })

    await screen.findByRole("button", { name: "HUMAN pass 종료" })
    expect(screen.queryByText("관측 신원")).not.toBeInTheDocument()
    expect(screen.queryByText("만료 계정")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "HUMAN pass 종료" }))
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith("/api/human-run", expect.objectContaining({
      method: "POST", body: new URLSearchParams({ action: "end", runId: "human-current" }),
    })))

    const endCall = fetchStub.mock.calls.find(([path, init]) => path === "/api/human-run" && (init as RequestInit).method === "POST")
    expect((endCall?.[1] as RequestInit).body?.toString()).toBe("action=end&runId=human-current")
  })

  it("sends only the action and anonymous account for a HUMAN begin", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection()

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    await user.click(screen.getByRole("option", { name: "활성 계정" }))
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    await user.click(screen.getByRole("option", { name: "비로그인 pass" }))
    await user.click(screen.getByRole("button", { name: "HUMAN pass 시작" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/human-run" && (init as RequestInit).body?.toString() === "action=begin&account=")).toBe(true))
  })

  it("sends the exact isolated ZAP baseline request only after connection, exact scope, and an identity choice", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection()

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    const start = screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })
    expect(start).toBeDisabled()
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    expect(start).toBeEnabled()
    await user.click(start)
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith("/api/scanner-run", expect.objectContaining({ method: "POST" })))
    const call = fetchStub.mock.calls.find(([path, init]) => path === "/api/scanner-run" && (init as RequestInit).method === "POST")
    expect((call?.[1] as RequestInit).body?.toString()).toBe(`target=${encodeURIComponent(target)}&accounts=&anonymous=true`)
  })

  it("can cancel a running ZAP campaign", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection({ scanner: {
      run: { status: "RUNNING", stage: "CLIENT_SPIDER", captured_records: 1, alert_count: 0 },
      scope: [target], accounts: [],
    } })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    expect(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "ZAP 검사 취소" }))

    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/scanner-run"
      && (init as RequestInit).body?.toString() === "action=cancel")).toBe(true))

  })

  it("preserves optional API definitions when starting a ZAP campaign", async () => {
    const user = userEvent.setup()
    const completed = renderInspection()
    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    await user.click(screen.getByText("명세 기반 탐색 추가 (선택)"))
    await user.type(screen.getByLabelText("exact-scope API 정의"), "OPENAPI https://demo.flowscope.test/openapi.json")
    await user.click(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" }))
    await waitFor(() => expect(completed.fetchStub.mock.calls.some(([path, init]) => path === "/api/scanner-run"
      && (init as RequestInit).body?.toString().includes("definitions=OPENAPI+") === true)).toBe(true))
  })

  it("registers a memory-only ZAP login account and starts the authenticated lane by its dedicated id", async () => {
    const user = userEvent.setup()
    const account = { id: "zap-a", label: "ZAP A", role: "USER", service: "https://demo.flowscope.test:443", loginUrl: `${target}/login`, status: "UNVERIFIED", message: "확인 전", updatedAt: "", hasPassword: true, hasLoggedInIndicator: true, hasLoggedOutIndicator: true }
    const { fetchStub } = renderInspection({ scannerAccounts: [account] })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    await user.type(screen.getByLabelText("계정 이름"), "새 계정")
    await user.type(screen.getByLabelText("로그인 URL"), `${target}/login`)
    await user.type(screen.getByLabelText("로그인 ID"), "alice@example.test")
    await user.type(screen.getByLabelText("비밀번호"), "memory-secret")
    await user.type(screen.getByLabelText("로그인 상태 정규식 (필수)"), "내 계정")
    await user.type(screen.getByLabelText("로그아웃 상태 정규식 (선택)"), "로그인 필요")
    await user.click(screen.getByRole("button", { name: "로그인 계정 등록" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path]) => path === "/api/zap-accounts")).toBe(true))
    const saved = fetchStub.mock.calls.find(([path]) => path === "/api/zap-accounts")
    expect((saved?.[1] as RequestInit).body?.toString()).toContain("password=memory-secret")
    expect((saved?.[1] as RequestInit).body?.toString()).toContain("loggedInIndicator=%EB%82%B4+%EA%B3%84%EC%A0%95")
    expect((saved?.[1] as RequestInit).body?.toString()).toContain("loggedOutIndicator=%EB%A1%9C%EA%B7%B8%EC%9D%B8+%ED%95%84%EC%9A%94")

    await user.click(screen.getByRole("checkbox", { name: /ZAP A/ }))
    await user.click(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" }))
    const started = fetchStub.mock.calls.find(([path, init]) => path === "/api/scanner-run" && (init as RequestInit).method === "POST")
    expect((started?.[1] as RequestInit).body?.toString()).toBe(`target=${encodeURIComponent(target)}&accounts=zap-a&anonymous=false`)
  })

  it("shows the live authentication stage and its per-account result", async () => {
    const user = userEvent.setup()
    renderInspection({ scanner: {
      run: {
        status: "RUNNING", stage: "AUTHENTICATION", elapsed_seconds: 71,
        stage_elapsed_seconds: 11, stage_timeout_seconds: 120,
        last_heartbeat_age_seconds: 1, activity_state: "WAITING_FOR_ZAP_RESPONSE",
        captured_records: 0, alert_count: 0,
        lanes: [{
          account_id: "zap-a", account_label: "ZAP A", status: "RUNNING", stage: "AUTHENTICATION",
          authentication_state: "AUTHENTICATING", authentication_browser: "chrome-headless",
          authentication_message: "ZAP 브라우저 로그인 실행 중", captured_records: 0,
          client_captures: 0, alert_count: 0, warning: "", error: "",
          elapsed_seconds: 11,
        }],
      },
      accounts: [], scope: [target],
    } })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    await user.click(screen.getByRole("tab", { name: "실행 상태" }))

    expect(screen.getByText(/ZAP 브라우저 로그인 · 전체 1분 11초/)).toBeVisible()
    expect(screen.getByText(/로그인 AUTHENTICATING · chrome-headless/)).toBeVisible()
    expect(screen.getByText("ZAP 브라우저 로그인 실행 중")).toBeVisible()
  })

  it("keeps the last ZAP run visible when a deterministic QueryClient refetch fails", async () => {
    const user = userEvent.setup()
    const { client } = renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9 }, scope: [target] },
      scannerPollError: { status: 503, message: "ZAP 통신이 끊겼습니다." },
    })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    expect(await screen.findByText(/COMPLETED · 수집 9건/)).toBeVisible()
    const query = client.getQueryCache().find({ queryKey: queryKeys.scannerRun })
    await act(async () => { await client.fetchQuery({ queryKey: queryKeys.scannerRun, queryFn: query?.options.queryFn, retry: false }).catch(() => undefined) })

    expect(await screen.findByRole("alert", { name: "ZAP 통신이 끊겼습니다." })).toBeVisible()
    expect(screen.getByText(/COMPLETED · 수집 9건/)).toBeVisible()
  })

  it("keeps a manually selected scope tab when polling advances the automatic recommendation", async () => {
    const user = userEvent.setup()
    const { client } = renderInspection({
      human: [
        { active: false, completed: false, runId: "", accountId: "", proxy: "" },
        { active: false, completed: true, runId: "", accountId: "", proxy: "" },
      ],
    })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /범위/ }))
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.humanRun }) })
    await screen.findByText("연결된 ZAP으로 범위 안의 신원별 기준선을 실행하세요.")

    expect(screen.getByRole("tab", { name: /범위/ })).toHaveAttribute("data-state", "active")
    await user.click(screen.getByRole("button", { name: "현재 단계로" }))
    expect(screen.getByRole("tab", { name: /ZAP/ })).toHaveAttribute("data-state", "active")
  })

  it("keeps an out-of-scope selected target disabled instead of silently starting another target", async () => {
    const user = userEvent.setup()
    const otherTarget = "https://other.flowscope.test"
    let currentScope = [target]
    const { client } = renderInspection({ scanner: () => ({ run: { status: "NOT_STARTED" }, scope: currentScope }) })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    expect(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })).toBeEnabled()
    currentScope = [otherTarget]
    await act(async () => { await client.refetchQueries({ queryKey: queryKeys.scannerRun }) })
    await waitFor(() => expect(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })).toBeDisabled())
    expect(screen.getByText("현재 scanner scope에 정확히 포함된 대상을 선택하세요.")).toBeVisible()
  })

  it("disables ZAP start with the connection reason when ZAP is disconnected", async () => {
    const user = userEvent.setup()
    renderInspection({ zap: { connected: false, state: "DISCONNECTED", message: "ZAP 연결 대기" } })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))

    expect(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })).toBeDisabled()
    expect(screen.getByText("ZAP 연결을 먼저 확인하세요.")).toBeVisible()
  })

  it("offers only an eligible managed ACTIVE account after opening the credential Select", async () => {
    const user = userEvent.setup()
    renderInspection({
      managedSessions: [
        { handle: "active", accountId: "active-account", accountLabel: "사용 가능 계정", service: target, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
        { handle: "capturing", accountId: "capturing-account", accountLabel: "캡처 중 계정", service: target, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: true, credentialConflict: false },
        { handle: "conflicted", accountId: "conflicted-account", accountLabel: "충돌 계정", service: target, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: true },
        { handle: "inactive", accountId: "inactive-account", accountLabel: "만료 계정", service: target, status: "REAUTH_REQUIRED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
        { handle: "other", accountId: "other-account", accountLabel: "다른 서비스 계정", service: "https://other.flowscope.test", status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
      ],
    })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    expect(await screen.findByRole("option", { name: "사용 가능 계정" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "캡처 중 계정" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "충돌 계정" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "만료 계정" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "다른 서비스 계정" })).not.toBeInTheDocument()
    expect(screen.queryByText("관측 신원")).not.toBeInTheDocument()
  })

  it("refuses blank and stale HUMAN run IDs before any end request", async () => {
    const user = userEvent.setup()
    const { client, fetchStub } = renderInspection({ human: [
      { active: true, completed: false, runId: "", accountId: "", proxy: "" },
      { active: false, completed: false, runId: "stale-run", accountId: "", proxy: "" },
    ] })
    await screen.findByRole("button", { name: "HUMAN pass 종료" })
    expect(screen.getByRole("button", { name: "HUMAN pass 종료" })).toBeDisabled()
    expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/human-run" && (init as RequestInit).method === "POST")).toBe(false)

    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.humanRun }) })
    expect(screen.getByRole("button", { name: "HUMAN pass 종료" })).toBeDisabled()
    await user.click(screen.getByRole("tab", { name: /범위/ }))
    expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/human-run" && (init as RequestInit).method === "POST")).toBe(false)
  })

  it("shows the exact ZAP mutation error without replacing the last successful run", async () => {
    const user = userEvent.setup()
    renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9 }, scope: [target] },
      scannerPost: { status: 503, message: "ZAP 기준선을 시작할 수 없습니다." },
    })

    await screen.findAllByText("HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요.")
    await user.click(screen.getByRole("tab", { name: /ZAP/ }))
    expect(await screen.findByText(/COMPLETED · 수집 9건/)).toBeVisible()
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    await user.click(screen.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" }))

    expect(await screen.findByRole("alert", { name: "ZAP 기준선을 시작할 수 없습니다." })).toBeVisible()
    expect(screen.getByText(/COMPLETED · 수집 9건/)).toBeVisible()
  })

  it("keeps the real current stage context without an empty selection inspector", async () => {
    renderInspection()

    expect(await screen.findByRole("complementary", { name: "분석 필터" })).toHaveTextContent("현재 점검 단계")
    expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.getByRole("tablist", { name: "점검 진행 단계" })).toBeVisible()
  })

  it.each([
    ["불러오는 중", { humanPending: true }],
    ["상태 확인 필요", { humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } }],
  ])("keeps HUMAN %s in the context and inline execution status when the initial query has no data", async (expected, options) => {
    const user = userEvent.setup()
    renderInspection(options)

    await waitFor(
      () => expect(screen.getByRole("complementary", { name: "분석 필터" })).toHaveTextContent(`HUMAN${expected}`),
      { timeout: 3_000 },
    )
    await user.click(screen.getByRole("tab", { name: /HUMAN/ }))
    const humanPanel = screen.getByRole("tabpanel", { name: /HUMAN/ })
    expect(within(humanPanel).getByRole("button", { name: "HUMAN pass 시작" })).toBeDisabled()
    await user.click(within(humanPanel).getByRole("tab", { name: "실행 상태" }))
    expect(within(humanPanel).getByText(`HUMAN 상태 · ${expected}`)).toBeVisible()
    expect(screen.queryByText("NOT_STARTED · HUMAN pass 대기")).not.toBeInTheDocument()
  })

  it("does not claim an initial HUMAN error has a last successful state", async () => {
    renderInspection({ humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } })

    await waitFor(
      () => expect(screen.getByRole("alert", { name: "HUMAN 상태를 읽을 수 없습니다." })).toHaveTextContent("상태를 가져오지 못했습니다. 확인이 필요합니다."),
      { timeout: 3_000 },
    )
    expect(screen.queryByText("마지막 성공 상태를 표시하고 있습니다.")).not.toBeInTheDocument()
  })

  it.each([900, 600])("keeps inspection context and stage controls reachable without an inspector Sheet at %ipx", async (width) => {
    setCompactViewport(width)
    const user = userEvent.setup()
    renderInspection()

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
    await user.click(contextTrigger)
    const contextDialog = screen.getByRole("dialog", { name: "분석 필터" })
    expect(contextDialog).toHaveTextContent("현재 점검 단계")
    await user.click(within(contextDialog).getByRole("button", { name: "Close" }))
    expect(contextTrigger).toHaveFocus()

    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: /HUMAN/ }))
    expect(screen.getByRole("button", { name: "HUMAN pass 시작" })).toBeEnabled()
  })

  it("exposes setup and live execution status inside every inspection stage", async () => {
    const user = userEvent.setup()
    renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9, alert_count: 2 }, scope: [target] },
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    for (const [stageName, viewName] of [[/범위/, "범위 실행 보기"], [/HUMAN/, "HUMAN pass 실행 보기"], [/ZAP/, "ZAP 기준선 실행 보기"]] as const) {
      await user.click(screen.getByRole("tab", { name: stageName }))
      const stagePanel = screen.getByRole("tabpanel", { name: stageName })
      const views = within(stagePanel).getByRole("tablist", { name: viewName })
      expect(within(views).getByRole("tab", { name: "실행 설정" })).toBeVisible()
      await user.click(within(views).getByRole("tab", { name: "실행 상태" }))
      expect(within(views).getByRole("tab", { name: "실행 상태" })).toHaveAttribute("data-state", "active")
    }

    await user.click(screen.getByRole("tab", { name: /Evidence 검토/ }))
    await user.click(screen.getByRole("button", { name: "API·입력 차이 보기" }))
    expect(window.location.hash).toBe("#surface")
    expect(screen.queryByRole("button", { name: "Judge 시작" })).not.toBeInTheDocument()
  })
})
