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
