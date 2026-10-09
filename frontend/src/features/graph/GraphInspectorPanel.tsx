import { graphApiOperations } from "./graphApiOperations"
import { collectionIdentity, graphAccountLabel } from "./graphAccounts"
import { ApiActions, DeleteTrafficButton, API_ACTION_LARGE_CLASS, API_ACTION_DELETE_STYLE } from "@/features/api-management/ApiActions"
import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import type { EventRecord, Snapshot, Verdict } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphSelection } from "./graphProjection"
import { isPublicRead, type HierarchyNode, type HierarchyProjection } from "./graphHierarchy"
import { GraphNodeSummary, graphNodeSummary } from "./GraphNodeSummary"
import { GraphOwnerControl } from "./GraphOwnerControl"
import { GraphScopeSummary } from "./GraphScopeSummary"

/** 사이트·그룹 요약 패널에서 그래프로 이어지는 동작. RelationshipGraphView가 이동·선택을 맡는다. */
export interface ScopeActions {
  onOpenRequestLab?(): void
  onRevealOperation?(groupId: string, operation: string): void
  onSelectGroup?(groupId: string): void
  onOpenGroup?(groupId: string): void
}

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
  actions?: ScopeActions
}

/** 선택 상세: 선택 좌표에 연결된 실제 Evidence 목록과 원문 보기·현재 세션 Repeater만 둔다. 경로 후보는 관측 Evidence가 없어 후보 근거를 보여 준다. */
export function GraphInspectorPanel({ selection, event, snapshot, suspended = false, node = null, projection = null, actions = {} }: Props) {
  const baseSummary = node && projection ? graphNodeSummary(node, projection) : null
  // 조회가 공개면 소유자 대신 "공개"로 보여 준다. 저장된 소유자는 쓰기 판정에 계속 쓰인다.
  const publicObject = node?.kind === "resource" && node.selection.operation && node.selection.resource ? isPublicRead(snapshot, node.selection.operation, node.selection.resource) : false
  const summary = baseSummary && publicObject ? { ...baseSummary, listTitle: "접근한 계정 · 조회 공개", list: baseSummary.list.map(([label, value]) => [label.replace(/ \(소유자\)$/, ""), value] as [string, string]) } : baseSummary
  const structural = node?.kind === "target" || node?.kind === "api-group"
  // API를 고르면 "접근한 신원" 목록을 관측 기록 카드와 합친다(신원이 두 번 나오지 않게). 판정은 카드 제목 옆에 보여 준다.
  const merged = node?.kind === "operation" && !selection.routeCandidate && !!summary
  const identityVerdicts = merged ? new Map(summary.list.map(([identity, verdict]) => [identity, verdict as Verdict])) : undefined
  const ids = new Set(selection.evidenceIds)
  const manual = (snapshot.manualVerifications ?? []).filter(item => ids.has(item.originEvidenceId))
  const listed = snapshot.events.filter(item => ids.has(item.eventId))
  // 그래프가 정확히 해석한 선택 Evidence는 목록에 반드시 포함한다.
  const events = event && !listed.some(item => item.eventId === event.eventId) ? [event, ...listed] : listed
  const judgedIds = new Set(snapshot.cells.flatMap(cell => cell.evidenceIds))
  const unjudgedCount = events.filter(item => ![item.eventId, ...(item.clusterEvidenceIds ?? [])].some(id => judgedIds.has(id))).length
  const title = (structural || node?.staticResource || selection.displayObjectKey || selection.displayApiKey) && node ? node.label : selection.operation ? stripOrigin(selection.operation) || selection.operation : selection.routeCandidate ? `${selection.routeCandidate.method} ${selection.routeCandidate.pathTemplate}` : node?.label ?? "선택한 그래프 항목"
  const objectSelection = node?.kind === "resource" || node?.kind === "object-group" || !node && !!selection.resource
  const objectEvidenceIds = [...new Set(events.flatMap(item => [item.eventId, ...(item.clusterEvidenceIds ?? [])]))].filter(id => ids.has(id))
  const objectOps = [...new Set([...(node?.displayOperations ?? []), ...(node?.selection.cells.map(cell => cell.op) ?? []), ...events.map(item => item.op), ...(selection.operation ? [selection.operation] : [])])]
  const apiOps = selection.routeCandidate ? [`${selection.routeCandidate.service} ${selection.routeCandidate.method} ${selection.routeCandidate.pathTemplate}`] : objectSelection ? objectOps : node ? graphApiOperations(node) : selection.operation ? [selection.operation] : []
  const selectionActions = apiOps.length > 0
    ? <ApiActions snapshot={snapshot} operations={apiOps} disabled={suspended} size="lg" deleteEvidenceIds={objectSelection ? objectEvidenceIds : undefined} deleteLabel={objectSelection ? "객체 삭제" : "API 삭제"} />
    : objectSelection && <DeleteTrafficButton key={JSON.stringify([snapshot.datasetRevision ?? snapshot.identityRevision, objectEvidenceIds])} snapshot={snapshot} evidenceIds={objectEvidenceIds} label="객체 삭제" iconOnly disabled={suspended || objectEvidenceIds.length === 0} className={`${API_ACTION_LARGE_CLASS} ${API_ACTION_DELETE_STYLE}`} />
  return <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel title="선택 작업" actionsPlacement="footer" actions={selectionActions} description={<div className="mt-2 grid gap-2"><span className="block break-all rounded-md border border-border/70 bg-background px-3 py-2 font-mono text-sm leading-relaxed text-foreground">{title}</span>{selection.identity && <span className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">계정</span><span className="rounded border border-border/70 bg-background px-2 py-1 font-medium text-foreground">{graphAccountLabel(snapshot, selection.identity)}</span></span>}{selection.resource && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">객체 식별자</summary><span className="mt-1 block select-all break-all font-mono text-foreground">{stripOrigin(selection.resource) || selection.resource}</span></details>}</div>} tabs={null}>
      {/* 소유자를 모르면 이 객체의 판정이 보류되므로 패널 맨 위에서 먼저 묻는다. */}
      {node?.kind === "resource" && !node.selection.displayObjectKey && node.selection.resource && <GraphOwnerControl snapshot={snapshot} operation={node.selection.operation} resource={node.selection.resource} disabled={suspended} />}
      {node?.kind === "support-operation" && <p className="mb-4 border-b pb-4 text-xs text-muted-foreground">실제 요청·응답을 관측했지만 판정 대상이 아닙니다. 이 카드만으로 API 존재, 접근 허용, 취약점을 뜻하지 않습니다.</p>}
      {/* 대상·API 그룹은 후보·확인 필요·계정별 접근으로 정리한 요약을 보여 준다. */}
      {node?.discovery ? <p className="mb-4 text-sm text-muted-foreground">{node.discovery === "unregistered" ? "브라우저에서 발견한 주소입니다." : "점검 범위에 등록된 주소입니다."} 트래픽이 들어오면 여기에 연결됩니다.</p>
        : structural && projection ? <GraphScopeSummary labelIdentity={identity => graphAccountLabel(snapshot, identity)} scope={node?.kind === "target" ? "site" : "group"} groups={node?.kind === "target" ? projection.groups : projection.groups.filter(group => group.id === node?.groupId)} owners={snapshot.owners} {...actions} />
        : summary && <GraphNodeSummary labelIdentity={identity => graphAccountLabel(snapshot, identity)} summary={merged ? { ...summary, list: [] } : summary} />}
      {!structural && !selection.routeCandidate && unjudgedCount > 0 && <p className="mb-4 text-xs text-muted-foreground">권한 판정에 포함되지 않은 요청 기록 {unjudgedCount}건이 있습니다. 응답 코드는 접근 허용이나 취약점 판정이 아닙니다.</p>}
      {node?.kind === "resend-operation" && <p className="mb-4 border-b pb-4 text-xs text-muted-foreground">Request Lab·Repeater로 값을 바꿔 다시 보낸 요청입니다. 판정과 미점검 계산에 쓰지 않습니다.</p>}
      {node?.kind === "observed-operation" && <p className="mb-4 border-b pb-4 text-xs text-muted-foreground">실제 요청·응답을 관측했습니다. 이 노드는 API 존재나 접근 허용·취약점 판정이 아닙니다.</p>}
      {manual.length > 0 && <section aria-label="Request Lab 재현" className="mb-4 border-b pb-4 text-sm">
        <h3 className="font-medium">Request Lab 재현 · {manual.length}건</h3>
        <p className="text-xs text-muted-foreground">원본 요청에 연결된 응답입니다. 상태 코드만으로 취약점을 판정하지 않습니다.</p>
        <ul className="mt-2 grid gap-1">{manual.map(item => <li key={item.eventId} className="font-mono text-xs">{snapshot.evidenceOrdinals?.[item.eventId] ? `#${snapshot.evidenceOrdinals[item.eventId]} · ` : ""}HTTP {item.status}</li>)}</ul>
      </section>}
      {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} ordinals={snapshot.evidenceOrdinals} snapshot={snapshot} disabled={suspended} onOpenRequestLab={actions.onOpenRequestLab} /> : structural ? null : <EvidenceActionList allowDelete={objectSelection} onOpenRequestLab={actions.onOpenRequestLab} events={events} snapshot={snapshot} disabled={suspended} identityVerdicts={identityVerdicts} identityOf={collectionIdentity} labelIdentity={identity => graphAccountLabel(snapshot, identity)} />}
    </InspectorPanel>
  </div>
}

