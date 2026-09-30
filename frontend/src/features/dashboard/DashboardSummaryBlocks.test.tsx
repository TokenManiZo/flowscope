import { render, screen, within } from "@testing-library/react"
import { expect, it } from "vitest"

import type { Scenario } from "@/lib/api/types"
import { CandidateList, DashboardPipeline, EMPTY_DASHBOARD_SUMMARY, PriorityApiList, SnapshotFootnote, type PipelineCounts } from "./DashboardSummaryBlocks"

const counts: PipelineCounts = { openGaps: 32, priorityApis: 4, authVariants: 32, unobserved: 0, review: 3 }

it("renders observe → compare → judge as three links with source counts inside the observe stage", () => {
  render(<DashboardPipeline values={{ ...EMPTY_DASHBOARD_SUMMARY, trafficStats: { ...EMPTY_DASHBOARD_SUMMARY.trafficStats, captured: 21 }, sourceCounts: { human: 12, scanner: 8, llm: 3 } }} counts={counts} />)
  const observe = screen.getByRole("link", { name: "관측 · 관측 기록" })
  expect(observe).toHaveAttribute("href", "#evidence")
  const stage = observe.parentElement as HTMLElement
  for (const [label, value] of [["HUMAN", "12"], ["SCANNER", "8"], ["LLM", "3"]]) expect(within(within(stage).getByRole("group", { name: label })).getByText(value)).toBeVisible()
  // 검토 필요 트래픽은 칸 링크와 따로 Evidence 검토 탭으로 바로 간다(링크 안에 링크를 넣지 않는다).
  expect(within(stage).getByRole("link", { name: "검토 필요 트래픽" })).toHaveAttribute("href", "#evidence-review")
  expect(observe.querySelector("a")).toBeNull()
  expect(screen.getByRole("link", { name: "비교 · Gap 그래프" })).toHaveAttribute("href", "#graph")
  expect(screen.getByRole("link", { name: "판정 · 권한 매트릭스" })).toHaveAttribute("href", "#matrix")
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument()
})

it("keeps absent authorization data neutral and highlights only positive candidate counts", () => {
  const { rerender } = render(<DashboardPipeline values={EMPTY_DASHBOARD_SUMMARY} counts={counts} />)
  expect(within(screen.getByRole("group", { name: "BOLA/IDOR 후보" })).getByText("0")).not.toHaveClass("text-candidate")
  expect(within(screen.getByRole("group", { name: "사람 확인 · 기각" })).getByText("0 · 0")).toBeVisible()
  rerender(<DashboardPipeline values={{ ...EMPTY_DASHBOARD_SUMMARY, authorizationSummary: { bolaIdorCandidates: 2, bflaCandidates: 0, manualReviewPending: 4, humanConfirmed: 1, humanDismissed: 3 } }} counts={counts} />)
  expect(within(screen.getByRole("group", { name: "BOLA/IDOR 후보" })).getByText("2")).toHaveClass("text-candidate")
  expect(within(screen.getByRole("group", { name: "BFLA 후보" })).getByText("0")).not.toHaveClass("text-candidate")
  expect(within(screen.getByRole("group", { name: "사람 확인 · 기각" })).getByText("1 · 3")).toBeVisible()
})

it("moves the remaining snapshot counts into a single footnote", () => {
  render(<SnapshotFootnote trafficStats={{ captured: 21, coverage: 17, excluded: 1, dropped: 0, payloadMetadataOnly: 0 }} />)
  expect(screen.getByLabelText("현재 snapshot 요약").querySelectorAll("dt")).toHaveLength(4)
})

it("lists prioritized APIs and rule candidates with their reasons and review state", () => {
  const scenario = { id: "s1", tag: "BOLA", title: "객체 권한 우회 후보: GET /api/orders/{id}", proposal: "", evidence: "", risk: "HIGH", evidenceIds: [], reviewStatus: "UNRESOLVED", reviewNote: "" } satisfies Scenario
  render(<><PriorityApiList rows={[{ key: "k", method: "PATCH", path: "/api/orders/{id}", gapCount: 6, reasons: ["CONFIRMED_AUTH_BOUNDARY", "WRITE_METHOD"] }]} /><CandidateList scenarios={[scenario]} /></>)
  const apis = screen.getByRole("region", { name: "우선 점검 API" })
  expect(within(apis).getByText("쓰기 요청")).toBeVisible()
  expect(within(apis).getByText("Gap 6")).toBeVisible()
  const candidates = screen.getByRole("region", { name: "인가 후보" })
  expect(within(candidates).getByText("객체 권한 우회 후보")).toBeVisible()
  expect(within(candidates).getByText("GET /api/orders/{id}")).toBeVisible()
  expect(within(candidates).getByText("검토 전")).toBeVisible()
})
