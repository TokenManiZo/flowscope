import { HttpStatusBadge, MethodBadge, SourceMarks } from "@/components/TrafficBadges"
import { useEffect, useMemo, useState } from "react"
import { ChartNoAxesColumn, ChevronRight, Filter } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { InspectorPanel } from "@/components/layout/InspectorPanel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { RunGapHint, runGapCount } from "@/components/RunGapHint"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { evidenceOrdinalLabel } from "@/lib/display/operationLabel"
import { OperationDetail } from "@/features/evidence/OperationDetail"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { SurfaceDeltaState, SurfaceEndpoint, SurfaceParameter, SurfaceSource } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"

type DeltaFilter = "ALL" | SurfaceDeltaState

const deltaLabels: Record<SurfaceDeltaState, string> = {
  DECLARED_NOT_OBSERVED: "산출물에서 발견 · 아직 요청 없음",
  UNRESOLVED_COORDINATE: "선언 좌표 미확정 · 관측 비교 제외",
  ONE_SOURCE_OBSERVED: "1개 출처 관측",
  MULTI_SOURCE_OBSERVED: "2개 출처 관측",
  ALL_SOURCES_OBSERVED: "3개 출처 관측",
  OBSERVED_NOT_DECLARED: "선언 근거 없음",
}

const kindLabels: Record<string, string> = {
  OBSERVED_API: "실제 API",
  ARTIFACT_API: "산출물 API 후보",
  NAVIGATION: "화면 이동",
  STATIC_ASSET: "정적 자산",
  DISCOVERY_DOCUMENT: "API 문서",
  FORM_ACTION: "폼 동작",
  UNVERIFIED: "분류 미확정",
}

const sourceOptions = [
  { value: "HUMAN" as const, label: "H · HUMAN" },
  { value: "SCANNER" as const, label: "S · ZAP" },
  { value: "LLM" as const, label: "L · LLM" },
]

function filteredDelta(declared: boolean, sources: readonly SurfaceSource[]): SurfaceDeltaState {
  const count = new Set(sources.filter((source) => source !== "UNKNOWN")).size
  if (count === 0) return declared ? "DECLARED_NOT_OBSERVED" : "OBSERVED_NOT_DECLARED"
  if (!declared) return "OBSERVED_NOT_DECLARED"
  if (count === 1) return "ONE_SOURCE_OBSERVED"
  if (count === 2) return "MULTI_SOURCE_OBSERVED"
  return "ALL_SOURCES_OBSERVED"
}

function filterParameter(parameter: SurfaceParameter, enabled: ReadonlySet<SurfaceSource>): SurfaceParameter | null {
  const observations = parameter.observations.filter((item) => enabled.has(item.source))
  const declarations = parameter.declarations.filter((item) => enabled.has(item.source))
  const observedSources = [...new Set(observations.map((item) => item.source))]
  if (observations.length === 0 && declarations.length === 0) return null
  return {
    ...parameter,
    observations,
    declarations,
    observedSources,
    observationEvidenceIds: observations.map((item) => item.evidenceId),
    observedShapes: [...new Set(observations.map((item) => item.shape).filter((value): value is string => Boolean(value)))],
    // 좌표 미확정은 source 필터로 재계산하지 않는다: 정상 미관측(DECLARED_NOT_OBSERVED)으로 오해되면 안 된다.
    deltaState: parameter.coordinateResolved === false ? "UNRESOLVED_COORDINATE" : filteredDelta(declarations.length > 0, observedSources),
  }
}