/** 아무것도 선택하지 않았을 때의 상세 패널: 지금 보고 있는 범위(사이트·API 그룹·API)의 요약. 패널을 닫지 않아 캔버스가 다시 그려지지 않는다. */
export function GraphViewOverview({ projection, owners, actions = {}, labelIdentity }: { projection: HierarchyProjection; owners?: Readonly<Record<string, string>>; actions?: ScopeActions; labelIdentity?: (identity: string) => string }) {
  const context = projection.kind === "site"
    ? projection.nodes.find(node => node.kind === "target")
    : projection.kind === "group"
      ? { kind: "api-group", groupId: projection.navigation.groupId, label: projection.groups.find(group => group.id === projection.navigation.groupId)?.label ?? "API 그룹" } as HierarchyNode
      : projection.operations[0]
  const summary = context ? graphNodeSummary(context, projection) : null
  const title = !context ? "현재 보기" : context.kind === "operation" && context.selection.operation ? stripOrigin(context.selection.operation) || context.selection.operation : context.label
  return <div className="flex min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel title="현재 보기" description={<span className="block break-all font-mono text-foreground">{title}</span>} tabs={null}>
      {projection.kind === "operation" ? summary ? <GraphNodeSummary labelIdentity={labelIdentity} summary={summary} /> : null
        : <GraphScopeSummary labelIdentity={labelIdentity} scope={projection.kind === "site" ? "site" : "group"} groups={projection.kind === "site" ? projection.groups : projection.groups.filter(group => group.id === projection.navigation.groupId)} owners={owners} {...actions} onOpenGroup={undefined} />}
      <p className="p-4 text-xs text-muted-foreground">노드를 누르면 그 노드의 정보가 여기에 나옵니다. 빈 곳을 누르면 이 요약으로 돌아옵니다.</p>
    </InspectorPanel>
  </div>
}
