import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AiToolsPage } from "./AiToolsPage"
import { renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import type { LlmFeedEntry, McpSettings } from "@/lib/api/types"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"

const initial: McpSettings = {
  datasetRevision: 1, url: "http://127.0.0.1:17777/mcp", scope: ["https://demo.test/"], clients: [],
  methods: { GET: true, POST: false, PUT: false, PATCH: false, DELETE: false },
  accounts: [
    { accountId: "anon", label: "비로그인", role: "ANONYMOUS", usable: true, sessionStatus: "ANONYMOUS" },
    { accountId: "a", label: "USER A", role: "USER", usable: true, sessionStatus: "ACTIVE", loginUrl: "#accounts/a?from=ai-tools", proofConfigured: true },
    { accountId: "b", label: "USER B", role: "USER", usable: false, sessionStatus: "NONE", reason: "로그인 필요", loginUrl: "#accounts/b?from=ai-tools", proofConfigured: true },
  ],
}
let settings: McpSettings
let posts: URLSearchParams[]
let calls: string[]
let failPermission = false
let diagnosisStatus: "IDLE" | "RUNNING" | "SUCCEEDED"
let chatMessages: { seq: number; timestamp: number; role: "USER"; text: string; status: "DELIVERED" }[]
let feedEntries: LlmFeedEntry[]
beforeEach(() => {
  settings = structuredClone(initial); posts = []; calls = []; failPermission = false; diagnosisStatus = "IDLE"; chatMessages = []; feedEntries = []
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); calls.push(path)
    const form = init?.method === "POST" ? new URLSearchParams(String(init.body)) : null
    if (form) posts.push(form)
    let data: unknown = {}
    let status = 200
    if (path === "/api/mcp") {
      if (form?.get("action") === "permission") {
        if (failPermission) return new Response(JSON.stringify({ success: false, message: "프로젝트가 변경됐습니다." }), { status: 400, headers: { "Content-Type": "application/json" } })
        settings.methods[form.get("method") as keyof typeof settings.methods] = form.get("enabled") === "true"
      }
      if (form?.get("action") === "verify-session") settings = { ...settings, accounts: settings.accounts.map(account => account.accountId === form.get("account") ? { ...account, usable: true } : account) }
      data = form?.get("action") === "connection" ? { ...settings, token: "full-local-connection-key", config: { mcpServers: { flowscope: { type: "http", url: settings.url, headers: { Authorization: "Bearer full-local-connection-key" } } } } } : settings
    } else if (path === "/api/snapshot") data = { ...snapshotFixture, events: [{ eventId: "e1", source: "HUMAN" }] }
    else if (path === "/api/llm-findings") data = { findings: [] }
    else if (path === "/api/llm-reports") data = { reports: [{ id: "report-00000000-0000-0000-0000-000000000001", title: "차량 권한 보고서", createdAt: Date.now(), datasetRevision: 1, findingCount: 1, evidenceCount: 2 }] }
    else if (path.startsWith("/api/llm-feed")) data = { entries: feedEntries }
    else if (path === "/api/llm-verify") { if (form?.get("action") === "start") { diagnosisStatus = "RUNNING"; status = 202; const now = Date.now(); feedEntries = [{ seq: 1, timestamp: now - 2, type: "info", summary: "초기 진단 시작", risk: false }, { seq: 2, timestamp: now - 1, type: "read", summary: "초기 수집 근거 조회", risk: false }] } if (form?.get("action") === "cancel") diagnosisStatus = "IDLE"; data = { status: diagnosisStatus, message: "진단 대기", datasetRevision: 1, chatReady: diagnosisStatus !== "IDLE" } }
    else if (path === "/api/llm-chat") { if (form) { const item = { seq: chatMessages.length + 1, timestamp: Date.now(), role: "USER" as const, text: form.get("message") ?? "", status: "DELIVERED" as const }; chatMessages.push(item); feedEntries.push({ seq: 3, timestamp: item.timestamp + 1, type: "resend", summary: "후속 재전송", risk: false }); data = item; status = 202 } else data = { messages: chatMessages } }
    else if (path === "/api/explorer-models") data = { configuredModel: "", models: [] }
    else if (path === "/api/human-run") data = { active: false, runs: [] }
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

it("shows the approved diagnosis layout and starts evidence-based MCP diagnosis", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  expect(await screen.findByRole("heading", { name: "AI 취약점 진단" })).toBeVisible()
  await screen.findByRole("button", { name: "USER B 로그인" })
  expect(screen.getByText("1", { selector: "strong" })).toBeVisible()
  await user.click(screen.getByRole("button", { name: "취약점 진단 시작" }))
  await waitFor(() => expect(posts.some(form => form.get("action") === "start" && form.get("datasetRevision") === "1")).toBe(true))
  expect(calls).toContain("/api/llm-verify")
})

it("shows initial diagnosis work before any message and keeps later work in chronological order", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await user.click(await screen.findByRole("button", { name: "취약점 진단 시작" }))
  const timeline = screen.getByRole("list", { name: "프로젝트 대화와 작업 기록" })
  expect(await within(timeline).findByText("초기 수집 근거 조회")).toBeVisible()
  expect(within(timeline).queryByText("나")).not.toBeInTheDocument()

  const input = screen.getByRole("textbox", { name: "프로젝트 대화에 질문 또는 작업 지시" })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, "이 결과를 다시 확인해줘")
  await user.click(screen.getByRole("button", { name: "보내기" }))
  expect(await within(timeline).findByText("후속 재전송")).toBeVisible()
  const rows = within(timeline).getAllByRole("listitem").map(item => item.textContent ?? "")
  expect(rows.findIndex(row => row.includes("초기 진단 시작"))).toBeLessThan(rows.findIndex(row => row.includes("초기 수집 근거 조회")))
  expect(rows.findIndex(row => row.includes("초기 수집 근거 조회"))).toBeLessThan(rows.findIndex(row => row.includes("이 결과를 다시 확인해줘")))
  expect(rows.findIndex(row => row.includes("이 결과를 다시 확인해줘"))).toBeLessThan(rows.findIndex(row => row.includes("후속 재전송")))
})

