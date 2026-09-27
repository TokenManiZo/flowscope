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
import type { EventRecord, PayloadRetentionMetadata } from "@/lib/api/types"
import { queryKeys, useEvidenceQuery, useSnapshotQuery } from "@/lib/query/hooks"
import { evidenceFullLabel, evidenceOrdinalLabel, observedTimeLabel } from "@/lib/display/operationLabel"
import { EvidenceFilters } from "./EvidenceFilters"
import { ImportXmlDialog } from "./ImportXmlDialog"
import { boundedText, defaultEvidenceFilters, hiddenEvidenceCount, visibleEvidence } from "./evidenceSelectors"

function sourceLabel(source: EventRecord["source"]): string {
  return source === "human" ? "H" : source === "scanner" ? "S" : source === "llm" ? "L" : "UNKNOWN"
}

function dispositionLabel(disposition: string): string {
  return disposition === "INCLUDE" ? "메인 비교" : disposition === "REVIEW" ? "검토 대기" : disposition === "EXCLUDE" ? "기본 숨김" : boundedText(disposition)
}

const evidencePageLimit = 200

function Retention({ label, value }: { label: string; value: PayloadRetentionMetadata | null }) {
  return <p className="break-all text-xs text-muted-foreground">{label}: {value ? `${value.retained ? "보존" : "미보존"} · ${value.retention} · ${value.bytes} bytes · SHA-256 ${value.digest}` : "보존 메타데이터 없음"}</p>
}

