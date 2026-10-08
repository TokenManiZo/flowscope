import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, type ReactElement } from "react"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { activeAccounts, RequestLabDialog } from "./RequestLabDialog"
import { OperationDetail } from "./OperationDetail"
import { createTestQueryClient, renderWithQueryClient as renderWithClient, seedHumanRun } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import type { Account, EventRecord, HumanRun, ManagedSession, Snapshot } from "@/lib/api/types"
import { createMemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { prepareDatasetReplacement } from "@/lib/security/datasetBoundary"

const secret = "POST /orders HTTP/1.1\nHost: api.example.test\n\nREQUEST-LAB-SECRET"
const capability = "CAPABILITY-MUST-NOT-LEAK"

const event: EventRecord = {
  eventId: "event-7", method: "POST", path: "/orders/7", status: 201, fp: "fp", idn: "alice", role: "user", source: "human", op: "POST /orders/{id}", resource: "order:7", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "AUTHENTICATED", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "cluster", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["event-7"], objects: [], verdict: "allow",
}

// Weakly verified (LEGACY_RESPONSE) but ACTIVE: the Request Lab stays backward compatible and can use it,
// unlike active cross-identity replay which requires a strong (operator-asserted / rule-matched) session.
const activeSession: ManagedSession = { handle: "opaque", accountId: "acct-1", accountLabel: "관리자", service: "https://api.example.test", status: "ACTIVE", verificationSource: "LEGACY_RESPONSE", createdAt: "now", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }
const registeredAccounts: Account[] = [
  { id: "acct-1", label: "관리자", role: "admin", target: activeSession.service, color: "", authArtifactCount: 1 },
  { id: "acct-2", label: "USER B", role: "user", target: activeSession.service, color: "", authArtifactCount: 1 },
  { id: "acct-3", label: "USER C", role: "user", target: activeSession.service, color: "", authArtifactCount: 0 },
  { id: "inactive", label: "비활성", role: "user", target: activeSession.service, color: "", authArtifactCount: 1 },
  { id: "other", label: "다른 서비스", role: "user", target: "https://other.example.test", color: "", authArtifactCount: 1 },
]

/** 사이드바가 받아 온 점검 상태. accountId ""는 비로그인 점검이다. */
const inspecting = (...accountIds: string[]): HumanRun => ({ active: accountIds.length > 0, completed: false, runId: "", accountId: "", proxy: "", runs: accountIds.map((accountId, index) => ({ runId: `run-${index}`, accountId, proxy: "" })) })
function clientInspecting(run: HumanRun) {
  return seedHumanRun(createTestQueryClient(), run)
}
// 이 파일의 기본은 비로그인으로 점검 중인 상태다. 점검 상태에 따른 기본 전송 인증은 따로 고정한다.
function renderWithQueryClient(ui: ReactElement, client = clientInspecting(inspecting(""))) {
  return renderWithClient(ui, client)
}

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }

function requestLabDraft(eventId = "event-7", request = secret) {
  return { headers: [], eventId, service: "https://api.example.test", request, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Response>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

function installTransport() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
    if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
    if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
    if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "sent-response", durationMs: 12, requestBytes: 4, responseBytes: 13 }))
    if (String(input) === "/api/manual-attempts") return Promise.resolve(json(attempts))
    return Promise.resolve(json({ success: true, message: "draft opened", openedDraft: true, status: 200, replayId: "r-1" }))
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

/** Draft whose observed account (acct-1) has a reusable session, plus that account's masked credential preview. */
function installReusableTransport(request = secret) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
    if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
    if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ ...requestLabDraft("event-7", request), reusableAccountId: "acct-1" }))
    if (String(input).startsWith("/api/account-settings")) return Promise.resolve(json({ human: { credentials: [{ name: "Authorization", preview: "Bearer eyJk••••" }] } }))
    if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "sent-response", durationMs: 12, requestBytes: 4, responseBytes: 13 }))
    if (String(input) === "/api/manual-attempts") return Promise.resolve(json([]))
    return Promise.resolve(json({ success: true, message: "draft opened", openedDraft: true, status: 200, replayId: "r-1" }))
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

let attempts: unknown[] = []
afterEach(() => { attempts = [] })

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

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

function authenticationLabel(value: string) {
  if (value === "ANONYMOUS") return "비로그인"
  if (value === "RAW") return "직접 입력"
  if (value === "ORIGINAL" || value === "") return /인증 (다시 )?선택/
  return registeredAccounts.find(account => value === `ACCOUNT:${account.id}`)!.label
}

async function chooseAuthentication(user: ReturnType<typeof userEvent.setup>, value: string) {
  if (!screen.queryByRole("listbox")) await user.click(screen.getByRole("combobox", { name: "전송 인증" }))
  await user.click(await screen.findByRole("option", { name: authenticationLabel(value) }))
}

async function openDraft(currentSession: boolean | null = false) {
  const request = await screen.findByLabelText("Request Lab 요청 원문")
  // 비로그인으로 점검 중이면 열자마자 원본에서 비로그인 편집본이 준비된다(Original·+ 없음).
  await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("비로그인"))
  await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
  if (currentSession) {
    await chooseAuthentication(userEvent.setup(), "ACCOUNT:acct-1")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1")))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
  }
  return request
}

