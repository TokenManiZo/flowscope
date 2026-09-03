import { useEffect, useState } from "react"

import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OperationDetail } from "@/features/evidence/OperationDetail"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphSelection } from "./graphProjection"

interface Props {
  selection: GraphSelection
  event: EventRecord | null
  snapshot: Snapshot
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

export function GraphInspectorPanel({ selection, event, snapshot }: Props) {
  const [requestLabOpen, setRequestLabOpen] = useState(false)
  useEffect(() => { setRequestLabOpen(false) }, [event?.eventId, snapshot.revision])
  const cell = snapshot.cells.find((candidate) => candidate.idn === selection.identity && candidate.op === selection.operation && candidate.resource === selection.resource)
  const verdict = cell?.overall ?? event?.verdict ?? "unknown"
  const requiredRole = selection.operation ? snapshot.requiredRoles[selection.operation] : undefined
  const owner = selection.resource ? snapshot.owners[selection.resource] : undefined
  const description = selection.operation ?? selection.routeCandidate?.pathTemplate ?? "선택한 그래프 항목"

  return <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col bg-[var(--flowscope-pane)]">
    <InspectorPanel
      title="선택 작업"
      description={description}
      tabs={<TabsList aria-label="선택 작업 상세 탭" className="mx-4 mt-3 grid h-auto grid-cols-5"><TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger><TabsTrigger value="request">Request</TabsTrigger><TabsTrigger value="response">Response</TabsTrigger><TabsTrigger value="policy">Policy</TabsTrigger></TabsList>}
    >
      <TabsContent value="summary" className="mt-0 grid gap-4">
        {selection.routeCandidate ? <RouteCandidateDetail candidate={selection.routeCandidate} /> : <dl className="grid gap-3">
          <DetailRow label="Operation" value={selection.operation ?? "경로 후보"} />
          <DetailRow label="Identity" value={selection.identity ?? "UNKNOWN"} />
          <DetailRow label="Resource" value={selection.resource ?? "객체 없음"} />
          <DetailRow label="Source" value={(selection.source ?? "UNKNOWN").toUpperCase()} />
        </dl>}
        <section aria-label="Access Check" className="grid gap-3 rounded-md border border-border/70 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Access Check</h3><Badge variant="outline">{verdict.toUpperCase()}</Badge></div>
          <p className="text-xs text-muted-foreground">서버 snapshot의 권한 셀과 정책을 그대로 표시합니다.</p>
          <div className="grid gap-1 text-sm"><p>필수 역할 {requiredRole ?? "미지정"}</p><p>소유자 {owner ?? "미확정"}</p>{cell?.conflict && <p>소스 판정 충돌</p>}{cell && cell.missedSources.length > 0 && <p>미관측 소스 {cell.missedSources.map((source) => source.toUpperCase()).join(", ")}</p>}</div>
        </section>
      </TabsContent>
      <TabsContent value="evidence" className="mt-0 grid gap-4" aria-label="Evidence">
        <EvidenceIds ids={selection.evidenceIds} />
        {event ? <section className="border-t border-border/70 pt-4" aria-label="선택 Evidence 작업"><OperationDetail event={event} snapshot={snapshot} onOpenRequestLab={() => setRequestLabOpen(true)} /></section> : <p className="text-sm text-muted-foreground">선택 좌표와 정확히 연결된 Evidence를 찾지 못했습니다.</p>}
        {event && <RequestLabDialog key={`${event.eventId}:${snapshot.revision}`} open={requestLabOpen} onOpenChange={setRequestLabOpen} event={event} sessions={snapshot.managedSessions} datasetRevision={snapshot.revision} />}
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
