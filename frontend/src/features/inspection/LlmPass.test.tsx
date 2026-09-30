import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { renderWithQueryClient } from "@/test/render"
import { LlmPass } from "./LlmPass"

afterEach(() => vi.unstubAllGlobals())

const idle = {
  run: { status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
    message: "Explorer 실행 대기", providerReadiness: "READY", accountIds: [], anonymous: false,
    attempts: 0, responses: 0, unresolved: [], activities: [] },
  accounts: [],
  scope: ["https://app.example.test/"],
}

it("starts an anonymous LLM pass against the scope target from the hub", async () => {
  const user = userEvent.setup()
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/explorer-run" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(idle), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-run" && init?.method === "POST") {
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "llm-run-1" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  const openSettings = vi.fn()
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} onOpenSettings={openSettings} />)

  // LLM 로그인이 없는 계정은 고를 수 없고 [설정]으로 관리 창을 연다.
  expect(await screen.findByRole("checkbox", { name: "USER A" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "USER A LLM 로그인 설정" }))
  expect(openSettings).toHaveBeenCalledWith("user-a")
  // 계정 등록 패널은 계정·세션 화면으로 옮겼다.
  expect(screen.queryByLabelText("표시 이름")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "메모리에 계정 등록" })).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: /탐색 시작/ }))
  await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")).toBe(true))
  const startCall = fetchStub.mock.calls.find(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")
  expect(String((startCall?.[1] as RequestInit).body)).toContain("anonymous=true")
})

it("shows actionable setup help and rechecks Codex readiness", async () => {
  const user = userEvent.setup()
  const unavailable = { ...idle, run: { ...idle.run, providerReadiness: "Codex CLI 로그인이 필요합니다." } }
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/explorer-run" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(unavailable), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-run" && init?.method === "POST") {
      return new Response(JSON.stringify({ run: idle.run }), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  expect(await screen.findByText("Codex 준비가 필요합니다")).toBeVisible()
  expect(screen.getByRole("link", { name: /공식 설치 안내/ })).toHaveAttribute(
    "href", "https://learn.chatgpt.com/docs/codex/cli",
  )
  expect(screen.getByRole("button", { name: /탐색 시작/ })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: /다시 확인/ }))
  await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) =>
    String(path) === "/api/explorer-run" && String((init as RequestInit)?.body).includes("action=recheck"),
  )).toBe(true))
})
