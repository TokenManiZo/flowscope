import { describe, expect, it } from "vitest"
import type { Cell, EventRecord, RouteCandidate } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { emptyGraphWorkspace, graphViewKey, mergeGraphLayout } from "./graphWorkspace"
import { operationGroup, projectHierarchy } from "./graphHierarchy"
import type { GraphFilters } from "./graphProjection"
import { buildGraphSearchIndex as snapshotSearchIndex, graphSearchViewport, searchDestination, searchGraph, searchHighlights, searchKey } from "./graphSearch"

const service = "https://a.test:443"
const operation = `${service} GET /api/orders/101`
const cell = (changes: Partial<Cell> = {}): Cell => ({ idn: "USER A", op: operation, resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["evidence-a"], ...changes })
const initial = emptyGraphWorkspace.navigation
const filters: GraphFilters = { source: ["human", "scanner", "llm", "unknown"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }

const buildGraphSearchIndex = (cells: readonly Cell[]) => snapshotSearchIndex(targetSnapshot({ cells: [...cells] }), filters)
const captured = (changes: Partial<EventRecord> = {}): EventRecord => ({ eventId: "observed", method: "GET", path: "/api/orders/101", status: 200, fp: "", idn: "USER B", role: "USER", source: "human", op: operation, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [changes.eventId ?? "observed"], objects: [], verdict: "untested", ...changes })

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
    const graph = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: [`quiet-group:${navigation.groupId}`] }, navigation)
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

it("indexes and reveals off-page observed functions using their actual node IDs", () => {
  const events = Array.from({ length: 19 }, (_, index) => captured({ eventId: `o-${index}`, op: `${service} GET /api/orders/${String(index).padStart(2, "0")}` }))
  const snapshot = targetSnapshot({ events })
  const index = snapshotSearchIndex(snapshot, { ...filters, includeSupportTraffic: true })
  const entry = index.byKey.get(searchKey("observed-operation", service, events[18].op))!
  expect(entry).toBeDefined()
  const destination = searchDestination(entry, initial, projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, initial), false)
  const revealed = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, destination.navigation, destination.reveal)
  expect(revealed.nodes.find(node => node.id === destination.nodeId)?.selection.evidenceIds).toEqual(["o-18"])
  expect(revealed.revealedNodeCount).toBe(1)
  expect(searchHighlights(revealed, new Set([entry.key])).get(destination.nodeId)).toBe("direct")
  expect(JSON.stringify(index)).not.toContain("o-18")
})

it("indexes only graph-eligible records and keeps one searchable card per operation", () => {
  const snapshot = targetSnapshot({ cells: [cell()], events: [captured(), captured({ eventId: "poll", trafficClass: "POLLING" }), captured({ eventId: "hidden", op: `${service} GET /api/orders/hidden`, classificationOverride: true, classificationReasons: ["USER_EXCLUDE"], trafficDisposition: "EXCLUDE" }), captured({ eventId: "asset", op: `${service} GET /api/orders/app.js`, trafficClass: "STATIC_ASSET" }), captured({ eventId: "replay", op: `${service} POST /api/orders/replay`, phase: "VALIDATION" })] })
  const index = snapshotSearchIndex(snapshot, { ...filters, includeSupportTraffic: true })
  expect(index.entries.filter(entry => ["operation", "observed-operation", "support-operation"].includes(entry.kind))).toEqual([expect.objectContaining({ kind: "operation", value: operation })])
  expect(index.byKey.has(searchKey("identity", service, "USER B"))).toBe(false)
})

it("searches enabled support cards outside the page limit and skips disabled support", () => {
  const events = Array.from({ length: 19 }, (_, index) => captured({ eventId: `p-${index}`, op: `${service} GET /api/orders/poll-${String(index).padStart(2, "0")}`, trafficClass: "POLLING", trafficDisposition: "EXCLUDE" }))
  const snapshot = targetSnapshot({ cells: [cell()], events })
  expect(snapshotSearchIndex(snapshot, filters).entries.some(entry => entry.kind === "support-operation")).toBe(false)
  const enabled = { ...filters, includeSupportTraffic: true }
  const index = snapshotSearchIndex(snapshot, enabled)
  const entry = index.byKey.get(searchKey("observed-operation", service, events[18].op))!
  const destination = searchDestination(entry, initial, projectHierarchy(snapshot, enabled, initial), true)
  const graph = projectHierarchy(snapshot, enabled, destination.navigation, destination.reveal)
  expect(graph.nodes.find(node => node.id === destination.nodeId)?.selection.evidenceIds).toEqual(["p-18"])
})

