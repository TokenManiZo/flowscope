import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import cytoscape from "cytoscape"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { CytoscapeGraph, graphFocusStates, graphWheelIntent, readGroupBands, readMinimap, routeEdges, type RouteNode } from "./CytoscapeGraph"
import type { EventRecord } from "@/lib/api/types"
import type { GraphFilters, GraphProjection } from "./graphProjection"
import { projectHierarchy } from "./graphHierarchy"
import { targetSnapshot } from "@/test/fixtures"

let currentZoom = 1
let currentMaxZoom = 2
let selected = false
const remove = vi.fn(() => { selected = false })
const unselect = vi.fn(() => { selected = false })
let renderedPosition = { x: 700, y: 120 }
let modelPosition = { x: 350, y: 55 }
let canvasWidth = 900
let canvasHeight = 600
let scheduledFrame: FrameRequestCallback | null = null
let resizeListener: ResizeObserverCallback | null = null
/** 캔버스 크기 맞춤은 크기 변화가 멈춘 뒤 한 번만 일어난다. */
function settleResize() {
  vi.useFakeTimers()
  try { resizeListener?.([], {} as ResizeObserver); vi.advanceTimersByTime(200) } finally { vi.useRealTimers() }
}
const disconnectResizeObserver = vi.fn()
const listeners = new Map<string, (event: { target: typeof node; type?: string }) => void>()
const node = {
  data: vi.fn((key: string) => key === "kind" ? "identity" : undefined),
  id: vi.fn(() => "identity:alice"),
  addClass: vi.fn(),
  removeClass: vi.fn(),
  emit: vi.fn((event: string) => {
    if (event === "focus" || event === "mouseover") listeners.get("mouseover focus:node")?.({ target: node, type: event })
    else if (event === "blur" || event === "mouseout") listeners.get("mouseout blur:node")?.({ target: node, type: event })
    else if (event === "tap") listeners.get("tap:node, edge")?.({ target: node, type: event })
  }),
  lock: vi.fn(),
  unlock: vi.fn(),
  select: vi.fn(() => { selected = true }),
  unselect: vi.fn(() => { selected = false }),
  selected: vi.fn(() => selected),
  position: vi.fn((next?: { x: number; y: number }) => {
    if (next) modelPosition = next
    return modelPosition
  }),
  renderedPosition: vi.fn(() => renderedPosition),
  renderedOuterWidth: vi.fn(() => 226 * currentZoom),
  renderedOuterHeight: vi.fn(() => 126 * currentZoom),
}
const singleNodeCollection = () => ({
  forEach: (callback: (current: typeof node) => void) => callback(node),
  toArray: () => [node],
  filter: () => singleNodeCollection(),
  emit: (event: string) => node.emit(event),
  get length() { return 1 },
})
const core = {
  add: vi.fn(),
  destroy: vi.fn(),
  resize: vi.fn(),
  elements: vi.fn(() => ({ remove, unselect, forEach: vi.fn() })),
  getElementById: vi.fn(() => node),
  nodes: vi.fn(singleNodeCollection),
  off: vi.fn(),
  on: vi.fn((event: string, selector: string | ((event: { target: typeof node; type?: string }) => void), listener?: (event: { target: typeof node; type?: string }) => void) => {
    listeners.set(`${event}:${typeof selector === "string" ? selector : "core"}`, typeof selector === "function" ? selector : listener!)
  }),
  maxZoom: vi.fn((next?: number) => { if (next !== undefined) currentMaxZoom = next; return currentMaxZoom }),
  zoom: vi.fn((next?: number | { level: number }) => { if (next !== undefined) currentZoom = typeof next === "number" ? next : next.level; return currentZoom }),
  pan: vi.fn(() => ({ x: 0, y: 0 })),
  panBy: vi.fn(),
  viewport: vi.fn(),
  fit: vi.fn(),
  layout: vi.fn(() => ({ run: vi.fn() })),
}

vi.mock("cytoscape", () => ({ default: vi.fn(() => core) }))

const projection: GraphProjection = {
  identities: [], resources: [], operations: [{ id: "operation:GET /orders", kind: "operation", label: "GET /orders", wrappedLabel: "GET\n/orders", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection: { operation: "GET /orders", resource: null, identity: "alice", source: "human", evidenceIds: ["e-1"] } }], routeCandidates: [], listItems: [], edges: [{ id: "edge", sourceId: "identity:alice", targetId: "operation:GET /orders", relation: "identity-operation", source: "human", sourceText: "HUMAN", line: "solid", color: "#2563eb", count: 2, countLabel: "×2", selection: { operation: "GET /orders", resource: null, identity: "alice", source: "human", evidenceIds: ["e-1"] } }],
}

beforeEach(() => {
  // 앱 기본 테마는 다크다. 라이트 전용 기대값은 해당 테스트에서 따로 확인한다.
  document.documentElement.classList.add("dark")
  window.history.replaceState({}, "", "/")
  Object.values(core).forEach((value) => { if (typeof value === "function" && "mockClear" in value) value.mockClear() })
  Object.values(node).forEach((value) => { if (typeof value === "function" && "mockClear" in value) value.mockClear() })
  remove.mockClear()
  listeners.clear()
  renderedPosition = { x: 700, y: 120 }
  modelPosition = { x: 350, y: 55 }
  currentZoom = 1
  currentMaxZoom = 2
  selected = false
  canvasWidth = 900
  canvasHeight = 600
  scheduledFrame = null
  resizeListener = null
  disconnectResizeObserver.mockClear()
  vi.mocked(core.zoom).mockImplementation((next?: number | { level: number }) => { if (next !== undefined) currentZoom = typeof next === "number" ? next : next.level; return currentZoom })
  vi.mocked(core.maxZoom).mockImplementation((next?: number) => { if (next !== undefined) currentMaxZoom = next; return currentMaxZoom })
  vi.mocked(core.pan).mockReturnValue({ x: 0, y: 0 })
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "identity" : undefined)
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => canvasWidth })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => canvasHeight })
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => { scheduledFrame = callback; return 1 })
  globalThis.cancelAnimationFrame = vi.fn()
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) { resizeListener = callback }
    observe() {}
    unobserve() {}
    disconnect() { disconnectResizeObserver() }
  }
})

afterEach(() => { vi.mocked(core.nodes).mockImplementation(singleNodeCollection); document.documentElement.classList.remove("dark") })

function runScheduledFrame() {
  const callback = scheduledFrame
  scheduledFrame = null
  callback?.(0)
}

it("updates search rings without recreating graph elements", () => {
  const props = { projection, locked: false, fitVersion: 0, onSelect: vi.fn(), onPreferencesChange: vi.fn() }
  const { rerender } = render(<CytoscapeGraph {...props} />)
  remove.mockClear(); vi.mocked(core.add).mockClear()
  rerender(<CytoscapeGraph {...props} searchMatches={new Map([["identity:alice", "member"]])} />)
  expect(remove).not.toHaveBeenCalled()
  expect(core.add).not.toHaveBeenCalled()
  expect(screen.getByText("멤버 일치")).toBeInTheDocument()
  rerender(<CytoscapeGraph {...props} searchMatches={new Map()} />)
  expect(screen.queryByText("멤버 일치")).not.toBeInTheDocument()
  expect(remove).not.toHaveBeenCalled()
})

