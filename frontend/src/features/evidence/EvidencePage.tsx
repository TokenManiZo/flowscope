import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
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
import { queryKeys, useEvidenceQuery, useSnapshotQuery, useTrafficOverrideMutation } from "@/lib/query/hooks"
import { evidenceOrdinalLabel, observedTimeLabel } from "@/lib/display/operationLabel"
import { trafficClassLabel, trafficReasonLabel } from "@/lib/display/traffic"
import { cn } from "@/lib/utils"
import { EvidenceFilters } from "./EvidenceFilters"
import { ImportXmlDialog } from "./ImportXmlDialog"
import { boundedText, defaultEvidenceFilters, dispositionCounts, hiddenEvidenceCount, tabDispositions, visibleEvidence, type EvidenceTab } from "./evidenceSelectors"

const sourceTone: Record<string, string> = { human: "text-observation-human", scanner: "text-observation-scanner", llm: "text-observation-llm" }
function sourceLabel(source: EventRecord["source"]): string {
  return source === "human" ? "H" : source === "scanner" ? "S" : source === "llm" ? "L" : "?"
}

const tabs: readonly [EvidenceTab, string][] = [["INCLUDE", "메인 비교"], ["REVIEW", "검토 필요"], ["EXCLUDE", "숨김"], ["ALL", "전체"]]
/** 대시보드의 "검토 필요 트래픽"은 #evidence-review로 들어와 검토 탭을 연다. */
const initialTab = (): EvidenceTab => window.location.hash === "#evidence-review" ? "REVIEW" : "INCLUDE"

const clock = new Intl.DateTimeFormat("ko-KR", { timeStyle: "medium" })
function clockLabel(event: EventRecord): string {
  if (!(event.firstSeen > 0)) return "시각 미상"
  return event.lastSeen > event.firstSeen ? `${clock.format(event.firstSeen)} ~ ${clock.format(event.lastSeen)}` : clock.format(event.firstSeen)
}

const evidencePageLimit = 200

function Retention({ label, value }: { label: string; value: PayloadRetentionMetadata | null }) {
  return <p className="break-all text-xs text-muted-foreground">{label}: {value ? `${value.retained ? "보존" : "미보존"} · ${value.retention} · ${value.bytes} bytes · SHA-256 ${value.digest}` : "보존 메타데이터 없음"}</p>
}

/** 검토 필요 트래픽의 결정. 트래픽 재정의는 서버에서 API(작업) 단위로 저장되므로 같은 API의 요청 모두에 적용된다. */
function ReviewDecision({ event, disabled }: { event: EventRecord; disabled: boolean }) {
  const decide = useTrafficOverrideMutation()
  const reason = event.classificationReasons.map(trafficReasonLabel).join(" · ") || "API인지 판단할 근거가 부족함"
  return <section aria-label="검토 결정" className="m-4 mb-0 grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
    <p className="font-semibold">메인 비교에 넣을까요?</p>
    <p className="text-xs text-muted-foreground">{reason}. 권한 비교에 의미 있는 API면 포함하고, 아니면 제외하세요. 같은 API({event.method} {event.path.split("?")[0]})의 요청 모두에 적용됩니다.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={disabled || decide.isPending} onClick={() => decide.mutate({ operation: event.op, value: "INCLUDE" })}>메인 비교에 포함</Button>
      <Button size="sm" variant="outline" disabled={disabled || decide.isPending} onClick={() => decide.mutate({ operation: event.op, value: "EXCLUDE" })}>제외</Button>
    </div>
    {decide.isError && <p role="alert" className="text-xs text-destructive">{decide.error instanceof Error ? decide.error.message : "저장하지 못했습니다."}</p>}
  </section>
}

