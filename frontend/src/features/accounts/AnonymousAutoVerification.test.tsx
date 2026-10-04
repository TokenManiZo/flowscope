import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { AnonymousAutoVerification } from "./AnonymousAutoVerification"
import { renderWithQueryClient } from "@/test/render"

const stopped = {
  success: true,
  message: "status",
  live: {
    runId: "", state: "STOPPED", armed: false, targetAccountIds: [], includeAnonymous: false,
    automaticAnonymousGet: false, basisSources: ["HUMAN"], observed: 0, eligible: 0,
    queued: 0, sent: 0, drafted: 0, skipped: 0, failed: 0, lastReason: "NOT_STARTED",
  },
}

const active = {
  ...stopped,
  live: { ...stopped.live, runId: "live-1", state: "ACTIVE", armed: true,
    includeAnonymous: true, automaticAnonymousGet: true },
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

afterEach(() => vi.unstubAllGlobals())

it("starts explicitly armed anonymous GET verification from the account session switch", async () => {
  const fetch = vi.fn((_path: string, init?: RequestInit) => {
    const body = String(init?.body ?? "")
    return Promise.resolve(json(body.includes("action=stop-live") ? stopped : init?.method === "POST" ? active : stopped))
  })
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  renderWithQueryClient(<AnonymousAutoVerification />)

  const toggle = await screen.findByRole("switch", { name: "비로그인 자동 검증" })
  expect(toggle).toHaveAttribute("aria-checked", "false")
  await user.click(toggle)

  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
  const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")
  expect(post?.[0]).toBe("/api/authorization-replay")
  expect(String(post?.[1]?.body)).toBe("action=start-anonymous-get&armed=true")
  expect(screen.getByText(/전송 예약 0건.*비로그인 응답 0건.*제외 0건.*실패 0건/)).toBeVisible()

  await user.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))
  expect(fetch.mock.calls.some(([, init]) => String(init?.body) === "action=stop-live")).toBe(true)
})

it("keeps polling and separates exclusions from execution failures", async () => {
  const running = {
    ...active,
    live: { ...active.live, queued: 250, sent: 249,
      skipped: 3, failed: 1, lastReason: "HTTP_SEND_FAILED" },
  }
  const fetch = vi.fn(() => Promise.resolve(json(running)))
  vi.stubGlobal("fetch", fetch)
  renderWithQueryClient(<AnonymousAutoVerification />)

  expect(await screen.findByText(/전송 예약 250건.*비로그인 응답 249건.*제외 2건.*실패 1건/)).toBeVisible()
  expect(screen.getByText("최근 제외/실패 사유: 대상 연결 또는 HTTP 전송 실패")).toBeVisible()
  await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1), { timeout: 2_500 })
})
