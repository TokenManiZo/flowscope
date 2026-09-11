import { render, screen, within } from "@testing-library/react"
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

it("shows each route's Korean label as visible desktop rail text, not only an accessible name", () => {
  render(<RouteIconRail route="matrix" />)

  const rail = screen.getByRole("navigation", { name: "주요 분석 탐색" })
  // 비활성 route 라벨은 접힌 모바일 트리거에 없으므로 데스크톱 rail의 가시 텍스트로만 존재한다.
  expect(within(rail).getByText("대시보드")).toBeVisible()
  expect(within(rail).getByText("권한 매트릭스")).toBeVisible()
  expect(within(rail).getByText("공격면 그래프")).toBeVisible()
})
