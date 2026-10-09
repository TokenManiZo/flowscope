import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { CandidateRequestLabDialog } from "./CandidateRequestLabDialog"

const candidate = { service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/api/v2/users/{id}/export" }
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

it("prefills the request from the candidate and sends it to the service with action=send", async () => {
  const user = userEvent.setup()
  const calls: Array<{ url: string; body: string }> = []
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") })
    return Promise.resolve(json({ success: true, eventId: "ev-candidate", status: 200, response: "HTTP/1.1 200 OK\r\n\r\n", durationMs: 12, requestBytes: 40, responseBytes: 19 }))
  }))

  render(<CandidateRequestLabDialog open onOpenChange={() => {}} candidate={candidate} accounts={[]} sessions={[]} />)

  // 메서드가 UNKNOWN이면 GET으로, 경로·호스트는 후보에서 미리 채운다.
  const editor = screen.getByLabelText("후보 요청 원문") as HTMLTextAreaElement
  expect(editor.value).toContain("GET /api/v2/users/{id}/export HTTP/1.1")
  expect(editor.value).toContain("Host: api.example.test")
  // 기본 모드는 직접 입력(원본 모드는 없다).
  expect(screen.getByRole("radio", { name: "직접 입력" })).toHaveAttribute("aria-checked", "true")
  expect(screen.queryByRole("radio", { name: "원본" })).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "보내기" }))

  await screen.findByText(/HTTP 200/)
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("/api/request-lab")
  const body = new URLSearchParams(calls[0].body)
  expect(body.get("action")).toBe("send")
  expect(body.get("service")).toBe("https://api.example.test")
  expect(body.get("credentialMode")).toBe("RAW")
  expect(body.get("eventId")).toBeNull()
  expect(body.get("request")).toContain("/api/v2/users/{id}/export")
})

it("disables sending while the request box is empty", async () => {
  const user = userEvent.setup()
  render(<CandidateRequestLabDialog open onOpenChange={() => {}} candidate={candidate} accounts={[]} sessions={[]} />)
  const editor = screen.getByLabelText("후보 요청 원문")
  await user.clear(editor)
  expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled()
})
