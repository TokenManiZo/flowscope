import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { queryKeys } from "@/lib/query/hooks"
import { LlmPass } from "./LlmPass"

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())

const idle = {
  run: { status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
    message: "Explorer 실행 대기", providerReadiness: "READY", model: "", accountIds: [], anonymous: false,
    attempts: 0, responses: 0, unresolved: [], activities: [] },
  accounts: [],
  scope: ["https://app.example.test/"],
}
const catalogResponse = () => new Response(JSON.stringify({ configuredModel: "gpt-5.6-sol", models: [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", recommended: false, defaultEffort: "low",
    efforts: [{ effort: "low", description: "Fast" }] },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true, defaultEffort: "medium",
    efforts: [{ effort: "medium", description: "Balanced" }, { effort: "high", description: "Deeper" }] },
] }), { headers: { "Content-Type": "application/json" } })

async function sendFirstMessage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "API를 살펴봐")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
}

it("offers raw Codex beside the model while keeping the original Explorer start", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "raw-1" } }), { status: 202 })
    }
    if (String(input) === "/api/explorer-run") return new Response(JSON.stringify(idle))
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(idle))
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  const heading = screen.getByRole("heading", { name: "LLM 탐색" })
  const header = heading.parentElement?.parentElement
  expect(header).not.toBeNull()
  const raw = within(header!).getByRole("button", { name: "Codex 자유 대화" })
  const model = within(header!).getByRole("combobox", { name: "탐색 모델" })
  expect(raw.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(screen.getByRole("button", { name: "탐색 시작" })).toBeDisabled()
  await user.click(raw)
  expect(posts).toHaveLength(0)
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "공개 API를 찾아줘")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toContain("action=start")
  expect(posts[0]).toContain("message=")
})

it("shows the separate raw session but blocks sending while automatic Explorer is running", async () => {
  const automatic = { ...idle,
    run: { ...idle.run, status: "RUNNING", runId: "automatic-1", anonymous: true },
    rawActive: false,
    messages: [{ role: "user", text: "Earlier raw chat", runId: "raw-1", at: "2026-10-11T00:00:00Z" }],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(String(input) === "/api/codex-chat" ? idle : automatic))))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  expect(await screen.findByRole("button", { name: /중단/ })).toBeEnabled()
  expect(screen.queryByRole("textbox", { name: "Explorer에게 추가 지시" })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(screen.getByRole("button", { name: "메시지 전송" })).toBeDisabled()
  expect(screen.queryByText("Earlier raw chat")).not.toBeInTheDocument()
})

it("separates a completed Codex conversation from automatic Explorer controls", async () => {
  const user = userEvent.setup()
  const raw = { ...idle, rawRun: true, rawActive: false,
    run: { ...idle.run, status: "COMPLETED", runId: "llm-raw-1",
      message: "Codex 답변 완료 · FlowScope HTTP 응답 0건 (대화만 완료)",
      activities: [{ sequence: 1, kind: "SYSTEM", title: "Codex 답변 완료", detail: "대화 turn을 마쳤습니다.", status: "COMPLETED" }] },
    chat: { threadId: "raw-thread", target: "https://app.example.test/", model: "", effort: "",
      rawCodex: true, rawProtocolVersion: 1 },
    messages: [
      { role: "user", text: "하이", runId: "llm-raw-1", at: "2026-10-11T00:00:00Z" },
      { role: "assistant", text: "안녕하세요", runId: "llm-raw-1", at: "2026-10-11T00:00:01Z" },
    ],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(String(input) === "/api/codex-chat" ? raw : idle))))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(await screen.findByText("Codex 답변 완료 · FlowScope HTTP 응답 0건 (대화만 완료)")).toBeVisible()
  expect(screen.getByText("Codex 대화")).toBeVisible()
  expect(screen.queryByRole("button", { name: "탐색 시작" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /^탐색할 계정/ })).not.toBeInTheDocument()
  expect(screen.getByText("하이").parentElement).toHaveClass("min-w-[7rem]")
  await user.click(screen.getByRole("button", { name: "자동 탐색 보기" }))
  expect(screen.getByRole("button", { name: "탐색 시작" })).toBeVisible()
  expect(screen.queryByText("하이")).not.toBeInTheDocument()
  expect(screen.queryByText("Codex 답변 완료 · FlowScope HTTP 응답 0건 (대화만 완료)")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(screen.getByText("하이")).toBeVisible()
})

