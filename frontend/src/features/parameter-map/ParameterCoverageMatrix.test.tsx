import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { validationCell } from "./parameterMapFixtures"
import { ParameterCoverageMatrix } from "./ParameterCoverageMatrix"
import type { ProjectedValidationCell } from "./parameterProjection"

it("keeps every server state accessible and actual Evidence separate from bounded basis previews", async () => {
  const states = ["ALLOW", "DENY", "SUSPICIOUS", "UNDECIDED", "UNTESTED"] as const
  const cells: ProjectedValidationCell[] = states.map((verdict, i) => ({ ...validationCell({ verdict, identity: `person-${i}`, role: "USER", evidenceCount: verdict === "UNTESTED" ? 0 : 30, evidenceIds: verdict === "UNTESTED" ? [] : Array.from({ length: 25 }, (_, n) => `actual-${n}`) }), id: String(i) }))
  cells.push({ ...validationCell({ applicable: false, identity: "unknown" }), id: "na" })
  const select = vi.fn()
  render(<ParameterCoverageMatrix cells={cells} onSelect={select} />)
  for (const name of ["자기 값", "타인 값", "미인증", "다른 역할"]) expect(screen.getByRole("columnheader", { name })).toBeVisible()
  for (const state of [...states, "NOT_APPLICABLE"]) {
    const badge = screen.getByText(state)
    expect(badge).toHaveAccessibleName(state === "UNTESTED" ? /미검증/ : new RegExp(state))
    expect(badge.querySelector("svg")).not.toBeNull()
    expect(badge.className).toMatch(/text-/)
  }
  expect(screen.getByRole("region", { name: "파라미터 커버리지 표" })).toHaveClass("overflow-auto", "max-w-full")
  expect(screen.queryByText("actual-20")).not.toBeInTheDocument()
  const untested = screen.getByRole("group", { name: /person-4/ })
  expect(untested).toHaveTextContent("실행 Evidence 0건")
  expect(untested).toHaveTextContent("좌표 근거 50건")
  const button = within(untested).getByRole("button")
  button.focus()
  await userEvent.keyboard("{Enter}")
  expect(select).toHaveBeenCalledWith(cells[4])
  await userEvent.click(screen.getByRole("tab", { name: "신원 / 역할" }))
  expect(screen.getByRole("rowheader", { name: "person-4 / USER" })).toBeVisible()
})
