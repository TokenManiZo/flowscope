import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { AppShell } from "./AppShell"
import { AppProviders } from "./AppProviders"
import { appRoutes, navigationGroups, primaryNavigationRoutes, routeLabel, type AppRoute, type NavigationGroup } from "./routes"

for (const route of appRoutes) {
  it(`${route.route} uses the sidebar frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)

    expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
    expect(screen.getByRole("main")).toBeVisible()
    expect(screen.getByRole("button", { name: /모드로 전환/ })).toBeVisible()
    expect(document.documentElement).toHaveClass("flowscope-density-90")

    const primary = (primaryNavigationRoutes as readonly AppRoute[]).includes(route.route)
    const group = (navigationGroups as readonly NavigationGroup[]).find((item) => item.routes.includes(route.route))
    if (primary || group) {
      // 접힌 아이콘 막대에서도 링크의 접근 이름은 화면 이름 그대로다. 부가기능은 현재 화면일 때 드롭다운 링크가 존재한다.
      expect(screen.getByRole("link", { name: routeLabel(route.route) })).toHaveAttribute("aria-current", "page")
    } else {
      // Home·대시보드·흐름 순서는 사이드바 링크가 없다(Home은 로고, 대시보드는 Home 본문, 흐름 순서는 주소 전용).
      expect(screen.queryByRole("link", { name: routeLabel(route.route) })).not.toBeInTheDocument()
    }
  })
}

it("opens on home with the start hero when the hash is empty", () => {
  render(<AppProviders><AppShell route={undefined} /></AppProviders>)
  expect(screen.getByRole("heading", { name: "점검을 시작하세요" })).toBeVisible()
  // Home과 대시보드는 사이드바 항목이 없다.
  expect(screen.queryByRole("link", { name: "대시보드" })).not.toBeInTheDocument()
})

it("shows the dashboard without the home hero on #dashboard", () => {
  render(<AppProviders><AppShell route="dashboard" /></AppProviders>)
  expect(screen.getByRole("heading", { name: "보안 점검 대시보드" })).toBeVisible()
  expect(screen.queryByRole("heading", { name: "점검을 시작하세요" })).not.toBeInTheDocument()
})
