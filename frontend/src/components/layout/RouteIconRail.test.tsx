import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { appRoutes } from "@/app/routes"
import { RouteIconRail } from "./RouteIconRail"

it("keeps all route links available and marks the active rail route", () => {
  render(<RouteIconRail route="matrix" />)

  const navigation = screen.getByRole("navigation", { name: "주요 분석 탐색" })
  for (const route of appRoutes) expect(screen.getByRole("link", { name: route.label })).toBeVisible()
  expect(screen.getByRole("link", { name: "권한 매트릭스" })).toHaveAttribute("aria-current", "page")
  expect(navigation).toContainElement(screen.getByRole("link", { name: "대시보드" }))
})

it("announces a secondary active route before the compact route menu opens", () => {
  render(<RouteIconRail route="matrix" />)

  const activeRoute = screen.getByRole("button", { name: "권한 매트릭스" })
  expect(activeRoute).toHaveAttribute("aria-current", "page")
  expect(screen.queryByRole("menu", { name: "분석 경로" })).not.toBeInTheDocument()
})
