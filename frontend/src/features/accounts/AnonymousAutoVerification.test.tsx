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

  const toggle = await screen.findByRole("switch", { name: "비로그인으로 자동 재전송" })
  expect(toggle).toHaveAttribute("aria-checked", "false")
  await user.click(toggle)

  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
  const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")
  expect(post?.[0]).toBe("/api/authorization-replay")
  expect(String(post?.[1]?.body)).toBe("action=start-anonymous-get&armed=true")
  expect(screen.getByText("비로그인 응답").parentElement).toHaveTextContent("0건")
  expect(screen.getByText("대기").parentElement).toHaveTextContent("0건")

  await user.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))
  expect(fetch.mock.calls.some(([, init]) => String(init?.body) === "action=stop-live")).toBe(true)
})

it("shows pending requests and click help without detailed exclusion counters", async () => {
  const running = {
    ...active,
    live: { ...active.live, observed: 396, eligible: 250, queued: 250, sent: 247,
      skipped: 147, failed: 1, lastReason: "HTTP_SEND_FAILED" },
  }
  const fetch = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(json(running)))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  renderWithQueryClient(<AnonymousAutoVerification />)

  expect((await screen.findByText("비로그인 응답")).parentElement).toHaveTextContent("247건")
  expect(screen.getByText("대기").parentElement).toHaveTextContent("2건")
  expect(screen.getByText("실패").parentElement).toHaveTextContent("1건")
  expect(screen.queryByText(/계정에서 방문한 GET API를 로그인 없이 다시 확인해요/)).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "비로그인으로 자동 재전송 설명" }))
  expect(screen.getByText(/계정에서 방문한 GET API를 로그인 없이 다시 확인해요/)).toBeVisible()
  await user.keyboard("{Escape}")
  expect(screen.queryByText(/전송 예약|최근 제외|검증 상세/)).not.toBeInTheDocument()
  for (const [label, description] of [
    ["비로그인 응답", "로그인 없이 보낸 요청에서 받은 응답 수예요."],
    ["대기", "아직 보내지 않고 기다리는 요청 수예요."],
    ["실패", "요청을 보내지 못했거나 응답을 받지 못한 수예요."],
  ]) {
    await user.click(screen.getByRole("button", { name: `${label} 설명` }))
    expect(screen.getByText(description)).toBeVisible()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByText(description)).not.toBeInTheDocument())
  }
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method !== "POST")).toBe(true)
  await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1), { timeout: 2_500 })
})

it("shows the exact pending count and capacity exclusions without stopping verification", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ ...active,
    live: { ...active.live, pending: 200, limited: 3, lastReason: "PENDING_LIMIT_REACHED" },
  }))))
  renderWithQueryClient(<AnonymousAutoVerification />)
  expect(await screen.findByText("검증 대기 한도 초과 3건 · 일반 수집은 계속됩니다.")).toBeVisible()
  expect(screen.getByText("대기").parentElement).toHaveTextContent("200건")
  expect(screen.getByRole("switch", { name: "비로그인으로 자동 재전송" })).toHaveAttribute("aria-checked", "true")
})
