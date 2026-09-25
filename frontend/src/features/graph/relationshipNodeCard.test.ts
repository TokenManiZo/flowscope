import { describe, expect, it } from "vitest"

import type { GraphRouteCandidate } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { relationshipNodeCard, relationshipRouteCandidateCard } from "./relationshipNodeCard"

const service = "https://demo.flowscope.test:443"
const operation = `${service} PATCH /api/orders/{id}`
const selection = (evidenceIds: readonly string[] = ["ev-1", "ev-2"]) => ({
  operation, resource: "orders:101", identity: "USER A", source: null,
  evidenceIds, cellKeys: ['["USER A","PATCH /api/orders/{id}","orders:101"]'], cells: [], gapIds: [],
})
const node = (kind: HierarchyNode["kind"], label: string, extra: Partial<HierarchyNode> = {}): HierarchyNode => ({
  id: `${kind}:${label}`, kind, label, wrappedLabel: label, verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection: selection(), ...extra,
})
const projection = (nodes: readonly HierarchyNode[]): HierarchyProjection => ({
  kind: "operation", view: "source",
  navigation: { level: "operation", groupId: "orders", operation, operationLimit: 18, objectLimit: 18, focusCandidateKey: "" },
  groups: [{ id: "orders", service, key: "orders", label: "ORDERS APIs", cells: [], operations: [operation], routeCandidates: [], endpointCount: 4, sourceCounts: { human: 7, scanner: 3, llm: 2 }, gapCount: 2, routeCandidateCount: 1 }],
  nodes, edges: [], identities: nodes.filter(item => item.kind === "identity"), operations: nodes.filter(item => item.kind === "operation"), resources: nodes.filter(item => item.kind === "resource"), routeCandidates: [], listItems: nodes, hiddenOperationCount: 0, hiddenObjectCount: 0,
})

describe("relationship graph node cards", () => {
  it("maps the hierarchy node kinds without changing server-backed selection facts", () => {
    const target = node("target", service, { service, selection: selection([]) })
    const group = node("api-group", "ORDERS APIs", { groupId: "orders", service, selection: selection([]) })
    const identity = node("identity", "USER A")
    const api = node("operation", operation)
    const resource = node("resource", "orders:101", { owner: "USER B" })
    const support = node("support-operation", `${service} GET /api/session/poll`, { selection: { ...selection(["support-1"]), operation: `${service} GET /api/session/poll`, resource: null } })
    const graph = projection([target, group, identity, api, resource, support])

    expect(relationshipNodeCard(target, graph)).toMatchObject({ badge: "TARGET", title: service, detail: "Exact-scope target", footer: "1 API group", icon: "globe" })
    expect(relationshipNodeCard(group, graph)).toMatchObject({ badge: "API GROUP", title: "ORDERS APIs", detail: "4 APIs · H 7 / S 3 / L 2", footer: "Gap 2 · 경로 후보 1", icon: "network" })
    expect(relationshipNodeCard(identity, graph)).toMatchObject({ badge: "IDENTITY", title: "USER A", detail: "", footer: "", icon: "user" })
    expect(relationshipNodeCard(api, graph)).toMatchObject({ badge: "PATCH", title: "/api/orders/{id}", detail: "", footer: "", icon: "none" })
    expect(relationshipNodeCard(resource, graph)).toMatchObject({ badge: "RESOURCE", title: "orders:101", detail: "", footer: "owner: USER B", icon: "box" })
    expect(relationshipNodeCard(support, graph)).toMatchObject({ badge: "SUPPORT", title: "GET /api/session/poll", detail: "보조 흐름", footer: "", icon: "none" })
  })

  it("parses a service-prefixed canonical operation and retains its complete coordinate for accessibility", () => {
    const api = node("operation", `${service} DELETE /api/${"long/".repeat(60)}orders/{id}`)
    const card = relationshipNodeCard(api, projection([api]))

    expect(card.badge).toBe("DELETE")
    // 그룹(long) 구간까지 생략한다. 전체 좌표는 접근 이름에 남는다.
    expect(card.title).toBe(`/${"long/".repeat(59)}orders/{id}`)
    expect(card.accessibleLabel).toContain(`${service} DELETE /api/`)
    expect(card.accessibleLabel).toContain("orders/{id}")
  })

  it("never infers a resource owner from the requesting identity", () => {
    const resource = node("resource", "orders:404", { owner: null, selection: { ...selection(["ev-owner-unknown"]), identity: "USER A", resource: "orders:404" } })
    const card = relationshipNodeCard(resource, projection([resource]))

    expect(card.footer).toBe("owner: UNKNOWN")
    expect(card.accessibleLabel).not.toContain("owner: USER A")
  })

  it("keeps route candidates neutral and uses only their existing provenance", () => {
    const candidate: GraphRouteCandidate = {
      id: "route-candidate:orders-search", service, method: "POST", pathTemplate: "/api/orders/search", observed: false,
      applicability: "REVIEW", provenance: [], provenanceTypes: ["STATIC_JS"], provenanceEvidenceIds: ["basis-1"], priorityReasons: ["STATIC_REFERENCE"], reviewReason: "정적 참조",
      label: `${service} POST /api/orders/search`, observedText: "미관측 후보",
      selection: { operation: null, resource: null, identity: null, source: null, evidenceIds: [], routeCandidate: { id: "route-candidate:orders-search", service, method: "POST", pathTemplate: "/api/orders/search", observed: false, applicability: "REVIEW", provenanceTypes: ["STATIC_JS"], provenanceEvidenceIds: ["basis-1"], provenance: [], reviewReason: "정적 참조", priorityReasons: ["STATIC_REFERENCE"] } },
    }

    expect(relationshipRouteCandidateCard(candidate)).toEqual({
      kind: "operation", badge: "CANDIDATE", title: "POST /api/orders/search", detail: "미관측 후보 · REVIEW", footer: "정적 참조",
      icon: "none", accessibleLabel: `Route candidate ${service} POST /api/orders/search; 미관측 후보; applicability REVIEW; 정적 참조`,
    })
  })
})
