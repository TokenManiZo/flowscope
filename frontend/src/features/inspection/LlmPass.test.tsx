import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { renderWithQueryClient } from "@/test/render"
import { LlmPass } from "./LlmPass"

afterEach(() => vi.unstubAllGlobals())

const idle = {
  run: { status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
    message: "Explorer 실행 대기", providerReadiness: "READY", model: "", accountIds: [], anonymous: false,
    attempts: 0, responses: 0, unresolved: [], activities: [] },
  accounts: [],
  scope: ["https://app.example.test/"],
}
const catalogResponse = () => new Response(JSON.stringify({ configuredModel: "gpt-5.6-sol", models: [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", recommended: false },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true },
] }), { headers: { "Content-Type": "application/json" } })

it("offers account models and sends the chosen one with the anonymous run", async () => {
  const user = userEvent.setup()
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/explorer-run" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(idle), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-models") return catalogResponse()
    if (path === "/api/explorer-run" && init?.method === "POST") {
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "llm-run-1" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  // 브라우저 로그인 세션이 없는 계정은 고를 수 없다.
  expect(await screen.findByRole("checkbox", { name: "USER A" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "USER A 브라우저 로그인" })).toBeEnabled()
  // 계정 등록 패널은 계정·세션 화면으로 옮겼다.
  expect(screen.queryByLabelText("표시 이름")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "메모리에 계정 등록" })).not.toBeInTheDocument()

  const model = await screen.findByRole("combobox", { name: "Codex 모델" })
  await waitFor(() => expect(model).toHaveValue("gpt-5.6-sol"))
  await user.selectOptions(model, "gpt-6.1-sol")
  await user.click(screen.getByRole("button", { name: /탐색 시작/ }))
  await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")).toBe(true))
  const startCall = fetchStub.mock.calls.find(([path, init]) => String(path) === "/api/explorer-run" && (init as RequestInit)?.method === "POST")
  expect(String((startCall?.[1] as RequestInit).body)).toContain("anonymous=true")
  expect(String((startCall?.[1] as RequestInit).body)).toContain("model=gpt-6.1-sol")
})

it("restores the completed run model for the next editable run after returning to this page", async () => {
  const user = userEvent.setup()
  let status = "RUNNING"
  const posts: string[] = []
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/explorer-run" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", model: "gpt-6.1-sol" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, run: { ...idle.run, status, runId: "llm-old-run",
        model: "gpt-6.1-sol", anonymous: true } }), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  })
  vi.stubGlobal("fetch", fetchStub)

  const first = renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  expect((await screen.findAllByText("gpt-6.1-sol"))[0]).toBeVisible()
  first.unmount()
  status = "COMPLETED"
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await screen.findByText("완료")
  const model = screen.getByRole("combobox", { name: "Codex 모델" })
  await waitFor(() => expect(model).toHaveValue("gpt-6.1-sol"))
  await user.selectOptions(model, "gpt-5.6-sol")
  expect(model).toHaveValue("gpt-5.6-sol")
  await user.selectOptions(model, "gpt-6.1-sol")
  await user.click(screen.getByRole("button", { name: /탐색 시작/ }))
  await waitFor(() => expect(posts[0]).toContain("model=gpt-6.1-sol"))
})

