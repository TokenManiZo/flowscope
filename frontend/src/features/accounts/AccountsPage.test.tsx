import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { AccountsPage } from "./AccountsPage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"

const service = "https://demo.flowscope.test:443"
const otherService = "https://other.example.test:443"
const rawSecret = "raw-cookie authorization bearer capability password"

const settings = (id: string, label: string, target: string) => ({
  id, label, role: id === "account-a" ? "User" : "Admin", target,
  human: { status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", lastCheckedLabel: "방금", credentialConflict: false },
  proofRule: { method: "GET", path: "/api/me", responseMark: label }, candidates: [], candidateBlockReasons: ["관측 요청 없음"],
  zap: { enabled: true, status: "VERIFIED_BY_ZAP", loginUrl: `${target}/login`, loginId: "zap-user@example.test", password: "zap-secret", hasPassword: true, connected: true, connectionLabel: "", failureReason: "" },
  llm: { enabled: false, status: "UNVERIFIED", loginMode: "HTML_FORM", loginUrl: "", loginId: "", hasPassword: false, failureReason: "", advanced: { idField: "", passwordField: "", tokenJsonPath: "", authHeaderName: "", authPrefix: "", validationUrl: "" } },
})

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }
function snapshot() { return { ...snapshotFixture,
  accounts: [{ id: "account-a", label: "계정 A", role: "User", target: service, color: "", authArtifactCount: 1 }, { id: "other", label: "다른 서비스", role: "Admin", target: otherService, color: "", authArtifactCount: 0 }],
  sessions: [{ fingerprint: "never-render-this", idn: "observed-user", accountId: null, artifactKind: "COOKIE", evidence: "e-1", confidence: "UNASSIGNED", firstSeen: 0, lastSeen: 0, registered: false, service, rawCredential: rawSecret }, { fingerprint: "bound", idn: "bound-user", accountId: "account-a", artifactKind: "AUTHORIZATION", evidence: "e-2", confidence: "MANUAL", firstSeen: 0, lastSeen: 0, registered: true, service }],
  managedSessions: [{ handle: "active", accountId: "account-a", accountLabel: "계정 A", service, status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }],
} }
function postBodies(fetchStub: ReturnType<typeof vi.fn>, path: string) { return fetchStub.mock.calls.filter(([called, init]) => called === path && (init as RequestInit).method === "POST").map(([, init]) => ((init as RequestInit).body as URLSearchParams).toString()) }
function renderAccounts(errors: Partial<Record<string, string>> = {}, data = snapshot(), activeRuns: { runId: string; accountId: string; proxy: string; paused?: boolean }[] = []) {
  const meta = document.createElement("meta"); meta.name = "flowscope-capability"; meta.content = rawSecret; document.head.append(meta)
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/human-run" && !init?.method) return Promise.resolve(response({ active: activeRuns.length > 0, runs: activeRuns, completed: false, runId: "", accountId: "", proxy: "" }))
    if (path === "/api/snapshot") return Promise.resolve(response(data))
    if (path === "/api/scanner-run") return Promise.resolve(response({ run: { status: "NOT_STARTED" }, accounts: [], scope: ["http://127.0.0.1:9000/"] }))
    if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, managedRuntime: true, state: "READY", message: "ready" }))
    if (path.startsWith("/api/account-settings?")) { const id = new URL(path, "http://local").searchParams.get("account") ?? ""; return Promise.resolve(response(settings(id, id === "account-a" ? "계정 A" : "다른 서비스", id === "account-a" ? service : otherService))) }
    if (path === "/api/human-run" && init?.method === "POST" && !errors[path]) {
      const form = init.body as URLSearchParams
      const action = form.get("action")
      if (action === "begin") activeRuns.push({ runId: "created-run", accountId: form.get("account") ?? "", proxy: "" })
      else {
        const index = activeRuns.findIndex((run) => run.runId === form.get("runId"))
        if (action === "end") activeRuns.splice(index, 1)
        else activeRuns[index].paused = action === "pause"
      }
      return Promise.resolve(response({ active: activeRuns.length > 0, runs: activeRuns, completed: false, runId: "", accountId: "", proxy: "" }))
    }
    if (init?.method === "POST") { const message = errors[path]; return Promise.resolve(message ? response({ success: false, message }, 400) : response({ success: true, message: "완료", id: "saved-account", rebound: 0 })) }
    return Promise.reject(new Error(`unexpected endpoint: ${path}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<AccountsPage />, createTestQueryClient())
  return fetchStub
}

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

afterEach(() => { window.location.hash = ""; document.head.querySelector('meta[name="flowscope-capability"]')?.remove(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

describe("account and session management", () => {
  it("shows a compact account overview and removes diagnostics and the permanent form", async () => {
    renderAccounts()
    expect(await screen.findByRole("heading", { name: "계정·세션" })).toBeVisible()
    expect(screen.queryByText("관측된 세션")).not.toBeInTheDocument()
    const lanes = await screen.findByLabelText("계정 A 연결 상태")
    await waitFor(() => expect(lanes).toHaveTextContent(/Human\s*수집 대기\s*0건/))
    expect(lanes).toHaveTextContent(/LLM\s*사용 안 함/)
    expect(screen.queryByLabelText("등록 계정 표시 이름")).not.toBeInTheDocument()
    expect(screen.queryByText("고급 세션 진단")).not.toBeInTheDocument()
    expect(screen.queryByText("세션·계정 매핑 초기화")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(rawSecret)
    expect(document.body.textContent).not.toContain("never-render-this")
  })

  it("always places the anonymous card first with four footer controls and per-browser instructions", async () => {
    renderAccounts()
    const list = await screen.findByLabelText("등록 계정 목록")
    const cards = within(list).getAllByRole("article")
    expect(cards.map(card => card.getAttribute("aria-label"))).toEqual(["비로그인 계정", "계정 A 계정", "다른 서비스 계정"])
    expect(within(cards[0]).getByText(/로그인하지 않고 탐색하세요/)).toBeVisible()
    expect(within(cards[1]).getByText(/이 브라우저에서는 계정 A 계정으로만 로그인하세요/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "비로그인으로 수집" })).not.toBeInTheDocument()
    for (const card of cards) {
      const footer = card.querySelector("footer")!
      expect(within(footer).getAllByRole("button").map(button => button.textContent)).toEqual(["시작", "일시 정지", "종료", "수집 보기"])
    }
    const anonymous = within(cards[0])
    expect(anonymous.getByRole("button", { name: "비로그인 수집 시작" })).toBeEnabled()
    expect(anonymous.getByRole("button", { name: "비로그인 일시 정지" })).toBeDisabled()
    expect(anonymous.getByRole("button", { name: "비로그인 수집 종료" })).toBeDisabled()
    expect(anonymous.queryByRole("button", { name: /관리/ })).not.toBeInTheDocument()
  })

  it("keeps the anonymous card available before any test account is registered", async () => {
    renderAccounts({}, { ...snapshot(), accounts: [] })
    const list = await screen.findByLabelText("등록 계정 목록")
    expect(within(list).getAllByRole("article")).toHaveLength(1)
    expect(within(list).getByRole("article", { name: "비로그인 계정" })).toBeVisible()
    expect(screen.getByRole("button", { name: "계정 추가" })).toBeVisible()
  })

  it("starts, pauses, resumes and ends anonymous capture while leaving the account run and records intact", async () => {
    const user = userEvent.setup()
    const data = snapshot()
    data.events = [{ ...snapshotFixture.events[0], idn: "anon", source: "human", status: 200 },
      { ...snapshotFixture.events[0], idn: "anon", source: "scanner", status: 401, sourceDetail: "AUTHORIZATION_REPLAY", phase: "AUTHORIZATION_REPLAY" }]
    const fetchStub = renderAccounts({}, data, [{ runId: "a-run", accountId: "account-a", proxy: "" }])
    const card = await screen.findByRole("article", { name: "비로그인 계정" })
    const controls = within(card)
    await user.click(controls.getByRole("button", { name: "비로그인 수집 시작" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "비로그인 수집 시작" })).toBeDisabled())
    await user.click(controls.getByRole("button", { name: "비로그인 일시 정지" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "비로그인 수집 시작" })).toBeEnabled())
    expect(controls.getByRole("button", { name: "비로그인 수집 종료" })).toBeEnabled()
    await user.click(controls.getByRole("button", { name: "비로그인 수집 시작" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "비로그인 일시 정지" })).toBeEnabled())
    await user.click(controls.getByRole("button", { name: "비로그인 일시 정지" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "비로그인 수집 시작" })).toBeEnabled())
    await user.click(controls.getByRole("button", { name: "비로그인 수집 종료" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "비로그인 수집 종료" })).toBeDisabled())
    expect(controls.getByRole("button", { name: "비로그인 수집 시작" })).toBeEnabled()
    expect(controls.getByRole("button", { name: "비로그인 일시 정지" })).toBeDisabled()
    expect(controls.getByText("1건")).toBeVisible()
    expect(controls.getByLabelText("비로그인 연결 상태")).toHaveTextContent(/ZAP\s*사용 안 함\s*0건/)
    expect(screen.getByRole("button", { name: "계정 A 수집 종료" })).toBeEnabled()
    expect(within(screen.getByLabelText("등록 계정 목록")).getAllByRole("article")[0]).toBe(card)
    expect(postBodies(fetchStub, "/api/human-run")).toEqual(["action=begin&account=", "action=pause&runId=created-run", "action=resume&runId=created-run", "action=pause&runId=created-run", "action=end&runId=created-run"])
    await user.click(controls.getByRole("button", { name: "수집 보기" }))
    expect(window.location.hash).toBe("#inspection")
    expect(postBodies(fetchStub, "/api/authorization-replay")).toEqual([])
  })

  it("shows stored counts even when LLM is disabled, independent of lane identity and repeatCount", async () => {
    const data = snapshot()
    data.events = [
      { ...snapshotFixture.events[0], idn: "account-a", source: "human", status: 200, repeatCount: 12 },
      { ...snapshotFixture.events[0], laneAccountId: "account-a", idn: "anon", source: "scanner", status: 302, orchestrator: "LLM" },
      { ...snapshotFixture.events[0], laneAccountId: "account-a", idn: "unknown", source: "llm", status: 401 },
      { ...snapshotFixture.events[0], idn: "account-a", source: "llm", status: 0 },
    ]
    renderAccounts({}, data)
    const lanes = await screen.findByLabelText("계정 A 연결 상태")
    await waitFor(() => expect(lanes).toHaveTextContent(/LLM\s*사용 안 함\s*1건/))
    expect(lanes).toHaveTextContent(/Human\s*수집 대기\s*1건/)
    expect(lanes).toHaveTextContent(/ZAP[\s\S]*1건/)
  })

  it("opens the account browser and capture directly, without arming anonymous replay", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    const card = await screen.findByRole("article", { name: "계정 A 계정" })
    const login = within(card).getByRole("button", { name: "계정 A 수집 시작" })
    await waitFor(() => expect(login).toBeEnabled())
    await user.click(login)
    await waitFor(() => expect(postBodies(fetchStub, "/api/human-run")).toEqual(["action=begin&account=account-a"]))
    expect(sessionStorage.getItem("flowscope.inspectionRecords")).toBeNull()
    expect(window.location.hash).toBe("")
    expect(postBodies(fetchStub, "/api/authorization-replay")).toEqual([])
    expect(postBodies(fetchStub, "/api/request-lab")).toEqual([])
  })

  it("moves collection help into a popover and stops only the chosen account run", async () => {
    const user = userEvent.setup()
    const fetchStub = renderAccounts({}, snapshot(), [{ runId: "a-run", accountId: "account-a", proxy: "" }, { runId: "anon-run", accountId: "", proxy: "" }])
    await screen.findByRole("heading", { name: "계정·세션" })
    expect(screen.queryByText(/현재 프로젝트의 저장 HTTP 응답 관측/)).not.toBeInTheDocument()
    expect(screen.queryByText(/시작을 누르면 별도 브라우저/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "트래픽 수집 설명" }))
    expect(screen.getByText(/시작을 누르면 별도 브라우저가 열려요/)).toBeVisible()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "계정 A 수집 종료" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/human-run")).toEqual(["action=end&runId=a-run"]))
    await user.click(screen.getByRole("button", { name: "비로그인 수집 종료" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/human-run")).toEqual(["action=end&runId=a-run", "action=end&runId=anon-run"]))
  })

  it("keeps pause separate and resets to start after ending without losing records or stopping another account", async () => {
    const user = userEvent.setup()
    const data = snapshot()
    data.events = [{ ...snapshotFixture.events[0], idn: "account-a", source: "human", status: 200 }]
    const fetchStub = renderAccounts({}, data, [{ runId: "a-run", accountId: "account-a", proxy: "" }, { runId: "b-run", accountId: "other", proxy: "" }])
    const card = await screen.findByRole("article", { name: "계정 A 계정" })
    const controls = within(card)
    await user.click(controls.getByRole("button", { name: "계정 A 일시 정지" }))
    expect(await controls.findByText("수집 일시 정지")).toBeVisible()
    expect(controls.getByRole("button", { name: "계정 A 일시 정지" })).toBeDisabled()
    await user.click(controls.getByRole("button", { name: "계정 A 수집 시작" }))
    await waitFor(() => expect(controls.getByRole("button", { name: "계정 A 일시 정지" })).toBeEnabled())
    await user.click(controls.getByRole("button", { name: "계정 A 수집 종료" }))
    expect(await controls.findByText("수집 대기")).toBeVisible()
    expect(controls.getByRole("button", { name: "계정 A 일시 정지" })).toBeDisabled()
    expect(controls.getByRole("button", { name: "계정 A 수집 시작" })).toBeEnabled()
    expect(controls.getByText("1건")).toBeVisible()
    expect(screen.getByRole("button", { name: "다른 서비스 수집 종료" })).toBeEnabled()
    await user.click(controls.getByRole("button", { name: "계정 A 수집 시작" }))
    await controls.findByRole("button", { name: "계정 A 수집 종료" })
    expect(postBodies(fetchStub, "/api/human-run")).toEqual(["action=pause&runId=a-run", "action=resume&runId=a-run", "action=end&runId=a-run", "action=begin&account=account-a"])
  })

  it("does not show a false paused state when the server rejects the pause", async () => {
    const user = userEvent.setup()
    renderAccounts({ "/api/human-run": "수집 변경 실패" }, snapshot(), [{ runId: "a-run", accountId: "account-a", proxy: "" }])
    await user.click(await screen.findByRole("button", { name: "계정 A 일시 정지" }))
    expect(await screen.findByText("수집 상태를 변경하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.")).toBeVisible()
    expect(screen.getByRole("button", { name: "계정 A 수집 종료" })).toBeVisible()
    expect(screen.queryByText("수집 일시 정지")).not.toBeInTheDocument()
  })

  it("keeps the user on the account page when the browser fails to open", async () => {
    const user = userEvent.setup(); renderAccounts({ "/api/human-run": "Chromium을 찾지 못했습니다." })
    const card = await screen.findByRole("article", { name: "계정 A 계정" })
    const login = within(card).getByRole("button", { name: "계정 A 수집 시작" })
    await waitFor(() => expect(login).toBeEnabled())
    await user.click(login)
    expect(await screen.findByText("수집 브라우저를 열지 못했습니다. Chrome 설치와 점검 범위를 확인해 주세요.")).toBeVisible()
    expect(screen.queryByText("Chromium을 찾지 못했습니다.")).not.toBeInTheDocument()
    expect(within(await screen.findByRole("article", { name: "비로그인 계정" })).queryByRole("alert")).not.toBeInTheDocument()
    expect(window.location.hash).toBe("")
    expect(sessionStorage.getItem("flowscope.inspectionRecords")).toBeNull()
  })

  it("shows ending feedback and the acknowledged analysis state before polling finishes", async () => {
    const user = userEvent.setup()
    const fetchStub = renderAccounts({}, snapshot(), [{ runId: "a-run", accountId: "account-a", proxy: "" }])
    const card = within(await screen.findByRole("article", { name: "계정 A 계정" }))
    let acknowledge!: (value: Response) => void
    const original = fetchStub.getMockImplementation()!
    fetchStub.mockImplementation((path, init) => {
      if (path === "/api/human-run" && init?.method === "POST") return new Promise<Response>((resolve) => { acknowledge = resolve })
      if (path === "/api/human-run" && !init?.method) return new Promise<Response>(() => {})
      return original(path, init)
    })
    await user.click(card.getByRole("button", { name: "계정 A 수집 종료" }))
    expect(card.getByRole("button", { name: "계정 A 수집 종료" })).toHaveTextContent("종료 중…")
    acknowledge(response({ active: true, completed: false, runs: [{ runId: "a-run", accountId: "account-a", proxy: "", paused: true, analyzing: true }] }))
    expect(await card.findByText("기록 분석 중")).toBeVisible()
    expect(card.getByRole("button", { name: "계정 A 수집 시작" })).toBeDisabled()
    expect(card.getByRole("button", { name: "계정 A 수집 종료" })).toBeDisabled()
    expect(card.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("refreshes a failed end and removes its alert once the server confirms closure", async () => {
    const user = userEvent.setup()
    const runs = [{ runId: "a-run", accountId: "account-a", proxy: "" }]
    const fetchStub = renderAccounts({}, snapshot(), runs)
    const card = within(await screen.findByRole("article", { name: "계정 A 계정" }))
    const original = fetchStub.getMockImplementation()!
    fetchStub.mockImplementation((path, init) => {
      if (path === "/api/human-run" && init?.method === "POST") {
        runs.splice(0)
        return Promise.resolve(response({ success: false, message: "활성 수집 실행을 찾지 못했습니다." }, 400))
      }
      return original(path, init)
    })
    await user.click(card.getByRole("button", { name: "계정 A 수집 종료" }))
    await waitFor(() => expect(card.getByRole("button", { name: "계정 A 수집 시작" })).toBeEnabled())
    expect(card.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("활성 수집 실행을 찾지 못했습니다.")).not.toBeInTheDocument()
  })

  it("shows an already open account capture without opening another browser", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts({}, snapshot(), [{ runId: "run-a", accountId: "account-a", proxy: "http://127.0.0.1:9911" }])
    const card = await screen.findByRole("article", { name: "계정 A 계정" })
    await user.click(await within(card).findByRole("button", { name: "수집 보기" }))
    expect(postBodies(fetchStub, "/api/human-run")).toEqual([])
    expect(window.location.hash).toBe("#inspection")
  })

  it("registers an account from three fields in a centered dialog prefilled from the scope", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 등록" }))
    const dialog = await screen.findByRole("dialog", { name: "계정 등록" })
    // Scope entries end with "/"; the form fills the bare origin so it validates without editing.
    await waitFor(() => expect(within(dialog).getByLabelText("대상 서비스")).toHaveValue("http://127.0.0.1:9000"))
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("combobox", { name: "같은 서비스 관측 계정" })).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText("표시 이름"), "새 계정")
    await user.click(within(dialog).getByRole("button", { name: "LV1" }))
    await user.click(within(dialog).getByRole("button", { name: "등록" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/account-save")).toEqual([new URLSearchParams({ id: "", label: "새 계정", role: "LV1", target: "http://127.0.0.1:9000" }).toString()]))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "계정 등록" })).not.toBeInTheDocument())
    expect(postBodies(fetchStub, "/api/identity-merge")).toEqual([])

    await user.click(screen.getByRole("button", { name: "계정 등록" }))
    expect(await screen.findByLabelText("표시 이름")).toHaveValue("")
    expect(screen.getByRole("button", { name: "등록" })).toBeDisabled()
  })

  it("opens existing accounts in the wide settings dialog with a left menu and no identity merge", async () => {
    const user = userEvent.setup(); renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 A 관리" }))
    const sheet = await screen.findByLabelText("계정 A 계정 설정")
    for (const tab of [/^기본 정보/, /^사람/, /^ZAP 로그인/]) expect(await within(sheet).findByRole("tab", { name: tab })).toBeVisible()
    // LLM 세션은 점검의 LLM 단계에서 브라우저 로그인으로 만든다.
    expect(within(sheet).queryByRole("tab", { name: /^LLM/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: /관측 계정 연결/ })).not.toBeInTheDocument()
  })

  it("deletes an account only after the confirmation dialog", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 A 관리" }))
    const sheet = await screen.findByLabelText("계정 A 계정 설정")
    await user.click(await within(sheet).findByRole("button", { name: "계정 삭제" }))
    expect(postBodies(fetchStub, "/api/account-delete")).toEqual([])
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "삭제" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/account-delete")).toEqual(["id=account-a"]))
  })
})
