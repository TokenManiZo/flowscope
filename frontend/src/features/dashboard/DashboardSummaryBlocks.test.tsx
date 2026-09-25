import { render, screen, within } from "@testing-library/react"
import { expect, it } from "vitest"
import { AuthorizationDecisionSummary, EMPTY_DASHBOARD_SUMMARY, SnapshotStrip, SourceObservationSummary } from "./DashboardSummaryBlocks"

it("renders three independent source counts and the five snapshot slots", () => {
  render(<><SnapshotStrip trafficStats={EMPTY_DASHBOARD_SUMMARY.trafficStats} /><SourceObservationSummary sourceCounts={{ human: 12, scanner: 8, llm: 3 }} /></>)
  for (const [label, value] of [["HUMAN", "12"], ["SCANNER", "8"], ["LLM", "3"]]) expect(within(screen.getByRole("group", { name: label })).getByText(value)).toBeVisible()
  expect(screen.getByLabelText("현재 snapshot 요약").querySelectorAll("dt")).toHaveLength(5)
})
it("keeps absent authorization data neutral and zero", () => {
  render(<AuthorizationDecisionSummary />)
  for (const tile of screen.getAllByRole("group")) expect(tile).not.toHaveClass("bg-candidate-surface")
  expect(screen.getByText("0 / 0")).toBeVisible()
})
it("highlights only positive candidate counts", () => {
  render(<AuthorizationDecisionSummary authorizationSummary={{ bolaIdorCandidates: 2, bflaCandidates: 0, manualReviewPending: 4, humanConfirmed: 1, humanDismissed: 3 }} />)
  expect(screen.getByRole("group", { name: "BOLA/IDOR 후보" })).toHaveClass("bg-candidate-surface", "border-candidate-border")
  for (const label of ["BFLA 후보", "검토 대기", "사람 확인 / 기각"]) expect(screen.getByRole("group", { name: label })).not.toHaveClass("bg-candidate-surface")
  expect(screen.getByText("1 / 3")).toBeVisible()
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
})
