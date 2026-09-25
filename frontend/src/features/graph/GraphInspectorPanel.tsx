import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphSelection } from "./graphProjection"

interface Props {
  selection: GraphSelection
  event: EventRecord | null
  snapshot: Snapshot
  suspended?: boolean
}

/** 선택 상세: 선택 좌표에 연결된 실제 Evidence 목록과 원문 보기·현재 세션 Repeater만 둔다. 경로 후보는 관측 Evidence가 없어 후보 근거를 보여 준다. */
export function GraphInspectorPanel({ selection, event, snapshot, suspended = false }: Props) {
  const ids = new Set(selection.evidenceIds)
  const listed = snapshot.events.filter(item => ids.has(item.eventId))
  // 그래프가 정확히 해석한 선택 Evidence는 목록에 반드시 포함한다.
  const events = event && !listed.some(item => item.eventId === event.eventId) ? [event, ...listed] : listed
  const title = selection.operation ? stripOrigin(selection.operation) || selection.operation : selection.routeCandidate ? `${selection.routeCandidate.method} ${selection.routeCandidate.pathTemplate}` : "선택한 그래프 항목"
  const subtitle = [selection.identity, selection.resource ? stripOrigin(selection.resource) || selection.resource : null].filter(Boolean).join(" · ")
  return <div className="flex min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel title="선택 작업" description={<><span className="block break-all font-mono text-foreground">{title}</span>{subtitle && <span className="block break-all">{subtitle}</span>}</>} tabs={null}>
      {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} /> : <EvidenceActionList events={events} snapshot={snapshot} disabled={suspended} />}
    </InspectorPanel>
  </div>
}