it("indexes and reveals enabled route candidates with their existing IDs", () => {
  const routes: RouteCandidate[] = Array.from({ length: 19 }, (_, index) => ({ service, method: "GET", pathTemplate: `/api/orders/declared-${index}`, observed: false, applicability: "REVIEW", provenanceTypes: ["JAVASCRIPT"], provenanceEvidenceIds: [], provenance: [{ type: "JAVASCRIPT", evidenceId: `js-${index}`, source: "human", runId: "r", adapter: "browser", applicability: "REVIEW", reason: "declared" }], reviewReason: "not requested", priorityReasons: [] }))
  const snapshot = targetSnapshot({ routeCandidates: routes }), enabled = { ...filters, includeRouteCandidates: true }
  expect(snapshotSearchIndex(snapshot, filters).entries).toHaveLength(0)
  const index = snapshotSearchIndex(snapshot, enabled)
  const entry = index.entries.find(entry => entry.kind === "route-candidate" && entry.title.includes("declared-18"))!
  const destination = searchDestination(entry, initial, projectHierarchy(snapshot, enabled, initial), false)
  const graph = projectHierarchy(snapshot, enabled, destination.navigation, destination.reveal)
  expect(graph.nodes.find(node => node.id === destination.nodeId)?.selection.routeCandidate?.pathTemplate).toBe(routes[18].pathTemplate)
})

it("excludes other-account observations of a judged API from graph search", () => {
  const event = captured({ eventId: "poll-b", trafficClass: "POLLING", trafficDisposition: "EXCLUDE" })
  const snapshot = targetSnapshot({ cells: [cell()], events: [event] })
  const index = snapshotSearchIndex(snapshot, { ...filters, includeSupportTraffic: true })
  expect(index.byKey.has(searchKey("identity", service, "USER B"))).toBe(false)
  expect(snapshot.events).toContain(event)
})

it("uses the displayed ROOT group for API and group search destinations", () => {
  const op = `${service} POST /login`
  const snapshot = targetSnapshot({ cells: [cell({ op, resource: null })] })
  const index = snapshotSearchIndex(snapshot, filters)
  const root = JSON.stringify([service, "root"])
  const api = index.byKey.get(searchKey("operation", service, op))!
  expect(api.contexts[0].groupId).toBe(root)
  const site = projectHierarchy(snapshot, filters, initial)
  const destination = searchDestination(api, initial, site, false)
  expect(projectHierarchy(snapshot, filters, destination.navigation, destination.reveal).nodes.some(node => node.id === destination.nodeId)).toBe(true)
  const group = index.byKey.get(searchKey("api-group", service, root))!
  expect(searchDestination(group, initial, site, false).nodeId).toBe(`api-group:${root}`)
  expect(index.byKey.has(searchKey("api-group", service, JSON.stringify([service, "login"])))).toBe(false)
})

it("reveals a quiet API without changing the group's saved fold state", () => {
  const snapshot = targetSnapshot({ cells: [cell({ resource: null })] })
  const entry = snapshotSearchIndex(snapshot, filters).byKey.get(searchKey("operation", service, operation))!
  const destination = searchDestination(entry, initial, projectHierarchy(snapshot, filters, initial), false)
  const graph = projectHierarchy(snapshot, filters, destination.navigation, destination.reveal)
  expect(graph.nodes.find(node => node.id === destination.nodeId)?.hiddenInGraph).not.toBe(true)
  expect(graph.nodes.find(node => node.kind === "quiet-group")?.objectGroup?.expanded).toBe(false)
  expect(searchHighlights(graph, new Set([entry.key])).get(`quiet-group:${destination.navigation.groupId}`)).toBe("member")
  expect(projectHierarchy(snapshot, filters, destination.navigation).nodes.find(node => node.id === destination.nodeId)?.hiddenInGraph).toBe(true)
})
