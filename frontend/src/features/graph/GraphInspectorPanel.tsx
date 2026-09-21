import { useEffect, useState } from "react"

import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OperationDetail } from "@/features/evidence/OperationDetail"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { saveOwner } from "@/lib/api/endpoints"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import { graphCellKey, type GraphSelection } from "./graphProjection"
import type { HierarchySelection } from "./graphHierarchy"

interface Props {
  selection: GraphSelection
  event: EventRecord | null
  snapshot: Snapshot
  suspended?: boolean
  onOwnerSaved?(): void | Promise<unknown>
}

const INITIAL_EVIDENCE_COUNT = 3
const INITIAL_EVIDENCE_LENGTH = 160

function EvidenceIds({ ids }: { ids: readonly string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? ids : ids.slice(0, INITIAL_EVIDENCE_COUNT)
  const hasMore = ids.length > INITIAL_EVIDENCE_COUNT || ids.some((id) => id.length > INITIAL_EVIDENCE_LENGTH)
  const display = (id: string) => !expanded && id.length > INITIAL_EVIDENCE_LENGTH ? `${id.slice(0, INITIAL_EVIDENCE_LENGTH)}…` : id
  return <div className="grid gap-2">
    <p className="text-xs text-muted-foreground">{ids.length}개 Evidence</p>
    {visible.length ? visible.map((id, index) => <p className="break-all rounded border bg-muted/30 p-2 font-mono text-xs" key={`${index}:${id}`}>{display(id)}</p>) : <p className="text-sm text-muted-foreground">연결된 Evidence가 없습니다.</p>}
    {hasMore && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setExpanded((current) => !current)}>{expanded ? "Evidence 접기" : "Evidence 더 보기"}</Button>}
  </div>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 border-b border-border/60 pb-2 last:border-b-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt><dd className="break-words text-sm">{value}</dd></div>
}

function ResourceOwnerEditor({ resource, owner, disabled, onSaved }: { resource: string; owner: string; disabled: boolean; onSaved?(): void | Promise<unknown> }) {
  const [identity, setIdentity] = useState(owner)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit() {
    setError("")
    setPending(true)
    try {
      await saveOwner(resource, identity)
      await onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "소유자 저장에 실패했습니다.")
    } finally {
      setPending(false)
    }
  }

  return <section className="grid gap-2 rounded-md border p-3" aria-label="객체 소유자 정책">
    <h3 className="font-medium">객체 정책</h3>
    <p className="break-all text-xs text-muted-foreground">{resource}</p>
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1"><Label htmlFor="graph-resource-owner">리소스 소유자</Label><Input id="graph-resource-owner" value={identity} disabled={disabled} onChange={(change) => setIdentity(change.target.value)} /></div>
      <Button type="button" disabled={disabled || pending} onClick={() => void submit()}>소유자 저장</Button>
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </section>
}

