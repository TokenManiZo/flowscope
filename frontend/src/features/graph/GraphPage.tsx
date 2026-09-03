import { useEffect, useMemo, useRef, useState } from "react"
import { Crosshair, Expand, Filter, LockKeyhole, Maximize2, Minus, Plus, RotateCcw, ScanLine } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { Source, Verdict } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { CytoscapeGraph } from "./CytoscapeGraph"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import { laneGeometry } from "./graphLanes"
import { loadGraphPreferences, resetGraphPreferences, saveGraphPreferences, type GraphPreferences } from "./graphPreferences"
import { graphReviewVerdict, graphRouteCandidateId, projectGraph, type GraphFilters, type GraphSelection } from "./graphProjection"
import { ResponsiveGraphList } from "./ResponsiveGraphList"

const allSources: readonly Source[] = ["human", "scanner", "llm", "unknown"]
const reviewStates: readonly Verdict[] = ["allow", "deny", "suspicious", "undecided", "untested"]
const sourceNames: Record<Source, string> = { human: "HUMAN", scanner: "SCANNER", llm: "LLM", unknown: "UNKNOWN" }
const sourceLines: Record<Source, string> = {
  human: "border-blue-400",
  scanner: "border-dashed border-red-400",
  llm: "border-dotted border-zinc-300",
  unknown: "border-dotted border-zinc-500",
}
const supportTrafficClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])
const defaultPreferences: GraphPreferences = { version: 5, positions: {}, viewport: null, locked: false }
const firstDivider = `${laneGeometry(100, "endpoint", 0).left}%`
const secondDivider = `${laneGeometry(100, "object", 0).left}%`

function useCompactGraph() {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)")
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return compact
}

function toggle<T extends string>(items: readonly T[], value: T): readonly T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

function clampZoom(zoom: number, maxZoom: number) { return Math.min(maxZoom, Math.max(0.4, Math.round(zoom * 10) / 10)) }

