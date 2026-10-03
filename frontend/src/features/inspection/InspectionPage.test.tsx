import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { InspectionPage } from "./InspectionPage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import { queryKeys } from "@/lib/query/hooks"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"

const target = "https://demo.flowscope.test"

const explorerIdle = {
  run: {
    status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
    message: "Explorer 실행 대기", providerReadiness: "READY", accountIds: [], anonymous: false,
    attempts: 0, responses: 0, unresolved: [], activities: [],
  },
  accounts: [],
  scope: [target],
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

type PollResponse = unknown | readonly unknown[] | ((read: number) => unknown)

function installTransport(options: { human?: PollResponse; humanPending?: boolean; humanError?: { message: string; status: number }; humanEvents?: readonly unknown[]; requestDraft?: unknown; zap?: unknown; scanner?: PollResponse; scannerAccounts?: readonly unknown[]; scannerPollError?: { message: string; status: number }; scannerPost?: { message: string; status: number }; managedSessions?: readonly unknown[]; accounts?: readonly unknown[]; explorer?: unknown } = {}) {
  let humanReads = 0
  let scannerReads = 0
  const next = (value: PollResponse | undefined, reads: number, fallback: unknown) => typeof value === "function" ? value(reads) : Array.isArray(value) ? value[Math.min(reads, value.length - 1)] : value ?? fallback
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") {
      return Promise.resolve(response({
        ...snapshotFixture,
        events: options.humanEvents ?? [],
        accounts: options.accounts ?? [{ id: "active-account", label: "활성 계정", role: "USER", target, color: "", authArtifactCount: 1 }],
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
    if (path.startsWith("/api/request-lab?")) return Promise.resolve(response(options.requestDraft ?? {
      eventId: "event-human-1", service: target, request: null, response: null,
      rawRequestRetained: false, rawResponseRetained: false, requestEditable: false,
      requestCharset: null, responseCharset: null, observedIdentity: "관측 신원",
      reusableSession: "", message: "원문 보존 안 됨",
    }))
    if (path === "/api/zap-status") return Promise.resolve(response(options.zap ?? { connected: true, state: "READY", message: "ZAP 연결됨" }))
    if (path === "/api/explorer-run") return Promise.resolve(response(options.explorer ?? explorerIdle))
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

describe("unified inspection hub", () => {
  const humanEvent = {
    eventId: "event-human-1", method: "POST", path: "/api/orders", status: 201,
    fp: "not-rendered", idn: "alice", role: "USER", source: "human", op: "POST /api/orders",
    resource: null, timestamp: 10, sourceDetail: "BURP", orchestrator: "human", tool: "burp",
    phase: "OBSERVED", executionTrust: "OBSERVED", runId: "human-run", authState: "AUTHENTICATED",
    trafficClass: "API", trafficDisposition: "INCLUDED", coverageEligible: true,
    classificationOverride: false, classificationReasons: [], pathTemplateStatus: "RESOLVED",
    pathTemplateReasons: [], clusterId: "cluster-1", repeatCount: 1, firstSeen: 10, lastSeen: 10,
    objects: [], verdict: "undecided",
  }

  it("account collection handoff overrides cached completed passes and opens HUMAN without starting traffic", async () => {
    const human = { active: false, completed: true, runId: "prior-human", accountId: "active-account", proxy: "http://127.0.0.1:8080" }
    const scanner = { run: { status: "COMPLETED" }, accounts: [], scope: [target] }
    const explorer = { ...explorerIdle, run: { ...explorerIdle.run, status: "COMPLETED", runId: "prior-llm" } }
    const fetchStub = installTransport({ human, scanner, explorer })
    const client = createTestQueryClient()
    client.setQueryData(queryKeys.humanRun, human)
    client.setQueryData(queryKeys.scannerRun, scanner)
    client.setQueryData(queryKeys.explorerRun, explorer)
    sessionStorage.setItem("flowscope.humanAccount", "active-account")
    renderWithQueryClient(<InspectionPage />, client)
    await waitFor(() => expect(screen.getByRole("tab", { name: "1 · 직접 둘러보기" })).toHaveAttribute("aria-selected", "true"))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "HUMAN pass 계정" })).toHaveTextContent("활성 계정"))
    expect(screen.getByRole("tab", { name: "4 · 결과 비교" })).toHaveAttribute("aria-selected", "false")
    expect(sessionStorage.getItem("flowscope.humanAccount")).toBeNull()
    expect(fetchStub.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
  })

  it("filters and collapses the bounded HUMAN request feed without loading raw data", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection({ humanEvents: [humanEvent, { ...humanEvent, eventId: "event-human-2", method: "GET", path: "/api/profile", status: 403, idn: "bob" }, { ...humanEvent, eventId: "event-human-3", method: "GET", path: "/api/me", status: 200, idn: "active-account" }] })
    // 등록 계정은 표시 이름으로, 연결되지 않은 서버 임시 신원은 "미등록 로그인 N"으로 보인다.
    expect(await screen.findByRole("button", { name: /GET \/api\/me 활성 계정 HTTP 200 원문 보기/ })).toBeVisible()
    await screen.findByRole("button", { name: /POST \/api\/orders 미등록 로그인 1 HTTP 201 원문 보기/ })
    expect(fetchStub.mock.calls.some(([path]) => String(path).startsWith("/api/request-lab?"))).toBe(false)
    await user.type(screen.getByLabelText("HUMAN 작업 피드 검색"), "profile")
    expect(screen.getByRole("button", { name: /GET \/api\/profile 미등록 로그인 2 HTTP 403 원문 보기/ })).toBeVisible()
    expect(screen.queryByRole("button", { name: /POST \/api\/orders/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "작업 피드 접기" }))
    expect(screen.queryByRole("button", { name: /GET \/api\/profile/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "작업 피드 펼치기" })).toBeVisible()
  })

  it("loads masked raw data only on row click and clears it when closed or the dataset changes", async () => {
    const user = userEvent.setup()
    const maskedRequest = "POST /api/orders HTTP/1.1\nAuthorization: ***MASKED***"
    const { client, fetchStub } = renderInspection({ humanEvents: [humanEvent], requestDraft: {
      eventId: humanEvent.eventId, service: target, request: maskedRequest, response: null,
      rawRequestRetained: true, rawResponseRetained: false, requestEditable: false,
      requestCharset: "UTF-8", responseCharset: null, observedIdentity: "alice",
      reusableSession: "", message: "응답 원문은 보존되지 않았습니다.",
    } })
    expect(fetchStub.mock.calls.some(([path]) => String(path).startsWith("/api/request-lab?"))).toBe(false)
    await user.click(await screen.findByRole("button", { name: /POST \/api\/orders 미등록 로그인 1 HTTP 201 원문 보기/ }))
    expect(await screen.findByLabelText("요청 원문")).toHaveTextContent("Authorization: ***MASKED***")
    expect(screen.getByLabelText("응답 원문 패널")).toHaveTextContent("이 원문은 보존되지 않아 사용할 수 없습니다.")
    expect(within(screen.getByRole("dialog")).getByText("alice")).toBeVisible()
    expect(screen.queryByRole("button", { name: /전송|Repeater|편집/ })).not.toBeInTheDocument()
    expect(client.getQueryCache().findAll().some((query) => JSON.stringify(query.queryKey).includes("request-lab"))).toBe(false)
    await user.click(screen.getByRole("button", { name: "닫기" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /POST \/api\/orders 미등록 로그인 1 HTTP 201 원문 보기/ }))
    await screen.findByLabelText("요청 원문")
    expect(fetchStub.mock.calls.filter(([path]) => String(path).startsWith("/api/request-lab?")).length).toBe(2)
    window.dispatchEvent(new Event(DATASET_REPLACING))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
  it("shows the read-only scope strip instead of a scope step and a filter rail", async () => {
    renderInspection()

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await waitFor(() => expect(screen.getByRole("group", { name: "점검 범위" })).toHaveTextContent(target))
    expect(screen.queryByRole("tab", { name: /범위/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.queryByText("범위 → HUMAN → ZAP → 관측 기록 검토 순서로 각각의 관측 기록을 분리합니다.")).not.toBeInTheDocument()
  })

  it("opens on the current step without a current-step button or dot", async () => {
    const user = userEvent.setup()
    renderInspection()

    await waitFor(() => expect(screen.getByRole("tab", { name: /직접 둘러보기/ })).toHaveAttribute("data-state", "active"))
    expect(screen.queryByRole("button", { name: "현재 단계로" })).not.toBeInTheDocument()
    expect(screen.queryByText("현재 단계")).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: /LLM 탐색/ }))
    expect(screen.getByRole("tab", { name: /LLM 탐색/ })).toHaveAttribute("data-state", "active")
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

  it("shows the listener actually bound to the HUMAN run and names conflicting traffic", async () => {
    renderInspection({ human: { active: true, completed: false, runId: "human-current",
      accountId: "", proxy: "http://127.0.0.1:8888", listenerPort: 8888,
      otherListenerPort: 9999, otherListenerRequests: 2 } })

    expect(await screen.findByText(/프록시 127\.0\.0\.1:8888 브라우저로/)).toBeVisible()
    expect(screen.getByText(/다른 포트 9999에서 범위 안 요청 2건/)).toBeVisible()
  })

  it("does not invent a proxy address before the real Burp listener is detected", async () => {
    renderInspection({ human: { active: true, completed: false, runId: "human-current", accountId: "", proxy: "실제 리스너 감지 대기" } })

    expect(await screen.findByText(/Burp 프록시 브라우저로/)).toBeVisible()
    expect(screen.queryByText(/실제 리스너 감지 대기 브라우저로/)).not.toBeInTheDocument()
  })

  it("sends only the action and anonymous account for a HUMAN begin", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection()

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    await user.click(screen.getByRole("option", { name: "활성 계정" }))
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    await user.click(screen.getByRole("option", { name: "비로그인" }))
    await user.click(screen.getByRole("button", { name: "HUMAN pass 시작" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/human-run" && (init as RequestInit).body?.toString() === "action=begin&account=")).toBe(true))
  })

  it("sends the exact isolated ZAP baseline request only after connection, exact scope, and an identity choice", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderInspection()

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    const start = screen.getByRole("button", { name: "스캔 시작" })
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

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "스캔 취소" }))

    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/scanner-run"
      && (init as RequestInit).body?.toString() === "action=cancel")).toBe(true))
  })

  it("keeps restart and cancel disabled until cleanup finishes", async () => {
    const user = userEvent.setup()
    let cleaned = false
    const { client } = renderInspection({ scanner: () => ({
      run: cleaned ? { status: "COMPLETED", stage: "ALERTS_READY" }
        : { status: "RUNNING", stage: "CLEANUP", activity_state: "CLEANING_UP", stage_elapsed_seconds: 3 },
      scope: [target], accounts: [],
    }) })
    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    // 실행 중에는 계정 선택도 잠근다.
    expect(screen.getByRole("checkbox", { name: "비로그인" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "스캔 취소" })).toBeDisabled()
    expect(screen.getAllByText(/종료 처리 · 임시 상태 정리 중/)[0]).toBeVisible()
    cleaned = true
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.scannerRun }) })
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "비로그인" })).toBeEnabled())
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "스캔 시작" })).toBeEnabled())
  })

  it("preserves optional API definitions when starting a ZAP campaign", async () => {
    const user = userEvent.setup()
    const completed = renderInspection()
    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    await user.click(screen.getByText(/명세로 API 추가/))
    await user.type(screen.getByLabelText("API 정의"), "OPENAPI https://demo.flowscope.test/openapi.json")
    await user.click(screen.getByRole("button", { name: "스캔 시작" }))
    await waitFor(() => expect(completed.fetchStub.mock.calls.some(([path, init]) => path === "/api/scanner-run"
      && (init as RequestInit).body?.toString().includes("definitions=OPENAPI+") === true)).toBe(true))
  })

  it("lists registered accounts, lets only ZAP-configured ones be scanned, and opens settings for the rest", async () => {
    const user = userEvent.setup()
    const account = { id: "active-account", label: "활성 계정", role: "USER", service: "https://demo.flowscope.test:443", loginUrl: `${target}/login`, status: "UNVERIFIED", message: "확인 전", updatedAt: "", hasPassword: true, hasLoggedInIndicator: false, hasLoggedOutIndicator: false }
    const { fetchStub } = renderInspection({
      scannerAccounts: [account],
      accounts: [
        { id: "active-account", label: "활성 계정", role: "USER", target, color: "", authArtifactCount: 1 },
        { id: "no-zap", label: "ZAP 없음", role: "USER", target, color: "", authArtifactCount: 0 },
      ],
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    expect(screen.queryByRole("button", { name: "임시 계정 생성" })).not.toBeInTheDocument()
    expect(await screen.findByRole("checkbox", { name: "ZAP 없음" })).toBeDisabled()
    await user.click(screen.getByRole("checkbox", { name: "활성 계정" }))
    await user.click(screen.getByRole("button", { name: "스캔 시작" }))
    const started = fetchStub.mock.calls.find(([path, init]) => path === "/api/scanner-run" && (init as RequestInit).method === "POST")
    expect((started?.[1] as RequestInit).body?.toString()).toBe(`target=${encodeURIComponent(target)}&accounts=active-account&anonymous=false`)

    await user.click(screen.getByRole("button", { name: "ZAP 없음 ZAP 로그인 설정" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path]) => String(path).startsWith("/api/account-settings?"))).toBe(true))
  })

  it("shows the live authentication stage and its per-account result in the ZAP work feed", async () => {
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

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))

    expect(screen.getAllByText(/ZAP 브라우저 로그인 · 현재 단계 11초 \/ 최대 2분 0초/)[0]).toBeVisible()
    expect(screen.getByRole("group", { name: "ZAP 실행 상태" })).toHaveTextContent("1분 11초")
    expect(screen.getByText(/로그인 AUTHENTICATING · chrome-headless/)).toBeVisible()
    expect(screen.getByText(/ZAP 브라우저 로그인 실행 중/)).toBeVisible()
  })

  it("keeps the last ZAP run visible when a deterministic QueryClient refetch fails", async () => {
    const user = userEvent.setup()
    const { client } = renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9 }, scope: [target] },
      scannerPollError: { status: 503, message: "ZAP 통신이 끊겼습니다." },
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    expect(await within(await screen.findByRole("group", { name: "ZAP 실행 상태" })).findByText("9 / -")).toBeVisible()
    const query = client.getQueryCache().find({ queryKey: queryKeys.scannerRun })
    await act(async () => { await client.fetchQuery({ queryKey: queryKeys.scannerRun, queryFn: query?.options.queryFn, retry: false }).catch(() => undefined) })

    expect(await screen.findByRole("alert", { name: "ZAP 통신이 끊겼습니다." })).toBeVisible()
    expect(within(screen.getByRole("group", { name: "ZAP 실행 상태" })).getByText("9 / -")).toBeVisible()
  })

  it("keeps a manually selected step when polling advances the automatic recommendation", async () => {
    const user = userEvent.setup()
    const { client } = renderInspection({
      human: [
        { active: false, completed: false, runId: "", accountId: "", proxy: "" },
        { active: false, completed: true, runId: "", accountId: "", proxy: "" },
      ],
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /LLM 탐색/ }))
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.humanRun }) })
    await waitFor(() => expect(client.getQueryData(queryKeys.humanRun)).toMatchObject({ completed: true }))

    expect(screen.getByRole("tab", { name: /LLM 탐색/ })).toHaveAttribute("data-state", "active")
    expect(screen.getByRole("tab", { name: /직접 둘러보기/ })).not.toHaveTextContent("✓")
  })

  it("stays on the HUMAN tab when the pass completes instead of jumping to ZAP", async () => {
    const { client } = renderInspection({
      human: [
        { active: true, completed: false, runId: "human-1", accountId: "", proxy: "" },
        { active: false, completed: true, runId: "", accountId: "", proxy: "" },
      ],
    })

    await screen.findByText(target, { exact: false })
    await waitFor(() => expect(screen.getByRole("tab", { name: /직접 둘러보기/ })).toHaveAttribute("data-state", "active"))
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.humanRun }) })
    await waitFor(() => expect(client.getQueryData(queryKeys.humanRun)).toMatchObject({ completed: true }))

    expect(screen.getByRole("tab", { name: /직접 둘러보기/ })).toHaveAttribute("data-state", "active")
  })

  it("keeps an out-of-scope selected target disabled instead of silently starting another target", async () => {
    const user = userEvent.setup()
    const otherTarget = "https://other.flowscope.test"
    let currentScope = [target]
    const { client } = renderInspection({ scanner: () => ({ run: { status: "NOT_STARTED" }, scope: currentScope }) })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeEnabled()
    currentScope = [otherTarget]
    await act(async () => { await client.refetchQueries({ queryKey: queryKeys.scannerRun }) })
    await waitFor(() => expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled())
    expect(screen.getByText("scope에 포함된 대상이 없습니다.")).toBeVisible()
  })

  it("disables ZAP start and explains how to turn ZAP on when it is disconnected", async () => {
    const user = userEvent.setup()
    renderInspection({ zap: { connected: false, state: "DISCONNECTED", message: "ZAP 연결 대기" } })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    expect(await screen.findByRole("tab", { name: /ZAP 스캔$/ })).toBeVisible()
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))

    expect(screen.getByLabelText("ZAP 상태")).toHaveTextContent("ZAP이 꺼져 있습니다")
    expect(screen.getByRole("checkbox", { name: "비로그인" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled()
    expect(screen.getByText("ZAP을 켜면 시작할 수 있습니다.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "켜는 방법" }))
    const howTo = screen.getByLabelText("ZAP 켜는 방법")
    expect(howTo).toHaveTextContent("FlowScope 폴더에서 실행")
    expect(howTo).toHaveTextContent("./scripts/zap-up.sh")
    expect(howTo).toHaveTextContent(".\\scripts\\zap-up.ps1")
    expect(within(howTo).getByRole("link", { name: "전체 파일 받기" })).toHaveAttribute("href", expect.stringContaining("/releases"))
  })

  it("offers every registered account of the target because the HUMAN pass captures the session itself", async () => {
    const user = userEvent.setup()
    renderInspection({
      accounts: [
        { id: "no-session", label: "세션 없는 계정", role: "USER", target, color: "", authArtifactCount: 0 },
        { id: "active-account", label: "사용 가능 계정", role: "USER", target, color: "", authArtifactCount: 1 },
        { id: "other-account", label: "다른 서비스 계정", role: "USER", target: "https://other.flowscope.test", color: "", authArtifactCount: 1 },
      ],
      managedSessions: [],
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    expect(await screen.findByRole("option", { name: "세션 없는 계정" })).toBeVisible()
    expect(screen.getByRole("option", { name: "사용 가능 계정" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "다른 서비스 계정" })).not.toBeInTheDocument()
    expect(screen.queryByText("관측 신원")).not.toBeInTheDocument()
  })

  it("offers every registered account when no scope is configured yet", async () => {
    const user = userEvent.setup()
    renderInspection({
      scanner: { run: { status: "NOT_STARTED" }, accounts: [], scope: [] },
      accounts: [{ id: "user-a", label: "USER A", role: "USER", target: "http://127.0.0.1:9000", color: "", authArtifactCount: 0 }],
      managedSessions: [],
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("combobox", { name: "HUMAN pass 계정" }))
    expect(await screen.findByRole("option", { name: "USER A" })).toBeVisible()
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
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/human-run" && (init as RequestInit).method === "POST")).toBe(false)
  })

  it("shows the exact ZAP mutation error without replacing the last successful run", async () => {
    const user = userEvent.setup()
    renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9 }, scope: [target] },
      scannerPost: { status: 503, message: "ZAP 기준선을 시작할 수 없습니다." },
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    await user.click(screen.getByRole("tab", { name: /ZAP 스캔/ }))
    expect(await within(await screen.findByRole("group", { name: "ZAP 실행 상태" })).findByText("9 / -")).toBeVisible()
    await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
    await user.click(screen.getByRole("button", { name: "스캔 시작" }))

    expect(await screen.findByRole("alert", { name: "ZAP 기준선을 시작할 수 없습니다." })).toBeVisible()
    expect(within(screen.getByRole("group", { name: "ZAP 실행 상태" })).getByText("9 / -")).toBeVisible()
  })

  it.each([
    ["불러오는 중", { humanPending: true }],
    ["상태 확인 필요", { humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } }],
  ])("shows HUMAN %s in the status line when the initial query has no data", async (expected, options) => {
    renderInspection(options)

    await waitFor(() => expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent(expected), { timeout: 3_000 })
    expect(screen.getByRole("button", { name: "HUMAN pass 시작" })).toBeDisabled()
    expect(screen.queryByText("대기 중")).not.toBeInTheDocument()
  })

  it("does not claim an initial HUMAN error has a last successful state", async () => {
    renderInspection({ humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } })

    await waitFor(
      () => expect(screen.getByRole("alert", { name: "HUMAN 상태를 읽을 수 없습니다." })).toHaveTextContent("상태를 가져오지 못했습니다. 확인이 필요합니다."),
      { timeout: 3_000 },
    )
    expect(screen.queryByText("마지막 성공 상태를 표시하고 있습니다.")).not.toBeInTheDocument()
  })

  it.each([900, 600])("keeps the scope strip and step controls reachable without any side rail at %ipx", async (width) => {
    setCompactViewport(width)
    const user = userEvent.setup()
    renderInspection()

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    expect(screen.queryByRole("button", { name: "분석 필터 열기" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "점검 범위" })).toBeVisible()
    await user.click(screen.getByRole("tab", { name: /직접 둘러보기/ }))
    expect(screen.getByRole("button", { name: "HUMAN pass 시작" })).toBeEnabled()
  })

  it("gives HUMAN, ZAP, and LLM the same card layout and request feed", async () => {
    const user = userEvent.setup()
    renderInspection({
      scanner: { run: { status: "COMPLETED", captured_records: 9, alert_count: 2 }, scope: [target] },
    })

    await screen.findByRole("tablist", { name: "점검 진행 단계" })
    for (const [stepName, heading] of [[/직접 둘러보기/, "직접 둘러보기"], [/ZAP 스캔/, "ZAP 스캔"], [/LLM 탐색/, "LLM 탐색"]] as const) {
      await user.click(screen.getByRole("tab", { name: stepName }))
      const panel = screen.getByRole("tabpanel", { name: stepName })
      expect(within(panel).getByRole("heading", { name: heading })).toBeVisible()
      expect(within(panel).queryByText("실행 설정")).not.toBeInTheDocument()
    }

    expect(screen.getByRole("button", { name: /탐색 시작/ })).toBeVisible()
    expect(screen.getByLabelText("Explorer에게 추가 지시")).toBeVisible()

    await user.click(screen.getByRole("tab", { name: /결과 비교/ }))
    await user.click(screen.getByRole("button", { name: "API·입력 차이 보기" }))
    expect(window.location.hash).toBe("#surface")
    expect(screen.queryByRole("button", { name: "Judge 시작" })).not.toBeInTheDocument()
  })

})

it("keeps the existing ZAP settings table and selection when accounts are folded", async () => {
  const { fetchStub } = renderInspection({ scannerAccounts: [{ id: "active-account", label: "활성 계정", role: "USER", service: "https://demo.flowscope.test:443", loginUrl: `${target}/login`, status: "UNVERIFIED", message: "확인 전", updatedAt: "", hasPassword: true }] })
  const user = userEvent.setup()
  await user.click(await screen.findByRole("tab", { name: /ZAP 스캔/ }))
  const account = await screen.findByRole("checkbox", { name: "활성 계정" })
  await user.click(account)
  expect(screen.getAllByRole("button", { name: /설정/ }).length).toBeGreaterThan(0)
  await user.click(screen.getByRole("button", { name: "ZAP 계정 접기" }))
  expect(screen.queryByRole("checkbox", { name: "활성 계정" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "ZAP 계정 펼치기" }))
  expect(screen.getByRole("checkbox", { name: "활성 계정" })).toBeChecked()
  expect(screen.getAllByRole("button", { name: /설정/ }).length).toBeGreaterThan(0)
  expect(fetchStub.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})
