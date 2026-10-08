import cytoscape from "cytoscape"
import { expect, it } from "vitest"
import { positionInLanes, positionHighlightedInLanes, readPreferences } from "./CytoscapeGraph"

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

it("inserts object members below their group and keeps displaced coordinates out of saved preferences", () => {
  const core = cytoscape({ headless: true, elements: [
    { data: { id: "identity:a", kind: "identity", height: 80 } },
    { data: { id: "operation:a", kind: "operation", height: 80 } },
    { data: { id: "object-group:g", kind: "object-group", height: 80 } },
    { data: { id: "resource:other", kind: "resource", height: 80 } },
    { data: { id: "resource:one", kind: "resource", height: 80, memberOf: "object-group:g", temporaryObjectPosition: "yes" } },
    { data: { id: "resource:two", kind: "resource", height: 100, memberOf: "object-group:g", temporaryObjectPosition: "yes" } },
  ] })
  const saved = { "identity:a": { x: 200, y: 200 }, "operation:a": { x: 540, y: 300 }, "object-group:g": { x: 900, y: 200 }, "resource:other": { x: 900, y: 300 }, "resource:one": { x: 900, y: 4000 }, hidden: { x: 900, y: 5000 } }
  try {
    core.viewport({ zoom: 0.8, pan: { x: 30, y: 40 } })
    positionInLanes(core, 700, saved, 3)
    expect(core.getElementById("resource:one").position()).toEqual({ x: 900, y: 300 })
    expect(core.getElementById("resource:two").position()).toEqual({ x: 900, y: 410 })
    expect(core.getElementById("identity:a").position()).toEqual(saved["identity:a"])
    expect(core.getElementById("operation:a").position()).toEqual(saved["operation:a"])
    expect(core.getElementById("resource:other").position()).toEqual({ x: 900, y: 520 })
    expect(readPreferences(core).positions["resource:other"]).toEqual(saved["resource:other"])
    const automatic = readPreferences(core)
    expect(automatic.positions["resource:one"]).toBeUndefined()
    expect(automatic.viewport).toEqual({ zoom: 0.8, pan: { x: 30, y: 40 } })
    const member = core.getElementById("resource:one")
    member.data("temporaryObjectPosition", "no")
    member.position({ x: 1000, y: 350 })
    expect(readPreferences(core).positions["resource:one"]).toEqual({ x: 1000, y: 350 })
  } finally { core.destroy() }
})

it("opens members below a group even near the viewport bottom without moving the camera", () => {
  const core = cytoscape({ headless: true, elements: [{ data: { id: "g", kind: "object-group", height: 80 } }, { data: { id: "m", kind: "resource", height: 80, memberOf: "g", temporaryObjectPosition: "yes" } }] })
  try {
    positionInLanes(core, 620, { g: { x: 900, y: 570 } }, 3)
    expect(core.getElementById("g").position()).toEqual({ x: 900, y: 570 })
    expect(core.getElementById("m").position()).toEqual({ x: 900, y: 670 })
    expect(core.zoom()).toBe(1)
    expect(core.pan()).toEqual({ x: 0, y: 0 })
  } finally { core.destroy() }
})


it("reorders locked nodes without changing lock state and does not restore on filter clear", () => {
  const core = cytoscape({ headless: true, layout: { name: "preset" }, elements: [
    { data: { id: "a", kind: "operation", height: 200, hl: "yes" }, position: { x: 540, y: 3000 } },
    { data: { id: "b", kind: "operation", height: 80, hl: "no" }, position: { x: 540, y: 100 } },
  ] })
  try {
    core.nodes().lock()
    expect(positionHighlightedInLanes(core, 3)).toBe(true)
    expect(core.nodes().toArray().every(node => node.locked())).toBe(true)
    expect(core.$id("a").position()).toEqual({ x: 540, y: 160 })
    expect(core.$id("b").position()).toEqual({ x: 540, y: 320 })
    const positions = readPreferences(core).positions
    core.nodes().data("hl", "none")
    expect(positionHighlightedInLanes(core, 3)).toBe(false)
    expect(readPreferences(core).positions).toEqual(positions)
  } finally { core.destroy() }
})

it("keeps Site Overview positions unchanged when filters highlight nodes", () => {
  const core = cytoscape({ headless: true, layout: { name: "preset" }, elements: [
    { data: { id: "target", kind: "target", height: 100, hl: "yes" }, position: { x: 180, y: 400 } },
    { data: { id: "first", kind: "api-group", height: 100, hl: "no" }, position: { x: 540, y: 100 } },
    { data: { id: "second", kind: "api-group", height: 100, hl: "yes" }, position: { x: 540, y: 900 } },
  ] })
  try {
    const original = readPreferences(core).positions
    expect(positionHighlightedInLanes(core, 2)).toBe(false)
    expect(readPreferences(core).positions).toEqual(original)
  } finally { core.destroy() }
})


it("restores API and object siblings after folding and never accumulates offsets on rebuild", () => {
  for (const kind of ["operation", "resource"]) {
    const core = cytoscape({ headless: true, elements: [
      { data: { id: "g", kind: kind === "operation" ? "operation-group" : "object-group", height: 80 } },
      { data: { id: "sibling", kind, height: 80 } },
      { data: { id: "m", kind, height: 120, memberOf: "g", ...(kind === "resource" ? { temporaryObjectPosition: "yes" } : {}) } },
    ] })
    try {
      const saved = { g: { x: 900, y: 200 }, sibling: { x: 900, y: 300 } }
      positionInLanes(core, 620, saved, 3)
      expect(core.$id("m").position().y).toBe(320)
      expect(core.$id("sibling").position().y).toBe(440)
      const folded = readPreferences(core).positions
      expect(folded).toEqual(saved)
      positionInLanes(core, 620, folded, 3)
      expect(core.$id("sibling").position().y).toBe(440)
      core.$id("m").remove()
      positionInLanes(core, 620, readPreferences(core).positions, 3)
      expect(core.$id("sibling").position()).toEqual(saved.sibling)
    } finally { core.destroy() }
  }
})


it("replaces a static summary at the same position and preserves its anchor on refresh and collapse", () => {
  const core = cytoscape({ headless: true, elements: [
    { data: { id: "sibling", kind: "object-group", height: 80 } },
    { data: { id: "group:a", kind: "object-group", height: 80, layoutAnchorId: "summary" } },
    { data: { id: "group:b", kind: "object-group", height: 80, layoutAnchorId: "summary" } },
  ] })
  try {
    const saved = { summary: { x: 900, y: 200 }, sibling: { x: 900, y: 300 } }
    positionInLanes(core, 620, saved, 3)
    expect(core.$id("group:a").position()).toEqual(saved.summary)
    expect(core.$id("group:b").position().y).toBe(300)
    expect(core.$id("sibling").position().y).toBe(400)
    expect(readPreferences(core).positions).toEqual(saved)
    positionInLanes(core, 620, readPreferences(core).positions, 3)
    expect(core.$id("group:a").position()).toEqual(saved.summary)
    core.$id("group:a").remove(); core.$id("group:b").remove()
    core.add({ data: { id: "summary", kind: "object-group", height: 80 } })
    positionInLanes(core, 620, saved, 3)
    expect(core.$id("summary").position()).toEqual(saved.summary)
    expect(core.$id("sibling").position()).toEqual(saved.sibling)
  } finally { core.destroy() }
})
