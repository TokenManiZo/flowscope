import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Core, CytoscapeOptions } from "cytoscape"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { SurfaceObservation } from "@/lib/api/types"
import { actualEvent, demoEndpoint, demoResource, parameterGap, parameterSnapshot, statusParameter, surfaceSnapshot, validationCell } from "./parameterMapFixtures"
import { defaultParameterFilters, projectParameterMap } from "./parameterProjection"
import { ParameterGapGraph } from "./ParameterGapGraph"

let core: Core
vi.mock("cytoscape", async importOriginal => {
  const original = await importOriginal<{ default: typeof import("cytoscape") }>()
  return { default: (options: CytoscapeOptions) => {
    core = original.default({ ...options, container: undefined, headless: true, styleEnabled: true })
    return core
  } }
})
let width = 1200
let height = 600
let resized: ResizeObserverCallback
const disconnect = vi.fn()
beforeEach(() => {
  width = 1200
  height = 600
  disconnect.mockClear()
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height })
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) { resized = callback }
    observe() {}
    unobserve() {}
    disconnect() { disconnect() }
  }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const gaps = () => parameterSnapshot().surface!.parameterGaps ?? []
const projection = () => projectParameterMap(parameterSnapshot(), defaultParameterFilters, "auth")
/** PR fixture with mixed HUMAN/LLM observation attribution (40 + 40) and no authorization target on the status input. */
function mixedSnapshot() {
  const ids = Array.from({ length: 40 }, (_, i) => `observed-${i}`)
  const observation = (evidenceId: string, index: number): SurfaceObservation => ({ evidenceId, source: index % 2 ? "LLM" : "HUMAN", runId: "run", identity: "USER A", status: 200, shape: "STRING" })
  const parameter = statusParameter({ observationEvidenceIds: ids, observations: ids.map(observation), observedSources: ["HUMAN", "LLM"], profile: { ...statusParameter().profile!, observationCount: 80, sourceCounts: { HUMAN: 40, LLM: 40 } }, authorizationTargets: [] })
  return surfaceSnapshot({ endpoints: [demoEndpoint([parameter])], gaps: gaps(), cells: [validationCell()], events: [actualEvent()], owners: { [demoResource]: "USER B" } })
}
function insideLanes() {
  const lanes = ["condition", "operation", "input", "target"]
  core.nodes().forEach(node => {
    const lane = lanes.indexOf(node.data("lane"))
    expect(node.renderedPosition().x - node.renderedOuterWidth() / 2).toBeGreaterThanOrEqual(lane * width / 4 - 0.01)
    expect(node.renderedPosition().x + node.renderedOuterWidth() / 2).toBeLessThanOrEqual((lane + 1) * width / 4 + 0.01)
  })
}

it("uses approved card images and textual node semantics", () => {
  render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  const selected = core.nodes('[focused = "yes"]')
  expect(selected.every(node => String(node.data("cardImage")).startsWith("data:image/svg+xml"))).toBe(true)
  // 점검 우선순위 카드는 줄 구성과 무관하게 한 가지 크기다.
  expect(selected.every(node => node.data("width") === 200 && node.data("height") === 86)).toBe(true)
  expect(selected.filter('[lane = "condition"]').first().data("accessibleLabel")).toContain("USER A")
  expect(selected.filter('[lane = "operation"]').first().data("accessibleLabel")).toContain("PATCH")
  expect(selected.filter('[lane = "input"]').first().data("accessibleLabel")).toContain("JSON")
  expect(selected.filter('[lane = "target"]').first().data("accessibleLabel")).toContain("owner:")
})

it("shows a full text-only card tooltip on canvas node hover and focus and cleans up stale tooltips", async () => {
  const initial = projection()
  const fullLabel = `Operation https://demo.test:443 PATCH /${"long-route/".repeat(10)}orders/{id}; <img src=x onerror=alert(1)>`
  const withLabel = { ...initial, nodes: initial.nodes.map(node => node.lane === "operation" ? { ...node, card: { ...node.card, accessibleLabel: fullLabel } } : node) }
  const { rerender, unmount } = render(<ParameterGapGraph projection={withLabel} onSelect={vi.fn()} />)
  const node = core.nodes('[lane = "operation"]').first()
  act(() => { node.emit("mouseover") })
  const tooltip = screen.getByRole("tooltip")
  expect(tooltip).toBeVisible()
  expect(tooltip.textContent).toBe(fullLabel)
  expect(tooltip.querySelector("img, script")).toBeNull()
  act(() => { node.emit("mouseout") })
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
  act(() => { node.emit("focus") })
  expect(screen.getByRole("tooltip").textContent).toBe(fullLabel)
  act(() => { node.emit("blur") })
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  act(() => { node.emit("mouseover") })
  rerender(<ParameterGapGraph projection={initial} onSelect={vi.fn()} />)
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  act(() => { core.nodes('[lane = "operation"]').first().emit("mouseover") })
  expect(screen.getByRole("tooltip")).toBeVisible()
  const owned = core
  unmount()
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  expect(owned.destroyed()).toBe(true)
})