function filterEndpoint(endpoint: SurfaceEndpoint, enabled: ReadonlySet<SurfaceSource>): SurfaceEndpoint | null {
  const observations = endpoint.observations.filter((item) => enabled.has(item.source))
  const declarations = endpoint.declarations.filter((item) => enabled.has(item.source))
  const observedSources = [...new Set(observations.map((item) => item.source))]
  const parameters = endpoint.parameters
    .map((parameter) => filterParameter(parameter, enabled))
    .filter((parameter): parameter is SurfaceParameter => parameter !== null)
  if (observations.length === 0 && declarations.length === 0 && parameters.length === 0) return null
  return { ...endpoint, observations, declarations, observedSources, parameters, deltaState: filteredDelta(declarations.length > 0, observedSources) }
}

function endpointId(endpoint: SurfaceEndpoint): string {
  return [endpoint.key.service, endpoint.key.method, endpoint.key.pathTemplate].join("\u0000")
}

function sourceLabel(values: readonly string[]): string {
  return values.length
    ? values.map((value) => value === "SCANNER" ? "S" : value === "HUMAN" ? "H" : value === "LLM" ? "L" : "?").join(" · ")
    : "요청 없음"
}

function endpointKinds(endpoint: SurfaceEndpoint): string {
  return (endpoint.kinds ?? ["UNVERIFIED"]).map((value) => kindLabels[value] ?? value).join(" · ")
}