it("reveals a search selection with a viewport change while preserving model coordinates", () => {
  const done = vi.fn()
  const props = { projection, locked: true, fitVersion: 0, onSelect: vi.fn(), onPreferencesChange: vi.fn(), onRevealed: done }
  const { rerender } = render(<CytoscapeGraph {...props} />)
  modelPosition = { x: 1100, y: 20 }
  vi.mocked(node.data).mockImplementation(key => key === "width" ? "200" : key === "height" ? "100" : key === "kind" ? "identity" : undefined)
  vi.mocked(core.viewport).mockClear()
  rerender(<CytoscapeGraph {...props} revealRequest={{ nodeId: "identity:alice", requestId: 7 }} />)
  act(runScheduledFrame)
  expect(core.viewport).toHaveBeenCalledWith({ zoom: 1, pan: { x: -316, y: 86 } })
  expect(modelPosition).toEqual({ x: 1100, y: 20 })
  expect(done).toHaveBeenCalledWith(7)
})

function createStatefulNode(id: string, kind: string, initial: { x: number; y: number }, viewport: () => { zoom: number; pan: { x: number; y: number } }) {
  let model = { ...initial }
  let locked = false
  return {
    data: (key: string) => key === "kind" ? kind : undefined,
    id: () => id,
    lock: vi.fn(() => { locked = true }),
    unlock: vi.fn(() => { locked = false }),
    locked: () => locked,
    position: (next?: { x: number; y: number }) => {
      if (next && !locked) model = { ...next }
      return model
    },
    renderedPosition: () => ({ x: model.x * viewport().zoom + viewport().pan.x, y: model.y * viewport().zoom + viewport().pan.y }),
    renderedOuterWidth: () => 226 * viewport().zoom,
    renderedOuterHeight: () => 126 * viewport().zoom,
  }
}

it("owns one Cytoscape instance and unregisters listeners before destroy on unmount", () => {
  const { rerender, unmount } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  rerender(<CytoscapeGraph projection={projection} locked fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(core.on).toHaveBeenCalledTimes(10)
  unmount()
  expect(core.off).toHaveBeenCalledTimes(10)
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1)
  expect(disconnectResizeObserver).toHaveBeenCalledTimes(1)
  expect(Math.max(...core.off.mock.invocationCallOrder)).toBeLessThan(core.destroy.mock.invocationCallOrder[0])
  expect(disconnectResizeObserver.mock.invocationCallOrder[0]).toBeLessThan(core.destroy.mock.invocationCallOrder[0])
  expect(core.destroy).toHaveBeenCalledTimes(1)
})

it("coalesces repeated viewport events into one publish frame", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  vi.mocked(globalThis.requestAnimationFrame).mockClear()

  listeners.get("viewport:core")?.({ target: node })
  listeners.get("viewport:core")?.({ target: node })
  listeners.get("viewport:core")?.({ target: node })

  expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1)
})

it("shows a safe status when the canvas renderer cannot initialize", () => {
  const onRendererUnavailable = vi.fn()
  vi.mocked(cytoscape).mockImplementationOnce(() => { throw new Error("canvas unavailable") })
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} onRendererUnavailable={onRendererUnavailable} />)
  expect(screen.getByRole("status")).toHaveTextContent("그래프 캔버스를 초기화하지 못했습니다")
  expect(onRendererUnavailable).toHaveBeenCalledTimes(1)
})

it("renders approved card images with source icons instead of edge text, and keeps fit behavior", () => {
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(remove).toHaveBeenCalledTimes(1)
  expect(core.add).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ id: "edge", label: "", line: "solid", color: "#94a3b8" }) })]))
  expect(core.add).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({
    id: "operation:GET /orders", cardImage: expect.stringMatching(/^data:image\/svg\+xml,/), accessibleLabel: "GET /orders; Operation; verdict ALLOW; 접근 주체 HUMAN", width: 232, height: 67, confirmed: "no",
  }) })]))
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(core.fit).toHaveBeenCalledTimes(1)
})

it("shows complete card text from pointer and keyboard focus and selects the focused node", () => {
  const longLabel = `alice-${"very-long-identity-segment-".repeat(40)}END`
  const identity = { id: "identity:alice", kind: "identity" as const, label: longLabel, wrappedLabel: longLabel, verdict: "allow" as const, verdictText: "ALLOW", verdictColor: "#15803d", selection: { operation: "GET /orders", resource: null, identity: longLabel, source: "human" as const, evidenceIds: ["e-1"] } }
  const graph: GraphProjection = { ...projection, identities: [identity], operations: [], edges: [] }
  const onSelect = vi.fn()
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "identity" : key === "accessibleLabel" ? `Identity ${longLabel}; verdict ALLOW; 1 관측 기록` : undefined)
  render(<CytoscapeGraph projection={graph} locked={false} fitVersion={0} onSelect={onSelect} onPreferencesChange={vi.fn()} />)

  act(() => { listeners.get("mouseover focus:node")?.({ target: node, type: "mouseover" }) })
  expect(screen.getByRole("tooltip")).toHaveTextContent(longLabel)
  expect(screen.getByRole("tooltip")).toHaveTextContent("1 관측 기록")

  const canvas = screen.getByLabelText("공격면 Cytoscape 그래프")
  fireEvent.focus(canvas)
  fireEvent.keyDown(canvas, { key: "Enter" })
  expect(node.addClass).toHaveBeenCalledWith("keyboard-focus")
  expect(onSelect).toHaveBeenCalledWith(identity.selection, "identity:alice")
})

it("dismisses an open full-text card tooltip when the projection changes", () => {
  const identity = { id: "identity:alice", kind: "identity" as const, label: "alice", wrappedLabel: "alice", verdict: "allow" as const, verdictText: "ALLOW", verdictColor: "#15803d", selection: { operation: "GET /orders", resource: null, identity: "alice", source: "human" as const, evidenceIds: ["e-1"] } }
  const graph: GraphProjection = { ...projection, identities: [identity], operations: [], edges: [] }
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "identity" : key === "accessibleLabel" ? "Identity alice; verdict ALLOW; 1 관측 기록" : undefined)
  const { rerender } = render(<CytoscapeGraph projection={graph} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  act(() => { listeners.get("mouseover focus:node")?.({ target: node, type: "mouseover" }) })
  expect(screen.getByRole("tooltip")).toBeInTheDocument()

  rerender(<CytoscapeGraph projection={{ ...graph, identities: [] }} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
})

it("renders a graph-first canvas with dark compact node styling", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(screen.getByLabelText("공격면 Cytoscape 그래프")).toHaveClass("h-full", "min-h-[28rem]")
  expect(vi.mocked(cytoscape)).toHaveBeenCalledWith(expect.objectContaining({
    style: expect.arrayContaining([
      expect.objectContaining({ selector: "node", style: expect.objectContaining({ "background-color": "data(cardColor)", color: "#e5e7eb" }) }),
      expect.objectContaining({ selector: "node", style: expect.objectContaining({ "background-image": "data(cardImage)", width: "data(width)", height: "data(height)" }) }),
      expect.objectContaining({ selector: 'node[confirmed = "yes"]', style: expect.objectContaining({ "border-color": "#ef4444" }) }),
      expect.objectContaining({ selector: "node:selected" }),
      expect.objectContaining({ selector: "edge", style: expect.objectContaining({ label: "data(label)", "text-rotation": "autorotate" }) }),
    ]),
  }))
})

