import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ReferenceAnalysisWorkspace } from "./ReferenceAnalysisWorkspace"

function setViewport(width: number) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("1279") && width < 1280,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
}

function Workspace({ contextOpen, inspectorOpen }: { contextOpen?: boolean; inspectorOpen?: boolean }) {
  return <ReferenceAnalysisWorkspace
    ariaLabel="공유 분석 작업면"
    context={<button type="button">공유 필터</button>}
    toolbar={<p>도구 모음</p>}
    inspector={<p>선택한 관측 기록</p>}
    contextOpen={contextOpen}
    inspectorOpen={inspectorOpen}
  >
    <p>분석 결과</p>
  </ReferenceAnalysisWorkspace>
}

it("keeps the desktop context, flexible work surface, and inspector as persistent landmarks", () => {
  setViewport(1280)

  render(<Workspace />)

  const context = screen.getByRole("complementary", { name: "분석 필터" })
  const workbench = screen.getByRole("region", { name: "공유 분석 작업면" })
  const inspector = screen.getByRole("complementary", { name: "선택 상세" })
  expect(context).toHaveTextContent("공유 필터")
  expect(workbench).toHaveTextContent("도구 모음")
  expect(workbench).toHaveTextContent("분석 결과")
  expect(inspector).toHaveTextContent("선택한 관측 기록")
  expect(workbench.parentElement).toHaveClass("xl:flex-row")
  expect(context).toHaveStyle({ width: "264px" })
  expect(inspector).toHaveStyle({ width: "368px" })
  expect(screen.getByRole("separator", { name: "분석 필터 너비 조절" })).toHaveAttribute("aria-valuenow", "264")
  expect(screen.getByRole("separator", { name: "선택 상세 너비 조절" })).toHaveAttribute("aria-valuenow", "368")
  expect(workbench).toHaveClass("min-w-0", "overflow-y-auto")
  expect(workbench).toHaveAttribute("tabindex", "0")
  expect(context).toHaveClass("overflow-y-auto")
  expect(inspector).toHaveClass("overflow-y-auto")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("collapses and restores desktop panes without unmounting the analysis result", async () => {
  setViewport(1920)
  const user = userEvent.setup()
  render(<Workspace inspectorOpen />)
  const result = screen.getByText("분석 결과")

  await user.click(screen.getByRole("button", { name: "분석 필터 패널 접기" }))
  await user.click(screen.getByRole("button", { name: "선택 상세 패널 접기" }))
  expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(screen.getByText("분석 결과")).toBe(result)

  expect(screen.queryByRole("separator", { name: "분석 필터 너비 조절" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "분석 필터 패널 열기" }))
  await user.click(screen.getByRole("button", { name: "선택 상세 패널 열기" }))
  expect(screen.getByRole("complementary", { name: "분석 필터" })).toHaveTextContent("공유 필터")
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toHaveTextContent("선택한 관측 기록")
})

it.each([900, 600])("renders compact Sheet controls and constrained panel widths at %ipx", async (width) => {
  setViewport(width)
  const onContextOpenChange = vi.fn()
  const onInspectorOpenChange = vi.fn()

  render(<ReferenceAnalysisWorkspace
    ariaLabel="공유 분석 작업면"
    context={<button type="button">공유 필터</button>}
    toolbar={<p>도구 모음</p>}
    inspector={<p>선택한 관측 기록</p>}
    onContextOpenChange={onContextOpenChange}
    onInspectorOpenChange={onInspectorOpenChange}
  >
    <p>분석 결과</p>
  </ReferenceAnalysisWorkspace>)

  const user = userEvent.setup()
  const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  expect(screen.getByRole("region", { name: "공유 분석 작업면" })).toHaveClass("min-w-0")
  await user.click(contextTrigger)
  expect(onContextOpenChange).toHaveBeenCalledWith(true)
  const contextDialog = screen.getByRole("dialog", { name: "분석 필터" })
  expect(contextDialog).toHaveClass("w-[min(22rem,90vw)]")
  await user.click(within(contextDialog).getByRole("button", { name: "Close" }))
  await user.click(inspectorTrigger)
  expect(onInspectorOpenChange).toHaveBeenCalledWith(true)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveClass("w-[min(26rem,90vw)]")
})

it("keeps both compact Sheet presentations closed until their explicit controls are used", () => {
  setViewport(600)

  render(<Workspace />)

  expect(screen.getByRole("button", { name: "분석 필터 열기" })).toBeVisible()
  expect(screen.getByRole("button", { name: "선택 상세 열기" })).toBeVisible()
  expect(screen.queryByRole("dialog", { name: "분석 필터" })).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "공유 분석 작업면" })).toHaveClass("min-w-0")
})

it("uses exact Sheet descriptions and restores focus to compact triggers after closing", async () => {
  setViewport(900)
  const user = userEvent.setup()

  const { rerender } = render(<Workspace inspectorOpen />)

  const inspectorDialog = screen.getByRole("dialog", { name: "선택 상세" })
  expect(within(inspectorDialog).getByText("선택한 항목의 상세 정보를 확인합니다.")).toBeInTheDocument()
  rerender(<Workspace />)
  const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
  await user.click(contextTrigger)
  const contextDialog = screen.getByRole("dialog", { name: "분석 필터" })
  expect(within(contextDialog).getByText("현재 분석 결과에 적용할 필터를 선택합니다.")).toBeInTheDocument()
  await user.click(within(contextDialog).getByRole("button", { name: "Close" }))
  expect(contextTrigger).toHaveFocus()
})

it("keeps a persistent desktop inspector open when the selection clears, so the canvas width never changes", () => {
  setViewport(1440)
  const tree = (open: boolean, persistent: boolean) => <ReferenceAnalysisWorkspace ariaLabel="그래프" context={null} inspector={<p>요약</p>} inspectorOpen={open} inspectorPersistent={persistent}><p>캔버스</p></ReferenceAnalysisWorkspace>
  const { rerender } = render(tree(false, true))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  rerender(tree(true, true))
  rerender(tree(false, true))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  rerender(tree(false, false))
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
})

it("leaves a visible filter strip with the active filter count after the left pane is collapsed, and reopens from it", async () => {
  setViewport(1920)
  const user = userEvent.setup()
  render(<ReferenceAnalysisWorkspace ariaLabel="공유 분석 작업면" context={<button type="button">공유 필터</button>} contextBadge={2} inspector={<p>상세</p>}><p>분석 결과</p></ReferenceAnalysisWorkspace>)
  // 접기 버튼은 마우스를 올리지 않아도 보인다.
  expect(screen.getByRole("button", { name: "분석 필터 패널 접기" })).not.toHaveClass("opacity-0")
  await user.click(screen.getByRole("button", { name: "분석 필터 패널 접기" }))
  expect(screen.queryByRole("button", { name: "공유 필터" })).not.toBeInTheDocument()
  const reopen = screen.getByRole("button", { name: /분석 필터 패널 열기/ })
  expect(within(reopen).getByLabelText("켜 둔 필터 2개")).toHaveTextContent("2")
  await user.click(reopen)
  expect(screen.getByRole("button", { name: "공유 필터" })).toBeVisible()
})
