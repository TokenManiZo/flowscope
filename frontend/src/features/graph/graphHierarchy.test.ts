import { describe, expect, it } from "vitest"

import type { Cell, EventRecord, RouteCandidate, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { apiGroupDescriptor, GRAPH_PAGE_SIZE, graphOpenAction, isObservedTraffic, objectGroupKey, navigateHierarchy, projectHierarchy, stepBack, type GraphNavigation } from "./graphHierarchy"
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
    expect(graphOpenAction("resource", "operation")).toBe("lab")
    expect(graphOpenAction("operation", "operation")).toBeNull()
  })

  it("renders Identity→API→Object with separate source buckets in group view", () => {
    const group = projectHierarchy(data(), { ...filters, expandedObjectGroups: ["object-group:|orders"] }, groupNav())
    expect(group.kind).toBe("group")
    expect(group.nodes.some(node => node.kind === "resource")).toBe(true)
    expect(group.edges.every(edge => edge.relation === "identity-operation" || edge.relation === "operation-resource")).toBe(true)
    expect(group.edges.filter(edge => edge.relation === "identity-operation" && edge.selection.identity === "USER A").map(edge => [edge.source, edge.line, edge.sourceText]).sort()).toEqual([["human", "solid", "HUMAN"], ["llm", "dotted", "LLM"], ["scanner", "dashed", "SCANNER"]])
    expect(group.operations.find(node => node.selection.operation === get)!.selection.cells[0].overall).toBe("undecided")
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

  it("pages 18 APIs/Objects and keeps all access 요청 기록 when Object nodes are hidden", () => {
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

  it("prioritizes suspicious, conflict, partial, then 요청 기록 count without changing verdicts", () => {
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
    // /api/declared는 그 서비스에서 혼자뿐인 한 칸짜리 주소라 ROOT 묶음에 들어간다.
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, source: ["scanner"] }, initial).groups.map(group => group.id)).toContain('["https://other.test:443","root"]')
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, source: ["human"] }, initial).groups.map(group => group.id)).not.toContain('["https://other.test:443","root"]')
    expect(projectHierarchy(snapshot, { ...filters, includeRouteCandidates: true, identity: ["USER A"] }, initial).groups.map(group => group.id)).not.toContain('["https://other.test:443","root"]')
  })

  it("uses server UNCROSSED gaps for focused unobserved paths without inventing 요청 기록 or verdicts", () => {
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

  it("counts 요청 기록 by server event source without merging H/S/L or inflating by repeat metadata", () => {
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

  it("shows observed non-static traffic without a judgment cell only in the broad view, never as coverage", () => {
    const snapshot = { ...data(), events: [
      event(), event({ eventId: "review-api", clusterEvidenceIds: ["review-api"], trafficClass: "API", trafficDisposition: "REVIEW" }),
      event({ eventId: "elsewhere", clusterEvidenceIds: ["elsewhere"], op: `${service} GET /api/users/poll` }),
      event({ eventId: "unverified", clusterEvidenceIds: ["unverified"], op: `${service} GET /api/orders/include`, trafficDisposition: "INCLUDE", source: "llm" }),
      event({ eventId: "h-101", clusterEvidenceIds: ["h-101"], op: get, trafficClass: "NAVIGATION" }),
      event({ eventId: "style", clusterEvidenceIds: ["style"], op: `${service} GET /api/orders/app.css`, path: "/api/orders/app.css?v=2", trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE" }),
      event({ eventId: "preflight", clusterEvidenceIds: ["preflight"], op: `${service} OPTIONS /api/orders/preflight`, trafficClass: "PREFLIGHT" }),
    ] }
    expect(projectHierarchy(snapshot, filters, groupNav()).nodes.some(node => node.kind === "observed-operation")).toBe(false)
    const group = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, groupNav())
    expect(group.nodes.filter(node => node.kind === "observed-operation").map(node => node.selection.operation).sort()).toEqual([`${service} GET /api/orders/include`, `${service} GET /api/orders/poll`])
    expect(group.edges.filter(edge => edge.relation === "support").map(edge => [edge.source, edge.selection.evidenceIds, edge.selection.cellKeys])).toEqual([["human", ["review-api", "support-1"], []], ["llm", ["unverified"], []]])
    // 판정 셀·출처 집계는 그대로다. 관측 전체는 표시만 더한다.
    expect(group.groups[0]).toMatchObject({ endpointCount: 2, sourceCounts: { human: 2, scanner: 1, llm: 1 }, observedCount: 3 })
    expect(group.nodes.filter(node => node.staticResource && node.kind === "operation-group")).toHaveLength(1)
    expect(projectHierarchy(snapshot, { ...filters, source: ["scanner"], includeSupportTraffic: true }, groupNav()).nodes.some(node => node.kind === "observed-operation")).toBe(false)
  })

  it("lists groups that only have observed server-rendered pages at site level in the broad view", () => {
    const php = (eventId: string, path: string, source: EventRecord["source"] = "human") => event({ eventId, path, source, op: `${service} GET ${path.split("?")[0]}`, trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE", clusterEvidenceIds: [eventId] })
    const snapshot = { ...data(), events: [php("p1", "/board/list.php"), php("p2", "/board/view.php?no=3"), php("p3", "/board/list.php", "scanner"), php("p4", "/board/list.php")] }
    expect(projectHierarchy(snapshot, filters, initial).groups.map(group => group.key)).toEqual(["orders"])
    const site = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, initial)
    expect(site.groups.find(group => group.key === "board")).toMatchObject({ endpointCount: 0, observedCount: 2, gapCount: 0 })
    const board = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, navigateHierarchy(initial, "group", JSON.stringify([service, "board"])))
    expect(board.kind).toBe("group")
    // 같은 신원·기능·출처의 반복 관측은 엣지 하나로 합치고 관측 기록은 모두 남긴다.
    expect(board.edges.filter(edge => edge.relation === "support").map(edge => [edge.selection.identity, edge.selection.operation, edge.source, edge.count, edge.selection.evidenceIds])).toEqual([
      ["USER A", `${service} GET /board/list.php`, "human", 2, ["p1", "p4"]],
      ["USER A", `${service} GET /board/view.php`, "human", 1, ["p2"]],
      ["USER A", `${service} GET /board/list.php`, "scanner", 1, ["p3"]],
    ])
  })

  it("draws only normally collected traffic in the broad view, never replays, request-only attempts or explicit exclusions", () => {
    // Request Lab처럼 값을 바꿔 다시 보낸 요청과 FlowScope가 재전송한 요청은 그래프를 어지럽히고 출처를 흐린다(D-008).
    const page = (eventId: string, path: string, extra: Partial<EventRecord> = {}) => event({ eventId, clusterEvidenceIds: [eventId], path, op: `${service} GET ${path}`, trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE", ...extra })
    const snapshot = { ...data(), events: [
      page("normal", "/board/list.php"),
      page("lab", "/board/lab.php", { phase: "VALIDATION", executionTrust: "CONTROLLED" }),
      page("replay", "/board/replay.php", { source: "scanner", phase: "AUTHORIZATION_REPLAY", executionTrust: "CONTROLLED" }),
      page("probe", "/board/probe.php", { source: "llm", phase: "COACH_PROBE" }),
      page("login-check", "/board/login.php", { source: "scanner", phase: "SESSION_SETUP" }),
      page("no-response", "/board/timeout.php", { status: 0, classificationReasons: ["NO_RESPONSE"] }),
      page("excluded", "/board/hidden.php", { classificationOverride: true }),
      page("unverified", "/board/runtime.php", { source: "scanner", executionTrust: "UNVERIFIED_RUNTIME" }),
    ] }
    expect(snapshot.events.filter(isObservedTraffic).map(item => item.eventId)).toEqual(["normal"])
    const boardId = JSON.stringify([service, "board"])
    const board = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, navigateHierarchy(initial, "group", boardId))
    expect(board.nodes.filter(node => node.kind === "observed-operation").map(node => node.selection.operation)).toEqual([`${service} GET /board/list.php`])
    expect(board.groups.find(group => group.id === boardId)).toMatchObject({ observedCount: 1 })
  })

  it("gathers lone single-segment pages into each service's ROOT group and keeps shared or deeper paths in place", () => {
    const php = "http://php.test:80", flask = "http://flask.test:5000"
    const page = (eventId: string, op: string) => event({ eventId, clusterEvidenceIds: [eventId], op, path: op.split(" ").pop()!, trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE" })
    const snapshot = { ...data(), events: [
      page("p1", `${php} GET /board_list.php`), page("p2", `${php} GET /login.php`), page("p3", `${php} POST /login.php`), page("p4", `${php} GET /admin/user_list.php`),
      page("f1", `${flask} GET /dashboard`), page("f2", `${flask} GET /orders`), page("f3", `${flask} GET /orders/{id}`), { ...page("f4", `${flask} GET /theme.css`), trafficClass: "STATIC_ASSET" as const },
    ] }
    const observed = Object.fromEntries(projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, initial).groups.map(group => [group.id, group.observedCount]))
    // 서버마다 ROOT가 따로 생기고, 같은 파일의 GET·POST는 함께 ROOT에 들어간다. 정적 파일은 묶음 판단에도 쓰지 않는다.
    expect(observed).toEqual({
      [groupId]: 0,
      [JSON.stringify([php, "root"])]: 3, [JSON.stringify([php, "admin"])]: 1,
      [JSON.stringify([flask, "root"])]: 2, [JSON.stringify([flask, "orders"])]: 2,
    })
  })

  it("decides ROOT membership from all observed paths so groups do not move when the view scope changes", () => {
    const flask = "http://flask.test:5000"
    const snapshot = targetSnapshot({ activeSources: ["human"], cells: [cell({ op: `${flask} GET /orders`, resource: null, evidenceIds: ["c1"] })],
      events: [event({ eventId: "deep", clusterEvidenceIds: ["deep"], op: `${flask} GET /orders/{id}`, path: "/orders/7", trafficClass: "NAVIGATION", trafficDisposition: "EXCLUDE" })] })
    const orders = JSON.stringify([flask, "orders"])
    expect(projectHierarchy(snapshot, filters, initial).groups.map(group => group.id)).toEqual([orders])
    expect(projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, initial).groups.map(group => group.id)).toEqual([orders])
  })

  it("draws every judged function without folding, putting functions worth checking first", () => {
    const op = (method: string, path: string) => `${service} ${method} ${path}`
    const snapshot = targetSnapshot({ activeSources: ["human"], cells: [
      cell({ op: op("GET", "/api/orders/allowed"), resource: null, evidenceIds: ["q"] }),
      cell({ op: op("GET", "/api/orders/suspicious"), resource: null, overall: "suspicious", evidenceIds: ["s"] }),
      cell({ op: op("GET", "/api/orders/undecided"), resource: null, overall: "undecided", evidenceIds: ["u"] }),
      cell({ op: op("GET", "/api/orders/conflict"), resource: null, conflict: true, evidenceIds: ["c"] }),
      cell({ op: op("POST", "/api/orders/write"), resource: null, evidenceIds: ["w"] }),
    ] })
    const graph = projectHierarchy(snapshot, filters, groupNav())
    const drawn = graph.nodes.filter(node => node.kind === "operation" && !node.hiddenInGraph).map(node => node.label)
    expect(drawn).toHaveLength(5)
    // 허용만 있는 기능도 숨기지 않고, 점검할 기능 뒤에 둔다.
    expect(drawn.at(-1)).toBe(op("GET", "/api/orders/allowed"))
    expect(graph.nodes.some(node => node.objectGroup?.key === "신호 없는 기능")).toBe(false)
    expect(graph.edges.some(edge => edge.targetId === `operation:${op("GET", "/api/orders/allowed")}`)).toBe(true)
  })

  it("keeps functions worth checking on the first page when many quiet functions exist", () => {
    const op = (method: string, path: string) => `${service} ${method} ${path}`
    // 허용만 있는 기능은 기록이 많아 점수가 더 높다. 그래도 쓰기 기능이 18개 밖으로 밀려나면 안 된다.
    const quiet = Array.from({ length: GRAPH_PAGE_SIZE }, (_, index) => cell({ op: op("GET", `/api/orders/quiet-${String.fromCharCode(97 + index)}`), resource: null, evidenceIds: [`q${index}-1`, `q${index}-2`, `q${index}-3`] }))
    const write = op("POST", "/api/orders/write")
    const snapshot = targetSnapshot({ activeSources: ["human"], cells: [...quiet, cell({ op: write, resource: null, evidenceIds: ["w"] })] })
    const graph = projectHierarchy(snapshot, filters, groupNav())
    const drawn = graph.nodes.filter(node => node.kind === "operation" && !node.hiddenInGraph).map(node => node.label)
    expect(drawn).toHaveLength(GRAPH_PAGE_SIZE)
    expect(drawn[0]).toBe(write)
    expect(graph.hiddenOperationCount).toBe(1)
  })

  it("adds APIs found in JavaScript but never requested to the broad view, skipping asset-shaped and non-JS routes", () => {
    const route = (pathTemplate: string, extra: Partial<RouteCandidate> = {}): RouteCandidate => ({ service, method: "POST", pathTemplate, observed: false, applicability: "REVIEW", provenanceTypes: ["JAVASCRIPT_LITERAL"], provenanceEvidenceIds: ["js-1"], provenance: [{ type: "JAVASCRIPT_LITERAL", evidenceId: "js-1", source: "human", runId: "run-1", adapter: "js", applicability: "REVIEW", reason: "literal" }], reviewReason: "", priorityReasons: [], ...extra })
    const snapshot = { ...data(), routeCandidates: [
      route("/api/orders/secret"), route("/{id}/{id}/styles.json", { method: "GET" }), route("/api/orders/app.css", { method: "GET" }),
      route("/api/orders/seen", { observed: true }), route("/api/orders/form", { provenanceTypes: ["HTML_FORM"] }), route("/manifest.json", { method: "UNKNOWN" }),
    ] }
    expect(projectHierarchy(snapshot, filters, groupNav()).routeCandidates).toEqual([])
    const broad = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, groupNav())
    expect(broad.routeCandidates.map(candidate => candidate.pathTemplate)).toEqual(["/api/orders/secret"])
    expect(projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, initial).groups.find(group => group.id === groupId)?.routeCandidateCount).toBe(1)
  })

  it("never mutates the input snapshot, filters, or navigation", () => {
    const snapshot = data()
    const before = JSON.stringify({ snapshot, filters, initial })
    projectHierarchy(snapshot, filters, operationNav())
    expect(JSON.stringify({ snapshot, filters, initial })).toBe(before)
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


it.each(["UNKNOWN", "POLLING"])("keeps B evidence neutral on A's existing API in group and API detail (%s)", trafficClass => {
  const bob = event({ eventId: "bob-1", clusterEvidenceIds: ["bob-1", "bob-2"], idn: "USER B", op: get, trafficClass, trafficDisposition: "REVIEW" })
  const snapshot = targetSnapshot({ cells: [cell()], events: [bob,
    event({ eventId: "h-101", clusterEvidenceIds: ["h-101"], op: get, trafficClass: "UNKNOWN" }),
    ...["USER_EXCLUDE", "NO_RESPONSE"].map(reason => event({ eventId: reason, clusterEvidenceIds: [reason], idn: "USER B", op: get, classificationReasons: [reason] })),
  ] })
  const before = JSON.stringify(snapshot)
  const enabled = { ...filters, includeSupportTraffic: true }
  for (const navigation of [groupNav(), operationNav()]) {
    const graph = projectHierarchy(snapshot, enabled, navigation)
    const api = graph.nodes.find(node => node.id === `operation:${get}`)!
    expect(api.selection.evidenceIds).toEqual(["bob-1", "bob-2", "h-101"])
    expect(api.selection.cells).toEqual(snapshot.cells)
    expect(api.verdict).toBe("allow")
    expect(graph.nodes.some(node => node.kind === "observed-operation")).toBe(false)
    expect(graph.identities.find(node => node.selection.identity === "USER B")?.verdict).toBe("unknown")
    expect(graph.edges.filter(edge => edge.relation === "support")).toEqual([expect.objectContaining({ targetId: api.id, selection: expect.objectContaining({ identity: "USER B", evidenceIds: ["bob-1", "bob-2"], cells: [], cellKeys: [], gapIds: [] }) })])
    expect(graph.groups[0]).toMatchObject({ endpointCount: 1, observedCount: 0, sourceCounts: { human: 1, scanner: 0, llm: 0 } })
  }
  expect(JSON.stringify(snapshot)).toBe(before)
})

it("retains neutral evidence and identity when API shape cards are folded", () => {
  const first = `${service} POST /api/orders/101`, second = `${service} POST /api/orders/102`
  const snapshot = targetSnapshot({ cells: [cell({ op: first }), cell({ op: second })], events: [
    event({ eventId: "bob-101", clusterEvidenceIds: ["bob-101"], idn: "USER B", op: first }),
    event({ eventId: "bob-102", clusterEvidenceIds: ["bob-102"], idn: "USER B", op: second }),
  ] })
  const graph = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, groupNav())
  const shape = graph.nodes.find(node => node.kind === "operation-group")!
  expect(shape.selection.evidenceIds).toEqual(["bob-101", "bob-102", "h-101"])
  expect(graph.edges.find(edge => edge.relation === "support")).toMatchObject({ targetId: shape.id, count: 2, selection: { identity: "USER B", evidenceIds: ["bob-101", "bob-102"], cells: [], cellKeys: [] } })
})


it("draws observed-only functions in the broad view, keeping only evidence that passes source/identity filters", () => {
  const snapshot = targetSnapshot({ events: [
    event({ eventId: "b-poll", clusterEvidenceIds: ["b-poll"], idn: "USER B" }),
    event({ eventId: "scanner-poll", clusterEvidenceIds: ["scanner-poll"], idn: "USER B", source: "scanner" }),
    event({ eventId: "a-poll", clusterEvidenceIds: ["a-poll"], idn: "USER A" }),
  ] })
  const graph = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true, source: ["human"], identity: ["USER B"] }, groupNav())
  const observed = graph.nodes.find(node => node.kind === "observed-operation")!
  expect(observed.selection.evidenceIds).toEqual(["b-poll"])
  expect(observed.selection.cells).toEqual([])
  expect(graph.nodes.some(node => node.objectGroup?.key === "신호 없는 기능")).toBe(false)
})
