import type { ParameterNodeCardView } from "@/features/parameter-map/parameterNodeCard"
import { pathAfterGroup } from "@/lib/display/pathLines"
import type { GraphNode, GraphProjection, GraphRouteCandidate } from "./graphProjection"
import { isJavascriptHiddenApi, type HierarchyNode, type HierarchyProjection } from "./graphHierarchy"

type RelationshipNode = GraphNode | HierarchyNode
type RelationshipProjection = GraphProjection | HierarchyProjection

const methodPattern = /^(?:(https?:\/\/\S+)\s+)?(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE|CONNECT|UNKNOWN)\s+(.+)$/i

export function operationParts(value: string): { method: string; path: string } {
  const match = value.match(methodPattern)
  return match ? { method: match[2].toUpperCase(), path: match[3] } : { method: "UNKNOWN", path: value }
}

/** 서버 판정이 IDOR·BFLA 후보(SUSPICIOUS)인 셀 수. 카드의 빨간 점 숫자로 쓴다. */
const candidateCount = (cells: readonly { overall: string }[]) => cells.filter(cell => cell.overall === "suspicious").length

function evidenceFooter(node: RelationshipNode) {
  return `관측 기록 ${node.selection.evidenceIds.length}건`
}

/**
 * 카드에는 판정 글자를 그리지 않는다(판정은 상세·접근 이름·확정 테두리). API·Object 카드의 상세 줄은 접근 주체 아이콘 자리다.
 * statuses는 API 카드에 그릴 관측 응답 코드다. 응답 코드는 관측 결과일 뿐 판정이 아니다.
 */
