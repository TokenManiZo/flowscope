import { useState } from "react"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { FocusedGraphWorkspace } from "./FocusedGraphWorkspace"

afterEach(() => vi.unstubAllGlobals())

function viewport(initial: number) {
  let width = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return width <= Number(query.match(/\d+/)?.[0]) }, media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return (next: number) => act(() => { width = next; listeners.forEach(listener => listener()) })
}

function Workspace({ queueInitiallyOpen = true, graphTriggerState = "enabled" }: { queueInitiallyOpen?: boolean; graphTriggerState?: "enabled" | "removed" | "disabled" }) {
  const [queueOpen, setQueueOpen] = useState(queueInitiallyOpen)
  const [selected, setSelected] = useState<string | null>(null)
  return <FocusedGraphWorkspace queueOpen={queueOpen} onQueueOpenChange={setQueueOpen}
    inspectorOpen={selected !== null} onInspectorOpenChange={open => { if (!open) setSelected(null) }}
    queue={<button onClick={() => { setSelected("auth"); setQueueOpen(false) }}>큐에서 auth 선택</button>}
    toolbar={<span>그래프 제어</span>}
    inspector={selected && <section data-gap-id={selected}><button onClick={() => setSelected(null)}>선택 상세 닫기</button></section>}>
    <section aria-label="경로 작업면">{graphTriggerState !== "removed" && <button disabled={graphTriggerState === "disabled"} onClick={() => setSelected("auth")}>경로 auth 선택</button>}</section>
  </FocusedGraphWorkspace>
}

it("keeps the flexible graph mounted while independently hiding queue and selected detail", async () => {
  viewport(1920)
  render(<Workspace />)
  const workspace = screen.getByRole("region", { name: "그래프 중심 점검 작업면" })
  const graph = screen.getByRole("region", { name: "경로 작업면" })
  expect(workspace).toHaveAttribute("data-layout", "focused-graph")
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
  expect(screen.getByRole("separator", { name: "점검 우선순위 너비 조절" })).toBeVisible()
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  expect(screen.getByRole("separator", { name: "선택 상세 너비 조절" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 접기" }))
  expect(screen.queryByRole("complementary", { name: "점검 우선순위" })).not.toBeInTheDocument()
  expect(screen.queryByText("그래프 제어")).not.toBeInTheDocument()
  const edgeExpand = screen.getByRole("button", { name: "점검 우선순위 패널 열기" })
  await userEvent.hover(edgeExpand.parentElement!)
  expect(edgeExpand).toBeVisible()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 닫기" }))
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "경로 작업면" })).toBe(graph)
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 열기" }))
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
})

it("keeps the selected Gap while the desktop inspector is collapsed and restored", async () => {
  viewport(1920)
  render(<Workspace />)
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))

  await userEvent.click(screen.getByRole("button", { name: "선택 상세 패널 접기" }))
  expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 패널 열기" }))

  expect(screen.getByRole("complementary", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
})

it.each([900, 1280, 1439])("keeps a persistent compact queue at %ipx and uses a dismissible inspector sheet", async width => {
  viewport(width)
  render(<Workspace />)
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: "점검 우선순위" })).toBeVisible()
  await waitFor(() => expect(screen.getByRole("button", { name: "경로 auth 선택" })).toHaveFocus())
})

it("returns focus to the queue trigger after the 600px queue selection unmounts its origin", async () => {
  viewport(600)
  render(<Workspace queueInitiallyOpen={false} />)
  const queueTrigger = screen.getByRole("button", { name: "점검 큐 열기" })
  await userEvent.click(queueTrigger)
  const selection = within(screen.getByRole("dialog", { name: "점검 우선순위" })).getByRole("button", { name: "큐에서 auth 선택" })
  await userEvent.click(selection)
  expect(selection).not.toBeInTheDocument()
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await waitFor(() => expect(queueTrigger).toHaveFocus())
})

it.each(["body", "documentElement"] as const)("uses the queue trigger instead of a connected %s focus origin", async rootName => {
  viewport(600)
  const props = { queue: null, queueOpen: false, onQueueOpenChange: () => undefined, toolbar: null, children: null, inspector: <p>auth</p>, onInspectorOpenChange: () => undefined }
  const { rerender } = render(<FocusedGraphWorkspace {...props} inspectorOpen={false} />)
  const root = document[rootName]
  const previousTabIndex = root.getAttribute("tabindex")
  root.setAttribute("tabindex", "-1")
  root.focus()
  try {
    rerender(<FocusedGraphWorkspace {...props} inspectorOpen />)
    expect(screen.getByRole("dialog", { name: "선택 상세" })).toBeVisible()
    rerender(<FocusedGraphWorkspace {...props} inspectorOpen={false} />)
    await waitFor(() => expect(screen.getByRole("button", { name: "점검 큐 열기" })).toHaveFocus())
  } finally {
    if (previousTabIndex === null) root.removeAttribute("tabindex")
    else root.setAttribute("tabindex", previousTabIndex)
  }
})

it.each(["removed", "disabled"] as const)("falls back when the original compact graph trigger becomes %s", async graphTriggerState => {
  viewport(1280)
  const { rerender } = render(<Workspace />)
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))
  rerender(<Workspace graphTriggerState={graphTriggerState} />)
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "점검 큐 접기" })).toHaveFocus())
})

it("uses queue and inspector sheets below 900px with the same selection and closes via Escape", async () => {
  viewport(899)
  render(<Workspace queueInitiallyOpen={false} />)
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "점검 큐 열기" }))
  const queue = screen.getByRole("dialog", { name: "점검 우선순위" })
  await userEvent.click(within(queue).getByRole("button", { name: "큐에서 auth 선택" }))
  expect(screen.queryByRole("dialog", { name: "점검 우선순위" })).not.toBeInTheDocument()
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
})

it("switches at 1440px without losing the selected Gap or remounting the graph", async () => {
  const resize = viewport(1440)
  render(<Workspace />)
  const graph = screen.getByRole("region", { name: "경로 작업면" })
  await userEvent.click(screen.getByRole("button", { name: "경로 auth 선택" }))
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
  resize(1439)
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  resize(1440)
  expect(screen.getByRole("complementary", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  expect(screen.getByRole("region", { name: "경로 작업면" })).toBe(graph)
  resize(899)
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)
  expect(screen.getByRole("dialog", { name: "선택 상세" }).querySelector("[data-gap-id]")).toHaveAttribute("data-gap-id", "auth")
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "점검 큐 열기" })).toBeVisible()
})
