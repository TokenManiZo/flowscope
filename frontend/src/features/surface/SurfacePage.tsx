import { useMemo, useState } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SurfaceDeltaState, SurfaceEndpoint, SurfaceParameter, SurfaceSource } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"

type DeltaFilter = "ALL" | SurfaceDeltaState

const deltaLabels: Record<SurfaceDeltaState, string> = {
  DECLARED_NOT_OBSERVED: "선언됨 · 미관측",
  ONE_SOURCE_OBSERVED: "한 소스만 관측",
  MULTI_SOURCE_OBSERVED: "복수 소스 관측",
  ALL_SOURCES_OBSERVED: "세 소스 관측",
  OBSERVED_NOT_DECLARED: "관측됨 · 선언 없음",
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
  return { ...parameter, observations, declarations, observedSources, observationEvidenceIds: observations.map((item) => item.evidenceId), observedShapes: [...new Set(observations.map((item) => item.shape).filter((value): value is string => Boolean(value)))], deltaState: filteredDelta(declarations.length > 0, observedSources) }
}

function filterEndpoint(endpoint: SurfaceEndpoint, enabled: ReadonlySet<SurfaceSource>): SurfaceEndpoint | null {
  const observations = endpoint.observations.filter((item) => enabled.has(item.source))
  const declarations = endpoint.declarations.filter((item) => enabled.has(item.source))
  const observedSources = [...new Set(observations.map((item) => item.source))]
  const parameters = endpoint.parameters.map((parameter) => filterParameter(parameter, enabled)).filter((parameter): parameter is SurfaceParameter => parameter !== null)
  if (observations.length === 0 && declarations.length === 0 && parameters.length === 0) return null
  return { ...endpoint, observations, declarations, observedSources, parameters, deltaState: filteredDelta(declarations.length > 0, observedSources) }
}

function endpointId(endpoint: SurfaceEndpoint): string {
  return `${endpoint.key.service}\u0000${endpoint.key.method}\u0000${endpoint.key.pathTemplate}`
}

function sourceLabel(values: readonly string[]): string {
  return values.length ? values.map((value) => value === "SCANNER" ? "S" : value === "HUMAN" ? "H" : value === "LLM" ? "L" : "?").join(" · ") : "미관측"
}

