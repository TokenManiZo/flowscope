import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { EvidenceSheet } from "@/components/layout/EvidenceSheet"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { EventRecord, Snapshot, SurfaceEndpoint } from "@/lib/api/types"
import { EvidenceIdsPreview, ParameterCoverageMatrix } from "./ParameterCoverageMatrix"
import { evidenceParameterContext, ParameterRequestDiff, type EvidenceParameterContext } from "./ParameterRequestDiff"
import { locationLabel, resourceLabel } from "./parameterNodeCard"
import { PARAMETER_EVIDENCE_PREVIEW_LIMIT, type ParameterGraphProjection, type ProjectedValidationCell } from "./parameterProjection"

const reasonLabels: Record<string, string> = {
  CONFIRMED_AUTH_BOUNDARY: "확인된 권한 경계", AUTH_VARIANT_UNTESTED: "권한 변형 미검증", WRITE_METHOD: "쓰기 메서드",
  CORROBORATED_EVIDENCE: "복수 근거 일치", SOURCE_DISCREPANCY: "주체별 관측 차이", HUMAN_REVIEW_REQUIRED: "사람 확인 필요",
}
const declarationTypeLabels: Record<string, string> = {
  OPENAPI: "OpenAPI 명세", JAVASCRIPT_LITERAL: "정적 JavaScript", HTML_FORM: "HTML 폼", LLM_ARTIFACT_ANALYSIS: "Explorer 산출물 분석", XML_ROUTE: "XML 라우트",
}
interface Props { snapshot: Snapshot; projection: ParameterGraphProjection; onClose(): void }

/** 선택 Gap 상세. 데이터셋 교체(datasetRevision)나 다른 Gap 선택은 열린 초안·선택 셀을 버린다(D-140). */
export function ParameterGapInspector(props: Props) {
  const datasetRevision = props.snapshot.datasetRevision ?? props.snapshot.identityRevision ?? 0
  return <InspectorBody key={JSON.stringify([datasetRevision, props.projection.selection?.gapId, props.projection.parameterKey?.stableKey])} {...props} />
}

