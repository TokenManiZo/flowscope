import cytoscape from "cytoscape"
import { expect, it } from "vitest"
import { positionInLanes } from "./CytoscapeGraph"

it("restores intentionally overlapping coordinates and places only new nodes below them", () => {
  const core = cytoscape({ headless: true, elements: [
    { data: { id: "a", kind: "operation", height: 80 } },
    { data: { id: "b", kind: "operation", height: 120 } },
    { data: { id: "c", kind: "operation", height: 100 } },
  ] })
  try {
    const saved = { a: { x: 700, y: 200 }, b: { x: 700, y: 200 } }
    positionInLanes(core, 700, saved, 3)
    expect(core.getElementById("a").position()).toEqual(saved.a)
    expect(core.getElementById("b").position()).toEqual(saved.b)
    const added = { ...core.getElementById("c").position() }
    expect(added.x).toBe(700)
    expect(added.y - 50).toBeGreaterThan(260)
    positionInLanes(core, 1200, { ...saved, c: added }, 3)
    expect(core.getElementById("c").position()).toEqual(added)
    expect(core.getElementById("a").position()).toEqual(saved.a)
    positionInLanes(core, 700, null, 3, 0)
    expect(core.getElementById("a").position()).toEqual(saved.a)
    positionInLanes(core, 700, null, 3, 1)
    expect(core.getElementById("b").position().y).toBeGreaterThan(core.getElementById("a").position().y)
  } finally { core.destroy() }
})

it("reserves folded and limited cards, including their saved size, before placing new cards", () => {
  const core = cytoscape({ headless: true, elements: [
    { data: { id: "visible", kind: "resource", height: 80 } },
    { data: { id: "added", kind: "resource", height: 100 } },
  ] })
  const saved = { visible: { x: 900, y: 200 }, folded: { x: 900, y: 350 }, limited: { x: 900, y: 600 } }
  try {
    positionInLanes(core, 700, saved, 3)
    const added = { ...core.getElementById("added").position() }
    expect(added.y - 50).toBeGreaterThan(700)
    core.add([{ data: { id: "folded", kind: "resource", height: 180 } }, { data: { id: "limited", kind: "resource", height: 200 } }])
    positionInLanes(core, 700, { ...saved, added }, 3)
    expect(core.getElementById("folded").position()).toEqual(saved.folded)
    expect(core.getElementById("limited").position()).toEqual(saved.limited)
    expect(core.getElementById("added").position()).toEqual(added)
    expect(core.getElementById("visible").position()).toEqual(saved.visible)
  } finally { core.destroy() }
})

it("reserves hidden cards when no saved card remains visible in the new card's lane", () => {
  const core = cytoscape({ headless: true, elements: [{ data: { id: "new", kind: "operation", height: 100 } }] })
  try {
    // The hidden card has no custom size or kind metadata. Reserve the permitted maximum height.
    positionInLanes(core, 700, { hidden: { x: 540, y: 650 } }, 3)
    expect(core.getElementById("new").position().y - 50).toBeGreaterThan(650 + 480 / 2)
  } finally { core.destroy() }
})
