import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphSelection } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { GraphNodeSummary, graphNodeSummary } from "./GraphNodeSummary"

/** Site View에서만 한 번 보여 주는 이동 안내. 이후 View는 같은 동작이라 반복하지 않는다. */
export const GRAPH_OPEN_HINT = "노드를 더블클릭하거나 Enter로 열기"

interface Props {
  selection: GraphSelection
  event: EventRecord | null
  snapshot: Snapshot
  suspended?: boolean
  /** 캔버스에서 한 번 클릭한 계층 노드. 요약(통계·목록)을 Evidence 목록 위에 보여 준다. */
  node?: HierarchyNode | null
  projection?: HierarchyProjection | null
}

/** 선택 상세: 선택 좌표에 연결된 실제 Evidence 목록과 원문 보기·현재 세션 Repeater만 둔다. 경로 후보는 관측 Evidence가 없어 후보 근거를 보여 준다. */
export function GraphInspectorPanel({ selection, event, snapshot, suspended = false, node = null, projection = null }: Props) {
  const summary = node && projection ? graphNodeSummary(node, projection) : null
  const structural = node?.kind === "target" || node?.kind === "api-group"
  const ids = new Set(selection.evidenceIds)
  const listed = snapshot.events.filter(item => ids.has(item.eventId))
  // 그래프가 정확히 해석한 선택 Evidence는 목록에 반드시 포함한다.
  const events = event && !listed.some(item => item.eventId === event.eventId) ? [event, ...listed] : listed
  const title = structural && node ? node.label : selection.operation ? stripOrigin(selection.operation) || selection.operation : selection.routeCandidate ? `${selection.routeCandidate.method} ${selection.routeCandidate.pathTemplate}` : "선택한 그래프 항목"
  const subtitle = [selection.identity, selection.resource ? stripOrigin(selection.resource) || selection.resource : null].filter(Boolean).join(" · ")
  return <div className="flex min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel title="선택 작업" description={<><span className="block break-all font-mono text-foreground">{title}</span>{subtitle && <span className="block break-all">{subtitle}</span>}</>} tabs={null}>
      {summary && <GraphNodeSummary summary={summary} hint={projection?.kind === "site" && node?.kind === "api-group" ? GRAPH_OPEN_HINT : undefined} />}
      {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} /> : structural ? null : <EvidenceActionList events={events} snapshot={snapshot} disabled={suspended} />}
    </InspectorPanel>
  </div>
}
