import { act, fireEvent, render, screen } from "@testing-library/react"
import cytoscape from "cytoscape"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { CytoscapeGraph, graphWheelIntent } from "./CytoscapeGraph"
import type { GraphProjection } from "./graphProjection"
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
  elements: vi.fn(() => ({ remove, unselect })),
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

afterEach(() => { vi.mocked(core.nodes).mockImplementation(singleNodeCollection) })

function runScheduledFrame() {
  const callback = scheduledFrame
  scheduledFrame = null
  callback?.(0)
}

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
  expect(core.on).toHaveBeenCalledTimes(5)
  unmount()
  expect(core.off).toHaveBeenCalledTimes(5)
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
    id: "operation:GET /orders", cardImage: expect.stringMatching(/^data:image\/svg\+xml,/), accessibleLabel: "GET /orders; Operation; verdict ALLOW; 접근 주체 HUMAN", width: 196, height: 88, confirmed: "no",
  }) })]))
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(core.fit).toHaveBeenCalledTimes(1)
})

it("shows complete card text from pointer and keyboard focus and selects the focused node", () => {
  const longLabel = `alice-${"very-long-identity-segment-".repeat(40)}END`
  const identity = { id: "identity:alice", kind: "identity" as const, label: longLabel, wrappedLabel: longLabel, verdict: "allow" as const, verdictText: "ALLOW", verdictColor: "#15803d", selection: { operation: "GET /orders", resource: null, identity: longLabel, source: "human" as const, evidenceIds: ["e-1"] } }
  const graph: GraphProjection = { ...projection, identities: [identity], operations: [], edges: [] }
  const onSelect = vi.fn()
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "identity" : key === "accessibleLabel" ? `Identity ${longLabel}; verdict ALLOW; 1 Evidence` : undefined)
  render(<CytoscapeGraph projection={graph} locked={false} fitVersion={0} onSelect={onSelect} onPreferencesChange={vi.fn()} />)

  act(() => { listeners.get("mouseover focus:node")?.({ target: node, type: "mouseover" }) })
  expect(screen.getByRole("tooltip")).toHaveTextContent(longLabel)
  expect(screen.getByRole("tooltip")).toHaveTextContent("1 Evidence")

  const canvas = screen.getByLabelText("공격면 Cytoscape 그래프")
  fireEvent.focus(canvas)
  fireEvent.keyDown(canvas, { key: "Enter" })
  expect(node.addClass).toHaveBeenCalledWith("keyboard-focus")
  expect(onSelect).toHaveBeenCalledWith(identity.selection, "identity:alice")
})

it("dismisses an open full-text card tooltip when the projection changes", () => {
  const identity = { id: "identity:alice", kind: "identity" as const, label: "alice", wrappedLabel: "alice", verdict: "allow" as const, verdictText: "ALLOW", verdictColor: "#15803d", selection: { operation: "GET /orders", resource: null, identity: "alice", source: "human" as const, evidenceIds: ["e-1"] } }
  const graph: GraphProjection = { ...projection, identities: [identity], operations: [], edges: [] }
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "identity" : key === "accessibleLabel" ? "Identity alice; verdict ALLOW; 1 Evidence" : undefined)
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
      expect.objectContaining({ selector: "node", style: expect.objectContaining({ "background-color": "#111418", color: "#e5e7eb" }) }),
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

it("keeps node coordinates when the graph container is resized", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  modelPosition = { x: 200, y: 55 }
  node.position.mockClear()
  canvasWidth = 600

  resizeListener?.([], {} as ResizeObserver)
  runScheduledFrame()

  expect(core.resize).toHaveBeenCalled()
  expect(modelPosition).toEqual({ x: 200, y: 55 })
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
  resizeListener?.([], {} as ResizeObserver)
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

  resizeListener?.([], {} as ResizeObserver)
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
      { ...projection.edges[0], id: "llm-edge", source: "llm", sourceText: "LLM", line: "dotted", color: "#e4e4e7", countLabel: "" },
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
  for (const color of ["#60a5fa", "#f87171", "#e4e4e7"]) expect(svg).toContain(`stroke="${color}"`)
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

it("publishes a bounded node-kind geometry snapshot only through the explicit browser test seam", () => {
  window.history.replaceState({}, "", "/?flowscope-e2e-geometry=1")
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  const snapshot = JSON.parse(screen.getByLabelText("공격면 Cytoscape 그래프").getAttribute("data-graph-geometry") ?? "null") as { width: number; maxZoom: number; nodes: Array<{ id: string; kind: string; index: number; selected: boolean; center: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number } }> }
  expect(snapshot.width).toBe(900)
  expect(snapshot.maxZoom).toBe(2)
  expect(snapshot.nodes).toEqual([{ id: "identity:alice", kind: "identity", index: 0, selected: false, center: { x: 700, y: 120 }, bounds: { left: 587, right: 813, top: 57, bottom: 183 } }])
})

it("renders neutral Target→Group nodes in two lanes and navigates by the original node", () => {
  const hierarchy = projectHierarchy(targetSnapshot({ cells: [{ idn: "USER A", op: "GET /api/orders/{id}", resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["raw-evidence"] }] }), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "target" : undefined)
  const navigate = vi.fn()
  render(<CytoscapeGraph projection={hierarchy} locked={false} fitVersion={0} onNavigate={navigate} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(node.position).toHaveBeenCalledWith({ x: 180, y: expect.any(Number) })
  const elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; label: string; accessibleLabel?: string; kind: string } }>
  expect(elements.find(item => item.data.kind === "api-group")?.data.accessibleLabel).toContain("ORDERS APIs")
  expect(elements.find(item => item.data.kind === "api-group")?.data.accessibleLabel).toContain("1 APIs · H 1 / S 0 / L 0")
  expect(elements.find(item => item.data.id === hierarchy.edges[0].id)?.data.label).toBe("")
  listeners.get("tap:node, edge")?.({ target: { id: () => hierarchy.listItems[0].id } as never })
  expect(navigate).toHaveBeenCalledWith(hierarchy.listItems[0])
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
  rerender(tree(candidate.id))
  elements = core.add.mock.calls.at(-1)?.[0] as Array<{ data: { id: string; focused: string } }>
  for (const edge of hierarchy.edges) expect(elements.find(item => item.data.id === edge.id)?.data.focused).toBe(edge.relation === "candidate" && edge.selection.resource === "orders:404" ? "yes" : "no")
})
