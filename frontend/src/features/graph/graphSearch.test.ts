import { describe, expect, it } from "vitest"
import type { Cell } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { emptyGraphWorkspace, graphViewKey, mergeGraphLayout } from "./graphWorkspace"
import { operationGroup, projectHierarchy } from "./graphHierarchy"
import type { GraphFilters } from "./graphProjection"
import { buildGraphSearchIndex, graphSearchViewport, sameSearchCells, searchDestination, searchGraph, searchHighlights, searchKey } from "./graphSearch"

const service = "https://a.test:443"
const operation = `${service} GET /api/orders/101`
const cell = (changes: Partial<Cell> = {}): Cell => ({ idn: "USER A", op: operation, resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["evidence-a"], ...changes })
const initial = emptyGraphWorkspace.navigation
const filters: GraphFilters = { source: ["human", "scanner", "llm", "unknown"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }

describe("project relationship search", () => {
  it("indexes limited and folded members without creating projections or copying Evidence", () => {
    const cells = Array.from({ length: 25 }, (_, index) => cell({ op: `${service} GET /api/orders/${index}`, resource: `orders:${index}` }))
    const index = buildGraphSearchIndex(cells)
    expect(index.byKey.has(searchKey("operation", service, cells[24].op))).toBe(true)
    expect(index.byKey.has(searchKey("resource", service, "orders:24"))).toBe(true)
    expect(index.byKey.has(searchKey("operation-group", service, `${service} GET /api/orders/{id}`))).toBe(true)
    expect(index.byKey.has(searchKey("object-group", service, "|orders"))).toBe(true)
    expect(JSON.stringify(index.entries)).not.toContain("evidence-a")
    expect(buildGraphSearchIndex([cell({ perSource: {} })]).entries).toHaveLength(0)
  })

  it("keeps the same raw object or identity separate by service and de-duplicates repeated cells", () => {
    const other = cell({ op: "https://b.test:443 GET /api/orders/101" })
    const index = buildGraphSearchIndex([cell(), cell(), other])
    expect(index.entries.filter(entry => entry.kind === "resource")).toHaveLength(2)
    expect(index.entries.filter(entry => entry.kind === "identity")).toHaveLength(2)
    expect(index.byKey.get(searchKey("resource", service, "orders:101"))?.contexts).toHaveLength(1)
  })

  it("uses case-insensitive literal AND matching, bounded ranking, and the full match count", () => {
    const cells = Array.from({ length: 70 }, (_, index) => cell({ op: `${service} GET /api/orders/${index}`, resource: `orders:${index}` }))
    const index = buildGraphSearchIndex(cells)
    const results = searchGraph(index, "GeT ORDERS", initial)
    expect(results.entries).toHaveLength(30)
    expect(results.total).toBeGreaterThan(30)
    expect(searchGraph(index, "GeT ORDERS", initial, 60).entries.slice(0, 30)).toEqual(results.entries)
    expect(searchGraph(index, "[.*", initial).total).toBe(0)
    expect(searchGraph(index, "  ", initial).total).toBe(0)
    expect(searchGraph(index, "orders:19", initial).entries[0].kind).toBe("resource")
  })

  it("reuses the index when only Evidence, owner-related decisions, or source verdicts change", () => {
    const before = [cell()]
    expect(sameSearchCells(before, [cell({ evidenceIds: ["new-evidence"], overall: "deny", perSource: { scanner: "deny" } })])).toBe(true)
    expect(sameSearchCells(before, [cell({ resource: "orders:202" })])).toBe(false)
    expect(sameSearchCells(before, [cell({ perSource: {} })])).toBe(false)
  })

  it("reveals a 19th API and its stored geometry without increasing the page limit", () => {
    const cells = Array.from({ length: 19 }, (_, index) => cell({ op: `${service} GET /api/orders/${String(index).padStart(2, "0")}`, resource: null }))
    const snapshot = targetSnapshot({ cells })
    const current = { ...initial, level: "group" as const, groupId: operationGroup(operation).id }
    const graph = projectHierarchy(snapshot, filters, current)
    const index = buildGraphSearchIndex(cells), entry = index.byKey.get(searchKey("operation", service, cells[18].op))!
    const destination = searchDestination(entry, current, graph, false)
    const revealed = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: destination.expand }, destination.navigation, destination.reveal)
    expect(revealed.operations).toHaveLength(19)
    expect(revealed.operations.find(node => node.id === destination.nodeId)?.hiddenInGraph).not.toBe(true)
    expect(revealed.nodes.find(node => node.id === destination.nodeId)?.selection.evidenceIds).toEqual(["evidence-a"])
    expect(revealed.revealedNodeCount).toBe(1)
    expect(destination.navigation.operationLimit).toBe(18)
    const saved = { positions: { [destination.nodeId]: { x: 1200, y: 500 }, "resource:hidden": { x: 1400, y: 800 } }, sizes: {}, viewport: null, expandedGroups: [] }
    expect(mergeGraphLayout(saved, { positions: saved.positions, sizes: {}, viewport: null })).toBe(saved)
    expect(graphViewKey(destination.navigation)).toBe(graphViewKey(current))
  })

  it("opens a hidden object in its current API context with only that extra object", () => {
    const cells = Array.from({ length: 19 }, (_, index) => cell({ resource: `orders:${String(index).padStart(2, "0")}` }))
    const snapshot = targetSnapshot({ cells }), index = buildGraphSearchIndex(cells)
    const current = { ...initial, level: "group" as const, groupId: operationGroup(operation).id }
    const graph = projectHierarchy(snapshot, filters, current)
    const destination = searchDestination(index.byKey.get(searchKey("resource", service, "orders:18"))!, current, graph, false)
    const revealed = projectHierarchy(snapshot, filters, destination.navigation, destination.reveal)
    expect(destination.navigation.level).toBe("operation")
    expect(revealed.resources).toHaveLength(19)
    expect(revealed.nodes.find(node => node.id === destination.nodeId)?.selection.operation).toBe(operation)
    expect(revealed.revealedNodeCount).toBe(1)
    expect(destination.expand).toHaveLength(0)
  })

  it("prefers the existing API for shared objects and keeps an already visible card in place", () => {
    const otherOp = `${service} POST /api/orders/101`
    const cells = [cell(), cell({ op: otherOp })], snapshot = targetSnapshot({ cells })
    const current = { ...initial, level: "operation" as const, groupId: operationGroup(operation).id, operation: otherOp }
    const graph = projectHierarchy(snapshot, filters, current)
    const destination = searchDestination(buildGraphSearchIndex(cells).byKey.get(searchKey("resource", service, "orders:101"))!, current, graph, false)
    expect(destination.navigation).toBe(current)
    expect(destination.reveal.operations).toEqual([otherOp])
  })

  it("can select an automatic API summary even when both members were outside the limit", () => {
    const cells = [cell({ op: `${service} GET /api/orders/901` }), cell({ op: `${service} GET /api/orders/902` }), ...Array.from({ length: 18 }, (_, index) => cell({ op: `${service} POST /api/orders/name-${index}`, overall: "suspicious" }))]
    const snapshot = targetSnapshot({ cells }), index = buildGraphSearchIndex(cells)
    const destination = searchDestination(index.byKey.get(searchKey("operation-group", service, `${service} GET /api/orders/{id}`))!, initial, projectHierarchy(snapshot, filters, initial), false)
    const graph = projectHierarchy(snapshot, filters, destination.navigation, destination.reveal)
    expect(graph.nodes.some(node => node.id === destination.nodeId)).toBe(true)
    expect(graph.operations.filter(node => !node.hiddenInGraph)).toHaveLength(18)
    expect(graph.revealedNodeCount).toBe(2)
  })

  it("marks matching folded members without opening their group and removes vanished results", () => {
    const cells = [cell(), cell({ resource: "orders:202" })], snapshot = targetSnapshot({ cells })
    const navigation = { ...initial, level: "group" as const, groupId: operationGroup(operation).id }
    const graph = projectHierarchy(snapshot, filters, navigation)
    const keys = new Set([searchKey("resource", service, "orders:202")])
    expect(searchHighlights(graph, keys).get("object-group:|orders")).toBe("member")
    expect(graph.resources).toHaveLength(0)
    expect(searchGraph(buildGraphSearchIndex([cell()]), "orders:202", initial).total).toBe(0)
  })
})