it("uses trackpad-like pixel deltas for panning and mouse-like deltas for zooming", () => {
  expect(graphWheelIntent("auto", { ctrlKey: false, deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaX: 4, deltaY: 8 })).toBe("pan")
  expect(graphWheelIntent("auto", { ctrlKey: false, deltaMode: WheelEvent.DOM_DELTA_LINE, deltaX: 0, deltaY: 3 })).toBe("zoom")
  expect(graphWheelIntent("trackpad", { ctrlKey: false, deltaMode: WheelEvent.DOM_DELTA_LINE, deltaX: 0, deltaY: 3 })).toBe("pan")
  expect(graphWheelIntent("mouse", { ctrlKey: true, deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaX: 0, deltaY: 2 })).toBe("zoom")
})

it("pans for trackpad mode and zooms for mouse mode", () => {
  const base = { version: 7 as const, locked: false, viewport: null, positions: {} }
  const { rerender } = render(<CytoscapeGraph projection={projection} preferences={{ ...base, inputMode: "trackpad" }} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const canvas = screen.getByLabelText("공격면 Cytoscape 그래프")
  fireEvent.wheel(canvas, { deltaX: 5, deltaY: 10, deltaMode: WheelEvent.DOM_DELTA_PIXEL })
  expect(core.panBy).toHaveBeenCalledWith({ x: -5, y: -10 })

  rerender(<CytoscapeGraph projection={projection} preferences={{ ...base, inputMode: "mouse" }} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  fireEvent.wheel(canvas, { deltaY: 10, deltaMode: WheelEvent.DOM_DELTA_PIXEL, clientX: 50, clientY: 60 })
  expect(core.zoom).toHaveBeenCalledWith(expect.objectContaining({ level: expect.any(Number), renderedPosition: { x: 50, y: 60 } }))
})

it("marks only explicitly confirmed node ids for the red border selector", () => {
  render(<CytoscapeGraph projection={projection} confirmedNodeIds={new Set(["operation:GET /orders"])} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; confirmed?: string } }>
  expect(added.find(item => item.data.id === "operation:GET /orders")?.data.confirmed).toBe("yes")
})

it("anchors nodes in their semantic lane on initial projection", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "operation" : undefined)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(node.position).toHaveBeenCalledWith({ x: 540, y: expect.any(Number) })
})

it("restores a saved position exactly, including one placed outside its lane", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "operation" : undefined)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={{ version: 7, inputMode: "auto", locked: false, viewport: null, positions: { "identity:alice": { x: -999, y: 222 } } }} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(node.position).toHaveBeenCalledWith({ x: -999, y: 222 })
  node.position.mockClear()

  runScheduledFrame()

  expect(node.position.mock.calls.every(([next]) => next === undefined)).toBe(true)
  expect(modelPosition).toEqual({ x: -999, y: 222 })
})

it("re-anchors saved positions only when the layout version changes", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "operation" : undefined)
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: false, viewport: null, positions: { "identity:alice": { x: 400, y: 222 } } }
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(node.position).toHaveBeenCalledWith({ x: 400, y: 222 })
  node.position.mockClear()

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} layoutVersion={1} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(node.position).toHaveBeenCalledWith({ x: 540, y: expect.any(Number) })
})

it("never rewrites node coordinates while panning or zooming", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  modelPosition = { x: 350, y: 55 }
  node.position.mockClear()
  vi.mocked(core.zoom).mockReturnValue(2)
  vi.mocked(core.pan).mockReturnValue({ x: 100, y: 30 })

  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()

  expect(node.position.mock.calls.every(([next]) => next === undefined)).toBe(true)
  expect(modelPosition).toEqual({ x: 350, y: 55 })
})

it("resizes the canvas once after the container stops changing instead of every frame", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  vi.mocked(core.resize).mockClear()
  vi.useFakeTimers()
  try {
    for (let step = 0; step < 5; step += 1) { resizeListener?.([], {} as ResizeObserver); vi.advanceTimersByTime(50) }
    runScheduledFrame()
    expect(core.resize).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
  } finally { vi.useRealTimers() }
  runScheduledFrame()
  expect(core.resize).toHaveBeenCalledTimes(1)
})

it("keeps node coordinates when the graph container is resized", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  modelPosition = { x: 200, y: 55 }
  node.position.mockClear()
  canvasWidth = 600

  settleResize()
  runScheduledFrame()

  expect(core.resize).toHaveBeenCalled()
  expect(modelPosition).toEqual({ x: 200, y: 55 })
})

it("preserves viewport and node coordinates when the detail panel narrows the canvas", () => {
  const extra = node as unknown as { renderedBoundingBox?: () => { x1: number; x2: number; y1: number; y2: number } }
  const sized = core as unknown as { width?: () => number; height?: () => number }
  extra.renderedBoundingBox = () => ({ x1: 820, x2: 1040, y1: 100, y2: 160 })
  sized.width = () => 600
  sized.height = () => 500
  try {
    render(<CytoscapeGraph projection={projection} selectedElementId="identity:alice" locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
    runScheduledFrame()
    vi.mocked(core.panBy).mockClear()
    vi.mocked(node.position).mockClear()
    const zoom = currentZoom
    settleResize()
    runScheduledFrame()
    expect(core.panBy).not.toHaveBeenCalled()
    expect(node.position.mock.calls.every(call => call.length === 0)).toBe(true)
    expect(currentZoom).toBe(zoom)
  } finally {
    delete extra.renderedBoundingBox
    delete sized.width
    delete sized.height
  }
})

it("keeps a node exactly where it was dropped and stores that position", () => {
  const onPreferencesChange = vi.fn()
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  modelPosition = { x: 9999, y: 210 }
  node.position.mockClear()

  listeners.get("dragfree:node")?.({ target: node })

  expect(node.position.mock.calls.every(([next]) => next === undefined)).toBe(true)
  expect(modelPosition).toEqual({ x: 9999, y: 210 })
  expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ positions: { "identity:alice": { x: 9999, y: 210 } } }))
})

function statefulLanes(positions: Array<[string, string, { x: number; y: number }]>) {
  const viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = positions.map(([id, kind, position]) => createStatefulNode(id, kind, position, () => viewport))
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((current) => callback(current as never)) }))
  vi.mocked(core.zoom).mockReturnValue(1)
  vi.mocked(core.pan).mockReturnValue(viewport.pan)
  return nodes
}

