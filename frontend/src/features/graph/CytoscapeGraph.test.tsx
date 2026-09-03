import { render, screen } from "@testing-library/react"
import cytoscape from "cytoscape"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { CytoscapeGraph } from "./CytoscapeGraph"
import { graphLaneForKind, laneGeometry } from "./graphLanes"
import type { GraphProjection } from "./graphProjection"

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
const listeners = new Map<string, (event: { target: typeof node }) => void>()
const node = {
  data: vi.fn((key: string) => key === "kind" ? "identity" : undefined),
  id: vi.fn(() => "identity:alice"),
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
  renderedOuterWidth: vi.fn(() => 186 * currentZoom),
  renderedOuterHeight: vi.fn(() => 60),
}
const singleNodeCollection = () => ({ forEach: (callback: (current: typeof node) => void) => callback(node) })
const core = {
  add: vi.fn(),
  destroy: vi.fn(),
  elements: vi.fn(() => ({ remove, unselect })),
  getElementById: vi.fn(() => ({ select: node.select })),
  nodes: vi.fn(singleNodeCollection),
  off: vi.fn(),
  on: vi.fn((event: string, selector: string | ((event: { target: typeof node }) => void), listener?: (event: { target: typeof node }) => void) => {
    listeners.set(`${event}:${typeof selector === "string" ? selector : "core"}`, typeof selector === "function" ? selector : listener!)
  }),
  maxZoom: vi.fn((next?: number) => { if (next !== undefined) currentMaxZoom = next; return currentMaxZoom }),
  zoom: vi.fn((next?: number) => { if (next !== undefined) currentZoom = next; return currentZoom }),
  pan: vi.fn(() => ({ x: 0, y: 0 })),
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
  vi.mocked(core.zoom).mockImplementation((next?: number) => { if (next !== undefined) currentZoom = next; return currentZoom })
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

function createStatefulNode(id: string, kind: "identity" | "operation" | "resource", initial: { x: number; y: number }, viewport: () => { zoom: number; pan: { x: number; y: number } }) {
  let model = { ...initial }
  return {
    data: (key: string) => key === "kind" ? kind : undefined,
    id: () => id,
    lock: vi.fn(),
    unlock: vi.fn(),
    position: (next?: { x: number; y: number }) => {
      if (next) model = { ...next }
      return model
    },
    renderedPosition: () => ({ x: model.x * viewport().zoom + viewport().pan.x, y: model.y * viewport().zoom + viewport().pan.y }),
    renderedOuterWidth: () => 186 * viewport().zoom,
    renderedOuterHeight: () => 60,
  }
}

function expectNodesInsideLanes(nodes: Array<ReturnType<typeof createStatefulNode>>, width: number) {
  for (const node of nodes) {
    const lane = laneGeometry(width, graphLaneForKind(String(node.data("kind"))))
    const center = node.renderedPosition()
    const halfWidth = node.renderedOuterWidth() / 2
    expect(center.x).toBeGreaterThanOrEqual(lane.left + halfWidth - 0.001)
    expect(center.x).toBeLessThanOrEqual(lane.right - halfWidth + 0.001)
  }
}

it("owns one Cytoscape instance and unregisters listeners before destroy on unmount", () => {
  const { rerender, unmount } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  rerender(<CytoscapeGraph projection={projection} locked fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(core.on).toHaveBeenCalledTimes(3)
  unmount()
  expect(core.off).toHaveBeenCalledTimes(3)
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1)
  expect(disconnectResizeObserver).toHaveBeenCalledTimes(1)
  expect(Math.max(...core.off.mock.invocationCallOrder)).toBeLessThan(core.destroy.mock.invocationCallOrder[0])
  expect(disconnectResizeObserver.mock.invocationCallOrder[0]).toBeLessThan(core.destroy.mock.invocationCallOrder[0])
  expect(core.destroy).toHaveBeenCalledTimes(1)
})

it("coalesces repeated viewport events into one lane-correction frame", () => {
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

it("updates elements through the owned instance API, renders source text with its repeat count, and fits on request", () => {
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(remove).toHaveBeenCalledTimes(1)
  expect(core.add).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ label: "HUMAN ×2" }) })]))
  expect(core.add).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ label: "GET /orders" }) })]))
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(core.fit).toHaveBeenCalledTimes(1)
})

it("renders a graph-first canvas with dark compact node styling", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(screen.getByLabelText("공격면 Cytoscape 그래프")).toHaveClass("h-full", "min-h-[28rem]")
  expect(vi.mocked(cytoscape)).toHaveBeenCalledWith(expect.objectContaining({
    style: expect.arrayContaining([
      expect.objectContaining({ selector: "node", style: expect.objectContaining({ "background-color": "#111418", color: "#e5e7eb" }) }),
      expect.objectContaining({ selector: "node:selected" }),
      expect.objectContaining({ selector: "edge", style: expect.objectContaining({ label: "data(label)", "text-rotation": "autorotate" }) }),
    ]),
  }))
})