export function SurfacePage() {
  const snapshot = useSnapshotQuery()
  const [filter, setFilter] = useState<DeltaFilter>("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorRevealKey, setInspectorRevealKey] = useState(0)
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [requestLabContext, setRequestLabContext] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<SurfaceSource>>(() => new Set(["HUMAN", "SCANNER", "LLM"]))
  const surface = snapshot.data?.surface ?? { endpoints: [], extractions: [], probes: [] }
  const endpoints = useMemo(
    () => surface.endpoints.map((endpoint) => filterEndpoint(endpoint, enabledSources)).filter((endpoint): endpoint is SurfaceEndpoint => endpoint !== null),
    [enabledSources, surface.endpoints],
  )
  const rows = useMemo(() => endpoints.filter((endpoint) => filter === "ALL" || endpoint.deltaState === filter), [endpoints, filter])
  const selected = rows.find((endpoint) => endpointId(endpoint) === selectedId) ?? null
  const selectedEvent = selected && selectedEvidenceId && selected.observations.some((item) => item.evidenceId === selectedEvidenceId)
    ? snapshot.data?.events.find((event) => event.eventId === selectedEvidenceId) ?? null
    : null
  const datasetRevision = snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0
  // PR#11 boundary: dataset replacement (server datasetRevision, D-140) or any coordinate change of the selected Evidence closes the draft.
  const labContext = selectedEvent ? JSON.stringify([datasetRevision, selectedEvent.eventId, selectedEvent.op, selectedEvent.resource, selectedEvent.idn, selectedEvent.source, selectedEvent.fp]) : null
  const requestLabOpen = requestLabContext !== null && requestLabContext === labContext
  const setRequestLabOpen = (open: boolean) => setRequestLabContext(open ? labContext : null)
  useEffect(() => { setRequestLabContext(null) }, [labContext])
  const extractions = surface.extractions.filter((item) => enabledSources.has(item.source))
  const probes = surface.probes.filter((item) => enabledSources.has(item.source))
  const unresolvedExtractions = extractions.filter((item) => item.status !== "PARSED" || item.issues.length > 0)
  const countKind = (kind: string) => endpoints.filter((endpoint) => endpoint.kinds?.includes(kind as never)).length

  useEffect(() => {
    if (snapshot.isError) return
    if (selectedEvidenceId && !selectedEvent) {
      setSelectedEvidenceId(null)
      setRequestLabOpen(false)
    }
  }, [selectedEvent, selectedEvidenceId, snapshot.isError])

  function toggleSource(source: SurfaceSource, checked: boolean) {
    setEnabledSources((current) => {
      const next = new Set(current)
      if (checked) next.add(source)
      else next.delete(source)
      return next
    })
  }

  const filters = (
    <section className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label="API 비교 필터">
      <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 text-xs"><Filter className="size-3.5" />필터</Button></PopoverTrigger><PopoverContent align="start" className="grid w-72 gap-4 p-4" aria-label="API 비교 조건">
        <label className="grid gap-2 text-xs" htmlFor="surface-delta">비교 상태<Select value={filter} onValueChange={(value) => setFilter(value as DeltaFilter)}><SelectTrigger id="surface-delta" aria-label="API·입력 차이 상태"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">전체</SelectItem>{Object.entries(deltaLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <fieldset className="grid gap-3 text-xs">
        <legend className="sr-only">실제 요청 source</legend>
        {sourceOptions.map((source) => <label className="flex items-center gap-2" key={source.value}><Checkbox checked={enabledSources.has(source.value)} onCheckedChange={(checked) => toggleSource(source.value, checked === true)} />{source.label}</label>)}
      </fieldset>
      </PopoverContent></Popover>
      <span className="ml-auto text-xs text-muted-foreground">전체 {endpoints.length} · 입력 {endpoints.reduce((sum, endpoint) => sum + endpoint.parameters.length, 0)}</span>
      <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-8 text-xs"><ChartNoAxesColumn className="size-3.5" />집계</Button></PopoverTrigger><PopoverContent align="end" className="w-72 p-4" aria-label="API 집계">
        <h3 className="text-sm font-semibold">현재 필터 집계</h3><dl className="grid gap-2 text-xs">
        <div className="flex justify-between"><dt>전체 항목</dt><dd>{endpoints.length}</dd></div>
        <div className="flex justify-between"><dt>실제 API</dt><dd>{countKind("OBSERVED_API")}</dd></div>
        <div className="flex justify-between"><dt>산출물 API 후보</dt><dd>{countKind("ARTIFACT_API")}</dd></div>
        <div className="flex justify-between"><dt>화면 이동</dt><dd>{countKind("NAVIGATION")}</dd></div>
        <div className="flex justify-between"><dt>정적 자산</dt><dd>{countKind("STATIC_ASSET")}</dd></div>
        <div className="flex justify-between"><dt>입력 필드</dt><dd>{endpoints.reduce((sum, endpoint) => sum + endpoint.parameters.length, 0)}</dd></div>
        <div className="flex justify-between"><dt>OPTIONS probe</dt><dd>{probes.length}</dd></div>
        <div className="flex justify-between"><dt>부분·실패 파싱</dt><dd>{unresolvedExtractions.length}</dd></div>
      </dl><p className="border-t pt-2 text-xs text-muted-foreground">실제 API는 응답이 있는 API 요청만 셉니다.</p></PopoverContent></Popover>
    </section>
  )

  const inspector = selected ? (
    <InspectorPanel title="API 상세" tabs={null} description={<><span className="mt-2 flex items-start gap-2"><MethodBadge method={selected.key.method} /><span className="min-w-0 break-all font-mono text-sm text-foreground">{selected.key.pathTemplate}</span></span><span className="mt-1 block break-all text-xs">{selected.key.service}</span></>}>
      <div className="grid gap-5">
      <div className="flex items-center gap-3"><SourceMarks sources={selected.observedSources} /><dl className="grid min-w-0 flex-1 grid-cols-3 divide-x rounded-md border bg-muted/20">{[["관측", selected.observations.length], ["선언", selected.declarations.length], ["입력", selected.parameters.length]].map(([name, count]) => <div className="px-3 py-2" key={name}><dt className="text-[11px] text-muted-foreground">{name}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{count}</dd></div>)}</dl></div>
      <section className="border-t pt-3" aria-label="API 입력 필드 비교"><h3 className="mb-2 text-sm font-semibold">입력 필드 비교</h3>
        {selected.parameters.length > 0 ? <div className="overflow-x-auto rounded-md border"><Table className="table-fixed text-xs"><TableHeader><TableRow><TableHead className="w-2/5 text-xs">위치 / 필드</TableHead><TableHead className="text-xs">H S L</TableHead><TableHead className="text-xs">선언</TableHead><TableHead className="text-xs">형태</TableHead></TableRow></TableHeader><TableBody>{selected.parameters.map((parameter) => <TableRow key={parameter.location + ":" + (parameter.coordinateResolved ? "" : "?") + parameter.canonicalPath}>
          <TableCell className="whitespace-normal"><p className="break-all font-mono text-xs">{parameter.location} · {parameter.fieldPath}</p><p className="break-all font-mono text-[11px] text-muted-foreground">{parameter.canonicalPath}</p>{parameter.coordinateResolved === false && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{deltaLabels.UNRESOLVED_COORDINATE}</p>}<span className="text-[11px] text-muted-foreground">{parameter.requirement}</span></TableCell>
          <TableCell><SourceMarks sources={parameter.observedSources} /></TableCell><TableCell className="tabular-nums">{parameter.declarations.length}</TableCell><TableCell className="whitespace-normal text-xs">{parameter.observedShapes.join(" · ") || "—"}</TableCell>
        </TableRow>)}</TableBody></Table></div> : <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">확인된 입력 필드가 없습니다.</p>}
      </section>
      {selected.declarations.length > 0 && <details className="border-t pt-3 text-xs"><summary className="cursor-pointer font-medium">산출물 근거 · {selected.declarations.length}건</summary><div className="mt-2 grid gap-2">{selected.declarations.map((item, index) => <p className="break-all text-xs text-muted-foreground" key={item.evidenceId + ":" + index}>{item.type} · {item.adapter} · {item.reason} · {evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, item.evidenceId)}</p>)}</div></details>}
      {selected.observations.length > 0 && <div className="grid gap-2 border-t pt-3"><h3 className="mb-1 text-sm font-semibold">실제 응답 관측 기록 <span className="ml-1 text-xs font-normal text-muted-foreground">{selected.observations.length}건</span></h3>{selected.observations.map((observation) => {
        const event = snapshot.data?.events.find((candidate) => candidate.eventId === observation.evidenceId)
        const source = sourceLabel([observation.source])
        const ordinal = evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, observation.evidenceId)
        const accountId = event?.laneAccountId?.trim() || event?.idn || observation.identity
        const account = snapshot.data?.accounts.find((item) => item.id === accountId)?.label ?? accountId
        return <Button type="button" variant={selectedEvidenceId === observation.evidenceId ? "secondary" : "outline"} aria-pressed={selectedEvidenceId === observation.evidenceId} aria-label={`관측 기록 상세 · ${ordinal} · ${source} · ${account} · HTTP ${observation.status}`} className="h-auto w-full justify-start whitespace-normal border-border/70 px-3 py-2.5 text-left" disabled={!event || snapshot.isError} key={observation.evidenceId} onClick={() => setSelectedEvidenceId(observation.evidenceId)}><span className="grid min-w-0 flex-1 gap-1.5"><span className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 flex-wrap items-center gap-2 text-xs"><span className="font-mono text-muted-foreground">{ordinal}</span><SourceMarks sources={[observation.source]} /><span className="break-all">{account}</span></span><HttpStatusBadge status={observation.status} /></span><span className="break-all font-mono text-[11px] text-muted-foreground">{event?.path ?? selected.key.pathTemplate}</span></span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></Button>
      })}</div>}
      {selectedEvent && <section className="border-t pt-4" aria-label="선택 관측 기록 작업"><OperationDetail compactPolicy evidenceLabel={evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, selectedEvent.eventId)} event={selectedEvent} snapshot={snapshot.data!} onOpenRequestLab={() => setRequestLabOpen(true)} disabled={snapshot.isError} /></section>}
      <details className="border-t pt-3 text-xs"><summary className="cursor-pointer font-medium">기록 연결 정보</summary><div className="mt-2 grid gap-1">{[...new Set([...selected.observations.map((item) => item.evidenceId), ...selected.declarations.map((item) => item.evidenceId)])].map((id) => <p className="break-all font-mono text-xs" key={id}>{evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, id)}</p>)}</div></details>
      </div>
    </InspectorPanel>
  ) : <section className="grid gap-2 p-4"><h2 className="font-semibold">선택 상세</h2><p className="text-sm text-muted-foreground">항목을 선택하면 실제 응답과 산출물 근거를 분리해 표시합니다.</p></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="API·입력 차이 분석 영역" context={null} inspector={inspector} inspectorDefaultWidth={420} inspectorOpen={selected !== null} inspectorRevealKey={inspectorRevealKey} onInspectorOpenChange={(open) => { if (!open) setSelectedId(null) }}>
      <section className="grid gap-4 p-3" aria-labelledby="surface-title">
        <h1 id="surface-title" className="text-2xl font-semibold">API·입력 차이</h1>
        {!snapshot.isError && surface.endpoints.length === 0 && runGapCount(snapshot.data) > 0 && <RunGapHint count={runGapCount(snapshot.data)} />}
        <section className="max-w-full overflow-hidden rounded-md border" aria-labelledby="surface-comparison-title">
          <header className="flex items-center gap-3 border-b bg-card px-3 py-2"><h2 id="surface-comparison-title" className="shrink-0 text-sm font-semibold">API 비교</h2>{filters}</header>
          {snapshot.isError && <Alert variant="destructive"><AlertTitle>API·입력 차이를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
          <div className="overflow-auto">
          <Table className="min-w-[48rem]"><TableHeader><TableRow><TableHead className="w-20 text-center">Method</TableHead><TableHead>API</TableHead><TableHead>H S L</TableHead><TableHead>HTTP</TableHead><TableHead>관측</TableHead><TableHead>선언</TableHead><TableHead>입력</TableHead><TableHead><span className="sr-only">동작</span></TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((endpoint) => <TableRow key={endpointId(endpoint)} data-state={selectedId === endpointId(endpoint) ? "selected" : undefined}>
              <TableCell className="text-center"><MethodBadge method={endpoint.key.method} /></TableCell><TableCell className="max-w-[32rem] whitespace-normal"><p className="break-all font-mono text-xs">{endpoint.key.pathTemplate}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={endpoint.key.service}>{endpoint.key.service} · {endpointKinds(endpoint)}</p></TableCell>
              <TableCell><span title={deltaLabels[endpoint.deltaState]}><SourceMarks sources={endpoint.observedSources} /></span></TableCell><TableCell><div className="flex flex-wrap gap-1">{[...new Set(endpoint.observations.map((item) => item.status))].sort((a, b) => a - b).map((status) => <HttpStatusBadge status={status} key={status} />)}{endpoint.observations.length === 0 && <span className="text-muted-foreground">—</span>}</div></TableCell>
              <TableCell className="tabular-nums">{endpoint.observations.length}</TableCell><TableCell className="tabular-nums">{endpoint.declarations.length}</TableCell><TableCell className="tabular-nums">{endpoint.parameters.length}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { setSelectedId(endpointId(endpoint)); setSelectedEvidenceId(null); setInspectorRevealKey((key) => key + 1) }}>상세 보기</Button></TableCell>
            </TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">현재 필터에 맞는 API·입력 근거가 없습니다.</TableCell></TableRow>}</TableBody></Table>
          </div>
        </section>
      </section>
      {selectedEvent && labContext && <RequestLabDialog key={labContext} open={requestLabOpen} onOpenChange={setRequestLabOpen} event={selectedEvent} sessions={snapshot.data?.managedSessions ?? []} verifications={snapshot.data?.manualVerifications} datasetRevision={datasetRevision} snapshotRevision={snapshot.data?.revision} suspended={snapshot.isError} />}
    </ReferenceAnalysisWorkspace>
  )
}
