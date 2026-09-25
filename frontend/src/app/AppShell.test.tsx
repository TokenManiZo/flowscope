import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { AppShell } from "./AppShell"
import { AppProviders } from "./AppProviders"
import { appRoutes, navigationGroups, primaryNavRoutes, routeLabel, type AppRoute, type NavigationGroup } from "./routes"

for (const route of appRoutes) {
  it(`${route.route} uses the sidebar frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)

    expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
    expect(screen.getByRole("main")).toBeVisible()
    expect(screen.getByRole("button", { name: /모드로 전환/ })).toBeVisible()
    expect(document.documentElement).toHaveClass("flowscope-density-90")

    const inSidebar = (primaryNavRoutes as readonly AppRoute[]).includes(route.route)
      || (navigationGroups as readonly NavigationGroup[]).some((group) => group.routes.includes(route.route))
    if (!inSidebar) {
      // 사이드바에서 숨긴 화면(홈·대시보드·흐름 순서)은 탐색 링크가 없다. 대시보드는 FlowScope 로고로 진입한다.
      expect(screen.queryByRole("link", { name: routeLabel(route.route) })).not.toBeInTheDocument()
      return
    }
    expect(screen.getByRole("link", { name: routeLabel(route.route) })).toHaveAttribute("aria-current", "page")
  })
}

it("opens on home with the start hero when the hash is empty", () => {
  render(<AppProviders><AppShell route={undefined} /></AppProviders>)
  expect(screen.getByRole("heading", { name: "점검을 시작하세요" })).toBeVisible()
  // 대시보드 항목은 사이드바에서 제거됐고, FlowScope 로고가 대시보드로 이동한다.
  expect(screen.queryByRole("link", { name: "대시보드" })).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "FlowScope 대시보드로 이동" })).toHaveAttribute("href", "#dashboard")
})

it("shows the dashboard without the home hero on #dashboard", () => {
  render(<AppProviders><AppShell route="dashboard" /></AppProviders>)
  expect(screen.getByRole("main")).toBeVisible()
  expect(screen.queryByRole("heading", { name: "점검을 시작하세요" })).not.toBeInTheDocument()
})