it("keeps Codex tool and HTTP activity out of the free-chat transcript", async () => {
  const chat = { ...idle, rawRun: true, rawActive: false,
    run: { ...idle.run, status: "COMPLETED", runId: "llm-raw-chat",
      message: "Codex 답변 완료 · FlowScope HTTP 응답 1건",
      activities: [
        { sequence: 1, kind: "TOOL", title: "Codex 셸 명령", detail: "curl https://app.example.test/api/me", status: "COMPLETED" },
        { sequence: 2, kind: "HTTP", title: "GET /api/me", detail: "HTTP 200", status: "RECORDED" },
      ] },
    messages: [
      { role: "user", text: "API를 확인해줘", runId: "llm-raw-chat", at: "2026-10-11T00:00:00Z" },
      { role: "assistant", text: "확인했습니다.", runId: "llm-raw-chat", at: "2026-10-11T00:00:01Z" },
    ] }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(String(input) === "/api/codex-chat" ? chat : idle))))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await userEvent.setup().click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(await screen.findByText("확인했습니다.")).toBeVisible()
  expect(screen.getByText("API를 확인해줘")).toBeVisible()
  expect(screen.queryByText("Codex 셸 명령")).not.toBeInTheDocument()
  expect(screen.queryByText("GET /api/me")).not.toBeInTheDocument()
  expect(screen.queryByText("요청·셸 실행 기록")).not.toBeInTheDocument()
})

it("warns before resuming an older raw thread that still has Explorer tool context", async () => {
  const legacy = { ...idle, chat: { threadId: "old-thread", target: "https://app.example.test/",
    model: "", effort: "", rawCodex: true, rawProtocolVersion: 0 } }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(String(input) === "/api/codex-chat" ? legacy : idle))))
  const user = userEvent.setup()
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await user.click(await screen.findByRole("button", { name: "Codex 자유 대화" }))
  expect(screen.getByText(/이전 Codex thread에는 FlowScope 도구 문맥이 남아 있습니다/)).toBeVisible()
  expect(screen.getByRole("button", { name: "새 채팅" })).toBeVisible()
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "대상을 확인해줘")
  expect(screen.getByRole("button", { name: "메시지 전송" })).toBeDisabled()
})

it("opens chat without starting a run, then sends the operator's first message", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "chat-1" } }), { status: 202 })
    }
    if (String(input) === "/api/explorer-run") return new Response(JSON.stringify(idle))
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(idle))
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await user.click(await screen.findByRole("button", { name: "Codex 자유 대화" }))
  expect(posts).toHaveLength(0)
  expect(screen.queryByRole("button", { name: /^탐색할 계정/ })).not.toBeInTheDocument()
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "공개 API를 조사해 줘")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toContain("action=start")
  expect(posts[0]).toContain("message=%EA%B3%B5%EA%B0%9C+API%EB%A5%BC+")
})

it("shows saved conversation and sends a follow-up as another turn", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  const conversation = { ...idle, rawRun: true,
    run: { ...idle.run, status: "COMPLETED", runId: "llm-raw-1", anonymous: true },
    chat: { threadId: "saved-raw", target: "https://app.example.test/", model: "", effort: "",
      rawCodex: true, rawProtocolVersion: 1 },
    messages: [
      { role: "user", text: "API를 찾아줘", runId: "chat-1", at: "2026-10-10T00:00:00Z" },
      { role: "assistant", text: "GET /api/me를 확인했습니다.", runId: "chat-1", at: "2026-10-10T00:01:00Z" },
    ],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...conversation.run, status: "RUNNING", runId: "chat-2" } }), { status: 202 })
    }
    if (String(input) === "/api/explorer-run") return new Response(JSON.stringify(idle))
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(conversation))
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(await screen.findByText("API를 찾아줘")).toBeVisible()
  expect(screen.getByText("GET /api/me를 확인했습니다.")).toBeVisible()
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "이어서 다른 화면도 확인해줘")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toContain("action=start")
  expect(posts[0]).toContain("message=")
})

