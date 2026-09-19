import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { EvidenceSheet } from "@/components/layout/EvidenceSheet"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { EvidenceIdsPreview, ParameterCoverageMatrix } from "./ParameterCoverageMatrix"
import { ParameterRequestDiff } from "./ParameterRequestDiff"
import { getParameterEvidence, PARAMETER_EVIDENCE_PAGE_SIZE, type SafeParameterEvidence } from "./parameterEvidence"
import { locationLabel, resourceLabel } from "./parameterNodeCard"
import { PARAMETER_EVIDENCE_PREVIEW_LIMIT, validationCellId, type ParameterGraphProjection, type ParameterMapKey, type ProjectedValidationCell } from "./parameterProjection"

const reasonLabels: Record<string, string> = {
  CONFIRMED_AUTH_BOUNDARY: "확인된 권한 경계", AUTH_VARIANT_UNTESTED: "권한 변형 미검증", WRITE_METHOD: "쓰기 메서드",
  CORROBORATED_EVIDENCE: "복수 근거 일치", SOURCE_DISCREPANCY: "주체별 관측 차이", HUMAN_REVIEW_REQUIRED: "사람 확인 필요",
}
const declarationTypeLabels: Record<string, string> = {
  OPENAPI: "OpenAPI 명세", JAVASCRIPT_LITERAL: "정적 JavaScript", HTML_FORM: "HTML 폼", LLM_ARTIFACT_ANALYSIS: "Explorer 산출물 분석", XML_ROUTE: "XML 라우트",
}
interface Props { snapshot: Snapshot; projection: ParameterGraphProjection; suspended?: boolean; onClose(): void }

/** 선택 Gap 상세. 데이터셋 교체(datasetRevision)나 다른 Gap 선택은 열린 초안·선택 셀을 버린다(D-140). */
export function ParameterGapInspector(props: Props) {
  const datasetRevision = props.snapshot.datasetRevision ?? props.snapshot.identityRevision ?? 0
  return <InspectorBody key={JSON.stringify([datasetRevision, props.projection.selection?.gapId, props.projection.parameterKey?.stableKey])} {...props} />
}