function InspectorBody({ snapshot, projection, onClose }: Props) {
  const gap = projection.queue.find(item => item.id === projection.selection?.gapId)
  const key = projection.parameterKey
  const parameter = projection.parameter
  const datasetRevision = snapshot.datasetRevision ?? snapshot.identityRevision ?? 0
  const [tab, setTab] = useState("core")
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [labOpen, setLabOpen] = useState(false)
  const cells = projection.validationCells
  const cell = cells.find(item => item.id === selectedCell)
  const actualIds = new Set([...(parameter?.observationEvidenceIds ?? []), ...cells.flatMap(item => item.evidenceIds)])
  const basisIds = new Set([...cells.flatMap(item => item.basisEvidenceIds), ...(parameter?.declarations.map(item => item.evidenceId) ?? [])])
  // Basis-only links do not become executable witnesses merely because an EventRecord shares their ID.
  const ids = [...new Set([...actualIds, ...(gap?.evidenceIds ?? []).filter(id => !basisIds.has(id))])]
  const linkedIds = new Set(ids)
  const eventById = new Map<string, EventRecord>()
  for (const event of snapshot.events) {
    if (linkedIds.has(event.eventId) && event.op === key?.operation && event.method === key?.method && !eventById.has(event.eventId)) eventById.set(event.eventId, event)
  }
  const events = [...eventById.values()]
  const representative = (cell ? events.find(event => cell.evidenceIds.includes(event.eventId)) : events[0]) ?? null
  const detailEvent = events.find(event => event.eventId === detailId) ?? null
  const representativeId = representative?.eventId ?? null
  useEffect(() => { setLabOpen(false) }, [representativeId, datasetRevision])
  useEffect(() => { if (selectedCell && !cell) { setSelectedCell(null); setDetailId(null); setLabOpen(false) } }, [selectedCell, cell])
  useEffect(() => { if (detailId && !detailEvent) setDetailId(null) }, [detailId, detailEvent])
  if (!gap || !projection.selection || !key) return null
  const profile = parameter?.profile
  const targets = parameter?.authorizationTargets ?? []
  function selectCell(next: ProjectedValidationCell) { setSelectedCell(next.id); setDetailId(null); setLabOpen(false); setTab("evidence") }
  const counts = (record: Readonly<Record<string, number>> | undefined) => Object.entries(record ?? {}).map(([name, count]) => `${name} × ${count}`).join(" · ") || "없음"
  return <section aria-label="Parameter Gap 상세" data-gap-id={gap.id} className="min-w-0 space-y-4 p-4 text-sm [overflow-wrap:anywhere]">
    <p className="leading-6">왜 집중해야 하나요? {gap.summary}</p>
    <header className="flex items-center justify-between gap-2"><h2 className="font-semibold">선택한 입력 지점</h2><Button variant="ghost" size="icon-sm" aria-label="선택 상세 닫기" onClick={onClose}><X /></Button></header>
    <p>{key.service}<br />{key.method} {key.pathTemplate}<br />{locationLabel(key.location)} {parameter?.fieldPath ?? key.canonicalPath}</p>
    <p className="break-all font-mono text-xs text-muted-foreground">Canonical key: {key.location} {key.canonicalPath}<br />{gap.status} · {gap.type}</p>
    <p>Gap 주체: {gap.identity ?? "UNKNOWN"} / {gap.role ?? "UNKNOWN"} / {gap.source ?? "UNKNOWN"}</p>
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      <TabsList className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto [&_[data-slot=tabs-trigger]]:h-9" aria-label="선택 입력 상세 탭"><TabsTrigger value="core">핵심 근거</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger><TabsTrigger value="diff">요청 비교</TabsTrigger><TabsTrigger value="definitions">정의 근거</TabsTrigger></TabsList>
      <TabsContent value="core" className="min-w-0 space-y-4">
        <ol aria-label="서버 우선순위 근거" className="list-inside list-decimal space-y-2">{gap.priorityReasons.map((reason, index) => <li key={`${index}:${reason}`}>{reasonLabels[reason] ?? reason}</li>)}</ol>
        <section aria-label="입력과 권한 대상"><h3 className="font-semibold">입력 → 권한 대상</h3>{targets.length ? targets.slice(0, 20).map(target => <div key={target.resource ?? "unknown"} className="my-2 space-y-1"><p>{target.resource ? resourceLabel(target.resource, key.service) : "UNKNOWN"} · {target.confidence}</p><p>{target.basis}</p><EvidenceIdsPreview label="연결 근거" ids={target.evidenceIds} count={target.evidenceCount} /></div>) : <p>UNKNOWN · 연결 근거 없음</p>}<p className="text-xs text-muted-foreground">UNKNOWN은 근거 부족, INFERRED는 추론입니다. 정의와 연결 근거를 확인하세요. 입력 존재는 서버 사용이나 접근 허용의 증거가 아닙니다.</p></section>
        <section aria-label="관측 프로파일" className="space-y-1"><h3 className="font-semibold">discovery 관측 프로파일</h3>{profile ? <><p>관측 {profile.observationCount}건 · 관측된 문맥에서의 부재 {profile.absentObservedContextCount}건{profile.typeConflict ? " · 타입 충돌" : ""}</p><p>source: {counts(profile.sourceCounts)}</p><p>신원: {counts(profile.identityCounts)}</p><p>역할: {counts(profile.roleCounts)}</p></> : <p>프로파일 없음 · UNKNOWN</p>}<p className="text-xs text-muted-foreground">VALIDATION·probe 요청과 잘린 요청은 분모가 아닙니다. 부재는 완전한 비교 요청에서만 셉니다.</p></section>
        <EvidenceIdsPreview label="Gap 근거" ids={projection.selection.evidenceIds} count={projection.selection.evidenceCount} />
        <p className="text-xs text-muted-foreground">Gap 근거와 좌표 근거는 실행 요청 수가 아닙니다.</p>
        <Collapsible open={coverageOpen} onOpenChange={setCoverageOpen} className="space-y-3">
          <CollapsibleTrigger asChild><Button variant="outline" className="h-auto w-full flex-col items-start whitespace-normal py-2 text-left">
            <span>검증표 {coverageOpen ? "접기" : "펼치기"}</span>
            <span className="text-xs text-muted-foreground">서버 좌표 {cells.length}개 · 미검증 {cells.filter(item => item.applicable && item.verdict === "UNTESTED").length}개 · 적용 불가 {cells.filter(item => !item.applicable).length}개</span>
          </Button></CollapsibleTrigger>
          <CollapsibleContent><ParameterCoverageMatrix cells={cells} onSelect={selectCell} /></CollapsibleContent>
        </Collapsible>
      </TabsContent>
      <TabsContent value="evidence" className="space-y-3">
        {cell && <><p>선택 좌표: {cell.identity ?? "UNKNOWN"} / {cell.role ?? "UNKNOWN"} / {cell.subjectClass}</p><EvidenceIdsPreview label="선택 셀 실행 Evidence" ids={cell.evidenceIds} count={cell.evidenceCount} /><EvidenceIdsPreview label="선택 셀 근거 · 미실행 포함" ids={cell.basisEvidenceIds} count={cell.basisEvidenceCount} /></>}
        <EvidenceIdsPreview label="Gap witnesses · 실행 여부 별도" ids={projection.selection.evidenceIds} count={projection.selection.evidenceCount} />
        {parameter && <EvidenceIdsPreview label="파라미터 관측" ids={parameter.observationEvidenceIds} count={parameter.observationEvidenceIds.length} />}
        <p className="text-xs text-muted-foreground">ID는 최대 {PARAMETER_EVIDENCE_PREVIEW_LIMIT}개 미리보기이며 전체 건수와 다릅니다. 근거 ID가 실제 요청이라는 뜻은 아닙니다. 선택 입력의 정확한 operation/key에 연결된 실제 Evidence만 열 수 있습니다. 파라미터 관측과 Gap witness는 선택 셀의 실행 근거가 아닐 수 있습니다.</p>
        <LinkedEvidenceList key={JSON.stringify([cell?.id, ids, [...eventById.keys()]])} events={events} selectedIds={cell?.evidenceIds ?? []} gapIds={gap.evidenceIds} profileIds={parameter?.observationEvidenceIds ?? []} onOpen={setDetailId} />
      </TabsContent>
      <TabsContent value="diff" className="min-w-0">{projection.endpoint ? <EvidenceComparison key={gap.id} endpoint={projection.endpoint} events={events} /> : <p>연결된 endpoint 사실이 없어 요청을 비교할 수 없습니다.</p>}</TabsContent>
      <TabsContent value="definitions" className="space-y-3">
        {!projection.definitions.length && <p>정의 근거 없음 · UNKNOWN</p>}
        {projection.definitions.map((declaration, index) => <section key={`${declaration.evidenceId}:${index}`} className="space-y-2 border-b py-3"><p>{declarationTypeLabels[declaration.type] ?? declaration.type} · {declaration.adapter} · {declaration.confidence ?? "INFERRED"}</p><p>{declaration.declaredShape ?? "UNKNOWN"} / {declaration.declaredType ?? "UNKNOWN"}{declaration.coordinateResolved === false ? " · 좌표 미확정" : ""}</p><p>{declaration.conditionText || "조건 정의 없음"}</p><p className="text-xs text-muted-foreground">{declaration.reason}</p><EvidenceIdsPreview label="정의 근거" ids={[declaration.evidenceId]} count={1} /><p className="text-xs text-muted-foreground">정의는 실제 요청 관측이나 서버 사용의 증명이 아닙니다.</p></section>)}
      </TabsContent>
    </Tabs>
    <Button disabled={!representative} onClick={() => setLabOpen(true)}>Request Lab 열기</Button>
    <p className="text-xs text-muted-foreground">{representative ? `대표 실제 Evidence: ${representative.eventId}. 원문 요청·응답은 Request Lab에서 함께 확인합니다. 자동 전송하지 않습니다.` : "대표 실제 EventRecord가 없어 Request Lab을 열 수 없습니다."}</p>
    {detailEvent && <EvidenceSheet event={detailEvent} snapshot={snapshot} onOpenChange={open => { if (!open) setDetailId(null) }} />}
    {representative && <RequestLabDialog key={`${representative.eventId}:${datasetRevision}`} open={labOpen} onOpenChange={setLabOpen} event={representative} sessions={snapshot.managedSessions} datasetRevision={datasetRevision} />}
  </section>
}