describe("search viewport", () => {
  it("keeps the current viewport for a visible card", () => {
    const viewport = { zoom: 1, pan: { x: 10, y: 5 } }
    expect(graphSearchViewport({ x: 300, y: 200, width: 200, height: 100 }, viewport, { width: 900, height: 600 })).toEqual(viewport)
  })
  it("pans minimally past the lane header without changing zoom or the model box", () => {
    const box = { x: 1100, y: 20, width: 200, height: 100 }
    expect(graphSearchViewport(box, { zoom: 1, pan: { x: 0, y: 0 } }, { width: 900, height: 600 })).toEqual({ zoom: 1, pan: { x: -316, y: 86 } })
    expect(box).toEqual({ x: 1100, y: 20, width: 200, height: 100 })
  })
  it("only reduces zoom when the selected card is larger than the usable area", () => {
    const viewport = graphSearchViewport({ x: 700, y: 500, width: 1000, height: 500 }, { zoom: 1.5, pan: { x: 0, y: 0 } }, { width: 900, height: 600 })
    expect(viewport.zoom).toBeCloseTo(0.868)
  })
})

it("distinguishes same host and port with different schemes without affecting result ranking", () => {
  const index = buildGraphSearchIndex([cell({ op: "http://same.test:8900 GET /api/orders/101" }), cell({ op: "https://same.test:8900 GET /api/orders/101" })])
  const matches = searchGraph(index, "GET /api/orders/101", initial)
  const operations = matches.entries.filter(entry => entry.kind === "operation")
  expect(operations).toHaveLength(2)
  expect(matches.entries.slice(0, 2)).toEqual(operations)
  expect(matches.entries.some(entry => entry.kind === "resource")).toBe(true)
  expect(operations.map(entry => matches.hosts?.get(entry.key))).toEqual(["http://same.test:8900", "https://same.test:8900"])
})