it("makes an 8192-character coordinate reachable by tab and keyboard scrolling in a low-height tooltip", async () => {
  height = 160
  const initial = projection()
  const fullLabel = `Operation /${"x".repeat(8185)}/final; <literal>`
  const withLongCoordinate = { ...initial, nodes: initial.nodes.map(node => ({ ...node, card: { ...node.card, accessibleLabel: fullLabel } })) }
  const onSelect = vi.fn()
  render(<ParameterGapGraph projection={withLongCoordinate} onSelect={onSelect} />)
  const canvas = screen.getByLabelText("파라미터 Cytoscape 그래프")
  act(() => { canvas.focus() })
  const tooltip = screen.getByRole("tooltip")
  expect(tooltip).toHaveAttribute("tabindex", "0")
  expect(tooltip).not.toHaveClass("pointer-events-none")
  expect(tooltip).toHaveClass("pointer-events-auto")
  expect(tooltip).toHaveClass("overflow-y-auto")
  expect(tooltip.textContent).toBe(fullLabel)
  expect(tooltip.querySelector("literal")).toBeNull()
  Object.defineProperty(tooltip, "scrollHeight", { configurable: true, value: 4096 })
  await userEvent.tab()
  expect(tooltip).toHaveFocus()
  expect(tooltip).toBeVisible()
  await userEvent.keyboard("{End}")
  expect(tooltip.scrollTop).toBe(3936)
  await userEvent.keyboard("{Home}{PageDown}")
  expect(tooltip.scrollTop).toBe(160)
  expect(onSelect).not.toHaveBeenCalled()
  await userEvent.tab({ shift: true })
  expect(canvas).toHaveFocus()
  await userEvent.keyboard("{ArrowRight}{Enter}")
  expect(onSelect).toHaveBeenCalledWith(initial.selection)
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
})

