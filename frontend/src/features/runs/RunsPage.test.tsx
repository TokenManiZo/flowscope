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
it("shows HUMAN, scanner, and independent LLM Explorer status", async () => {
  const { fetchStub } = setup()
  expect(await screen.findByText("현재 단계 CLIENT_SPIDER · 수집 8건 · Alert 2건")).toBeVisible()
  expect(screen.getByRole("tab", { name: "LLM" })).toBeVisible()
  expect(fetchStub.mock.calls.every(([path]) => !String(path).includes("llm-run"))).toBe(true)
  await userEvent.click(screen.getByRole("tab", { name: "LLM" }))
  expect(screen.getByText("LLM Explorer · IDLE")).toBeVisible()
  expect(screen.getByRole("button", { name: "LLM 단계 열기" })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "HUMAN" }))
  expect(screen.getByText("HUMAN · NOT_STARTED")).toBeVisible()
})
it("retains the scanner result when polling fails", async () => {
  const { client, goOffline } = setup()
  await screen.findByText("현재 단계 CLIENT_SPIDER · 수집 8건 · Alert 2건")
  goOffline()
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.scannerRun }) })
  await waitFor(() => expect(screen.getByText("마지막 성공 상태를 표시하고 있습니다.")).toBeVisible())
  expect(screen.getByText("현재 단계 CLIENT_SPIDER · 수집 8건 · Alert 2건")).toBeVisible()
})
