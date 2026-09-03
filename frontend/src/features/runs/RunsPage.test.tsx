import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { RunsPage } from "./RunsPage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import { queryKeys } from "@/lib/query/hooks"

const target = "https://demo.flowscope.test"

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function renderRuns(options: {
  completedLanes?: readonly string[]
  llm?: Record<string, unknown> | readonly Record<string, unknown>[]
  llmPollError?: { message: string; status: number }
  llmPost?: Partial<Record<"start" | "cancel" | "followup", { message: string; status: number }>>
  scanner?: Record<string, unknown>
  humanPending?: boolean
  humanError?: { message: string; status: number }
  scope?: readonly string[] | (() => readonly string[])
  managedSessions?: readonly unknown[]
} = {}) {
  const meta = document.createElement("meta")
  meta.name = "flowscope-capability"
  meta.content = "a".repeat(64)
  document.head.append(meta)
  let llmReads = 0
  let llmRun = { status: "COMPLETED", provider: "CODEX", role: "JUDGE", provider_session_id: "judge-session", output_tail: "<unsafe-output>", providers: { CODEX: true, CLAUDE: false } }
  const llmValue = (read: number) => Array.isArray(options.llm) ? options.llm[Math.min(read, options.llm.length - 1)] : options.llm ?? llmRun
  const currentScope = () => typeof options.scope === "function" ? options.scope() : options.scope ?? [target]
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") return Promise.resolve(response({ ...snapshotFixture, managedSessions: options.managedSessions ?? [{ handle: "active", accountId: "account-a", accountLabel: "계정 A", service: target, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }] }))
    if (path === "/api/human-run") {
      if (options.humanPending) return new Promise<Response>(() => undefined)
      if (options.humanError) return Promise.resolve(response({ success: false, message: options.humanError.message }, options.humanError.status))
      return Promise.resolve(response({ active: false, completed: true, runId: "", accountId: "", proxy: "" }))
    }
    if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, state: "READY", message: "ZAP 연결됨" }))
    if (path === "/api/scanner-run") return Promise.resolve(response(options.scanner ?? { run: { status: "COMPLETED", captured_records: 8, alert_count: 2, lanes: [{ account_id: null, account_label: "비로그인", status: "COMPLETED_WITH_WARNINGS", stage: "PASSIVE", captured_records: 8, traditional_captures: 4, rendered_captures: 3, alert_count: 2, warning: "렌더링 경고", error: "" }] }, scope: currentScope() }))
    if (path === "/api/llm-run") {
      if (init?.method === "POST") {
        const values = new URLSearchParams(init.body as string)
        const action = values.get("action") as "start" | "cancel" | "followup"
        const postError = options.llmPost?.[action]
        if (postError) return Promise.resolve(response({ success: false, message: postError.message }, postError.status))
        if (action === "start") { llmRun = { ...llmRun, status: "RUNNING", provider: values.get("provider") ?? "CODEX", role: values.get("role") ?? "EXPLORER" }; return Promise.resolve(response({ run: llmRun }, 202)) }
        if (action === "cancel") { llmRun = { ...llmRun, status: "CANCELLED" }; return Promise.resolve(response({ run: llmRun })) }
        return Promise.resolve(response({ run: { ...llmRun, status: "RUNNING", role: "JUDGE" } }, 202))
      }
      if (llmReads > 0 && options.llmPollError) return Promise.resolve(response({ success: false, message: options.llmPollError.message }, options.llmPollError.status))
      const currentRun = llmValue(llmReads++)
      return Promise.resolve(response({ run: currentRun, scope: currentScope(), completed_lanes: options.completedLanes ?? ["HUMAN", "SCANNER", "LLM"] }))
    }
    return Promise.reject(new Error(`unexpected endpoint: ${path}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  const { client } = renderWithQueryClient(<RunsPage />, createTestQueryClient())
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
})

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

describe("run status controls", () => {
  it("renders status text, lane counts, provider availability, and escaped bounded output", async () => {
    const { fetchStub } = renderRuns()

    await screen.findByRole("tab", { name: "ZAP" })
    await userEvent.setup().click(screen.getByRole("tab", { name: "ZAP" }))
    expect(await screen.findByText(/COMPLETED_WITH_WARNINGS/)).toBeVisible()
    expect(screen.getByText(/전체 8 · Traditional 4 · Rendered 3 · Alert 2/)).toBeVisible()
    await userEvent.setup().click(screen.getByRole("tab", { name: "LLM" }))
    expect(await screen.findByText(/CODEX CLI 사용 가능/)).toBeVisible()
    expect(screen.getByText(/CLAUDE CLI 사용할 수 없음/)).toBeVisible()
    await userEvent.setup().click(screen.getByRole("button", { name: "출력 tail 보기 \(최대 1500자\)" }))
    expect(screen.getByText("<unsafe-output>")).toBeVisible()
    expect(document.querySelector("unsafe-output")).toBeNull()
    expect(screen.queryByText(/Active Scan/i)).not.toBeInTheDocument()
  })

  it("sends exact LLM start, cancel, and eligible Judge follow-up requests", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderRuns()

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    await screen.findByRole("button", { name: "LLM Explorer 시작" })
    const followUp = screen.getByRole("textbox", { name: "Judge 후속 질문" })
    await user.type(followUp, "근거를 설명하세요")
    await user.click(screen.getByRole("button", { name: "Judge 계속" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/llm-run" && (init as RequestInit).body?.toString() === "action=followup&message=%EA%B7%BC%EA%B1%B0%EB%A5%BC+%EC%84%A4%EB%AA%85%ED%95%98%EC%84%B8%EC%9A%94")).toBe(true))

    await user.click(screen.getByRole("button", { name: "LLM Explorer 시작" }))
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith("/api/llm-run", expect.objectContaining({ method: "POST" })))
    const start = fetchStub.mock.calls.find(([path, init]) => path === "/api/llm-run" && new URLSearchParams((init as RequestInit).body as string).get("action") === "start")
    expect((start?.[1] as RequestInit).body?.toString()).toBe(`action=start&provider=CODEX&role=EXPLORER&target=${encodeURIComponent(target)}&account=`)
    await waitFor(() => expect(screen.getByRole("button", { name: "LLM 실행 취소" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "LLM 실행 취소" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/llm-run" && (init as RequestInit).body?.toString() === "action=cancel")).toBe(true))
  })

  it("renders completed lanes as readable statuses and gives warning-completed runs full progress", async () => {
    const user = userEvent.setup()
    renderRuns({ completedLanes: ["HUMAN", "SCANNER"] })

    await screen.findByRole("tab", { name: "ZAP" })
    await user.click(screen.getByRole("tab", { name: "ZAP" }))
    expect(screen.getByRole("progressbar", { name: "ZAP 실행 진행률" })).toHaveAttribute("aria-valuenow", "100")
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    expect(await screen.findByText("완료 레인 · HUMAN 완료")).toBeVisible()
    expect(screen.getByText("완료 레인 · ZAP 기준선 완료")).toBeVisible()
    expect(screen.queryByText("완료 레인 · LLM 완료")).not.toBeInTheDocument()
  })

  it("shows a direct Explorer gate reason when no exact scope target is available", async () => {
    const user = userEvent.setup()
    renderRuns({ scope: [] })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))

    expect(screen.getByRole("button", { name: "LLM Explorer 시작" })).toBeDisabled()
    expect(screen.getByText("Explorer 시작 대기: 대상 scope를 먼저 적용하세요.")).toBeVisible()
  })

  it("disables Explorer and Judge without posting when a selected target leaves the current scope", async () => {
    const user = userEvent.setup()
    const replacementTarget = "https://replacement.flowscope.test"
    const staleTarget = `https://demo.flowscope.test/<stale-target-payload data-test=\"x\">${"long-target-".repeat(48)}</stale-target-payload>`
    let currentScope = [staleTarget]
    const { client, fetchStub } = renderRuns({ scope: () => currentScope })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "LLM Explorer 시작" })).toBeEnabled())
    expect(screen.getByRole("button", { name: "Judge 시작" })).toBeEnabled()

    currentScope = [replacementTarget]
    await act(async () => { await client.refetchQueries({ queryKey: queryKeys.llmRun }) })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "LLM Explorer 시작" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Judge 시작" })).toBeDisabled()
    })
    expect(screen.getByText("현재 scope에 정확히 포함된 대상을 선택하세요.")).toBeVisible()
    const status = screen.getByRole("status", { name: "LLM 대상 scope 상태" })
    expect(status).toHaveTextContent(`현재 범위 아님 · ${staleTarget}`)
    expect(status).toHaveClass("w-full", "max-w-full")
    expect(screen.getByTitle(staleTarget)).toHaveClass("min-w-0", "truncate")
    expect(document.querySelector("stale-target-payload")).toBeNull()
    await user.click(screen.getByRole("combobox", { name: "LLM 대상" }))
    expect(await screen.findByRole("option", { name: replacementTarget })).toBeEnabled()
    expect(screen.queryByRole("option", { name: staleTarget })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    fetchStub.mockClear()
    await user.click(screen.getByRole("button", { name: "LLM Explorer 시작" }))
    await user.click(screen.getByRole("button", { name: "Judge 시작" }))
    expect(fetchStub.mock.calls.filter(([path, init]) => path === "/api/llm-run" && (init as RequestInit).method === "POST")).toHaveLength(0)
  })

  it("sends the exact accepted Judge start request only when all completed lanes are present", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderRuns()

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    await user.click(screen.getByRole("combobox", { name: "LLM 계정" }))
    await user.click(await screen.findByRole("option", { name: "계정 A" }))
    await user.click(screen.getByRole("button", { name: "Judge 시작" }))

    await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/llm-run" && (init as RequestInit).body?.toString() === `action=start&provider=CODEX&role=JUDGE&target=${encodeURIComponent(target)}&account=account-a`)).toBe(true))
    expect(await screen.findByRole("button", { name: "LLM 실행 취소" })).toBeEnabled()
  })

  it("keeps Judge start disabled when any required lane is incomplete", async () => {
    const user = userEvent.setup()
    renderRuns({ completedLanes: ["HUMAN", "SCANNER"] })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))

    expect(screen.getByRole("button", { name: "Judge 시작" })).toBeDisabled()
    expect(screen.getByText("Judge 대기: HUMAN·SCANNER·LLM 완료 레인이 모두 필요합니다.")).toBeVisible()
  })

  it("disables unavailable providers and refuses whitespace-only Judge follow-up", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderRuns({ llm: { status: "COMPLETED", provider: "CODEX", role: "JUDGE", provider_session_id: "judge-session", providers: { CODEX: false, CLAUDE: false } } })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    expect(screen.getByRole("button", { name: "LLM Explorer 시작" })).toBeDisabled()
    expect(screen.getByText("CODEX CLI를 찾지 못했습니다. Burp 실행 PATH 또는 시스템 속성에서 경로를 지정하세요.")).toBeVisible()
    await user.type(screen.getByRole("textbox", { name: "Judge 후속 질문" }), "   ")
    expect(screen.getByRole("button", { name: "Judge 계속" })).toBeDisabled()
    expect(fetchStub.mock.calls.some(([path, init]) => path === "/api/llm-run" && (init as RequestInit).body?.toString().startsWith("action=followup"))).toBe(false)
  })

  it("shows the exact LLM start error without replacing the last successful run", async () => {
    const user = userEvent.setup()
    renderRuns({ llmPost: { start: { status: 503, message: "LLM Explorer를 시작할 수 없습니다." } } })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    expect(screen.getByText("LLM · COMPLETED")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "LLM Explorer 시작" }))

    expect(await screen.findByRole("alert", { name: "LLM Explorer를 시작할 수 없습니다." })).toBeVisible()
    expect(screen.getByText("LLM · COMPLETED")).toBeVisible()
  })

  it("retains the last LLM state and exact server message when polling fails", async () => {
    const user = userEvent.setup()
    const { client } = renderRuns({ llmPollError: { status: 503, message: "LLM 상태를 읽을 수 없습니다." } })

    await screen.findByRole("tab", { name: "LLM" })
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    expect(screen.getByText("LLM · COMPLETED")).toBeVisible()
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.llmRun }) })

    expect(await screen.findByRole("alert", { name: "LLM 상태를 읽을 수 없습니다." })).toBeVisible()
    expect(screen.getByText("LLM · COMPLETED")).toBeVisible()
  })

  it("places current lane statuses around the run workspace", async () => {
    renderRuns()

    expect(await screen.findByRole("complementary", { name: "분석 필터" })).toHaveTextContent("현재 실행 상태")
    expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("실행 레인 안내")
    expect(screen.getByRole("tab", { name: "LLM" })).toBeVisible()
  })

  it.each([
    ["불러오는 중", { humanPending: true }],
    ["상태 확인 필요", { humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } }],
  ])("keeps HUMAN %s in both run summaries when the initial query has no data", async (expected, options) => {
    renderRuns(options)

    await waitFor(
      () => expect(screen.getByRole("complementary", { name: "분석 필터" })).toHaveTextContent(`HUMAN${expected}`),
      { timeout: 3_000 },
    )
    expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent(`HUMAN 상태 · ${expected}`)
    await userEvent.setup().click(screen.getByRole("tab", { name: "HUMAN" }))
    expect(within(screen.getByRole("tabpanel", { name: "HUMAN" })).getByText(`HUMAN · ${expected}`)).toBeVisible()
    expect(screen.queryByText("HUMAN · NOT_STARTED")).not.toBeInTheDocument()
  })

  it("does not claim an initial HUMAN error has a last successful state", async () => {
    renderRuns({ humanError: { message: "HUMAN 상태를 읽을 수 없습니다.", status: 503 } })

    await waitFor(
      () => expect(screen.getByRole("alert", { name: "HUMAN 상태를 읽을 수 없습니다." })).toHaveTextContent("상태를 가져오지 못했습니다. 확인이 필요합니다."),
      { timeout: 3_000 },
    )
    expect(screen.queryByText("마지막 성공 상태를 표시하고 있습니다.")).not.toBeInTheDocument()
  })

  it.each([900, 600])("keeps run guidance and LLM controls reachable through compact Sheets at %ipx", async (width) => {
    setCompactViewport(width)
    const user = userEvent.setup()
    renderRuns()

    await screen.findByRole("tab", { name: "LLM" })
    const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
    await user.click(contextTrigger)
    const contextDialog = screen.getByRole("dialog", { name: "분석 필터" })
    expect(contextDialog).toHaveTextContent("현재 실행 상태")
    await user.click(within(contextDialog).getByRole("button", { name: "Close" }))
    expect(contextTrigger).toHaveFocus()

    const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
    await user.click(inspectorTrigger)
    const inspectorDialog = screen.getByRole("dialog", { name: "선택 상세" })
    expect(inspectorDialog).toHaveTextContent("실행 레인 안내")
    await user.click(within(inspectorDialog).getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("tab", { name: "LLM" }))
    expect(screen.getByRole("button", { name: "LLM Explorer 시작" })).toBeEnabled()
  })
})