it("keeps a node tooltip open across pointer transfer and cancels delayed hiding on pointer or focus entry", () => {
  // Cytoscape owns an independent RAF loop; track only the tooltip's timeout lifecycle.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const { unmount } = render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  act(() => { vi.runOnlyPendingTimers() })
  expect(vi.getTimerCount()).toBe(0)
  const node = core.nodes('[lane = "operation"]').first()
  act(() => { node.emit("mouseover"); node.emit("mouseout") })
  expect(vi.getTimerCount()).toBe(1)
  const tooltip = screen.getByRole("tooltip")
  fireEvent.pointerEnter(tooltip)
  expect(vi.getTimerCount()).toBe(0)
  act(() => { vi.advanceTimersByTime(500) })
  expect(tooltip).toBeVisible()
  fireEvent.pointerLeave(tooltip)
  expect(vi.getTimerCount()).toBe(1)
  act(() => { tooltip.focus(); vi.advanceTimersByTime(500) })
  expect(vi.getTimerCount()).toBe(0)
  expect(tooltip).toHaveFocus()
  expect(tooltip).toBeVisible()
  act(() => { tooltip.blur(); vi.advanceTimersByTime(500) })
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  act(() => { node.emit("mouseover"); node.emit("mouseout") })
  const again = screen.getByRole("tooltip")
  fireEvent.pointerEnter(again)
  fireEvent.pointerLeave(again)
  act(() => { vi.advanceTimersByTime(500) })
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(["selection", "viewport", "projection", "fallback", "unmount"])("dismisses a pending tooltip on %s without a delayed-hide leak", action => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const initial = projection()
  const { rerender, unmount } = render(<ParameterGapGraph projection={initial} onSelect={vi.fn()} />)
  act(() => { vi.runOnlyPendingTimers() })
  expect(vi.getTimerCount()).toBe(0)
  const node = core.nodes().first()
  act(() => { node.emit("mouseover"); node.emit("mouseout") })
  expect(screen.getByRole("tooltip")).toBeVisible()
  expect(vi.getTimerCount()).toBe(1)
  if (action === "selection") act(() => { node.emit("tap") })
  else if (action === "viewport") act(() => { core.zoom(1.05) })
  else if (action === "projection") rerender(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  else if (action === "fallback") act(() => { width = 600; resized([], {} as ResizeObserver) })
  else unmount()
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  expect(vi.getTimerCount()).toBe(0)
  if (action !== "unmount") unmount()
})

it("lets keyboard canvas focus show full node text without relying on the hidden path list", async () => {
  const onSelect = vi.fn()
  render(<ParameterGapGraph projection={projection()} onSelect={onSelect} />)
  const canvas = screen.getByLabelText("파라미터 Cytoscape 그래프")
  expect(canvas).toHaveAttribute("tabindex", "0")
  act(() => { canvas.focus() })
  expect(screen.getByRole("tooltip")).toHaveTextContent("USER A")
  expect(canvas).toHaveAccessibleDescription(/USER A/)
  await userEvent.keyboard("{ArrowRight}")
  expect(screen.getByRole("tooltip")).toHaveTextContent("PATCH /orders/{id}")
  await userEvent.keyboard("{Enter}")
  expect(onSelect).toHaveBeenCalledWith(projection().selection)
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
})

it("shows current graph magnification between the zoom controls and updates with the viewport", async () => {
  render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  const magnification = screen.getByLabelText("Gap 그래프 배율")
  expect(magnification).toHaveTextContent("100%")
  expect(screen.getByRole("button", { name: "Gap 그래프 축소" }).nextElementSibling).toBe(magnification)
  expect(magnification.nextElementSibling).toBe(screen.getByRole("button", { name: "Gap 그래프 확대" }))
  await userEvent.click(screen.getByRole("button", { name: "Gap 그래프 확대" }))
  expect(magnification).toHaveTextContent("110%")
  act(() => { core.zoom(0.95) })
  expect(magnification).toHaveTextContent("95%")
})

it("draws unlabeled edges and marks API and target cards with the requesting sources", () => {
  width = 1440
  const mixed = projectParameterMap(mixedSnapshot(), defaultParameterFilters, "auth")
  render(<ParameterGapGraph projection={mixed} onSelect={vi.fn()} />)
  expect(core.edges().map(edge => edge.data("label"))).toEqual(core.edges().map(() => ""))
  expect(core.edges().filter(edge => edge.id().includes('"observation"')).map(edge => edge.data("color"))).not.toContain("#60a5fa")
  for (const lane of ["operation", "target"] as const) for (const node of mixed.nodes.filter(item => item.lane === lane)) expect(node.card.sources).toBeDefined()
  for (const lane of ["condition", "input"] as const) for (const node of mixed.nodes.filter(item => item.lane === lane)) expect(node.card.sources).toBeUndefined()
})

it("renders four labeled lanes, separate source/relation legends and canonical node selection", async () => {
  const onSelect = vi.fn()
  render(<ParameterGapGraph projection={projection()} onSelect={onSelect} />)
  for (const lane of ["조건/사용자", "API 엔드포인트", "입력 파라미터", "권한 대상"]) expect(screen.getByRole("columnheader", { name: lane })).toBeVisible()
  // 범례는 `?` 아이콘 뒤에 숨어 있다가 포커스(또는 마우스 올림)로 펼쳐진다.
  expect(screen.queryByRole("list", { name: "요청 생성 주체 범례" })).not.toBeInTheDocument()
  act(() => { screen.getByRole("button", { name: "범례·도움말" }).focus() })
  const legend = await screen.findByRole("list", { name: "요청 생성 주체 범례" })
  expect(within(legend).getAllByRole("listitem").map(item => item.textContent)).toEqual(["HUMAN", "SCANNER", "LLM"])
  expect(screen.getByRole("list", { name: "관계 선형 범례" })).toHaveTextContent("실선: 관측·근거주황 파선: 미검증 · Gap점선: 정의·불확실 관계")
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("list", { name: "요청 생성 주체 범례" })).not.toBeInTheDocument())
  expect(screen.getByRole("button", { name: "Gap 그래프 맞추기" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Gap 그래프 확대" })).toBeVisible()
  expect(core.nodes().length).toBe(8)
  expect(core.nodes().filter(node => node.data("focused") === "yes").length).toBe(4)
  const input = core.nodes().filter(node => node.data("lane") === "input" && node.data("focused") === "yes")[0]
  act(() => { input.emit("tap") })
  expect(onSelect).toHaveBeenCalledWith(projection().selection)
  expect(onSelect.mock.calls[0][0]).toMatchObject({ gapId: "auth", evidenceIds: ["witness-a"], evidenceCount: 31 })
  await userEvent.click(screen.getByText("경로 목록"))
  const button = within(screen.getByRole("list", { name: "Gap 경로 목록" })).getAllByRole("button")[0]
  button.focus()
  await userEvent.keyboard("{Enter}")
  expect(onSelect).toHaveBeenCalledTimes(2)
})

it("keeps full card rectangles in lanes after minimum/maximum zoom, pan, drag, fit and resize", async () => {
  const { unmount } = render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  insideLanes()
  act(() => { core.zoom(core.minZoom()) })
  insideLanes()
  act(() => { core.zoom(core.maxZoom()) })
  insideLanes()
  act(() => { core.zoom(50); core.pan({ x: -3000, y: 15 }) })
  insideLanes()
  act(() => {
    core.nodes().forEach(node => { node.position({ x: -9000, y: 100 }); node.emit("drag") })
  })
  insideLanes()
  await userEvent.click(screen.getByRole("button", { name: "Gap 그래프 맞추기" }))
  insideLanes()
  expect(Number.parseFloat(core.edges()[0].style("font-size")) * core.zoom()).toBeGreaterThanOrEqual(12)
  const resize = vi.spyOn(core, "resize")
  for (const resizedWidth of [1440, 1280, 920]) {
    act(() => { width = resizedWidth; resized([], {} as ResizeObserver) })
    insideLanes()
  }
  expect(resize).toHaveBeenCalledTimes(3)
  expect(core.maxZoom()).toBeGreaterThanOrEqual(core.minZoom())
  const owned = core
  unmount()
  expect(owned.destroyed()).toBe(true)
  expect(disconnect).toHaveBeenCalled()
})

it("switches to an accessible list at measured narrow width and preserves exact selection", async () => {
  const onSelect = vi.fn()
  render(<ParameterGapGraph projection={projection()} onSelect={onSelect} />)
  const owned = core
  act(() => { width = 600; resized([], {} as ResizeObserver) })
  expect(owned.destroyed()).toBe(true)
  expect(screen.queryByLabelText("파라미터 Cytoscape 그래프")).not.toBeInTheDocument()
  const list = screen.getByRole("list", { name: "Gap 경로 목록" })
  expect(list.querySelectorAll("button[data-gap-id]")).toHaveLength(8)
  await userEvent.click(within(screen.getByRole("region", { name: "Gap 경로 source" })).getAllByRole("button")[0])
  expect(onSelect.mock.calls[0][0].gapId).toBe("source")
})

it("labels an input without observation witnesses UNKNOWN rather than as a supported relation", () => {
  const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ observationEvidenceIds: [], observations: [], profile: undefined })])], gaps: gaps(), cells: [validationCell()], events: [actualEvent()] })
  render(<ParameterGapGraph projection={projectParameterMap(snapshot)} onSelect={vi.fn()} />)
  const unknownInputs = core.edges().filter(edge => edge.id().includes("unknown-input"))
  expect(unknownInputs.length).toBe(2)
  // 캔버스 엣지는 라벨이 없고, 미지원 관계는 점선으로 구분한다. 문장 설명은 경로 목록에 남는다.
  expect(unknownInputs.map(edge => edge.data("line"))).toEqual(["dotted", "dotted"])
})

