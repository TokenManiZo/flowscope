import { describe, expect, it } from "vitest"
import type { DisplayObject, EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { apiGroupDescriptor, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex, searchDestination } from "./graphSearch"
import type { GraphFilters } from "./graphProjection"
import { graphFocusStates } from "./CytoscapeGraph"
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
  it("restores Public for only the saved API and object while retaining its owner", () => {
    const snapshot = data(), object = snapshot.displayObjects![0]
    const resource = `${service} observed-object:${object.objectKey}`
    snapshot.ownerOverrides = { [resource]: "user-a" }
    snapshot.resourcePolicyOverrides = { [`${object.operation} @ ${resource}`]: "PUBLIC" }
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources.find(node => node.selection.displayObjectKey === object.objectKey)).toMatchObject({ publicRead: true, owner: "user-a" })
    expect(graph.resources.filter(node => node.publicRead)).toHaveLength(1)
  })

  it("uses the same integer and opaque labels in graph and search without changing object order", () => {
    const snapshot = data()
    snapshot.displayObjects = snapshot.displayObjects!.map((object, i) => ({ ...object,
      integerLabel: i === 0 ? "9007199254740993123456789" : null, displayOrdinal: i === 0 ? 0 : i,
    }))
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources.map(node => node.label)).toEqual(["9007199254740993123456789", "OBJ 1", "OBJ 2"])
    expect(graph.resources.map(node => node.id)).toEqual(["resource:object-1", "resource:object-2", "resource:object-3"])
    const index = buildGraphSearchIndex(snapshot, filters)
    for (const object of graph.resources) expect(index.entries.find(entry => entry.value === object.selection.displayObjectKey)?.title).toBe(object.label)
  })
  it("opens a multi-path API family before opening each parent's final objects", () => {
    const snapshot = data()
    const operation = `${service} GET /api/{id}/detail/{id}`
    const family = `${service} GET /api/{id_0}/detail/{id_1}`
    snapshot.events = snapshot.events.map(event => ({ ...event, op: operation }))
    snapshot.cells = snapshot.cells.map(cell => ({ ...cell, op: operation }))
    snapshot.displayObjects = snapshot.displayObjects!.map((object, i) => ({ ...object, operation, apiFamily: family,
      apiKey: `${service} GET /api/${i < 2 ? "101" : "202"}/detail/{id_1}`, groupKey: i < 2 ? "parent-101" : "parent-202", ordinal: i < 2 ? i+1 : 1 }))
    const navigation = { ...nav, groupId: apiGroupDescriptor(service, "/api/{id}/detail/{id}").id }
    const collapsed = projectHierarchy(snapshot, filters, navigation)
    expect(collapsed.operations).toHaveLength(0)
    expect(collapsed.resources).toHaveLength(0)
    expect(collapsed.nodes.find(node => node.kind === "operation-group")?.label).toBe(family)
    const opened = { ...filters, expandedObjectGroups: [`operation-group:${family}`] }
    const parents = projectHierarchy(snapshot, opened, navigation)
    expect(parents.operations).toHaveLength(2)
    expect(new Set(parents.operations.map(node => node.id)).size).toBe(2)
    expect(parents.nodes.filter(node => node.kind === "object-group")).toHaveLength(2)
    expect(parents.resources).toHaveLength(0)
    const apiFamilyNode = parents.nodes.find(node => node.kind === "operation-group")!
    const focus = graphFocusStates(parents, apiFamilyNode.id)
    for (const api of parents.operations) expect(focus.node(api.id)).toBe("yes")
    const children = projectHierarchy(snapshot, { ...opened, expandedObjectGroups: [...opened.expandedObjectGroups, "object-group:parent-101"] }, navigation)
    expect(children.resources.map(node => node.label)).toEqual(["OBJ 1", "OBJ 2"])
    expect(children.resources.flatMap(node => node.selection.evidenceIds)).toEqual(["ev-1", "ev-2"])
    const index = buildGraphSearchIndex(snapshot, filters)
    const entry = index.entries.find(item => item.kind === "operation" && item.value.includes("/api/101/"))!
    const destination = searchDestination(entry, navigation, null, false)
    expect(destination.expand).toContain(`operation-group:${family}`)
    const searched = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: destination.expand }, destination.navigation, destination.reveal)
    expect(searched.nodes.some(node => node.id === destination.nodeId)).toBe(true)
  })
  it("highlights only a path object and its left ancestors, even when a query shares the same evidence", () => {
    const snapshot = data()
    snapshot.displayObjects = [...snapshot.displayObjects!, ...snapshot.displayObjects!.map(object => ({
      ...object, kind: "QUERY" as const, groupKey: "query-group", objectKey: `query-${object.ordinal}`, fields: ["/report_id"],
    }))]
    const graph = projectHierarchy(snapshot, filters, nav)
    const path = graph.nodes.find(node => node.id === "object-group:path-group")!
    const query = graph.nodes.find(node => node.id === "object-group:query-group")!
    const opened = graphFocusStates(graph, path.id, path.id)
    expect(opened.node(path.id)).toBe("yes")
    expect(opened.node(query.id)).toBe("no")
    for (const api of graph.operations) expect(opened.node(api.id)).toBe("yes")
    for (const identity of graph.identities) expect(opened.node(identity.id)).toBe(graph.edges.some(edge => edge.sourceId === identity.id) ? "yes" : "no")
    for (const object of graph.resources) expect(opened.node(object.id)).toBe("yes")
    for (const edge of graph.edges.filter(edge => edge.targetId === query.id)) expect(opened.edge(edge.id)).toBe("no")
    const selected = graphFocusStates(graph, graph.resources[0].id)
    expect(selected.node(graph.resources[0].id)).toBe("yes")
    expect(selected.node(graph.resources[1].id)).toBe("no")
    expect(selected.node(query.id)).toBe("no")
  })
  it("shows only the selected API or identity and its connected branches", () => {
    const snapshot = data(), base = snapshot.events[0]
    const other = { ...base, eventId: "other", idn: "user-b", op: `${service} GET /posts/recent`, path: "/posts/recent" }
    snapshot.events = [...snapshot.events, other]
    snapshot.cells = [...snapshot.cells, { ...snapshot.cells[0], idn: other.idn, op: other.op, evidenceIds: [other.eventId] }]
    snapshot.displayObjects = [...snapshot.displayObjects!, { ...snapshot.displayObjects![0], eventId: other.eventId, operation: other.op,
      apiKey: other.op, kind: "QUERY", groupKey: "other-query", objectKey: "other-query-1", fields: ["/limit"], ordinal: 1 }]
    const graph = projectHierarchy(snapshot, filters, nav)
    const api = graph.operations.find(node => node.selection.displayApiKey?.includes("/posts/{id}"))!
    const otherApi = graph.operations.find(node => node.id !== api.id)!
    const identity = graph.identities.find(node => node.selection.identity === "user-a")!
    const otherIdentity = graph.identities.find(node => node.selection.identity === "user-b")!
    const apiFocus = graphFocusStates(graph, api.id)
    expect(apiFocus.node(api.id)).toBe("yes")
    expect(apiFocus.node(identity.id)).toBe("yes")
    expect(apiFocus.node(otherApi.id)).toBe("no")
    expect(apiFocus.node(otherIdentity.id)).toBe("no")
    expect(apiFocus.node("object-group:other-query")).toBe("no")
    const identityFocus = graphFocusStates(graph, identity.id)
    expect(identityFocus.node(api.id)).toBe("yes")
    expect(identityFocus.node(otherIdentity.id)).toBe("no")
    expect(identityFocus.node(otherApi.id)).toBe("no")
  })
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
  it("keeps object labels free of owner names and retains the original request selection", () => {
    const snapshot = data(); const legacy = `${service} posts:101`
    snapshot.displayObjects = [{ ...snapshot.displayObjects![0], legacyResource: legacy }]
    snapshot.cells = [{ ...snapshot.cells[0], resource: legacy }]
    snapshot.owners = { [legacy]: "user-a" }
    const graph = projectHierarchy(snapshot, filters, nav)
    expect(graph.resources[0].label).toBe("OBJ 1")
    expect(graph.resources[0].selection.operation).toBe(snapshot.events[0].op)
    expect(relationshipNodeCard(graph.resources[0], graph).title).toBe("OBJ 1")
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
