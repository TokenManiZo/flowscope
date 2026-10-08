import { describe, expect, it } from "vitest"

import type { EventRecord, Snapshot } from "@/lib/api/types"
import { graphCellKey, graphCellSelection, graphRouteCandidateId, projectGraph, selectGraphItem, wrapOperationLabel } from "./graphProjection"

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  const value: EventRecord = {
    eventId: "ev-human-1", method: "GET", path: "/orders/101", status: 200, fp: "fp-a", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:101", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run-h", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "cluster-1", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-human-1"], objects: [{ resource: "order:101", evidence: "id" }], verdict: "allow",
    ...overrides,
  }
  return { ...value, clusterEvidenceIds: overrides.clusterEvidenceIds ?? [value.eventId] }
}

function snapshot(events: readonly EventRecord[], routeCandidates: Snapshot["routeCandidates"] = []): Snapshot {
  return { revision: 4, identityRevision: 1, sampleMode: true, events, trafficStats: { captured: events.length, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: ["human", "scanner", "llm"], cells: [
    { idn: "alice", op: "GET /orders/{id}", resource: "order:101", perSource: { human: "allow", scanner: "deny", llm: "suspicious" }, reasons: {}, overall: "allow", conflict: true, missedSources: [], evidenceIds: ["ev-human-1", "ev-scanner-1", "ev-llm-1"] },
  ], verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates }
}

describe("projectGraph", () => {
  it("preserves canonical cell keys and all 요청 기록 when collapsing different resources", () => {
    const first = snapshot([]).cells[0]
    const second = { ...first, resource: null, evidenceIds: ["objectless", "ev-human-1"] }
    expect(graphCellKey(first)).toBe('["alice","GET /orders/{id}","order:101"]')
    expect(graphCellSelection([first, second], "scanner")).toMatchObject({ operation: "GET /orders/{id}", resource: null, identity: "alice", source: "scanner", cellKeys: ['["alice","GET /orders/{id}","order:101"]', '["alice","GET /orders/{id}",null]'], evidenceIds: ["ev-human-1", "ev-llm-1", "ev-scanner-1", "objectless"], cells: [first, second] })
    expect(graphCellSelection([])).toMatchObject({ operation: null, identity: null, resource: null, source: null, evidenceIds: [], cellKeys: [] })
  })

  it("projects server suspicious and undecided event verdicts when no coverage cell matches", () => {
    const serverEvents = [
      event({ eventId: "ev-suspicious", idn: "bob", op: "DELETE /orders/{id}", method: "DELETE", verdict: "suspicious" }),
      event({ eventId: "ev-undecided", idn: "guest", op: "GET /health", path: "/health", resource: null, objects: [], verdict: "undecided" }),
    ]

    const graph = projectGraph(snapshot(serverEvents), { source: ["human"], identity: [], view: "authz", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })

    expect(graph.operations.find((item) => item.label === "DELETE /orders/{id}")).toMatchObject({ verdict: "suspicious", verdictText: "SUSPICIOUS", verdictColor: "#c2410c" })
    expect(graph.operations.find((item) => item.label === "GET /health")).toMatchObject({ verdict: "undecided", verdictText: "확인 필요", verdictColor: "#7c3aed" })
  })

  it("does not assign one event verdict to an aggregate operation node with mixed outcomes", () => {
    const data = snapshot([
      event({ eventId: "ev-allow", idn: "alice", verdict: "allow" }),
      event({ eventId: "ev-deny", idn: "bob", verdict: "deny" }),
    ])

    const graph = projectGraph(data, { source: ["human"], identity: [], view: "authz", includeRouteCandidates: false, includeSupportTraffic: false, expanded: true })

    expect(graph.operations).toEqual([expect.objectContaining({ label: "GET /orders/{id}", verdict: "unknown", verdictText: "UNKNOWN" })])
  })

  it("builds a deterministic collision-safe route-candidate identity from the backend-unique triple", () => {
    const first = { service: "https://api.example.test:GET", method: "POST", pathTemplate: "/orders" }
    const delimiterCollision = { service: "https://api.example.test", method: "GET:POST", pathTemplate: "/orders" }
    expect(graphRouteCandidateId(first)).toBe(graphRouteCandidateId(first))
    expect(graphRouteCandidateId(first)).not.toBe(graphRouteCandidateId(delimiterCollision))
  })

  it("keeps INCLUDE identity-resource-operation paths, preserves source semantics, verdict text, repeat labels, and exact 요청 기록 selection", () => {
    const data = snapshot([
      event({ eventId: "ev-human-1", source: "human", repeatCount: 2, clusterEvidenceIds: ["ev-human-1", "ev-human-2"] }),
      event({ eventId: "ev-scanner-1", source: "scanner", idn: "alice", verdict: "deny", repeatCount: 1 }),
      event({ eventId: "ev-llm-1", source: "llm", idn: "alice", verdict: "suspicious", repeatCount: 1 }),
      event({ eventId: "ev-objectless", source: "unknown", idn: "guest", op: "POST /login", method: "POST", path: "/login", resource: null, objects: [], verdict: "undecided" }),
      event({ eventId: "ev-review", op: "GET /review-only", trafficDisposition: "REVIEW" }),
      event({ eventId: "ev-support", op: "GET /poll", trafficClass: "POLLING", resource: null, objects: [] }),
    ])

    const graph = projectGraph(data, { source: ["human", "scanner", "llm", "unknown"], identity: [], view: "authz", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })

    expect(graph.operations.map((item) => item.label)).toEqual(["GET /orders/{id}", "POST /login"])
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "identity-resource", source: "human", line: "solid", color: "#2563eb", sourceText: "HUMAN", countLabel: "×2" }),
      expect.objectContaining({ relation: "identity-resource", source: "scanner", line: "dashed", color: "#dc2626", sourceText: "SCANNER" }),
      expect.objectContaining({ relation: "identity-resource", source: "llm", line: "dotted", color: "#e4e4e7", sourceText: "LLM" }),
      expect.objectContaining({ relation: "identity-operation", source: "unknown", sourceText: "UNKNOWN" }),
    ]))
    expect(graph.operations.find((item) => item.label === "GET /orders/{id}")).toMatchObject({ verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d" })
    expect(graph.operations.find((item) => item.label === "POST /login")).toMatchObject({ verdict: "undecided", verdictText: "확인 필요" })
    expect(graph.operations.map((item) => item.label)).not.toContain("GET /review-only")
    expect(graph.operations.map((item) => item.label)).not.toContain("GET /poll")
    expect(selectGraphItem(graph, "operation:GET /orders/{id}")).toEqual({ operation: "GET /orders/{id}", resource: null, identity: null, source: null, evidenceIds: ["ev-human-1", "ev-human-2", "ev-llm-1", "ev-scanner-1"] })
  })

  it("filters source, identity, current view, route candidates, and support traffic without changing the mobile dataset", () => {
    const data = snapshot([event(), event({ eventId: "ev-scanner", source: "scanner", idn: "bob", op: "DELETE /orders/{id}", method: "DELETE", verdict: "deny" })], [{ service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "r", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], applicability: "REVIEW", reviewReason: "needs review", priorityReasons: ["input"] }])
    const graph = projectGraph(data, { source: ["scanner"], identity: ["bob"], view: "source", includeRouteCandidates: true, includeSupportTraffic: true, expanded: true })
    expect(graph.operations.map((item) => item.label)).toEqual(["DELETE /orders/{id}"])
    expect(graph.routeCandidates).toEqual([])
    expect(graph.listItems).toEqual(graph.operations)
  })

  it("keeps GET and PATCH edges distinct for the same identity, resource, and source", () => {
    const data = snapshot([
      event({ eventId: "ev-get", op: "GET /orders/{id}", method: "GET" }),
      event({ eventId: "ev-patch", op: "PATCH /orders/{id}", method: "PATCH" }),
    ])

    const graph = projectGraph(data, { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: true })
    const identityEdges = graph.edges.filter((edge) => edge.relation === "identity-resource")

    expect(identityEdges).toHaveLength(2)
    expect(new Set(identityEdges.map((edge) => edge.selection.operation))).toEqual(new Set(["GET /orders/{id}", "PATCH /orders/{id}"]))
    expect(new Set(identityEdges.map((edge) => edge.id)).size).toBe(2)
  })

  it("uses the representative 기록 번호 when the bounded snapshot omits cluster members", () => {
    const withoutClusterMembers = { ...event(), clusterEvidenceIds: undefined }
    const graph = projectGraph(snapshot([withoutClusterMembers]), { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: true })

    expect(graph.identities[0].selection.evidenceIds).toEqual([withoutClusterMembers.eventId])
    expect(graph.edges[0].selection.evidenceIds).toEqual([withoutClusterMembers.eventId])
  })

  it("normalizes uppercase route provenance and applies source and identity filters", () => {
    const candidate: Snapshot["routeCandidates"][number] = { service: "https://api.example.test", method: "GET", pathTemplate: "/declared", observed: false, provenanceTypes: ["JAVASCRIPT"], provenanceEvidenceIds: ["js-1"], provenance: [{ type: "JAVASCRIPT", evidenceId: "js-1", source: "SCANNER", runId: "scan-1", adapter: "fetch", applicability: "REVIEW", reason: "declared" }], applicability: "REVIEW", reviewReason: "not requested", priorityReasons: [] }
    const data = snapshot([], [candidate])

    const scanner = projectGraph(data, { source: ["scanner"], identity: [], view: "source", includeRouteCandidates: true, includeSupportTraffic: false, expanded: true })
    const human = projectGraph(data, { source: ["human"], identity: [], view: "source", includeRouteCandidates: true, includeSupportTraffic: false, expanded: true })
    const identityScoped = projectGraph(data, { source: ["scanner"], identity: ["alice"], view: "source", includeRouteCandidates: true, includeSupportTraffic: false, expanded: true })

    expect(scanner.routeCandidates).toHaveLength(1)
    expect(scanner.routeCandidates[0].selection.source).toBe("scanner")
    expect(human.routeCandidates).toHaveLength(0)
    expect(identityScoped.routeCandidates).toHaveLength(0)
  })

  it("filters the projection by the server-projected review verdict", () => {
    const data = snapshot([
      event(),
      event({ eventId: "ev-review", idn: "bob", op: "DELETE /orders/{id}", method: "DELETE", verdict: "suspicious" }),
    ])

    const graph = projectGraph(data, { source: ["human"], identity: [], view: "authz", reviewStates: ["suspicious"], includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })

    expect(graph.operations.map((item) => item.label)).toEqual(["DELETE /orders/{id}"])
  })

  it("prefers a matching server cell overall verdict over a mismatched event verdict when filtering", () => {
    const data = snapshot([event({ verdict: "suspicious" })])

    const suspicious = projectGraph(data, { source: ["human"], identity: [], view: "authz", reviewStates: ["suspicious"], includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
    const allowed = projectGraph(data, { source: ["human"], identity: [], view: "authz", reviewStates: ["allow"], includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })

    expect(suspicious.operations).toHaveLength(0)
    expect(allowed.operations.map((item) => item.label)).toEqual(["GET /orders/{id}"])
  })

  it("shows exactly the first 18 operation and resource entries until explicit expansion and restores them on collapse", () => {
    const events = Array.from({ length: 19 }, (_, index) => event({ eventId: `ev-${index}`, op: `GET /items/${index}`, path: `/items/${index}`, resource: `item:${index}`, objects: [{ resource: `item:${index}`, evidence: "id" }] }))
    const data = snapshot(events)
    const collapsed = projectGraph(data, { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
    const expanded = projectGraph(data, { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: true })
    expect(collapsed.operations).toHaveLength(18)
    expect(collapsed.resources).toHaveLength(18)
    expect(expanded.operations).toHaveLength(19)
    expect(projectGraph(data, { source: ["human"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }).operations).toHaveLength(18)
  })

  it("wraps full operation labels on path segments without lossy truncation", () => {
    expect(wrapOperationLabel("GET /")).toBe("GET \n/")
    expect(wrapOperationLabel("GET //x/")).toBe("GET \n/\n/x\n/")
    expect(wrapOperationLabel("GET /accounts/very-long-segment/transactions/{id}")).toBe("GET \n/accounts\n/very-long-segment\n/transactions\n/{id}")
    expect(wrapOperationLabel("GET /a-very-long-single-segment-without-a-lossy-ellipsis")).toBe("GET \n/a-very-long-single-segment-without-a-lossy-ellipsis")
    for (const operation of ["GET /", "GET //x/", "GET /accounts/very-long-segment/transactions/{id}", "GET /a-very-long-single-segment-without-a-lossy-ellipsis"]) expect(wrapOperationLabel(operation).replaceAll("\n", "")).toBe(operation)
  })
})
