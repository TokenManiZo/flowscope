import { useEffect, useMemo, useState } from "react"

import { EvidenceSheet, type StructuredEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { projectSequence, type SequenceLink } from "./sequenceProjection"
import { SequenceTimeline } from "./SequenceTimeline"

interface SequenceSelection extends StructuredEvidenceSelection {
  kind: "sequence"
  linkKey: string
  fromEventId: string
  toEventId: string
}

export function SequencePage() {
  const snapshot = useSnapshotQuery()
  const [selection, setSelection] = useState<SequenceSelection | null>(null)
  const [identityFilter, setIdentityFilter] = useState("")
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const projection = useMemo(() => snapshot.data ? projectSequence(snapshot.data) : null, [snapshot.data])
  const groups = projection?.groups.filter((group) => !identityFilter || group.identity === identityFilter) ?? []
  useEffect(() => {
    if (!selection || !projection) return
    const current = groups.flatMap((group) => group.links).some((entry) => entry.key === selection.linkKey && entry.link.fromEventId === selection.fromEventId && entry.link.toEventId === selection.toEventId)
    if (!current) { setSelection(null); setInspectorOpen(false) }
  }, [groups, projection, selection])
  const select = (entry: SequenceLink) => { if (snapshot.isError) return; setSelection({ kind: "sequence", linkKey: entry.key, fromEventId: entry.link.fromEventId, toEventId: entry.link.toEventId, identity: entry.link.idn, operation: `${entry.link.fromOp} → ${entry.link.toOp}`, evidenceIds: [], eventIds: [entry.link.fromEventId, entry.link.toEventId] }); setInspectorOpen(true) }
  const selectedEvent = selection ? snapshot.data?.events.find((event) => selection.eventIds.includes(event.eventId)) ?? null : null
  const context = <section className="grid gap-2 p-3"><h2 className="text-sm font-semibold">흐름 링크</h2><p className="text-xs text-muted-foreground">서버 flowLinks의 관측 순서만 표시합니다. 선택은 사라진 링크와 함께 정리됩니다.</p><label className="grid gap-1 text-sm"><span>신원 필터</span><select aria-label="신원 필터" className="rounded-md border bg-background px-2 py-1" value={identityFilter} onChange={(event) => setIdentityFilter(event.target.value)}><option value="">전체 신원</option>{projection?.groups.map((group) => <option key={group.identity} value={group.identity}>{group.identity}</option>)}</select></label><p className="text-xs text-muted-foreground">coverage 또는 권한 판정은 변경하지 않습니다.</p></section>
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} selection={selection} disabled={snapshot.isError} onOpenChange={() => undefined} />
  return <TooltipProvider><ReferenceAnalysisWorkspace ariaLabel="흐름 순서 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelection(null) }}><section className="grid gap-4 p-3" aria-labelledby="sequence-title">
    <div><h1 id="sequence-title" className="text-2xl font-semibold">흐름 순서</h1><p className="text-sm text-muted-foreground">데이터 의존 링크는 보조 정보이며 coverage 또는 IDOR/권한 판정을 변경하지 않습니다.</p></div>
    {snapshot.isError && <Alert variant="destructive"><AlertTitle>흐름 순서를 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</AlertDescription></Alert>}
    {snapshot.isLoading && <p className="rounded-md border p-6 text-sm text-muted-foreground">흐름 순서를 불러오는 중입니다.</p>}
    {projection && !groups.length && <p className="rounded-md border p-6 text-sm text-muted-foreground">표시할 서버 데이터 의존 링크가 없습니다.</p>}
    {projection && groups.length > 0 && <ScrollArea className="max-w-full" aria-label="데이터 의존 순서"><div className="grid gap-4">{groups.map((group) => <SequenceTimeline group={group} key={group.key} onSelect={select} />)}</div></ScrollArea>}
  </section></ReferenceAnalysisWorkspace></TooltipProvider>
}