describe("RequestLabDialog", () => {
  it("opens ready to send without logging in, offers registered accounts, and shows the original read-only on demand", async () => {
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await openDraft()
    expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "새 요청 추가" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Repeater/ })).not.toBeInTheDocument()
    expect(request).not.toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "작성 중 · 비로그인" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
    await user.click(screen.getByRole("combobox", { name: "전송 인증" }))
    const options = await screen.findByRole("listbox")
    expect(within(options).getByRole("option", { name: "관리자" })).toBeVisible()
    expect(within(options).getByRole("option", { name: "USER C · 점검 시작 후 사용 가능" })).toHaveAttribute("aria-disabled", "true")
    await user.keyboard("{Escape}")

    await user.click(screen.getByRole("button", { name: "원문 보기" }))
    expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue(secret)
    expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveAttribute("readonly")
    expect(screen.getByRole("note")).toHaveTextContent("처음 수집한 원문입니다")
    await user.click(screen.getByRole("button", { name: "편집으로 돌아가기" }))
    expect(screen.getByRole("button", { name: "작성 중 · 비로그인" })).toHaveAttribute("aria-pressed", "true")
    expect(fetch.mock.calls.some(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toBe(false)
  })

  it.each([
    ["the account being inspected", inspecting("acct-1"), "관리자"],
    ["비로그인 while inspecting without logging in", inspecting(""), "비로그인"],
  ])("defaults the send authentication to %s", async (_, run, label) => {
    installTransport()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />, clientInspecting(run))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(label))
  })

  it.each([
    ["nothing is being inspected", inspecting()],
    ["several identities are being inspected", inspecting("acct-1", "")],
    ["the inspected account has no usable session yet", inspecting("acct-2")],
  ])("leaves the send authentication empty when %s", async (_, run) => {
    const fetch = installTransport()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />, clientInspecting(run))
    await screen.findByRole("button", { name: /^작성 중 · / })
    // 고를 계정이 없으면 어떤 인증도 미리 적용하지 않는다.
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab/credentials")).toBe(false)
    expect(screen.getByRole("button", { name: "작성 중 · 인증 선택 전" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(/인증 선택/)
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
  })

  it("deletes any tab on its own and stays on the tab being viewed", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    for (const n of [1, 2, 3]) {
      await user.click(screen.getByRole("button", { name: "요청 재전송" }))
      await screen.findByRole("button", { name: `수정된 요청 ${n} · 비로그인 · 200` })
    }
    // 3번을 보는 채로 가운데 2번만 지운다. 뒤 탭을 먼저 지울 필요가 없다.
    await user.click(screen.getByRole("button", { name: "수정된 요청 2 삭제" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "수정된 요청 2 · 비로그인 · 200" })).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "수정된 요청 3 · 비로그인 · 200" })).toHaveAttribute("aria-pressed", "true")
  })

  it("stacks every send as 수정된 요청 N and continues edits or resends of a sent tab in a new tab", async () => {
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    const first = await screen.findByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })
    expect(first).toHaveAttribute("aria-pressed", "true")
    const sentFirst = String(screen.getByLabelText("Request Lab 요청 원문").getAttribute("value") ?? (screen.getByLabelText("Request Lab 요청 원문") as HTMLTextAreaElement).value)

    // 보낸 탭을 고치면 그 기록은 그대로 두고 새 탭(작성 중)에서 이어 간다.
    await user.type(screen.getByLabelText("Request Lab 요청 원문"), "X")
    expect(screen.getByRole("button", { name: "작성 중 · 비로그인" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    expect(await screen.findByRole("button", { name: "수정된 요청 2 · 비로그인 · 200" })).toHaveAttribute("aria-pressed", "true")

    await user.click(screen.getByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" }))
    expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue(sentFirst)
    // 보낸 탭을 그대로 다시 보내도 새 탭으로 쌓인다.
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    expect(await screen.findByRole("button", { name: "수정된 요청 3 · 비로그인 · 200" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })).toBeInTheDocument()
    const sends = fetch.mock.calls.filter(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")
    expect(sends).toHaveLength(3)
    expect(sends.map(([, init]) => new URLSearchParams(String(init?.body)).get("credentialMode"))).toEqual(["ANONYMOUS", "ANONYMOUS", "ANONYMOUS"])
  })

  it("keeps the request untouched and sends credentialMode RAW in 직접 입력 mode", async () => {
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const editor = await openDraft() as HTMLTextAreaElement
    // 계정·비로그인에서는 인증 헤더가 교체된다고 안내한다.
    expect(screen.getByText(/고른 전송 인증으로 바뀝니다/)).toBeInTheDocument()
    const text = editor.value
    const credsBefore = fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab/credentials").length
    await chooseAuthentication(user, "RAW")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("직접 입력"))
    // 직접 입력은 인증 교체 미리보기를 부르지 않고 요청 본문을 그대로 둔다.
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab/credentials").length).toBe(credsBefore)
    expect((screen.getByLabelText("Request Lab 요청 원문") as HTMLTextAreaElement).value).toBe(text)
    expect(screen.getByText(/그대로 보냅니다/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch.mock.calls.some(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toBe(true))
    const sent = fetch.mock.calls.find(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")
    expect(new URLSearchParams(String(sent?.[1]?.body)).get("credentialMode")).toBe("RAW")
    expect(await screen.findByRole("button", { name: "수정된 요청 1 · 직접 입력 · 200" })).toBeInTheDocument()
  })

  it("sends with an account that is being checked right now", async () => {
    const fetch = installReusableTransport()
    const user = userEvent.setup()
    const capturing: ManagedSession = { ...activeSession, status: "CAPTURING", capturing: true, replayReady: true }
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[capturing]} />)
    await openDraft()
    expect(screen.getByRole("note")).toHaveTextContent("이 기록의 계정(alice)으로 보내려면 전송 인증에서 alice을(를) 고르세요.")
    await chooseAuthentication(user, "ACCOUNT:acct-1")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("관리자"))
    await waitFor(() => expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch.mock.calls.some(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toBe(true))
    const sent = fetch.mock.calls.find(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")
    expect(new URLSearchParams(String(sent?.[1]?.body)).get("credentialMode")).toBe("ACCOUNT")
    expect(new URLSearchParams(String(sent?.[1]?.body)).get("accountId")).toBe("acct-1")
    expect(await screen.findByRole("button", { name: "수정된 요청 1 · 관리자 · 200" })).toBeInTheDocument()
    expect(activeAccounts([capturing, { ...capturing, accountId: "acct-2", replayReady: false }], activeSession.service).map(item => item.accountId)).toEqual(["acct-1"])
  })

  it("deletes the selected tab and prepares a fresh 비로그인 draft once every tab is gone", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await screen.findByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })
    await user.click(screen.getByRole("button", { name: "수정된 요청 1 삭제" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })).not.toBeInTheDocument())
    expect(await screen.findByRole("button", { name: "작성 중 · 비로그인" })).toHaveAttribute("aria-pressed", "true")
  })

  it("tells how to send as the record's identity when its session is not ready yet", async () => {
    const fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(json(String(input) === "/api/manual-attempts" ? [] : { ...requestLabDraft(), observedIdentity: "USER B", observedAccountId: "acct-2" })))
    vi.stubGlobal("fetch", fetch)
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    expect(await screen.findByRole("note")).toHaveTextContent("USER B로 보내려면 계정·세션에서 USER B의 점검 시작을 누르고 로그인하세요.")
  })

  it("keeps each tab's explicit account across traffic updates, and uses it for preview and send", async () => {
    const owner = createMemoryOnlyRawState()
    const original = "POST /orders HTTP/1.1\nHost: api.example.test\nCookie: original-demo\nAuthorization: Bearer original-demo\n\nbody-kept"
    const second: ManagedSession = { ...activeSession, handle: "second", accountId: "acct-2", accountLabel: "USER B", replayReady: true }
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") {
        const values = new URLSearchParams(String(init?.body))
        const id = values.get("accountId")
        return Promise.resolve(json({ headers: values.get("credentialMode") === "ANONYMOUS" ? [] : [
          { name: "Cookie", value: `session=${id}` }, { name: "Authorization", value: `Bearer ${id}` },
        ] }))
      }
      if (String(input) === "/api/request-lab") return Promise.resolve(json({ success: true, eventId: "event-7", response: "ok", status: 200, durationMs: 1 }))
      return Promise.resolve(json(requestLabDraft("event-7", original)))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession, second]} rawState={owner} />)
    await openDraft()
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    for (const [index, id] of ["acct-1", "acct-2"].entries()) {
      await chooseAuthentication(user, `ACCOUNT:${id}`)
      await waitFor(() => expect(authentication).toHaveTextContent(authenticationLabel(`ACCOUNT:${id}`)))
      await waitFor(() => expect(authentication).toBeEnabled())
      expect(owner.request).toContain(`Cookie: session=${id}`)
      expect(owner.request).toContain(`Authorization: Bearer ${id}`)
      expect(owner.request).not.toContain("original-demo")
      expect(owner.request.split("\n\n")[1]).toBe("body-kept")
      await user.click(screen.getByRole("button", { name: "요청 재전송" }))
      await screen.findByRole("button", { name: `수정된 요청 ${index + 1} · ${authenticationLabel(`ACCOUNT:${id}`)} · 200` })
      for (const route of ["/api/request-lab/credentials", "/api/request-lab"]) {
        const values = new URLSearchParams(String(fetch.mock.calls.filter(([input]) => String(input) === route).at(-1)?.[1]?.body))
        expect(values.get("accountId")).toBe(id)
        expect(values.get("credentialMode")).toBe("ACCOUNT")
        if (route !== "/api/request-lab/credentials") expect(values.get("request")).toContain(`Cookie: session=${id}`)
      }
    }
    view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[{ ...activeSession, lastRecordedAt: "2099-01-01T00:00:00Z" }, second]} rawState={owner} />)
    expect(authentication).toHaveTextContent(authenticationLabel("ACCOUNT:acct-2"))
    // 보낸 탭의 인증을 바꾸면 새 탭에서 바꾼다.
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(authentication).toHaveTextContent(authenticationLabel("ANONYMOUS")))
    expect(owner.request).not.toMatch(/Cookie:|Authorization:/)
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await screen.findByRole("button", { name: "수정된 요청 3 · 비로그인 · 200" })
    const anonymous = new URLSearchParams(String(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab").at(-1)?.[1]?.body))
    expect(anonymous.get("accountId")).toBe("")
    expect(anonymous.get("credentialMode")).toBe("ANONYMOUS")
    await user.click(screen.getByRole("button", { name: "수정된 요청 1 · 관리자 · 200" }))
    expect(authentication).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1"))
    expect(owner.request).toContain("Cookie: session=acct-1")
    await user.click(screen.getByRole("button", { name: "수정된 요청 2 · USER B · 200" }))
    view.rerender(<RequestLabDialog accounts={registeredAccounts.filter(account => account.id !== "acct-2")} open onOpenChange={vi.fn()} event={event} sessions={[activeSession, second]} rawState={owner} />)
    expect(authentication).toHaveTextContent(authenticationLabel(""))
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
  })

  it("keeps account A selected when switching to account B fails", async () => {
    const owner = createMemoryOnlyRawState()
    const second = { ...activeSession, handle: "second", accountId: "acct-2" }
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/request-lab/credentials") return Promise.resolve(json(requestLabDraft()))
      return Promise.resolve(new URLSearchParams(String(init?.body)).get("accountId") === "acct-2"
        ? json({ success: false, message: "B 세션 만료" }, 400)
        : json({ headers: [{ name: "Cookie", value: "session=A" }] }))
    }))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession, second]} rawState={owner} />)
    await openDraft(true)
    await chooseAuthentication(user, "ACCOUNT:acct-2")
    expect(await screen.findByRole("alert")).toHaveTextContent("B 세션 만료")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1"))
    expect(owner.requests[0]?.accountId).toBe("acct-1")
    expect(owner.request).toContain("Cookie: session=A")
  })

  it("projects account/anonymous credentials into the editing copy without sending or caching them", async () => {
    const original = 'POST /orders HTTP/1.1\nHost: api.example.test\nCookie: ORIGINAL_DEMO\nX-Custom: keep\nContent-Type: application/json\n\n{"id":9007199254740993,"amount":1.2300}'
    const owner = createMemoryOnlyRawState()
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") {
        const mode = new URLSearchParams(String(init?.body)).get("credentialMode")
        return Promise.resolve(json({ headers: mode === "ANONYMOUS" ? [] : [{ name: "Authorization", value: "Bearer ACCOUNT_DEMO" }, { name: "Cookie", value: "ACCOUNT_DEMO" }] }))
      }
      return Promise.resolve(json(requestLabDraft("event-7", original)))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const { client } = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    // 열 때 비로그인이 적용돼 원래 쿠키가 빠진다.
    expect(owner.request).not.toContain("ORIGINAL_DEMO")
    fireEvent.change(request, { target: { value: original.replace('/orders ', '/edited ').replace('keep', 'edited') } })
    const before = owner.request
    const pane = screen.getByRole("region", { name: "Request 원문 패널" })
    await user.click(within(pane).getByRole("button", { name: "JSON 정돈" }))
    const derived = owner.jsonViews.request!
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    await chooseAuthentication(user, "ACCOUNT:acct-1")
    await waitFor(() => expect(authentication).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1")))
    await waitFor(() => expect(authentication).toBeEnabled())
    expect(request).toBeVisible()
    expect(owner.request).toContain("Bearer ACCOUNT_DEMO")
    expect(owner.request).not.toContain("ORIGINAL_DEMO")
    expect(owner.request.split('\n\n')[1]).toBe(before.split('\n\n')[1])
    expect(owner.request).toContain("X-Custom: edited")
    expect(derived.text).toBe("")
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(authentication).toHaveTextContent(authenticationLabel("ANONYMOUS")))
    await waitFor(() => expect(authentication).toBeEnabled())
    expect(owner.request).not.toContain("Authorization:")
    expect(owner.request).not.toContain("Cookie:")
    expect(owner.request).toContain("POST /edited HTTP/1.1")
    expect(owner.requests).toHaveLength(1)
    expect(owner.originalRequest).toBe(original)
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain("ACCOUNT_DEMO")
    expect(Object.values(localStorage)).not.toContain("ACCOUNT_DEMO")
    expect(Object.values(sessionStorage)).not.toContain("ACCOUNT_DEMO")
  })

  it("keeps the previous mode and request when credential preview fails", async () => {
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input) === "/api/request-lab/credentials"
      ? json({ success: false, message: "세션을 확인해 주세요." }, 400) : json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    // 열 때 비로그인 적용이 실패하면 알리고, 인증을 고르기 전에는 보내지 않는다.
    expect(await screen.findByRole("alert")).toHaveTextContent("세션을 확인해 주세요.")
    await chooseAuthentication(user, "ACCOUNT:acct-1")
    expect(await screen.findByRole("alert")).toHaveTextContent("세션을 확인해 주세요.")
    expect(owner.request).toBe(secret)
    expect(owner.requests[0]?.credentialMode).toBe("ORIGINAL")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
  })

  it.each(["close", "dataset", "unmount", "session"] as const)("locks actions during preview and ignores a late credential response after %s", async action => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let previewSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab/credentials") {
        if (new URLSearchParams(String(init?.body)).get("credentialMode") === "ANONYMOUS") return Promise.resolve(json({ headers: [] }))
        previewSignal = init?.signal ?? undefined
        return pending.promise
      }
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={1} rawState={owner} />)
    const request = await openDraft()
    await chooseAuthentication(user, "ACCOUNT:acct-1")
    expect(request).toBeDisabled()
    expect(screen.getByRole("button", { name: "원문 보기" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "작성 중 삭제" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    if (action === "close") await user.click(screen.getByRole("button", { name: "닫기" }))
    else if (action === "unmount") view.unmount()
    else view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={action === "session" ? [] : [activeSession]} datasetRevision={action === "dataset" ? 2 : 1} rawState={owner} />)
    expect(previewSignal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json({ headers: [{ name: "Cookie", value: "LATE_ACCOUNT_DEMO" }] })); await pending.promise })
    expect(owner.request).not.toContain("LATE_ACCOUNT_DEMO")
    expect(owner.originalRequest).not.toContain("LATE_ACCOUNT_DEMO")
    expect(owner.requests.some(item => item.request.includes("LATE_ACCOUNT_DEMO"))).toBe(false)
    if (action === "session") {
      expect(owner.requests[0]?.credentialMode).toBe("ANONYMOUS")
      expect(request).toBeEnabled()
    } else if (action !== "dataset") expect(owner.requests).toHaveLength(0)
  })

  it("resizes from both corners, bounds the window and restores its custom size after fullscreen without remounting editors", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: "edited resize draft" } })
    const response = screen.getByLabelText("Request Lab 응답 원문")
    const dialog = screen.getByRole("dialog", { name: "Request Lab" })
    const rect = vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => ({ width: Number(dialog.style.getPropertyValue("--request-lab-width").replace('px', '')) || 960, height: 600 } as DOMRect))
    const left = screen.getByRole("button", { name: "왼쪽 모서리 크기 조절" })
    const right = screen.getByRole("button", { name: "오른쪽 모서리 크기 조절" })
    fireEvent.keyDown(left, { key: "ArrowLeft" })
    expect(dialog.style.getPropertyValue("--request-lab-width")).toBe(`${Math.min(innerWidth - 32, 992)}px`)
    fireEvent.keyDown(right, { key: "ArrowRight" })
    expect(dialog.style.getPropertyValue("--request-lab-width")).toBe(`${Math.min(innerWidth - 32, 1024)}px`)
    const width = dialog.style.getPropertyValue("--request-lab-width")
    await user.click(screen.getByRole("button", { name: "전체화면" }))
    expect(screen.queryByRole("button", { name: "왼쪽 모서리 크기 조절" })).not.toBeInTheDocument()
    expect(dialog.style.width).toBe("calc(100vw - 24px)")
    await user.keyboard("{Escape}")
    expect(dialog.style.getPropertyValue("--request-lab-width")).toBe(width)
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBe(request)
    expect(screen.getByLabelText("Request Lab 응답 원문")).toBe(response)
    expect(request).toHaveValue("edited resize draft")
    await user.click(screen.getByRole("button", { name: "기본 크기" }))
    expect(dialog.style.getPropertyValue("--request-lab-width")).toBe("")
    rect.mockRestore()
  })

  it("keeps the previous tab's response, starts the next send in a new empty tab and keeps a failure response-less", async () => {
    let sends = 0
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return ++sends === 1
        ? Promise.resolve(json({ response: "HTTP/1.1 403 Forbidden", status: 403, durationMs: 2 })) : pending.promise
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("HTTP/1.1 403 Forbidden"))
    const oldResult = owner.requests[0]!.result!
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    // 다시 보내면 새 탭에서 보내고, 앞 탭의 응답은 기록으로 남는다.
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("")
    expect(oldResult.response).toBe("HTTP/1.1 403 Forbidden")
    await act(async () => { pending.reject(new Error("connection failed")); await pending.promise.catch(() => {}) })
    expect(await screen.findByRole("alert")).toHaveTextContent("connection failed")
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("")
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBeEnabled()
    expect(owner.requests[1]!.result).toMatchObject({ response: "", status: 0 })
    expect(owner.requests[0]!.result).toMatchObject({ response: "HTTP/1.1 403 Forbidden", status: 403 })
    expect(screen.getByRole("button", { name: "수정된 요청 2 · 비로그인 · 실패" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("alert")).toHaveTextContent("대상 처리 여부 미확인")
    expect(screen.queryByRole("option", { name: /#.*HTTP/ })).not.toBeInTheDocument()
  })

  it("keeps invalid JSON in Raw without helper rows and disables its formatting action", async () => {
    installReusableTransport('POST /orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"unfinished":')
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await screen.findByLabelText("Request Lab 요청 원문")
    const pane = screen.getByRole("region", { name: "Request 원문 패널" })
    const jsonButton = within(pane).getByRole("button", { name: "JSON 정돈" })
    await user.click(jsonButton)
    expect(jsonButton).toBeDisabled()
    expect(request).toBeVisible()
    expect(screen.queryByText("JSON 형식이 올바르지 않습니다. Raw에서 확인하세요.")).not.toBeInTheDocument()
    expect(within(pane).queryByText("전송은 Raw 요청을 사용합니다.")).not.toBeInTheDocument()
  })

  it("rejects an oversized editing buffer without retaining it or sending the previous draft", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: "x".repeat(1_048_577) } })
    expect(owner.request).toBe(secret)
    expect(screen.getByRole("alert")).toHaveTextContent("편집에 반영하지 않았습니다")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    expect(request).toHaveValue(secret)
    await user.click(screen.getByRole("button", { name: "원문 보기" }))
    await user.click(screen.getByRole("button", { name: "편집으로 돌아가기" }))
    expect(screen.getByRole("alert")).toHaveTextContent("편집에 반영하지 않았습니다")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    fireEvent.change(request, { target: { value: "x".repeat(1_048_577) } })
    expect(request).toHaveValue(secret)
    fireEvent.change(request, { target: { value: "smaller draft" } })
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
  })

  it("keeps the editors and draft when changing window, panel and font settings", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await openDraft()
    const response = screen.getByLabelText("Request Lab 응답 원문")
    fireEvent.change(request, { target: { value: "EDITED-DRAFT" } })
    await user.click(screen.getByRole("button", { name: "전체화면" }))
    await user.click(screen.getByRole("button", { name: "응답 확대" }))
    expect(request).not.toBeVisible()
    expect(response).toBeVisible()
    await user.selectOptions(screen.getByRole("combobox", { name: "글자 크기" }), "18")
    await user.click(screen.getByRole("button", { name: "함께 보기" }))
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBe(request)
    expect(request).toHaveValue("EDITED-DRAFT")
    expect(request).toHaveStyle({ fontSize: "18px" })
    expect(response).toHaveStyle({ fontSize: "18px" })
    await user.keyboard("{Escape}")
    expect(screen.getByRole("button", { name: "전체화면" })).toBeVisible()
    expect(request).toHaveValue("EDITED-DRAFT")
  })

  it("shows unavailable raw data as a compact status banner instead of a content card", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>((input) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: "GET /masked", response: null, rawRequestRetained: false, rawResponseRetained: false, requestEditable: false, requestCharset: "UTF-8", responseCharset: null, observedIdentity: "alice", reusableSession: "없음", message: "마스킹된 읽기 전용 초안입니다." }))
      return Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} />)

    const status = await screen.findByRole("status")
    expect(status).toHaveClass("p-2")
    expect(status).not.toHaveClass("p-6")
    expect(status.closest('[data-slot="card"]')).toBeNull()
    expect(status).not.toHaveTextContent("GET /masked")
    expect(status).not.toHaveTextContent("event-7")
    // 원문이 없어 보낼 수 없는 이유와, 다시 보내려면 무엇을 해야 하는지 알려 준다.
    expect(status).toHaveTextContent("일부만 남아 있어 편집·재전송할 수 없습니다")
    expect(status).toHaveTextContent("이 API를 한 번 더 둘러본 뒤 새 기록에서 Request Lab을 여세요")
    // 돌아갈 편집본이 없으니 눌러도 아무 일이 없는 버튼을 두지 않는다.
    expect(screen.getByRole("button", { name: "편집으로 돌아가기" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "편집으로 돌아가기" })).toHaveAttribute("title", "이 기록은 원문이 일부만 남아 있어 편집할 수 없습니다.")
    expect(screen.getByRole("note")).toHaveTextContent("처음 수집한 원문입니다. 읽기 전용입니다.")
    expect(screen.getByRole("note")).not.toHaveTextContent("편집으로 돌아가면")
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
    await user.click(screen.getByRole("button", { name: "Request Lab 열기" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/requirement", expect.objectContaining({ method: "POST" })))
    const calls = new Map(fetch.mock.calls.map(([input, init]) => [String(input), init]))
    expect(new Headers(calls.get("/api/requirement")?.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded;charset=UTF-8")
    expect(new URLSearchParams(String(calls.get("/api/requirement")?.body))).toEqual(new URLSearchParams({ operation: event.op, role: "admin" }))
    expect(new URLSearchParams(String(calls.get("/api/traffic-override")?.body))).toEqual(new URLSearchParams({ operation: event.op, value: "EXCLUDE" }))
    expect(new URLSearchParams(String(calls.get("/api/owner")?.body))).toEqual(new URLSearchParams({ resource: "order:7", identity: "bob" }))
    expect(openRequestLab).toHaveBeenCalledTimes(1)
  })

  it("keeps a weak LEGACY_RESPONSE ACTIVE session usable as the current session for backward compatibility", async () => {
    installReusableTransport()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)

    await openDraft(true)
    // Active cross-identity replay rejects this LEGACY_RESPONSE session; the Request Lab still offers it.
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1"))
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()
  })

  it("keeps authentication in the header without the removed metadata or credential-preview rows", async () => {
    const fetch = installReusableTransport()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft(true)
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    expect(authentication).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1"))
    expect(authentication).toHaveTextContent("관리자")
    expect(screen.queryByRole("region", { name: "Request Lab 메타데이터" })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([input]) => String(input).startsWith("/api/account-settings"))).toBe(false)
  })

  it("lists every registered account and disables unavailable sessions", async () => {
    installReusableTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession, { ...activeSession, accountId: "inactive", accountLabel: "비활성", status: "EXPIRED" }, { ...activeSession, accountId: "other", service: "https://other.example.test" }]} />)

    expect(await openDraft(true)).toHaveValue(secret)
    await user.click(screen.getByRole("combobox", { name: "전송 인증" }))
    for (const label of ["USER B", "USER C", "비활성", "다른 서비스"]) {
      expect(screen.getByRole("option", { name: `${label} · 점검 시작 후 사용 가능` })).toHaveAttribute("aria-disabled", "true")
    }
  })

  it("sends exact form data when switching account and anonymous authentication", async () => {
    const fetch = installReusableTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)

    expect(await openDraft(true)).toHaveValue(secret)
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/request-lab", expect.objectContaining({ method: "POST" })))
    const call = fetch.mock.calls.find(([input]) => String(input) === "/api/request-lab")
    const sent = new URLSearchParams(String(call?.[1]?.body))
    // 서버는 operationId가 없으면 400으로 거부한다. 누를 때마다 새 값이다.
    expect(sent.get("operationId")).toMatch(/^[A-Za-z0-9_-]{16,120}$/)
    sent.delete("operationId")
    expect(sent).toEqual(new URLSearchParams({ action: "send", eventId: "event-7", credentialMode: "ACCOUNT", accountId: "acct-1", request: secret }))
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ANONYMOUS")))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await chooseAuthentication(user, "ACCOUNT:acct-1")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ACCOUNT:acct-1")))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
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
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} />)

    expect(await screen.findByText(/Standalone 데모에서는/)).toBeVisible()
    // 편집할 수 없는 원문이면 편집본(작성 중 탭)을 만들지 않고 인증도 고를 수 없다.
    expect(screen.queryByRole("button", { name: /작성 중/ })).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeDisabled()
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBeDisabled()
    const send = screen.getByRole("button", { name: "요청 재전송" })
    expect(send).toBeDisabled()

    send.removeAttribute("disabled")
    fireEvent.click(send)
    await Promise.resolve()
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")).toHaveLength(0)
  })

  it("does not persist, log, serialize, or retain raw values after close or pagehide", async () => {
    const fetch = installTransport()
    const storage = vi.spyOn(Storage.prototype, "setItem")
    const indexedDb = vi.fn()
    Object.defineProperty(window, "indexedDB", { configurable: true, get: indexedDb })
    const log = vi.spyOn(console, "log")
    const user = userEvent.setup()
    const { client } = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(secret)
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(capability)
    expect(storage).not.toHaveBeenCalled()
    expect(indexedDb).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "닫기" }))
    window.dispatchEvent(new Event("pagehide"))
    expect(document.body.textContent).not.toContain(secret)
    expect(Object.values(localStorage)).not.toContain(secret)
    expect(Object.values(sessionStorage)).not.toContain(secret)
    expect(fetch).toHaveBeenCalledWith("/api/request-lab?eventId=event-7", expect.any(Object))
  })

  it("disables the current session without a reusable session and locks sending if it disappears", async () => {
    installTransport()
    const { unmount } = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} />)
    await openDraft()
    await userEvent.click(screen.getByRole("combobox", { name: "전송 인증" }))
    expect(screen.getByRole("option", { name: "관리자 · 점검 시작 후 사용 가능" })).toHaveAttribute("aria-disabled", "true")
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ANONYMOUS"))
    unmount()

    installReusableTransport()
    const { rerender } = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft(true)
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
    rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} />)
    await waitFor(() => expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled())
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel(""))
  })

  it("retries a draft load and stacks each send as its own tab", async () => {
    let attempts = 0
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      if (String(input) === "/api/request-lab?eventId=event-7") {
        attempts += 1
        return Promise.resolve(attempts === 1 ? json({ success: false, message: "초안 서버 오류" }, 503) : json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "observed-response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      }
      if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 201, response: `result-${attempts++}`, durationMs: 12, requestBytes: 4, responseBytes: 13 }))
      return Promise.resolve(json({ success: true, message: "draft opened", openedDraft: true, status: 200, replayId: "r-1" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("초안 서버 오류")
    await user.click(screen.getByRole("button", { name: "Request Lab 초안 다시 시도" }))
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("result-3"))
    const tabs = screen.getByRole("group", { name: "보낸 요청" })
    expect(within(tabs).getAllByRole("button").map(button => button.textContent).filter(text => text?.startsWith("수정된"))).toEqual(["수정된 요청 1 · 비로그인 · 201", "수정된 요청 2 · 비로그인 · 201"])
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
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
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: secret, response: "", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return init?.method === "POST" ? pendingSend : Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: "가".repeat(349_526) } })
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("1,048,576")
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    fireEvent.change(request, { target: { value: "ok" } })
    const send = screen.getByRole("button", { name: "요청 재전송" })
    await user.click(send)
    expect(send).toBeDisabled()
    await user.click(send)
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")).toHaveLength(1)
    resolveSend(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "ok", durationMs: 1, requestBytes: 2, responseBytes: 2 }))
    await waitFor(() => expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("ok"))
  })

  it("allows explicitly selecting a replay-ready collecting account without hiding other registered accounts", async () => {
    const older: ManagedSession = { ...activeSession, lastRecordedAt: "2026-09-30T05:00:00Z" }
    const collecting: ManagedSession = { ...activeSession, handle: "b-handle", accountId: "acct-2", accountLabel: "USER B", status: "CAPTURING", capturing: true, replayReady: true, lastRecordedAt: "2026-09-30T05:10:00Z" }
    const notReady: ManagedSession = { ...collecting, handle: "c-handle", accountId: "acct-3", accountLabel: "USER C", replayReady: false, lastRecordedAt: "2026-09-30T05:20:00Z" }
    const fetch = installReusableTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[older, collecting, notReady]} />)

    await openDraft()
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    expect(authentication).toHaveTextContent(authenticationLabel("ANONYMOUS"))
    await user.click(authentication)
    expect(screen.getByRole("option", { name: "USER B" })).not.toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "USER C · 점검 시작 후 사용 가능" })).toHaveAttribute("aria-disabled", "true")
    await chooseAuthentication(user, "ACCOUNT:acct-2")
    await waitFor(() => expect(authentication).toHaveTextContent(authenticationLabel("ACCOUNT:acct-2")))
    await waitFor(() => expect(authentication).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch.mock.calls.some(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toBe(true))
    const call = fetch.mock.calls.find(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")
    expect(new URLSearchParams(String(call?.[1]?.body)).get("accountId")).toBe("acct-2")
  })

  it("scrubs every independent request and result on dataset revision", async () => {
    const owner = createMemoryOnlyRawState()
    const original = "GET /revision HTTP/1.1\nHost: api.example.test\n\nREVISION-REQUEST"
    let revision = 1
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: revision === 1 ? original : "", response: revision === 1 ? "REVISION-RESPONSE" : "", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return init?.method === "POST" ? Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "REVISION-HISTORY", durationMs: 1, requestBytes: 1, responseBytes: 1 })) : Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await screen.findAllByText("REVISION-HISTORY")
    expect(owner.request).toBe(original)
    expect(owner.response).toBe("REVISION-HISTORY")
    expect(owner.requests[0]?.result?.response).toBe("REVISION-HISTORY")
    revision = 2
    view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe(""))
    expect(owner.response).toBe("")
    // 이전 프로젝트의 보낸 기록은 모두 지워진다(새 원문으로 만든 빈 편집본만 남을 수 있다).
    expect(owner.requests.every(item => !item.result && !item.request.includes("REVISION"))).toBe(true)
  })

  it("keeps an edited draft when only ordinary analysis data refreshes", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = installTransport()
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)
    const request = await openDraft()
    await user.clear(request)
    await user.type(request, "EDITED-WHILE-CAPTURING")

    view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={{ ...event, repeatCount: 2 }} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)

    expect(owner.request).toBe("EDITED-WHILE-CAPTURING")
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab?eventId=event-7")).toHaveLength(1)
  })

  it("scrubs held request/result/JSON references and unregisters the unload listener on unmount", async () => {
    const owner = createMemoryOnlyRawState()
    installTransport()
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    const entry = owner.requests[0]!
    owner.replaceResult(entry, { response: "UNMOUNT-RESPONSE", status: 200, durationMs: 1 })
    const result = entry.result!
    const derived = { text: "UNMOUNT-JSON", message: "" }
    owner.jsonViews.response = derived
    const entries = owner.requests
    const beforeUnloadHandler = add.mock.calls.find(([type]) => type === "beforeunload")?.[1]
    expect(beforeUnloadHandler).toBeDefined()
    view.unmount()
    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(entry.request).toBe("")
    expect(result.response).toBe("")
    expect(derived.text).toBe("")
    expect(entries).toHaveLength(0)
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
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={onOpenChange} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await user.click(screen.getByRole("button", { name: "닫기" }))

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-CLOSE", durationMs: 3, requestBytes: 1, responseBytes: 10 }))
      await pending.promise
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(owner.requests).toHaveLength(0)
  })

  it("does not restore a pending raw draft after pagehide", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn(() => pending.promise))
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    act(() => window.dispatchEvent(new Event("pagehide")))
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
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    view.unmount()
    expect(sendSignal?.aborted).toBe(true)

    await act(async () => {
      pending.reject(new Error("LATE-UNMOUNT"))
      await pending.promise.catch(() => undefined)
    })

    expect(owner.request).toBe("")
    expect(owner.response).toBe("")
    expect(owner.requests).toHaveLength(0)
  })

  it("isolates a late send completion when the selected 요청 기록 changes", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    const nextEvent = { ...event, eventId: "event-8" }
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return pending.promise
      if (String(input) === "/api/request-lab?eventId=event-8") return Promise.resolve(json(requestLabDraft("event-8", "NEXT-EVIDENCE")))
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={nextEvent} sessions={[activeSession]} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("NEXT-EVIDENCE"))
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-EVIDENCE", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("NEXT-EVIDENCE")
    expect(owner.originalResponse).toBe("observed-response")
    expect(owner.requests.some(item => item.result?.response === "LATE-EVIDENCE")).toBe(false)
  })

  it("isolates a late send completion when the dataset revision changes", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let draftRequest = "GET /revision HTTP/1.1\nHost: api.example.test\n\nREVISION-ONE"
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return pending.promise
      return Promise.resolve(json(requestLabDraft("event-7", draftRequest)))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={1} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    draftRequest = "REVISION-TWO"
    view.rerender(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={2} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("REVISION-TWO"))
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-REVISION", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("REVISION-TWO")
    expect(owner.originalResponse).toBe("observed-response")
    expect(owner.requests.some(item => item.result?.response === "LATE-REVISION")).toBe(false)
  })

  it("applies the response and clears sending for a send that completes in its original context", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/request-lab" && init?.method === "POST" ? pending.promise : Promise.resolve(json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 204, response: "CURRENT-CONTEXT", durationMs: 3, requestBytes: 1, responseBytes: 15 }))

    await waitFor(() => expect(owner.response).toBe("CURRENT-CONTEXT"))
    expect(owner.requests[0]?.result?.response).toBe("CURRENT-CONTEXT")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
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
      return <><button onClick={() => setSuspended(true)}>suspend snapshot</button><button onClick={() => setSuspended(false)}>resume snapshot</button><RequestLabDialog accounts={registeredAccounts} open suspended={suspended} onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} /></>
    }
    renderWithQueryClient(<Harness />)
    await openDraft()
    const dialog = screen.getByRole("dialog", { name: "Request Lab" })
    await user.click(within(dialog).getByRole("button", { name: "요청 재전송" }))
    fireEvent.click(screen.getByText("suspend snapshot"))
    expect(sendSignal?.aborted).toBe(false)
    expect(within(dialog).getByRole("button", { name: "요청 재전송 중" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200,
        response: "COMPLETED-WHILE-SUSPENDED", durationMs: 3, requestBytes: 1, responseBytes: 25 }))
      await pending.promise
    })

    expect(owner.response).toBe("COMPLETED-WHILE-SUSPENDED")
    expect(owner.requests).toHaveLength(1)
    expect(within(dialog).getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    fireEvent.click(screen.getByText("resume snapshot"))
    expect(within(dialog).getByRole("button", { name: "요청 재전송" })).toBeEnabled()
  })

  it("starts with no live replay history even when persisted verification metadata exists", async () => {
    const fetch = installTransport()
    const verifications = [{ eventId: "ev-result", originEvidenceId: "event-7", operation: event.op, resource: "order:7", identity: "관리자", identityId: "acct-1", timestamp: 2, status: 200, durationMs: 12 }]
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} verifications={verifications} />)
    await screen.findByLabelText("Request Lab 요청 원문")
    expect(screen.queryByRole("combobox", { name: "편집 요청 선택" })).not.toBeInTheDocument()
    expect(screen.queryByText("전송 이력")).not.toBeInTheDocument()
    expect(screen.queryByText("ev-result")).not.toBeInTheDocument()
    expect(verifications).toHaveLength(1)
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/manual-attempts")).toBe(false)
  })

  it("locks request controls while sending and re-enables editing when the latest response arrives", async () => {
    const send = deferredResponse()
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json(requestLabDraft()))
      if (String(input) === "/api/request-lab" && init?.method === "POST") return send.promise
      if (String(input) === "/api/manual-attempts") return Promise.resolve(json([]))
      return Promise.resolve(json({ success: true, message: "ok" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))

    expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "원문 보기" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "작성 중 · 비로그인" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "수정된 요청 1 삭제" })).toBeDisabled()
    await act(async () => { send.resolve(json({ success: true, message: "sent", eventId: "ev-new", status: 200, response: "ok", durationMs: 3, requestBytes: 1, responseBytes: 2 })) })

    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    expect(screen.getByRole("button", { name: "수정된 요청 1 · 비로그인 · 200" })).toBeEnabled()
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("ok")
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
  })
  it("keeps exact Raw when switching JSON views and manually sending, and scrubs derived views", async () => {
    const owner = createMemoryOnlyRawState()
    const original = 'POST /orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"id":9007199254740993,"amount":1.2300}'
    const fetch = installReusableTransport(original)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    const pane = screen.getByRole("region", { name: "Request 원문 패널" })
    await user.click(within(pane).getByRole("button", { name: "JSON 정돈" }))
    const formatted = owner.jsonViews.request!
    expect(formatted.text).toContain('"id": 9007199254740993')
    expect(formatted.text).toContain('"amount": 1.2300')
    expect(request).not.toBeVisible()
    expect(owner.request).toBe(original)
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    await user.click(within(pane).getByRole("button", { name: "Raw" }))
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBe(request)
    // textarea.value normalizes CRLF to LF; the memory owner and send payload must retain CRLF.
    expect(request).toHaveValue(original.replace(/\r\n/g, "\n"))
    expect(owner.request).toBe(original)
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent(authenticationLabel("ANONYMOUS")))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/request-lab", expect.objectContaining({ method: "POST" })))
    const sent = fetch.mock.calls.find(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")
    expect(new URLSearchParams(String(sent?.[1]?.body)).get("request")).toBe(original)
    expect(owner.request).toBe(original)
    await user.click(screen.getByRole("button", { name: "닫기" }))
    expect(formatted.text).toBe("")
    expect(owner.jsonViews.request).toBeNull()
  })

  it("restores saved editable names/REQ/latest RES without a live Original and requires fresh credentials", async () => {
    let revision = 3
    const savedRequest = "POST /orders HTTP/1.1\nCookie: ***MASKED***\n\n{}"
    const workspace = { datasetRevision: 7, revision, persisted: true, tab: { nextId: 5, selectedId: 4, entries: {
      "4": { name: "저장한 주문", request: savedRequest, credentialMode: "ACCOUNT", result: { response: "last-response", status: 200, durationMs: 3, requestBytes: 50, responseBytes: 13 }, dirty: true },
    } } }
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      if (String(input) === "/api/request-lab/workspace") return Promise.resolve(json({ datasetRevision: 7, revision: ++revision, persisted: true }))
      if (String(input) === "/api/request-lab" && init?.method === "POST") return Promise.resolve(json({ response: "latest-response", status: 201, durationMs: 2, requestBytes: 10, responseBytes: 15 }))
      return Promise.resolve(json({ ...requestLabDraft(), rawRequestRetained: false, rawResponseRetained: false, requestEditable: false, workspace }))
    })
    vi.stubGlobal("fetch", fetch)
    const owner = createMemoryOnlyRawState(), onOpenChange = vi.fn(), user = userEvent.setup()
    const { client } = renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={onOpenChange} event={event} sessions={[activeSession]} rawState={owner} datasetRevision={7} />)
    await waitFor(() => expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue(savedRequest))
    // 저장한 보낸 탭이 그대로 열린다. 편집할 원문이 없어 새 편집본은 만들지 않는다.
    expect(screen.getByRole("button", { name: "저장한 주문 · 계정 · 200" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("last-response")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    // 보낸 탭의 인증을 바꾸면 새 탭에서 이어 간다.
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(owner.request).not.toContain("Cookie:"))
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("latest-response"))
    expect(screen.getByRole("button", { name: "수정된 요청 1 · 비로그인 · 201" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "저장한 주문 · 계정 · 200" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "닫기" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const changes = fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab/workspace").map(([, init]) => JSON.parse(new URLSearchParams(String(init?.body)).get("change")!))
    expect(changes.some(change => change.result?.response === "latest-response")).toBe(true)
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain("latest-response")
    expect(owner.requests).toHaveLength(0)
  })

  it("keeps live text when a page departure is cancelled and scrubs it on actual pagehide", async () => {
    installTransport()
    const owner = createMemoryOnlyRawState(), user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("sent-response"))
    const cancelDeparture = (event: Event) => event.preventDefault()
    window.addEventListener("beforeunload", cancelDeparture)
    try {
      act(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))
      expect(owner.request).toBe(secret)
      expect(owner.response).toBe("sent-response")
      act(() => window.dispatchEvent(new Event("pagehide")))
      expect(owner.request).toBe("")
      expect(owner.response).toBe("")
      expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument()
    } finally { window.removeEventListener("beforeunload", cancelDeparture) }
  })

  it("keeps a request visible until delete commits, and preserves it after DB failure", async () => {
    const pending = deferredResponse()
    let fail = true
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/workspace") {
        const change = JSON.parse(new URLSearchParams(String(init?.body)).get("change")!)
        if (change.action === "delete") return fail ? Promise.resolve(json({ success: false, message: "DB locked" }, 409)) : pending.promise
        return Promise.resolve(json({ datasetRevision: 7, revision: 2, persisted: true }))
      }
      return Promise.resolve(json({ ...requestLabDraft(), workspace: { datasetRevision: 7, revision: 1, persisted: true,
        tab: { nextId: 2, selectedId: 1, entries: { "1": { name: "saved", request: "editable", credentialMode: "ANONYMOUS", result: null, dirty: false } } } } }))
    })
    vi.stubGlobal("fetch", fetch)
    const owner = createMemoryOnlyRawState(), user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} rawState={owner} datasetRevision={7} />)
    await waitFor(() => expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("editable"))
    await user.click(screen.getByRole("button", { name: "saved 삭제" }))
    expect(await screen.findByText(/삭제하지 못했습니다/)).toBeVisible()
    expect(owner.requests).toHaveLength(1)
    fail = false
    await user.click(screen.getByRole("button", { name: "saved 삭제" }))
    expect(owner.request).toBe("editable")
    expect(screen.getByRole("button", { name: "saved 삭제" })).toBeDisabled()
    await act(async () => { pending.resolve(json({ datasetRevision: 7, revision: 2, persisted: true })); await pending.promise })
    // 마지막 탭을 지우면 원본에서 비로그인 편집본을 새로 준비한다.
    await waitFor(() => expect(owner.requests.map(item => item.name)).toEqual(["작성 중"]))
    expect(await screen.findByRole("button", { name: "작성 중 · 비로그인" })).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps unsaved changes open when closing fails and flushes before dataset replacement", async () => {
    const owner = createMemoryOnlyRawState(), onOpenChange = vi.fn(), user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/request-lab/workspace"
      ? Promise.resolve(json({ success: false, message: "disk full" }, 409))
      : Promise.resolve(json({ ...requestLabDraft(), workspace: { datasetRevision: 7, revision: 0, persisted: true, tab: { nextId: 1, selectedId: 0, entries: {} } } }))))
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={onOpenChange} event={event} sessions={[]} rawState={owner} datasetRevision={7} />)
    // 열면 비로그인 편집본이 바로 준비된다.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("비로그인"))
    fireEvent.change(screen.getByLabelText("Request Lab 요청 원문"), { target: { value: "KEEP-UNSAVED" } })
    await user.click(screen.getByRole("button", { name: "닫기" }))
    expect(await screen.findByText("disk full")).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(owner.request).toBe("KEEP-UNSAVED")
    await act(async () => { await expect(prepareDatasetReplacement()).rejects.toThrow("disk full") })
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "변경 버리고 닫기" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(owner.request).toBe("")
  })

})

