import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { TrafficWorkspace } from "@/features/evidence/TrafficWorkspace"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import { graphCellKey, type GraphSelection } from "./graphProjection"
import type { HierarchySelection } from "./graphHierarchy"

interface Props { selection: GraphSelection; event: EventRecord | null; snapshot: Snapshot; suspended?: boolean }

export function GraphInspectorPanel({ selection, event, snapshot, suspended = false }: Props) {
  const hierarchy = selection as Partial<HierarchySelection>
  const keys = new Set(hierarchy.cellKeys ?? [])
  const cells = snapshot.cells.filter(cell => keys.has(graphCellKey(cell)))
  const cell = cells.length === 1 ? cells[0] : snapshot.cells.find(item => item.idn === selection.identity && item.op === selection.operation && item.resource === selection.resource)
  const verdict = cells.length > 1 ? "복수 셀" : cell?.overall ?? (hierarchy.gapIds?.length ? "미교차 후보" : event?.verdict ?? "unknown")
  // Use selected graph coordinates, never an arbitrary representative's object/identity.
  const target = { operation: selection.operation, resource: selection.resource }
  return <InspectorPanel title="선택 작업" description={selection.operation ?? selection.routeCandidate?.pathTemplate ?? "선택한 그래프 항목"} tabs={null}>
    <div className="grid gap-4">
      {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} /> : <section aria-label="Access Check" className="grid gap-2 rounded border p-3 text-sm"><div className="flex items-center justify-between"><h3>분석 대상</h3><Badge variant="outline">{verdict.toUpperCase()}</Badge></div><p className="break-all">{selection.operation ?? "복수 API"}</p><p>신원 {selection.identity ?? "전체"} · 객체 {selection.resource ?? "전체 / 없음"}</p><p>필수 역할 {target.operation ? snapshot.requiredRoles[target.operation] ?? "미지정" : "복수 API"} · 소유자 {target.resource ? snapshot.owners[target.resource] ?? "미확정" : "객체 미선택"}</p>{cell && Object.entries(cell.reasons).map(([source, reason]) => <p key={source} className="text-xs">{source}: {reason}</p>)}<p className="text-xs">서버 판정입니다. 아래에서 확인할 실제 요청을 선택하세요.</p>{cell?.conflict && <p>소스 판정 충돌</p>}{cell && cell.missedSources.length > 0 && <p>미관측 소스 {cell.missedSources.join(", ")}</p>}</section>}
      {cells.length > 1 && <section aria-label="서버 원본 셀"><details><summary>서버 원본 셀 · {cells.length}개</summary>{cells.map(item => <p key={graphCellKey(item)} className="break-all text-xs">{item.idn} · {item.op} · {item.resource ?? "객체 없음"} · {item.overall.toUpperCase()}</p>)}</details></section>}
      {!!hierarchy.gapIds?.length && <section aria-label="서버 Gap IDs">{hierarchy.gapIds.map(id => <p key={id} className="break-all text-xs">{id}</p>)}</section>}
      {!selection.routeCandidate && <TrafficWorkspace snapshot={snapshot} evidenceIds={selection.evidenceIds} initialEvent={event} target={target} disabled={suspended} />}
    </div>
  </InspectorPanel>
}
