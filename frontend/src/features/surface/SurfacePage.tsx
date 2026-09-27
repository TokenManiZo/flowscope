import { useEffect, useMemo, useState } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RunGapHint, runGapCount } from "@/components/RunGapHint"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { evidenceFullLabel } from "@/lib/display/operationLabel"
import { OperationDetail } from "@/features/evidence/OperationDetail"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { SurfaceDeltaState, SurfaceEndpoint, SurfaceParameter, SurfaceSource } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"

type DeltaFilter = "ALL" | SurfaceDeltaState

const deltaLabels: Record<SurfaceDeltaState, string> = {
  DECLARED_NOT_OBSERVED: "산출물에서 발견 · 아직 요청 없음",
  UNRESOLVED_COORDINATE: "선언 좌표 미확정 · 관측 비교 제외",
  ONE_SOURCE_OBSERVED: "실제 응답 있음 · 한 source",
  MULTI_SOURCE_OBSERVED: "실제 응답 있음 · 두 source",
  ALL_SOURCES_OBSERVED: "실제 응답 있음 · 세 source",
  OBSERVED_NOT_DECLARED: "실제 응답 있음 · 산출물 근거 없음",
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

function statusLabel(endpoint: SurfaceEndpoint): string {
  const values = [...new Set(endpoint.observations.map((item) => item.status))].sort((left, right) => left - right)
  return values.length ? values.join(" · ") : "응답 없음"
}

export function SurfacePage() {
  const snapshot = useSnapshotQuery()
  const [filter, setFilter] = useState<DeltaFilter>("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [requestLabContext, setRequestLabContext] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<SurfaceSource>>(() => new Set(["HUMAN", "SCANNER", "LLM"]))
  const surface = snapshot.data?.surface ?? { endpoints: [], extractions: [], probes: [] }
  const endpoints = useMemo(
    () => surface.endpoints.map((endpoint) => filterEndpoint(endpoint, enabledSources)).filter((endpoint): endpoint is SurfaceEndpoint => endpoint !== null),
    [enabledSources, surface.endpoints],
  )
  const rows = useMemo(() => endpoints.filter((endpoint) => filter === "ALL" || endpoint.deltaState === filter), [endpoints, filter])
  const selected = endpoints.find((endpoint) => endpointId(endpoint) === selectedId) ?? null
  const selectedEvent = selectedEvidenceId
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
  const executionRuns = (snapshot.data?.runExecutions ?? []).filter((item) => enabledSources.has(item.source))
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

  const context = (
    <section className="grid gap-4 p-3">
      <div><h2 className="text-sm font-semibold">차이 필터</h2><p className="text-xs text-muted-foreground">산출물 근거와 실제 HTTP 응답을 섞지 않고 비교합니다.</p></div>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1 font-medium">실제 요청 source</legend>
        {sourceOptions.map((source) => <label className="flex items-center gap-2" key={source.value}><Checkbox checked={enabledSources.has(source.value)} onCheckedChange={(checked) => toggleSource(source.value, checked === true)} />{source.label}</label>)}
      </fieldset>
      <label className="grid gap-1 text-sm" htmlFor="surface-delta">비교 상태<Select value={filter} onValueChange={(value) => setFilter(value as DeltaFilter)}><SelectTrigger id="surface-delta" aria-label="API·입력 차이 상태"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">전체</SelectItem>{Object.entries(deltaLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between"><dt>전체 항목</dt><dd>{endpoints.length}</dd></div>
        <div className="flex justify-between"><dt>실제 API</dt><dd>{countKind("OBSERVED_API")}</dd></div>
        <div className="flex justify-between"><dt>산출물 API 후보</dt><dd>{countKind("ARTIFACT_API")}</dd></div>
        <div className="flex justify-between"><dt>화면 이동</dt><dd>{countKind("NAVIGATION")}</dd></div>
        <div className="flex justify-between"><dt>정적 자산</dt><dd>{countKind("STATIC_ASSET")}</dd></div>
        <div className="flex justify-between"><dt>입력 필드</dt><dd>{endpoints.reduce((sum, endpoint) => sum + endpoint.parameters.length, 0)}</dd></div>
        <div className="flex justify-between"><dt>OPTIONS probe</dt><dd>{probes.length}</dd></div>
        <div className="flex justify-between"><dt>부분·실패 파싱</dt><dd>{unresolvedExtractions.length}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">요청 없음, probe, 화면 이동, 정적 자산은 실제 API 응답이나 취약점으로 계산하지 않습니다.</p>
    </section>
  )

  const inspector = selected ? (
    <section className="grid gap-4 p-4">
      <div><h2 className="font-semibold">선택 항목</h2><p className="break-all font-mono text-sm">{selected.key.method} {selected.key.pathTemplate}</p><p className="break-all text-xs text-muted-foreground">{selected.key.service}</p></div>
      <div className="grid gap-1 text-sm"><p>종류 · {endpointKinds(selected)}</p><p>비교 상태 · {deltaLabels[selected.deltaState]}</p><p>실제 요청 source · {sourceLabel(selected.observedSources)}</p><p>실제 응답 status · {statusLabel(selected)}</p><p>응답 Evidence · {selected.observations.length}건</p><p>산출물 근거 · {selected.declarations.length}건</p></div>
      {selected.declarations.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">산출물 provenance</h3>{selected.declarations.map((item, index) => <p className="break-all text-xs text-muted-foreground" key={item.evidenceId + ":" + index}>{item.type} · {item.adapter} · {item.reason} · {evidenceFullLabel(snapshot.data?.evidenceOrdinals, item.evidenceId)}</p>)}</div>}
      {selected.observations.length > 0 && <div className="grid gap-2"><h3 className="text-sm font-semibold">실제 응답 Evidence</h3>{selected.observations.map((observation) => {
        const event = snapshot.data?.events.find((candidate) => candidate.eventId === observation.evidenceId)
        const source = observation.source === "HUMAN" ? "H" : observation.source === "SCANNER" ? "S" : observation.source === "LLM" ? "L" : "?"
        return <Button type="button" variant={selectedEvidenceId === observation.evidenceId ? "secondary" : "outline"} className="h-auto justify-start whitespace-normal text-left" disabled={!event || snapshot.isError} key={observation.evidenceId} onClick={() => setSelectedEvidenceId(observation.evidenceId)}>Evidence 상세 · {source} · HTTP {observation.status}</Button>
      })}</div>}
      {selectedEvent && <section className="border-t pt-4" aria-label="선택 Evidence 작업"><OperationDetail event={selectedEvent} snapshot={snapshot.data!} onOpenRequestLab={() => setRequestLabOpen(true)} disabled={snapshot.isError} /></section>}
      <div><h3 className="mb-2 text-sm font-semibold">입력 필드</h3><div className="grid gap-2">{selected.parameters.map((parameter) => <div className="rounded-md border p-2 text-sm" key={parameter.location + ":" + (parameter.coordinateResolved ? "" : "?") + parameter.canonicalPath}><p className="break-all font-mono">{parameter.location} · {parameter.fieldPath}</p><p className="break-all font-mono text-xs text-muted-foreground">{parameter.canonicalPath}</p><p className="text-xs text-muted-foreground">{deltaLabels[parameter.deltaState]} · {parameter.requirement} · {sourceLabel(parameter.observedSources)} · {parameter.observedShapes.join(" · ") || "형태 응답 없음"}</p></div>)}{selected.parameters.length === 0 && <p className="text-sm text-muted-foreground">확인된 입력 필드가 없습니다.</p>}</div></div>
      <div><h3 className="mb-2 text-sm font-semibold">Evidence ID</h3>{[...new Set([...selected.observations.map((item) => item.evidenceId), ...selected.declarations.map((item) => item.evidenceId)])].map((id) => <p className="break-all font-mono text-xs" key={id}>{evidenceFullLabel(snapshot.data?.evidenceOrdinals, id)}</p>)}</div>
    </section>
  ) : <section className="grid gap-2 p-4"><h2 className="font-semibold">선택 상세</h2><p className="text-sm text-muted-foreground">항목을 선택하면 실제 응답과 산출물 근거를 분리해 표시합니다.</p></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="API·입력 차이 분석 영역" context={context} inspector={inspector} inspectorOpen={selected !== null} onInspectorOpenChange={(open) => { if (!open) setSelectedId(null) }}>
      <section className="grid gap-4 p-3" aria-labelledby="surface-title">
        <div><h1 id="surface-title" className="text-2xl font-semibold">API·입력 차이</h1><p className="text-sm text-muted-foreground">HUMAN·ZAP·LLM의 실제 HTTP 응답과 OpenAPI·HTML·JavaScript에서 확인한 endpoint·입력 근거를 분리해 정렬합니다.</p></div>
        {!snapshot.isError && surface.endpoints.length === 0 && runGapCount(snapshot.data) > 0 && <RunGapHint count={runGapCount(snapshot.data)} />}
        {snapshot.isError && <Alert variant="destructive"><AlertTitle>API·입력 차이를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>{snapshot.data && <><p>마지막 성공 데이터 · 현재 상태 아님</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
        {unresolvedExtractions.length > 0 && <Alert><AlertTitle>일부 산출물을 완전히 해석하지 못했습니다.</AlertTitle><AlertDescription>{unresolvedExtractions.length}건의 부분·실패·상한 상태가 있습니다. 누락 가능성을 숨기지 않고 근거로 보존합니다.</AlertDescription></Alert>}
        {executionRuns.map((run) => <Alert key={run.source + ":" + run.runId} variant={run.quality === "ALL_FAILED" ? "destructive" : "default"}><AlertTitle>{run.source} 실행 · {run.quality}</AlertTitle><AlertDescription>시도 {run.attempted} · 응답 {run.responses} · 실패 {run.failures}{Object.keys(run.outcomes).length ? " · " + Object.entries(run.outcomes).map(([name, count]) => name + " " + count).join(" · ") : ""}</AlertDescription></Alert>)}
        <div className="max-w-full overflow-auto rounded-md border">
          <Table><TableHeader><TableRow><TableHead>비교 상태</TableHead><TableHead>종류</TableHead><TableHead>요청</TableHead><TableHead>실제 source</TableHead><TableHead>응답 status</TableHead><TableHead>산출물 근거</TableHead><TableHead>입력</TableHead><TableHead><span className="sr-only">동작</span></TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((endpoint) => <TableRow key={endpointId(endpoint)} data-state={selectedId === endpointId(endpoint) ? "selected" : undefined}><TableCell><Badge variant={endpoint.deltaState === "DECLARED_NOT_OBSERVED" || endpoint.deltaState === "ONE_SOURCE_OBSERVED" ? "destructive" : "outline"}>{deltaLabels[endpoint.deltaState]}</Badge></TableCell><TableCell className="min-w-40">{endpointKinds(endpoint)}</TableCell><TableCell className="min-w-72 whitespace-normal"><Badge variant="outline">{endpoint.key.method}</Badge><p className="mt-1 break-all font-mono">{endpoint.key.pathTemplate}</p><p className="break-all text-xs text-muted-foreground">{endpoint.key.service}</p></TableCell><TableCell>{sourceLabel(endpoint.observedSources)}</TableCell><TableCell>{statusLabel(endpoint)}</TableCell><TableCell>{endpoint.declarations.length}</TableCell><TableCell>{endpoint.parameters.length}</TableCell><TableCell><Button size="sm" variant="outline" disabled={snapshot.isError} onClick={() => { setSelectedId(endpointId(endpoint)); setSelectedEvidenceId(null); setRequestLabOpen(false) }}>상세 보기</Button></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground">현재 필터에 해당하는 항목이 없습니다.</TableCell></TableRow>}</TableBody>
          </Table>
        </div>
      </section>
      {selectedEvent && labContext && <RequestLabDialog key={labContext} open={requestLabOpen} onOpenChange={setRequestLabOpen} event={selectedEvent} sessions={snapshot.data?.managedSessions ?? []} verifications={snapshot.data?.manualVerifications} datasetRevision={datasetRevision} snapshotRevision={snapshot.data?.revision} suspended={snapshot.isError} />}
    </ReferenceAnalysisWorkspace>
  )
}
