import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { PaneResizeHandle } from "./PaneResizeHandle"

it("resizes a left pane by keyboard and clamps it to the declared bounds", async () => {
  const onWidthChange = vi.fn()
  const user = userEvent.setup()
  render(<PaneResizeHandle side="left" label="점검 우선순위" width={232} min={192} max={400} onWidthChange={onWidthChange} onCollapse={vi.fn()} />)
  const separator = screen.getByRole("separator", { name: "점검 우선순위 너비 조절" })

  separator.focus()
  await user.keyboard("{ArrowRight}{ArrowLeft}{Home}{End}")

  expect(onWidthChange.mock.calls.map(([width]) => width)).toEqual([248, 216, 192, 400])
  expect(separator).toHaveAttribute("aria-valuemin", "192")
  expect(separator).toHaveAttribute("aria-valuemax", "400")
})

it("reverses keyboard direction for a right pane", async () => {
  const onWidthChange = vi.fn()
  const user = userEvent.setup()
  render(<PaneResizeHandle side="right" label="선택 상세" width={368} min={288} max={500} onWidthChange={onWidthChange} onCollapse={vi.fn()} />)

  screen.getByRole("separator").focus()
  await user.keyboard("{ArrowLeft}{ArrowRight}")

  expect(onWidthChange.mock.calls.map(([width]) => width)).toEqual([384, 352])
})

it("resizes from a captured pointer and keeps the result within bounds", () => {
  const onWidthChange = vi.fn()
  render(<PaneResizeHandle side="left" label="분석 필터" width={264} min={224} max={300} onWidthChange={onWidthChange} onCollapse={vi.fn()} />)
  const separator = screen.getByRole("separator")
  Object.defineProperty(separator, "setPointerCapture", { configurable: true, value: vi.fn() })
  Object.defineProperty(separator, "hasPointerCapture", { configurable: true, value: () => true })

  fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
  fireEvent.pointerMove(separator, { pointerId: 1, clientX: 180 })

  expect(onWidthChange).toHaveBeenCalledWith(300)
})

it("turns a collapsed edge rail into an explicit expand control", async () => {
  const onExpand = vi.fn()
  render(<PaneResizeHandle side="left" label="분석 필터" width={264} min={64} max={800} collapsed onWidthChange={vi.fn()} onCollapse={vi.fn()} onExpand={onExpand} />)

  expect(screen.queryByRole("separator")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "분석 필터 패널 열기" }))
  expect(onExpand).toHaveBeenCalledOnce()
})

it("uses the visible edge control to collapse without a native tooltip", async () => {
  const onCollapse = vi.fn()
  render(<PaneResizeHandle side="left" label="점검 우선순위" width={232} min={64} max={800} onWidthChange={vi.fn()} onCollapse={onCollapse} />)

  const button = screen.getByRole("button", { name: "점검 우선순위 패널 접기" })
  expect(button).not.toHaveAttribute("title")
  await userEvent.click(button)
  expect(onCollapse).toHaveBeenCalledOnce()
})

it("keeps the toggle button clickable across its whole area and draws no colored boundary", () => {
  render(<PaneResizeHandle side="right" label="선택 상세" width={368} min={288} max={500} onWidthChange={vi.fn()} onCollapse={vi.fn()} />)
  const toggle = screen.getByRole("button", { name: "선택 상세 패널 접기" })
  // Button의 active:translate-y-px가 translate 가운데 정렬을 덮으면 누르는 순간 버튼이 튀어 클릭이 사라진다.
  expect(toggle.className).not.toMatch(/-translate-[xy]-1\/2/)
  const handle = toggle.parentElement as HTMLElement
  expect(handle.className).not.toMatch(/emerald/)
  expect(screen.getByRole("separator", { name: "선택 상세 너비 조절" })).toHaveClass("cursor-col-resize", "inset-0")
})

it("expands the right pane by dragging left and releases the pointer on completion", () => {
  const onWidthChange = vi.fn()
  render(<PaneResizeHandle side="right" label="선택 상세" width={420} min={288} max={1000} onWidthChange={onWidthChange} onCollapse={vi.fn()} />)
  const separator = screen.getByRole("separator")
  const release = vi.fn()
  Object.defineProperty(separator, "setPointerCapture", { configurable: true, value: vi.fn() })
  Object.defineProperty(separator, "hasPointerCapture", { configurable: true, value: () => true })
  Object.defineProperty(separator, "releasePointerCapture", { configurable: true, value: release })
  fireEvent.pointerDown(separator, { pointerId: 7, clientX: 900 })
  fireEvent.pointerMove(separator, { pointerId: 7, clientX: 600 })
  expect(onWidthChange).toHaveBeenLastCalledWith(720)
  fireEvent.pointerUp(separator, { pointerId: 7 })
  expect(release).toHaveBeenCalledWith(7)
  expect(separator).toHaveClass("touch-none")
})