it("restores the saved model and effort after reopening a conversation", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  const reopened = { ...idle,
    chat: { threadId: "saved-thread", target: "https://app.example.test/", model: "gpt-6.1-sol", effort: "high",
      rawCodex: true, rawProtocolVersion: 1 },
    messages: [{ role: "user", text: "이전 질문", runId: "old-run", at: "2026-10-10T00:00:00Z" }],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "next-run" } }), { status: 202 })
    }
    if (String(input) === "/api/explorer-run") return new Response(JSON.stringify(idle))
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(reopened))
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(await screen.findByText("이전 질문")).toBeVisible()
  await waitFor(() => expect(screen.getByRole("combobox", { name: "대화 모델" })).toHaveValue("gpt-6.1-sol"))
  expect(screen.getByRole("combobox", { name: "추론 강도" })).toHaveValue("high")
  await user.type(screen.getByRole("textbox", { name: "LLM에게 메시지" }), "이어서 조사해")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toContain("model=gpt-6.1-sol")
  expect(posts[0]).toContain("effort=high")
})

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
    if (path === "/api/codex-chat" && init?.method === "POST") {
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "raw-run-1" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    if (path === "/api/codex-chat") return new Response(JSON.stringify(idle))
    throw new Error(`unexpected API ${path}`)
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  // 브라우저 로그인 세션이 없는 계정은 고를 수 없다.
  await user.click(await screen.findByRole("button", { name: /^탐색할 계정/ }))
  expect(await screen.findByRole("checkbox", { name: "USER A" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "USER A 브라우저 로그인" })).toBeEnabled()
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  expect(screen.getByRole("button", { name: "Codex 자유 대화" })).toBeEnabled()
  await user.click(screen.getByRole("checkbox", { name: "비로그인" }))
  // 계정 등록 패널은 계정·세션 화면으로 옮겼다.
  expect(screen.queryByLabelText("표시 이름")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "메모리에 계정 등록" })).not.toBeInTheDocument()

  const model = await screen.findByRole("combobox", { name: /탐색 모델/ })
  await waitFor(() => expect(model).toHaveValue("gpt-5.6-sol"))
  await user.selectOptions(model, "gpt-6.1-sol")
  await user.selectOptions(screen.getByRole("combobox", { name: "추론 강도" }), "high")
  await sendFirstMessage(user)
  await waitFor(() => expect(fetchStub.mock.calls.some(([path, init]) => String(path) === "/api/codex-chat" && (init as RequestInit)?.method === "POST")).toBe(true))
  const startCall = fetchStub.mock.calls.find(([path, init]) => String(path) === "/api/codex-chat" && (init as RequestInit)?.method === "POST")
  expect(String((startCall?.[1] as RequestInit).body)).toContain("model=gpt-5.6-sol")
  expect(String((startCall?.[1] as RequestInit).body)).not.toContain("accounts=")
})

it("restores the completed run model for the next editable run after returning to this page", async () => {
  const user = userEvent.setup()
  let status = "RUNNING"
  const posts: string[] = []
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", model: "gpt-6.1-sol" } }),
        { status: 202, headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, run: { ...idle.run, status, runId: "llm-old-run",
        model: "gpt-6.1-sol", anonymous: true } }), { headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(idle))
    throw new Error(`unexpected API ${String(input)}`)
  })
  vi.stubGlobal("fetch", fetchStub)

  const first = renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  expect((await screen.findAllByText("gpt-6.1-sol"))[0]).toBeVisible()
  first.unmount()
  status = "COMPLETED"
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await screen.findByText("완료")
  const model = screen.getByRole("combobox", { name: /탐색 모델/ })
  await waitFor(() => expect(model).toHaveValue("gpt-6.1-sol"))
  await user.selectOptions(model, "gpt-5.6-sol")
  expect(model).toHaveValue("gpt-5.6-sol")
  await user.selectOptions(model, "gpt-6.1-sol")
  await sendFirstMessage(user)
  await waitFor(() => expect(posts[0]).toContain("model=gpt-5.6-sol"))
})

