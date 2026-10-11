import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { snapshotFixture, humanRunFixture, scannerRunFixture, zapStatusFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { queryKeys } from "@/lib/query/hooks"
import { RunsPage } from "./RunsPage"

afterEach(() => vi.unstubAllGlobals())
function setup(snapshot: typeof snapshotFixture = snapshotFixture) {
  let offline = false
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (offline && path === "/api/scanner-run") throw new Error("scanner offline")
    const body = path === "/api/snapshot" ? snapshot
      : path === "/api/human-run" ? humanRunFixture
      : path === "/api/zap-status" ? zapStatusFixture
      : path === "/api/scanner-run" ? { ...scannerRunFixture, run: { status: "RUNNING", stage: "CLIENT_SPIDER", captured_records: 8, alert_count: 2 } }
      : path === "/api/explorer-run" ? { run: { status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0, message: "Explorer 실행 대기", providerReadiness: "READY", accountIds: [], anonymous: false, attempts: 0, responses: 0, unresolved: [], activities: [] }, accounts: [], scope: [] }
      : null
    if (body === null) throw new Error("Unexpected API " + path)
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetchStub)
  const view = renderWithQueryClient(<RunsPage />)
  return { ...view, fetchStub, goOffline: () => { offline = true } }
}
it("shows HUMAN, ZAP, and LLM Explorer side by side with plain status words", async () => {
  const { fetchStub } = setup()
  expect(await screen.findByText("8건 · Alert 2건")).toBeVisible()
  expect(screen.getByText("Client Spider")).toBeVisible()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
  expect(fetchStub.mock.calls.every(([path]) => !String(path).includes("llm-run"))).toBe(true)
  // 서버 원래 값은 배지 title로만 남고 화면에는 한국어 상태가 보인다.
  expect(screen.getByTitle("RUNNING")).toHaveTextContent("진행 중")
  expect(screen.getByTitle("IDLE")).toHaveTextContent("대기")
  expect(screen.queryByText(/NOT_STARTED|IDLE|UNAVAILABLE/)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "LLM 단계 열기" })).toBeVisible()
  await userEvent.click(screen.getAllByRole("button", { name: "점검 시작에서 제어" })[0])
  expect(window.location.hash).toBe("#inspection")
})
it("retains the scanner result when polling fails", async () => {
  const { client, goOffline } = setup()
  await screen.findByText("8건 · Alert 2건")
  goOffline()
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.scannerRun }) })
  await waitFor(() => expect(screen.getByText("마지막 성공 상태를 표시하고 있습니다.")).toBeVisible())
  expect(screen.getByText("8건 · Alert 2건")).toBeVisible()
})
it("names saved runs by tool and start time instead of the long run ID", async () => {
  const startedAt = new Date(2026, 9, 7, 14, 32).getTime()
  setup({ ...snapshotFixture, runExecutions: [
    { source: "SCANNER", runId: "zap-baseline-1759815120000", attempted: 3, responses: 3, failures: 0, quality: "RESPONSES_OBSERVED", outcomes: { HTTP_RESPONSE: 3 }, startedAt },
    { source: "HUMAN", runId: "authorization-replay-3f9a", attempted: 1, responses: 0, failures: 1, quality: "ALL_FAILED", outcomes: { TIMEOUT: 1 } },
  ] })
  expect(await screen.findByText("ZAP 실행 · 10/07 14:32")).toHaveAttribute("title", "zap-baseline-1759815120000")
  expect(screen.getByText("자동 검증")).toBeVisible()
  expect(screen.queryByText(/zap-baseline-|authorization-replay-/)).not.toBeInTheDocument()
})