it("stops a dropped node at the neighbour lane edge and lets an open side grow", () => {
  const nodes = statefulLanes([
    ["identity:alice", "identity", { x: 180, y: 110 }],
    ["operation:GET /orders", "operation", { x: 540, y: 220 }],
    ["resource:order:1", "resource", { x: 900, y: 330 }],
  ])
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: false, viewport: null, positions: Object.fromEntries(nodes.map((node) => [node.id(), node.position()])) }
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  // API 노드를 IDENTITY 쪽으로 깊이 끌면 IDENTITY 오른쪽 끝(180+113) + 간격 48 + 자기 절반 113에서 멈춘다.
  nodes[1].position({ x: -400, y: 220 })
  listeners.get("dragfree:node")?.({ target: nodes[1] as never })
  expect(nodes[1].position()).toEqual({ x: 180 + 113 + 48 + 113, y: 220 })

  // 오른쪽 이웃이 없는 OBJECT는 얼마든지 넓어진다.
  nodes[2].position({ x: 4000, y: 330 })
  listeners.get("dragfree:node")?.({ target: nodes[2] as never })
  expect(nodes[2].position()).toEqual({ x: 4000, y: 330 })

  // 넓어진 OBJECT 범위 덕분에 API는 그만큼 오른쪽으로 더 갈 수 있다.
  nodes[1].position({ x: 5000, y: 220 })
  listeners.get("dragfree:node")?.({ target: nodes[1] as never })
  expect(nodes[1].position()).toEqual({ x: 4000 - 113 - 48 - 113, y: 220 })
})

it("re-anchors only the requested lane and reports the rendered lane bounds", () => {
  const nodes = statefulLanes([
    ["identity:alice", "identity", { x: 180, y: 110 }],
    ["operation:GET /orders", "operation", { x: 1500, y: 220 }],
    ["resource:order:1", "resource", { x: 2400, y: 330 }],
  ])
  const onLaneBoundsChange = vi.fn()
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: false, viewport: null, positions: Object.fromEntries(nodes.map((node) => [node.id(), node.position()])) }
  const tree = (laneLayout: { lane: number; version: number }) => <CytoscapeGraph projection={projection} locked={false} fitVersion={0} laneLayout={laneLayout} preferences={preferences} onSelect={vi.fn()} onLaneBoundsChange={onLaneBoundsChange} onPreferencesChange={vi.fn()} />
  const { rerender } = render(tree({ lane: 0, version: 0 }))
  runScheduledFrame()
  expect(onLaneBoundsChange).toHaveBeenLastCalledWith([{ left: 67, right: 293 }, { left: 1387, right: 1613 }, { left: 2287, right: 2513 }])

  rerender(tree({ lane: 1, version: 1 }))

  expect(nodes.map((node) => node.position().x)).toEqual([180, 540, 2400])
  expect(onLaneBoundsChange).toHaveBeenLastCalledWith([{ left: 67, right: 293 }, { left: 427, right: 653 }, { left: 2287, right: 2513 }])
})

it("keeps free placement through restore, zoom, fit, resize, and diagonal drag", () => {
  let viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = [
    createStatefulNode("identity:alice", "identity", { x: -999, y: 0 }, () => viewport),
    createStatefulNode("operation:GET /orders", "operation", { x: -999, y: 0 }, () => viewport),
    createStatefulNode("resource:order:1", "resource", { x: -999, y: 0 }, () => viewport),
  ]
  canvasWidth = 1200
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((node) => callback(node as never)) }))
  vi.mocked(core.zoom).mockImplementation(((next?: number) => { if (next !== undefined) viewport = { ...viewport, zoom: next }; return viewport.zoom }) as never)
  vi.mocked(core.pan).mockImplementation(() => viewport.pan)
  // 기준 간격과 무관한 자리에 저장해도 그대로 복원한다.
  const saved = { "identity:alice": { x: -500, y: 110 }, "operation:GET /orders": { x: 1200, y: 220 }, "resource:order:1": { x: 2600, y: 330 } }
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: false, viewport: null, positions: saved }
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  const expectSaved = () => expect(nodes.map((node) => node.position())).toEqual(nodes.map((node) => saved[node.id() as keyof typeof saved]))
  expectSaved()

  viewport = { zoom: 1.6, pan: { x: -250, y: 31 } }
  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()
  expectSaved()

  viewport = { zoom: 0.7, pan: { x: 84, y: -18 } }
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  expect(core.fit).toHaveBeenCalled()
  expectSaved()

  canvasWidth = 900
  settleResize()
  runScheduledFrame()
  expectSaved()

  const endpoint = nodes[1]
  endpoint.position({ x: 1800, y: 500 })
  listeners.get("dragfree:node")?.({ target: endpoint as never })
  expect(endpoint.position()).toEqual({ x: 1800, y: 500 })
})

it("re-anchors every node into its lane when the layout version changes", () => {
  const viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = [
    createStatefulNode("identity:alice", "identity", { x: -500, y: 110 }, () => viewport),
    createStatefulNode("operation:GET /orders", "operation", { x: 5000, y: 220 }, () => viewport),
    createStatefulNode("resource:order:1", "resource", { x: 900, y: 330 }, () => viewport),
  ]
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((current) => callback(current as never)) }))
  vi.mocked(core.zoom).mockReturnValue(1)
  vi.mocked(core.pan).mockReturnValue(viewport.pan)
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: false, viewport: null, positions: Object.fromEntries(nodes.map((node) => [node.id(), node.position()])) }
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} layoutVersion={1} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(nodes.map((node) => node.position().x)).toEqual([180, 540, 900])
})

it("keeps the full zoom range because lanes scale with the viewport", () => {
  let viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = [createStatefulNode("identity:alice", "identity", { x: 180, y: 110 }, () => viewport)]
  canvasWidth = 900
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((current) => callback(current as never)) }))
  vi.mocked(core.zoom).mockImplementation(((next?: number) => { if (next !== undefined) viewport = { ...viewport, zoom: next }; return viewport.zoom }) as never)
  vi.mocked(core.pan).mockImplementation(() => viewport.pan)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  // preset/fit도 저장 API와 같은 범위를 사용해야 범위 밖 viewport가 게시되지 않는다.
  expect(vi.mocked(cytoscape)).toHaveBeenLastCalledWith(expect.objectContaining({ minZoom: 0.4, maxZoom: 2 }))
  viewport = { ...viewport, zoom: 2 }
  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()

  expect(core.maxZoom).not.toHaveBeenCalledWith(expect.any(Number))
  expect(viewport.zoom).toBe(2)
  expect(nodes[0].position().x).toBe(180)
})

it("preserves the actual Cytoscape selection through preferences, zoom, fit, resize, and lock changes", () => {
  const onPreferencesChange = vi.fn()
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} selectedElementId={null} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  node.select()
  expect(node.selected()).toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} selectedElementId="identity:alice" preferences={{ version: 7, inputMode: "auto", positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: false }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "preferences").toBe(true)

  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()
  expect(node.selected(), "zoom").toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} selectedElementId="identity:alice" preferences={{ version: 7, inputMode: "auto", positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: false }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "fit").toBe(true)

  settleResize()
  runScheduledFrame()
  expect(node.selected(), "resize").toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked fitVersion={1} selectedElementId="identity:alice" preferences={{ version: 7, inputMode: "auto", positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: true }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "lock").toBe(true)
})

it("places route candidates in the ENDPOINT lane", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "route-candidate" : undefined)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(node.position).toHaveBeenCalledWith({ x: 540, y: expect.any(Number) })
})