it("uses the visible Codex default after a completed run when the model catalog is unavailable", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") {
      return new Response(JSON.stringify({ error: "catalog unavailable" }), { status: 503,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING" } }), { status: 202,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, run: { ...idle.run, status: "COMPLETED",
        runId: "previous-run", model: "gpt-6.1-sol", anonymous: true } }),
        { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  expect(await screen.findByText(/모델 목록을 확인하지 못했습니다/)).toBeVisible()
  expect(screen.getByRole("combobox", { name: "Codex 모델" })).toHaveValue("")
  await user.click(screen.getByRole("button", { name: /탐색 시작/ }))
  await waitFor(() => expect(posts[0]).toContain("model="))
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

it("opens a login window for a registered account and adopts its session on [로그인 완료]", async () => {
  const user = userEvent.setup()
  let session: Record<string, unknown> | null = null
  const posts: string[] = []
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/explorer-run" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({ ...idle, accounts: session ? [session] : [] }), { headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/explorer-models") return catalogResponse()
    if (path === "/api/explorer-accounts" && init?.method === "POST") {
      const body = String(init.body)
      posts.push(body)
      session = { id: "user-a", label: "USER A", role: "USER", loginUrl: "https://app.example.test/", message: "",
        updatedAt: "", cookieCount: body.includes("browser-complete") ? 2 : 0, headerNames: [], browserOpen: true,
        status: body.includes("browser-complete") ? "READY" : "NEEDS_INPUT" }
      return new Response(JSON.stringify({ success: true, message: "ok", account: session }), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  await user.click(await screen.findByRole("button", { name: "USER A 브라우저 로그인" }))
  expect(posts[0]).toContain("action=browser-open")
  expect(posts[0]).toContain("id=user-a")
  await user.click(await screen.findByRole("button", { name: "USER A 로그인 완료" }))
  expect(posts[1]).toContain("action=browser-complete")

  expect(await screen.findByText("세션 있음")).toBeVisible()
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "USER A" })).toBeEnabled())
})

it("shows the browser budget as a ceiling and keeps the stop switch visible while a window is driven", async () => {
  const driving = {
    ...idle,
    run: { ...idle.run, status: "RUNNING", runId: "llm-run-2", model: "gpt-6.1-sol", accountIds: ["user-a"], elapsedMillis: 252_000 },
    browser: { actions: 84, maxActions: 300, snapshots: 31, endpoints: 19, elapsedMillis: 252_000, minutes: 15 },
    accounts: [{ id: "user-a", label: "USER A", role: "LV1", loginUrl: "https://app.example.test/",
      status: "READY", message: "브라우저 로그인 세션 (사용자 확인)", updatedAt: "2026-10-01T00:00:00Z",
      cookieCount: 4, headerNames: [], browserOpen: true }],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify(driving), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  const card = within(await screen.findByRole("group", { name: "브라우저 탐색 진행" }))
  expect(card.getByText("브라우저 탐색 중")).toBeInTheDocument()
  // 경과는 사실, 15분은 상한일 뿐이다.
  expect(card.getByText("04:12")).toBeInTheDocument()
  expect(card.getByText("15분")).toBeInTheDocument()
  expect(card.getByText(/먼저 도달하면 끝납니다/)).toBeInTheDocument()
  expect(card.getByRole("progressbar", { name: "브라우저 동작 진행률" })).toHaveAttribute("aria-valuenow", "84")
  expect(card.getByText("19")).toBeInTheDocument()
  // 둘러보기만 한 실행이 "아무것도 안 함"으로 읽히면 안 된다.
  expect(card.getByText("31")).toBeInTheDocument()
  // 빨간 경고 박스 대신 카드 안 한 줄로 남긴다.
  expect(card.getByText(/창을 닫으면 그 자리에서 끝납니다/)).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  // 다른 화면에 갔다 와도 실행이 들고 있는 선택이 그대로 보여야 한다.
  expect(screen.getByRole("checkbox", { name: "USER A" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  expect(screen.getByText("1개 선택됨")).toBeInTheDocument()
  expect(screen.getAllByText("gpt-6.1-sol").length).toBeGreaterThan(0)
})

it("hides the browser card when no window is being driven", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, browser: null }), { headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-models") return catalogResponse()
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[]} />)

  expect(await screen.findByRole("button", { name: /탐색 시작/ })).toBeInTheDocument()
  expect(screen.queryByRole("group", { name: "브라우저 탐색 진행" })).not.toBeInTheDocument()
  expect(screen.queryByText("브라우저 창을 닫으면 즉시 끝납니다")).not.toBeInTheDocument()
})
