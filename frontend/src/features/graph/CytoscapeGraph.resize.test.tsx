import { act, fireEvent, render, screen } from "@testing-library/react"
import type { Core, CytoscapeOptions } from "cytoscape"
import { beforeEach, expect, it, vi } from "vitest"

import { CytoscapeGraph } from "./CytoscapeGraph"
import type { GraphPreferences } from "./graphPreferences"
import type { GraphProjection } from "./graphProjection"

// vi.mock은 파일 맨 위로 끌어올려지므로 생성된 인스턴스는 hoisted 상태로 전달한다.
const cy = vi.hoisted(() => ({ core: null as Core | null }))
vi.mock("cytoscape", async importOriginal => {
  const original = await importOriginal<{ default: typeof import("cytoscape") }>()
  return { default: (options: CytoscapeOptions) => {
    cy.core = original.default({ ...options, container: undefined, headless: true, styleEnabled: true })
    return cy.core
  } }
})
const core = { getElementById: (id: string) => cy.core!.getElementById(id), nodes: (selector?: string) => cy.core!.nodes(selector) }

let frames: FrameRequestCallback[] = []
const flushFrames = () => act(() => { const pending = frames; frames = []; pending.forEach((callback) => callback(0)) })

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 })
  // 즉시 실행하면 Cytoscape 렌더 루프가 재귀한다. 큐에 쌓고 flushFrames로 한 번씩만 돌린다.
  frames = []
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
})