it("draws every observed source with one neutral edge and marks the accessing sources on the node cards", () => {
  const mixed: GraphProjection = {
    ...projection,
    edges: [
      { ...projection.edges[0], id: "human-edge" },
      { ...projection.edges[0], id: "scanner-edge", source: "scanner", sourceText: "SCANNER", line: "dashed", color: "#dc2626", countLabel: "" },
      { ...projection.edges[0], id: "llm-edge", source: "llm", sourceText: "LLM", line: "dotted", color: "#facc15", countLabel: "" },
    ],
  }
  render(<CytoscapeGraph projection={mixed} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; color?: string; line?: string; label?: string; accessibleLabel?: string; cardImage?: string } }>
  for (const id of ["human-edge", "scanner-edge", "llm-edge"]) {
    expect(added.find((element) => element.data.id === id)?.data).toEqual(expect.objectContaining({ color: "#94a3b8", line: "solid", label: "" }))
  }
  const operation = added.find((element) => element.data.id === "operation:GET /orders")!.data
  expect(operation.accessibleLabel).toContain("접근 주체 HUMAN, SCANNER, LLM")
  const svg = decodeURIComponent(operation.cardImage!.replace(/^data:image\/svg\+xml,/, ""))
  for (const color of ["#60a5fa", "#f87171", "#facc15"]) expect(svg).toContain(`stroke="${color}"`)
})

it("redraws node cards and edges for the light theme instead of keeping dark cards on a white canvas", () => {
  document.documentElement.classList.remove("dark")
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; color?: string; cardColor?: string; cardImage?: string } }>
  expect(added.find((element) => element.data.id === "edge")?.data.color).toBe("#64748b")
  const operation = added.find((element) => element.data.id === "operation:GET /orders")!.data
  expect(operation.cardColor).toBe("#ffffff")
  const svg = decodeURIComponent(operation.cardImage!.replace(/^data:image\/svg\+xml,/, ""))
  expect(svg).toContain('fill="#ffffff" stroke="#94a3b8"')
  expect(svg).not.toContain("#111418")
})

it("clears the selection when the empty canvas is tapped or Esc is pressed, not when a node is tapped", () => {
  const clear = vi.fn()
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onClearSelection={clear} onPreferencesChange={vi.fn()} />)
  listeners.get("tap:core")?.({ target: node })
  expect(clear).not.toHaveBeenCalled()
  listeners.get("tap:core")?.({ target: core as never })
  expect(clear).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(screen.getByLabelText("공격면 Cytoscape 그래프"), { key: "Escape" })
  expect(clear).toHaveBeenCalledTimes(2)
  // 마우스로 고른 뒤 포커스가 body에 있어도 Esc가 선택을 푼다.
  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(clear).toHaveBeenCalledTimes(3)
})

it("dims everything except the clicked node and its direct neighbours", () => {
  const cells = ["orders", "posts"].map(key => ({ idn: "USER A", op: `GET /api/${key}/{id}`, resource: `${key}:1`, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [] }))
  const hierarchy = projectHierarchy(targetSnapshot({ cells }), { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  const [orders, posts] = hierarchy.nodes.filter(item => item.kind === "api-group")
  render(<CytoscapeGraph projection={hierarchy} selectedElementId={orders.id} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; source?: string; target?: string; focused?: string } }>
  const focusOf = (id: string) => added.find(element => element.data.id === id)?.data.focused
  expect(focusOf(orders.id)).toBe("yes")
  expect(focusOf(hierarchy.nodes.find(item => item.kind === "target")!.id)).toBe("yes")
  expect(focusOf(posts.id)).toBe("no")
  expect(added.find(element => element.data.target === orders.id)?.data.focused).toBe("yes")
  expect(added.find(element => element.data.target === posts.id)?.data.focused).toBe("no")
})

it("highlights every identity that reached a clicked object, not only its API edge", () => {
  const cell = (idn: string, resource: string) => ({ idn, op: "GET /api/orders/{id}", resource, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [] })
  const snapshot = targetSnapshot({ cells: [cell("USER A", "orders:101"), cell("USER B", "orders:101"), cell("USER C", "orders:202")] })
  const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
  const site = { level: "site" as const, groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  const groupId = projectHierarchy(snapshot, filters, site).nodes.find(item => item.kind === "api-group")!.groupId!
  const hierarchy = projectHierarchy(snapshot, filters, { ...site, level: "operation", groupId, operation: "GET /api/orders/{id}" })
  const object = hierarchy.resources.find(item => item.selection.resource === "orders:101")!
  render(<CytoscapeGraph projection={hierarchy} selectedElementId={object.id} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused?: string } }>
  const focusOf = (identity: string) => added.find(element => element.data.id === hierarchy.identities.find(item => item.selection.identity === identity)?.id)?.data.focused
  expect(focusOf("USER A")).toBe("yes")
  expect(focusOf("USER B")).toBe("yes")
  expect(focusOf("USER C")).toBe("no")
})

it("keeps unconfirmed route candidates neutral and dotted", () => {
  const candidateProjection: GraphProjection = {
    ...projection,
    routeCandidates: [{ id: "route-candidate:review", label: "UNKNOWN /unseen", service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen", observed: false, observedText: "미관측 후보", applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: [], provenance: [], reviewReason: "검토 필요", priorityReasons: [], selection: { operation: "UNKNOWN /unseen", resource: null, identity: null, source: "human", evidenceIds: [] } }],
  }
  render(<CytoscapeGraph projection={candidateProjection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  const addedElements = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; confirmed?: string } }>
  expect(addedElements.find((element) => element.data.id === "route-candidate:review")?.data.confirmed).toBe("no")
  expect(vi.mocked(cytoscape)).toHaveBeenCalledWith(expect.objectContaining({ style: expect.arrayContaining([
    expect.objectContaining({ selector: 'node[kind = "route-candidate"]', style: expect.objectContaining({ "border-style": "dotted", "border-color": "#64748b" }) }),
  ]) }))
})

it("renders a response-backed non-cell GET as a neutral graph node", () => {
  const service = "https://api.example.test"
  const snapshot = targetSnapshot({ events: [{
    eventId: "observed-1", method: "GET", path: "/account/edit?ticket=alpha", status: 200, fp: "", idn: "alice", role: "USER", source: "human", op: `${service} GET /account/edit`, resource: null, timestamp: 1,
    sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", coverageEligible: false,
    classificationOverride: false, classificationReasons: ["AMBIGUOUS_KEEP"], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["observed-1"], objects: [], verdict: "untested",
  }] })
  // 허용만 있는 기능은 "신호 없는 기능"으로 접히므로 그 묶음을 펼친 상태에서 본다.
  const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false, expandedObjectGroups: ['quiet-group:["https://api.example.test","account"]'] }
  const site = projectHierarchy(snapshot, filters, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  const group = projectHierarchy(snapshot, filters, { ...site.navigation, level: "group", groupId: site.groups[0].id })
  render(<CytoscapeGraph projection={group} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; kind?: string; accessibleLabel?: string; confirmed?: string } }>
  expect(added).toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({
    id: `observed-operation:${service} GET /account/edit`, kind: "observed-operation", accessibleLabel: expect.stringContaining("응답 관측"), confirmed: "no",
  }) })]))
})

it("publishes a bounded node-kind geometry snapshot only through the explicit browser test seam", () => {
  window.history.replaceState({}, "", "/?flowscope-e2e-geometry=1")
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  const snapshot = JSON.parse(screen.getByLabelText("공격면 Cytoscape 그래프").getAttribute("data-graph-geometry") ?? "null") as { width: number; maxZoom: number; nodes: Array<{ id: string; kind: string; index: number; selected: boolean; center: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number } }> }
  expect(snapshot.width).toBe(900)
  expect(snapshot.maxZoom).toBe(2)
  expect(snapshot.nodes).toEqual([{ id: "identity:alice", kind: "identity", index: 0, selected: false, center: { x: 700, y: 120 }, bounds: { left: 587, right: 813, top: 57, bottom: 183 } }])
})