export function EvidencePage() {
  const snapshot = useSnapshotQuery()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<EvidenceTab>(initialTab)
  const [filters, setFilters] = useState(() => ({ ...defaultEvidenceFilters(), dispositions: tabDispositions(initialTab()) }))
  const [selected, setSelected] = useState<EventRecord | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const selectedEvent = selected ? snapshot.data?.events.find((item) => item.eventId === selected.eventId) ?? null : null
  const datasetRevision = snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0
  const evidence = useEvidenceQuery(selectedEvent?.op ?? null, offset, evidencePageLimit, datasetRevision)

  // 같은 화면 안에서 #evidence ↔ #evidence-review로 주소만 바뀌면 화면이 다시 만들어지지 않으므로 탭을 직접 맞춘다.
  useEffect(() => {
    const syncTab = () => selectTab(initialTab())
    window.addEventListener("hashchange", syncTab)
    return () => window.removeEventListener("hashchange", syncTab)
  }, [])

  useEffect(() => {
    if (selected && !selectedEvent && !snapshot.isError) { setSelected(null); setInspectorOpen(false) }
  }, [selected, selectedEvent, snapshot.isError])

  const rows = useMemo(() => visibleEvidence(snapshot.data?.events ?? [], filters), [snapshot.data?.events, filters])
  const counts = useMemo(() => dispositionCounts(snapshot.data?.events ?? []), [snapshot.data?.events])
  // 탭(판정)으로 나뉜 것은 숨김이 아니다. 지금 탭 안에서 소스·분류·검색 필터로 가린 것만 센다.
  const tabEvents = (snapshot.data?.events ?? []).filter((event) => filters.dispositions[event.trafficDisposition as keyof typeof filters.dispositions])
  const hidden = hiddenEvidenceCount(tabEvents, filters)
  // 탭 숫자는 요청 수다. 반복 요청을 한 줄로 묶으면 행 수가 줄어드니 그 차이를 함께 알린다.
  const folded = tabEvents.length - hidden - rows.length
  function selectTab(next: EvidenceTab) {
    // 검토 탭 별칭 주소에 머문 채 다른 탭을 보면 새로고침·뒤로가기가 엉뚱한 탭을 연다.
    if (window.location.hash === "#evidence-review" && next !== "REVIEW") window.history.replaceState(null, "", "#evidence")
    setTab(next)
    setFilters((current) => ({ ...current, dispositions: tabDispositions(next) }))
  }
  function selectEvent(event: EventRecord) {
    if (snapshot.isError) return
    void queryClient.cancelQueries({ queryKey: ["evidence"] })
    queryClient.removeQueries({ queryKey: ["evidence"] })
    setSelected(event)
    setInspectorOpen(true)
    const matching = (snapshot.data?.events ?? []).filter((item) => item.op === event.op)
    const index = matching.findIndex((item) => item.eventId === event.eventId)
    setOffset(Math.min(20_000, Math.floor(Math.max(0, index) / evidencePageLimit) * evidencePageLimit))
  }

  const page = evidence.data
  const records = selectedEvent && <section aria-label="작업 관측 기록 페이지" className="grid min-w-0 gap-3 border-t p-4">
    <h2 className="text-sm font-semibold">요청 · 응답 <span className="font-normal text-muted-foreground">마스킹됨 · 같은 API {page?.total ?? "…"}건</span></h2>
    {evidence.isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
    {evidence.isError && <p role="alert" className="text-sm text-destructive">{evidence.error.message}</p>}
    {page && page.records.length === 0 && <p className="text-sm text-muted-foreground">이 페이지에 관측 기록이 없습니다.</p>}
    {page?.records.slice().sort((a, b) => Number(b.eventId === selectedEvent.eventId) - Number(a.eventId === selectedEvent.eventId)).map((record) => <details key={`${datasetRevision}:${page.offset}:${record.eventId}`} open={record.eventId === selectedEvent.eventId} className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer break-all font-mono text-sm">{boundedText(evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, record.eventId), 160)}</summary>
      <div className="mt-3 grid min-w-0 gap-2">
        <p className="break-words text-xs text-muted-foreground">{record.classificationReasons.map(trafficReasonLabel).join(" · ")}</p>
        <h3 className="text-xs font-medium">Request</h3>
        <Retention label="보존" value={record.requestPayload} />
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-xs">{record.request || record.requestBody || "요청 전문 없음"}</pre>
        <h3 className="text-xs font-medium">Response</h3>
        <Retention label="보존" value={record.responsePayload} />
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-xs">{record.response || record.responseBody || "응답 전문 없음"}</pre>
      </div>
    </details>)}
    {page && (page.offset > 0 || page.hasMore) && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">총 {page.total}건 · {page.offset + 1}번째부터</span><Button variant="outline" size="sm" aria-label="이전 관측 기록 페이지" disabled={page.offset <= 0 || evidence.isFetching || snapshot.isError} onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>이전</Button><Button variant="outline" size="sm" aria-label="다음 관측 기록 페이지" disabled={!page.hasMore || evidence.isFetching || snapshot.isError} onClick={() => setOffset(page.offset + page.limit)}>다음</Button></div>}
  </section>
  const inspector = <div className="grid min-w-0">
    {selectedEvent?.trafficDisposition === "REVIEW" && <ReviewDecision key={selectedEvent.eventId} event={selectedEvent} disabled={snapshot.isError} />}
    <EvidenceSheet inline compactPolicy detailContent={records} event={selectedEvent} snapshot={snapshot.data} disabled={snapshot.isError} onOpenChange={() => undefined} />
  </div>
  return (
    <ReferenceAnalysisWorkspace ariaLabel="관측 기록 분석 영역" context={null} inspector={inspector} inspectorDefaultWidth={420} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelected(null) }}>
      <section className="grid gap-3 p-4" aria-labelledby="evidence-title">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 id="evidence-title" className="text-xl font-semibold">관측 기록</h1><ImportXmlDialog importFile={importXml} afterImport={() => queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })} /></div>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>관측 기록을 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
      <div role="tablist" aria-label="관측 기록 판정" className="flex gap-5 border-b">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} aria-label={`${label} ${counts[key]}`} onClick={() => selectTab(key)}
        className={cn("-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm", tab === key ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
        {label}<span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", key === "REVIEW" && counts.REVIEW > 0 ? "border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{counts[key]}</span>
      </button>)}</div>
      <EvidenceFilters value={filters} onChange={setFilters} />
      {snapshot.isLoading ? <Skeleton className="h-64" /> : snapshot.data && <>
        {(hidden > 0 || folded > 0) && <p className="text-xs text-muted-foreground">{[hidden > 0 && `필터로 가린 ${hidden}건`, folded > 0 && `반복 요청 ${folded}건은 한 줄로 묶음`].filter(Boolean).join(" · ")}</p>}
        <ScrollArea className="h-[32rem] rounded-md border" aria-label="관측 기록 표">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>소스</TableHead><TableHead className="text-center">Method</TableHead><TableHead>API</TableHead><TableHead>HTTP</TableHead><TableHead>계정</TableHead><TableHead>분류</TableHead><TableHead>반복</TableHead><TableHead>관측 시각</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((event) => {
                const review = event.trafficDisposition === "REVIEW"
                return <TableRow key={event.eventId} data-state={selected?.eventId === event.eventId ? "selected" : undefined} className={cn(!snapshot.isError && "cursor-pointer")} onClick={() => selectEvent(event)}>
                  <TableCell className="font-mono text-muted-foreground">{evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId)}</TableCell>
                  <TableCell><Badge variant="outline" className={sourceTone[event.source]}>{sourceLabel(event.source)}</Badge></TableCell>
                  <TableCell className="text-center"><MethodBadge method={event.method} /></TableCell>
                  <TableCell className="max-w-96 whitespace-normal"><button type="button" disabled={snapshot.isError} aria-label={`${event.method} ${boundedText(event.path, 120)} 상세 보기`} className="text-left font-mono text-sm hover:underline disabled:cursor-not-allowed" onClick={(click) => { click.stopPropagation(); selectEvent(event) }}>{boundedText(event.path, 120)}</button></TableCell>
                  <TableCell><HttpStatusBadge status={event.status} /></TableCell>
                  <TableCell className="text-sm">{boundedText(snapshot.data?.accounts.find((account) => account.id === (event.laneAccountId?.trim() || event.idn))?.label ?? (event.laneAccountId?.trim() || event.idn), 48)}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-sm">{review
                    ? <><span className="mr-1.5 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">검토 필요</span><span className="text-muted-foreground">{event.classificationReasons.map(trafficReasonLabel).join(" · ")}</span></>
                    : trafficClassLabel(event.trafficClass)}</TableCell>
                  <TableCell className="tabular-nums">{event.repeatCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title={observedTimeLabel(event.firstSeen, event.lastSeen)}>{clockLabel(event)}</TableCell>
                </TableRow>
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={9} className="whitespace-normal py-8 text-center text-muted-foreground">{tab === "REVIEW" ? "검토할 트래픽이 없습니다." : "현재 필터에 맞는 관측 기록이 없습니다."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </ScrollArea>
      </>}
      {selectedEvent && <div className="sr-only" aria-live="polite">선택한 관측 기록 상세를 {evidence.isLoading ? "불러오는 중" : evidence.isError ? "불러오지 못했습니다" : "표시합니다"}.</div>}
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