const selection = { operation: "GET /orders", resource: null, identity: "alice", source: "human" as const, evidenceIds: ["e-1"] }
const projection: GraphProjection = {
  identities: [{ id: "identity:alice", kind: "identity", label: "alice", wrappedLabel: "alice", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
  resources: [],
  operations: [{ id: "operation:GET /orders", kind: "operation", label: "GET /orders", wrappedLabel: "GET\n/orders", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
  routeCandidates: [], listItems: [],
  edges: [{ id: "edge", sourceId: "identity:alice", targetId: "operation:GET /orders", relation: "identity-operation", source: "human", sourceText: "HUMAN", line: "solid", color: "#2563eb", count: 1, countLabel: "", selection }],
} as unknown as GraphProjection
const base: GraphPreferences = { version: 7, positions: { "identity:alice": { x: 200, y: 200 }, "operation:GET /orders": { x: 1000, y: 200 } }, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, locked: false, inputMode: "auto" }
const operation = () => core.getElementById("operation:GET /orders")
const lastSizes = (spy: ReturnType<typeof vi.fn>) => (spy.mock.calls.at(-1)?.[0] as Pick<GraphPreferences, "sizes">).sizes

const canvas = () => screen.getByLabelText("공격면 Cytoscape 그래프")
/** 노드 오른쪽 아래 모서리의 화면 좌표(테스트에서는 컨테이너 원점이 0,0). */
const corner = (id: string) => {
  const node = core.getElementById(id), center = node.renderedPosition()
  return { clientX: center.x + node.renderedOuterWidth() / 2, clientY: center.y + node.renderedOuterHeight() / 2 }
}
const startResize = (id: string) => {
  const at = corner(id)
  fireEvent.pointerMove(canvas(), at)
  fireEvent.pointerDown(canvas(), { ...at, button: 0 })
  return at
}

it("switches to a resize cursor at a node corner and grows the node from its top-left while dragging", () => {
  const onPreferencesChange = vi.fn()
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={base} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  const node = operation()
  const start = { width: Number(node.data("width")), height: Number(node.data("height")), left: node.position().x - Number(node.data("width")) / 2, top: node.position().y - Number(node.data("height")) / 2 }
  const center = node.renderedPosition()
  fireEvent.pointerMove(canvas(), { clientX: center.x, clientY: center.y })
  expect(canvas().style.cursor).toBe("")
  const at = corner("operation:GET /orders")
  fireEvent.pointerMove(canvas(), at)
  expect(canvas().style.cursor).toBe("nwse-resize")

  fireEvent.pointerDown(canvas(), { ...at, button: 0 })
  fireEvent.pointerMove(window, { clientX: at.clientX + 60, clientY: at.clientY + 40 })
  expect(Number(node.data("width"))).toBe(start.width + 60)
  expect(Number(node.data("height"))).toBe(start.height + 40)
  expect(node.position().x - Number(node.data("width")) / 2).toBeCloseTo(start.left)
  expect(node.position().y - Number(node.data("height")) / 2).toBeCloseTo(start.top)
  fireEvent.pointerUp(window)
  flushFrames()
  expect(canvas().style.cursor).toBe("")
  expect(lastSizes(onPreferencesChange)).toEqual({ "operation:GET /orders": { width: start.width + 60, height: start.height + 40 } })
})

it("keeps the previous card image until the resized one is decoded so the card never blanks", async () => {
  let decoded!: () => void
  const decode = vi.fn(() => new Promise<void>((resolve) => { decoded = resolve }))
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: decode })
  try {
    render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={base} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
    const node = operation(), before = String(node.data("cardImage")), width = Number(node.data("width"))
    const at = startResize("operation:GET /orders")
    fireEvent.pointerMove(window, { clientX: at.clientX + 60, clientY: at.clientY })

    expect(Number(node.data("width"))).toBe(width + 60)
    expect(node.data("cardImage")).toBe(before)
    await act(async () => { decoded() })
    expect(node.data("cardImage")).not.toBe(before)
    fireEvent.pointerUp(window)
  } finally {
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode
  }
})

it("never shrinks below the default card and stops before the next lane", () => {
  render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={{ ...base, positions: { "identity:alice": { x: 200, y: 200 }, "operation:GET /orders": { x: 600, y: 200 } } }} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  const identity = core.getElementById("identity:alice")
  const width = Number(identity.data("width"))
  const at = startResize("identity:alice")
  fireEvent.pointerMove(window, { clientX: at.clientX - 100, clientY: at.clientY - 100 })
  expect(Number(identity.data("width"))).toBe(width)
  fireEvent.pointerMove(window, { clientX: at.clientX + 400, clientY: at.clientY })
  const rightEdge = identity.position().x + Number(identity.data("width")) / 2
  const nextLaneLeft = operation().position().x - Number(operation().data("width")) / 2
  // 끌어도 오른쪽 이웃 레인 노드와 48px 간격 직전에서 멈춘다(최대 크기보다 먼저 걸린다).
  expect(rightEdge).toBeCloseTo(nextLaneLeft - 48, 0)
  expect(Number(identity.data("width"))).toBeGreaterThan(width)
  fireEvent.pointerUp(window)
})

it("restores saved sizes, retains them on relayout, and ignores corners while locked", () => {
  const sized = { ...base, sizes: { "operation:GET /orders": { width: 300, height: 140 } } }
  const onPreferencesChange = vi.fn()
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={sized} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  expect(Number(operation().data("width"))).toBe(300)
  expect(Number(operation().data("height"))).toBe(140)

  rerender(<CytoscapeGraph projection={projection} locked fitVersion={0} preferences={sized} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  fireEvent.pointerMove(canvas(), corner("operation:GET /orders"))
  expect(canvas().style.cursor).toBe("")

  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} layoutVersion={1} preferences={sized} onSelect={vi.fn()} onPreferencesChange={onPreferencesChange} />)
  expect(Number(operation().data("width"))).toBe(300)
  flushFrames()
  expect(lastSizes(onPreferencesChange)).toEqual(sized.sizes)
})

it("retains card sizes on single-lane sorting and supports Shift+Arrow resizing", () => {
  const sized = { ...base, sizes: { "identity:alice": { width: 300, height: 120 }, "operation:GET /orders": { width: 300, height: 140 } } }
  const { rerender } = render(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} preferences={sized} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  rerender(<CytoscapeGraph projection={projection} locked={false} fitVersion={0} laneLayout={{ lane: 1, version: 1 }} preferences={sized} onSelect={vi.fn()} onPreferencesChange={vi.fn()} />)
  expect(Number(operation().data("width"))).toBe(300)
  expect(Number(core.getElementById("identity:alice").data("width"))).toBe(300)

  act(() => { canvas().focus() })
  // 정렬 후 계정 카드는 이웃 레인과 가까워 확대가 제한된다. API 카드에서 키보드 크기 조절을 확인한다.
  fireEvent.keyDown(canvas(), { key: "ArrowRight" })
  const focused = core.nodes(".keyboard-focus")[0]
  expect(focused.id()).toBe("operation:GET /orders")
  const width = Number(focused.data("width"))
  fireEvent.keyDown(canvas(), { key: "ArrowRight", shiftKey: true })
  expect(Number(focused.data("width"))).toBe(width + 16)
  fireEvent.keyDown(canvas(), { key: "ArrowLeft", shiftKey: true })
  expect(Number(focused.data("width"))).toBe(width)
})
