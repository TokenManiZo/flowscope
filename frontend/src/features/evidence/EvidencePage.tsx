import { identityLabel } from "@/lib/display/identityLabel"
import { ArrowUpRight, Eye, EyeOff, Check, RotateCcw } from "lucide-react"
import { DeleteTrafficButton } from "@/features/api-management/ApiActions"
import { Checkbox } from "@/components/ui/checkbox"
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
import { openSurfaceSelection, takePageSelection } from "./evidenceNavigation"
import { EvidenceHttpViewer } from "./EvidenceHttpViewer"
import { EvidenceFilters } from "./EvidenceFilters"
import { ImportXmlDialog } from "./ImportXmlDialog"
import { boundedText, defaultEvidenceFilters, dispositionCounts, hiddenEvidenceCount, tabDispositions, visibleEvidence, repeatEvidenceIds, type EvidenceTab } from "./evidenceSelectors"

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
  const trafficDecision = useTrafficOverrideMutation()
  const queryClient = useQueryClient()
  const [checkedRecords, setCheckedRecords] = useState<string[]>([])
  const [tab, setTab] = useState<EvidenceTab>(initialTab)
  const [filters, setFilters] = useState(() => ({ ...defaultEvidenceFilters(), dispositions: tabDispositions(initialTab()) }))
  const [selected, setSelected] = useState<EventRecord | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const selectedEvent = selected ? snapshot.data?.events.find((item) => item.eventId === selected.eventId) ?? null : null
  const datasetRevision = snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0
  useEffect(() => setCheckedRecords([]), [datasetRevision])
  const evidence = useEvidenceQuery(selectedEvent?.op ?? null, offset, evidencePageLimit, datasetRevision)

  useEffect(() => {
    if (!snapshot.data || snapshot.isError) return
    const selection = takePageSelection("evidence", datasetRevision)
    if (!selection?.evidenceId) return
    const event = snapshot.data.events.find(item => item.eventId === selection.evidenceId)
    if (!event) return
    setTab("ALL"); setFilters({ ...defaultEvidenceFilters(), dispositions: tabDispositions("ALL"), expandRepeats: true })
    selectEvent(event)
  }, [snapshot.data, snapshot.isError, datasetRevision])

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
  const expandedRows = useMemo(() => visibleEvidence(snapshot.data?.events ?? [], { ...filters, expandRepeats: true }), [snapshot.data?.events, filters])
  const repeatIds = useMemo(() => repeatEvidenceIds(expandedRows), [expandedRows])
  const visibleIds = useMemo(() => new Set(expandedRows.map(event => event.eventId)), [expandedRows])
  const checkedIds = useMemo(() => new Set(checkedRecords), [checkedRecords])
  const rowIds = (event: EventRecord) => filters.expandRepeats ? [event.eventId] : repeatIds.get(event.clusterId) ?? []

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

  useEffect(() => {
    if (!inspectorOpen) return
    const dismissOnBlankSpace = (event: PointerEvent) => {
      // 열린 대화상자의 바깥 클릭은 해당 대화상자가 처리한다(편집 초안 보호).
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-evidence-inspector], [role="dialog"], [role="menu"], [role="listbox"], [role="separator"], button, a, input, select, textarea, label, summary, tr')) return
      setInspectorOpen(false)
      setSelected(null)
    }
    document.addEventListener("pointerdown", dismissOnBlankSpace)
    return () => document.removeEventListener("pointerdown", dismissOnBlankSpace)
  }, [inspectorOpen])

  const page = evidence.data
  const records = selectedEvent && <section aria-label="작업 관측 기록 페이지" className="grid min-w-0 gap-3 border-t pt-4">
    <h2 className="text-sm font-semibold">요청 · 응답 <span className="ml-1 text-xs font-normal text-muted-foreground">마스킹됨{page ? ` · 같은 API ${page.total}건` : ""}</span></h2>
    {!selectedEvent.op && <p className="text-xs text-muted-foreground">선택 기록의 API 좌표가 없습니다.</p>}
    {selectedEvent.op && evidence.isLoading && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
    {evidence.isError && <div className="flex items-start justify-between gap-2"><p role="alert" className="min-w-0 break-words text-xs text-destructive">{evidence.error.message}</p><Button variant="outline" size="sm" disabled={evidence.isFetching} onClick={() => void evidence.refetch()}>다시 시도</Button></div>}
    {page && page.records.length === 0 && <p className="text-sm text-muted-foreground">이 페이지에 관측 기록이 없습니다.</p>}
    {page && page.records.length > 0 && <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">같은 API 관측 기록<select aria-label="같은 API 관측 기록" className="max-w-full rounded-md border bg-background px-2 py-1 text-foreground" value={selectedEvent.eventId} onChange={event => { const record = snapshot.data?.events.find(item => item.eventId === event.target.value); if (record) selectEvent(record) }}>{page.records.map(record => <option key={record.eventId} value={record.eventId} disabled={!snapshot.data?.events.some(item => item.eventId === record.eventId)}>{evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals,record.eventId)}</option>)}</select></label>}
    {page?.records.filter(record => record.eventId === selectedEvent.eventId).map(record => <div key={`${datasetRevision}:${record.eventId}`} className="grid min-w-0 gap-2">
      <EvidenceHttpViewer request={record.request || record.requestBody} response={record.response || record.responseBody} />
      <details className="border-t pt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">분류 · 보존 정보</summary><div className="mt-2 grid gap-2"><p className="break-words">{record.classificationReasons.map(trafficReasonLabel).join(" · ")}</p><Retention label="요청 보존" value={record.requestPayload} /><Retention label="응답 보존" value={record.responsePayload} /></div></details>
    </div>)}
    {page && page.records.length > 0 && !page.records.some(record => record.eventId === selectedEvent.eventId) && <p className="text-xs text-muted-foreground">선택 기록의 원문이 이 페이지에 없습니다. 관측 기록을 선택하거나 이전·다음 페이지를 확인하세요.</p>}
    {page && (page.offset > 0 || page.hasMore) && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">총 {page.total}건 · {page.offset + 1}번째부터</span><Button variant="outline" size="sm" aria-label="이전 관측 기록 페이지" disabled={page.offset <= 0 || evidence.isFetching || snapshot.isError} onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>이전</Button><Button variant="outline" size="sm" aria-label="다음 관측 기록 페이지" disabled={!page.hasMore || evidence.isFetching || snapshot.isError} onClick={() => setOffset(page.offset + page.limit)}>다음</Button></div>}
  </section>
  const inspector = <div data-evidence-inspector className="grid min-w-0">
    {selectedEvent && <section aria-label="관측 기록 분류 작업" className="grid gap-2 border-b p-4">
      <div className="flex flex-wrap items-center gap-3 [[role=dialog]_&]:pr-8">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-9" disabled={snapshot.isError || !selectedEvent.op || trafficDecision.isPending} onClick={() => trafficDecision.mutate({ operation: selectedEvent.op, value: selectedEvent.classificationReasons.includes("USER_REVIEW") ? "AUTO" : "REVIEW" })}>{selectedEvent.classificationReasons.includes("USER_REVIEW") ? <RotateCcw className="size-4" /> : <Check className="size-4" />}{selectedEvent.classificationReasons.includes("USER_REVIEW") ? "자동 분류로 복귀" : "검토 필요로 표시"}</Button>
          <Button size="sm" variant="outline" className="h-9" disabled={snapshot.isError || !selectedEvent.op || trafficDecision.isPending} onClick={() => trafficDecision.mutate({ operation: selectedEvent.op, value: selectedEvent.trafficDisposition === "EXCLUDE" ? "AUTO" : "EXCLUDE" })}>{selectedEvent.trafficDisposition === "EXCLUDE" ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{selectedEvent.trafficDisposition === "EXCLUDE" ? "숨김 해제" : "목록에서 숨기기"}</Button>
        </div>
        {snapshot.data && <div className="flex flex-wrap items-center gap-2 pl-1"><DeleteTrafficButton snapshot={snapshot.data} evidenceIds={[selectedEvent.eventId]} label="이 기록 삭제" className="h-9 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={snapshot.isError} />{rowIds(selectedEvent).length > 1 && <DeleteTrafficButton snapshot={snapshot.data} evidenceIds={rowIds(selectedEvent)} label={`반복 묶음 ${rowIds(selectedEvent).length}건 삭제`} className="h-9" disabled={snapshot.isError} />}</div>}
        <Button size="sm" variant="secondary" className="ml-auto h-9 shrink-0" disabled={snapshot.isError || !selectedEvent.op} onClick={() => openSurfaceSelection(selectedEvent.op, datasetRevision)}>API에서 보기<ArrowUpRight className="size-4" /></Button>
      </div>
      <p className="text-xs text-muted-foreground">분류와 숨김은 같은 API 전체에 적용됩니다. 삭제하면 선택 기록과 연결된 재현 기록을 지웁니다.</p>
      {trafficDecision.isError && <p role="alert" className="text-xs text-destructive">{trafficDecision.error instanceof Error ? trafficDecision.error.message : "분류를 저장하지 못했습니다."}</p>}
    </section>}
    {selectedEvent?.trafficDisposition === "REVIEW" && <ReviewDecision key={selectedEvent.eventId} event={selectedEvent} disabled={snapshot.isError} />}
    <EvidenceSheet showMetadata={false} inline compactPolicy detailContent={records} event={selectedEvent} snapshot={snapshot.data} disabled={snapshot.isError} onOpenChange={() => undefined} />
  </div>
  return (
    <ReferenceAnalysisWorkspace compactMediaQuery="(max-width: 767px)" ariaLabel="관측 기록 분석 영역" context={null} inspector={inspector} inspectorDefaultWidth={Math.max(600, Math.round(window.innerWidth / 2))} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelected(null) }}>
      <section className="grid min-w-0 gap-3 p-4" aria-labelledby="evidence-title">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 id="evidence-title" className="text-xl font-semibold">관측 기록</h1><ImportXmlDialog importFile={importXml} afterImport={() => queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })} /></div>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>관측 기록을 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
      <div role="tablist" aria-label="관측 기록 판정" className="flex gap-5 border-b">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} aria-label={`${label} ${counts[key]}`} onClick={() => selectTab(key)}
        className={cn("-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm", tab === key ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
        {label}<span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", key === "REVIEW" && counts.REVIEW > 0 ? "border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{counts[key]}</span>
      </button>)}</div>
      <EvidenceFilters value={filters} onChange={setFilters} />
      {snapshot.isLoading ? <Skeleton className="h-64" /> : snapshot.data && <>
        {(hidden > 0 || folded > 0) && <p className="text-xs text-muted-foreground">{[hidden > 0 && `필터로 가린 ${hidden}건`, folded > 0 && `반복 요청 ${folded}건은 한 줄로 묶음`].filter(Boolean).join(" · ")}</p>}
        {checkedRecords.length > 0 && <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2 text-xs"><span>관측 기록 {checkedRecords.length}건 선택</span><DeleteTrafficButton snapshot={snapshot.data} evidenceIds={checkedRecords} label="선택 기록 삭제" disabled={snapshot.isError} onDeleted={() => setCheckedRecords([])} /><Button variant="ghost" size="sm" onClick={() => setCheckedRecords([])}>선택 해제</Button></div>}
        <ScrollArea className="h-[calc(100dvh-20rem)] min-h-64 rounded-md border" aria-label="관측 기록 표">
          <Table className="min-w-[680px]">
            <TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="표시된 관측 기록 모두 선택" disabled={snapshot.isError || rows.length === 0} checked={rows.length > 0 && expandedRows.every(row => checkedIds.has(row.eventId))} onCheckedChange={checked => setCheckedRecords(current => checked ? [...new Set([...current, ...visibleIds])] : current.filter(id => !visibleIds.has(id)))} /></TableHead><TableHead>#</TableHead><TableHead>소스</TableHead><TableHead className="text-center">Method</TableHead><TableHead>API</TableHead><TableHead>HTTP</TableHead><TableHead>계정</TableHead><TableHead>분류</TableHead><TableHead>반복</TableHead><TableHead>관측 시각</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((event) => {
                const review = event.trafficDisposition === "REVIEW"
                return <TableRow key={event.eventId} data-state={selected?.eventId === event.eventId ? "selected" : undefined} className={cn(!snapshot.isError && "cursor-pointer")} onClick={() => selectEvent(event)}>
                  <TableCell onClick={click => click.stopPropagation()}><Checkbox aria-label={`${evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId)} 기록 선택`} checked={rowIds(event).every(id => checkedIds.has(id))} disabled={snapshot.isError} onCheckedChange={checked => setCheckedRecords(current => checked ? [...new Set([...current, ...rowIds(event)])] : current.filter(id => !rowIds(event).includes(id)))} /></TableCell>
                  <TableCell className="font-mono text-muted-foreground">{evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId)}</TableCell>
                  <TableCell><Badge variant="outline" className={sourceTone[event.source]}>{sourceLabel(event.source)}</Badge></TableCell>
                  <TableCell className="text-center"><MethodBadge method={event.method} /></TableCell>
                  <TableCell className="max-w-96 whitespace-normal"><button type="button" disabled={snapshot.isError} aria-label={`${event.method} ${boundedText(event.path, 120)} 상세 보기`} className="min-w-0 break-all text-left font-mono text-sm hover:underline disabled:cursor-not-allowed" onClick={(click) => { click.stopPropagation(); selectEvent(event) }}>{boundedText(event.path, 120)}</button></TableCell>
                  <TableCell><HttpStatusBadge status={event.status} /></TableCell>
                  <TableCell className="text-sm">{boundedText(identityLabel(snapshot.data?.accounts.find((account) => account.id === (event.laneAccountId?.trim() || event.idn))?.label ?? (event.laneAccountId?.trim() || event.idn)), 48)}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-sm">{review
                    ? <><span className="mr-1.5 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">검토 필요</span><span className="text-muted-foreground">{event.classificationReasons.map(trafficReasonLabel).join(" · ")}</span></>
                    : trafficClassLabel(event.trafficClass)}</TableCell>
                  <TableCell className="tabular-nums">{event.repeatCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title={observedTimeLabel(event.firstSeen, event.lastSeen)}>{clockLabel(event)}</TableCell>
                </TableRow>
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={10} className="whitespace-normal py-8 text-center text-muted-foreground">{tab === "REVIEW" ? "검토할 트래픽이 없습니다." : "현재 필터에 맞는 관측 기록이 없습니다."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </ScrollArea>
      </>}
      {selectedEvent && <div className="sr-only" aria-live="polite">선택한 관측 기록 상세를 {evidence.isLoading ? "불러오는 중" : evidence.isError ? "불러오지 못했습니다" : "표시합니다"}.</div>}
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
