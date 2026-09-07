import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { renderWithQueryClient } from "@/test/render"
import { ExplorerPage } from "./ExplorerPage"

afterEach(() => vi.unstubAllGlobals())

const idle = {
  run: { status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
    message: "Explorer 실행 대기", providerReadiness: "READY", accountIds: [], anonymous: false,
    attempts: 0, responses: 0, unresolved: [], activities: [] },
  accounts: [],
  scope: ["https://app.example.test/"],
}

it("registers memory-only credentials and starts an anonymous explorer run", async () => {
  const user = userEvent.setup()
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/explorer-run" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(idle), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-accounts") {
      return new Response(JSON.stringify({ success: true, message: "saved", account: {
        id: "llm-a", label: "A", role: "USER", loginUrl: "https://app.example.test/login",
        loginMode: "JSON", validationUrl: "", status: "UNVERIFIED", message: "로그인 확인 전",
        updatedAt: "2026-01-01T00:00:00Z", hasPassword: true, cookieCount: 0, hasTokenHeader: false,
      } }), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-run" && init?.method === "POST") {
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "llm-run-1" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<ExplorerPage />)

  expect(await screen.findByDisplayValue("https://app.example.test/")).toBeVisible()
  await user.type(screen.getByLabelText("표시 이름"), "A")
  await user.type(screen.getByLabelText("로그인 URL"), "https://app.example.test/login")
  await user.type(screen.getByLabelText("로그인 ID"), "alice@example.test")
  await user.type(screen.getByLabelText("비밀번호"), "secret-password")
  await user.click(screen.getByRole("button", { name: "메모리에 계정 등록" }))
  await waitFor(() => expect(fetchStub.mock.calls.some(([path]) => String(path) === "/api/explorer-accounts")).toBe(true))
  expect(screen.queryByText("secret-password")).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Explorer 시작" }))
  await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")).toBe(true))
  const startCall = fetchStub.mock.calls.find(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")
  expect(String((startCall?.[1] as RequestInit).body)).toContain("anonymous=true")
})