it("sends a question to the running diagnosis and keeps the run active", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await user.click(await screen.findByRole("button", { name: "취약점 진단 시작" }))
  const input = screen.getByRole("textbox", { name: "프로젝트 대화에 질문 또는 작업 지시" })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, "지금 어떤 근거를 보고 있어?")
  await user.click(screen.getByRole("button", { name: "보내기" }))
  await waitFor(() => expect(posts.some(form => form.get("message") === "지금 어떤 근거를 보고 있어?" && form.get("datasetRevision") === "1")).toBe(true))
  expect(await screen.findByText("지금 어떤 근거를 보고 있어?", { selector: "p" })).toBeVisible()
  expect(diagnosisStatus).toBe("RUNNING")
})

it("continues the project conversation after diagnosis and shows both report formats", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await user.click(await screen.findByRole("button", { name: "취약점 진단 시작" }))
  diagnosisStatus = "SUCCEEDED"
  await user.click(screen.getByRole("button", { name: "상태 새로고침" }))
  const input = screen.getByRole("textbox", { name: "프로젝트 대화에 질문 또는 작업 지시" })
  await waitFor(() => expect(screen.getByText("대화 가능")).toBeVisible())
  await user.type(input, "근거를 바탕으로 보고서를 만들어줘")
  await user.click(screen.getByRole("button", { name: "보내기" }))
  await waitFor(() => expect(posts.some(form => form.get("message") === "근거를 바탕으로 보고서를 만들어줘")).toBe(true))
  expect(await screen.findByText("차량 권한 보고서")).toBeVisible()
  expect(screen.getByRole("button", { name: "Markdown" })).toBeVisible()
  expect(screen.getByRole("button", { name: "PDF" })).toBeVisible()
})

it("allows several replay methods independently", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await screen.findByRole("button", { name: "USER A 다시 로그인" })
  expect(screen.getByRole("checkbox", { name: "GET" })).toBeChecked()
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const toggle = screen.getByRole("checkbox", { name: method })
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
  }
  expect(screen.getByText("재전송 허용 메서드 · 5개 선택")).toBeVisible()
  expect(posts.filter(form => form.get("action") === "permission").map(form => form.get("method"))).toEqual(["POST", "PUT", "PATCH", "DELETE"])
})

it("opens the real login browser from an account card and verifies the session", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await user.click(await screen.findByRole("button", { name: "USER B 로그인" }))
  expect(await screen.findByText("로그인 브라우저 · USER B")).toBeVisible()
  await waitFor(() => expect(posts.some(form => form.get("action") === "begin" && form.get("account") === "b")).toBe(true))
  await user.click(screen.getByRole("button", { name: "FlowScope에서 로그인 확인" }))
  await waitFor(() => expect(posts.some(form => form.get("action") === "verify-session" && form.get("account") === "b")).toBe(true))
})

it("does not keep a rejected permission change", async () => {
  failPermission = true
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await screen.findByRole("button", { name: "USER A 다시 로그인" })
  await user.click(screen.getByRole("checkbox", { name: "DELETE" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("프로젝트가 변경됐습니다.")
  expect(screen.getByRole("checkbox", { name: "DELETE" })).not.toBeChecked()
})

it("reveals MCP connection only on request and clears it on dataset replacement", async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<AiToolsPage />)
  await user.click(screen.getByRole("tab", { name: "MCP 연결" }))
  await user.click(await screen.findByRole("button", { name: "연결 정보" }))
  expect(await screen.findByLabelText("MCP 연결 정보")).toHaveTextContent("Bearer full-local-connection-key")
  window.dispatchEvent(new Event(DATASET_REPLACING))
  await waitFor(() => expect(screen.queryByLabelText("MCP 연결 정보")).not.toBeInTheDocument())
})
