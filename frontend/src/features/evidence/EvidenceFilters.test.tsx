import { render, screen, within } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { EvidenceFilters } from "./EvidenceFilters"
import { defaultEvidenceFilters } from "./evidenceSelectors"

it("keeps long Korean Evidence filter labels readable inside the narrow analysis rail", () => {
  render(<EvidenceFilters value={defaultEvidenceFilters()} onChange={vi.fn()} />)

  const trafficGroup = screen.getByRole("group", { name: "트래픽 분류" })
  expect(trafficGroup).toHaveClass("grid-cols-1")
  for (const label of ["인증·세션 준비", "반복 백그라운드 후보", "탐색 메타데이터", "CORS 사전 요청"]) {
    const text = within(trafficGroup).getByText(label)
    expect(text).toHaveClass("break-keep")
    expect(text.closest("label")).toHaveClass("min-w-0")
  }
})