it("renders neutral Target→Group nodes in two lanes, selects on tap and navigates on double tap", () => {
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [{ idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["raw-evidence"] }] }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "target" : undefined)
  const navigate = vi.fn()
  const select = vi.fn()
  render(<CytoscapeGraph projection={hierarchy} locked={false} fitVersion={0} onNavigate={navigate} onSelect={select} onPreferencesChange={vi.fn()} />)
  expect(node.position).toHaveBeenCalledWith({ x: 180, y: expect.any(Number) })
  const elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; label: string; accessibleLabel?: string; kind: string } }>
  expect(elements.find(item => item.data.kind === "api-group")?.data.accessibleLabel).toContain("ORDERS APIs")
  expect(elements.find(item => item.data.kind === "api-group")?.data.accessibleLabel).toContain("1 APIs")
  expect(elements.find(item => item.data.id === hierarchy.edges[0].id)?.data.label).toBe("")
  // 한 번 누르면 정보만 열고 이동하지 않는다.
  listeners.get("tap:node, edge")?.({ target: { id: () => hierarchy.listItems[0].id } as never })
  expect(select).toHaveBeenCalledWith(hierarchy.listItems[0].selection, hierarchy.listItems[0].id)
  expect(navigate).not.toHaveBeenCalled()
  listeners.get("dbltap:node")?.({ target: { id: () => hierarchy.listItems[0].id } as never })
  expect(navigate).toHaveBeenCalledWith(hierarchy.listItems[0])
  // Target은 열 곳이 없어 더블클릭해도 이동하지 않는다.
  navigate.mockClear()
  listeners.get("dbltap:node")?.({ target: { id: () => hierarchy.nodes.find(item => item.kind === "target")!.id } as never })
  expect(navigate).not.toHaveBeenCalled()
})

it("marks only the selected identity's source paths and passes the exact raw edge selection", () => {
  const cell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const, scanner: "deny" as const }, reasons: {}, overall: "undecided" as const, conflict: true, missedSources: [], evidenceIds: ["raw-h", "raw-s"] }
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [cell, { ...cell, idn: "USER B", resource: "orders:202", evidenceIds: ["b-h"] }] }), { source: ["human", "scanner"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "operation", groupId: '["Target","orders"]', operation: cell.op, operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  const select = vi.fn()
  render(<CytoscapeGraph projection={hierarchy} locked={false} fitVersion={0} selectedElementId="identity:USER A" onSelect={select} onPreferencesChange={vi.fn()} />)
  const elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused?: string } }>
  for (const edge of hierarchy.edges) expect(elements.find(item => item.data.id === edge.id)?.data.focused).toBe(edge.selection.identity === "USER A" ? "yes" : "no")
  const edge = hierarchy.edges.find(item => item.relation === "operation-resource" && item.source === "scanner" && item.selection.identity === "USER A")!
  listeners.get("tap:node, edge")?.({ target: { id: () => edge.id } as never })
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ operation: cell.op, identity: "USER A", resource: "orders:101", source: "scanner", cells: [cell], cellKeys: ['["USER A","GET /api/orders/{id}","orders:101"]'], evidenceIds: ["raw-h", "raw-s"], gapIds: [] }), edge.id)
})

it.each(["site", "group", "operation"] as const)("keeps locked %s positions unchanged across saved viewport, zoom and fit", (level) => {
  const cell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["raw"] }
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [cell] }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level, groupId: '["Target","orders"]', operation: cell.op, operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  let viewport = { zoom: 2, pan: { x: -1900, y: 100 } }
  const nodes = hierarchy.nodes.map(item => createStatefulNode(item.id, item.kind, { x: -999, y: 125 }, () => viewport))
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach(current => callback(current as never)) }))
  vi.mocked(core.zoom).mockImplementation(((next?: number) => { if (next !== undefined) viewport = { ...viewport, zoom: next }; return viewport.zoom }) as never)
  vi.mocked(core.pan).mockImplementation(() => viewport.pan)
  vi.mocked(core.viewport).mockImplementation(((next: typeof viewport) => { viewport = next }) as never)
  const preferences = { version: 7 as const, inputMode: "auto" as const, locked: true, positions: Object.fromEntries(nodes.map(node => [node.id(), { x: 9999, y: 125 }])), viewport }
  const { rerender } = render(<CytoscapeGraph projection={hierarchy} locked fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const assertSaved = () => nodes.forEach(node => {
    expect(node.position()).toEqual({ x: 9999, y: 125 })
    expect(node.locked()).toBe(true)
  })
  runScheduledFrame(); assertSaved()
  viewport = { zoom: 2, pan: { x: 3000, y: 0 } }
  listeners.get("viewport:core")?.({ target: node }); runScheduledFrame(); assertSaved()
  viewport = { zoom: 0.7, pan: { x: -3000, y: 0 } }
  rerender(<CytoscapeGraph projection={hierarchy} locked fitVersion={1} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame(); assertSaved()
})

it("focuses only the exact neutral candidate path after direct Gap navigation", () => {
  const cell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["raw"] }
  const gaps = [{ id: "gap-exact", type: "UNCROSSED", idn: "USER B", op: cell.op, resource: "orders:202", risk: 1, summary: "server", missedSources: [] }]
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [cell], gaps }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "operation", groupId: '["Target","orders"]', operation: cell.op, operationLimit: 18, objectLimit: 18, focusCandidateKey: '["USER B","GET /api/orders/{id}","orders:202"]' })
  render(<CytoscapeGraph projection={hierarchy} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused: string; color: string; label: string } }>
  for (const edge of hierarchy.edges) {
    const rendered = elements.find(item => item.data.id === edge.id)!.data
    expect(rendered.focused).toBe(edge.relation === "candidate" ? "yes" : "no")
    if (edge.relation === "candidate") { expect(rendered.color).toBe("#6b7280"); expect(rendered.label).toBe("") }
  }
  expect(vi.mocked(cytoscape)).toHaveBeenCalledWith(expect.objectContaining({ style: expect.arrayContaining([expect.objectContaining({ selector: "edge:selected", style: expect.objectContaining({ "line-color": "data(color)", "target-arrow-color": "data(color)" }) })]) }))
})

