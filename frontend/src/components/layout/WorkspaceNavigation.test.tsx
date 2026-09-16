import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { WorkspaceNavigation } from "./WorkspaceNavigation"

it("keeps frequent graph, inspection, and account routes directly reachable", async () => {
  render(<WorkspaceNavigation route="graph" />)

  expect(screen.getAllByRole("button", { name: /분석|기록/ })).toHaveLength(2)
  expect(screen.getByRole("link", { name: "점검 Gap 그래프" })).toHaveAttribute("href", "#graph")
  expect(screen.getByRole("link", { name: "점검" })).toHaveAttribute("href", "#inspection")
  expect(screen.getByRole("link", { name: "계정·세션" })).toHaveAttribute("href", "#accounts")

  await userEvent.click(screen.getByRole("button", { name: "분석" }))
  for (const label of ["API·입력 차이", "대시보드", "권한 매트릭스", "흐름 순서", "취약점 시나리오"]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeVisible()
  }
  expect(screen.queryByRole("menuitem", { name: "점검 Gap 그래프" })).not.toBeInTheDocument()

  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "기록" }))
  for (const label of ["Evidence", "실행 상태", "LLM Explorer"]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeVisible()
  }
  expect(screen.queryByRole("menuitem", { name: "계정·세션" })).not.toBeInTheDocument()
})

it("uses menu trigger semantics and supports keyboard navigation through grouped routes", async () => {
  const user = userEvent.setup()
  render(<WorkspaceNavigation route="graph" />)

  const analysis = screen.getByRole("button", { name: "분석" })
  expect(analysis).toHaveAttribute("aria-haspopup", "menu")

  analysis.focus()
  await user.keyboard("{ArrowDown}")
  expect(screen.getByRole("menu", { name: "분석" })).toBeVisible()
  expect(screen.getByRole("menuitem", { name: "API·입력 차이" })).toHaveFocus()

  await user.keyboard("{ArrowDown}")
  expect(screen.getByRole("menuitem", { name: "대시보드" })).toHaveFocus()
  await user.keyboard("{ArrowUp}")
  expect(screen.getByRole("menuitem", { name: "API·입력 차이" })).toHaveFocus()
  await user.keyboard("{End}")
  expect(screen.getByRole("menuitem", { name: "취약점 시나리오" })).toHaveFocus()
  await user.keyboard("{Home}")
  expect(screen.getByRole("menuitem", { name: "API·입력 차이" })).toHaveFocus()
})

it("visually marks an active direct route", () => {
  render(<WorkspaceNavigation route="inspection" />)

  expect(screen.getByRole("link", { name: "점검" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "점검" })).toHaveClass("bg-emerald-400/10", "text-emerald-300")
})
