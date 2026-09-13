import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { WorkspaceNavigation } from "./WorkspaceNavigation"

it("shows only three primary groups while keeping every route reachable", async () => {
  render(<WorkspaceNavigation route="graph" />)

  expect(screen.getAllByRole("button", { name: /분석|기록/ })).toHaveLength(2)
  expect(screen.getByRole("link", { name: "점검" })).toHaveAttribute("href", "#inspection")

  await userEvent.click(screen.getByRole("button", { name: "분석" }))
  for (const label of ["점검 Gap 그래프", "API·입력 차이", "대시보드", "권한 매트릭스", "흐름 순서", "취약점 시나리오"]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeVisible()
  }

  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "기록" }))
  for (const label of ["Evidence", "실행 상태", "LLM Explorer", "계정·세션"]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeVisible()
  }
})

it("uses menu trigger semantics and supports keyboard navigation through grouped routes", async () => {
  const user = userEvent.setup()
  render(<WorkspaceNavigation route="graph" />)

  const analysis = screen.getByRole("button", { name: "분석" })
  expect(analysis).toHaveAttribute("aria-haspopup", "menu")

  analysis.focus()
  await user.keyboard("{ArrowDown}")
  expect(screen.getByRole("menu", { name: "분석" })).toBeVisible()
  expect(screen.getByRole("menuitem", { name: "점검 Gap 그래프" })).toHaveFocus()

  await user.keyboard("{ArrowDown}")
  expect(screen.getByRole("menuitem", { name: "API·입력 차이" })).toHaveFocus()
  await user.keyboard("{ArrowUp}")
  expect(screen.getByRole("menuitem", { name: "점검 Gap 그래프" })).toHaveFocus()
  await user.keyboard("{End}")
  expect(screen.getByRole("menuitem", { name: "취약점 시나리오" })).toHaveFocus()
  await user.keyboard("{Home}")
  expect(screen.getByRole("menuitem", { name: "점검 Gap 그래프" })).toHaveFocus()
})

it("visually marks the active direct inspection route", () => {
  render(<WorkspaceNavigation route="inspection" />)

  expect(screen.getByRole("link", { name: "점검" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "점검" })).toHaveClass("bg-emerald-400/10", "text-emerald-300")
})