function InspectorBody({ snapshot, projection, suspended = false, onClose }: Props) {
  const gap = projection.queue.find(item => item.id === projection.selection?.gapId)
  const key = projection.parameterKey
  const parameter = projection.parameter
  const [tab, setTab] = useState("core")
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  // Graph links are previews (PR#11): resolve only projection-approved cells at the exact key, but keep every
  // currently available snapshot witness so bounded client navigation can reach all of them.
  const approvedCells = new Set(projection.validationCells.map(item => item.id))
  const cells = (snapshot.surface?.validationCells ?? []).map(item => ({ ...item, id: validationCellId(item) })).filter(item => approvedCells.has(item.id))
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
  const detailEvent = events.find(event => event.eventId === detailId) ?? null
  useEffect(() => { if (selectedCell && !cell) { setSelectedCell(null); setDetailId(null) } }, [selectedCell, cell])
  useEffect(() => { if (detailId && !detailEvent) setDetailId(null) }, [detailId, detailEvent])
  if (!gap || !projection.selection || !key) return null
  const profile = parameter?.profile
  const targets = parameter?.authorizationTargets ?? []
  function selectCell(next: ProjectedValidationCell) { setSelectedCell(next.id); setDetailId(null); setTab("evidence") }
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
          <CollapsibleContent><ParameterCoverageMatrix cells={cells} onSelect={suspended ? undefined : selectCell} /></CollapsibleContent>
        </Collapsible>
      </TabsContent>
      <TabsContent value="evidence" className="space-y-3">
        {cell && <><p>선택 좌표: {cell.identity ?? "UNKNOWN"} / {cell.role ?? "UNKNOWN"} / {cell.subjectClass}</p><EvidenceIdsPreview label="선택 셀 실행 Evidence" ids={cell.evidenceIds} count={cell.evidenceCount} /><EvidenceIdsPreview label="선택 셀 근거 · 미실행 포함" ids={cell.basisEvidenceIds} count={cell.basisEvidenceCount} /></>}
        <EvidenceIdsPreview label="Gap witnesses · 실행 여부 별도" ids={projection.selection.evidenceIds} count={projection.selection.evidenceCount} />
        {parameter && <EvidenceIdsPreview label="파라미터 관측" ids={parameter.observationEvidenceIds} count={parameter.observationEvidenceIds.length} />}
        <p className="text-xs text-muted-foreground">ID는 최대 {PARAMETER_EVIDENCE_PREVIEW_LIMIT}개 미리보기이며 전체 건수와 다릅니다. 근거 ID가 실제 요청이라는 뜻은 아닙니다. 선택 입력의 정확한 operation/key에 연결된 실제 Evidence만 열 수 있습니다. 파라미터 관측과 Gap witness는 선택 셀의 실행 근거가 아닐 수 있습니다.</p>
        <LinkedEvidenceList key={JSON.stringify([cell?.id, ids, [...eventById.keys()]])} events={events} selectedIds={cell?.evidenceIds ?? []} gapIds={gap.evidenceIds} profileIds={parameter?.observationEvidenceIds ?? []} suspended={suspended} onOpen={setDetailId} />
      </TabsContent>
      <TabsContent value="diff" className="min-w-0"><EvidenceComparison key={JSON.stringify([gap.id, key.stableKey, gap.type, gap.status, gap.identity, gap.role, gap.source, gap.summary, gap.priorityReasons])} parameterKey={key} evidenceIds={ids} snapshot={snapshot} /></TabsContent>
      <TabsContent value="definitions" className="space-y-3">
        {!projection.definitions.length && <p>정의 근거 없음 · UNKNOWN</p>}
        {projection.definitions.map((declaration, index) => <section key={`${declaration.evidenceId}:${index}`} className="space-y-2 border-b py-3"><p>{declarationTypeLabels[declaration.type] ?? declaration.type} · {declaration.adapter} · {declaration.confidence ?? "INFERRED"}</p><p>{declaration.declaredShape ?? "UNKNOWN"} / {declaration.declaredType ?? "UNKNOWN"}{declaration.coordinateResolved === false ? " · 좌표 미확정" : ""}</p><p>{declaration.conditionText || "조건 정의 없음"}</p><p className="text-xs text-muted-foreground">{declaration.reason}</p><EvidenceIdsPreview label="정의 근거" ids={[declaration.evidenceId]} count={1} /><p className="text-xs text-muted-foreground">정의는 실제 요청 관측이나 서버 사용의 증명이 아닙니다.</p></section>)}
      </TabsContent>
    </Tabs>
    <p className="text-xs text-muted-foreground">트래픽을 보거나 수정·전송하려면 Evidence 목록에서 실제 요청을 선택하세요. 다른 대표 요청으로 자동 대체하지 않습니다.</p>
    {detailEvent && <EvidenceSheet inline event={detailEvent} snapshot={snapshot} disabled={suspended} onOpenChange={open => { if (!open) setDetailId(null) }} />}
  </section>
}

const selectClass = "min-h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs"

/**
 * PR#11 요청 비교: 선택 입력에 연결된 실제 Evidence 둘을 Evidence API의 안전 metadata(값 없음 · digest·길이·형태·완전성)로 비교한다.
 * 페이지는 20건씩이며 미실행 좌표 근거는 요청으로 만들지 않는다. 선택한 Evidence의 좌표가 바뀌면 선택을 버린다.
 */
