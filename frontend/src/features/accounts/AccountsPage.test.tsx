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
  zap: { enabled: true, status: "VERIFIED_BY_ZAP", loginUrl: `${target}/login`, loginId: "", hasPassword: true, connectionLabel: "ZAP 연결됨", failureReason: "" },
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
    expect(await screen.findByRole("heading", { name: "계정·세션 관리" })).toBeVisible()
    const summary = screen.getByRole("group", { name: "계정·세션 요약" })
    expect(summary).toHaveTextContent("등록 계정")
    expect(summary).toHaveTextContent("관측된 세션")
    expect(summary).toHaveTextContent("확보한 세션")
    expect(await screen.findByLabelText("계정 A 연결 상태")).toHaveTextContent("HUMAN")
    expect(screen.queryByLabelText("등록 계정 표시 이름")).not.toBeInTheDocument()
    expect(screen.queryByText("고급 세션 진단")).not.toBeInTheDocument()
    expect(screen.queryByText("세션·신원 매핑 초기화")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(rawSecret)
    expect(document.body.textContent).not.toContain("never-render-this")
  })

  it("creates an account and links only a same-origin observed identity through existing APIs", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 등록" }))
    await user.type(screen.getByLabelText("표시 이름"), "새 계정")
    await user.type(screen.getByLabelText("대상 서비스 (exact origin)"), service)
    expect(screen.getByLabelText("대상 서비스 (exact origin)")).toHaveValue(service)
    expect(screen.getByRole("combobox", { name: "같은 서비스 관측 신원" })).not.toBeDisabled()
    await user.click(screen.getByRole("combobox", { name: "같은 서비스 관측 신원" }))
    expect(await screen.findByRole("option", { name: "observed-user" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "bound-user" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "observed-user" }))
    await user.click(screen.getByRole("button", { name: "등록하고 설정 계속" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/account-save")).toEqual([new URLSearchParams({ id: "", label: "새 계정", role: "User", target: service }).toString()]))
    await waitFor(() => expect(postBodies(fetchStub, "/api/identity-merge")).toEqual(["from=observed-user&into=saved-account"]))
  })

  it("starts a fresh registration after continuing to the new account settings", async () => {
    const user = userEvent.setup(); renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 등록" }))
    await user.type(screen.getByLabelText("표시 이름"), "첫 계정")
    await user.type(screen.getByLabelText("대상 서비스 (exact origin)"), service)
    await user.click(screen.getByRole("button", { name: "등록하고 설정 계속" }))
    await screen.findByRole("tab", { name: "HUMAN" })
    await user.click(screen.getByRole("button", { name: "취소" }))
    await user.click(screen.getByRole("button", { name: "계정 등록" }))
    expect(screen.getByLabelText("표시 이름")).toHaveValue("")
    expect(screen.getByLabelText("대상 서비스 (exact origin)")).toHaveValue("")
    expect(screen.getByRole("button", { name: "등록하고 설정 계속" })).toBeDisabled()
  })

  it("reports partial success without claiming identity merge succeeded and allows retry", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts({ "/api/identity-merge": "병합 오류" })
    await user.click(await screen.findByRole("button", { name: "계정 등록" }))
    await user.type(screen.getByLabelText("표시 이름"), "부분 성공")
    await user.type(screen.getByLabelText("대상 서비스 (exact origin)"), service)
    await user.click(screen.getByRole("combobox", { name: "같은 서비스 관측 신원" }))
    await user.click(await screen.findByRole("option", { name: "observed-user" }))
    await user.click(screen.getByRole("button", { name: "등록하고 설정 계속" }))
    expect(await screen.findByRole("alert", { name: "계정 등록 부분 성공" })).toHaveTextContent("계정은 등록됐지만 관측 신원 연결은 완료되지 않았습니다")
    expect(screen.getByRole("button", { name: "신원 연결 다시 시도" })).toBeEnabled()
    expect(postBodies(fetchStub, "/api/account-save")).toHaveLength(1)
  })

  it("opens existing accounts in the four-tab settings sheet and links same-origin identities", async () => {
    const user = userEvent.setup(); const fetchStub = renderAccounts()
    await user.click(await screen.findByRole("button", { name: "계정 A 관리" }))
    const sheet = await screen.findByLabelText("계정 A 계정 설정")
    for (const tab of ["기본 정보", "HUMAN", "ZAP", "LLM"]) expect(within(sheet).getByRole("tab", { name: tab })).toBeVisible()
    await user.click(within(sheet).getByRole("combobox", { name: "같은 서비스 관측 신원" }))
    await user.click(await screen.findByRole("option", { name: "observed-user" }))
    await user.click(within(sheet).getByRole("button", { name: "관측 신원 연결" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/identity-merge")).toEqual(["from=observed-user&into=account-a"]))
  })
})