it("reuses only visible ready account choices when restarting a completed run", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  const terminal = { ...idle,
    run: { ...idle.run, status: "COMPLETED", runId: "previous-user-run", model: "gpt-6.1-sol",
      anonymous: false, accountIds: ["user-a"] },
    accounts: [{ id: "user-a", label: "USER A", status: "READY", browserOpen: true }],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/explorer-run" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: terminal.run }), { status: 202,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING", runId: "raw-run" } }), { status: 202 })
    }
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(idle))
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify(terminal), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  await waitFor(() => expect(screen.getByRole("combobox", { name: /탐색 모델/ })).toHaveValue("gpt-6.1-sol"))
  await user.click(screen.getByRole("button", { name: /^탐색할 계정/ }))
  expect(screen.getByRole("checkbox", { name: "USER A" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  await user.click(screen.getByRole("button", { name: "탐색 시작" }))
  await waitFor(() => expect(posts[0]).toContain("accounts=user-a"))
  expect(posts[0]).toContain("anonymous=false")
  expect(posts[0]).toContain("model=gpt-6.1-sol")
  await sendFirstMessage(user)
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).not.toContain("accounts=")
  expect(posts[1]).toContain("action=start")
})

it("does not silently resend an expired account from a completed run", async () => {
  const terminal = { ...idle,
    run: { ...idle.run, status: "COMPLETED", runId: "previous-user-run", model: "gpt-6.1-sol",
      anonymous: false, accountIds: ["user-a"] },
    accounts: [{ id: "user-a", label: "USER A", status: "EXPIRED", browserOpen: false }],
  }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify(terminal), { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" accounts={[{ id: "user-a", label: "USER A" }]} />)

  await waitFor(() => expect(screen.getByRole("combobox", { name: /탐색 모델/ })).toHaveValue("gpt-6.1-sol"))
  await userEvent.setup().click(screen.getByRole("button", { name: /^탐색할 계정/ }))
  expect(screen.getByRole("checkbox", { name: "USER A" })).toBeDisabled()
  expect(screen.getByRole("checkbox", { name: "USER A" })).not.toBeChecked()
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  await userEvent.setup().click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(screen.getByRole("button", { name: "메시지 전송" })).toBeDisabled()
})

it("names an unavailable previous model and requires a new visible choice", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") {
      return new Response(JSON.stringify({ configuredModel: "gpt-5.6-sol", models: [
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", recommended: true },
      ] }), { headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: idle.run }), { status: 202,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, run: { ...idle.run, status: "COMPLETED",
        runId: "old-run", model: "gpt-6.1-sol", anonymous: true } }),
      { headers: { "Content-Type": "application/json" } })
    }
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  expect(await screen.findByText(/선택 모델이 현재 목록에 없습니다/)).toBeVisible()
  expect(screen.getByRole("option", { name: /gpt-6.1-sol.*사용 불가/ })).toBeDisabled()
  expect(screen.getByRole("button", { name: "탐색 시작" })).toBeDisabled()
  await user.selectOptions(screen.getByRole("combobox", { name: /탐색 모델/ }), "gpt-5.6-sol")
  await user.click(screen.getByRole("button", { name: "탐색 시작" }))
  await waitFor(() => expect(posts[0]).toContain("model=gpt-5.6-sol"))
})

