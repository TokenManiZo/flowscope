import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { RouteCandidateDetail } from "./RouteCandidateDetail"

const longId = `evidence-${"<unsafe-id>".repeat(40)}`
const candidate = {
  id: "candidate:1", service: `https://api.example.test/${"service-segment/".repeat(20)}`, method: "UNKNOWN", pathTemplate: `/unseen/${"path-segment/".repeat(20)}`, observed: false, applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: Array.from({ length: 12 }, (_, index) => index === 0 ? longId : `evidence-${index}`), provenance: Array.from({ length: 12 }, (_, index) => ({ type: "SITE_MAP", evidenceId: `provenance-${index}-${longId}`, source: "human", runId: `run-${index}`, adapter: "burp", applicability: "REVIEW", reason: `reason-${index}-${"x".repeat(220)}` })), reviewReason: `review-${"r".repeat(220)}`, priorityReasons: ["input", `priority-${"p".repeat(220)}`],
}

it("shows found-in records as #N, hides unnumbered ones, and names runs by tool", async () => {
  const ordinals = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`evidence-${index + 1}`, index + 1]))
  ordinals["provenance-0-" + longId] = 40
  render(<RouteCandidateDetail candidate={{ ...candidate, provenance: candidate.provenance.map((item, index) => ({ ...item, runId: index === 0 ? "zap-baseline-1" : item.runId, source: index === 0 ? "SCANNER" : item.source })) }} ordinals={ordinals} />)
  expect(screen.getByText(/찾은 요청 기록 11건/)).toBeVisible()
  expect(screen.getByText("#1 #2 #3 #4 #5")).toBeVisible()
  expect(document.body).not.toHaveTextContent(longId)
  expect(document.body).not.toHaveTextContent("provenance-")
  expect(screen.getByText(/SITE_MAP · #40 · SCANNER · ZAP 실행 · burp/)).toBeVisible()
  expect(screen.getAllByText(/…/).length).toBeGreaterThan(0)
  expect(screen.queryByText(/reason-11/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "후보 상세 펼치기" }))
  expect(screen.getByText("#1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11")).toBeVisible()
  expect(screen.getAllByText(/reason-11/).length).toBeGreaterThan(0)
  expect(document.body).not.toHaveTextContent(longId)
  await userEvent.click(screen.getByRole("button", { name: "후보 상세 접기" }))
  expect(screen.queryByText(/reason-11/)).not.toBeInTheDocument()
})

it("leaves out the found-in row when no linked record has a number", () => {
  render(<RouteCandidateDetail candidate={candidate} />)
  expect(screen.queryByText(/찾은 요청 기록/)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent("없음")
  expect(document.body).not.toHaveTextContent("evidence-1")
})

it("uses the shared amber REVIEW semantic while retaining explicit applicability text", () => {
  render(<RouteCandidateDetail candidate={candidate} />)

  expect(screen.getByTestId("route-candidate-applicability")).toHaveTextContent("미관측 후보 · REVIEW")
  expect(screen.getByTestId("route-candidate-applicability")).toHaveClass("text-amber-700", "dark:text-amber-300")
})
