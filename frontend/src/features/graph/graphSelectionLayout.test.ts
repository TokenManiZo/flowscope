import { describe, expect, it } from "vitest"
import cytoscape from "cytoscape"
import { positionSelectionInLanes, readPreferences, visibleCanvasBounds, positionInLanes, restoreFoldSelection } from "./CytoscapeGraph"
import { selectionPositions, type SelectionLayoutNode } from "./graphSelectionLayout"

const node = (id: string, lane: number, y: number, connected = false, height = 100): SelectionLayoutNode => ({ id, lane, kind: lane === 0 ? "identity" : lane === 1 ? "operation" : "object-group", x: lane * 400, y, connected, height })

describe("selection layout", () => {
  it("brings APIs to the selected object in both vertical directions and clears collisions", () => {
    const nodes = [node("object", 2, 500), node("api-a", 1, 100, true, 120), node("api-b", 1, 1000, true, 80), node("dim", 1, 480), node("later", 1, 600)]
    const positions = selectionPositions(nodes, "object", 3)
    expect(positions.object).toBeUndefined()
    expect(positions["api-a"].y).toBe(450)
    expect(positions["api-b"].y).toBe(570)
    expect(positions.dim.y).toBe(680)
    expect(positions.later.y).toBe(800)
  })

  it("keeps visible lanes fixed and only gathers fully offscreen connections", () => {
    const nodes = [node("object", 2, 400), node("api", 1, 200, true), node("account", 0, 300, true)]
    const viewport = { top: 40, bottom: 600 }
    expect(selectionPositions(nodes, "object", 3, viewport)).toEqual({})
    expect(selectionPositions([nodes[0], { ...nodes[1], y: 640 }, nodes[2]], "object", 3, viewport)).toEqual({})
    const positions = selectionPositions([nodes[0], { ...nodes[1], y: 700 }, nodes[2]], "object", 3, viewport)
    expect(positions.api.y).toBe(400)
    expect(positions.account).toBeUndefined()
  })

  it("uses current zoom and pan for visibility", () => {
    const core = cytoscape({ headless: true, elements: [node("api", 1, 1000), node("object", 2, 1200)].map(item => ({ data: { id: item.id, kind: item.kind, height: item.height }, position: { x: item.x, y: item.y } })), layout: { name: "preset" } })
    core.viewport({ zoom: 0.5, pan: { x: 0, y: -400 } })
    const focus = { node: () => "yes" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "object", 3, focus, { x: 800, y: 1200 }, 600)
    expect(core.getElementById("api").position().y).toBe(1000)
    core.pan({ x: 0, y: -600 })
    positionSelectionInLanes(core, "object", 3, focus, { x: 800, y: 1200 }, 600)
    expect(core.getElementById("api").position().y).toBe(1200)
    core.destroy()
  })

  it("checks the browser-visible canvas instead of its full height", () => {
    const canvas = document.createElement("div")
    const parent = document.createElement("div")
    parent.style.overflowY = "hidden"
    parent.append(canvas)
    document.body.append(parent)
    canvas.getBoundingClientRect = () => ({ top: 200, bottom: 1400, height: 1200, left: 0, right: 900, width: 900, x: 0, y: 200, toJSON() {} })
    parent.getBoundingClientRect = () => ({ top: 150, bottom: 500, height: 350, left: 0, right: 900, width: 900, x: 0, y: 150, toJSON() {} })
    expect(visibleCanvasBounds(canvas)).toEqual({ top: 40, bottom: 300 })
    const core = cytoscape({ headless: true, elements: [node("api", 1, 150), node("object", 2, 500)].map(item => ({ data: { id: item.id, kind: item.kind, height: item.height }, position: { x: item.x, y: item.y } })), layout: { name: "preset" } })
    core.viewport({ zoom: 1, pan: { x: 0, y: 0 } })
    const focus = { node: () => "yes" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "api", 3, focus, { x: 400, y: 150 }, visibleCanvasBounds(canvas))
    expect(core.getElementById("object").position().y).toBe(150)
    expect(core.getElementById("api").position().y).toBe(150)
    core.destroy()
    parent.remove()
  })

  it("retains a now-visible API when switching objects, restoring only on deselection", () => {
    const core = cytoscape({ headless: true, elements: [node("api", 1, 1000), node("first", 2, 200), node("second", 2, 400)].map(item => ({ data: { id: item.id, kind: item.kind, height: item.height }, position: { x: item.x, y: item.y } })), layout: { name: "preset" } })
    core.viewport({ zoom: 1, pan: { x: 0, y: 0 } })
    const focus = { node: (id: string) => id === "api" ? "yes" as const : "no" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "first", 3, focus, { x: 800, y: 200 }, 600)
    expect(core.getElementById("api").position().y).toBe(200)
    for (let i = 0; i < 3; i++) {
      positionSelectionInLanes(core, "second", 3, focus, { x: 800, y: 400 }, 600)
      expect(core.getElementById("api").position().y).toBe(200)
      expect(core.getElementById("second").position().y).toBe(400)
    }
    expect(readPreferences(core).positions.api.y).toBe(1000)
    // Even after a further offscreen move, restore the original position, not the last temporary one.
    core.pan({ x: 0, y: -500 })
    positionSelectionInLanes(core, "second", 3, focus, { x: 800, y: 700 }, 600)
    expect(core.getElementById("api").position().y).toBe(700)
    positionSelectionInLanes(core, null, 3, focus)
    expect(core.getElementById("api").position().y).toBe(1000)
    expect(core.getElementById("second").position().y).toBe(400)
    core.destroy()
  })

  it("restores fresh children created below an already-raised parent on deselection", () => {
    const core = cytoscape({ headless: true, elements: [
      { data: { id: "group", kind: "object-group", groupState: "open", height: 100, selectionBasePosition: { x: 800, y: 1000 } }, position: { x: 800, y: 200 } },
      { data: { id: "child", kind: "resource", memberOf: "group", height: 100 }, position: { x: 800, y: 320 } },
    ], layout: { name: "preset" } })
    const focus = { node: () => "no" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "group", 3, focus, { x: 800, y: 200 })
    expect(core.getElementById("child").position().y).toBe(320)
    positionSelectionInLanes(core, null, 3, focus)
    expect(core.getElementById("group").position().y).toBe(1000)
    expect(core.getElementById("child").position().y).toBe(1120)
    core.destroy()
  })

  it("keeps the visible anonymous account through object expansion and pushes overlapping blocks below children", () => {
    const core = cytoscape({ headless: true, elements: [
      { data: { id: "account", kind: "identity", height: 100 }, position: { x: 0, y: 1000 } },
      { data: { id: "api", kind: "operation", height: 100 }, position: { x: 400, y: 200 } },
      { data: { id: "group", kind: "object-group", height: 100, groupState: "open" }, position: { x: 800, y: 1000 } },
      { data: { id: "child", kind: "resource", height: 100, memberOf: "group" }, position: { x: 800, y: 1120 } },
      { data: { id: "below", kind: "object-group", height: 100 }, position: { x: 800, y: 300 } },
    ], layout: { name: "preset" } })
    core.viewport({ zoom: 1, pan: { x: 0, y: 0 } })
    const focus = { node: (id: string) => id === "account" ? "yes" as const : "no" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "api", 3, focus, { x: 400, y: 200 }, 600)
    expect(core.getElementById("account").position().y).toBe(200)
    restoreFoldSelection(core)
    expect(core.getElementById("account").position().y).toBe(200)
    positionSelectionInLanes(core, "group", 3, focus, { x: 800, y: 200 }, 600)
    expect(core.getElementById("account").position().y).toBe(200)
    expect(core.getElementById("group").position().y).toBe(200)
    expect(core.getElementById("child").position().y).toBe(320)
    expect(core.getElementById("below").position().y).toBe(440)
    restoreFoldSelection(core)
    expect(core.getElementById("below").position().y).toBe(300)
    expect(core.getElementById("account").position().y).toBe(200)
    positionSelectionInLanes(core, null, 3, focus)
    expect(core.getElementById("account").position().y).toBe(1000)
    core.destroy()
  })

  it.each(["operation-group", "object-group"])("expands %s children at the raised parent instead of the original position", kind => {
    const x = kind === "operation-group" ? 400 : 800
    const core = cytoscape({ headless: true, elements: [
      { data: { id: "group", kind, height: 100, groupState: "closed" }, position: { x, y: 1000 } },
      { data: { id: "anchor", kind: kind === "operation-group" ? "object-group" : "operation", height: 100 }, position: { x: x === 400 ? 800 : 400, y: 200 } },
    ], layout: { name: "preset" } })
    core.viewport({ zoom: 1, pan: { x: 0, y: 0 } })
    const focus = { node: () => "yes" as const, edge: () => "none" as const }
    positionSelectionInLanes(core, "anchor", 3, focus, { x: x === 400 ? 800 : 400, y: 200 }, 600)
    expect(core.getElementById("group").position().y).toBe(200)
    // Projection rebuild restores fold bases, while the click anchor remains at the raised coordinate.
    positionSelectionInLanes(core, null, 3, focus)
    const saved = readPreferences(core).positions
    core.getElementById("group").data("groupState", "open")
    core.add(Array.from({ length: 18 }, (_, i) => ({ data: { id: `child-${i}`, kind: kind === "operation-group" ? "operation" : "resource", height: 100, memberOf: "group", temporaryObjectPosition: "yes" } })))
    positionInLanes(core, 600, saved, 3)
    positionSelectionInLanes(core, "group", 3, focus, { x, y: 200 }, 600)
    expect(core.getElementById("group").position().y).toBe(200)
    for (let i = 0; i < 18; i++) expect(core.getElementById(`child-${i}`).position()).toEqual({ x, y: 320 + i * 120 })
    positionSelectionInLanes(core, null, 3, focus)
    expect(core.getElementById("group").position().y).toBe(1000)
    expect(core.getElementById("child-0").position().y).toBe(1120)
    core.destroy()
  })

  it.each(["operation-group", "object-group"])("restores lower siblings after repeatedly expanding many %s members with selection", (kind) => {
    const x = kind === "operation-group" ? 400 : 800
    const saved = { group: { x, y: 100 }, lower: { x, y: 260 }, anchor: { x: x === 400 ? 800 : 400, y: 1000 } }
    for (let cycle = 0; cycle < 3; cycle++) {
      const elements = [
        { data: { id: "group", kind, height: 100, groupState: "open" } },
        { data: { id: "lower", kind, height: 100 } },
        { data: { id: "anchor", kind: kind === "operation-group" ? "object-group" : "operation", height: 100 } },
        ...Array.from({ length: 30 }, (_, i) => ({ data: { id: `member-${i}`, kind: kind === "operation-group" ? "operation" : "resource", height: 100, memberOf: "group", temporaryObjectPosition: "yes" } })),
      ]
      const core = cytoscape({ headless: true, elements, layout: { name: "preset" } })
      positionInLanes(core, 600, saved, 3)
      expect(core.getElementById("lower").position().y).toBe(3860)
      const focus = { node: (id: string) => id === "group" ? "yes" as const : "no" as const, edge: () => "none" as const }
      positionSelectionInLanes(core, "anchor", 3, focus, saved.anchor)
      // A fold transition clears the selection layer before capturing the folded base layout.
      positionSelectionInLanes(core, null, 3, focus)
      const base = readPreferences(core).positions
      core.nodes().filter(node => node.id().startsWith("member-")).remove()
      core.getElementById("group").data("groupState", "closed")
      positionInLanes(core, 600, base, 3)
      expect(core.getElementById("lower").position()).toEqual(saved.lower)
      expect(core.getElementById("group").position()).toEqual(saved.group)
      core.destroy()
    }
  })

  it("keeps same-column siblings and Site Overview in place", () => {
    const nodes = [node("api", 1, 500), node("sibling", 1, 600), node("object", 2, 1000, true), node("account", 0, 100, true)]
    const positions = selectionPositions(nodes, "api", 3)
    expect(positions.sibling).toBeUndefined()
    expect(positions.object.y).toBe(500)
    expect(positions.account.y).toBe(500)
    expect(selectionPositions(nodes, "api", 2)).toEqual({})
  })

  it("restores temporary positions, keeps the clicked card fixed, and never saves or moves the viewport", () => {
    const core = cytoscape({ headless: true, elements: [node("api", 1, 100), node("object", 2, 500), node("dim", 1, 500)].map(item => ({ data: { id: item.id, kind: item.kind, height: item.height }, position: { x: item.x, y: item.y } })), layout: { name: "preset" } })
    const viewport = { zoom: core.zoom(), pan: { ...core.pan() } }
    const focus = { node: (id: string) => id === "api" || id === "object" ? "yes" as const : "no" as const, edge: () => "none" as const }
    core.nodes().lock()
    positionSelectionInLanes(core, "object", 3, focus, { x: 800, y: 500 })
    expect(core.getElementById("object").position()).toEqual({ x: 800, y: 500 })
    expect(core.getElementById("api").position().y).toBe(500)
    expect(core.getElementById("dim").position().y).toBe(620)
    expect(readPreferences(core).positions.api.y).toBe(100)
    expect(core.getElementById("api").locked()).toBe(true)
    positionSelectionInLanes(core, null, 3, focus)
    expect(core.getElementById("api").position().y).toBe(100)
    expect(core.getElementById("dim").position().y).toBe(500)
    expect({ zoom: core.zoom(), pan: core.pan() }).toEqual(viewport)
    core.destroy()
  })
})
