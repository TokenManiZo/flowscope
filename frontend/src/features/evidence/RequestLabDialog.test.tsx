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

const secret = "POST /orders HTTP/1.1\nHost: api.example.test\n\nREQUEST-LAB-SECRET"
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

async function openDraft(currentSession = false) {
  const request = await screen.findByLabelText("Request Lab 요청 원문")
  await userEvent.click(screen.getByRole("button", { name: "새 요청 추가" }))
  // Session-specific tests opt into the asynchronous credential preview.
  const authentication = screen.getByRole("combobox", { name: "전송 인증" })
  if (currentSession && !(within(authentication).getByRole("option", { name: /현재 세션/ }) as HTMLOptionElement).disabled) { await userEvent.selectOptions(authentication, "ACCOUNT"); await waitFor(() => expect(authentication).toHaveValue("ACCOUNT")); await waitFor(() => expect(authentication).toBeEnabled()) }
  return request
}

describe("RequestLabDialog", () => {
  it("projects account/anonymous/original credentials into only the selected editor without sending or caching them", async () => {
    const original = 'POST /orders HTTP/1.1\nHost: api.example.test\nCookie: ORIGINAL_DEMO\nX-Custom: keep\nContent-Type: application/json\n\n{"id":9007199254740993,"amount":1.2300}'
    const owner = createMemoryOnlyRawState()
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab/credentials") {
        const mode = new URLSearchParams(String(init?.body)).get("credentialMode")
        return Promise.resolve(json({ headers: mode === "ANONYMOUS" ? [] : mode === "ORIGINAL" ? [{ name: "Cookie", value: "ORIGINAL_DEMO" }] : [{ name: "Authorization", value: "Bearer ACCOUNT_DEMO" }, { name: "Cookie", value: "ACCOUNT_DEMO" }] }))
      }
      return Promise.resolve(json(requestLabDraft("event-7", original)))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const { client } = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: original.replace('/orders ', '/edited ').replace('keep', 'edited') } })
    const before = owner.request
    const pane = screen.getByRole("region", { name: "Request 원문 패널" })
    await user.click(within(pane).getByRole("button", { name: "JSON 정돈" }))
    const derived = owner.jsonViews.request!
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    await user.selectOptions(authentication, "ACCOUNT")
    await waitFor(() => expect(authentication).toHaveValue("ACCOUNT"))
    await waitFor(() => expect(authentication).toBeEnabled())
    expect(request).toBeVisible()
    expect(owner.request).toContain("Bearer ACCOUNT_DEMO")
    expect(owner.request).not.toContain("ORIGINAL_DEMO")
    expect(owner.request.split('\n\n')[1]).toBe(before.split('\n\n')[1])
    expect(owner.request).toContain("X-Custom: edited")
    expect(derived.text).toBe("")
    const projected = owner.request
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    await user.selectOptions(authentication, "ANONYMOUS")
    await waitFor(() => expect(authentication).toHaveValue("ANONYMOUS"))
    await waitFor(() => expect(authentication).toBeEnabled())
    expect(owner.request).not.toContain("Authorization:")
    expect(owner.request).not.toContain("Cookie:")
    expect(owner.requests[0]?.request).toBe(projected)
    await user.selectOptions(authentication, "ORIGINAL")
    await waitFor(() => expect(authentication).toHaveValue("ORIGINAL"))
    expect(owner.request).toContain("Cookie: ORIGINAL_DEMO")
    expect(owner.request).toContain("POST /edited HTTP/1.1")
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ACCOUNT")
    expect(await screen.findByRole("alert")).toHaveTextContent("세션을 확인해 주세요.")
    expect(owner.request).toBe(secret)
    expect(owner.requests[0]?.credentialMode).toBe("ORIGINAL")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
  })

  it.each(["close", "dataset", "unmount", "session"] as const)("locks actions during preview and ignores a late credential response after %s", async action => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    let previewSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab/credentials") { previewSignal = init?.signal ?? undefined; return pending.promise }
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={1} rawState={owner} />)
    const request = await openDraft()
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ACCOUNT")
    expect(request).toBeDisabled()
    expect(screen.getByRole("button", { name: "Original" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "새 요청 추가" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 1 삭제" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 이름 변경" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    if (action === "close") await user.click(screen.getByRole("button", { name: "닫기" }))
    else if (action === "unmount") view.unmount()
    else view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={action === "session" ? [] : [activeSession]} datasetRevision={action === "dataset" ? 2 : 1} rawState={owner} />)
    expect(previewSignal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json({ headers: [{ name: "Cookie", value: "LATE_ACCOUNT_DEMO" }] })); await pending.promise })
    expect(owner.request).not.toContain("LATE_ACCOUNT_DEMO")
    expect(owner.originalRequest).not.toContain("LATE_ACCOUNT_DEMO")
    if (action === "session") {
      expect(owner.requests[0]?.credentialMode).toBe("ORIGINAL")
      expect(request).toBeEnabled()
    } else expect(owner.requests).toHaveLength(0)
  })

  it("resizes from both corners, bounds the window and restores its custom size after fullscreen without remounting editors", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
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

  it("adds independent editable requests without sending, preserves Original and restores each position/auth/result", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await screen.findByLabelText("Request Lab 요청 원문") as HTMLTextAreaElement
    const response = screen.getByLabelText("Request Lab 응답 원문") as HTMLTextAreaElement
    expect(request).toHaveAttribute("readonly")
    expect(request).toHaveValue(secret)
    expect(response).toHaveValue("observed-response")
    expect(screen.queryByRole("combobox", { name: "편집 요청 선택" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    expect(request).not.toHaveAttribute("readonly")
    expect(request).toHaveFocus()
    expect(response).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ORIGINAL")
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
    fireEvent.change(request, { target: { value: "submitted draft" } })
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(response).toHaveValue("sent-response"))
    expect(request).not.toHaveAttribute("readonly")
    fireEvent.change(request, { target: { value: "GET /edited HTTP/1.1\nHost: api.example.test\n\nunsent draft" } })
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ANONYMOUS")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ANONYMOUS"))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    expect(screen.getByText(/이전 응답/)).toBeInTheDocument()
    request.setSelectionRange(2, 5)
    request.scrollTop = 80
    request.scrollLeft = 12
    response.scrollTop = 34
    fireEvent.scroll(request)
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    expect(request).toHaveValue("GET /edited HTTP/1.1\nHost: api.example.test\n\nunsent draft")
    expect(response).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ANONYMOUS")
    fireEvent.change(request, { target: { value: "second request" } })
    await user.click(screen.getByRole("button", { name: "Original" }))
    expect(request).toHaveValue(secret)
    expect(response).toHaveValue("observed-response")
    expect(screen.getByRole("button", { name: "편집 요청 삭제" })).toBeDisabled()
    await user.selectOptions(screen.getByRole("combobox", { name: "편집 요청 선택" }), "1")
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBe(request)
    expect(request).toHaveValue("GET /edited HTTP/1.1\nHost: api.example.test\n\nunsent draft")
    expect(request.selectionStart).toBe(2)
    expect(request.selectionEnd).toBe(5)
    expect(request.scrollTop).toBe(80)
    expect(request.scrollLeft).toBe(12)
    expect(response.scrollTop).toBe(34)
    expect(response).toHaveValue("sent-response")
    expect(owner.originalRequest).toBe(secret)
    expect(owner.requests).toHaveLength(2)
    expect(owner.requests[1]?.request).toBe("second request")
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab")).toHaveLength(1)
  })

  it("renames independent requests without changing their request, authentication or last response", async () => {
    const fetch = installTransport()
    const owner = createMemoryOnlyRawState()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: "edited request" } })
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("sent-response"))
    const first = owner.requests[0]!
    const result = first.result
    const calls = fetch.mock.calls.length
    await user.click(screen.getByRole("button", { name: "요청 이름 변경" }))
    const name = screen.getByRole("textbox", { name: "요청 이름" })
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute("maxlength", "80")
    await user.clear(name)
    await user.type(name, "  주문 확인  {Enter}")
    expect(screen.getByRole("option", { name: "주문 확인" })).toHaveValue("1")
    expect(first.name).toBe("주문 확인")
    expect(first.request).toBe("edited request")
    expect(first.credentialMode).toBe("ORIGINAL")
    expect(first.dirty).toBe(false)
    expect(first.result).toBe(result)
    expect(fetch.mock.calls).toHaveLength(calls)
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBe(request)

    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    expect(screen.getByRole("option", { name: "요청 2" })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole("combobox", { name: "편집 요청 선택" }), "1")
    expect(request).toHaveValue("edited request")
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("sent-response")
    await user.click(screen.getByRole("button", { name: "Original" }))
    expect(screen.getByRole("button", { name: "요청 이름 변경" })).toBeDisabled()
    await user.selectOptions(screen.getByRole("combobox", { name: "편집 요청 선택" }), "1")
    await user.click(screen.getByRole("button", { name: "주문 확인 삭제" }))
    expect(first.name).toBe("")
    expect(screen.getByRole("combobox", { name: "편집 요청 선택" })).toHaveValue("2")
  })

  it("saves request names on blur, ignores blank names, cancels Escape and clears an unfinished name on dataset replacement", async () => {
    installTransport()
    const owner = createMemoryOnlyRawState()
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} datasetRevision={1} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 이름 변경" }))
    await user.clear(screen.getByRole("textbox", { name: "요청 이름" }))
    await user.type(screen.getByRole("textbox", { name: "요청 이름" }), "검토 중")
    await user.click(screen.getByRole("button", { name: "요청 확대" }))
    expect(screen.getByRole("option", { name: "검토 중" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "요청 이름 변경" }))
    await user.clear(screen.getByRole("textbox", { name: "요청 이름" }))
    await user.type(screen.getByRole("textbox", { name: "요청 이름" }), "   {Enter}")
    expect(owner.requests[0]?.name).toBe("검토 중")
    await user.click(screen.getByRole("button", { name: "요청 이름 변경" }))
    await user.clear(screen.getByRole("textbox", { name: "요청 이름" }))
    await user.type(screen.getByRole("textbox", { name: "요청 이름" }), "취소할 이름{Escape}")
    expect(owner.requests[0]?.name).toBe("검토 중")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "요청 이름 변경" }))
    const unfinished = screen.getByRole("textbox", { name: "요청 이름" })
    await user.clear(unfinished)
    await user.type(unfinished, "미완성 이름")
    const first = owner.requests[0]!
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} datasetRevision={2} />)
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "요청 이름" })).not.toBeInTheDocument())
    expect(first.name).toBe("")
    expect(unfinished).toHaveValue("")
    expect(owner.requests).toHaveLength(0)
  })

  it("deletes only the selected request/result, selects its neighbour and hides the dropdown after the last deletion", async () => {
    const owner = createMemoryOnlyRawState()
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("sent-response"))
    const removed = owner.requests[0]!
    const result = removed.result!
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    const choices = screen.getByRole("combobox", { name: "편집 요청 선택" })
    await user.selectOptions(choices, "1")
    await user.click(screen.getByRole("button", { name: "요청 1 삭제" }))
    expect(choices).toHaveValue("2")
    expect(removed.request).toBe("")
    expect(result.response).toBe("")
    await user.selectOptions(choices, "3")
    await user.click(screen.getByRole("button", { name: "요청 3 삭제" }))
    expect(choices).toHaveValue("2")
    await user.click(screen.getByRole("button", { name: "요청 2 삭제" }))
    expect(screen.queryByRole("combobox", { name: "편집 요청 선택" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue(secret)
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("observed-response")
    await user.click(screen.getByRole("button", { name: "새 요청 추가" }))
    expect(screen.getByRole("option", { name: "요청 4" })).toBeInTheDocument()
  })

  it("clears the previous response at send start and keeps failure response-less and request editable", async () => {
    let sends = 0
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-lab" && init?.method === "POST") return ++sends === 1
        ? Promise.resolve(json({ response: "HTTP/1.1 403 Forbidden", status: 403, durationMs: 2 })) : pending.promise
      return Promise.resolve(json(requestLabDraft()))
    }))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(owner.response).toBe("HTTP/1.1 403 Forbidden"))
    const oldResult = owner.requests[0]!.result!
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("")
    expect(oldResult.response).toBe("")
    await act(async () => { pending.reject(new Error("connection failed")); await pending.promise.catch(() => {}) })
    expect(await screen.findByRole("alert")).toHaveTextContent("connection failed")
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("")
    expect(request).not.toHaveAttribute("readonly")
    expect(request).toBeEnabled()
    expect(owner.requests[0]!.result).toMatchObject({ response: "", status: 0 })
    expect(screen.getByRole("alert")).toHaveTextContent("대상 처리 여부 미확인")
    expect(screen.queryByRole("option", { name: /#.*HTTP/ })).not.toBeInTheDocument()
  })

  it("keeps invalid JSON in Raw without helper rows and disables its formatting action", async () => {
    installReusableTransport('POST /orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"unfinished":')
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    const request = await openDraft()
    fireEvent.change(request, { target: { value: "x".repeat(1_048_577) } })
    expect(owner.request).toBe(secret)
    expect(screen.getByRole("alert")).toHaveTextContent("편집에 반영하지 않았습니다")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    expect(request).toHaveValue(secret)
    await user.click(screen.getByRole("button", { name: "Original" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "편집 요청 선택" }), "1")
    expect(screen.getByRole("alert")).toHaveTextContent("편집에 반영하지 않았습니다")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    fireEvent.change(request, { target: { value: "x".repeat(1_048_577) } })
    expect(request).toHaveValue(secret)
    fireEvent.change(request, { target: { value: "smaller draft" } })
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeEnabled()
    expect(fetch.mock.calls.some(([input]) => String(input) === "/api/request-lab")).toBe(false)
  })

  it("ignores a late Repeater handoff result after the dialog closes", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/replay" ? pending.promise : Promise.resolve(json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "Repeater로 보내기" }))
    await user.click(screen.getByRole("button", { name: "닫기" }))
    await act(async () => { pending.resolve(json({ openedDraft: true, message: "opened", success: true })); await pending.promise })
    expect(owner.originalRequest).toBe("")
    expect(owner.request).toBe("")
    expect(screen.queryByText("Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다.")).not.toBeInTheDocument()
  })

  it("keeps the editors and draft when changing window, panel and font settings", async () => {
    installTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)

    await openDraft(true)
    // Active cross-identity replay rejects this LEGACY_RESPONSE session; the Request Lab still offers it.
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ACCOUNT")
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()
  })

  it("keeps authentication in the header without the removed metadata or credential-preview rows", async () => {
    const fetch = installReusableTransport()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft(true)
    const authentication = screen.getByRole("combobox", { name: "전송 인증" })
    expect(authentication).toHaveValue("ACCOUNT")
    expect(within(authentication).getByRole("option", { name: "현재 세션 · 관리자" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Request Lab 메타데이터" })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([input]) => String(input).startsWith("/api/account-settings"))).toBe(false)
  })

  it("loads a fresh memory-only draft, sends exact form data for ORIGINAL/ANONYMOUS/ACCOUNT, and never offers another account", async () => {
    const fetch = installReusableTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession, { ...activeSession, accountId: "inactive", accountLabel: "비활성", status: "EXPIRED" }, { ...activeSession, accountId: "other", service: "https://other.example.test" }]} />)

    expect(await openDraft(true)).toHaveValue(secret)
    expect(screen.queryByText("비활성")).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ORIGINAL")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ORIGINAL"))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/request-lab", expect.objectContaining({ method: "POST" })))
    const call = fetch.mock.calls.find(([input]) => String(input) === "/api/request-lab")
    const sent = new URLSearchParams(String(call?.[1]?.body))
    // 서버는 operationId가 없으면 400으로 거부한다. 누를 때마다 새 값이다.
    expect(sent.get("operationId")).toMatch(/^[A-Za-z0-9_-]{16,120}$/)
    sent.delete("operationId")
    expect(sent).toEqual(new URLSearchParams({ action: "send", eventId: "event-7", credentialMode: "ORIGINAL", accountId: "", request: secret }))
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ANONYMOUS")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ANONYMOUS"))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ACCOUNT")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ACCOUNT"))
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)

    expect(await screen.findByText(/Standalone 데모에서는/)).toBeVisible()
    expect(screen.getByRole("button", { name: "새 요청 추가" })).toBeDisabled()
    expect(screen.queryByRole("combobox", { name: "편집 요청 선택" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Request Lab 요청 원문")).toBeDisabled()
    const send = screen.getByRole("button", { name: "요청 재전송" })
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
    await openDraft()
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

  it("disables the current session without a reusable session and locks sending if it disappears", async () => {
    installTransport()
    const { unmount } = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)
    await openDraft()
    expect(within(screen.getByRole("combobox", { name: "전송 인증" })).getByRole("option", { name: /현재 세션/ })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ORIGINAL")
    unmount()

    installReusableTransport()
    const { rerender } = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft(true)
    expect(screen.getByRole("button", { name: "Repeater로 보내기" })).toBeEnabled()
    rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[]} />)
    await waitFor(() => expect(screen.getByRole("button", { name: "Repeater로 보내기" })).toBeDisabled())
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ACCOUNT")
  })

  it("retries a draft load and replaces the latest result without adding result choices", async () => {
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
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    const choices = screen.getByRole("combobox", { name: "편집 요청 선택" })
    expect(within(choices).getAllByRole("option").map(option => option.textContent)).toEqual(["요청 선택", "요청 1"])
    await waitFor(() => expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("result-3"))
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
  })

  it("blocks duplicate Repeater handoff while the unsent draft is opening", async () => {
    let resolveReplay!: (response: Response) => void
    const replay = new Promise<Response>((resolve) => { resolveReplay = resolve })
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => String(input) === "/api/request-lab/credentials" ? Promise.resolve(json({ headers: [] })) : String(input) === "/api/replay" ? replay : Promise.resolve(json({ ...requestLabDraft(), reusableAccountId: "acct-1" })))
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft(true)
    const handoff = screen.getByRole("button", { name: "Repeater로 보내기" })
    await user.click(handoff)
    expect(screen.getByRole("button", { name: "Repeater 준비 중" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Repeater 준비 중" }))
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/replay")).toHaveLength(1)
    const replayCall = fetch.mock.calls.find(([input]) => String(input) === "/api/replay")
    expect(new URLSearchParams(String(replayCall?.[1]?.body))).toEqual(new URLSearchParams({ eventId: "event-7", request: secret, credentialMode: "ACCOUNT", accountId: "acct-1" }))
    resolveReplay(json({ success: true, message: "draft", openedDraft: true, status: 200, replayId: "r" }))
    expect(await screen.findByText("Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다.")).toBeVisible()
    for (const [label, mode] of [["비로그인", "ANONYMOUS"], ["원문", "ORIGINAL"]] as const) {
      await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), mode)
      await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue(mode))
      await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
      await user.click(screen.getByRole("button", { name: "Repeater로 보내기" }))
      await waitFor(() => expect(new URLSearchParams(String(fetch.mock.calls.filter(([input]) => String(input) === "/api/replay").at(-1)?.[1]?.body)).get("credentialMode")).toBe(mode))
      const call = fetch.mock.calls.filter(([input]) => String(input) === "/api/replay").at(-1)
      expect(new URLSearchParams(String(call?.[1]?.body))).toEqual(new URLSearchParams({ eventId: "event-7", request: secret, credentialMode: mode, accountId: "" }))
    }
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

  it("uses the identity being collected now (latest recorded session), not the request's original account", async () => {
    const older: ManagedSession = { ...activeSession, lastRecordedAt: "2026-09-30T05:00:00Z" }
    const collecting: ManagedSession = { ...activeSession, handle: "b-handle", accountId: "acct-2", accountLabel: "USER B", status: "CAPTURING", capturing: true, replayReady: true, lastRecordedAt: "2026-09-30T05:10:00Z" }
    const notReady: ManagedSession = { ...collecting, handle: "c-handle", accountId: "acct-3", accountLabel: "USER C", replayReady: false, lastRecordedAt: "2026-09-30T05:20:00Z" }
    const fetch = installReusableTransport()
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[older, collecting, notReady]} />)

    await openDraft(true)
    expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("USER B")
    expect(screen.getByRole("combobox", { name: "전송 인증" })).not.toHaveTextContent("USER C")
    await user.click(screen.getByRole("button", { name: "Repeater로 보내기" }))
    await waitFor(() => expect(fetch.mock.calls.some(([input]) => String(input) === "/api/replay")).toBe(true))
    const call = fetch.mock.calls.find(([input]) => String(input) === "/api/replay")
    expect(new URLSearchParams(String(call?.[1]?.body)).get("accountId")).toBe("acct-2")
  })

  it("scrubs every independent request and result on dataset revision", async () => {
    const owner = createMemoryOnlyRawState()
    let revision = 1
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json({ eventId: "event-7", service: "https://api.example.test", request: revision === 1 ? "REVISION-REQUEST" : "", response: revision === 1 ? "REVISION-RESPONSE" : "", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", message: "draft" }))
      return init?.method === "POST" ? Promise.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "REVISION-HISTORY", durationMs: 1, requestBytes: 1, responseBytes: 1 })) : Promise.resolve(json({ success: true }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    await screen.findAllByText("REVISION-HISTORY")
    expect(owner.request).toBe("REVISION-REQUEST")
    expect(owner.response).toBe("REVISION-HISTORY")
    expect(owner.requests[0]?.result?.response).toBe("REVISION-HISTORY")
    revision = 2
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={revision} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe(""))
    expect(owner.response).toBe("")
    expect(owner.requests).toHaveLength(0)
  })

  it("keeps an edited draft when only ordinary analysis data refreshes", async () => {
    const owner = createMemoryOnlyRawState()
    const fetch = installTransport()
    const user = userEvent.setup()
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)
    const request = await openDraft()
    await user.clear(request)
    await user.type(request, "EDITED-WHILE-CAPTURING")

    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={{ ...event, repeatCount: 2 }} sessions={[activeSession]} datasetRevision={7} rawState={owner} />)

    expect(owner.request).toBe("EDITED-WHILE-CAPTURING")
    expect(fetch.mock.calls.filter(([input]) => String(input) === "/api/request-lab?eventId=event-7")).toHaveLength(1)
  })

  it("scrubs held request/result/JSON references and unregisters the unload listener on unmount", async () => {
    const owner = createMemoryOnlyRawState()
    installTransport()
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const view = renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={onOpenChange} event={event} sessions={[activeSession]} rawState={owner} />)
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

  it("isolates a late send completion when the selected 관측 기록 changes", async () => {
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
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={nextEvent} sessions={[activeSession]} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("NEXT-EVIDENCE"))
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-EVIDENCE", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("NEXT-EVIDENCE")
    expect(owner.response).toBe("observed-response")
    expect(owner.requests).toHaveLength(0)
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
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))
    draftRequest = "REVISION-TWO"
    view.rerender(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} datasetRevision={2} rawState={owner} />)
    await waitFor(() => expect(owner.request).toBe("REVISION-TWO"))
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()

    await act(async () => {
      pending.resolve(json({ success: true, message: "sent", eventId: "event-7", status: 200, response: "LATE-REVISION", durationMs: 3, requestBytes: 1, responseBytes: 13 }))
      await pending.promise
    })

    expect(owner.request).toBe("REVISION-TWO")
    expect(owner.response).toBe("observed-response")
    expect(owner.requests).toHaveLength(0)
  })

  it("applies the response and clears sending for a send that completes in its original context", async () => {
    const pending = deferredResponse()
    const owner = createMemoryOnlyRawState()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/request-lab" && init?.method === "POST" ? pending.promise : Promise.resolve(json(requestLabDraft()))))
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
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
      return <><button onClick={() => setSuspended(true)}>suspend snapshot</button><button onClick={() => setSuspended(false)}>resume snapshot</button><RequestLabDialog open suspended={suspended} onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} /></>
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
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} verifications={verifications} />)
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
      if (String(input) === "/api/request-lab?eventId=event-7") return Promise.resolve(json(requestLabDraft()))
      if (String(input) === "/api/request-lab" && init?.method === "POST") return send.promise
      if (String(input) === "/api/manual-attempts") return Promise.resolve(json([]))
      return Promise.resolve(json({ success: true, message: "ok" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} />)
    await openDraft()
    await user.click(screen.getByRole("button", { name: "요청 재전송" }))

    expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "편집 요청 선택" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Original" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "새 요청 추가" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 1 삭제" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "요청 이름 변경" })).toBeDisabled()
    await act(async () => { send.resolve(json({ success: true, message: "sent", eventId: "ev-new", status: 200, response: "ok", durationMs: 3, requestBytes: 1, responseBytes: 2 })) })

    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toBeEnabled())
    expect(screen.getByRole("combobox", { name: "편집 요청 선택" })).toBeEnabled()
    expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("ok")
    expect(screen.getByLabelText("Request Lab 요청 원문")).not.toHaveAttribute("readonly")
  })
  it("keeps exact Raw when switching JSON views and manually sending, and scrubs derived views", async () => {
    const owner = createMemoryOnlyRawState()
    const original = 'POST /orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"id":9007199254740993,"amount":1.2300}'
    const fetch = installReusableTransport(original)
    const user = userEvent.setup()
    renderWithQueryClient(<RequestLabDialog open onOpenChange={vi.fn()} event={event} sessions={[activeSession]} rawState={owner} />)
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
    await user.selectOptions(screen.getByRole("combobox", { name: "전송 인증" }), "ORIGINAL")
    await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveValue("ORIGINAL"))
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

})