it("uses the visible Codex default after a completed run when the model catalog is unavailable", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") {
      return new Response(JSON.stringify({ error: "catalog unavailable" }), { status: 503,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/codex-chat" && init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: { ...idle.run, status: "RUNNING" } }), { status: 202,
        headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/explorer-run") {
      return new Response(JSON.stringify({ ...idle, run: { ...idle.run, status: "COMPLETED",
        runId: "previous-run", model: "gpt-6.1-sol", anonymous: true } }),
        { headers: { "Content-Type": "application/json" } })
    }
    if (String(input) === "/api/codex-chat") return new Response(JSON.stringify(idle))
    throw new Error(`unexpected API ${String(input)}`)
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  expect(await screen.findByText(/모델 목록을 확인하지 못했습니다/)).toBeVisible()
  expect(screen.getByRole("combobox", { name: /탐색 모델/ })).toHaveValue("")
  await sendFirstMessage(user)
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
  expect(screen.getByRole("button", { name: "Codex 자유 대화" })).toBeDisabled()
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

  await user.click(await screen.findByRole("button", { name: /^탐색할 계정/ }))
  await user.click(await screen.findByRole("button", { name: "USER A 브라우저 로그인" }))
  expect(posts[0]).toContain("action=browser-open")
  expect(posts[0]).toContain("id=user-a")
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  expect(screen.getByRole("button", { name: "탐색 시작" })).toBeDisabled()
  await user.click(await screen.findByRole("button", { name: "USER A 로그인 완료" }))
  expect(posts[1]).toContain("action=browser-complete")

  expect(await screen.findByText("세션 있음")).toBeVisible()
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "USER A" })).toBeEnabled())
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  expect(screen.getByRole("button", { name: "탐색 시작" })).toBeDisabled()
  await user.click(screen.getByRole("checkbox", { name: "USER A" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "탐색 시작" })).toBeEnabled())
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

  await userEvent.setup().click(await screen.findByRole("button", { name: /^실행 세부정보/ }))
  await userEvent.setup().click(screen.getByRole("button", { name: /^탐색할 계정/ }))
  const card = within(await screen.findByRole("group", { name: "브라우저 탐색 진행" }))
  expect(screen.getByText("브라우저 탐색 중")).toBeInTheDocument()
  // 경과는 사실, 15분은 상한일 뿐이다.
  expect(card.getByText("04:12")).toBeInTheDocument()
  expect(card.getByText("300회 · 15분")).toBeInTheDocument()
  expect(card.getByTitle(/먼저 도달하면 종료/)).toHaveAttribute("title", expect.stringContaining("창을 닫아도 종료"))
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  expect(card.getByText("84회")).toBeVisible()
  expect(card.getByText("19개")).toBeInTheDocument()
  // 둘러보기만 한 실행이 "아무것도 안 함"으로 읽히면 안 된다.
  expect(card.getByText("31회")).toBeInTheDocument()
  expect(screen.queryByText("브라우저 화면 상태를 읽은 횟수입니다.")).not.toBeInTheDocument()
  await userEvent.hover(card.getByRole("button", { name: "화면 상태 조회 횟수 도움말" }))
  expect(await screen.findByRole("tooltip")).toHaveTextContent("브라우저 화면 상태를 읽은 횟수입니다.")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  // 다른 화면에 갔다 와도 실행이 들고 있는 선택이 그대로 보여야 한다.
  expect(screen.getByRole("checkbox", { name: "USER A" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "비로그인" })).not.toBeChecked()
  expect(screen.getByText("자동 탐색 1개 선택됨")).toBeInTheDocument()
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

  expect(await screen.findByRole("button", { name: "Codex 자유 대화" })).toBeInTheDocument()
  expect(screen.queryByRole("group", { name: "브라우저 탐색 진행" })).not.toBeInTheDocument()
  expect(screen.queryByText("브라우저 창을 닫으면 즉시 끝납니다")).not.toBeInTheDocument()
})

