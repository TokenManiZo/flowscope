import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { EvidenceFilters } from "./EvidenceFilters"
import { defaultEvidenceFilters } from "./evidenceSelectors"

it("keeps sources, search and repeat inline and tucks the ten traffic classes into one menu", async () => {
  const onChange = vi.fn()
  render(<EvidenceFilters value={defaultEvidenceFilters()} onChange={onChange} />)
  for (const label of ["사람", "스캐너", "LLM", "반복 관측 기록 펼치기"]) expect(screen.getByRole("checkbox", { name: label })).toBeVisible()
  expect(screen.queryByRole("checkbox", { name: "정적 자원" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "분류 5/10" }))
  for (const label of ["인증·세션 준비", "반복 백그라운드", "탐색 메타데이터", "CORS 사전 요청"]) expect(screen.getByRole("checkbox", { name: label })).toBeVisible()
  await userEvent.type(screen.getByRole("searchbox", { name: "번호·경로·계정 검색" }), "a")
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ query: "a" }))
})