it("anchors nodes in their semantic lane on initial projection", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "operation" : undefined)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(node.position).toHaveBeenCalledWith({ x: 450, y: expect.any(Number) })
})

it("restores unlocked Y while placing a saved endpoint back in its lane", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "operation" : undefined)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={{ version: 5, locked: false, viewport: null, positions: { "identity:alice": { x: -999, y: 222 } } }} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  expect(node.position).toHaveBeenCalledWith({ x: 450, y: 222 })
})

it("clamps rendered X after zoom and converts it back to model coordinates without changing Y", () => {
  vi.mocked(core.zoom).mockReturnValue(2)
  vi.mocked(core.pan).mockReturnValue({ x: 100, y: 30 })
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  modelPosition = { x: 350, y: 55 }
  node.position.mockClear()

  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()

  expect(node.position).toHaveBeenCalledWith({ x: 41.5, y: 55 })
})

it("reclamps nodes when the graph container is resized", () => {
  vi.mocked(core.zoom).mockReturnValue(2)
  vi.mocked(core.pan).mockReturnValue({ x: 100, y: 30 })
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  modelPosition = { x: 350, y: 55 }
  node.position.mockClear()
  canvasWidth = 600

  resizeListener?.([], {} as ResizeObserver)
  runScheduledFrame()

  expect(node.position).toHaveBeenCalledWith({ x: 0, y: 55 })
})

it("keeps dragfree X inside the current lane while preserving the dragged Y", () => {
  vi.mocked(core.zoom).mockReturnValue(2)
  vi.mocked(core.pan).mockReturnValue({ x: 100, y: 30 })
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  modelPosition = { x: 350, y: 210 }
  node.position.mockClear()

  listeners.get("dragfree:node")?.({ target: node })

  expect(node.position).toHaveBeenCalledWith({ x: 41.5, y: 210 })
})

it("keeps stateful identity, endpoint, and object centers in lane through restore, zoom, fit, resize, and diagonal drag", () => {
  let viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = [
    createStatefulNode("identity:alice", "identity", { x: -999, y: 0 }, () => viewport),
    createStatefulNode("operation:GET /orders", "operation", { x: -999, y: 0 }, () => viewport),
    createStatefulNode("resource:order:1", "resource", { x: -999, y: 0 }, () => viewport),
  ]
  canvasWidth = 1200
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((node) => callback(node as never)) }))
  vi.mocked(core.zoom).mockImplementation(() => viewport.zoom)
  vi.mocked(core.pan).mockImplementation(() => viewport.pan)
  const preferences = { version: 5 as const, locked: false, viewport: null, positions: { "identity:alice": { x: -500, y: 110 }, "operation:GET /orders": { x: 5000, y: 220 }, "resource:order:1": { x: 0, y: 330 } } }
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  expectNodesInsideLanes(nodes, 1200)
  expect(nodes.map((node) => node.position().y)).toEqual([110, 220, 330])

  viewport = { zoom: 1.6, pan: { x: -250, y: 31 } }
  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()
  expectNodesInsideLanes(nodes, 1200)

  viewport = { zoom: 0.7, pan: { x: 84, y: -18 } }
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} preferences={preferences} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()
  expect(core.fit).toHaveBeenCalled()
  expectNodesInsideLanes(nodes, 1200)

  canvasWidth = 900
  resizeListener?.([], {} as ResizeObserver)
  runScheduledFrame()
  expectNodesInsideLanes(nodes, 900)

  const endpoint = nodes[1]
  const previousY = endpoint.position().y
  endpoint.position({ x: 5000, y: previousY + 111 })
  listeners.get("dragfree:node")?.({ target: endpoint as never })
  expectNodesInsideLanes(nodes, 900)
  expect(endpoint.position().y).toBe(previousY + 111)
  expect(endpoint.position().y).not.toBe(previousY)
})