it("focuses Gap 41 and a previously panned existing path without resetting later polling viewport", () => {
  const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint()], gaps: Array.from({ length: 45 }, (_, index) => parameterGap(`gap-${String(index + 1).padStart(2, "0")}`)), cells: [validationCell()], events: [actualEvent()], owners: { [demoResource]: "USER B" } })
  const { rerender } = render(<ParameterGapGraph projection={projectParameterMap(snapshot)} onSelect={vi.fn()} />)
  act(() => { core.pan({ x: -400, y: -2000 }) })
  rerender(<ParameterGapGraph projection={projectParameterMap(snapshot, defaultParameterFilters, "gap-41")} onSelect={vi.fn()} />)
  const selected = () => core.nodes().filter(node => node.data("focused") === "yes")
  expect(selected().length).toBe(4)
  const visible = () => selected().forEach(node => {
    expect(node.renderedPosition().y - node.renderedOuterHeight() / 2).toBeGreaterThanOrEqual(0)
    expect(node.renderedPosition().y + node.renderedOuterHeight() / 2).toBeLessThanOrEqual(600)
  })
  visible()
  insideLanes()
  act(() => { core.pan({ x: -300, y: -9000 }) })
  rerender(<ParameterGapGraph projection={projectParameterMap(snapshot, defaultParameterFilters, "gap-02")} onSelect={vi.fn()} />)
  visible()
  insideLanes()
  act(() => { core.pan({ x: -200, y: -1500 }) })
  const intentionalPan = { ...core.pan() }
  rerender(<ParameterGapGraph projection={projectParameterMap({ ...snapshot, revision: 2 }, defaultParameterFilters, "gap-02")} onSelect={vi.fn()} />)
  expect(core.pan()).toEqual(intentionalPan)
  rerender(<ParameterGapGraph projection={projectParameterMap(snapshot, defaultParameterFilters, "gap-02")} focusVersion={1} onSelect={vi.fn()} />)
  visible()
  insideLanes()
})