it("freezes completed values across polling and navigation, resetting on dataset change", async () => {
  const data = { ...idle, run: { ...idle.run, status: "COMPLETED", runId: "finished", elapsedMillis: 10000 }, browser: { actions: 8, maxActions: 300, snapshots: 4, endpoints: 2, elapsedMillis: 10000, minutes: 15 } }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(data))))
  const client = createTestQueryClient()
  const view = renderWithQueryClient(<LlmPass target="https://app.example.test/" datasetRevision={1} />, client)
  await userEvent.setup().click(await screen.findByRole("button", { name: /^실행 세부정보/ }))
  expect(screen.queryByText("브라우저 탐색 중")).not.toBeInTheDocument()
  expect(within(screen.getByRole("group", { name: "브라우저 탐색 진행" })).getByText("00:10")).toBeVisible()
  const next = { ...data, browser: { ...data.browser, elapsedMillis: 30000 }, run: { ...data.run, elapsedMillis: 30000 } }
  client.setQueryData(queryKeys.explorerRun, next)
  await waitFor(() => expect(screen.queryByText("00:30")).not.toBeInTheDocument())
  view.rerender(<div />)
  view.rerender(<LlmPass target="https://app.example.test/" datasetRevision={1} />)
  await userEvent.setup().click(await screen.findByRole("button", { name: /^실행 세부정보/ }))
  expect(within(screen.getByRole("group", { name: "브라우저 탐색 진행" })).getByText("00:10")).toBeVisible()
  client.setQueryData(queryKeys.explorerRun, next)
  view.rerender(<LlmPass target="https://app.example.test/" datasetRevision={2} />)
  await waitFor(() => expect(within(screen.getByRole("group", { name: "브라우저 탐색 진행" })).getByText("00:30")).toBeVisible())
})

it("keeps the completed run details when choosing a different model for the next run", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  const terminal = { ...idle, run: { ...idle.run, status: "COMPLETED", runId: "finished-model-run",
    model: "gpt-6.1-sol", anonymous: true, elapsedMillis: 10000 },
    browser: { actions: 8, maxActions: 300, snapshots: 4, endpoints: 2, elapsedMillis: 10000, minutes: 15 } }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/explorer-models") return catalogResponse()
    if (init?.method === "POST") {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ run: terminal.run }), { status: 202,
        headers: { "Content-Type": "application/json" } })
    }
    return new Response(JSON.stringify(String(input) === "/api/codex-chat" ? idle : terminal),
      { headers: { "Content-Type": "application/json" } })
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)

  await waitFor(() => expect(screen.getByRole("combobox", { name: /탐색 모델/ })).toHaveValue("gpt-6.1-sol"))
  await user.click(screen.getByRole("button", { name: /^실행 세부정보/ }))
  await user.selectOptions(screen.getByRole("combobox", { name: /탐색 모델/ }), "gpt-5.6-sol")
  expect(screen.getByLabelText("지난 실행 요청 모델")).toHaveTextContent("gpt-6.1-sol")
  expect(within(screen.getByRole("group", { name: "브라우저 탐색 진행" })).getByText("00:10")).toBeVisible()
  await sendFirstMessage(user)
  await waitFor(() => expect(posts[0]).toContain("model=gpt-5.6-sol"))
})

it("keeps chat messages and reports transmission success and retryable failure without tool details", async () => {
  const user = userEvent.setup()
  let reject = true
  const running = { ...idle, rawActive: true, rawRun: true, run: { ...idle.run, status: "RUNNING", runId: "steer-run", message: "프로젝트 상세 탐색 중", activities: [{ sequence: 1, kind: "TOOL", title: "프로젝트 확인", detail: "현재 프로젝트 상세에서 항목을 읽습니다.", status: "RUNNING" }] } }
  const posts: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (String(path) === "/api/explorer-models") return catalogResponse()
    if (init?.method === "POST") { posts.push(String(init.body)); return new Response(JSON.stringify(reject ? { message: "전송 실패" } : { run: running.run }), { status: reject ? 400 : 200 }) }
    return new Response(JSON.stringify(String(path) === "/api/codex-chat" ? running : idle))
  }))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  expect(await screen.findByText("프로젝트 상세 탐색 중")).toBeVisible()
  expect(screen.queryByText("현재 프로젝트 상세에서 항목을 읽습니다.")).not.toBeInTheDocument()
  await user.type(screen.getByLabelText("Codex에게 추가 지시"), "다음 화면 확인")
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  expect(await screen.findByText(/전송 실패 · 내용을/)).toBeVisible()
  expect(screen.getByLabelText("Codex에게 추가 지시")).toHaveValue("다음 화면 확인")
  reject = false
  await user.click(screen.getByRole("button", { name: "메시지 전송" }))
  expect(await screen.findByText("서버 전송 완료")).toBeVisible()
  expect(screen.getByLabelText("Codex에게 추가 지시")).toHaveValue("")
  expect(posts).toHaveLength(2)
  expect(posts[0]).toContain("action=steer")
  await user.click(screen.getByRole("button", { name: "진행 기록 접기" }))
  expect(screen.queryByText("현재 프로젝트 상세에서 항목을 읽습니다.")).not.toBeInTheDocument()
  expect(screen.getByText("프로젝트 상세 탐색 중")).toBeVisible()
})