it("gives selected canvas edges priority over candidate navigation and matches canonical source cells", () => {
  const cell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const, scanner: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["raw"] }
  const gaps = [303, 404].map(resource => ({ id: `gap-${resource}`, type: "UNCROSSED", idn: "USER B", op: cell.op, resource: `orders:${resource}`, risk: 1, summary: "server", missedSources: [] }))
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [cell, { ...cell, resource: "orders:202" }, { ...cell, idn: "USER B" }], gaps }), { source: ["human", "scanner"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "operation", groupId: '["Target","orders"]', operation: cell.op, operationLimit: 18, objectLimit: 18, focusCandidateKey: '["USER B","GET /api/orders/{id}","orders:303"]' })
  const observed = hierarchy.edges.find(edge => edge.relation === "operation-resource" && edge.selection.identity === "USER A" && edge.selection.resource === "orders:202" && edge.source === "scanner")!
  const tree = (selected: string) => <CytoscapeGraph projection={hierarchy} selectedElementId={selected} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />
  const { rerender } = render(tree(observed.id))
  let elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused: string } }>
  const focused = hierarchy.edges.filter(edge => elements.find(item => item.data.id === edge.id)?.data.focused === "yes")
  expect(focused).toHaveLength(2)
  expect(focused.every(edge => edge.source === "scanner" && edge.selection.identity === "USER A")).toBe(true)
  expect(focused.some(edge => edge.id === observed.id)).toBe(true)
  const candidate = hierarchy.edges.find(edge => edge.relation === "candidate" && edge.selection.resource === "orders:404")!
  // 선택이 바뀌어도 요소를 다시 만들지 않는다(깜빡임 방지). 강조 결과는 새로 그린 상태로 확인한다.
  const adds = core.add.mock.calls.length
  rerender(tree(candidate.id))
  expect(core.add.mock.calls.length).toBe(adds)
  cleanup()
  render(tree(candidate.id))
  elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused: string } }>
  for (const edge of hierarchy.edges) expect(elements.find(item => item.data.id === edge.id)?.data.focused).toBe(edge.relation === "candidate" && edge.selection.resource === "orders:404" ? "yes" : "no")
})

it("draws every edge as a rightward orthogonal line with slightly rounded corners", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const options = vi.mocked(cytoscape).mock.calls.at(-1)?.[0] as unknown as { style: Array<{ selector: string; style: Record<string, unknown> }> }
  const edge = options.style.find(rule => rule.selector === "edge")
  expect(edge?.style).toMatchObject({ "curve-style": "round-taxi", "taxi-direction": "rightward", "taxi-radius": 4 })
  expect(options.style.some(rule => rule.style["curve-style"] === "bezier")).toBe(false)
})

/** routeEdges 결과를 절대 좌표 꺾은선(시작점, 꺾는 점들, 끝점)으로 되돌린다. */
function routePoints(nodes: ReadonlyMap<string, RouteNode>, edge: { source: string; target: string }, route: Record<string, string>) {
  const endpoint = (node: RouteNode, value: string) => { const [x, y] = value.split(" ").map(parseFloat); return { x: node.x + x, y: node.y + y } }
  const start = endpoint(nodes.get(edge.source)!, route["source-endpoint"]), end = endpoint(nodes.get(edge.target)!, route["target-endpoint"])
  if (route["curve-style"] === "straight") return [start, end]
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
  const weights = route["segment-weights"].split(" ").map(Number), distances = route["segment-distances"].split(" ").map(Number)
  return [start, ...weights.map((w, i) => ({ x: start.x + w * dx - distances[i] * dy / length, y: start.y + w * dy + distances[i] * dx / length })), end]
}

it("bundles edges: one port per node, one trunk per source, separate trunks for different sources", () => {
  const nodes = new Map<string, RouteNode>([
    ["alice", { x: 0, y: 0, width: 100, height: 40, lane: 0 }],
    ["bob", { x: 0, y: 200, width: 100, height: 40, lane: 0 }],
    ["orders", { x: 400, y: 100, width: 200, height: 80, lane: 1 }],
    ["users", { x: 400, y: 300, width: 120, height: 80, lane: 1 }],
  ])
  const edges = [
    { id: "a-o", source: "alice", target: "orders", split: null },
    { id: "a-u", source: "alice", target: "users", split: null },
    { id: "b-o", source: "bob", target: "orders", split: null },
  ]
  const routes = routeEdges(nodes, edges)
  const lines = new Map(edges.map(edge => [edge.id, routePoints(nodes, edge, routes.get(edge.id)!)]))
  for (const points of lines.values()) for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true)
  }
  // alice의 두 엣지는 옆면 가운데 한 점에서 나가고, orders로 들어오는 두 엣지는 옆면 가운데 한 점에서 합쳐진다.
  expect(lines.get("a-o")![0]).toEqual(lines.get("a-u")![0])
  expect(lines.get("a-o")![0].y).toBeCloseTo(0)
  expect(lines.get("a-o")!.at(-1)).toEqual(lines.get("b-o")!.at(-1))
  expect(lines.get("a-o")!.at(-1)!.y).toBeCloseTo(100)
  // 같은 레인으로 들어가는 alice·bob의 세로 줄기는 서로 다른 x에 선다.
  expect(lines.get("a-o")![1].x).not.toBeCloseTo(lines.get("b-o")![1].x)
  expect(lines.get("a-o")![1].x).toBeCloseTo(lines.get("a-u")![1].x)
})

it("shifts endpoints and trunk together when parallel sources split, and falls back when nodes are too close", () => {
  const nodes = new Map<string, RouteNode>([
    ["alice", { x: 0, y: 0, width: 100, height: 40, lane: 0 }],
    ["orders", { x: 400, y: 100, width: 200, height: 80, lane: 1 }],
    ["near", { x: 90, y: 0, width: 60, height: 40, lane: 2 }],
  ])
  const edges = [
    { id: "human", source: "alice", target: "orders", split: -0.5 },
    { id: "scanner", source: "alice", target: "orders", split: 0.5 },
    { id: "near", source: "alice", target: "near", split: null },
  ]
  const routes = routeEdges(nodes, edges)
  const human = routePoints(nodes, edges[0], routes.get("human")!), scanner = routePoints(nodes, edges[1], routes.get("scanner")!)
  human.forEach((point, index) => {
    expect(scanner[index].y - point.y).toBeCloseTo(6)
    if (index > 0 && index < human.length - 1) expect(scanner[index].x - point.x).toBeCloseTo(6)
  })
  expect(routes.get("near")).toBeNull()
})

it("reads minimap boxes in model space with the current viewport and dims filtered-out nodes", () => {
  const fakeNode = (id: string, x: number, y: number, hl?: string) => ({ id: () => id, position: () => ({ x, y }), data: (key: string) => key === "width" ? 200 : key === "height" ? 60 : key === "hl" ? hl : undefined })
  const nodes = [fakeNode("a", 100, 100), fakeNode("b", 500, 300, "no")]
  const core = { extent: () => ({ x1: 0, y1: 0, w: 400, h: 200 }), nodes: () => ({ forEach: (callback: (node: ReturnType<typeof fakeNode>) => void) => nodes.forEach(callback) }) }
  const view = readMinimap(core as unknown as Parameters<typeof readMinimap>[0])!
  expect(view.nodes.map(node => [node.id, node.x, node.y, node.dim])).toEqual([["a", 0, 70, false], ["b", 400, 270, true]])
  expect(view.box).toEqual({ x: -40, y: 30, w: 680, h: 340 })
  expect(view.view).toEqual({ x: 0, y: 0, w: 400, h: 200 })
  expect(readMinimap({ nodes: () => ({ forEach: () => undefined }) } as unknown as Parameters<typeof readMinimap>[0])).toBeNull()
})

