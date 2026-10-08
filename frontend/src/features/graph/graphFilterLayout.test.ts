import { expect, it } from "vitest"
import { highlightPositions, focusedGroupPositions, type FilterLayoutNode } from "./graphFilterLayout"

it("keeps identities fixed and permutes API and Object nodes within their existing coordinate slots", () => {
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
  expect(positions["api:a"]).toEqual({ x: 550, y: 200 })
  expect(positions["api:b"]).toEqual({ x: 540, y: 3000 })
  expect(positions.group).toEqual({ x: 880, y: 50 })
  expect(positions["object:a"]).toEqual({ x: 900, y: 2500 })
  expect(positions["object:b"]).toEqual({ x: 920, y: 2600 })
  for (const lane of [1, 2]) {
    const column = nodes.filter(node => node.lane === lane)
    expect(column.map(node => JSON.stringify(positions[node.id])).sort()).toEqual(column.map(node => JSON.stringify({ x: node.x, y: node.y })).sort())
  }
  expect(highlightPositions(nodes.map(node => ({ ...node, ...positions[node.id] })), 3)).toEqual(positions)
})

it("leaves Target fixed and only reorders the site graph's existing API group slots", () => {
  const nodes = [
    { id: "site", lane: 0, x: 180, y: 900, matched: true },
    { id: "group:a", lane: 1, x: 540, y: 100, matched: false },
    { id: "group:b", lane: 1, x: 540, y: 600, matched: true },
  ]
  expect(highlightPositions(nodes, 2)).toEqual({ site: { x: 180, y: 900 }, "group:a": { x: 540, y: 600 }, "group:b": { x: 540, y: 100 } })
  expect(highlightPositions(nodes.map(node => ({ ...node, matched: node.lane === 0 })), 2)).toBeNull()
  expect(highlightPositions([], 2)).toBeNull()
})

it("preserves relative order within matched and dimmed nodes, including coincident slots", () => {
  const nodes = [false, true, false, true].map((matched, index) => ({ id: String(index), lane: 1, x: 540, y: index < 2 ? 100 : index * 200, matched }))
  expect(highlightPositions(nodes, 3)).toEqual({ "0": { x: 540, y: 400 }, "1": { x: 540, y: 100 }, "2": { x: 540, y: 600 }, "3": { x: 540, y: 100 } })
})

it("places connected identities and APIs first and keeps the opened OBJ block in ordinal order", () => {
  const node = (id: string, lane: number, y: number, matched: boolean, memberOf = "") => ({ id, lane, x: lane * 300, y, matched, memberOf, height: 100 })
  const nodes = [node("identity:other", 0, 100, false), node("identity:linked", 0, 900, true),
    node("api:other", 1, 100, false), node("api:linked", 1, 900, true),
    node("query", 2, 100, false), node("path", 2, 900, true),
    node("OBJ 1", 2, 1100, true, "path"), node("OBJ 2", 2, 500, true, "path")]
  const positions = focusedGroupPositions(nodes, 3)
  expect(positions["identity:linked"].y).toBeLessThan(positions["identity:other"].y)
  expect(positions["api:linked"].y).toBeLessThan(positions["api:other"].y)
  expect(positions.path.y).toBeLessThan(positions["OBJ 1"].y)
  expect(positions["OBJ 1"].y).toBeLessThan(positions["OBJ 2"].y)
  expect(positions["OBJ 2"].y).toBeLessThan(positions.query.y)
  expect(focusedGroupPositions(nodes.map(item => ({ ...item, ...positions[item.id] })), 3)).toEqual(positions)
})
