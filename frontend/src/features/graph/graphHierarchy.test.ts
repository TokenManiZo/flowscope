import { describe, expect, it } from "vitest"

import type { Cell, EventRecord, RouteCandidate, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { apiGroupDescriptor, GRAPH_PAGE_SIZE, graphOpenAction, objectGroupKey, navigateHierarchy, projectHierarchy, stepBack, type GraphNavigation } from "./graphHierarchy"
import type { GraphFilters } from "./graphProjection"

const service = "https://demo.test:443"
const get = `${service} GET /api/orders/{id}`
const patch = `${service} PATCH /api/orders/{id}`
const groupId = '["https://demo.test:443","orders"]'
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
const initial: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const cell = (overrides: Partial<Cell> = {}): Cell => ({ idn: "USER A", op: get, resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["h-101"], ...overrides })
const data = (): Snapshot => targetSnapshot({
  activeSources: ["human", "scanner", "llm"], roles: { "USER A": "USER", "USER B": "USER" }, owners: { "orders:101": "USER A", "orders:202": "USER B" },
  cells: [cell({ perSource: { human: "allow", scanner: "deny", llm: "suspicious" }, overall: "undecided", conflict: true, evidenceIds: ["h-101", "s-101", "l-101"] }), cell({ idn: "USER B", op: patch, resource: "orders:202", evidenceIds: ["h-202"] })],
})
const groupNav = (): GraphNavigation => navigateHierarchy(initial, "group", groupId)
const operationNav = (): GraphNavigation => navigateHierarchy(groupNav(), "operation", groupId, get)
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({ eventId: "support-1", method: "GET", path: "/api/orders/poll", status: 200, fp: "", idn: "USER A", role: "USER", source: "human", op: `${service} GET /api/orders/poll`, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run-1", authState: "AUTH", trafficClass: "POLLING", trafficDisposition: "EXCLUDE", coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "cluster-1", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["support-1"], objects: [], verdict: "untested", ...overrides })

describe("API hierarchy", () => {
  it.each([["/api/orders/101", "orders"], ["/rest/v1/orders/101", "orders"], ["/v2/admin/users", "admin"], ["/", "root"], ["/API/REST/v1.2/Order_Items/101", "order_items"], ["/api", "api"]])("groups %s by its first stable segment", (path, key) => {
    expect(apiGroupDescriptor(service, path).key).toBe(key)
  })

  it("keeps identical path groups separate by service and uses stable display-only IDs", () => {
    expect(apiGroupDescriptor(service, "/api/orders")).toEqual({ id: groupId, service, key: "orders", label: "ORDERS APIs" })
    expect(apiGroupDescriptor("https://a.test:443", "/api/orders").id).not.toBe(apiGroupDescriptor("https://b.test:443", "/api/orders").id)
    expect(apiGroupDescriptor("", "/")).toMatchObject({ service: "Target", key: "root", label: "ROOT APIs" })
  })

  it("shows only neutral Target→Group structure with filtered counts and explicit gaps at site level", () => {
    const site = projectHierarchy(data(), filters, initial)
    expect(site.kind).toBe("site")
    expect(site.groups[0]).toMatchObject({ endpointCount: 2, sourceCounts: { human: 2, scanner: 1, llm: 1 }, gapCount: 1 })
    expect(site.nodes.map(node => node.kind).sort()).toEqual(["api-group", "target"])
    expect(site.edges).toEqual([expect.objectContaining({ relation: "target-group", structural: true, source: null, count: 0, selection: expect.objectContaining({ evidenceIds: [], cellKeys: [] }) })])
    expect(site.listItems.map(node => node.kind)).toEqual(["api-group"])
    const filtered = projectHierarchy(data(), { ...filters, identity: ["USER B"], source: ["human"] }, initial)
    expect(filtered.groups[0]).toMatchObject({ endpointCount: 1, sourceCounts: { human: 1, scanner: 0, llm: 0 }, gapCount: 0 })
    expect(projectHierarchy(data(), { ...filters, reviewStates: ["deny"] }, initial).groups).toHaveLength(0)
  })

  it("opens right-lane nodes inward and left identity nodes back up, never the target or objects", () => {
    expect(graphOpenAction("api-group", "site")).toBe("in")
    expect(graphOpenAction("operation", "group")).toBe("in")
    expect(graphOpenAction("identity", "group")).toBe("back")
    expect(graphOpenAction("identity", "operation")).toBe("back")
    expect(graphOpenAction("target", "site")).toBeNull()
    expect(graphOpenAction("resource", "operation")).toBeNull()
    expect(graphOpenAction("operation", "operation")).toBeNull()
  })

  it("renders Identity→API→Object with separate source buckets in group view", () => {
    const group = projectHierarchy(data(), { ...filters, expandedObjectGroups: ["object-group:|orders"] }, groupNav())
    expect(group.kind).toBe("group")
    expect(group.nodes.some(node => node.kind === "resource")).toBe(true)
    expect(group.edges.every(edge => edge.relation === "identity-operation" || edge.relation === "operation-resource")).toBe(true)
    expect(group.edges.filter(edge => edge.relation === "identity-operation" && edge.selection.identity === "USER A").map(edge => [edge.source, edge.line, edge.sourceText]).sort()).toEqual([["human", "solid", "HUMAN"], ["llm", "dotted", "LLM"], ["scanner", "dashed", "SCANNER"]])
    expect(group.operations[0].selection.cells[0].overall).toBe("undecided")
    expect(group.listItems).toEqual(group.operations)
  })

  it("folds objects of the same kind into one collapsed group node with one edge per API and source", () => {
    const snapshot = data()
    snapshot.cells = [...snapshot.cells, cell({ resource: "receipt-latest", evidenceIds: ["h-receipt"] })]
    const group = projectHierarchy(snapshot, filters, groupNav())
    const orders = group.nodes.find(node => node.kind === "object-group")
    expect(orders).toMatchObject({ id: "object-group:|orders", label: "orders", objectGroup: { key: "orders", members: ["orders:101", "orders:202"], expanded: false } })
    expect(orders?.objectGroup?.owners).toEqual({ "orders:101": "USER A", "orders:202": "USER B" })
    // 접힌 묶음의 객체는 개별 노드로 그리지 않고, ":"이 없는 객체만 따로 그린다.
    expect(group.resources.map(node => node.label)).toEqual(["receipt-latest"])
    const toGroup = group.edges.filter(edge => edge.targetId === "object-group:|orders")
    expect(toGroup.map(edge => [edge.sourceId, edge.source]).sort()).toEqual([[`operation:${get}`, "human"], [`operation:${get}`, "llm"], [`operation:${get}`, "scanner"], [`operation:${patch}`, "human"]])
    expect(group.hiddenObjectCount).toBe(0)
  })

  it("expands one group into its objects right after the group node", () => {
    const group = projectHierarchy(data(), { ...filters, expandedObjectGroups: ["object-group:|orders"] }, groupNav())
    const lane = group.nodes.filter(node => node.kind === "object-group" || node.kind === "resource").map(node => node.id)
    expect(lane).toEqual(["object-group:|orders", "resource:orders:101", "resource:orders:202"])
    expect(group.nodes.find(node => node.kind === "object-group")?.objectGroup?.expanded).toBe(true)
    expect(group.edges.some(edge => edge.targetId === "object-group:|orders")).toBe(false)
    expect(group.edges.filter(edge => edge.relation === "operation-resource").every(edge => edge.targetId.startsWith("resource:"))).toBe(true)
  })

  it("groups objects by the part before ':' after the service address and leaves others ungrouped", () => {
    expect(objectGroupKey("http://127.0.0.1:8888 orders:13")).toEqual({ id: "http://127.0.0.1:8888|orders", key: "orders" })
    expect(objectGroupKey("products:1")).toEqual({ id: "|products", key: "products" })
    expect(objectGroupKey("http://127.0.0.1:8888 receipt-latest")).toBeNull()
    expect(graphOpenAction("object-group", "group")).toBe("toggle")
  })

  it("renders only selected API Objects, preserves server owners, and ends objectless requests at API", () => {
    const snapshot = data()
    snapshot.cells = [...snapshot.cells, cell({ resource: "orders:202", evidenceIds: ["h-get-202"] }), cell({ resource: null, evidenceIds: ["h-no-object"] })]
    const operation = projectHierarchy(snapshot, filters, operationNav())
    expect(operation.kind).toBe("operation")
    expect(operation.operations.map(node => node.selection.operation)).toEqual([get])
    expect(operation.resources.map(node => node.label)).toEqual(expect.arrayContaining([expect.stringContaining("101"), expect.stringContaining("202")]))
    expect(operation.resources.find(node => node.selection.resource === "orders:202")).toMatchObject({ owner: "USER B" })
    expect(operation.edges.filter(edge => edge.relation === "operation-resource").every(edge => edge.selection.resource !== null)).toBe(true)
    expect(operation.edges.find(edge => edge.relation === "identity-operation" && edge.source === "human")?.selection.evidenceIds).toContain("h-no-object")
    expect(operation.listItems.some(node => node.selection.resource === null)).toBe(true)
  })

  it("retains every collapsed raw cell key and 기록 번호 without crossing identity/source paths", () => {
    const snapshot = data()
    snapshot.cells = [...snapshot.cells, cell({ resource: "orders:202", evidenceIds: ["h-get-202", "retained-without-event"] }), cell({ idn: "USER B", evidenceIds: ["b-get-101"] })]
    const group = projectHierarchy(snapshot, filters, groupNav())
    const edge = group.edges.find(item => item.source === "human" && item.selection.identity === "USER A")!
    expect(edge.selection.cellKeys).toEqual(['["USER A","https://demo.test:443 GET /api/orders/{id}","orders:101"]', '["USER A","https://demo.test:443 GET /api/orders/{id}","orders:202"]'])
    expect(edge.selection.evidenceIds).toEqual(["h-101", "h-get-202", "l-101", "retained-without-event", "s-101"])
    expect(edge.selection.resource).toBeNull()
    expect(edge.selection.cells).toEqual([snapshot.cells[0], snapshot.cells[2]])
    const operation = projectHierarchy(snapshot, filters, operationNav())
    expect(operation.edges.filter(item => item.relation === "operation-resource" && item.selection.resource === "orders:101" && item.source === "human").map(item => item.selection.identity).sort()).toEqual(["USER A", "USER B"])
  })

  it("pages 18 APIs/Objects and keeps all access 관측 기록 when Object nodes are hidden", () => {
    const operations = targetSnapshot({ cells: Array.from({ length: 19 }, (_, index) => cell({ op: `${service} GET /api/orders/${index}`, evidenceIds: [`ev-${index}`] })) })
    expect(projectHierarchy(operations, filters, groupNav()).operations).toHaveLength(18)
    expect(projectHierarchy(operations, filters, groupNav()).hiddenOperationCount).toBe(1)
    expect(projectHierarchy(operations, filters, { ...groupNav(), operationLimit: 18 + GRAPH_PAGE_SIZE }).operations).toHaveLength(19)
    const objects = targetSnapshot({ cells: Array.from({ length: 19 }, (_, index) => cell({ resource: `orders:${index}`, evidenceIds: [`ev-${index}`] })) })
    const collapsed = projectHierarchy(objects, filters, operationNav())
    expect(collapsed.resources).toHaveLength(18)
    expect(collapsed.hiddenObjectCount).toBe(1)
    expect(collapsed.edges.find(edge => edge.relation === "identity-operation")?.selection.evidenceIds).toHaveLength(19)
    expect(projectHierarchy(objects, filters, { ...operationNav(), objectLimit: 18 + GRAPH_PAGE_SIZE }).resources).toHaveLength(19)
    expect(projectHierarchy(objects, { ...filters, expanded: true }, operationNav()).resources).toHaveLength(18)
  })

  it("prioritizes suspicious, conflict, partial, then 관측 기록 count without changing verdicts", () => {
    const snapshot = targetSnapshot({ cells: [cell({ op: `${service} GET /api/orders/a` }), cell({ op: `${service} GET /api/orders/z`, overall: "suspicious" }), cell({ op: `${service} GET /api/orders/y`, conflict: true }), cell({ op: `${service} GET /api/orders/x`, missedSources: ["scanner"] })] })
    expect(projectHierarchy(snapshot, filters, groupNav()).operations.map(node => node.selection.operation)).toEqual([`${service} GET /api/orders/z`, `${service} GET /api/orders/y`, `${service} GET /api/orders/x`, `${service} GET /api/orders/a`])
  })

  it("follows the exact operation→group→site back sequence and navigation reset rules", () => {
    const expanded = { ...groupNav(), operationLimit: 36, objectLimit: 36, focusCandidateKey: "focused" }
    expect(navigateHierarchy(expanded, "group", groupId)).toEqual({ ...groupNav(), operationLimit: 36 })
    const operation = navigateHierarchy(expanded, "operation", groupId, get)
    expect(operation).toEqual({ ...initial, level: "operation", groupId, operation: get })
    expect(stepBack({ ...operation, operationLimit: 36, objectLimit: 36, focusCandidateKey: "focused" })).toEqual({ ...groupNav(), operationLimit: 36 })
    expect(stepBack(stepBack(operation))).toEqual(initial)
    expect(stepBack(initial)).toEqual(initial)
    expect(navigateHierarchy(expanded, "group", "different").operationLimit).toBe(18)
    expect(expanded.focusCandidateKey).toBe("focused")
  })

  it("falls back to group for a missing operation and site for a missing filtered group", () => {
    const missingOp = projectHierarchy(data(), filters, { ...operationNav(), operation: "missing" })
    expect(missingOp.kind).toBe("group")
    expect(missingOp.navigation).toEqual(groupNav())
    const missingGroup = projectHierarchy(data(), { ...filters, identity: ["absent"] }, operationNav())
    expect(missingGroup.kind).toBe("site")
    expect(missingGroup.navigation).toEqual(initial)
  })

  it("keeps route candidates neutral and service-separated, preserving complete provenance", () => {
    const route: RouteCandidate = { service: "https://other.test:443", method: "UNKNOWN", pathTemplate: "/api/orders/{id}", observed: false, applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-1"], provenance: [{ type: "SITE_MAP", evidenceId: "route-1", source: "llm", runId: "run-1", adapter: "burp", applicability: "REVIEW", reason: "no request" }], reviewReason: "no request", priorityReasons: ["metadata"] }
    const snapshot = { ...data(), routeCandidates: [route] }
    expect(projectHierarchy(snapshot, filters, initial).groups).toHaveLength(1)
    const site = projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true }, initial)
    expect(site.groups).toHaveLength(2)
    expect(site.groups[1]).toMatchObject({ endpointCount: 0, routeCandidateCount: 1, sourceCounts: { human: 0, scanner: 0, llm: 0 }, gapCount: 0 })
    const group = projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true }, navigateHierarchy(initial, "group", '["https://other.test:443","orders"]'))
    expect(group.routeCandidates[0].selection.routeCandidate?.provenance).toEqual(route.provenance)
    expect(group.edges).toHaveLength(0)
    expect(group.nodes[0]).toMatchObject({ kind: "route-candidate", verdict: "unknown" })
  })

  it("applies the existing source and identity route-candidate filters to the hierarchy", () => {
    const route: RouteCandidate = { service: "https://other.test:443", method: "GET", pathTemplate: "/api/declared", observed: false, applicability: "REVIEW", provenanceTypes: ["JAVASCRIPT"], provenanceEvidenceIds: ["js-1"], provenance: [{ type: "JAVASCRIPT", evidenceId: "js-1", source: "SCANNER", runId: "scan-1", adapter: "fetch", applicability: "REVIEW", reason: "declared" }], reviewReason: "not requested", priorityReasons: [] }
    const snapshot = { ...data(), routeCandidates: [route] }
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, source: ["scanner"] }, initial).groups.map(group => group.id)).toContain('["https://other.test:443","declared"]')
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, source: ["human"] }, initial).groups.map(group => group.id)).not.toContain('["https://other.test:443","declared"]')
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, identity: ["USER A"] }, initial).groups.map(group => group.id)).not.toContain('["https://other.test:443","declared"]')
  })

  it("uses server UNCROSSED gaps for focused unobserved paths without inventing 관측 기록 or verdicts", () => {
    const snapshot = data()
    snapshot.gaps = [{ id: "gap-b", type: "UNCROSSED", risk: 2, idn: "USER B", op: get, resource: "orders:303", missedSources: ["human", "scanner", "llm"], summary: "unobserved combination" }]
    const focusCandidateKey = '["USER B","https://demo.test:443 GET /api/orders/{id}","orders:303"]'
    expect(projectHierarchy(snapshot, filters, initial).groups[0].gapCount).toBe(2)
    expect(projectHierarchy(snapshot, filters, operationNav()).resources).toHaveLength(1)
    const operation = projectHierarchy(snapshot, filters, { ...operationNav(), focusCandidateKey, objectLimit: 1 })
    expect(operation.resources[0].selection.resource).toBe("orders:303")
    expect(operation.edges.filter(edge => edge.relation === "candidate")).toEqual([expect.objectContaining({ source: null, selection: expect.objectContaining({ cellKeys: [focusCandidateKey], gapIds: ["gap-b"], evidenceIds: [] }) }), expect.objectContaining({ source: null })])
  })

  it("retains observed UNTESTED cells when the server has no owner oracle", () => {
    const snapshot = targetSnapshot({ cells: [cell({ perSource: { human: "untested" }, overall: "untested" })] })
    const group = projectHierarchy(snapshot, filters, groupNav())
    expect(group.operations).toHaveLength(1)
    expect(group.edges[0]).toMatchObject({ source: "human", count: 1 })
    expect(group.operations[0].verdict).toBe("untested")
  })

  it("retains a focused candidate beyond the 40-path cap while preserving the cap and other candidate order", () => {
    const snapshot = data()
    snapshot.gaps = Array.from({ length: 41 }, (_, index) => ({ id: `gap-${index + 1}`, type: "UNCROSSED", risk: 2, idn: `CANDIDATE ${index + 1}`, op: get, resource: "orders:303", missedSources: ["human", "scanner", "llm"], summary: "unobserved combination" }))
    const focusCandidateKey = '["CANDIDATE 41","https://demo.test:443 GET /api/orders/{id}","orders:303"]'
    const originalGaps = JSON.stringify(snapshot.gaps)
    const operation = projectHierarchy(snapshot, filters, { ...operationNav(), focusCandidateKey, objectLimit: 1 })
    const candidateEdges = operation.edges.filter(edge => edge.relation === "candidate")
    const focusedEdges = candidateEdges.filter(edge => edge.selection.cellKeys.includes(focusCandidateKey))
    expect(operation.resources.map(node => node.selection.resource)).toEqual(["orders:303"])
    expect(operation.identities.some(node => node.selection.identity === "CANDIDATE 41")).toBe(true)
    expect(focusedEdges).toHaveLength(2)
    expect(focusedEdges.map(edge => [edge.sourceId, edge.targetId])).toEqual([["identity:CANDIDATE 41", `operation:${get}`], [`operation:${get}`, "resource:orders:303"]])
    expect(focusedEdges.every(edge => edge.source === null && edge.selection.evidenceIds.length === 0 && edge.selection.gapIds[0] === "gap-41")).toBe(true)
    expect(candidateEdges).toHaveLength(80)
    expect(candidateEdges.slice(0, 4).map(edge => edge.selection.gapIds[0])).toEqual(["gap-41", "gap-41", "gap-1", "gap-1"])
    expect(candidateEdges.at(-1)?.selection.gapIds).toEqual(["gap-39"])
    expect(JSON.stringify(snapshot.gaps)).toBe(originalGaps)
  })

  it("counts 관측 기록 by server event source without merging H/S/L or inflating by repeat metadata", () => {
    const snapshot = targetSnapshot({ cells: [cell({ perSource: { human: "allow", scanner: "allow" }, evidenceIds: ["h-1", "h-2", "s-1"] })], events: [event({ eventId: "h-1", op: get, clusterEvidenceIds: ["h-1", "h-2"], repeatCount: 99 }), event({ eventId: "s-1", op: get, source: "scanner", clusterEvidenceIds: ["s-1"] })] })
    const group = projectHierarchy(snapshot, { ...filters, source: ["human"] }, groupNav())
    expect(group.groups[0].sourceCounts).toEqual({ human: 2, scanner: 1, llm: 0 })
    const accessEdges = group.edges.filter((edge) => edge.relation === "identity-operation")
    expect(accessEdges).toHaveLength(1)
    expect(accessEdges[0]).toMatchObject({ source: "human", count: 2, countLabel: "×2" })
  })

  it("attributes bounded snapshot events without cluster members by their representative 기록 번호", () => {
    const snapshot = targetSnapshot({ cells: [cell({ perSource: { human: "allow", scanner: "allow" }, evidenceIds: ["h-1", "s-1"] })], events: [{ ...event({ eventId: "h-1", op: get }), clusterEvidenceIds: undefined }, { ...event({ eventId: "s-1", op: get, source: "scanner" }), clusterEvidenceIds: undefined }] })
    expect(projectHierarchy(snapshot, filters, initial).groups[0].sourceCounts).toEqual({ human: 1, scanner: 1, llm: 0 })
  })

  it("does not reintroduce filtered-out conflict cells through server gap summaries", () => {
    const snapshot = data()
    snapshot.gaps = [{ id: "other-conflict", type: "CONFLICT", risk: 2, idn: "USER B", op: get, resource: "orders:999", missedSources: [], summary: "excluded cell" }]
    expect(projectHierarchy(snapshot, filters, initial).groups[0].gapCount).toBe(1)
  })

  it("shows only explicitly enabled support flows for the selected group, not coverage or route evidence", () => {
    const snapshot = { ...data(), events: [event(), event({ eventId: "review-api", trafficClass: "API", trafficDisposition: "REVIEW" }), event({ eventId: "elsewhere", op: `${service} GET /api/users/poll` }), event({ eventId: "included", op: `${service} GET /api/orders/include`, trafficDisposition: "INCLUDE" })] }
    expect(projectHierarchy(snapshot, filters, groupNav()).nodes.some(node => node.kind === "support-operation")).toBe(false)
    const group = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, groupNav())
    expect(group.nodes.filter(node => node.kind === "support-operation").map(node => node.selection.operation)).toEqual([`${service} GET /api/orders/poll`])
    expect(group.edges.filter(edge => edge.relation === "support")).toEqual([expect.objectContaining({ source: "human", selection: expect.objectContaining({ evidenceIds: ["support-1"], cellKeys: [] }) })])
    expect(group.groups[0]).toMatchObject({ endpointCount: 2, sourceCounts: { human: 2, scanner: 1, llm: 1 } })
    expect(projectHierarchy(snapshot, { ...filters, source: ["scanner"], includeSupportTraffic: true }, groupNav()).nodes.some(node => node.kind === "support-operation")).toBe(false)
  })

  it("shows response-backed GET and POST without authorization cells as neutral graph nodes", () => {
    const getOp = `${service} GET /account/edit`, postOp = `${service} POST /account/update`
    const snapshot = targetSnapshot({ events: [
      event({ eventId: "get-1", op: getOp, method: "GET", path: "/account/edit?ticket=alpha&page=1", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", classificationReasons: ["AMBIGUOUS_KEEP"] }),
      event({ eventId: "get-2", op: getOp, method: "GET", path: "/account/edit?ticket=beta&page=2", source: "scanner", trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE", classificationReasons: ["DOCUMENT_NAVIGATION"] }),
      event({ eventId: "post-1", op: postOp, method: "POST", path: "/account/update", trafficClass: "API", trafficDisposition: "EXCLUDE", phase: "BASELINE", classificationReasons: ["HUMAN_OUTSIDE_EXPLORATION_RUN"] }),
    ] })
    const site = projectHierarchy(snapshot, filters, initial)
    expect(site.groups).toEqual([expect.objectContaining({ key: "account", endpointCount: 0, observedCount: 2 })])
    const group = projectHierarchy(snapshot, filters, navigateHierarchy(initial, "group", site.groups[0].id))
    expect(group.nodes.filter(node => node.kind === "observed-operation").map(node => [node.selection.operation, node.verdict, node.selection.evidenceIds])).toEqual([
      [getOp, "unknown", ["get-1", "get-2"]], [postOp, "unknown", ["post-1"]],
    ])
    expect(group.edges.filter(edge => edge.relation === "observed").map(edge => [edge.source, edge.selection.evidenceIds])).toEqual([
      ["human", ["get-1"]], ["scanner", ["get-2"]], ["human", ["post-1"]],
    ])
    expect(group.nodes.every(node => node.selection.cells.length === 0)).toBe(true)
  })

  it("does not turn assets, request-only attempts, validation or explicit exclusions into graph nodes", () => {
    const snapshot = targetSnapshot({ events: [
      event({ eventId: "asset", op: `${service} GET /account/app.js`, path: "/account/app.js", trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE" }),
      event({ eventId: "no-response", op: `${service} GET /account/attempt`, path: "/account/attempt", status: 0, trafficClass: "UNKNOWN", trafficDisposition: "EXCLUDE", classificationReasons: ["NO_RESPONSE"] }),
      event({ eventId: "validation", op: `${service} POST /account/update`, method: "POST", path: "/account/update", phase: "VALIDATION", trafficClass: "API", trafficDisposition: "EXCLUDE" }),
      event({ eventId: "excluded", op: `${service} GET /account/private`, path: "/account/private", trafficClass: "UNKNOWN", trafficDisposition: "EXCLUDE", classificationOverride: true, classificationReasons: ["USER_EXCLUDE"] }),
    ] })
    expect(projectHierarchy(snapshot, filters, initial).groups).toEqual([])
  })

  it("retains manually reviewed functions while excluding manually hidden functions", () => {
    const reviewed = event({ eventId: "reviewed", op: get, trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", classificationOverride: true, classificationReasons: ["USER_REVIEW"] })
    const hidden = { ...reviewed, eventId: "hidden", op: patch, trafficDisposition: "EXCLUDE", classificationReasons: ["USER_EXCLUDE"] }
    const snapshot = targetSnapshot({ events: [reviewed, hidden] })
    const group = projectHierarchy(snapshot, filters, groupNav())
    expect(group.nodes.filter(node => node.kind === "observed-operation").map(node => node.selection.operation)).toEqual([get])
    expect(group.edges.find(edge => edge.relation === "observed")?.selection.evidenceIds).toEqual(["reviewed"])
  })

  it("never mutates the input snapshot, filters, or navigation", () => {
    const snapshot = data()
    const before = JSON.stringify({ snapshot, filters, initial })
    projectHierarchy(snapshot, filters, operationNav())
    expect(JSON.stringify({ snapshot, filters, initial })).toBe(before)
  })

  it("keeps repeated support edges independently selectable by their original 관측 기록", () => {
    const snapshot = { ...data(), events: [event(), event({ eventId: "support-2", clusterEvidenceIds: ["support-2"] })] }
    const edges = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, groupNav()).edges.filter(edge => edge.relation === "support")
    expect(edges).toHaveLength(2)
    expect(new Set(edges.map(edge => edge.id)).size).toBe(2)
    expect(edges.map(edge => edge.selection.evidenceIds)).toEqual([["support-1"], ["support-2"]])
  })

  it("folds same-shape APIs into one API group node, hides members in the graph and merges their edges into it", () => {
    const one = `${service} GET /api/orders/101`, two = `${service} GET /api/orders/202`
    const snapshot = targetSnapshot({ activeSources: ["human"], cells: [cell({ op: one, resource: null, evidenceIds: ["e1"] }), cell({ op: two, resource: null, evidenceIds: ["e2"] }), cell({ idn: "USER B", op: two, resource: null, evidenceIds: ["e3"] })] })
    const group = projectHierarchy(snapshot, filters, groupNav())
    const shape = `${service} GET /api/orders/{id}`
    const folded = group.nodes.find(node => node.id === `operation-group:${shape}`)!
    expect(folded).toMatchObject({ kind: "operation-group", objectGroup: { expanded: false } })
    expect([...folded.objectGroup!.members].sort()).toEqual([one, two].sort())
    expect(graphOpenAction("operation-group", "group")).toBe("toggle")
    // 멤버 노드는 목록·선택 상세를 위해 남지만 그래프에서는 숨는다.
    expect(group.nodes.filter(node => node.kind === "operation" && node.hiddenInGraph).map(node => node.label).sort()).toEqual([one, two].sort())
    expect(group.listItems.map(node => node.label).sort()).toEqual([one, two].sort())
    const toGroup = group.edges.filter(edge => edge.targetId === folded.id)
    expect(toGroup.map(edge => edge.selection.identity).sort()).toEqual(["USER A", "USER B"])
    expect(toGroup.find(edge => edge.selection.identity === "USER A")?.selection.cells).toHaveLength(2)
    expect(group.edges.some(edge => edge.targetId === `operation:${one}` || edge.targetId === `operation:${two}`)).toBe(false)

    const open = projectHierarchy(snapshot, { ...filters, expandedObjectGroups: [folded.id] }, groupNav())
    const order = open.nodes.filter(node => node.kind === "operation" || node.kind === "operation-group").map(node => node.id)
    expect(order[0]).toBe(folded.id)
    expect(open.nodes.some(node => node.hiddenInGraph)).toBe(false)
    expect(open.edges.some(edge => edge.targetId === `operation:${one}`)).toBe(true)
  })
})
