import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EvidenceSheet } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { importXml } from "@/lib/api/endpoints"
import type { EventRecord } from "@/lib/api/types"
import { queryKeys, useEvidenceQuery, useSnapshotQuery } from "@/lib/query/hooks"
import { EvidenceFilters } from "./EvidenceFilters"
import { ImportXmlDialog } from "./ImportXmlDialog"
import { boundedText, defaultEvidenceFilters, hiddenEvidenceCount, visibleEvidence } from "./evidenceSelectors"

const evidencePageLimit = 200

function sourceLabel(source: EventRecord["source"]): string {
  return source === "human" ? "H" : source === "scanner" ? "S" : source === "llm" ? "L" : "UNKNOWN"
}

function dispositionLabel(disposition: string): string {
  return disposition === "INCLUDE" ? "메인 비교" : disposition === "REVIEW" ? "검토 대기" : disposition === "EXCLUDE" ? "기본 숨김" : boundedText(disposition)
}

export function EvidencePage() {
  const snapshot = useSnapshotQuery()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(defaultEvidenceFilters)
  const [selected, setSelected] = useState<EventRecord | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const selectedEvent = selected ? snapshot.data?.events.find((item) => item.eventId === selected.eventId) ?? null : null
  const evidence = useEvidenceQuery(selectedEvent?.op ?? null, offset, evidencePageLimit)

  useEffect(() => {
    if (selected && !selectedEvent) { setSelected(null); setInspectorOpen(false) }
  }, [selected, selectedEvent])

  const rows = useMemo(() => visibleEvidence(snapshot.data?.events ?? [], filters), [snapshot.data?.events, filters])
  const hidden = hiddenEvidenceCount(snapshot.data?.events ?? [], filters)
  const page = evidence.data

  function selectEvent(event: EventRecord) {
    void queryClient.cancelQueries({ queryKey: ["evidence"] })
    queryClient.removeQueries({ queryKey: ["evidence"] })
    setSelected(event)
    setInspectorOpen(true)
    setOffset(0)
  }

  const context = <section className="grid gap-4 p-3"><div><h2 className="text-sm font-semibold">Evidence 표시</h2><p className="text-xs text-muted-foreground">필터는 현재 표시에만 적용되며 Evidence를 삭제하지 않습니다.</p></div><EvidenceFilters value={filters} onChange={setFilters} /><div className="border-t pt-3"><ImportXmlDialog importFile={importXml} afterImport={() => queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })} /></div></section>
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} onOpenChange={() => undefined} />
  return (
    <ReferenceAnalysisWorkspace ariaLabel="Evidence 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelected(null) }}>
      <section className="grid gap-4 p-3" aria-labelledby="evidence-title">
      <div><h1 id="evidence-title" className="text-xl font-semibold">Evidence</h1><p className="text-sm text-muted-foreground">파싱된 Evidence를 표시하며 숨김은 삭제가 아닙니다.</p></div>
      {snapshot.isLoading ? <Skeleton className="h-64" /> : snapshot.isError ? <Alert variant="destructive"><AlertTitle>Evidence를 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error.message}</AlertDescription></Alert> : <>
        <p className="text-sm text-muted-foreground">숨김 {hidden}건 · 삭제되지 않았습니다.</p>
        <ScrollArea className="h-[28rem] rounded-md border" aria-label="Evidence 표">
          <Table>
            <TableHeader><TableRow><TableHead>소스</TableHead><TableHead>신원</TableHead><TableHead>요청</TableHead><TableHead>분류</TableHead><TableHead>반복</TableHead><TableHead>관측</TableHead><TableHead>Evidence ID</TableHead><TableHead><span className="sr-only">동작</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((event) => <TableRow key={event.eventId} data-state={selected?.eventId === event.eventId ? "selected" : undefined}>
                <TableCell><Badge variant="outline">{sourceLabel(event.source)}</Badge></TableCell><TableCell>{boundedText(event.idn, 48)}</TableCell>
                <TableCell className="max-w-72 whitespace-normal"><span className="font-mono">{boundedText(event.method, 16)}</span> {boundedText(event.path, 120)} <span className="text-muted-foreground">({event.status})</span></TableCell>
                <TableCell className="max-w-48 whitespace-normal"><Badge variant="secondary">{boundedText(event.trafficClass, 40)}</Badge><span className="ml-1">{dispositionLabel(event.trafficDisposition)}</span></TableCell>
                <TableCell>{event.repeatCount}</TableCell><TableCell className="whitespace-normal">최초 {boundedText(event.firstSeen, 32)} · 최종 {boundedText(event.lastSeen, 32)}</TableCell><TableCell className="font-mono">{boundedText(event.eventId, 72)}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => selectEvent(event)} aria-label="상세 보기">상세 보기</Button></TableCell>
              </TableRow>)}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="whitespace-normal text-muted-foreground">현재 필터에 표시할 Evidence가 없습니다. 숨김은 삭제되지 않았습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </ScrollArea>
      </>}
      {selectedEvent && <div className="sr-only" aria-live="polite">선택한 Evidence 상세를 {evidence.isLoading ? "불러오는 중" : evidence.isError ? "불러오지 못했습니다" : "표시합니다"}.</div>}
      {selectedEvent && <div className="flex flex-wrap items-center gap-2">
        {page && <div>
          <span className="text-sm">총 {page.total}건 · {page.offset + 1}번째부터 표시</span>
          <Button variant="outline" size="sm" aria-label="이전 Evidence 페이지" disabled={page.offset <= 0 || evidence.isFetching} onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>이전</Button>
          <Button variant="outline" size="sm" aria-label="다음 Evidence 페이지" disabled={!page.hasMore || evidence.isFetching} onClick={() => setOffset(page.offset + page.limit)}>다음</Button>
        </div>}
      </div>}
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