it("emits the exact edge selection and focuses it after the selection is applied", () => {
  const onSelect = vi.fn()
  const { rerender } = render(<ParameterGapGraph projection={projection()} onSelect={onSelect} />)
  const edge = core.edges().filter(item => item.data("focused") === "no")[0]
  act(() => { core.pan({ x: -400, y: -9000 }); edge.emit("tap") })
  expect(onSelect).toHaveBeenCalledWith(projectParameterMap(parameterSnapshot(), defaultParameterFilters, "source").selection)
  rerender(<ParameterGapGraph projection={projectParameterMap(parameterSnapshot(), defaultParameterFilters, onSelect.mock.calls[0][0].gapId)} onSelect={onSelect} />)
  core.nodes().filter(node => node.data("focused") === "yes").forEach(node => {
    expect(node.renderedPosition().y - node.renderedOuterHeight() / 2).toBeGreaterThanOrEqual(0)
    expect(node.renderedPosition().y + node.renderedOuterHeight() / 2).toBeLessThanOrEqual(600)
  })
  insideLanes()
})

it("exposes mixed observation attribution, Gap subject and separate evidence counts in the narrow list", async () => {
  width = 600
  const onSelect = vi.fn()
  render(<ParameterGapGraph projection={projectParameterMap(mixedSnapshot(), defaultParameterFilters, "source")} onSelect={onSelect} />)
  const path = screen.getByRole("region", { name: "Gap 경로 source" })
  expect(path).toHaveTextContent("Gap 주체 S · SCANNER")
  expect(path).toHaveTextContent("관측 H · HUMAN × 40 / L · LLM × 40")
  expect(path).toHaveTextContent("관측 기록 40건")
  expect(path).toHaveTextContent("Gap 근거 31건")
  expect(path).toHaveTextContent("관계 근거 0건")
  expect(path).toHaveTextContent("연결 UNKNOWN")
  expect(path).not.toHaveTextContent("관측 S")
  const relation = within(path).getByRole("button", { name: /관측 H · HUMAN/ })
  relation.focus()
  await userEvent.keyboard("{Enter}")
  expect(onSelect.mock.calls[0][0]).toMatchObject({ gapId: "source", evidenceIds: ["witness-a"], evidenceCount: 31 })
})

it("reserves stroke shapes for relationship meanings, not source attribution", async () => {
  render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  await userEvent.hover(screen.getByRole("button", { name: "범례·도움말" }))
  const sourceLegend = await screen.findByRole("list", { name: "요청 생성 주체 범례" })
  for (const marker of sourceLegend.querySelectorAll('[aria-hidden="true"]')) {
    expect(marker).not.toHaveStyle({ borderStyle: "dashed" })
    expect(marker).not.toHaveStyle({ borderStyle: "dotted" })
    expect(marker).not.toHaveClass("border-t-2")
  }
  expect(screen.getByRole("list", { name: "관계 선형 범례" })).toHaveTextContent("실선")
  expect(screen.getByText("Gap = 점검 후보")).toBeVisible()
  await userEvent.unhover(screen.getByRole("button", { name: "범례·도움말" }))
  await waitFor(() => expect(screen.queryByRole("list", { name: "요청 생성 주체 범례" })).not.toBeInTheDocument())
})

it("pans on a two-finger trackpad scroll and zooms only on pinch or mouse wheel", () => {
  render(<ParameterGapGraph projection={projection()} onSelect={vi.fn()} />)
  const canvas = screen.getByLabelText("파라미터 Cytoscape 그래프")
  const zoom = core.zoom(), panY = core.pan().y

  const trackpad = new WheelEvent("wheel", { deltaY: 12.5, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true })
  act(() => { canvas.dispatchEvent(trackpad) })
  expect(trackpad.defaultPrevented).toBe(true)
  expect(core.zoom()).toBe(zoom)
  expect(core.pan().y).toBeCloseTo(panY - 12.5)

  act(() => { canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 8, ctrlKey: true, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true })) })
  expect(core.zoom()).toBeLessThan(zoom)
})
