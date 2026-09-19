import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { AppShell } from "./AppShell"
import { AppProviders } from "./AppProviders"
import { appRoutes, navigationGroups, routeLabel, type NavigationGroup } from "./routes"

for (const route of appRoutes) {
  it(`${route.route} uses the sidebar frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)

    expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
    expect(screen.getByRole("main")).toBeVisible()
    expect(screen.getByRole("button", { name: /모드로 전환/ })).toBeVisible()
    expect(document.documentElement).toHaveClass("flowscope-density-90")

    const group = (navigationGroups as readonly NavigationGroup[]).find((item) => item.routes.includes(route.route))
    if (!group) {
      if (route.route === "dashboard") {
        expect(screen.getByRole("link", { name: "대시보드" })).toHaveAttribute("aria-current", "page")
      } else {
        // 사이드바에서 숨긴 화면(흐름 순서)은 탐색 링크가 없어야 한다.
        expect(screen.queryByRole("link", { name: routeLabel(route.route) })).not.toBeInTheDocument()
      }
      return
    }
    expect(screen.getByRole("link", { name: routeLabel(route.route) })).toHaveAttribute("aria-current", "page")
  })
}

it("opens on the dashboard when the hash is empty", () => {
  render(<AppProviders><AppShell route={undefined} /></AppProviders>)
  expect(screen.getByRole("link", { name: "대시보드" })).toHaveAttribute("aria-current", "page")
})