export function relationshipNodeCard(node: RelationshipNode, projection: RelationshipProjection, statuses: readonly number[] = []): ParameterNodeCardView {
  if (node.kind === "target") {
    const service = node.service ?? node.label
    const groupCount = "kind" in projection ? projection.groups.filter(group => group.service === service).length : 0
    return {
      kind: "target", badge: "TARGET", title: service, detail: "", footer: `${groupCount} API group${groupCount === 1 ? "" : "s"}`, icon: "globe",
      accessibleLabel: `Target ${service}; ${groupCount} API group${groupCount === 1 ? "" : "s"}`,
    }
  }

  if (node.kind === "api-group") {
    const group = "kind" in projection ? projection.groups.find(item => item.id === node.groupId) : undefined
    // 카드는 이름과 API 수만 둔다. 출처 수·Gap은 선택했을 때 오른쪽 패널에서 본다.
    const endpointCount = group?.endpointCount ?? 0
    const observed = group?.observedCount ?? 0
    const unrequested = group?.routeCandidateCount ?? 0
    const candidates = candidateCount(group?.cells ?? [])
    return {
      kind: "target", badge: "API GROUP", title: node.label, detail: `${endpointCount} APIs${observed ? ` · 관측 ${observed}` : ""}${unrequested ? ` · 미요청 ${unrequested}` : ""}`, footer: "", icon: "network",
      accessibleLabel: `${node.label}; ${node.service ?? "Target"}; API group; ${endpointCount} APIs${candidates ? `; IDOR·BFLA 후보 ${candidates}` : ""}`,
      ...(candidates ? { candidates } : {}),
    }
  }

  if (node.kind === "identity") return {
    kind: "condition", badge: "IDENTITY", title: node.label, detail: "", footer: "", icon: "user",
    accessibleLabel: `Identity ${node.label}; verdict ${node.verdictText}`,
  }

  if (node.kind === "operation-group" && "objectGroup" in node && node.objectGroup) {
    // API 묶음: 같은 경로 형식의 API들. 메서드 뱃지, 그룹 구간을 뺀 경로 형식, 멤버 수. 후보 빨간 점은 멤버 합계다.
    const { members, expanded } = node.objectGroup
    const shape = operationParts(node.label)
    const candidates = candidateCount(node.selection.cells ?? [])
    return {
      kind: "operation", badge: shape.method, title: `${expanded ? "▾" : "▸"} ${pathAfterGroup(shape.path)}`, detail: "", footer: `${members.length}개`, icon: "none",
      accessibleLabel: `${node.label} API 묶음; ${members.length}개; ${expanded ? "펼침" : "접힘"}${candidates ? `; IDOR·BFLA 후보 ${candidates}` : ""}; 더블클릭하거나 Enter로 ${expanded ? "접기" : "펼치기"}`,
      ...(statuses.length ? { statuses } : {}),
      ...(candidates ? { candidates } : {}),
    }
  }

  if (node.kind === "quiet-group" && "objectGroup" in node && node.objectGroup) {
    // 의심·충돌·확인 필요·쓰기 신호가 없는 기능과 관측만 된 기능을 접어 둔 카드.
    const { members, expanded } = node.objectGroup
    return {
      kind: "operation", badge: "FOLDED", title: `${expanded ? "▾" : "▸"} ${node.label}`, detail: "", footer: "의심·충돌·확인 필요·쓰기 아님", icon: "none",
      accessibleLabel: `${node.label}; ${members.length}개; ${expanded ? "펼침" : "접힘"}; 더블클릭하거나 Enter로 ${expanded ? "접기" : "펼치기"}`,
    }
  }

  if (node.kind === "object-group" && "objectGroup" in node && node.objectGroup) {
    const { key, members, expanded } = node.objectGroup
    return {
      kind: "target", badge: "OBJECTS", title: `${expanded ? "▾" : "▸"} ${key}`, detail: "", footer: `${members.length}개`, icon: "box",
      accessibleLabel: `${key} 객체 묶음; ${members.length}개; ${expanded ? "펼침" : "접힘"}; 더블클릭하거나 Enter로 ${expanded ? "접기" : "펼치기"}`,
    }
  }

  if (node.kind === "resource") {
    const owner = "publicRead" in node && node.publicRead ? "Public" : "owner" in node ? node.owner ?? "UNKNOWN" : "UNKNOWN"
    return {
      // 자원 키 앞의 서비스 오리진("http://host:port ")은 카드에서 뺀다. 전체 키는 접근 이름에 남는다.
      kind: "target", badge: "RESOURCE", title: node.label.replace(/^https?:\/\/\S+\s+/i, "") || node.label, detail: "", footer: `owner: ${owner}`, icon: "box",
      accessibleLabel: `${node.label}; Resource; verdict ${node.verdictText}; owner: ${owner}; ${evidenceFooter(node)}`,
    }
  }

  const operation = operationParts(node.label)
  if (node.kind === "observed-operation") return {
    kind: "operation", badge: "OBSERVED", title: `${operation.method} ${operation.path}`, detail: "관측만 · 판정 제외", footer: "", icon: "none",
    accessibleLabel: `Observed operation ${node.label}; 판정 제외`,
  }

  const candidates = "kind" in projection ? candidateCount((node as HierarchyNode).selection.cells ?? []) : 0
  return {
    // API 카드는 API 그룹 안에서만 보이므로 그룹 구간까지는 생략한다(breadcrumb에 그룹 이름이 있다). 전체 경로는 접근 이름에 남는다.
    kind: "operation", badge: operation.method, title: pathAfterGroup(operation.path), detail: "", footer: "", icon: "none",
    accessibleLabel: `${node.label}; Operation; verdict ${node.verdictText}${statuses.length ? `; HTTP ${statuses.join(", ")}` : ""}${candidates ? `; IDOR·BFLA 후보 ${candidates}` : ""}`,
    ...(statuses.length ? { statuses } : {}),
    ...(candidates ? { candidates } : {}),
  }
}

export function relationshipRouteCandidateCard(candidate: GraphRouteCandidate): ParameterNodeCardView {
  const title = `${candidate.method} ${candidate.pathTemplate}`
  const detail = isJavascriptHiddenApi(candidate) ? "미요청 · JS에서 발견" : `${candidate.observedText} · ${candidate.applicability}`
  const footer = candidate.reviewReason || "정의 근거 확인"
  return {
    kind: "operation", badge: "CANDIDATE", title, detail, footer, icon: "none",
    accessibleLabel: `Route candidate ${candidate.service} ${title}; ${candidate.observedText}; applicability ${candidate.applicability}; ${footer}`,
  }
}