it("caps the supported zoom before centering zoom-scaled node bounds across a lane boundary", () => {
  let viewport = { zoom: 1, pan: { x: 0, y: 0 } }
  const nodes = [
    createStatefulNode("identity:alice", "identity", { x: 150, y: 110 }, () => viewport),
    createStatefulNode("operation:GET /orders", "operation", { x: 450, y: 220 }, () => viewport),
    createStatefulNode("resource:order:1", "resource", { x: 750, y: 330 }, () => viewport),
  ]
  canvasWidth = 900
  vi.mocked(core.nodes).mockImplementation(() => ({ forEach: (callback: (current: never) => void) => nodes.forEach((current) => callback(current as never)) }))
  vi.mocked(core.zoom).mockImplementation(((next?: number) => {
    if (next !== undefined) viewport = { ...viewport, zoom: next }
    return viewport.zoom
  }) as never)
  vi.mocked(core.pan).mockImplementation(() => viewport.pan)
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  viewport = { ...viewport, zoom: 2 }
  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()

  expect(core.maxZoom).toHaveBeenLastCalledWith(1.3)
  expect(viewport.zoom).toBe(1.3)
  expectNodesInsideLanes(nodes, 900)
})

it("preserves the actual Cytoscape selection through preferences, zoom, fit, resize, and lock changes", () => {
  const onPreferencesChange = vi.fn()
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} selectedElementId={null} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  node.select()
  expect(node.selected()).toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} selectedElementId="identity:alice" preferences={{ version: 5, positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: false }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "preferences").toBe(true)

  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()
  expect(node.selected(), "zoom").toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={1} selectedElementId="identity:alice" preferences={{ version: 5, positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: false }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "fit").toBe(true)

  resizeListener?.([], {} as ResizeObserver)
  runScheduledFrame()
  expect(node.selected(), "resize").toBe(true)

  rerender(<CytoscapeGraph projection={projection} locked fitVersion={1} selectedElementId="identity:alice" preferences={{ version: 5, positions: {}, viewport: { zoom: 1.1, pan: { x: 0, y: 0 } }, locked: true }} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  runScheduledFrame()
  expect(node.selected(), "lock").toBe(true)
})

it("maps route candidates to the ENDPOINT lane during viewport correction", () => {
  vi.mocked(node.data).mockImplementation((key: string) => key === "kind" ? "route-candidate" : undefined)
  renderedPosition = { x: 30, y: 120 }
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  modelPosition = { x: 350, y: 55 }
  node.position.mockClear()

  listeners.get("viewport:core")?.({ target: node })
  runScheduledFrame()

  expect(node.position).toHaveBeenCalledWith({ x: 417, y: 55 })
})

it("preserves the light dotted LLM edge color", () => {
  const llmProjection: GraphProjection = {
    ...projection,
    edges: [{ ...projection.edges[0], id: "llm-edge", source: "llm", sourceText: "LLM", line: "dotted", color: "#e4e4e7" }],
  }
  render(<CytoscapeGraph projection={llmProjection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  const addedElements = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; color?: string } }>
  const llmEdge = addedElements.find((element) => element.data.id === "llm-edge")
  expect(llmEdge?.data.color).toBe("#e4e4e7")
})

it("uses the shared amber REVIEW color for dotted route candidates", () => {
  const candidateProjection: GraphProjection = {
    ...projection,
    routeCandidates: [{ id: "route-candidate:review", label: "UNKNOWN /unseen", service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen", observed: false, observedText: "미관측 후보", applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: [], provenance: [], reviewReason: "검토 필요", priorityReasons: [], selection: { operation: "UNKNOWN /unseen", resource: null, identity: null, source: "human", evidenceIds: [] } }],
  }
  render(<CytoscapeGraph projection={candidateProjection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)

  const addedElements = vi.mocked(core.add).mock.calls.at(-1)?.[0] as Array<{ data: { id: string; verdictColor?: string } }>
  expect(addedElements.find((element) => element.data.id === "route-candidate:review")?.data.verdictColor).toBe("#f59e0b")
  expect(vi.mocked(cytoscape)).toHaveBeenCalledWith(expect.objectContaining({ style: expect.arrayContaining([
    expect.objectContaining({ selector: 'node[kind = "route-candidate"]', style: expect.objectContaining({ "border-style": "dotted", "border-color": "data(verdictColor)" }) }),
  ]) }))
})

it("publishes a bounded node-kind geometry snapshot only through the explicit browser test seam", () => {
  window.history.replaceState({}, "", "/?flowscope-e2e-geometry=1")
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  runScheduledFrame()

  const snapshot = JSON.parse(screen.getByLabelText("공격면 Cytoscape 그래프").getAttribute("data-graph-geometry") ?? "null") as { width: number; maxZoom: number; nodes: Array<{ id: string; kind: string; index: number; selected: boolean; center: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number } }> }
  expect(snapshot.width).toBe(900)
  expect(snapshot.maxZoom).toBe(1.3)
  expect(snapshot.nodes).toEqual([{ id: "identity:alice", kind: "identity", index: 0, selected: false, center: { x: 700, y: 120 }, bounds: { left: 607, right: 793, top: 90, bottom: 150 } }])
})
