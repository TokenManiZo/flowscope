import { render, screen, within } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { appRoutes } from "@/app/routes"
import { ReferenceAppShell } from "./ReferenceAppShell"

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: undefined }),
  useHumanRunQuery: () => ({ data: undefined }),
  useZapStatusQuery: () => ({ data: undefined }),
  useScannerRunQuery: () => ({ data: undefined }),
}))

it("uses the status bar, route rail, and viewport landmark around route content", () => {
  render(<ReferenceAppShell route="evidence"><p>Evidence workspace</p></ReferenceAppShell>)

  expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
  expect(screen.getByRole("navigation", { name: "주요 분석 탐색" })).toBeVisible()
  expect(screen.getByRole("main")).toHaveTextContent("Evidence workspace")
})

it.each(appRoutes)("keeps the exact active route exposed in the persistent rail for $label", ({ route, label }) => {
  render(<ReferenceAppShell route={route}><p>{label} workspace</p></ReferenceAppShell>)

  const rail = screen.getByRole("navigation", { name: "주요 분석 탐색" })
  expect(within(rail).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("main")).toHaveTextContent(`${label} workspace`)
})
