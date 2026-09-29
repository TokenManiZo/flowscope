import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { RouteCandidateDetail } from "./RouteCandidateDetail"

const longId = `evidence-${"<unsafe-id>".repeat(40)}`
const candidate = {
  id: "candidate:1", service: `https://api.example.test/${"service-segment/".repeat(20)}`, method: "UNKNOWN", pathTemplate: `/unseen/${"path-segment/".repeat(20)}`, observed: false, applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: Array.from({ length: 12 }, (_, index) => index === 0 ? longId : `evidence-${index}`), provenance: Array.from({ length: 12 }, (_, index) => ({ type: "SITE_MAP", evidenceId: `provenance-${index}-${longId}`, source: "human", runId: `run-${index}`, adapter: "burp", applicability: "REVIEW", reason: `reason-${index}-${"x".repeat(220)}` })), reviewReason: `review-${"r".repeat(220)}`, priorityReasons: ["input", `priority-${"p".repeat(220)}`],
}

it("bounds initial candidate IDs and provenance strings, then exposes and collapses the full escaped payload", async () => {
  render(<RouteCandidateDetail candidate={candidate} />)
  expect(screen.getByText(/근거 기록 번호 \(12\)/)).toBeVisible()
  expect(screen.queryByText(longId)).not.toBeInTheDocument()
  expect(screen.getAllByText(/…/).length).toBeGreaterThan(0)
  expect(screen.queryByText(/provenance-11/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "후보 상세 펼치기" }))
  expect(screen.getByText((_content, element) => element?.tagName === "DD" && element.textContent?.includes(longId) === true)).toBeVisible()
  expect(screen.getAllByText(/provenance-11/).length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole("button", { name: "후보 상세 접기" }))
  expect(screen.queryByText(longId)).not.toBeInTheDocument()
  expect(screen.queryByText(/provenance-11/)).not.toBeInTheDocument()
})

it("uses the shared amber REVIEW semantic while retaining explicit applicability text", () => {
  render(<RouteCandidateDetail candidate={candidate} />)

  expect(screen.getByTestId("route-candidate-applicability")).toHaveTextContent("미관측 후보 · REVIEW")
  expect(screen.getByTestId("route-candidate-applicability")).toHaveClass("text-amber-700", "dark:text-amber-300")
})