it.each([true, false])("explains API and input counts independently, with browser metrics=%s", async (hasBrowser) => {
  const user = userEvent.setup()
  const terminal = { ...idle, run: { ...idle.run, status: "COMPLETED", runId: "help-run",
    endpointDeclarations: 12, parameterDeclarations: 24 },
    ...(hasBrowser ? { browser: { actions: 8, maxActions: 300, snapshots: 4, endpoints: 2, elapsedMillis: 10000, minutes: 15 } } : {}) }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(terminal))))
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await user.click(await screen.findByRole("button", { name: /^실행 세부정보/ }))
  expect(screen.getByText("API 12")).toBeVisible()
  expect(screen.getByText("입력 필드 24")).toBeVisible()
  await user.hover(screen.getByRole("button", { name: "근거로 등록한 API 도움말" }))
  expect(await screen.findByRole("tooltip")).toHaveTextContent("실제 요청으로 관측한 API와 별도로")
  await user.keyboard("{Escape}")
  act(() => screen.getByRole("button", { name: "근거로 등록한 입력 필드 도움말" }).focus())
  await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("검색어, 페이지 번호, ID"))
})

it("enlarges LLM messages without losing the instruction draft or changing the active run", async () => {
  const user = userEvent.setup()
  const running = { ...idle, rawActive: true, rawRun: true, run: { ...idle.run, status: "RUNNING", runId: "reading-run", model: "gpt-6.1-sol",
    message: "프로젝트 화면 탐색 중", activities: [{ sequence: 1, kind: "TOOL", title: "프로젝트 확인", detail: "멤버 목록을 확인합니다.", status: "RUNNING" }] } }
  const fetchStub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input) === "/api/explorer-models"
    ? catalogResponse() : new Response(JSON.stringify(String(input) === "/api/codex-chat" ? running : idle)))
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await user.click(screen.getByRole("button", { name: "Codex 자유 대화" }))
  await screen.findByRole("button", { name: /중단/ })
  await user.type(await screen.findByRole("textbox", { name: "Codex에게 추가 지시" }), "프로필 확인")
  const list = screen.getByLabelText("Codex 대화 내용")
  list.scrollTop = 42
  await user.click(screen.getByRole("button", { name: "크게 보기" }))
  expect(screen.getByText("프로젝트 화면 탐색 중")).toBeVisible()
  expect(screen.queryByText("멤버 목록을 확인합니다.")).not.toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Codex에게 추가 지시" })).toHaveValue("프로필 확인")
  expect(screen.getByLabelText("Codex 대화 내용")).toBe(list)
  expect(list.scrollTop).toBe(42)
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  await user.keyboard("{Escape}")
  expect(screen.getByRole("button", { name: "크게 보기" })).toHaveFocus()
  expect(screen.getByRole("textbox", { name: "Codex에게 추가 지시" })).toHaveValue("프로필 확인")
  expect(screen.getByRole("button", { name: /중단/ })).toBeEnabled()
  expect(fetchStub.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})

it("labels collected HTTP traffic with plain L source text", async () => {
  const running = { ...idle, run: { ...idle.run, status: "RUNNING", runId: "source-run",
    activities: [{ sequence: 1, kind: "HTTP", title: "GET /api/me", detail: "HTTP 200", status: "RECORDED" }] } }
  const fetchStub = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(running)))
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<LlmPass target="https://app.example.test/" />)
  await screen.findByText("GET /api/me")
  const source = within(screen.getByLabelText("LLM 진행 메시지 및 수집 트래픽")).getByText("L")
  expect(source).toHaveAttribute("title", "LLM")
  expect(source).not.toHaveAttribute("data-slot", "badge")
  expect(fetchStub.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})
