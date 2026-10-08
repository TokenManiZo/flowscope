import { render, screen, within } from "@testing-library/react"
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
  useUpdateProjectMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

it("uses grouped sidebar navigation with project status and the main landmark, without a top status bar", () => {
  render(<ReferenceAppShell route="evidence"><p>요청 기록 workspace</p></ReferenceAppShell>)

  expect(screen.queryByRole("banner", { name: "FlowScope 상단 상태" })).not.toBeInTheDocument()
  expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
  expect(within(screen.getByRole("group", { name: "현재 프로젝트" })).getByRole("button", { name: "실시간 상태" })).toBeVisible()
  expect(screen.queryByRole("navigation", { name: "주요 분석 탐색" })).not.toBeInTheDocument()
  expect(screen.getByRole("main")).toHaveTextContent("요청 기록 workspace")
})

it("keeps route content in the main landmark", () => {
  render(<ReferenceAppShell route="matrix"><p>권한 매트릭스 workspace</p></ReferenceAppShell>)

  expect(screen.getByRole("main")).toHaveTextContent("권한 매트릭스 workspace")
})

it("stays an icon rail on hover and expands only through the toggle button, pushing the content", async () => {
  localStorage.clear()
  const user = userEvent.setup()
  render(<ReferenceAppShell route="matrix"><p>content</p></ReferenceAppShell>)
  const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })
  expect(within(nav).queryByRole("link", { name: "교차 계정 검증" })).not.toBeInTheDocument()
  const rail = nav.closest("[data-expanded]") as HTMLElement
  const graph = within(nav).getByRole("link", { name: "점검 Gap 그래프" })

  expect(rail).toHaveAttribute("data-expanded", "false")
  expect(rail).toHaveClass("w-14")
  expect(rail).not.toHaveClass("absolute")
  expect(within(graph).getByText("점검 Gap 그래프")).toHaveClass("sr-only")
  expect(graph).toHaveAttribute("title", "점검 Gap 그래프")
  for (const name of ["판정 매트릭스", "요청 기록"]) {
    const link = within(nav).getByRole("link", { name })
    expect(link.parentElement).not.toHaveClass("sr-only")
    expect(link).toHaveAttribute("title", name)
    expect(within(link).getByText(name)).toHaveClass("sr-only")
  }

  await user.hover(rail)
  expect(rail).toHaveAttribute("data-expanded", "false")

  await user.click(screen.getByRole("button", { name: "사이드바 펼치기" }))
  expect(rail).toHaveAttribute("data-expanded", "true")
  expect(rail).toHaveClass("w-60")
  expect(within(graph).getByText("점검 Gap 그래프")).not.toHaveClass("sr-only")
  expect(within(nav).getByRole("link", { name: "판정 매트릭스" })).toHaveAttribute("aria-current", "page")
  expect(localStorage.getItem("flowscope.sidebar")).toBe("open")

  await user.click(screen.getByRole("button", { name: "사이드바 접기" }))
  expect(rail).toHaveAttribute("data-expanded", "false")
  expect(localStorage.getItem("flowscope.sidebar")).toBe("closed")
})

it("remembers the expanded sidebar and toggles it with Cmd/Ctrl+B outside text fields", async () => {
  localStorage.setItem("flowscope.sidebar", "open")
  const user = userEvent.setup()
  render(<ReferenceAppShell route="matrix"><input aria-label="검색" /></ReferenceAppShell>)
  const rail = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" }).closest("[data-expanded]") as HTMLElement

  expect(rail).toHaveAttribute("data-expanded", "true")
  await user.keyboard("{Control>}b{/Control}")
  expect(rail).toHaveAttribute("data-expanded", "false")
  await user.click(screen.getByRole("textbox", { name: "검색" }))
  await user.keyboard("{Control>}b{/Control}")
  expect(rail).toHaveAttribute("data-expanded", "false")
  localStorage.clear()
})

it("shows every inspection screen as a direct link without an extras group", () => {
  localStorage.setItem("flowscope.sidebar", "open")
  render(<ReferenceAppShell route="inspection"><p>content</p></ReferenceAppShell>)
  const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })
  expect(within(nav).queryByRole("link", { name: "교차 계정 검증" })).not.toBeInTheDocument()
  expect(within(nav).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["#inspection", "#accounts", "#graph", "#matrix", "#evidence"])
  expect(within(nav).queryByRole("button", { name: "부가 기능" })).not.toBeInTheDocument()
  localStorage.clear()
})

it("exposes all extra routes in the collapsed rail even on a core screen", () => {
  localStorage.clear()
  render(<ReferenceAppShell route="inspection"><p>content</p></ReferenceAppShell>)
  const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })
  expect(within(nav).queryByRole("link", { name: "교차 계정 검증" })).not.toBeInTheDocument()
  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#inspection", "#accounts", "#graph", "#matrix", "#evidence"])
  expect(within(nav).queryByRole("button", { name: "부가 기능" })).not.toBeInTheDocument()
})
