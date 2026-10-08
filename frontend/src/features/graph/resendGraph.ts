import { graphAccountIdentities, graphAccountLabel } from "./graphAccounts"
import type { Snapshot } from "@/lib/api/types"
import { verdictStyles, wrapOperationLabel, type GraphView } from "./graphProjection"
import type { GraphNavigation, HierarchyEdge, HierarchyNode, HierarchyProjection, HierarchySelection } from "./graphHierarchy"

/** 재전송 그래프에 그릴 도구. Intruder는 대량 전송이라 그리지 않고 관측 기록에만 남긴다. */
export type ResendTool = "lab" | "repeater"
export const resendToolNames: Record<ResendTool, string> = { lab: "Request Lab", repeater: "Repeater" }
export const resendToolColors: Record<ResendTool, string> = { lab: "#7F77DD", repeater: "#D85A30" }

/** Burp Repeater·Intruder로 사람이 고쳐 보낸 요청. 수집 그래프와 판정에는 넣지 않는다. */
export const manualResendDetails = new Set(["BURP_REPEATER", "BURP_INTRUDER"])

export interface ResendSend { tool: ResendTool; eventId: string; identity: string; operation: string; resource: string | null; status: number; originalStatus: number | null; timestamp: number }

const compareText = (left: string, right: string) => left.localeCompare(right, "en")

/**
 * Request Lab 전송은 출발한 원본 기록(originEvidenceId)의 응답 코드와 함께, Repeater 전송은 원본을 알 수 없어 응답 코드만 모은다.
 * 원본을 추정하지 않는다.
 */
export function resendSends(snapshot: Snapshot): ResendSend[] {
  const statusOf = new Map<string, number>()
  for (const event of snapshot.events) for (const id of [event.eventId, ...(event.clusterEvidenceIds ?? [])]) if (!statusOf.has(id)) statusOf.set(id, event.status)
  const lab = (snapshot.manualVerifications ?? []).map((item): ResendSend => ({
    tool: "lab", eventId: item.eventId, identity: item.identityId, operation: item.operation, resource: item.resource,
    status: item.status, originalStatus: statusOf.get(item.originEvidenceId) ?? null, timestamp: item.timestamp,
  }))
  const repeater = snapshot.events.filter(event => event.sourceDetail === "BURP_REPEATER" && event.status >= 100 && event.status <= 599)
    .map((event): ResendSend => ({ tool: "repeater", eventId: event.eventId, identity: event.idn, operation: event.op, resource: event.resource, status: event.status, originalStatus: null, timestamp: event.timestamp }))
  return [...lab, ...repeater].sort((left, right) => left.timestamp - right.timestamp || compareText(left.eventId, right.eventId))
}

const selection = (sends: readonly ResendSend[], extra: Partial<HierarchySelection> = {}): HierarchySelection => ({
  operation: null, resource: null, identity: null, source: null, cellKeys: [], cells: [], gapIds: [],
  evidenceIds: [...new Set(sends.map(send => send.eventId))].sort(compareText), ...extra,
})

/**
 * 재전송만 따로 그린 그래프. 보낸 신원 → 재전송한 API(도구별) → 객체. 판정 셀을 만들거나 바꾸지 않는다.
 * 수집 그래프의 계층 이동(사이트·묶음)과 섞이지 않도록 한 화면에 모두 그린다.
 */
export function projectResendGraph(snapshot: Snapshot, navigation: GraphNavigation, view: GraphView, tools: readonly ResendTool[]): HierarchyProjection {
  const sends = resendSends(snapshot).filter(send => tools.includes(send.tool))
  const nodes: HierarchyNode[] = []
  const edges: HierarchyEdge[] = []
  const unknown = verdictStyles.unknown
  const addNode = (id: string, kind: HierarchyNode["kind"], label: string, related: readonly ResendSend[], picked: Partial<HierarchySelection>, extra: Partial<HierarchyNode> = {}) => {
    if (nodes.some(node => node.id === id)) return
    nodes.push({ id, kind, label, wrappedLabel: kind === "resend-operation" ? wrapOperationLabel(label) : label, verdict: "unknown", verdictText: unknown.text, verdictColor: unknown.color, ...extra, selection: selection(related, picked) })
  }
  const byOperation = new Map<string, ResendSend[]>()
  for (const send of sends) {
    const key = JSON.stringify([send.tool, send.operation])
    byOperation.set(key, [...(byOperation.get(key) ?? []), send])
  }
  for (const [key, group] of byOperation) {
    const [tool, operation] = JSON.parse(key) as [ResendTool, string]
    const latest = group[group.length - 1]
    const operationId = `resend-operation:${tool}:${operation}`
    addNode(operationId, "resend-operation", operation, group, { operation }, {
      resend: { tool, count: group.length, status: latest.status, originalStatus: latest.originalStatus },
    })
    const byIdentity = new Map<string, ResendSend[]>()
    for (const send of group) byIdentity.set(send.identity, [...(byIdentity.get(send.identity) ?? []), send])
    for (const [identity, identitySends] of byIdentity) {
      addNode(`identity:${identity}`, "identity", graphAccountLabel(snapshot, identity), sends.filter(send => send.identity === identity), { identity })
      edges.push(resendEdge(tool, `identity:${identity}`, operationId, identitySends, { identity, operation }))
    }
    const byResource = new Map<string, ResendSend[]>()
    for (const send of group) if (send.resource) byResource.set(send.resource, [...(byResource.get(send.resource) ?? []), send])
    for (const [resource, resourceSends] of byResource) {
      addNode(`resource:${resource}`, "resource", resource, sends.filter(send => send.resource === resource), { resource }, { owner: snapshot.owners[resource] ?? null })
      edges.push(resendEdge(tool, operationId, `resource:${resource}`, resourceSends, { operation, resource }))
    }
  }
  for (const identity of graphAccountIdentities(snapshot)) {
    addNode(`identity:${identity}`, "identity", graphAccountLabel(snapshot, identity), [], { identity })
  }
  const operations = nodes.filter(node => node.kind === "resend-operation")
  return {
    kind: "group", view, navigation, groups: [], nodes, edges,
    identities: nodes.filter(node => node.kind === "identity"), operations, resources: nodes.filter(node => node.kind === "resource"),
    routeCandidates: [], listItems: operations, hiddenOperationCount: 0, hiddenObjectCount: 0, revealedNodeCount: 0,
  }
}

function resendEdge(tool: ResendTool, sourceId: string, targetId: string, sends: readonly ResendSend[], extra: Partial<HierarchySelection>): HierarchyEdge {
  return {
    id: JSON.stringify(["resend", tool, sourceId, targetId]), relation: "resend", sourceId, targetId, source: null, structural: false,
    sourceText: resendToolNames[tool], line: "dashed", color: resendToolColors[tool], count: sends.length, countLabel: sends.length > 1 ? `×${sends.length}` : "",
    selection: selection(sends, extra),
  }
}
