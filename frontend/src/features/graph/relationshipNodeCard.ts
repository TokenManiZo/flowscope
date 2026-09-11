import type { ParameterNodeCardView } from "@/features/parameter-map/parameterNodeCard"
import type { GraphNode, GraphProjection, GraphRouteCandidate } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"

type RelationshipNode = GraphNode | HierarchyNode
type RelationshipProjection = GraphProjection | HierarchyProjection

const methodPattern = /^(?:(https?:\/\/\S+)\s+)?(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE|CONNECT|UNKNOWN)\s+(.+)$/i

function operationParts(value: string): { method: string; path: string } {
  const match = value.match(methodPattern)
  return match ? { method: match[2].toUpperCase(), path: match[3] } : { method: "UNKNOWN", path: value }
}

function evidenceFooter(node: RelationshipNode) {
  return `${node.selection.evidenceIds.length} Evidence`
}

export function relationshipNodeCard(node: RelationshipNode, projection: RelationshipProjection): ParameterNodeCardView {
  if (node.kind === "target") {
    const service = node.service ?? node.label
    const groupCount = "kind" in projection ? projection.groups.filter(group => group.service === service).length : 0
    return {
      kind: "target", badge: "TARGET", title: service, detail: "Exact-scope target", footer: `${groupCount} API group${groupCount === 1 ? "" : "s"}`, icon: "globe",
      accessibleLabel: `Target ${service}; exact-scope target; ${groupCount} API group${groupCount === 1 ? "" : "s"}`,
    }
  }

  if (node.kind === "api-group") {
    const group = "kind" in projection ? projection.groups.find(item => item.id === node.groupId) : undefined
    const endpointCount = group?.endpointCount ?? 0
    const counts = group?.sourceCounts ?? { human: 0, scanner: 0, llm: 0 }
    const gapCount = group?.gapCount ?? 0
    const routeCandidateCount = group?.routeCandidateCount ?? 0
    const detail = `${endpointCount} APIs · H ${counts.human} / S ${counts.scanner} / L ${counts.llm}`
    const footer = `Gap ${gapCount} · 경로 후보 ${routeCandidateCount}`
    return {
      kind: "target", badge: "API GROUP", title: node.label, detail, footer, icon: "network",
      accessibleLabel: `${node.label}; ${node.service ?? "Target"}; API group; ${detail}; ${footer}`,
    }
  }

  if (node.kind === "identity") return {
    kind: "condition", badge: "IDENTITY", title: node.label, detail: node.verdictText, footer: evidenceFooter(node), icon: "user",
    accessibleLabel: `Identity ${node.label}; verdict ${node.verdictText}; ${evidenceFooter(node)}`,
  }

  if (node.kind === "resource") {
    const owner = "owner" in node ? node.owner ?? "UNKNOWN" : "UNKNOWN"
    return {
      kind: "target", badge: "RESOURCE", title: node.label, detail: node.verdictText, footer: `owner: ${owner}`, icon: "box",
      accessibleLabel: `${node.label}; Resource; verdict ${node.verdictText}; owner: ${owner}; ${evidenceFooter(node)}`,
    }
  }

  const operation = operationParts(node.label)
  if (node.kind === "support-operation") return {
    kind: "operation", badge: "SUPPORT", title: `${operation.method} ${operation.path}`, detail: "보조 흐름", footer: evidenceFooter(node), icon: "none",
    accessibleLabel: `Support operation ${node.label}; ${evidenceFooter(node)}`,
  }

  return {
    kind: "operation", badge: operation.method, title: operation.path, detail: node.verdictText, footer: evidenceFooter(node), icon: "none",
    accessibleLabel: `${node.label}; Operation; verdict ${node.verdictText}; ${evidenceFooter(node)}`,
  }
}

export function relationshipRouteCandidateCard(candidate: GraphRouteCandidate): ParameterNodeCardView {
  const title = `${candidate.method} ${candidate.pathTemplate}`
  const detail = `${candidate.observedText} · ${candidate.applicability}`
  const footer = candidate.reviewReason || "정의 근거 확인"
  return {
    kind: "operation", badge: "CANDIDATE", title, detail, footer, icon: "none",
    accessibleLabel: `Route candidate ${candidate.service} ${title}; ${candidate.observedText}; applicability ${candidate.applicability}; ${footer}`,
  }
}
