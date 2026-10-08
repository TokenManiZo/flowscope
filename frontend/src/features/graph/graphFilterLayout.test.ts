import { expect, it } from "vitest"
import { highlightPositions, focusedGroupPositions, type FilterLayoutNode } from "./graphFilterLayout"

it("keeps identities fixed and fills gaps between matching API and Object cards", () => {
  const nodes: FilterLayoutNode[] = [
    { id: "identity:a", lane: 0, x: 170, y: 3000, matched: true },
    { id: "identity:b", lane: 0, x: 200, y: 100, matched: false },
    { id: "api:a", lane: 1, x: 540, y: 3000, matched: true },
    { id: "api:b", lane: 1, x: 550, y: 200, matched: false },
    { id: "group", lane: 2, x: 900, y: 2500, matched: true },
    { id: "object:a", lane: 2, x: 920, y: 2600, matched: true },
    { id: "object:b", lane: 2, x: 880, y: 50, matched: false },
  ]
  const positions = highlightPositions(nodes, 3)!
  for (const node of nodes.filter(node => node.lane === 0)) expect(positions[node.id]).toEqual({ x: node.x, y: node.y })
  expect(positions["api:a"]).toEqual({ x: 540, y: 200 })
  expect(positions["api:b"]).toEqual({ x: 550, y: 280 })
  expect(positions.group).toEqual({ x: 900, y: 50 })
  expect(positions["object:a"]).toEqual({ x: 920, y: 130 })
  expect(positions["object:b"]).toEqual({ x: 880, y: 210 })
  expect(highlightPositions(nodes.map(node => ({ ...node, ...positions[node.id] })), 3)).toEqual(positions)
})

it("leaves Target fixed and compacts the site graph's matched API groups", () => {
  const nodes = [
    { id: "site", lane: 0, x: 180, y: 900, matched: true },
    { id: "group:a", lane: 1, x: 540, y: 100, matched: false },
    { id: "group:b", lane: 1, x: 540, y: 600, matched: true },
  ]
  expect(highlightPositions(nodes, 2)).toEqual({ site: { x: 180, y: 900 }, "group:a": { x: 540, y: 180 }, "group:b": { x: 540, y: 100 } })
  expect(highlightPositions(nodes.map(node => ({ ...node, matched: node.lane === 0 })), 2)).toBeNull()
  expect(highlightPositions([], 2)).toBeNull()
})

it("preserves relative order within matched and dimmed nodes, including coincident slots", () => {
  const nodes = [false, true, false, true].map((matched, index) => ({ id: String(index), lane: 1, x: 540, y: index < 2 ? 100 : index * 200, matched }))
  expect(highlightPositions(nodes, 3)).toEqual({ "0": { x: 540, y: 260 }, "1": { x: 540, y: 100 }, "2": { x: 540, y: 340 }, "3": { x: 540, y: 180 } })
})

it("compacts the vacated API slot and overlays ordered OBJ members on the background", () => {
  const node = (id: string, lane: number, y: number, matched: boolean, memberOf = "") => ({ id, lane, x: lane * 300, y, matched, memberOf, height: 100, temporary: Boolean(memberOf) })
  const nodes = [node("other", 1, 100, false), node("api", 1, 900, true),
    node("background", 2, 100, false), node("group", 2, 900, true),
    node("OBJ 1", 2, 1100, true, "group"), node("OBJ 2", 2, 500, true, "group")]
  const positions = focusedGroupPositions(nodes, 3)
  expect(positions.other).toEqual({ x: 300, y: 220 })
  expect(positions.background).toEqual({ x: 600, y: 220 })
  expect(positions.api).toEqual({ x: 300, y: 100 })
  expect(positions.group).toEqual({ x: 600, y: 100 })
  expect(positions["OBJ 1"]).toEqual(positions.background)
  expect(positions["OBJ 1"].y).toBeLessThan(positions["OBJ 2"].y)
  const folded = nodes.filter(node => !node.temporary).map(node => ({ ...node, ...positions[node.id], matched: false }))
  expect(focusedGroupPositions(folded, 3)).toEqual(Object.fromEntries(folded.map(node => [node.id, positions[node.id]])))
})

it("places an opened group and its OBJ members before connected query groups without overlap", () => {
  const nodes = [
    { id: "query", lane: 2, x: 900, y: 100, height: 180, matched: true, memberOf: "" },
    { id: "path", lane: 2, x: 1100, y: 300, height: 100, matched: true, memberOf: "", opened: true },
    { id: "OBJ 1", lane: 2, x: 1100, y: 420, height: 100, matched: true, memberOf: "path" },
  ]
  const positions = focusedGroupPositions(nodes, 3)
  expect(positions.path.y).toBeLessThan(positions["OBJ 1"].y)
  expect(positions["OBJ 1"].y + 50 + 20).toBeLessThanOrEqual(positions.query.y - 90)
})

it("packs differently sized filter matches before nonmatches without leaving the old gap", () => {
  const nodes = [
    { id: "api:small", lane: 1, x: 540, y: 100, height: 100, matched: true },
    { id: "api:large", lane: 1, x: 540, y: 900, height: 180, matched: true },
    { id: "api:other", lane: 1, x: 540, y: 1100, height: 120, matched: false },
  ]
  const positions = highlightPositions(nodes, 3)!
  expect(positions["api:large"].y - 90).toBe(positions["api:small"].y + 50 + 20)
  expect(positions["api:other"].y - 60).toBe(positions["api:large"].y + 90 + 20)
})