describe("RequestLabDialog search", () => {
  const searchBox = () => screen.getByRole("searchbox", { name: "요청·응답에서 찾기" })
  const activeMarkIn = (pane: string) => screen.getByLabelText(pane).querySelector("[data-search-active]")

  it("finds text across the request and response, steps through matches, and marks the current one", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    // 관측 원문 — 요청: api.example.test·REQUEST-LAB-SECRET, 응답: observed-response.
    await user.click(screen.getByRole("button", { name: "원문 보기" }))
    await user.type(searchBox(), "es")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("1 / 3")
    expect(document.querySelectorAll("mark")).toHaveLength(3)
    expect(activeMarkIn("Request 원문 패널")).toHaveTextContent("es")
    await user.keyboard("{Enter}")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("2 / 3")
    expect(activeMarkIn("Request 원문 패널")).toHaveTextContent("ES")
    await user.click(screen.getByRole("button", { name: "다음 검색 결과" }))
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("3 / 3")
    expect(activeMarkIn("Request 원문 패널")).toBeNull()
    expect(activeMarkIn("Response 원문 패널")).toHaveTextContent("es")
    await user.click(screen.getByRole("button", { name: "다음 검색 결과" }))
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("1 / 3")
    await user.type(searchBox(), "{Shift>}{Enter}{/Shift}")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("3 / 3")

    // 한쪽만 크게 볼 때는 보이는 패널에서만 찾는다.
    await user.click(screen.getByRole("button", { name: "요청 확대" }))
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("2 / 2")
    await user.clear(searchBox())
    await user.type(searchBox(), "observed")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("없음")
    expect(screen.getByRole("button", { name: "다음 검색 결과" })).toBeDisabled()
    expect(document.querySelectorAll("mark")).toHaveLength(0)
  })

  it("clears the search with Escape without closing, and Ctrl+F jumps to the search box", async () => {
    installTransport()
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={onOpenChange} event={event} sessions={[activeSession]} />)
    const request = await openDraft()
    await user.click(request)
    await user.keyboard("{Control>}f{/Control}")
    expect(searchBox()).toHaveFocus()
    await user.keyboard("secret")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("1 / 1")
    await user.keyboard("{Escape}")
    expect(searchBox()).toHaveValue("")
    expect(screen.getByLabelText("검색 결과")).toHaveTextContent("")
    expect(screen.getByRole("dialog", { name: "Request Lab" })).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    // 편집 중인 요청에서 찾은 글도 그대로 남고, 검색이 요청 값을 바꾸지 않는다.
    await user.type(searchBox(), "orders")
    expect(request).toHaveValue(secret)
  })
})

