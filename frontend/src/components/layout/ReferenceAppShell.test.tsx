import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { ReferenceAppShell } from "./ReferenceAppShell"

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: undefined }),
  useHumanRunQuery: () => ({ data: undefined }),
  useZapStatusQuery: () => ({ data: undefined }),
  useScannerRunQuery: () => ({ data: undefined }),
  useProjectsQuery: () => ({ data: undefined, isPending: false }),
  useOpenProjectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useStartProjectMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

it("uses the status bar, grouped sidebar navigation, and viewport landmark around route content", () => {
  render(<ReferenceAppShell route="evidence"><p>Evidence workspace</p></ReferenceAppShell>)

  expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
  expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
  expect(screen.queryByRole("navigation", { name: "주요 분석 탐색" })).not.toBeInTheDocument()
  expect(screen.getByRole("main")).toHaveTextContent("Evidence workspace")
})

it("keeps route content in the main landmark", () => {
  render(<ReferenceAppShell route="matrix"><p>권한 매트릭스 workspace</p></ReferenceAppShell>)

  expect(screen.getByRole("main")).toHaveTextContent("권한 매트릭스 workspace")
})
