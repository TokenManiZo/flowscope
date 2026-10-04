import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { snapshotFixture, humanRunFixture, scannerRunFixture, zapStatusFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { queryKeys } from "@/lib/query/hooks"
import { RunsPage } from "./RunsPage"

afterEach(() => vi.unstubAllGlobals())
function setup() {
  let offline = false
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (offline && path === "/api/scanner-run") throw new Error("scanner offline")
    const body = path === "/api/snapshot" ? snapshotFixture
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

it("compares two LLM runs using method-bound operation counts and separate UNKNOWN paths", async () => {
  const user = userEvent.setup()
  const snapshot = { ...snapshotFixture, datasetRevision: 8, collectionProgress: {
    unitVersion: 1, operationUnit: "SERVICE_METHOD_TEMPLATE", runs: [
      { runId: "llm-before", firstSeenMillis: 1, observedOperations: 1, declaredUnobservedOperations: 1, unknownMethodPaths: 1, retainedHints: 2 },
      { runId: "llm-after", firstSeenMillis: 2, observedOperations: 2, declaredUnobservedOperations: 0, unknownMethodPaths: 1, retainedHints: 2 },
    ],
  } }
  const empty = { count: 0, items: [], truncated: false }
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    const body = path.startsWith("/api/collection-diff?") ? {
      unitVersion: 1, operationUnit: "SERVICE_METHOD_TEMPLATE", beforeRunId: "llm-before", afterRunId: "llm-after",
      observedAdded: { count: 1, items: [{ service: "https://api.test:443", method: "POST", pathTemplate: "/items" }], truncated: false },
      observedRemoved: empty, declaredUnobservedAdded: empty, declaredUnobservedRemoved: empty,
      unknownMethodAdded: empty, unknownMethodRemoved: empty,
    } : path === "/api/snapshot" ? snapshot : path === "/api/human-run" ? humanRunFixture
      : path === "/api/zap-status" ? zapStatusFixture : path === "/api/scanner-run" ? scannerRunFixture
      : { run: { status: "IDLE", unresolved: [] }, accounts: [], scope: [] }
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetchStub)
  renderWithQueryClient(<RunsPage />)
  await user.selectOptions(await screen.findByLabelText("비교 기준 LLM run"), "llm-before")
  await user.selectOptions(screen.getByLabelText("비교할 LLM run"), "llm-after")
  await user.click(await screen.findByText("추가 관측 1개"))
  expect(screen.getByText("POST https://api.test:443/items")).toBeVisible()
  expect(screen.getByText(/UNKNOWN은 메서드 미확정 경로로 따로/)).toBeVisible()
  expect(fetchStub.mock.calls.some(([path]) => String(path).includes("datasetRevision=8"))).toBe(true)
})
