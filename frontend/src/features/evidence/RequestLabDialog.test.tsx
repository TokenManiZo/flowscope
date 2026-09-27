import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RequestLabDialog } from "./RequestLabDialog"
import { OperationDetail } from "./OperationDetail"
import { renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import type { EventRecord, ManagedSession, Snapshot } from "@/lib/api/types"
import { createMemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"

const secret = "REQUEST-LAB-SECRET"
const capability = "CAPABILITY-MUST-NOT-LEAK"

const event: EventRecord = {
  eventId: "event-7", method: "POST", path: "/orders/7", status: 201, fp: "fp", idn: "alice", role: "user", source: "human", op: "POST /orders/{id}", resource: "order:7", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "AUTHENTICATED", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "cluster", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["event-7"], objects: [], verdict: "allow",
}

// Weakly verified (LEGACY_RESPONSE) but ACTIVE: the Request Lab stays backward compatible and can use it,
// unlike active cross-identity replay which requires a strong (operator-asserted / rule-matched) session.
const activeSession: ManagedSession = { handle: "opaque", accountId: "acct-1", accountLabel: "관리자", service: "https://api.example.test", status: "ACTIVE", verificationSource: "LEGACY_RESPONSE", createdAt: "now", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }

function requestLabDraft(eventId = "event-7", request = secret) {
  return { eventId, service: "https://api.example.test", request, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Response>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

function installTransport() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
    if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
    if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "sent-response", durationMs: 12, requestBytes: 4, responseBytes: 13 }))
    if (String(input) === "/api/manual-attempts") return Promise.resolve(json(attempts))
    return Promise.resolve(json({ success: true, message: "draft opened", openedDraft: true, status: 200, replayId: "r-1" }))
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

let attempts: unknown[] = []
afterEach(() => { attempts = [] })

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

describe("RequestLabDialog", () => {
  it("shows Request and Response simultaneously in a responsive split workspace with sticky actions", async () => {
    vi.stubGlobal("innerWidth", 1280)
    window.dispatchEvent(new Event("resize"))
    installTransport()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)

    const metadata = await screen.findByRole("region", { name: "Request Lab 메타데이터" })
    const workbench = screen.getByRole("region", { name: "Request Lab 원문 작업면" })
    const layout = metadata.parentElement
    const dialog = screen.getByRole("dialog", { name: "Request Lab" })

    expect(window.innerWidth).toBe(1280)
    expect(dialog).toHaveClass("sm:max-w-[70rem]")
    expect(dialog).not.toHaveClass("sm:max-w-sm")
    expect(layout).toHaveClass("grid", "lg:grid-cols-[19rem_minmax(0,1fr)]")
    expect(workbench).toBe(layout?.lastElementChild)
    const rawWorkspace = screen.getByRole("group", { name: "Request Lab 요청 및 응답" })
    expect(rawWorkspace).toHaveClass("grid", "lg:grid-cols-2")
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBeVisible()
    expect(screen.getByLabelText("Request Lab 응답 원문")).toBeVisible()
    expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveClass("font-mono")
    expect(screen.queryByRole("tab", { name: "Request" })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Response" })).not.toBeInTheDocument()
    expect(dialog.querySelector('[data-slot="dialog-footer"]')).toHaveClass("sticky", "bottom-0")
  })

  it("shows unavailable raw data as a compact status banner instead of a content card", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>((input) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: "GET /masked", response: null, rawRequestRetained: false, rawResponseRetained: false, requestEditable: false, requestCharset: "UTF-8", responseCharset: null, observedIdentity: "alice", reusableSession: "없음", message: "마스킹된 읽기 전용 초안입니다." }))
      return Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)

    const status = await screen.findByRole("status")
    expect(status).toHaveClass("p-2")
    expect(status).not.toHaveClass("p-6")
    expect(status.closest('[data-slot="card"]')).toBeNull()
    expect(status).not.toHaveTextContent("GET /masked")
    expect(status).not.toHaveTextContent("event-7")
  })

  it("leaves an absent server owner unset instead of proposing the observed requester as owner", () => {
    installTransport()
    renderWithQueryClient(<OperationDetail event={event} snapshot={{ ...snapshotFixture, owners: {} }} onOpenRequestLab={vi.fn()} />)

    expect(screen.getByLabelText("리소스 소유자")).toHaveValue("")
  })

  it("submits exact policy forms and only acknowledges an unsent Repeater draft", async () => {
    const fetch = installTransport()
    const user = userEvent.setup()
    const openRequestLab = vi.fn()
    const snapshot: Snapshot = { ...snapshotFixture, events: [event], accounts: [{ id: "bob", label: "Bob", role: "USER", target: "POST", color: "", authArtifactCount: 0 }], owners: { "order:7": "alice" }, requiredRoles: { [event.op]: "user" } }
    renderWithQueryClient(<OperationDetail event={event} snapshot={snapshot} onOpenRequestLab={openRequestLab} />)

    await user.clear(screen.getByLabelText("필수 역할"))
    await user.type(screen.getByLabelText("필수 역할"), "admin")
    await user.click(screen.getByRole("button", { name: "필수 역할 저장" }))
    await user.selectOptions(screen.getByLabelText("트래픽 재정의"), "EXCLUDE")
    await user.click(screen.getByRole("button", { name: "트래픽 정책 저장" }))
    await user.selectOptions(screen.getByLabelText("리소스 소유자"), "bob")
    await user.click(screen.getByRole("button", { name: "소유자 저장" }))
    await user.click(screen.getByRole("button", { name: "현재 세션으로 Repeater 준비" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/requirement", expect.objectContaining({ method: "POST" })))
    const calls = new Map(fetch.mock.calls.map(([input, init]) => [String(input), init]))
    expect(new Headers(calls.get("/api/requirement")?.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded;charset=UTF-8")
    expect(new URLSearchParams(String(calls.get("/api/requirement")?.body))).toEqual(new URLSearchParams({ operation: event.op, role: "admin" }))
    expect(new URLSearchParams(String(calls.get("/api/traffic-override")?.body))).toEqual(new URLSearchParams({ operation: event.op, value: "EXCLUDE" }))
    expect(new URLSearchParams(String(calls.get("/api/owner")?.body))).toEqual(new URLSearchParams({ resource: "order:7", identity: "bob" }))
    expect(openRequestLab).toHaveBeenCalledTimes(1)
  })

  it("keeps a weak LEGACY_RESPONSE ACTIVE session usable in the Request Lab for backward compatibility", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)

    await screen.findByLabelText("Request Lab 요청 원문")
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    // Active cross-identity replay rejects this LEGACY_RESPONSE session; the Request Lab still offers it.
    expect(screen.getByRole("option", { name: "관리자" })).toBeVisible()
  })

  it("loads a fresh memory-only draft, sends exact form data for ORIGINAL/ANONYMOUS/ACCOUNT, and excludes inactive or cross-service accounts", async () => {
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession, { ...activeSession, accountId: "inactive", accountLabel: "비활성", status: "EXPIRED" }, { ...activeSession, accountId: "other", service: "https://other.example.test" }]} />)

    expect(await screen.findByLabelText("Request Lab 요청 원문")).toHaveValue(secret)
    expect(screen.getByText("서비스: https://api.example.test")).toBeVisible()
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    expect(screen.getByRole("option", { name: "관리자" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "비활성" })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ORIGINAL")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/request-lab", expect.objectContaining({ method: "POST" })))
    const call = fetch.mock.calls.find(([input]) => String(input) === "/api/request-lab")
    const sent = new URLSearchParams(String(call?.[1]?.body))
    // 서버는 operationId가 없으면 400으로 거부한다. 누를 때마다 새 값이다.
    expect(sent.get("operationId")).toMatch(/^[A-Za-z0-9_-]{16,120}$/)
    sent.delete("operationId")
    expect(sent).toEqual(new URLSearchParams({ action: "send", eventId: "event-7", credentialMode: "ORIGINAL", accountId: "", request: secret }))
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ANONYMOUS")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    await user.selectOptions(screen.getByLabelText("계정"), "acct-1")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    const sends = fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")
    expect(new URLSearchParams(String(sends[1]?.[1]?.body)).get("credentialMode")).toBe("ANONYMOUS")
    const accountSend = new URLSearchParams(String(sends[2]?.[1]?.body))
    expect(accountSend.get("operationId")).not.toBe(new URLSearchParams(String(sends[1]?.[1]?.body)).get("operationId"))
    accountSend.delete("operationId")
    expect(accountSend).toEqual(new URLSearchParams({ action: "send", eventId: "event-7", credentialMode: "ACCOUNT", accountId: "acct-1", request: secret }))
  })

  it("keeps a non-editable standalone draft read-only and blocks send in both the button and handler", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://demo.flowscope.test:443", request: "GET /api/orders/101 HTTP/1.1\r\nAuthorization: ***MASKED***\r\n\r\n", response: "HTTP/1.1 200 Demo\r\n\r\n{}", rawRequestRetained: false, rawResponseRetained: false, requestEditable: false, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "acct-demo-user-a", reusableSession: "없음", message: "Standalone 데모에서는 마스킹된 읽기 전용 초안만 제공하며 Request Lab 전송을 사용할 수 없습니다." }))
      return Promise.resolve(json({ success: true, message: "unexpected send" }))
    })
    vi.stubGlobal("fetch", fetch)
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)

    expect(await screen.findByText(/Standalone 데모에서는/)).toBeVisible()
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBeDisabled()
    const send = screen.getByRole("button", { name: "Request Lab 전송" })
    expect(send).toBeDisabled()

    send.removeAttribute("disabled")
    fireEvent.click(send)
    await Promise.resolve()
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")).toHaveLength(0)
  })

  it("does not persist, log, serialize, or retain raw values after close or beforeunload", async () => {
    const fetch = installTransport()
    const storage = vi.spyOn(Storage.prototype, "setItem")
    const indexedDb = vi.fn()
    Object.defineProperty(window, "indexedDB", { configurable: true, get: indexedDb })
    const log = vi.spyOn(console, "log")
    const user = userEvent.setup()
    const { client } = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(secret)
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(capability)
    expect(storage).not.toHaveBeenCalled()
    expect(indexedDb).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "닫기" }))
    window.dispatchEvent(new Event("beforeunload"))
    expect(document.body.textContent).not.toContain(secret)
    expect(Object.values(localStorage)).not.toContain(secret)
    expect(Object.values(sessionStorage)).not.toContain(secret)
    expect(fetch).toHaveBeenCalledWith("/api/request-lab?eventId=event-7", expect.any(Object))
  })

  it("disables ACCOUNT when no eligible exact-service session exists and recovers if eligibility disappears", async () => {
    const user = userEvent.setup()
    installTransport()
    const { rerender } = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    expect(screen.getByLabelText("계정")).toBeVisible()
    rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)
    await waitFor(() => expect(screen.getByRole("option", { name: "ACCOUNT" })).toBeDisabled())
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()
  })

  it("shows a retry after a draft server error and renders bounded recent results newest first", async () => {
    let attempts = 0
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab?eventId=event-7") {
        attempts += 1
        return Promise.resolve(attempts === 1 ? json({ success: false, message: "초안 서버 오류" }, 503) : json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      }
      if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 201, response: `result-${attempts++}`, durationMs: 12, requestBytes: 4, responseBytes: 13 }))
      return Promise.resolve(json({ success: true, message: "draft opened", openedDraft: true, status: 200, replayId: "r-1" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("초안 서버 오류")
    await user.click(screen.getByRole("button", { name: "Request Lab 초안 다시 시도" }))
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    expect(await screen.findByRole("heading", { name: "최근 전송 결과" })).toBeVisible()
    expect(screen.getAllByTestId("request-lab-history-result")[0]).toHaveTextContent("result-3")
  })

  it("blocks duplicate Repeater handoff while the unsent draft is opening", async () => {
    let resolveReplay!: (response: Response) => void
    const replay = new Promise<Response>((resolve) => { resolveReplay = resolve })
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => String(input) === "/api/replay" ? replay : Promise.resolve(json({ ...requestLabDraft(), reusableAccountId: "acct-1" })))
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const handoff = await screen.findByRole("button", { name: "현재 세션 Repeater" })
    await user.click(handoff)
    expect(handoff).toBeDisabled()
    await user.click(handoff)
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/replay")).toHaveLength(1)
    const replayCall = fetch.mock.calls.find(([input]) => String(input) === "/api/replay")
    expect(new URLSearchParams(String(replayCall?.[1]?.body))).toEqual(new URLSearchParams({ eventId: "event-7", request: secret, credentialMode: "ACCOUNT", accountId: "acct-1" }))
    resolveReplay(json({ success: true, message: "draft", openedDraft: true, status: 200, replayId: "r" }))
    expect(await screen.findByText("Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "비로그인 Repeater" }))
    await waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/replay")).toHaveLength(2))
    const anonymousCall = fetch.mock.calls.filter(([input]) => String(input) === "/api/replay")[1]
    expect(new URLSearchParams(String(anonymousCall?.[1]?.body))).toEqual(new URLSearchParams({ eventId: "event-7", request: secret, credentialMode: "ANONYMOUS", accountId: "" }))
  })

  it("keeps policy input and selected detail visible when the server rejects a policy", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => String(input) === "/api/requirement" ? Promise.resolve(json({ success: false, message: "역할 정책 오류" }, 400)) : Promise.resolve(json({ success: true, message: "ok" })))
    vi.stubGlobal("fetch", fetch)
    const snapshot: Snapshot = { ...snapshotFixture, events: [event], requiredRoles: { [event.op]: "user" } }
    const user = userEvent.setup()
    renderWithQueryClient(<OperationDetail event={event} snapshot={snapshot} onOpenRequestLab={vi.fn()} />)
    await user.clear(screen.getByLabelText("필수 역할"))
    await user.type(screen.getByLabelText("필수 역할"), "admin")
    await user.click(screen.getByRole("button", { name: "필수 역할 저장" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("역할 정책 오류")
    expect(screen.getByLabelText("필수 역할")).toHaveValue("admin")
    expect(screen.getByText(event.eventId)).toBeVisible()
  })

  it("blocks an over-1-MiB UTF-8 request in the component and disables duplicate send while pending", async () => {
    let resolveSend!: (response: Response) => void
    const pendingSend = new Promise<Response>((resolve) => { resolveSend = resolve })
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return init?.method === "POST" ? pendingSend : Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await screen.findByLabelText("Request Lab 요청 원문")
    fireEvent.change(request, { target: { value: "가".repeat(349_526) } })
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("1,048,576")
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    fireEvent.change(request, { target: { value: "ok" } })
    const send = screen.getByRole("button", { name: "Request Lab 전송" })
    await user.click(send)
    expect(send).toBeDisabled()
    await user.click(send)
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")).toHaveLength(1)
    resolveSend(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "ok", durationMs: 1, requestBytes: 2, responseBytes: 2 }))
    expect(await screen.findByText("최근 전송 결과")).toBeVisible()
  })

  it("clears a revoked selected ACCOUNT while keeping another eligible account and requires an explicit replacement", async () => {
    const backup: ManagedSession = { ...activeSession, handle: "backup-handle", accountId: "acct-2", accountLabel: "백업 관리자" }
    function Harness() {
      const [sessions, setSessions] = useState<readonly ManagedSession[]>([activeSession, backup])
      return <><button type="button" onClick={() => setSessions([backup])}>선택 계정 해제</button><RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={sessions} /></>
    }
    const user = userEvent.setup()
    installTransport()
    renderWithQueryClient(<Harness />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    await user.selectOptions(screen.getByLabelText("계정"), "acct-1")
    fireEvent.click(screen.getByText("선택 계정 해제", { selector: "button" }))
    await waitFor(() => expect(screen.getByLabelText("계정")).toHaveValue(""))
    expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText("계정"), "acct-2")
    expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()
  })

  it("scrubs injected raw owner strings and history on dataset revision", async () => {
    const owner = createMemoryOnlyRawState()
    let revision = 1
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: revision === 1 ? "REVISION-REQUEST" : "", response: revision === 1 ? "REVISION-RESPONSE" : "", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return init?.method === "POST" ? Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "REVISION-HISTORY", durationMs: 1, requestBytes: 1, responseBytes: 1 })) : Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    await screen.findAllByText("REVISION-HISTORY")
    expect(owner.request).toBe("REVISION-REQUEST")
    expect(owner.response).toBe("REVISION-HISTORY")
    expect(owner.history[0]?.response).toBe("REVISION-HISTORY")
    revision = 2
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe(""))
    expect(owner.response).toBe("")
    expect(owner.history).toHaveLength(0)
  })

  it("keeps an edited draft when only ordinary analysis data refreshes", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = installTransport()
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)
    const request = await screen.findByLabelText("Request Lab 요청 원문")
    await user.clear(request)
    await user.type(request, "EDITED-WHILE-CAPTURING")

    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={{ ...event, repeatCount: 2 }} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)

    expect(owner.request).toBe("EDITED-WHILE-CAPTURING")
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab?eventId=event-7")).toHaveLength(1)
  })

  it("overwrites populated raw owner and held history references when unmounted", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>((input) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: "UNMOUNT-REQUEST", response: "UNMOUNT-RESPONSE", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    owner.addResult({ response: "UNMOUNT-HISTORY", status: 200, durationMs: 1 })

    const draftStateRef = owner
    const historyRef = owner.history
    const historyEntryRef = owner.history[0]!
    const beforeUnloadHandler = add.mock.calls.find(([type]) => type === "beforeunload")?.[1]
    expect(draftStateRef.request).toBe("UNMOUNT-REQUEST")
    expect(draftStateRef.response).toBe("UNMOUNT-RESPONSE")
    expect(historyEntryRef.response).toBe("UNMOUNT-HISTORY")
    expect(new Set([draftStateRef.request, draftStateRef.response, historyEntryRef.response]).size).toBe(3)
    expect(beforeUnloadHandler).toBeDefined()

    view.unmount()
    expect(draftStateRef.request).toBe("")
    expect(draftStateRef.response).toBe("")
    expect(historyEntryRef.response).toBe("")
    expect(historyRef).toHaveLength(0)
    expect(draftStateRef.history).toHaveLength(0)
    expect(remove).toHaveBeenCalledWith("beforeunload", beforeUnloadHandler)
    add.mockRestore()
    remove.mockRestore()
  })

  it("ignores a late send completion after close and keeps the injected raw owner scrubbed", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    const onOpenChange = vi.fn()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/request-lab" && init?.method === "POST" ? pending.promise : Promise.resolve(json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={onOpenChange} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    await user.click(screen.getByRole("button", { name: "닫기" }))

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-CLOSE", durationMs: 3, requestBytes: 1, responseBytes: 10 }))
      await pending.promise
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(owner.history).toHaveLength(0)
  })

  it("does not restore a pending raw draft after beforeunload", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn(() => pending.promise))
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    act(() => window.dispatchEvent(new Event("beforeunload")))
    await act(async () => { pending.resolve(json(requestLabDraft("event-7", "LATE-RAW-DRAFT"))); await pending.promise })
    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(screen.queryByText("LATE-RAW-DRAFT")).not.toBeInTheDocument()
  })

  it("ignores a late send error after unmount and never repopulates the injected raw owner", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let sendSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") { sendSignal = init.signal ?? undefined; return pending.promise }
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    view.unmount()
    expect(sendSignal?.aborted).toBe(true)

    await act(async () => {
      pending.reject(new Error("LATE-UNMOUNT"))
      await pending.promise.catch(() => undefined)
    })

    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(owner.history).toHaveLength(0)
  })

  it("isolates a late send completion when the selected Evidence changes", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    const nextEvent = { ...event, eventId: "event-8" }
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return pending.promise
      if (String(input) === "/api/request-lab?eventId=event-8") return Promise.resolve(json(requestLabDraft("event-8", "NEXT-EVIDENCE")))
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={nextEvent} sessions={[activeSession]} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("NEXT-EVIDENCE"))
    expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-EVIDENCE", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("NEXT-EVIDENCE")
    expect(owner.response).toBe("observed-response")
    expect(owner.history).toHaveLength(0)
  })

  it("isolates a late send completion when the dataset revision changes", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let draftRequest = "REVISION-ONE"
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return pending.promise
      return Promise.resolve(json(requestLabDraft("event-7", draftRequest)))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={1} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    draftRequest = "REVISION-TWO"
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={2} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("REVISION-TWO"))
    expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-REVISION", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("REVISION-TWO")
    expect(owner.response).toBe("observed-response")
    expect(owner.history).toHaveLength(0)
  })

  it("applies the response and clears sending for a send that completes in its original context", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/request-lab" && init?.method === "POST" ? pending.promise : Promise.resolve(json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))
    pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 204, response: "CURRENT-CONTEXT", durationMs: 3, requestBytes: 1, responseBytes: 15 }))

    await waitFor(() => expect(owner.response).toBe("CURRENT-CONTEXT"))
    expect(owner.history[0]?.response).toBe("CURRENT-CONTEXT")
    expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()
  })

  it("keeps an in-flight send attached while snapshot actions are temporarily suspended", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let sendSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") {
        sendSignal = init.signal ?? undefined
        return pending.promise
      }
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    function Harness() {
      const [suspended, setSuspended] = useState(false)
      return <><button onClick={() => setSuspended(true)}>suspend snapshot</button><button onClick={() => setSuspended(false)}>resume snapshot</button><RequestLabDialog open suspended={suspended} onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} /></>
    }
    renderWithQueryClient(<Harness />)
    await screen.findByLabelText("Request Lab 요청 원문")
    const dialog = screen.getByRole("dialog", { name: "Request Lab" })
    await user.click(within(dialog).getByRole("button", { name: "Request Lab 전송" }))
    fireEvent.click(screen.getByText("suspend snapshot"))
    expect(sendSignal?.aborted).toBe(false)
    expect(within(dialog).getByRole("button", { name: "Request Lab 전송 중" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200,
        response: "COMPLETED-WHILE-SUSPENDED", durationMs: 3, requestBytes: 1, responseBytes: 25 }))
      await pending.promise
    })

    expect(owner.response).toBe("COMPLETED-WHILE-SUSPENDED")
    expect(owner.history).toHaveLength(1)
    expect(within(dialog).getByRole("button", { name: "Request Lab 전송" })).toBeDisabled()
    fireEvent.click(screen.getByText("resume snapshot"))
    expect(within(dialog).getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()
  })

  it("lists stored verification results and unanswered attempts sent from this Evidence only", async () => {
    attempts = [
      { sequence: 1, originEvidenceId: "event-7", outcome: "TIMEOUT", status: 0, evidenceId: null, durationMillis: 30000 },
      { sequence: 2, originEvidenceId: "event-other", outcome: "NO_RESPONSE", status: 0, evidenceId: null, durationMillis: 5 },
      { sequence: 3, originEvidenceId: "event-7", outcome: "HTTP_RESPONSE", status: 200, evidenceId: "ev-result", durationMillis: 12 },
    ]
    installTransport()
    const verifications = [
      { eventId: "ev-result", originEvidenceId: "event-7", operation: event.op, resource: "order:7", identity: "관리자", identityId: "acct-1", timestamp: 2, status: 200, durationMs: 12 },
      { eventId: "ev-foreign", originEvidenceId: "event-other", operation: event.op, resource: null, identity: "bob", identityId: "bob", timestamp: 3, status: 403, durationMs: 9 },
    ]
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} verifications={verifications} />)

    const history = await screen.findByRole("region", { name: "검증 이력" })
    await waitFor(() => expect(history).toHaveTextContent("시간 초과"))
    expect(history).toHaveTextContent("HTTP 200")
    expect(history).toHaveTextContent("ev-result")
    expect(history).not.toHaveTextContent("ev-foreign")
    expect(history).not.toHaveTextContent("응답 없음")
    expect(within(history).getAllByRole("listitem")).toHaveLength(2)
  })

  it("locks the credential choice while a send is pending and refreshes the history afterwards", async () => {
    const send = deferredResponse()
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json(requestLabDraft()))
      if (String(input) === "/api/request-lab" && init?.method === "POST") return send.promise
      if (String(input) === "/api/manual-attempts") return Promise.resolve(json([]))
      return Promise.resolve(json({ success: true, message: "ok" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    await user.click(screen.getByRole("button", { name: "Request Lab 전송" }))

    expect(screen.getByLabelText("자격 증명 모드")).toBeDisabled()
    const before = fetch.mock.calls.filter(([input]) => String(input) === "/api/manual-attempts").length
    await act(async () => { send.resolve(json({ success: true, message: "sent", eventId: "ev-new", status: 200, response: "ok", durationMs: 3, requestBytes: 1, responseBytes: 2 })) })

    await waitFor(() => expect(screen.getByLabelText("자격 증명 모드")).toBeEnabled())
    await waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/manual-attempts").length).toBeGreaterThan(before))
  })
})
