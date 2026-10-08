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
  groups: [{ id: "orders", service, key: "orders", label: "ORDERS APIs", cells: [], operations: [operation], routeCandidates: [], endpointCount: 4, sourceCounts: { human: 7, scanner: 3, llm: 2 }, gapCount: 2, routeCandidateCount: 1, observedCount: 0 }],
  nodes, edges: [], identities: nodes.filter(item => item.kind === "identity"), operations: nodes.filter(item => item.kind === "operation"), resources: nodes.filter(item => item.kind === "resource"), routeCandidates: [], listItems: nodes, hiddenOperationCount: 0, revealedNodeCount: 0, hiddenObjectCount: 0,
})

describe("relationship graph node cards", () => {
  it("labels an observed host independently of API counts and authorization verdicts", () => {
    const host = node("target", service, { service, discovery: "unregistered", selection: selection([]) })
    expect(relationshipNodeCard(host, projection([host]))).toMatchObject({ badge: "HOST", title: service, detail: "브라우저에서 발견됨", footer: "범위 미등록" })
    expect(relationshipNodeCard({ ...host, discovery: "registered" }, projection([host])).footer).toBe("범위 등록됨 · 표시할 API 없음")
  })
  it("maps the hierarchy node kinds without changing server-backed selection facts", () => {
    const target = node("target", service, { service, selection: selection([]) })
    const group = node("api-group", "ORDERS APIs", { groupId: "orders", service, selection: selection([]) })
    const identity = node("identity", "USER A")
    const api = node("operation", operation)
    const resource = node("resource", "orders:101", { owner: "USER B" })
    const support = node("observed-operation", `${service} GET /api/session/poll`, { selection: { ...selection(["support-1"]), operation: `${service} GET /api/session/poll`, resource: null } })
    const graph = projection([target, group, identity, api, resource, support])

    expect(relationshipNodeCard(target, graph)).toMatchObject({ badge: "TARGET", title: service, detail: "", footer: "1 API group", icon: "globe" })
    // 그룹에 미요청 경로 후보(routeCandidateCount 1)가 있으면 API 수 옆에 함께 표시한다.
    expect(relationshipNodeCard(group, graph)).toMatchObject({ badge: "API GROUP", title: "ORDERS APIs", detail: "4 APIs · 미요청 1", footer: "", icon: "network" })
    expect(relationshipNodeCard(identity, graph)).toMatchObject({ badge: "IDENTITY", title: "USER A", detail: "", footer: "", icon: "user" })
    expect(relationshipNodeCard(api, graph)).toMatchObject({ badge: "PATCH", title: "/api/orders/{id}", detail: "", footer: "", icon: "none" })
    expect(relationshipNodeCard(resource, graph)).toMatchObject({ badge: "RESOURCE", title: "orders:101", detail: "", footer: "owner: USER B", icon: "box" })
    expect(relationshipNodeCard(support, graph)).toMatchObject({ badge: "OBSERVED", title: "GET /api/session/poll", detail: "관측만 · 판정 제외", footer: "", icon: "none" })
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

  it("shows a publicly readable object as Public instead of its stored owner", () => {
    const resource = node("resource", "orders:101", { owner: "USER A", publicRead: true })
    expect(relationshipNodeCard(resource, projection([resource])).footer).toBe("owner: Public")
  })

  it("drops the service origin from a resource card title but keeps it in the accessible label", () => {
    const resource = node("resource", "http://127.0.0.1:9000 orders:6", { owner: "user-a" })
    const card = relationshipNodeCard(resource, projection([resource]))
    expect(card.title).toBe("orders:6")
    expect(card.accessibleLabel).toContain("http://127.0.0.1:9000 orders:6")
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

  it("labels APIs found in JavaScript code but never requested", () => {
    const base = { id: "route-candidate:otp", service, method: "POST", pathTemplate: "/identity/api/auth/v3/check-otp", observed: false, applicability: "REVIEW", provenance: [], provenanceTypes: ["JAVASCRIPT_LITERAL"], provenanceEvidenceIds: ["js-1"], priorityReasons: [], reviewReason: "", label: `${service} POST /identity/api/auth/v3/check-otp`, observedText: "미관측 후보" as const, selection: { operation: null, resource: null, identity: null, source: null, evidenceIds: [] } }
    expect(relationshipRouteCandidateCard(base)).toMatchObject({ badge: "CANDIDATE", detail: "미요청 · JS에서 발견" })
    expect(relationshipRouteCandidateCard({ ...base, observed: true, observedText: "관측됨" })).toMatchObject({ detail: "관측됨 · REVIEW" })
  })
})
