import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { LlmJudgmentPage } from "./LlmJudgmentPage"
import { renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import type { EventRecord, LlmFinding } from "@/lib/api/types"
import { takeResendSelection } from "@/features/graph/resendNavigation"

vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: ({ event }: { event: EventRecord }) => <div role="dialog">Request Lab {event.eventId}</div> }))

afterEach(() => vi.unstubAllGlobals())

it("selects one scope per enabled source and excludes disabled sources from the run", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    let value: unknown = {}
    if (path === "/api/snapshot") value = { ...snapshotFixture, accounts: [], managedSessions: [] }
    else if (path === "/api/llm-findings") value = { findings: [] }
    else if (path.startsWith("/api/llm-feed")) value = { entries: [] }
    else if (path === "/api/llm-verify") {
      if (init?.method === "POST") posts.push(String(init.body))
      value = { status: "IDLE", accountId: "", message: "idle" }
    } else if (path === "/api/explorer-run") value = { run: { status: "IDLE", providerReadiness: "READY" }, accounts: [], scope: [] }
    else if (path === "/api/explorer-models") value = { models: [], configuredModel: "" }
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
  }))
  const view = renderWithQueryClient(<LlmJudgmentPage />)
  await user.click(await screen.findByRole("button", { name: /^판정 범위/ }))
  const matrix = within(screen.getByRole("group", { name: "판정 매트릭스에서 가져오기" }))
  const graph = within(screen.getByRole("group", { name: "점검 그래프에서 가져오기" }))
  await user.click(matrix.getByRole("radio", { name: "전체" }))
  expect(matrix.getByRole("radio", { name: /객체 조회/ })).not.toBeChecked()
  await user.click(matrix.getByRole("radio", { name: /기능 권한/ }))
  expect(matrix.getByRole("radio", { name: "전체" })).not.toBeChecked()
  expect(graph.getByRole("radio", { name: "전체" })).toBeDisabled()
  await user.click(graph.getByRole("checkbox"))
  await user.click(graph.getByRole("radio", { name: "전체" }))
  expect(graph.getByRole("radio", { name: "주요 API만" })).not.toBeChecked()
  await user.click(screen.getByRole("button", { name: "판정 시작" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(new URLSearchParams(posts[0]).get("sources")).toBe("matrix:bfla;graph:all")
  await user.click(matrix.getByRole("checkbox"))
  await user.click(screen.getByRole("button", { name: "판정 시작" }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(new URLSearchParams(posts[1]).get("sources")).toBe("graph:all")
  await user.click(graph.getByRole("checkbox"))
  expect(screen.getByRole("button", { name: "판정 시작" })).toBeDisabled()
  view.unmount()
})

it("reveals the matching full-width result from a typed progress entry without extra filters", async () => {
  const user = userEvent.setup()
  const posts: string[] = []
  const finding: LlmFinding = {
    id: "llm:order", operation: "https://shop.test GET /rest/basket/4", identity: "user-a",
    verdict: "", confidence: "", note: "다른 계정의 주문", evidenceIds: ["ev-1"], createdAt: 1,
    judgment: "vulnerable", judgmentReason: "다른 회원의 주문이 반환됨", verificationResult: "다른 계정의 주문이 HTTP 200으로 반환됐습니다.",
    judgmentBasis: "응답에 요청자와 다른 사용자의 주문 정보가 포함됐습니다.", issueTitle: "다른 회원의 주문 조회 (IDOR)", judgmentEvidenceIds: ["ev-2"], judgedAt: 2,
  }
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/llm-verify" && init?.method === "POST") posts.push(String(init.body))
    const value = path === "/api/snapshot" ? { ...snapshotFixture, datasetRevision: 2,
      events: [{ eventId: "ev-1", method: "GET", path: "/rest/basket/4", status: 200, op: finding.operation },
        { eventId: "ev-2", method: "GET", path: "/rest/basket/4", status: 200, op: finding.operation }],
      evidenceOrdinals: { "ev-1": 1, "ev-2": 2 },
      manualVerifications: [{ eventId: "ev-2", originEvidenceId: "ev-1", operation: finding.operation,
        identity: "user-a", identityId: "user-a", resource: null, timestamp: 2, status: 200, durationMs: 5 }] }
      : path === "/api/llm-findings" ? { findings: [finding] }
      : path.startsWith("/api/llm-feed") ? { entries: [{ seq: 1, timestamp: 1, type: "verdict", summary: "주문 판정", risk: true, findingId: finding.id }] }
      : path === "/api/llm-verify" ? { status: "SUCCEEDED", accountId: "", message: "완료" }
      : path === "/api/explorer-run" ? { run: { status: "IDLE", providerReadiness: "READY" }, accounts: [], scope: [] }
      : path === "/api/explorer-models" ? { models: [], configuredModel: "" } : {}
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
  }))
  const view = renderWithQueryClient(<LlmJudgmentPage />)
  await user.click(await screen.findByRole("button", { name: "주문 판정" }))
  const results = screen.getByLabelText("LLM 판정 결과")
  expect(within(results).getAllByText("다른 계정의 주문이 HTTP 200으로 반환됐습니다.")).toHaveLength(1)
  expect(screen.queryByLabelText("사이트 필터")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("판정 결과 검색")).not.toBeInTheDocument()
  const card = results.querySelector<HTMLElement>("[data-finding-id]")!
  expect(within(card).getByText("다른 회원의 주문 조회 (IDOR)")).toBeInTheDocument()
  expect(within(card).getByRole("heading", { name: "판정 요약" })).toBeInTheDocument()
  expect(within(card).getByText("1. 검증 결과")).toBeInTheDocument()
  expect(within(card).getByText("2. 판정 근거")).toBeInTheDocument()
  await user.click(within(card).getByRole("button", { name: "재전송 그래프" }))
  expect(window.location.hash).toBe("#graph")
  expect(takeResendSelection(2)).toBe("ev-2")
  await user.click(within(card).getByRole("button", { name: /상세 펼치기/ }))
  await user.click(within(card).getAllByRole("button", { name: "요청·응답 보기" })[0])
  expect(screen.getByRole("dialog")).toHaveTextContent("Request Lab ev-2")
  await user.type(screen.getByRole("textbox", { name: "LLM 판정 후속 질문" }), "이 응답이 왜 취약한가요?")
  await user.click(screen.getByRole("button", { name: "질문 전송" }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(new URLSearchParams(posts[0]).get("action")).toBe("ask")
  view.unmount()
})

it("separates verdicts, limits long lists, and keeps the judgment action in unjudged", async () => {
  const user = userEvent.setup()
  const makeFinding = (id: string, judgment: LlmFinding["judgment"]): LlmFinding => ({
    id, operation: `https://service.test GET /records/${id}`, identity: id === "pending" ? "anonymous" : "user-a", verdict: "", confidence: "",
    note: "조회 결과 확인", evidenceIds: id === "v0" ? Array.from({ length: 5 }, (_, index) => `ev-extra-${index}`) : [], createdAt: 1, judgment,
    judgmentReason: judgment ? "요청과 응답을 비교했습니다." : "", judgmentEvidenceIds: [], judgedAt: 2,
  })
  const findings = [
    ...Array.from({ length: 21 }, (_, index) => makeFinding(`v${index}`, "vulnerable")),
    makeFinding("pending", "inconclusive"), makeFinding("safe", "not_vulnerable"), makeFinding("candidate", ""),
  ]
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    const value = path === "/api/snapshot" ? snapshotFixture
      : path === "/api/llm-findings" ? { findings }
      : path === "/api/matrix-exclusions" ? { datasetRevision: 1, entries: [{ key: JSON.stringify(["function", "https://service.test GET /records/candidate", null]), view: "function", operation: "https://service.test GET /records/candidate", resource: null, label: "GET /records/candidate" }] }
      : path.startsWith("/api/llm-feed") ? { entries: [] }
      : path === "/api/llm-verify" ? { status: "SUCCEEDED", accountId: "", message: "완료" }
      : path === "/api/explorer-run" ? { run: { status: "IDLE", providerReadiness: "READY" }, accounts: [], scope: [] }
      : path === "/api/explorer-models" ? { models: [], configuredModel: "" } : {}
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
  }))
  const view = renderWithQueryClient(<LlmJudgmentPage />)
  const vulnerableTab = await screen.findByRole("tab", { name: /취약/ })
  await waitFor(() => expect(vulnerableTab).toHaveTextContent("21"))
  await user.click(vulnerableTab)
  expect(screen.getByLabelText("LLM 판정 결과").querySelectorAll("[data-finding-id]")).toHaveLength(20)
  expect(screen.queryByRole("button", { name: "선택한 소견 판정" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /20건 더 보기/ }))
  expect(screen.getByLabelText("LLM 판정 결과").querySelectorAll("[data-finding-id]")).toHaveLength(21)
  expect(screen.queryByRole("button", { name: /판정 상세 보기/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "GET /records/v0 상세 펼치기" }))
  const detail = screen.getByLabelText("판정 요약").closest<HTMLElement>("[data-finding-id]")!
  expect(within(detail).getByRole("button", { name: "GET /records/v0 상세 접기" })).toHaveAttribute("aria-expanded", "true")
  expect(detail.querySelectorAll("[data-evidence-id]")).toHaveLength(3)
  expect(within(detail).getByRole("heading", { name: "판정 요약" })).toBeInTheDocument()
  expect(within(screen.getByLabelText("판정 요약")).getByRole("button", { name: "요청 5건 모두 보기" })).toBeInTheDocument()
  expect(within(detail).queryByText(/나머지 .*건/)).not.toBeInTheDocument()
  expect(within(detail).getByRole("heading", { name: /요청 근거/ })).toBeInTheDocument()
  expect(within(detail).getByText("아래는 이 소견을 찾거나 판정할 때 사용한 실제 요청입니다.")).toBeInTheDocument()
  expect(within(detail).queryByText("판정에 사용한 요청")).not.toBeInTheDocument()
  expect(within(detail).queryByText("확인 전 메모")).not.toBeInTheDocument()
  await user.click(within(detail).getByRole("button", { name: "요청 5건 모두 보기" }))
  expect(screen.getByRole("dialog", { name: "GET /records/v0 판정 상세" })).toBeInTheDocument()
  expect(within(detail).getByText("대상 서비스")).toBeInTheDocument()
  expect(within(detail).getByText("검사 계정")).toBeInTheDocument()
  expect(detail.querySelectorAll("[data-evidence-id]")).toHaveLength(5)
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog", { name: "GET /records/v0 판정 상세" })).not.toBeInTheDocument()
  expect(detail.querySelectorAll("[data-evidence-id]")).toHaveLength(3)
  await user.click(within(detail).getByRole("button", { name: "요청 근거 도움말" }))
  expect(screen.getByLabelText("요청 근거 설명")).toHaveTextContent("실제 요청과 응답 원문")
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("tab", { name: /확인 필요/ }))
  expect(screen.getByLabelText("LLM 판정 결과").querySelectorAll("[data-finding-id]")).toHaveLength(1)
  expect(screen.getByLabelText("LLM 판정 결과")).toHaveTextContent("비로그인")
  expect(screen.getByLabelText("LLM 판정 결과")).not.toHaveTextContent("anonymous")
  await user.click(screen.getByRole("button", { name: "GET /records/pending 상세 펼치기" }))
  await user.click(within(screen.getByLabelText("판정 요약")).getByRole("button", { name: "전체 보기" }))
  expect(screen.getByRole("dialog", { name: "GET /records/pending 판정 상세" })).toBeInTheDocument()
  expect(within(screen.getByRole("dialog", { name: "GET /records/pending 판정 상세" })).getAllByText("비로그인")).toHaveLength(1)
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("tab", { name: /정상/ }))
  expect(screen.getByLabelText("LLM 판정 결과").querySelectorAll("[data-finding-id]")).toHaveLength(1)
  await user.click(screen.getByRole("button", { name: "GET /records/safe 상세 펼치기" }))
  expect(within(screen.getByLabelText("판정 요약")).getByRole("button", { name: "전체 보기" })).toBeInTheDocument()
  await user.click(screen.getByRole("tab", { name: /미판정/ }))
  expect(screen.getByRole("button", { name: "선택한 소견 판정" })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "https://service.test GET /records/candidate 판정 선택" })).toBeDisabled())
  expect(screen.getByLabelText("LLM 판정 결과")).toHaveTextContent("LLM 검사 제외")
  await user.click(screen.getByRole("button", { name: "미판정 도움말" }))
  expect(screen.getByLabelText("미판정 설명")).toHaveTextContent("실행이 실패하거나 판정이 저장되지 않으면 미판정에 남습니다")
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("button", { name: "GET /records/candidate 상세 펼치기" }))
  await user.click(within(screen.getByLabelText("소견 요약")).getByRole("button", { name: "전체 보기" }))
  expect(screen.getByRole("dialog", { name: "GET /records/candidate 소견 상세" })).toBeInTheDocument()
  view.unmount()
})

it("keeps a resend status beside the message even when no request can be opened", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    const value = path === "/api/snapshot" ? snapshotFixture
      : path.startsWith("/api/llm-feed") ? { entries: [{ seq: 1, timestamp: 1, type: "resend", summary: "GET /api/orders/101 · HTTP 200", risk: false }] }
      : path === "/api/llm-findings" ? { findings: [] }
      : path === "/api/llm-verify" ? { status: "IDLE", accountId: "", message: "" }
      : path === "/api/explorer-run" ? { run: { status: "IDLE", providerReadiness: "READY" }, accounts: [], scope: [] }
      : path === "/api/explorer-models" ? { models: [], configuredModel: "" } : {}
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
  }))
  const view = renderWithQueryClient(<LlmJudgmentPage />)
  const summary = await screen.findByText("GET /api/orders/101")
  expect(within(summary.parentElement!).getByText("200")).toBeInTheDocument()
  expect(summary.closest("article")!.children).toHaveLength(3)
  view.unmount()
})
