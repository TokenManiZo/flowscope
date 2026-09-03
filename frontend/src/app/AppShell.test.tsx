import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { AppShell } from "./AppShell"
import { AppProviders } from "./AppProviders"
import { appRoutes } from "./routes"

for (const route of appRoutes) {
  it(`${route.route} uses the reference frame`, () => {
    render(<AppProviders><AppShell route={route.route} /></AppProviders>)

    expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
    expect(screen.getByRole("navigation", { name: "주요 분석 탐색" })).toBeVisible()
    expect(screen.getByRole("main")).toBeVisible()
    expect(screen.getByRole("link", { name: route.label })).toHaveAttribute("aria-current", "page")
    expect(document.documentElement).toHaveClass("flowscope-density-90")
  })
}
