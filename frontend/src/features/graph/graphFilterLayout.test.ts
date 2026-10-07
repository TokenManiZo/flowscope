import { expect, it } from "vitest"
import { highlightPositions, type FilterLayoutNode } from "./graphFilterLayout"

it("places every matched card above every unmatched card across lanes and keeps X coordinates", () => {
  const nodes: FilterLayoutNode[] = [
    { id: "identity:a", lane: 0, x: 170, y: 3000, height: 80, matched: true },
    { id: "identity:b", lane: 0, x: 200, y: 100, height: 120, matched: false },
    { id: "api:a", lane: 1, x: 540, y: 3000, height: 300, matched: true },
    { id: "api:b", lane: 1, x: 550, y: 200, height: 80, matched: false },
    { id: "group", lane: 2, x: 900, y: 2500, height: 100, matched: true },
    { id: "object:a", lane: 2, x: 900, y: 2600, height: 200, matched: true, memberOf: "group" },
    { id: "object:b", lane: 2, x: 900, y: 50, height: 180, matched: false, memberOf: "group" },
  ]
  const positions = highlightPositions(nodes, 3)!
  const matchedBottom = Math.max(...nodes.filter(node => node.matched).map(node => positions[node.id].y + node.height / 2))
  const dimmedTop = Math.min(...nodes.filter(node => !node.matched).map(node => positions[node.id].y - node.height / 2))
  expect(dimmedTop - matchedBottom).toBe(40)
  for (const node of nodes) expect(positions[node.id].x).toBe(node.x)
  expect(positions["object:a"].y).toBeGreaterThan(positions.group.y)
  expect(highlightPositions(nodes.map(node => ({ ...node, ...positions[node.id] })), 3)).toEqual(positions)
})

it("does not rearrange an empty match and supports the two-lane site graph", () => {
  const nodes = [{ id: "site", lane: 0, x: 180, y: 900, height: 80, matched: true }, { id: "group", lane: 1, x: 540, y: 100, height: 100, matched: false }]
  expect(highlightPositions(nodes.map(node => ({ ...node, matched: false })), 2)).toBeNull()
  expect(highlightPositions([], 2)).toBeNull()
  expect(highlightPositions(nodes, 2)).toEqual({ site: { x: 180, y: 104 }, group: { x: 540, y: 234 } })
})