it("opens and closes an object group from a double click or Enter instead of navigating", () => {
  const snapshot = targetSnapshot({ cells: [{ idn: "alice", op: "https://api.example.test GET /orders/{id}", resource: "orders:1", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["e-1"] }] })
  // 허용만 있는 기능은 "신호 없는 기능"으로 접히므로 그 묶음을 펼친 상태에서 본다.
  const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false, expandedObjectGroups: ['quiet-group:["https://api.example.test","orders"]'] }
  const site = projectHierarchy(snapshot, filters, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  const group = projectHierarchy(snapshot, filters, { ...site.navigation, level: "group", groupId: site.groups[0].id })
  const groupNode = group.nodes.find(node => node.kind === "object-group")!
  const onToggleObjectGroup = vi.fn(), onNavigate = vi.fn()
  render(<CytoscapeGraph projection={group} locked={false} fitVersion={0} onSelect={vi.fn()} onNavigate={onNavigate} onToggleObjectGroup={onToggleObjectGroup} onPreferencesChange={vi.fn()} />)
  act(() => listeners.get("dbltap:node")?.({ target: { ...node, id: vi.fn(() => groupNode.id) } }))
  expect(onToggleObjectGroup).toHaveBeenCalledWith(groupNode.id)
  expect(onNavigate).not.toHaveBeenCalled()
})


it("wraps each expanded object group and its members in one screen-space band for the fold controls", () => {
  const fakeNode = (id: string, data: Record<string, string>, box: { x1: number; y1: number; x2: number; y2: number }) => ({ id: () => id, data: (key: string) => data[key], renderedBoundingBox: () => box })
  const nodes = [
    fakeNode("object-group:svc|summary", { groupState: "open", groupKey: "summary" }, { x1: 100, y1: 50, x2: 300, y2: 110 }),
    fakeNode("resource:summary:1", { memberOf: "object-group:svc|summary" }, { x1: 100, y1: 130, x2: 320, y2: 190 }),
    fakeNode("resource:summary:2", { memberOf: "object-group:svc|summary" }, { x1: 100, y1: 210, x2: 300, y2: 270 }),
    fakeNode("object-group:svc|stms", { groupState: "closed", groupKey: "stms" }, { x1: 100, y1: 300, x2: 300, y2: 360 }),
    fakeNode("resource:other:1", {}, { x1: 100, y1: 380, x2: 300, y2: 440 }),
  ]
  const core = { nodes: () => ({ toArray: () => nodes }) }
  expect(readGroupBands(core as unknown as Parameters<typeof readGroupBands>[0])).toEqual([
    { id: "object-group:svc|summary", label: "summary", count: 2, x1: 100, y1: 50, x2: 320, y2: 270 },
  ])
})

it("keeps the expanded ID → API → OBJ focus, theme canvas, and layout through theme switches", async () => {
  const cell = { idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: ["a"] }
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [cell, { ...cell, idn: "USER B", resource: "orders:202", evidenceIds: ["b"] }, { ...cell, idn: "USER C", op: "GET /api/orders/profile", resource: "user-profile:1", evidenceIds: ["c"] }] }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false, expandedObjectGroups: ["object-group:|orders", 'quiet-group:["Target","orders"]'] }, { level: "group", groupId: '["Target","orders"]', operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  const group = hierarchy.nodes.find(node => node.kind === "object-group" && node.objectGroup?.key === "orders")!
  const focus = graphFocusStates(hierarchy, "resource:orders:101", group.id)
  expect(focus.node("resource:orders:101")).toBe("yes")
  expect(focus.node("resource:orders:202")).toBe("yes")
  for (const identity of hierarchy.identities) expect(focus.node(identity.id)).toBe(identity.selection.identity === "USER C" ? "no" : "yes")
  for (const edge of hierarchy.edges) expect(focus.edge(edge.id)).toBe(edge.selection.identity === "USER C" ? "no" : "yes")
  expect(hierarchy.edges.some(edge => edge.relation === "identity-operation")).toBe(true)
  expect(hierarchy.edges.some(edge => edge.relation === "operation-resource")).toBe(true)

  const pan = { x: 81, y: -40 }
  currentZoom = 0.7
  vi.mocked(core.pan).mockReturnValue(pan)
  const props = { projection: hierarchy, selectedElementId: "resource:orders:101", openObjectGroupId: group.id, locked: false, fitVersion: 0, onSelect: vi.fn(), onPreferencesChange: vi.fn() }
  const { rerender } = render(<CytoscapeGraph {...props} />)
  modelPosition = { x: 1400, y: 500 }
  const expectThemeFocus = (cardColor: string) => {
    const canvas = screen.getByLabelText("공격면 Cytoscape 그래프")
    expect(canvas.parentElement).toHaveClass("bg-[var(--flowscope-canvas)]")
    expect(canvas.parentElement?.style.backgroundColor).toBe("")
    const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; objectFocus: string; cardColor?: string } }>
    for (const node of hierarchy.nodes.filter(node => !node.hiddenInGraph && node.kind !== "route-candidate")) {
      expect(added.find(element => element.data.id === node.id)?.data).toEqual(expect.objectContaining({ objectFocus: focus.node(node.id), cardColor }))
    }
    for (const edge of hierarchy.edges) expect(added.find(element => element.data.id === edge.id)?.data.objectFocus).toBe(focus.edge(edge.id))
    expect(modelPosition).toEqual({ x: 1400, y: 500 })
    expect(currentZoom).toBe(0.7)
  }
  expectThemeFocus("#111418")
  for (const theme of ["light", "dark"] as const) {
    await act(async () => { document.documentElement.classList.toggle("dark", theme === "dark") })
    expectThemeFocus(theme === "light" ? "#ffffff" : "#111418")
    expect(core.viewport).toHaveBeenLastCalledWith({ zoom: 0.7, pan })
  }
  expect(core.fit).not.toHaveBeenCalled()
  remove.mockClear(); vi.mocked(core.add).mockClear()
  rerender(<CytoscapeGraph {...props} selectedElementId="resource:orders:202" />)
  expect(remove).not.toHaveBeenCalled()
  expect(core.add).not.toHaveBeenCalled()
})

it("marks judged and observed-only members of an opened quiet card and names its fold control in words", () => {
  const service = "https://api.example.test"
  const page = { eventId: "p-1", clusterEvidenceIds: ["p-1"], method: "GET", path: "/orders/help.php", status: 200, op: `${service} GET /orders/help.php`, idn: "alice", source: "human", resource: null, phase: "EXPLORATION", executionTrust: "OBSERVED", trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE", classificationOverride: false, classificationReasons: [] } as unknown as EventRecord
  const snapshot = targetSnapshot({ events: [page], cells: [{ idn: "alice", op: `${service} GET /orders/list`, resource: null, perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["e-1"] }] })
  const groupId = JSON.stringify([service, "orders"]), quietId = `quiet-group:${groupId}`
  const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false, expandedObjectGroups: [quietId] }
  const group = projectHierarchy(snapshot, filters, { level: "group", groupId, operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  render(<CytoscapeGraph projection={group} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const added = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; memberOf?: string; groupKey?: string; temporaryObjectPosition?: string } }>
  // 접기 버튼 이름은 내부 묶음 ID(JSON) 대신 읽을 수 있는 이름을 쓴다.
  expect(added.find(item => item.data.id === quietId)?.data.groupKey).toBe("신호 없는 기능")
  for (const id of [`operation:${service} GET /orders/list`, `observed-operation:${service} GET /orders/help.php`]) {
    expect(added.find(item => item.data.id === id)?.data).toMatchObject({ memberOf: quietId, temporaryObjectPosition: "yes" })
  }
})
