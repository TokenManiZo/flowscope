import { createRef, useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { GraphSearch } from "./GraphSearch"
import { buildGraphSearchIndex, searchGraph } from "./graphSearch"
import { initialGraphNavigation } from "./graphWorkspace"

const canvas = createRef<HTMLDivElement>()
const index = buildGraphSearchIndex([{ idn: "USER A", op: "GET /orders/101", resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["e-1"] }])
const results = searchGraph(index, "orders", initialGraphNavigation)

afterEach(() => { cleanup(); delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement })

it("supports arrow/Enter selection in a portal and clearing without requesting a new selection", async () => {
  const choose = vi.fn()
  function Harness() {
    const [query, setQuery] = useState("orders")
    return <GraphSearch query={query} results={query ? results : { entries: [], keys: new Set(), total: 0 }} disabled={false} searching={false} canvas={canvas} onQuery={setQuery} onMore={vi.fn()} onChoose={choose} />
  }
  const { container } = render(<Harness />)
  const input = screen.getByRole("combobox")
  await userEvent.click(input)
  expect(container.querySelector('[role="listbox"]')).toBeNull()
  fireEvent.keyDown(input, { key: "ArrowDown" })
  expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(input, { key: "Enter" })
  expect(choose).toHaveBeenCalledWith(results.entries[0])
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "노드 검색 지우기" }))
  expect(input).toHaveValue("")
  expect(choose).toHaveBeenCalledTimes(1)
})

it("does not select during IME composition or stale data and leaves browser find alone", async () => {
  const choose = vi.fn()
  const props = { query: "orders", results, disabled: false, searching: false, canvas, onQuery: vi.fn(), onMore: vi.fn(), onChoose: choose }
  const { rerender } = render(<GraphSearch {...props} />)
  const input = screen.getByRole("combobox")
  await userEvent.click(input)
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "Enter", isComposing: true })
  expect(choose).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(input, { key: "f", ctrlKey: true })).toBe(true)
  rerender(<GraphSearch {...props} disabled />)
  fireEvent.keyDown(input, { key: "Enter" })
  expect(choose).not.toHaveBeenCalled()
  expect(screen.getByRole("status")).toHaveTextContent("마지막 조회 결과")
})

it("uses the ordinary empty state when refreshed results disappear", async () => {
  const props = { query: "orders", results, disabled: false, searching: false, canvas, onQuery: vi.fn(), onMore: vi.fn(), onChoose: vi.fn() }
  const { rerender } = render(<GraphSearch {...props} />)
  await userEvent.click(screen.getByRole("combobox"))
  rerender(<GraphSearch {...props} results={{ entries: [], keys: new Set(), total: 0 }} />)
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
  expect(screen.getByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")).toBeVisible()
  expect(screen.queryByText(/소멸|없어졌/)).not.toBeInTheDocument()
})
