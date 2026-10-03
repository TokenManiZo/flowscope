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
  expect(graphWorkspaceChanges(before, after)).toEqual({ views: { a: next }, deletedViews: [] })
})
