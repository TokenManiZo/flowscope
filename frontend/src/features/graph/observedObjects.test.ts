import { describe, expect, it } from "vitest"
import type { DisplayObject, EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { apiGroupDescriptor, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex, searchDestination } from "./graphSearch"
import type { GraphFilters } from "./graphProjection"
import { relationshipNodeCard } from "./relationshipNodeCard"

const service = "https://t:443"
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
const nav: GraphNavigation = { level: "group", groupId: apiGroupDescriptor(service, "/posts/A1").id, operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
function data(): Snapshot {
  const events = [1, 2, 3].map(number => ({ eventId: `ev-${number}`, op: `${service} GET /posts/opaque${number}`, idn: "user-a", source: "human", phase: "DISCOVERY", executionTrust: "OBSERVED", status: 200, path: `/posts/opaque${number}`, method: "GET", classificationReasons: [], trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, objects: [], sourceDetail: "BROWSER", timestamp: number } as unknown as EventRecord))
  const cells = events.map(event => ({ idn: event.idn, op: event.op, resource: null, evidenceIds: [event.eventId], perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [] }))
  const displayObjects: DisplayObject[] = events.map((event, index) => ({ eventId: event.eventId, operation: event.op, apiKey: `${service} GET /posts/{id}`, groupKey: "path-group", objectKey: `object-${index+1}`, kind: "PATH", fields: ["/segments/1"], legacyResource: null, ordinal: index+1 }))
  return targetSnapshot({ events, cells, displayObjects })
}
describe("observed display objects", () => {
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
    expect(graph.edges.filter(edge => edge.relation === "operation-resource")).toHaveLength(3)
  })
  it("does not resurrect a single path through legacy resources", () => {
    const snapshot = data(); snapshot.displayObjects = []
    snapshot.cells = [{ ...snapshot.cells[0], resource: `${service} posts:101` }]
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources).toHaveLength(0)
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
})
