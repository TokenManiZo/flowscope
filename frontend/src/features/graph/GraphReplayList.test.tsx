import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { EventRecord, ManualVerification, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { GraphReplayList } from "./GraphReplayList"

const replay: ManualVerification = { eventId: "replay-55", originEvidenceId: "original-7", operation: "https://api.example.test POST /orders/{id}", resource: "orders:7", identity: "alice", identityId: "acct-a", timestamp: 100, status: 200, durationMs: 12 }
const replayRecord = { eventId: replay.eventId, op: replay.operation, idn: replay.identityId, path: "/orders/7", method: "POST", status: 200, timestamp: 100 } as EventRecord
const snapshot: Snapshot = targetSnapshot({ datasetRevision: 3, events: [replayRecord], manualVerifications: [replay], evidenceOrdinals: { [replay.eventId]: 55 }, accounts: [{ id: "acct-a", label: "USER A", role: "user", target: "https://api.example.test", color: "", authArtifactCount: 0 }] })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
function transport(missing = false) {
  const fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(missing
    ? json({ success: false, message: "삭제된 재현 기록입니다." }, 404)
    : json({ eventId: replay.eventId, service: "https://api.example.test", request: "POST /orders/7 HTTP/1.1\r\nHost: api.example.test\r\n\r\n", response: "HTTP/1.1 200 OK\r\n\r\nRECORDED-REPLAY", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "USER A", reusableSession: "없음", message: "" })))
  vi.stubGlobal("fetch", fetch)
  return fetch
}
afterEach(() => vi.unstubAllGlobals())

it("opens the exact recorded replay in read-only Request Lab without sending or choosing credentials", async () => {
  const fetch = transport(), onOpen = vi.fn()
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} onOpenRequestLab={onOpen} />)
  const section = screen.getByRole("region", { name: "Request Lab 재현" })
  const button = within(section).getByRole("button", { name: "#55 Request Lab에서 열기" })
  expect(button).toHaveTextContent("USER A")
  expect(button).toHaveTextContent("HTTP 200")
  await userEvent.click(button)
  await waitFor(() => expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("HTTP/1.1 200 OK\n\nRECORDED-REPLAY"))
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveAttribute("readonly")
  expect(fetch.mock.calls.map(([input]) => String(input))).toEqual(["/api/request-lab?eventId=replay-55"])
  expect(onOpen).toHaveBeenCalledOnce()
})

it("keeps the explanation behind the question-mark help beside the heading", async () => {
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} />)
  const text = "원본 요청에 연결된 응답입니다. 상태 코드만으로 취약점을 판정하지 않습니다."
  expect(screen.queryByText(text)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 재현 도움말" }))
  expect(screen.getByText(text)).toBeVisible()
})

it("opens retained replay raw by its own ID even when the replay is absent from the snapshot event list", async () => {
  const fetch = transport()
  renderWithQueryClient(<GraphReplayList snapshot={{ ...snapshot, events: [{ ...replayRecord, eventId: replay.originEvidenceId }] }} items={[replay]} />)
  await userEvent.click(screen.getByRole("button", { name: "#55 Request Lab에서 열기" }))
  await waitFor(() => expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("HTTP/1.1 200 OK\n\nRECORDED-REPLAY"))
  expect(fetch.mock.calls.map(([input]) => String(input))).toEqual(["/api/request-lab?eventId=replay-55"])
})

it("shows an unavailable replay error without falling back to its original request", async () => {
  const fetch = transport(true)
  renderWithQueryClient(<GraphReplayList snapshot={{ ...snapshot, events: [] }} items={[replay]} />)
  await userEvent.click(screen.getByRole("button", { name: "#55 Request Lab에서 열기" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("삭제된 재현 기록입니다.")
  expect(fetch.mock.calls.map(([input]) => String(input))).toEqual(["/api/request-lab?eventId=replay-55"])
})

it("locks replay navigation when the snapshot is suspended", async () => {
  const fetch = transport(), onOpen = vi.fn()
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} disabled onOpenRequestLab={onOpen} />)
  const button = screen.getByRole("button", { name: "#55 Request Lab에서 열기" })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(fetch).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
})

it("closes an open replay across dataset replacement and does not reopen a reused event ID", async () => {
  transport()
  const view = renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} />)
  await userEvent.click(screen.getByRole("button", { name: "#55 Request Lab에서 열기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  view.rerender(<GraphReplayList snapshot={{ ...snapshot, datasetRevision: 4 }} items={[replay]} />)
  expect(screen.queryByRole("dialog", { name: "Request Lab" })).not.toBeInTheDocument()
  await act(async () => { view.rerender(<GraphReplayList snapshot={snapshot} items={[replay]} />) })
  expect(screen.queryByRole("dialog", { name: "Request Lab" })).not.toBeInTheDocument()
})