export function EvidencePage() {
  const snapshot = useSnapshotQuery()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(defaultEvidenceFilters)
  const [selected, setSelected] = useState<EventRecord | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const selectedEvent = selected ? snapshot.data?.events.find((item) => item.eventId === selected.eventId) ?? null : null
  const datasetRevision = snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0
  const evidence = useEvidenceQuery(selectedEvent?.op ?? null, offset, evidencePageLimit, datasetRevision)

  useEffect(() => {
    if (selected && !selectedEvent && !snapshot.isError) { setSelected(null); setInspectorOpen(false) }
  }, [selected, selectedEvent, snapshot.isError])

  const rows = useMemo(() => visibleEvidence(snapshot.data?.events ?? [], filters), [snapshot.data?.events, filters])
  const hidden = hiddenEvidenceCount(snapshot.data?.events ?? [], filters)
  function selectEvent(event: EventRecord) {
    if (snapshot.isError) return
    void queryClient.cancelQueries({ queryKey: ["evidence"] })
    queryClient.removeQueries({ queryKey: ["evidence"] })
    setSelected(event)
    setInspectorOpen(true)
    setOffset(0)
  }

  const context = <section className="grid gap-4 p-3"><div><h2 className="text-sm font-semibold">Evidence 표시</h2></div><EvidenceFilters value={filters} onChange={setFilters} /><div className="border-t pt-3"><ImportXmlDialog importFile={importXml} afterImport={() => queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })} /></div></section>
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} disabled={snapshot.isError} onOpenChange={() => undefined} />
  const page = evidence.data
  return (
    <ReferenceAnalysisWorkspace ariaLabel="Evidence 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelected(null) }}>
      <section className="grid gap-4 p-3" aria-labelledby="evidence-title">
      <div><h1 id="evidence-title" className="text-xl font-semibold">Evidence</h1></div>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>Evidence를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
      {snapshot.isLoading ? <Skeleton className="h-64" /> : snapshot.data && <>
        <p className="text-sm text-muted-foreground">숨김 {hidden}건</p>
        <ScrollArea className="h-[28rem] rounded-md border" aria-label="Evidence 표">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>소스</TableHead><TableHead>신원</TableHead><TableHead>요청</TableHead><TableHead>분류</TableHead><TableHead>반복</TableHead><TableHead>관측 시각</TableHead><TableHead><span className="sr-only">동작</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((event) => <TableRow key={event.eventId} data-state={selected?.eventId === event.eventId ? "selected" : undefined}>
                <TableCell className="font-mono text-muted-foreground" title={event.eventId}>{evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId)}</TableCell><TableCell><Badge variant="outline">{sourceLabel(event.source)}</Badge></TableCell><TableCell>{boundedText(event.idn, 48)}</TableCell>
                <TableCell className="max-w-72 whitespace-normal"><span className="font-mono">{boundedText(event.method, 16)}</span> {boundedText(event.path, 120)} <span className="text-muted-foreground">({event.status})</span></TableCell>
                <TableCell className="max-w-48 whitespace-normal"><Badge variant="secondary">{boundedText(event.trafficClass, 40)}</Badge><span className="ml-1">{dispositionLabel(event.trafficDisposition)}</span></TableCell>
                <TableCell>{event.repeatCount}</TableCell><TableCell className="whitespace-normal">{observedTimeLabel(event.firstSeen, event.lastSeen)}</TableCell>
                <TableCell><Button size="sm" variant="outline" disabled={snapshot.isError} onClick={() => selectEvent(event)} aria-label="상세 보기">상세 보기</Button></TableCell>
              </TableRow>)}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="whitespace-normal text-muted-foreground">현재 필터에 맞는 Evidence가 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </ScrollArea>
      </>}
      {selectedEvent && <div className="sr-only" aria-live="polite">선택한 Evidence 상세를 {evidence.isLoading ? "불러오는 중" : evidence.isError ? "불러오지 못했습니다" : "표시합니다"}.</div>}
      {selectedEvent && <section aria-label="작업 Evidence 페이지" className="grid min-w-0 gap-3 rounded-md border p-3">
        <h2 className="break-all font-semibold">{boundedText(selectedEvent.op, 320)} · 마스킹 Evidence</h2>
        <p className="text-xs text-muted-foreground">선택 작업의 서버 마스킹 기록입니다. 위 표의 표시 필터는 유지되며 원문 편집은 Request Lab에서만 가능합니다.</p>
        {evidence.isLoading && <p>Evidence 페이지 불러오는 중…</p>}
        {evidence.isError && <p role="alert">{evidence.error.message}</p>}
        {page && page.records.length === 0 && <p>이 페이지에 Evidence가 없습니다.</p>}
        {page?.records.map((record) => <details key={`${datasetRevision}:${page.offset}:${record.eventId}`} open={record.eventId === selectedEvent.eventId} className="min-w-0 rounded border p-3">
          <summary className="cursor-pointer break-all font-mono text-sm">{boundedText(evidenceFullLabel(snapshot.data?.evidenceOrdinals, record.eventId), 160)}</summary>
          <div className="mt-3 grid min-w-0 gap-2">
            <p className="text-xs">{record.trafficClass} · {record.trafficDisposition}</p>
            <p className="break-words text-xs">{record.classificationReasons.join(" · ")}</p>
            <h3 className="text-sm font-medium">마스킹 Request</h3>
            <Retention label="Request 보존" value={record.requestPayload} />
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{record.request || record.requestBody || "요청 전문 없음"}</pre>
            <h3 className="text-sm font-medium">마스킹 Response</h3>
            <Retention label="Response 보존" value={record.responsePayload} />
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{record.response || record.responseBody || "응답 전문 없음"}</pre>
          </div>
        </details>)}
        {page && <div className="flex flex-wrap items-center gap-2"><span className="text-sm">총 {page.total}건 · {page.total === 0 ? 0 : page.offset + 1}번째부터 표시</span><Button variant="outline" size="sm" aria-label="이전 Evidence 페이지" disabled={page.offset <= 0 || evidence.isFetching || snapshot.isError} onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>이전</Button><Button variant="outline" size="sm" aria-label="다음 Evidence 페이지" disabled={!page.hasMore || evidence.isFetching || snapshot.isError} onClick={() => setOffset(page.offset + page.limit)}>다음</Button></div>}
      </section>}
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
