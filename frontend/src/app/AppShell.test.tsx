import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { AppShell } from "./AppShell"
import { AppProviders } from "./AppProviders"
import { appRoutes, navigationGroups, type NavigationGroup } from "./routes"

for (const route of appRoutes) {
  it(`${route.route} uses the reference frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)

    expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
    expect(screen.getByRole("navigation", { name: "FlowScope 작업 탐색" })).toBeVisible()
    expect(screen.getByRole("main")).toBeVisible()
    const group = (navigationGroups as readonly NavigationGroup[]).find((item) => item.routes.includes(route.route))!
    const activeControl = group.kind === "link"
      ? screen.getByRole("link", { name: group.label })
      : screen.getByRole("button", { name: group.label })
    expect(activeControl).toHaveAttribute("aria-current", "page")
    expect(document.documentElement).toHaveClass("flowscope-density-90")
  })
}