export function SurfacePage() {
  const snapshot = useSnapshotQuery()
  const [filter, setFilter] = useState<DeltaFilter>("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<SurfaceSource>>(() => new Set(["HUMAN", "SCANNER", "LLM"]))
  const surface = snapshot.data?.surface ?? { endpoints: [], extractions: [], probes: [] }
  const endpoints = useMemo(() => surface.endpoints.map((endpoint) => filterEndpoint(endpoint, enabledSources)).filter((endpoint): endpoint is SurfaceEndpoint => endpoint !== null), [enabledSources, surface.endpoints])
  const rows = useMemo(() => endpoints.filter((endpoint) => filter === "ALL" || endpoint.deltaState === filter), [endpoints, filter])
  const selected = endpoints.find((endpoint) => endpointId(endpoint) === selectedId) ?? null
  const extractions = surface.extractions.filter((item) => enabledSources.has(item.source))
  const probes = surface.probes.filter((item) => enabledSources.has(item.source))
  const unresolvedExtractions = extractions.filter((item) => item.status !== "PARSED" || item.issues.length > 0)
  const executionRuns = (snapshot.data?.runExecutions ?? []).filter((item) => enabledSources.has(item.source))

  function toggleSource(source: SurfaceSource, checked: boolean) {
    setEnabledSources((current) => {
      const next = new Set(current)
      if (checked) next.add(source)
      else next.delete(source)
      return next
    })
  }

  const context = <section className="grid gap-4 p-3"><div><h2 className="text-sm font-semibold">차이 필터</h2><p className="text-xs text-muted-foreground">선언과 실제 HTTP 관측을 섞지 않고 비교합니다.</p></div><fieldset className="grid gap-2 text-sm"><legend className="mb-1 font-medium">관측 source</legend>{sourceOptions.map((source) => <label className="flex items-center gap-2" key={source.value}><Checkbox checked={enabledSources.has(source.value)} onCheckedChange={(checked) => toggleSource(source.value, checked === true)} />{source.label}</label>)}</fieldset><label className="grid gap-1 text-sm" htmlFor="surface-delta">상태<Select value={filter} onValueChange={(value) => setFilter(value as DeltaFilter)}><SelectTrigger id="surface-delta" aria-label="API·입력 차이 상태"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">전체</SelectItem>{Object.entries(deltaLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><dl className="grid gap-2 text-sm"><div className="flex justify-between"><dt>Endpoint</dt><dd>{endpoints.length}</dd></div><div className="flex justify-between"><dt>Parameter</dt><dd>{endpoints.reduce((sum, endpoint) => sum + endpoint.parameters.length, 0)}</dd></div><div className="flex justify-between"><dt>OPTIONS probe</dt><dd>{probes.length}</dd></div><div className="flex justify-between"><dt>부분·실패 파싱</dt><dd>{unresolvedExtractions.length}</dd></div></dl><p className="text-xs text-muted-foreground">OPTIONS probe와 미관측 선언은 API 기능 관측이나 취약점으로 계산하지 않습니다.</p></section>

  const inspector = selected ? <section className="grid gap-4 p-4"><div><h2 className="font-semibold">선택 API</h2><p className="break-all font-mono text-sm">{selected.key.method} {selected.key.pathTemplate}</p><p className="break-all text-xs text-muted-foreground">{selected.key.service}</p></div><div className="grid gap-1 text-sm"><p>상태 · {deltaLabels[selected.deltaState]}</p><p>관측 소스 · {sourceLabel(selected.observedSources)}</p><p>관측 Evidence · {selected.observations.length}건</p><p>선언 근거 · {selected.declarations.length}건</p></div>{selected.declarations.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">선언 provenance</h3>{selected.declarations.map((item, index) => <p className="break-all text-xs text-muted-foreground" key={`${item.evidenceId}:${index}`}>{item.type} · {item.adapter} · {item.reason} · {item.evidenceId}</p>)}</div>}<div><h3 className="mb-2 text-sm font-semibold">입력 필드</h3><div className="grid gap-2">{selected.parameters.map((parameter) => <div className="rounded-md border p-2 text-sm" key={`${parameter.location}:${parameter.fieldPath}`}><p className="break-all font-mono">{parameter.location} · {parameter.fieldPath}</p><p className="text-xs text-muted-foreground">{deltaLabels[parameter.deltaState]} · {parameter.requirement} · {sourceLabel(parameter.observedSources)} · {parameter.observedShapes.join(" · ") || "shape 미관측"}</p></div>)}{selected.parameters.length === 0 && <p className="text-sm text-muted-foreground">확인된 parameter가 없습니다.</p>}</div></div><div><h3 className="mb-2 text-sm font-semibold">Evidence ID</h3>{[...new Set([...selected.observations.map((item) => item.evidenceId), ...selected.declarations.map((item) => item.evidenceId)])].map((id) => <p className="break-all font-mono text-xs" key={id}>{id}</p>)}</div></section> : <section className="grid gap-2 p-4"><h2 className="font-semibold">선택 상세</h2><p className="text-sm text-muted-foreground">Endpoint를 선택하면 source별 관측과 parameter 근거를 표시합니다.</p></section>

  return <ReferenceAnalysisWorkspace ariaLabel="API·입력 차이 분석 영역" context={context} inspector={inspector} inspectorOpen={selected !== null} onInspectorOpenChange={(open) => { if (!open) setSelectedId(null) }}><section className="grid gap-4 p-3" aria-labelledby="surface-title"><div><h1 id="surface-title" className="text-2xl font-semibold">API·입력 차이</h1><p className="text-sm text-muted-foreground">OpenAPI·HTML·JavaScript 선언과 HUMAN·SCANNER·LLM의 실제 요청을 endpoint와 parameter 단위로 정렬합니다.</p></div>{snapshot.isError && <Alert variant="destructive"><AlertTitle>API·입력 차이를 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</AlertDescription></Alert>}{unresolvedExtractions.length > 0 && <Alert><AlertTitle>일부 산출물을 완전히 해석하지 못했습니다.</AlertTitle><AlertDescription>{unresolvedExtractions.length}건의 부분·실패·상한 상태가 있습니다. 누락 가능성을 숨기지 않고 상세 근거로 보존합니다.</AlertDescription></Alert>}{executionRuns.map((run) => <Alert key={`${run.source}:${run.runId}`} variant={run.quality === "ALL_FAILED" ? "destructive" : "default"}><AlertTitle>{run.source} 실행 · {run.quality}</AlertTitle><AlertDescription>시도 {run.attempted} · 응답 {run.responses} · 실패 {run.failures}{Object.keys(run.outcomes).length ? ` · ${Object.entries(run.outcomes).map(([name, count]) => `${name} ${count}`).join(" · ")}` : ""}</AlertDescription></Alert>)}<div className="max-w-full overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>상태</TableHead><TableHead>요청</TableHead><TableHead>관측 소스</TableHead><TableHead>선언</TableHead><TableHead>Parameter</TableHead><TableHead><span className="sr-only">동작</span></TableHead></TableRow></TableHeader><TableBody>{rows.map((endpoint) => <TableRow key={endpointId(endpoint)} data-state={selectedId === endpointId(endpoint) ? "selected" : undefined}><TableCell><Badge variant={endpoint.deltaState === "DECLARED_NOT_OBSERVED" || endpoint.deltaState === "ONE_SOURCE_OBSERVED" ? "destructive" : "outline"}>{deltaLabels[endpoint.deltaState]}</Badge></TableCell><TableCell className="min-w-72 whitespace-normal"><Badge variant="outline">{endpoint.key.method}</Badge><p className="mt-1 break-all font-mono">{endpoint.key.pathTemplate}</p><p className="break-all text-xs text-muted-foreground">{endpoint.key.service}</p></TableCell><TableCell>{sourceLabel(endpoint.observedSources)}</TableCell><TableCell>{endpoint.declarations.length}</TableCell><TableCell>{endpoint.parameters.length}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelectedId(endpointId(endpoint))}>상세 보기</Button></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">현재 필터에 해당하는 endpoint가 없습니다.</TableCell></TableRow>}</TableBody></Table></div></section></ReferenceAnalysisWorkspace>
}