const selectClass = "min-h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs"

/** 선택 입력에 연결된 실제 Evidence 둘을 Surface 관측 metadata로 비교한다(값·원문 없음, 미실행 basis는 요청이 아니다). */
function EvidenceComparison({ endpoint, events }: { endpoint: SurfaceEndpoint; events: readonly EventRecord[] }) {
  const [leftId, setLeftId] = useState("")
  const [rightId, setRightId] = useState("")
  const contextFor = (id: string): EvidenceParameterContext | null => {
    const event = events.find(item => item.eventId === id)
    return event ? evidenceParameterContext(endpoint, event.eventId, { identity: event.idn, role: event.role, source: event.source.toUpperCase(), status: event.status, verdict: event.verdict.toUpperCase() }) : null
  }
  const left = contextFor(leftId), right = contextFor(rightId)
  return <section className="min-w-0 space-y-3" aria-label="비교 Evidence 선택">
    <p className="text-xs text-muted-foreground">선택 입력의 정확한 operation에 연결된 실제 요청만 고를 수 있으며, 미실행 좌표 근거를 요청으로 만들지 않습니다. 현재 snapshot에 연결된 실제 EventRecord {events.length}건.</p>
    <div className="grid gap-3">{(["기준 요청", "비교 요청"] as const).map((label, i) => <label key={label} className="grid gap-1"><span>{label}</span><select className={selectClass} aria-label={label} value={i === 0 ? leftId : rightId} onChange={event => (i === 0 ? setLeftId : setRightId)(event.target.value)}><option value="">실제 Evidence 선택</option>{events.map(event => <option key={event.eventId} value={event.eventId}>{event.eventId} · {event.idn} / {event.role} / {event.source.toUpperCase()} / HTTP {event.status}</option>)}</select></label>)}</div>
    {left && right ? <ParameterRequestDiff left={left} right={right} /> : <p>기준 요청과 비교 요청을 각각 선택하세요. 구조화 metadata가 없으면 UNKNOWN으로 남습니다.</p>}
  </section>
}

