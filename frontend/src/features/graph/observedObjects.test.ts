import { describe, expect, it } from "vitest"
import type { DisplayObject, EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { apiGroupDescriptor, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex, searchDestination } from "./graphSearch"
import type { GraphFilters } from "./graphProjection"
import { graphNodeSummary } from "./GraphNodeSummary"
import { relationshipNodeCard } from "./relationshipNodeCard"

const service = "https://t:443"
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false, expandedObjectGroups: ["object-group:path-group"] }
const nav: GraphNavigation = { level: "group", groupId: apiGroupDescriptor(service, "/posts/A1").id, operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
function data(): Snapshot {
  const events = [1, 2, 3].map(number => ({ eventId: `ev-${number}`, op: `${service} GET /posts/opaque${number}`, idn: "user-a", source: "human", phase: "DISCOVERY", executionTrust: "OBSERVED", status: 200, path: `/posts/opaque${number}`, method: "GET", classificationReasons: [], trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, objects: [], sourceDetail: "BROWSER", timestamp: number } as unknown as EventRecord))
  const cells = events.map(event => ({ idn: event.idn, op: event.op, resource: null, evidenceIds: [event.eventId], perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [] }))
  const displayObjects: DisplayObject[] = events.map((event, index) => ({ eventId: event.eventId, operation: event.op, apiKey: `${service} GET /posts/{id}`, groupKey: "path-group", objectKey: `object-${index+1}`, kind: "PATH", fields: ["/segments/1"], legacyResource: null, ordinal: index+1 }))
  return targetSnapshot({ events, cells, displayObjects })
}
describe("observed display objects", () => {
  it("folds path objects and labels their parameter location", () => {
    const graph = projectHierarchy(data(), { ...filters, expandedObjectGroups: [] }, nav)
    expect(graph.resources).toHaveLength(0)
    const group = graph.nodes.find(node => node.kind === "object-group")!
    expect(group.label).toBe("id")
    expect(relationshipNodeCard(group, graph).badge).toBe("PATH PARAM")
  })
  it("never exposes more than ten OBJ nodes even with larger limits or a search reveal", () => {
    const snapshot = data(), base = snapshot.events[0], object = snapshot.displayObjects![0], cell = snapshot.cells[0]
    snapshot.events = Array.from({ length: 12 }, (_, i) => ({ ...base, eventId: `ev-${i+1}` }))
    snapshot.cells = snapshot.events.map(event => ({ ...cell, evidenceIds: [event.eventId] }))
    snapshot.displayObjects = snapshot.events.map((event, i) => ({ ...object, eventId: event.eventId, ordinal: i+1, objectKey: `object-${i+1}` }))
    const graph = projectHierarchy(snapshot, filters, { ...nav, objectLimit: 100 }, { resource: "object-12" })
    expect(graph.resources.map(node => node.label)).toEqual(Array.from({ length: 10 }, (_, i) => `OBJ ${i+1}`))
    expect(graph.hiddenObjectCount).toBe(0)
  })
  it("shows crAPI detail requests as one API and three locally numbered objects without rewriting cells", () => {
    const snapshot = data(), original = JSON.stringify(snapshot.cells)
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.operations).toHaveLength(1)
    expect(graph.operations[0].label).toBe(`${service} GET /posts/{id}`)
    expect(graph.operations[0].selection.operation).toBeNull()
    expect(graph.resources.map(node => node.label)).toEqual(["OBJ 1", "OBJ 2", "OBJ 3"])
    expect(graph.resources.every(node => node.selection.resource === null)).toBe(true)
    expect(graph.resources.map(node => node.selection.evidenceIds)).toEqual([["ev-1"],["ev-2"],["ev-3"]])
    expect(JSON.stringify(snapshot.cells)).toBe(original)
    expect(graph.edges.filter(edge => edge.relation === "operation-resource")).toHaveLength(4)
    expect(graphNodeSummary(graph.operations[0], graph)?.stats).toContainEqual(["객체", 3])
    expect(graphNodeSummary(graph.resources[0], graph)?.stats).toContainEqual(["관측 기록", 1])
  })
  it("does not resurrect a single path through legacy resources", () => {
    const snapshot = data(); snapshot.displayObjects = []
    snapshot.cells = [{ ...snapshot.cells[0], resource: `${service} posts:101` }]
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources).toHaveLength(0)
  })
  it("caps all expanded groups together at ten nodes without offering more legacy objects", () => {
    const snapshot = data(), base = snapshot.displayObjects![0]
    snapshot.displayObjects = ["path-group", "query-group"].flatMap(groupKey => Array.from({ length: 8 }, (_, i) => ({
      ...base, groupKey, objectKey: `${groupKey}-${i}`, ordinal: i+1, kind: groupKey === "path-group" ? "PATH" as const : "QUERY" as const,
    })))
    const graph = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: ["object-group:path-group", "object-group:query-group"] }, nav)
    expect(graph.resources).toHaveLength(10)
    expect(graph.hiddenObjectCount).toBe(0)
  })
  it("links only confirmed owner labels and retains the canonical request for single-object selection", () => {
    const snapshot = data(); const legacy = `${service} posts:101`
    snapshot.displayObjects = [{ ...snapshot.displayObjects![0], legacyResource: legacy }]
    snapshot.cells = [{ ...snapshot.cells[0], resource: legacy }]
    snapshot.owners = { [legacy]: "user-a" }
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources[0].label).toBe("OBJ 1 - user-a")
    expect(graph.resources[0].selection.operation).toBe(snapshot.events[0].op)
    expect(relationshipNodeCard(graph.resources[0], graph).title).toBe("OBJ 1 - user-a")
  })
  it("searches displayed objects and reveals the same stable node at operation level", () => {
    const snapshot = data(), index = buildGraphSearchIndex(snapshot, filters)
    const entry = index.entries.find(item => item.title === "OBJ 2")!
    expect(entry.value).toBe("object-2")
    const destination = searchDestination(entry, nav, null, false)
    const graph = projectHierarchy(snapshot, filters, destination.navigation, destination.reveal)
    expect(graph.nodes.some(node => node.id === destination.nodeId)).toBe(true)
    expect(graph.resources).toHaveLength(3)
  })
  it("filters observations without renumbering objects or exposing other accounts' evidence", () => {
    const snapshot = data(); snapshot.events[0].idn = "user-b"; snapshot.cells[0].idn = "user-b"
    const graph = projectHierarchy(snapshot, { ...filters, identity: ["user-a"] }, nav)
    expect(graph.resources.map(node => node.label)).toEqual(["OBJ 2", "OBJ 3"])
    expect(graph.resources.flatMap(node => node.selection.evidenceIds)).not.toContain("ev-1")
  })
  it("folds query schemas by field names and opens locally numbered combinations", () => {
    const snapshot = data()
    snapshot.displayObjects = snapshot.displayObjects!.map(object => ({ ...object, kind: "QUERY", fields: ["/page", "/userid"], groupKey: "query-group" }))
    const collapsed = projectHierarchy(snapshot, filters, nav)
    expect(collapsed.resources).toHaveLength(0)
    expect(collapsed.nodes.find(node => node.kind === "object-group")?.label).toBe("page · userid")
    const expanded = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: ["object-group:query-group"] }, nav)
    expect(expanded.resources.map(node => node.label)).toEqual(["OBJ 1", "OBJ 2", "OBJ 3"])
    const entry = buildGraphSearchIndex(snapshot, filters).entries.find(item => item.title === "OBJ 2")!
    const destination = searchDestination(entry, nav, null, false)
    expect(projectHierarchy(snapshot, filters, destination.navigation, destination.reveal).nodes.some(node => node.id === destination.nodeId)).toBe(true)
  })
  it("keeps query and body schemas separate and labels body fields without showing values", () => {
    const snapshot = data(), base = snapshot.displayObjects![0]
    snapshot.displayObjects = [{ ...base, kind: "QUERY", groupKey: "query", objectKey: "query-1", fields: ["/userID"] },
      { ...base, kind: "REQUEST_BODY", groupKey: "body", objectKey: "body-1", fields: ["/password", "/userID"] }]
    const graph = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: ["object-group:query", "object-group:body"] }, nav)
    expect(graph.nodes.filter(node => node.kind === "object-group").map(node => node.label)).toEqual(["userID", "password · userID"])
    expect(graph.resources.map(node => node.label)).toEqual(["OBJ 1", "OBJ 1"])
    expect(graph.resources.every(node => node.selection.evidenceIds.includes("ev-1"))).toBe(true)
  })
  it("shows whole GET responses under a collapsed OBJ group and leaves Request Lab event keys intact", () => {
    const snapshot = data()
    snapshot.displayObjects = snapshot.displayObjects!.map(object => ({ ...object, kind: "RESPONSE_BODY", groupKey: "response", fields: [] }))
    const before = JSON.stringify(snapshot.events)
    const collapsed = projectHierarchy(snapshot, filters, nav)
    expect(collapsed.nodes.find(node => node.kind === "object-group")?.label).toBe("OBJ")
    const expanded = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: ["object-group:response"] }, nav)
    expect(expanded.resources.map(node => node.label)).toEqual(["OBJ 1", "OBJ 2", "OBJ 3"])
    expect(JSON.stringify(snapshot.events)).toBe(before)
  })
})
