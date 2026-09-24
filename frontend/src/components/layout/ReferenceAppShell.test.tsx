import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ReferenceAppShell } from "./ReferenceAppShell"

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: undefined }),
  useHumanRunQuery: () => ({ data: undefined }),
  useZapStatusQuery: () => ({ data: undefined }),
  useScannerRunQuery: () => ({ data: undefined }),
  useProjectsQuery: () => ({ data: undefined, isPending: false }),
  useOpenProjectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useResetProjectTrafficMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProjectMutation: () => ({ mutate: vi.fn(), isPending: false }),
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

it("shows icons only until hover, then overlays full labels without resizing the content", async () => {
  const user = userEvent.setup()
  render(<ReferenceAppShell route="surface"><p>content</p></ReferenceAppShell>)
  const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })
  const rail = nav.closest("[data-expanded]") as HTMLElement

  expect(rail).toHaveAttribute("data-expanded", "false")
  expect(rail.parentElement).toHaveClass("w-14")
  const graph = within(nav).getByRole("link", { name: "점검 Gap 그래프" })
  expect(within(graph).getByText("점검 Gap 그래프")).toHaveClass("sr-only")
  // 현재 화면이 부가기능이면 접힌 막대에서도 링크와 현재 위치는 남기되 시각적으로만 숨긴다.
  expect(within(nav).getByRole("link", { name: "API·입력 차이" }).parentElement).toHaveClass("sr-only")

  await user.hover(rail)
  expect(rail).toHaveAttribute("data-expanded", "true")
  expect(rail).toHaveClass("absolute", "w-60")
  expect(rail.parentElement).toHaveClass("w-14")
  expect(within(graph).getByText("점검 Gap 그래프")).not.toHaveClass("sr-only")
  expect(within(nav).getByRole("link", { name: "API·입력 차이" })).toHaveAttribute("aria-current", "page")
  expect(within(nav).getByRole("link", { name: "API·입력 차이" }).parentElement).not.toHaveClass("sr-only")

  await user.click(graph)
  await user.unhover(rail)
  expect(rail).toHaveAttribute("data-expanded", "false")
  expect(graph).not.toHaveFocus()
})

it("expands for keyboard focus and collapses when focus leaves", async () => {
  const user = userEvent.setup()
  render(<ReferenceAppShell route="matrix"><button type="button">본문 버튼</button></ReferenceAppShell>)
  const rail = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" }).closest("[data-expanded]") as HTMLElement

  await user.tab()
  expect(rail).toHaveAttribute("data-expanded", "true")
  act(() => screen.getByRole("button", { name: "본문 버튼" }).focus())
  expect(rail).toHaveAttribute("data-expanded", "false")
})

it("keeps core screens as direct links and groups the rest under 부가기능", async () => {
  const user = userEvent.setup()
  render(<ReferenceAppShell route="inspection"><p>content</p></ReferenceAppShell>)
  const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })

  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#inspection", "#accounts", "#graph", "#verification", "#matrix"])
  expect(within(nav).queryByRole("link", { name: "대시보드" })).not.toBeInTheDocument()
  const extras = within(nav).getByRole("button", { name: "부가기능" })
  expect(extras).toHaveAttribute("aria-expanded", "false")
  await user.click(extras)
  expect(extras).toHaveAttribute("aria-expanded", "true")
  expect(within(nav).getAllByRole("link").slice(5).map((link) => link.getAttribute("href"))).toEqual(["#surface", "#scenarios", "#evidence", "#runs"])
})
