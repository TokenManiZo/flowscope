import { createRef, useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { GraphSearchInput } from "./GraphSearchInput"
import { buildGraphSearchIndex as snapshotSearchIndex, searchGraph } from "./graphSearch"
import { initialGraphNavigation } from "./graphWorkspace"

import { targetSnapshot } from "@/test/fixtures"
import type { Cell } from "@/lib/api/types"

const buildGraphSearchIndex = (cells: readonly Cell[]) => snapshotSearchIndex(targetSnapshot({ cells: [...cells] }), { source: ["human", "scanner", "llm", "unknown"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
const canvas = createRef<HTMLDivElement>()
const index = buildGraphSearchIndex([{ idn: "USER A", op: "GET /orders/101", resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["e-1"] }])
const results = searchGraph(index, "orders", initialGraphNavigation)

afterEach(() => { cleanup(); delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement })

it("supports arrow/Enter selection in a portal and clearing without requesting a new selection", async () => {
  const choose = vi.fn()
  function Harness() {
    const [query, setQuery] = useState("orders")
    return <GraphSearchInput query={query} results={query ? results : { entries: [], keys: new Set(), total: 0 }} disabled={false} searching={false} canvas={canvas} onQuery={setQuery} onMore={vi.fn()} onChoose={choose} />
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
  const { rerender } = render(<GraphSearchInput {...props} />)
  const input = screen.getByRole("combobox")
  await userEvent.click(input)
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "Enter", isComposing: true })
  expect(choose).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(input, { key: "f", ctrlKey: true })).toBe(true)
  rerender(<GraphSearchInput {...props} disabled />)
  fireEvent.keyDown(input, { key: "Enter" })
  expect(choose).not.toHaveBeenCalled()
  expect(screen.getByRole("status")).toHaveTextContent("마지막 조회 결과")
})

it("uses the ordinary empty state when refreshed results disappear", async () => {
  const props = { query: "orders", results, disabled: false, searching: false, canvas, onQuery: vi.fn(), onMore: vi.fn(), onChoose: vi.fn() }
  const { rerender } = render(<GraphSearchInput {...props} />)
  await userEvent.click(screen.getByRole("combobox"))
  rerender(<GraphSearchInput {...props} results={{ entries: [], keys: new Set(), total: 0 }} />)
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
  expect(screen.getByText("검색 결과가 없습니다. 검색어를 바꿔 보세요.")).toBeVisible()
  expect(screen.queryByText(/소멸|없어졌/)).not.toBeInTheDocument()
})

it("shows a host only for duplicate names across the full match set, beyond the display limit", async () => {
  const cells = ["https://first.example.test:8900", "https://second.example.test:8900"].map(service => ({ idn: "USER A", op: `${service} GET /orders/101`, resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["e-1"] }))
  const all = buildGraphSearchIndex(cells)
  const limited = searchGraph(all, "GET /orders/101", initialGraphNavigation, 1)
  expect(limited.entries).toHaveLength(1)
  expect(limited.hosts?.get(limited.entries[0].key)).toBe("first.example.test:8900")
  render(<GraphSearchInput query="GET /orders/101" results={limited} disabled={false} searching={false} canvas={canvas} onQuery={vi.fn()} onMore={vi.fn()} onChoose={vi.fn()} />)
  await userEvent.click(screen.getByRole("combobox"))
  const option = screen.getByRole("option")
  expect(option).toHaveAttribute("aria-label", "API GET /orders/101 first.example.test:8900")
  expect(option.textContent).not.toContain("https://")
  expect(option).toHaveAttribute("aria-description", expect.stringContaining("https://first.example.test:8900"))
  expect(results.hosts?.size ?? 0).toBe(0)
})
