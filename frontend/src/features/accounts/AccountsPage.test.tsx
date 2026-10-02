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
function renderAccounts(errors: Partial<Record<string, string>> = {}) {
  const meta = document.createElement("meta"); meta.name = "flowscope-capability"; meta.content = rawSecret; document.head.append(meta)
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") return Promise.resolve(response(snapshot()))
    if (path === "/api/scanner-run") return Promise.resolve(response({ run: { status: "NOT_STARTED" }, accounts: [], scope: ["http://127.0.0.1:9000/"] }))
    if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, managedRuntime: true, state: "READY", message: "ready" }))
    if (path.startsWith("/api/account-settings?")) { const id = new URL(path, "http://local").searchParams.get("account") ?? ""; return Promise.resolve(response(settings(id, id === "account-a" ? "계정 A" : "다른 서비스", id === "account-a" ? service : otherService))) }
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

afterEach(() => { document.head.querySelector('meta[name="flowscope-capability"]')?.remove(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

describe("account and session management", () => {
  it("shows a compact account overview and removes diagnostics and the permanent form", async () => {
    renderAccounts()
    expect(await screen.findByRole("heading", { name: "계정·세션" })).toBeVisible()
    expect(screen.queryByText("관측된 세션")).not.toBeInTheDocument()
    const lanes = await screen.findByLabelText("계정 A 연결 상태")
    await waitFor(() => expect(lanes).toHaveTextContent(/HUMAN\s*인증값 있음\s*0건/))
    expect(lanes).toHaveTextContent(/LLM\s*사용 안 함/)
    expect(screen.queryByLabelText("등록 계정 표시 이름")).not.toBeInTheDocument()
    expect(screen.queryByText("고급 세션 진단")).not.toBeInTheDocument()
    expect(screen.queryByText("세션·신원 매핑 초기화")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(rawSecret)
    expect(document.body.textContent).not.toContain("never-render-this")
  })

  it("hands the account to the inspection page when collecting as that account", async () => {
    const user = userEvent.setup(); renderAccounts()
    const card = await screen.findByRole("article", { name: "계정 A 계정" })
    await user.click(within(card).getByRole("button", { name: "이 계정으로 수집" }))
    expect(sessionStorage.getItem("flowscope.humanAccount")).toBe("account-a")
    expect(window.location.hash).toBe("#inspection")
    window.location.hash = ""
  })

  it("registers an account from three fields in a centered dialog prefilled from the scope", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 등록" }))
    const dialog = await screen.findByRole("dialog", { name: "계정 등록" })
    // Scope entries end with "/"; the form fills the bare origin so it validates without editing.
    await waitFor(() => expect(within(dialog).getByLabelText("대상 서비스")).toHaveValue("http://127.0.0.1:9000"))
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("combobox", { name: "같은 서비스 관측 신원" })).not.toBeInTheDocument()
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
    for (const tab of [/^기본 정보/, /^HUMAN/, /^ZAP 로그인/]) expect(await within(sheet).findByRole("tab", { name: tab })).toBeVisible()
    // LLM 세션은 점검의 LLM 단계에서 브라우저 로그인으로 만든다.
    expect(within(sheet).queryByRole("tab", { name: /^LLM/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: /관측 신원 연결/ })).not.toBeInTheDocument()
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