function EvidenceComparison({ parameterKey, evidenceIds, snapshot }: { parameterKey: ParameterMapKey; evidenceIds: readonly string[]; snapshot: Snapshot }) {
  const [offset, setOffset] = useState(0)
  type Pick = { record: SafeParameterEvidence; identity: string }
  const [leftPick, setLeft] = useState<Pick | null>(null)
  const [rightPick, setRight] = useState<Pick | null>(null)
  const eventIdentity = (id: string) => {
    const event = snapshot.events.find(item => item.eventId === id && item.op === parameterKey.operation && item.method === parameterKey.method)
    return event && evidenceIds.includes(id) ? JSON.stringify([event.eventId, event.op, event.method, event.resource, event.idn, event.role, event.source, event.fp, event.authState, event.runId, event.phase, event.executionTrust, event.status, event.verdict]) : null
  }
  const left = leftPick && leftPick.identity === eventIdentity(leftPick.record.eventId) ? leftPick.record : null
  const right = rightPick && rightPick.identity === eventIdentity(rightPick.record.eventId) ? rightPick.record : null
  useEffect(() => {
    if ((leftPick && !left) || (rightPick && !right)) { setLeft(null); setRight(null); setOffset(0) }
  }, [leftPick, rightPick, left, right])
  const query = useQuery({ queryKey: ["parameter-evidence", parameterKey.service, parameterKey.method, parameterKey.operation, offset, snapshot.revision], queryFn: ({ signal }) => getParameterEvidence(parameterKey.operation, offset, signal), gcTime: 0, retry: false })
  const linked = query.data?.records.filter(record => record.service === parameterKey.service && record.method === parameterKey.method && record.operation === parameterKey.operation && evidenceIds.includes(record.eventId)) ?? []
  const withVerdict = (record: SafeParameterEvidence) => {
    const event: EventRecord | undefined = snapshot.events.find(item => item.eventId === record.eventId && item.op === record.operation && item.method === record.method)
    const identity = eventIdentity(record.eventId)
    return identity ? { record: { ...record, verdict: event?.verdict.toUpperCase() ?? "UNKNOWN" }, identity } : null
  }
  const current = (i: number) => i === 0 ? left : right
  return <section className="min-w-0 space-y-3" aria-label="비교 Evidence 선택">
    <p className="text-xs text-muted-foreground">한 페이지 최대 {PARAMETER_EVIDENCE_PAGE_SIZE}건입니다. 선택 입력의 정확한 operation에 연결된 실제 요청만 선택할 수 있으며, 미실행 좌표 근거를 요청으로 만들지 않습니다.</p>
    {query.isPending && <p role="status">안전한 요청 metadata 불러오는 중…</p>}
    {query.isError && <p role="alert">요청 metadata를 불러오지 못했습니다. <Button size="sm" onClick={() => void query.refetch()}>다시 시도</Button></p>}
    {query.data && <><p>operation Evidence 전체 {query.data.total}건 · 현재 페이지 {query.data.records.length}건 · 선택 입력 연결 {linked.length}건</p><div className="grid gap-3">{(["기준 요청", "비교 요청"] as const).map((label, i) => <label key={label} className="grid gap-1"><span>{label}</span><select className={selectClass} aria-label={label} value={current(i)?.eventId ?? ""} onChange={event => { const selected = linked.find(record => record.eventId === event.target.value); (i === 0 ? setLeft : setRight)(selected ? withVerdict(selected) : null) }}><option value="">실제 Evidence 선택</option>{current(i) && !linked.some(record => record.eventId === current(i)?.eventId) && <option value={current(i)!.eventId}>{current(i)!.eventId} · 이전 페이지</option>}{linked.map(record => <option key={record.eventId} value={record.eventId}>{record.eventId} · {record.identity} / {record.role} / {record.source}</option>)}</select></label>)}</div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PARAMETER_EVIDENCE_PAGE_SIZE))}>이전 Evidence 페이지</Button><Button variant="outline" size="sm" disabled={!query.data.hasMore} onClick={() => setOffset(value => value + PARAMETER_EVIDENCE_PAGE_SIZE)}>다음 Evidence 페이지</Button></div></>}
    {left && right ? <ParameterRequestDiff left={left} right={right} /> : <p>기준 요청과 비교 요청을 각각 선택하세요. 구조화 metadata가 없으면 UNKNOWN으로 남습니다.</p>}
  </section>
}

function LinkedEvidenceList({ events, selectedIds, gapIds, profileIds, suspended, onOpen }: { events: readonly EventRecord[]; selectedIds: readonly string[]; gapIds: readonly string[]; profileIds: readonly string[]; suspended: boolean; onOpen(id: string): void }) {
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
      <Button variant="outline" size="sm" className="h-auto max-w-full whitespace-normal" disabled={suspended} onClick={() => onOpen(event.eventId)}>Evidence 상세 {event.eventId}</Button>
    </li>)}</ul>
    {!ordered.length && <p>연결된 실제 EventRecord 없음 · 상세 열기 불가</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>이전 연결 Evidence 페이지</Button><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>다음 연결 Evidence 페이지</Button></div>
  </section>
}