export function GraphPage() {
  const snapshot = useSnapshotQuery()
  const compact = useCompactGraph()
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const [filters, setFilters] = useState<GraphFilters>({ source: allSources, identity: [], view: "source", reviewStates, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
  const [preferences, setPreferences] = useState<GraphPreferences>(() => loadGraphPreferences() ?? defaultPreferences)
  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [maxZoom, setMaxZoom] = useState(2)
  const [fitVersion, setFitVersion] = useState(0)
  const [listMode, setListMode] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const graph = useMemo(() => snapshot.data ? projectGraph(snapshot.data, filters) : null, [filters, snapshot.data])

  useEffect(() => { saveGraphPreferences(preferences) }, [preferences])
  useEffect(() => {
    if (!selection) return
    if (selection.routeCandidate) {
      const currentCandidate = snapshot.data?.routeCandidates.some((candidate) => graphRouteCandidateId(candidate) === selection.routeCandidate?.id)
      if (!currentCandidate) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
      return
    }
    const currentEvent = selection.evidenceIds.some((id) => snapshot.data?.events.some((event) => event.eventId === id))
    if (!currentEvent) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
  }, [selection, snapshot.data])

  const includedEvents = (snapshot.data?.events ?? []).filter((event) => event.trafficDisposition === "INCLUDE" && (filters.includeSupportTraffic || !supportTrafficClasses.has(event.trafficClass)))
  const sourceFacetEvents = includedEvents.filter((event) => filters.identity.length === 0 || filters.identity.includes(event.idn))
  const identityFacetEvents = includedEvents.filter((event) => filters.source.includes(event.source))
  const identities = [...new Set(identityFacetEvents.map((event) => event.idn))].sort()
  const sourceCount = (source: Source) => sourceFacetEvents.filter((event) => event.source === source).length
  const identityCount = (identity: string) => identityFacetEvents.filter((event) => event.idn === identity).length
  const reviewCount = (review: Verdict) => includedEvents.filter((event) => snapshot.data && graphReviewVerdict(snapshot.data, event) === review).length
  const selectedEvent = selection ? snapshot.data?.events.find((event) => selection.evidenceIds.includes(event.eventId)) ?? null : null
  const updatePreferences = (update: Pick<GraphPreferences, "positions" | "viewport">) => setPreferences((current) => {
    const next = { ...current, ...update }
    return JSON.stringify(current.positions) === JSON.stringify(next.positions) && JSON.stringify(current.viewport) === JSON.stringify(next.viewport) ? current : next
  })
  const selectGraph = (nextSelection: GraphSelection, elementId: string | null) => {
    setSelection(nextSelection)
    setSelectedElementId(elementId)
    setInspectorOpen(true)
  }
  const zoom = preferences.viewport?.zoom ?? 1
  const adjustZoom = (delta: number) => setPreferences((current) => ({ ...current, viewport: { zoom: clampZoom((current.viewport?.zoom ?? 1) + delta, maxZoom), pan: current.viewport?.pan ?? { x: 0, y: 0 } } }))
  const visibleCount = graph ? graph.identities.length + graph.resources.length + graph.operations.length + graph.routeCandidates.length : 0

  const filterRail = <div className="h-full bg-[var(--flowscope-pane)] px-4 py-4 text-[13px] leading-5">
    <div className="mb-3 flex items-start justify-between border-b border-border/70 pb-3"><div><p className="font-semibold tracking-[0.08em] text-foreground">GRAPH FILTERS</p><p className="mt-1 text-xs text-muted-foreground">{visibleCount}개 그래프 객체</p></div><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="그래프 저장값 초기화" onClick={() => { resetGraphPreferences(); setPreferences(defaultPreferences) }}><RotateCcw className="size-4" /></Button></div>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">SOURCES</legend><div className="grid gap-2.5">{allSources.map((source) => <label className="grid cursor-pointer grid-cols-[1rem_1.5rem_1fr_auto] items-center gap-2" key={source}><Checkbox checked={filters.source.includes(source)} onCheckedChange={() => setFilters((current) => ({ ...current, source: toggle(current.source, source) }))} /><span aria-hidden="true" className={`w-5 border-t-2 ${sourceLines[source]}`} /><span className="font-medium">{sourceNames[source]}</span><span className="tabular-nums text-muted-foreground">{sourceCount(source)}</span></label>)}</div></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">IDENTITIES</legend><div className="grid max-h-40 gap-2.5 overflow-y-auto pr-1">{identities.map((identity) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={identity}><Checkbox checked={filters.identity.includes(identity)} onCheckedChange={() => setFilters((current) => ({ ...current, identity: toggle(current.identity, identity) }))} /><span className="truncate font-medium">{identity}</span><span className="tabular-nums text-muted-foreground">{identityCount(identity)}</span></label>)}{!identities.length && <span className="text-xs text-muted-foreground">INCLUDE 신원이 없습니다.</span>}</div></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">EVIDENCE</legend><div className="grid gap-2">{reviewStates.map((review) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={review}><Checkbox checked={filters.reviewStates?.includes(review)} onCheckedChange={() => setFilters((current) => ({ ...current, reviewStates: toggle(current.reviewStates ?? reviewStates, review) }))} /><span>{review.toUpperCase()}</span><span className="tabular-nums text-muted-foreground">{reviewCount(review)}</span></label>)}</div></fieldset>
    <section className="border-b border-border/70 py-3" aria-label="GAP"><p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">GAP</p><p className="text-xs text-muted-foreground">{snapshot.data?.gaps.length ?? 0}개 서버 Gap</p></section>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">TRAFFIC CLASS</legend><label className="flex cursor-pointer items-start gap-2"><Checkbox className="mt-0.5" checked={filters.includeSupportTraffic} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeSupportTraffic: checked === true }))} /><span>인증·화면·반복 보조 흐름 표시</span></label></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">ROUTE CANDIDATES</legend><label className="flex cursor-pointer items-center gap-2"><Checkbox checked={filters.includeRouteCandidates} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeRouteCandidates: checked === true }))} /><span>경로 후보 표시</span></label></fieldset>
    <section className="border-b border-border/70 py-3" aria-label="ROLE - POLICY SUMMARY"><p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">ROLE - POLICY SUMMARY</p><p className="text-xs text-muted-foreground">역할 {Object.keys(snapshot.data?.requiredRoles ?? {}).length} · 소유자 {Object.keys(snapshot.data?.owners ?? {}).length}</p></section>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">GRAPH FOCUS</legend><div className="grid gap-2"><Button size="sm" variant="ghost" className="justify-start px-2" onClick={() => setFilters((current) => ({ ...current, expanded: !current.expanded }))}><Expand className="mr-1.5 size-3.5" />{filters.expanded ? "18개로 접기" : "더 펼치기"}</Button><Button size="sm" variant={preferences.locked ? "secondary" : "ghost"} className="justify-start px-2" onClick={() => setPreferences((current) => ({ ...current, locked: !current.locked }))}><LockKeyhole className="mr-1.5 size-3.5" />{preferences.locked ? "위치 잠금 해제" : "위치 잠금"}</Button></div></fieldset>
    <fieldset className="py-3"><legend className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">VIEW OPTIONS</legend><div className="grid grid-cols-2 gap-2"><Button size="sm" variant={filters.view === "source" ? "default" : "outline"} onClick={() => setFilters((current) => ({ ...current, view: "source" }))}>소스 보기</Button><Button size="sm" variant={filters.view === "authz" ? "default" : "outline"} onClick={() => setFilters((current) => ({ ...current, view: "authz" }))}>권한 판정</Button></div></fieldset>
  </div>

  const toolbar = <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[var(--flowscope-pane)] px-4 py-2.5">
    <div className="flex min-w-0 items-center gap-2.5"><ScanLine className="size-4 shrink-0 text-emerald-400" /><p className="text-sm font-semibold tracking-[0.04em]">ACCESS GRAPH</p>{graph && <p className="truncate text-xs text-muted-foreground">{graph.identities.length} identities · {graph.resources.length} resources · {graph.operations.length} operations</p>}</div>
    <div className="flex flex-wrap items-center gap-1.5"><Button size="sm" variant="outline" className="h-8 px-2.5 text-xs xl:hidden" aria-label="그래프 필터" onClick={() => setFilterOpen(true)}><Filter className="mr-1.5 size-3.5" />필터</Button><Button size="icon-sm" variant="ghost" aria-label="축소" disabled={zoom <= 0.4} onClick={() => adjustZoom(-0.1)}><Minus className="size-3.5" /></Button><span className="w-11 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="확대" disabled={zoom >= maxZoom - 0.001} onClick={() => adjustZoom(0.1)}><Plus className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="그래프 맞추기" onClick={() => setFitVersion((current) => current + 1)}><Crosshair className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="전체 화면" onClick={() => { void canvasShellRef.current?.requestFullscreen?.() }}><Maximize2 className="size-3.5" /></Button>{!compact && <Button size="sm" variant={listMode ? "secondary" : "ghost"} className="h-8 px-2.5 text-xs" onClick={() => setListMode((current) => !current)}>{listMode ? "그래프 보기" : "API 목록 보기"}</Button>}</div>
  </div>

  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--flowscope-canvas)]" aria-labelledby="graph-title">
    <h1 id="graph-title" className="sr-only">공격면 그래프</h1>
    {snapshot.isError && <Alert variant="destructive" className="m-4"><AlertTitle>그래프를 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error.message}</AlertDescription></Alert>}
    <ReferenceAnalysisWorkspace context={filterRail} toolbar={toolbar} contextOpen={filterOpen} onContextOpenChange={setFilterOpen} inspector={selection && snapshot.data ? <GraphInspectorPanel selection={selection} event={selectedEvent} snapshot={snapshot.data} /> : <p className="p-4 text-sm text-muted-foreground">그래프 노드 또는 Evidence를 선택하면 서버 snapshot 상세를 표시합니다.</p>} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) { setSelection(null); setSelectedElementId(null) } }} ariaLabel="접근 그래프 작업면">
      {snapshot.isLoading && <p className="m-4 rounded-md border border-border/70 p-6 text-sm text-muted-foreground">공격면을 불러오는 중입니다.</p>}
      {graph && (compact || listMode ? <div className="p-4"><ResponsiveGraphList projection={graph} onSelect={(nextSelection) => selectGraph(nextSelection, null)} /></div> : <div ref={canvasShellRef} className="relative min-h-[28rem] flex-1 overflow-hidden"><div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 grid h-10 grid-cols-3 border-b border-border/50 bg-[var(--flowscope-canvas)] text-center text-[10px] font-semibold tracking-[0.16em] text-muted-foreground"><span className="border-r border-border/40 py-3">IDENTITY</span><span className="border-r border-border/40 py-3">ENDPOINT</span><span className="py-3">OBJECT</span></div><div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[1] border-l border-border/40" style={{ left: firstDivider }} /><div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[1] border-l border-border/40" style={{ left: secondDivider }} /><CytoscapeGraph projection={graph} locked={preferences.locked} fitVersion={fitVersion} preferences={preferences} selectedElementId={selectedElementId} onSelect={selectGraph} onMaxZoomChange={setMaxZoom} onPreferencesChange={updatePreferences} onRendererUnavailable={() => setListMode(true)} /><div role="list" aria-label="그래프 소스 범례" className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-4 rounded border border-border/70 bg-[var(--flowscope-pane)] px-3 py-1.5 text-[10px] text-muted-foreground"><span role="listitem" className="flex items-center gap-1.5"><i className="w-5 border-t-2 border-blue-400" />HUMAN</span><span role="listitem" className="flex items-center gap-1.5"><i className="w-5 border-t-2 border-dashed border-red-400" />SCANNER</span><span role="listitem" className="flex items-center gap-1.5"><i className="w-5 border-t-2 border-dotted border-zinc-300" />LLM</span></div></div>)}
    </ReferenceAnalysisWorkspace>
  </section>
}