export function GraphInspectorPanel({ selection, event, snapshot, suspended = false, onOwnerSaved }: Props) {
  const datasetRevision = snapshot.datasetRevision ?? snapshot.identityRevision
  // PR#11 boundary: dataset replacement (server datasetRevision, D-140) or any coordinate change of the selected Evidence closes the draft.
  const contextKey = event ? JSON.stringify([datasetRevision, event.eventId, event.op, event.resource, event.idn, event.source, event.fp]) : null
  const [requestLabContext, setRequestLabContext] = useState<string | null>(null)
  const setRequestLabOpen = (open: boolean) => setRequestLabContext(open ? contextKey : null)
  useEffect(() => { setRequestLabContext(null) }, [contextKey])
  // 계층 그래프 선택은 서버 셀의 canonical key를 그대로 들고 온다. 현재 snapshot에서 다시 찾아 판정을 표시하고, 집계 판정은 만들지 않는다.
  const hierarchy = selection as Partial<HierarchySelection>
  const selectedKeys = new Set(hierarchy.cellKeys ?? [])
  const rawCells = snapshot.cells.filter((cell) => selectedKeys.has(graphCellKey(cell)))
  const cell = rawCells.length === 1 ? rawCells[0] : snapshot.cells.find((candidate) => candidate.idn === selection.identity && candidate.op === selection.operation && candidate.resource === selection.resource)
  const verdict = rawCells.length > 1 ? "복수 셀" : cell?.overall ?? (hierarchy.gapIds?.length ? "미교차 후보" : event?.verdict ?? "unknown")
  const operation = cell?.op ?? selection.operation
  const resource = cell?.resource ?? selection.resource
  const requiredRole = operation ? snapshot.requiredRoles[operation] : undefined
  const owner = resource ? snapshot.owners[resource] : undefined
  const description = selection.operation ?? selection.routeCandidate?.pathTemplate ?? "선택한 그래프 항목"

  return <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel
      title="선택 작업"
      description={description}
      tabs={<TabsList aria-label="선택 작업 상세 탭" className="mx-4 mt-3 grid h-auto grid-cols-5"><TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger><TabsTrigger value="request">Request</TabsTrigger><TabsTrigger value="response">Response</TabsTrigger><TabsTrigger value="policy">Policy</TabsTrigger></TabsList>}
    >
      <TabsContent value="summary" className="mt-0 grid gap-4">
        {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} /> : <dl className="grid gap-3">
          <DetailRow label="Operation" value={operation ?? "경로 후보"} />
          <DetailRow label="Identity" value={cell?.idn ?? selection.identity ?? "UNKNOWN"} />
          <DetailRow label="Resource" value={resource ?? "객체 없음"} />
          <DetailRow label="Source" value={selection.source === null ? "중립 / 소스 집계" : selection.source.toUpperCase()} />
        </dl>}
        <section aria-label="Access Check" className="grid gap-3 rounded-md border border-border/70 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Access Check</h3><Badge variant="outline">{verdict.toUpperCase()}</Badge></div>
          <p className="text-xs text-muted-foreground">서버 snapshot의 권한 셀과 정책을 그대로 표시합니다.</p>
          <div className="grid gap-1 text-sm"><p>필수 역할 {requiredRole ?? "미지정"}</p><p>소유자 {owner ?? "미확정"}</p>{cell?.conflict && <p>소스 판정 충돌</p>}{cell && cell.missedSources.length > 0 && <p>미관측 소스 {cell.missedSources.map((source) => source.toUpperCase()).join(", ")}</p>}</div>
          {cell && Object.entries(cell.reasons).map(([source, reason]) => <p className="break-words text-xs" key={source}>{source.toUpperCase()} · {reason}</p>)}
        </section>
        {rawCells.length > 1 && <section aria-label="서버 원본 셀" className="grid gap-2"><p className="text-xs text-muted-foreground">{rawCells.length}개 원본 셀 · 개별 서버 판정</p>{rawCells.map((raw) => <div key={graphCellKey(raw)} className="rounded border border-border/70 p-2 text-xs"><p className="break-all">{raw.idn} · {raw.op} · {raw.resource ?? "객체 없음"}</p><p>{raw.overall.toUpperCase()}{raw.conflict ? " · 소스 판정 충돌" : ""}</p></div>)}</section>}
        {!!hierarchy.gapIds?.length && <section aria-label="서버 Gap IDs" className="grid gap-1 text-xs">{hierarchy.gapIds.map((id) => <p className="break-all" key={id}>{id}</p>)}</section>}
      </TabsContent>
      <TabsContent value="evidence" className="mt-0 grid gap-4" aria-label="Evidence">
        <EvidenceIds ids={selection.evidenceIds} />
        {!event && resource && <ResourceOwnerEditor key={resource} resource={resource} owner={owner ?? ""} disabled={suspended} onSaved={onOwnerSaved} />}
        {event ? <section className="border-t border-border/70 pt-4" aria-label="선택 Evidence 작업"><OperationDetail event={event} snapshot={snapshot} onOpenRequestLab={() => setRequestLabOpen(true)} disabled={suspended} /></section> : <p className="text-sm text-muted-foreground">선택 좌표와 정확히 연결된 Evidence를 찾지 못했습니다.</p>}
        {event && contextKey && <RequestLabDialog key={contextKey} open={requestLabContext === contextKey} onOpenChange={setRequestLabOpen} event={event} sessions={snapshot.managedSessions} datasetRevision={datasetRevision} snapshotRevision={snapshot.revision} suspended={suspended} />}
      </TabsContent>
      <TabsContent value="request" className="mt-0 grid gap-3" aria-label="Request">
        <p className="font-mono text-sm">{event ? `${event.method} ${event.path}` : selection.operation ?? "요청 없음"}</p>
        <p className="text-sm text-muted-foreground">원문 요청은 Request Lab에서만 현재 탭 메모리로 처리합니다.</p>
      </TabsContent>
      <TabsContent value="response" className="mt-0 grid gap-3" aria-label="Response">
        <p className="font-mono text-sm">{event ? `HTTP ${event.status}` : "응답 Evidence 없음"}</p>
        <p className="text-sm text-muted-foreground">원문 응답은 Request Lab에서만 현재 탭 메모리로 처리합니다.</p>
      </TabsContent>
      <TabsContent value="policy" className="mt-0 grid gap-3" aria-label="Policy">
        <p className="text-sm text-muted-foreground">기존 snapshot 정책과 선택한 서버 권한 셀만 표시합니다.</p>
        <dl className="grid gap-3">
          <DetailRow label="필수 역할" value={requiredRole ?? "미지정"} />
          <DetailRow label="소유자" value={owner ?? "미확정"} />
          <DetailRow label="서버 판정" value={verdict.toUpperCase()} />
          {cell?.conflict && <DetailRow label="판정 충돌" value="소스 판정 충돌" />}
          {cell && cell.missedSources.length > 0 && <DetailRow label="미관측 소스" value={cell.missedSources.map((source) => source.toUpperCase()).join(", ")} />}
        </dl>
      </TabsContent>
    </InspectorPanel>
  </Tabs>
}