function LinkedEvidenceList({ events, selectedIds, gapIds, profileIds, onOpen }: { events: readonly EventRecord[]; selectedIds: readonly string[]; gapIds: readonly string[]; profileIds: readonly string[]; onOpen(id: string): void }) {
  const [page, setPage] = useState(0)
  const selected = new Set(selectedIds)
  const gap = new Set(gapIds)
  const profile = new Set(profileIds)
  const priority = (id: string) => selected.has(id) ? 0 : gap.has(id) ? 1 : profile.has(id) ? 2 : 3
  const ordered = [...events].sort((a, b) => priority(a.eventId) - priority(b.eventId) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))
  const pages = Math.max(1, Math.ceil(ordered.length / PARAMETER_EVIDENCE_PREVIEW_LIMIT))
  const visible = ordered.slice(page * PARAMETER_EVIDENCE_PREVIEW_LIMIT, (page + 1) * PARAMETER_EVIDENCE_PREVIEW_LIMIT)
  return <section aria-label="연결된 실제 Evidence 탐색" className="space-y-2">
    <p role="status">현재 snapshot에 연결된 실제 EventRecord {ordered.length}건 · 페이지 {page + 1}/{pages} · 최대 {PARAMETER_EVIDENCE_PREVIEW_LIMIT}건씩 탐색</p>
    <ul className="space-y-2">{visible.map(event => <li key={event.eventId} className="space-y-1">
      <p className="text-xs text-muted-foreground">{selected.has(event.eventId) ? "선택 셀 실제 Evidence" : [gap.has(event.eventId) && "Gap witness · 선택 셀의 실행 근거 아님", profile.has(event.eventId) && "파라미터 관측 · 선택 셀의 실행 근거 아님", !gap.has(event.eventId) && !profile.has(event.eventId) && "다른 검증 셀 실제 Evidence · 선택 셀의 실행 근거 아님"].filter(Boolean).join(" / ")}</p>
      <Button variant="outline" size="sm" className="h-auto max-w-full whitespace-normal" onClick={() => onOpen(event.eventId)}>Evidence 상세 {event.eventId}</Button>
    </li>)}</ul>
    {!ordered.length && <p>연결된 실제 EventRecord 없음 · 상세 열기 불가</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>이전 연결 Evidence 페이지</Button><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>다음 연결 Evidence 페이지</Button></div>
  </section>
}