describe("RequestLabDialog legacy masks", () => {
  const masked = "POST /login HTTP/1.1\nHost: api.example.test\nAuthorization: ***MASKED***\nCookie: session=***\n\n{\"password\":\"***MASKED***\"}"

  it("warns about values masked by older versions, points to them, and still allows sending", async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json(requestLabDraft("event-7", masked)))
      if (String(input) === "/api/request-lab/credentials") return Promise.resolve(json({ headers: [] }))
      return Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    // 점검 중이 아니면 인증을 고르기 전 편집본이 원문 그대로 열린다.
    renderWithQueryClient(<RequestLabDialog accounts={registeredAccounts} open onOpenChange={vi.fn()} event={event} sessions={[]} />, clientInspecting(inspecting()))
    const warning = await screen.findByRole("status", { name: "이전 버전에서 가려진 값" })
    expect(warning).toHaveTextContent("3곳")
    expect(document.querySelectorAll('mark[data-mark-style="warning"]')).toHaveLength(3)

    // 비로그인은 인증 헤더를 바꾸므로 본문 비밀번호 하나만 남는다. 전송은 막지 않는다.
    await chooseAuthentication(user, "ANONYMOUS")
    await waitFor(() => expect(screen.getByRole("status", { name: "이전 버전에서 가려진 값" })).toHaveTextContent("1곳"))
    expect(screen.getByRole("status", { name: "이전 버전에서 가려진 값" })).toHaveTextContent("인증 헤더(Authorization·Cookie·CSRF)는 세지 않았습니다")
    await waitFor(() => expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "위치 보기" }))
    expect(screen.getByLabelText("Request 원문 패널").querySelector("[data-search-active]")).toHaveTextContent("***MASKED***")
    expect(screen.getByRole("button", { name: "다음 위치 1 / 1" })).toBeVisible()

    // 검색 중에는 검색 표시가 우선하고, 값을 채우면 경고가 사라진다.
    await user.type(screen.getByRole("searchbox", { name: "요청·응답에서 찾기" }), "login")
    expect(document.querySelectorAll('mark[data-mark-style="warning"]')).toHaveLength(0)
    await user.clear(screen.getByRole("searchbox", { name: "요청·응답에서 찾기" }))
    const request = screen.getByLabelText("Request Lab 요청 원문") as HTMLTextAreaElement
    fireEvent.change(request, { target: { value: request.value.replace("***MASKED***", "real-password") } })
    await waitFor(() => expect(screen.queryByRole("status", { name: "이전 버전에서 가려진 값" })).not.toBeInTheDocument())
  })
})
