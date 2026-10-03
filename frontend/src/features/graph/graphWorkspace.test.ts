import { expect, it } from "vitest"
import { emptyGraphView, emptyGraphWorkspace, graphView, graphViewKey, graphWorkspaceChanges, importLegacyLayout, initialGraphNavigation, mergeGraphLayout } from "./graphWorkspace"

it("separates site, service groups and operations without using display limits as layout identity", () => {
  const group = { ...initialGraphNavigation, level: "group" as const, groupId: '["https://a.test","orders"]' }
  const operation = { ...group, level: "operation" as const, operation: "GET /orders/{id}" }
  const keys = [graphViewKey(initialGraphNavigation), graphViewKey(group), graphViewKey(operation), graphViewKey({ ...group, groupId: '["https://b.test","orders"]' })]
  expect(new Set(keys).size).toBe(4)
  expect(graphViewKey({ ...operation, objectLimit: 36 })).toBe(graphViewKey(operation))
})

it("merges visible geometry while retaining folded/limited nodes and sizes", () => {
  const saved = { ...emptyGraphView, positions: { visible: { x: 1, y: 2 }, hidden: { x: 3, y: 4 } }, sizes: { hidden: { width: 300, height: 100 } } }
  const next = mergeGraphLayout(saved, { positions: { visible: { x: 8, y: 9 } }, sizes: {}, viewport: { zoom: 1.2, pan: { x: -20, y: 40 } } })
  expect(next.positions).toEqual({ visible: { x: 8, y: 9 }, hidden: { x: 3, y: 4 } })
  expect(next.sizes).toEqual(saved.sizes)
  expect(saved.positions.visible).toEqual({ x: 1, y: 2 })
  const key = graphViewKey(initialGraphNavigation)
  const projectA = { ...emptyGraphWorkspace, views: { [key]: next } }
  expect(graphView(projectA, initialGraphNavigation)).toEqual(next)
  expect(graphView(emptyGraphWorkspace, initialGraphNavigation)).toEqual(emptyGraphView)
})

it("imports legacy coordinates once into one project and leaves established layouts intact", () => {
  const legacy = { version: 7 as const, positions: { node: { x: 70, y: 90 } }, viewport: { zoom: 1.3, pan: { x: 2, y: 3 } }, locked: true, inputMode: "trackpad" as const }
  const imported = importLegacyLayout(emptyGraphWorkspace, legacy)
  expect(graphView(imported, initialGraphNavigation).positions).toEqual(legacy.positions)
  expect(graphView(imported, { ...initialGraphNavigation, level: "group", groupId: "orders" }).viewport).toBeNull()
  expect(importLegacyLayout(imported, legacy)).toBe(imported)
  expect(emptyGraphWorkspace.views).toEqual({})
})

it("keeps geometry references on pan-only updates and transmits only the changed view", () => {
  const view = { ...emptyGraphView, positions: { node: { x: 10, y: 20 } } }
  const next = mergeGraphLayout(view, { positions: { node: { x: 10, y: 20 } }, viewport: { zoom: 1, pan: { x: 3, y: 4 } }, sizes: {} })
  expect(next.positions).toBe(view.positions)
  expect(next.sizes).toBe(view.sizes)
  expect(mergeGraphLayout(next, { positions: next.positions, sizes: next.sizes, viewport: next.viewport })).toBe(next)
  const before = { ...emptyGraphWorkspace, views: { a: view, b: view } }, after = { ...before, views: { a: next, b: view } }
  expect(graphWorkspaceChanges(before, after)).toEqual({ views: {}, viewPatches: { a: { viewport: next.viewport } }, deletedViews: [] })
})

it("transmits one changed position in a large view and keeps hidden geometry out of the patch", () => {
  const positions = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`operation:GET /${"orders/".repeat(20)}${index}`, { x: 500, y: index * 100 }]))
  const view = { ...emptyGraphView, positions }
  const id = Object.keys(positions)[0]
  const next = mergeGraphLayout(view, { positions: { [id]: { x: 650, y: 250 } }, sizes: {}, viewport: null })
  const changes = graphWorkspaceChanges({ ...emptyGraphWorkspace, views: { site: view } }, { ...emptyGraphWorkspace, views: { site: next } })
  expect(changes.views).toEqual({})
  expect(changes.viewPatches).toEqual({ site: { positions: { [id]: { x: 650, y: 250 } } } })
  const body = new URLSearchParams({ changes: JSON.stringify(changes) })
  expect(new TextEncoder().encode(body.toString()).byteLength).toBeLessThan(32 * 1024)
  expect(Object.keys(next.positions)).toHaveLength(500)
})

it("represents clearing viewport, sizes, positions and expanded groups without losing another view", () => {
  const original = { ...emptyGraphView, positions: { a: { x: 1, y: 2 } }, sizes: { a: { width: 300, height: 100 } },
    viewport: { zoom: 1, pan: { x: 20, y: 30 } }, expandedGroups: ["object-group:orders"] }
  const before = { ...emptyGraphWorkspace, views: { a: original, other: original } }
  const after = { ...before, views: { a: emptyGraphView } }
  expect(graphWorkspaceChanges(before, after)).toEqual({ views: {}, deletedViews: ["other"], viewPatches: {
    a: { deletedPositions: ["a"], deletedSizes: ["a"], clearViewport: true, expandedGroups: [] },
  } })
})

it("keeps distinct long paths in view and geometry identifiers", () => {
  const prefix = `https://api.test:443 GET /${"segment/".repeat(300)}`
  const first = graphViewKey({ ...initialGraphNavigation, level: "operation", groupId: "orders", operation: `${prefix}a` })
  const second = graphViewKey({ ...initialGraphNavigation, level: "operation", groupId: "orders", operation: `${prefix}b` })
  expect(first.length).toBeGreaterThan(2048)
  expect(first).not.toBe(second)
})
