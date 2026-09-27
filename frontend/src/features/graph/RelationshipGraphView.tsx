import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlignVerticalSpaceAround, Bot, Crosshair, Expand, Filter, LockKeyhole, Maximize2, Minus, Plus, RotateCcw, ScanLine, UserRound } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { judgmentTone } from "@/features/matrix/judgmentProjection"
import type { Source, Verdict } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { SourceIcon } from "@/features/evidence/SourceIcon"

import { CytoscapeGraph } from "./CytoscapeGraph"
import { GRAPH_MAX_ZOOM, LANE_SPACING, laneAnchor, type LaneBounds } from "./graphLanes"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import { loadGraphPreferences, resetGraphPreferences, saveGraphPreferences, type GraphPreferences } from "./graphPreferences"
import { graphCellKey, graphCellSelection, graphReviewVerdict, graphRouteCandidateId, projectRouteCandidate, type GraphFilters, type GraphSelection } from "./graphProjection"
import { GRAPH_PAGE_SIZE, graphCountLabel, navigateHierarchy, stepBack, projectHierarchy, type GraphNavigation, type HierarchyNode, type HierarchySelection } from "./graphHierarchy"
import { ResponsiveGraphList } from "./ResponsiveGraphList"
import { operationParts } from "./relationshipNodeCard"

const allSources: readonly Source[] = ["human", "scanner", "llm", "unknown"]
const reviewStates: readonly Verdict[] = ["allow", "deny", "suspicious", "undecided", "untested"]
const sourceNames: Record<Source, string> = { human: "HUMAN", scanner: "SCANNER", llm: "LLM", unknown: "UNKNOWN" }
const supportTrafficClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])
const defaultPreferences: GraphPreferences = { version: 7, positions: {}, viewport: null, locked: false, inputMode: "auto" }
const initialNavigation: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: GRAPH_PAGE_SIZE, objectLimit: GRAPH_PAGE_SIZE, focusCandidateKey: "" }

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

function useCanvasWidth(ref: { current: HTMLDivElement | null }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return setWidth(0)
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function toggle<T extends string>(items: readonly T[], value: T): readonly T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

function clampZoom(zoom: number) { return Math.min(GRAPH_MAX_ZOOM, Math.max(0.4, Math.round(zoom * 10) / 10)) }

export function RelationshipGraphView({ viewSwitcher }: { viewSwitcher?: ReactNode }) {
  const snapshot = useSnapshotQuery()
  const compact = useCompactGraph()
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const [filters, setFilters] = useState<GraphFilters>({ source: allSources, identity: [], view: "source", reviewStates, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
  const [preferences, setPreferences] = useState<GraphPreferences>(() => loadGraphPreferences() ?? defaultPreferences)
  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [fitVersion, setFitVersion] = useState(0)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [laneLayout, setLaneLayout] = useState({ lane: 0, version: 0 })
  const [laneBounds, setLaneBounds] = useState<ReadonlyArray<LaneBounds | null>>([])
  const [listMode, setListMode] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [navigation, setNavigation] = useState(initialNavigation)
  const graph = useMemo(() => snapshot.data ? projectHierarchy(snapshot.data, filters, navigation) : null, [filters, snapshot.data, navigation])
  const confirmedNodeIds = useMemo(() => {
    const matrix = snapshot.data?.authorizationMatrix
    if (!matrix || !graph) return new Set<string>()
    const confirmed = [...matrix.functions, ...matrix.objects, ...matrix.evidence].filter(item => item.reviewStatus === "CONFIRMED" && judgmentTone(item.status) === "risk")
    return new Set(graph.nodes.filter(node => node.kind === "operation"
      ? confirmed.some(item => item.operation === node.selection.operation)
      : node.kind === "resource" && confirmed.some(item => "resource" in item && item.operation === node.selection.operation && item.resource === node.selection.resource)).map(node => node.id))
  }, [graph, snapshot.data])
  const resolvedNavigation = graph?.navigation ?? navigation
  // 필터·snapshot 변화로 현재 단계가 사라지면 projection이 상위 단계로 되돌리고, 선택도 함께 비운다.
  useEffect(() => { if (graph && graph.navigation !== navigation) { setNavigation(graph.navigation); setSelection(null); setSelectedElementId(null); setInspectorOpen(false) } }, [graph, navigation])

  useEffect(() => { saveGraphPreferences(preferences) }, [preferences])
  useEffect(() => {
    if (snapshot.isError) return
    if (!selection) return
    if (selection.routeCandidate) {
      const currentCandidate = snapshot.data?.routeCandidates.find((candidate) => graphRouteCandidateId(candidate) === selection.routeCandidate?.id)
      if (!currentCandidate) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
      else {
        const currentSelection = projectRouteCandidate(currentCandidate, new Set(filters.source)).selection
        if (JSON.stringify(currentSelection) !== JSON.stringify(selection)) setSelection(currentSelection)
      }
      return
    }
    // 계층 선택은 서버 셀 key로 현재 snapshot과 재조정한다. 셀이 모두 사라지면 선택을 비우고, 일부만 남으면 남은 셀·Gap ID로 갱신한다.
    const cellSelection = selection as Partial<HierarchySelection>
    if (cellSelection.cells?.length && snapshot.data) {
      const selectedKeys = new Set(cellSelection.cellKeys)
      const cells = snapshot.data.cells.filter((cell) => selectedKeys.has(graphCellKey(cell)))
      if (!cells.length) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false); return }
      const currentKeys = new Set(cells.map(graphCellKey))
      const gapIds = snapshot.data.gaps.filter((gap) => currentKeys.has(graphCellKey(gap))).map((gap) => gap.id)
      if (cells.length !== cellSelection.cells.length || cells.some((cell, index) => cell !== cellSelection.cells?.[index]) || JSON.stringify(gapIds) !== JSON.stringify(cellSelection.gapIds ?? [])) {
        setSelection({ ...selection, ...graphCellSelection(cells, selection.source), gapIds } as HierarchySelection)
      }
      return
    }
    // Target·API 그룹 노드는 셀 없이 요약만 여는 선택이라, 노드가 화면에 남아 있는 동안 유지한다.
    if (!cellSelection.cellKeys?.length && selectedElementId && graph?.nodes.some((node) => node.id === selectedElementId && (node.kind === "target" || node.kind === "api-group"))) return
    const currentCell = cellSelection.cellKeys?.some((key) => snapshot.data?.cells.some((cell) => graphCellKey(cell) === key))
    const currentGap = cellSelection.gapIds?.some((id) => snapshot.data?.gaps.some((gap) => gap.id === id))
    const currentEvent = selection.evidenceIds.some((id) => snapshot.data?.events.some((event) => event.eventId === id || event.clusterEvidenceIds?.includes(id)))
    if (!currentCell && !currentGap && !currentEvent) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
  }, [filters.source, graph, selectedElementId, selection, snapshot.data, snapshot.isError])

  const includedEvents = (snapshot.data?.events ?? []).filter((event) => event.trafficDisposition === "INCLUDE" && (filters.includeSupportTraffic || !supportTrafficClasses.has(event.trafficClass)))
  const sourceFacetEvents = includedEvents.filter((event) => filters.identity.length === 0 || filters.identity.includes(event.idn))
  const identityFacetEvents = includedEvents.filter((event) => filters.source.includes(event.source))
  const identities = [...new Set(identityFacetEvents.map((event) => event.idn))].sort()
  const sourceCount = (source: Source) => sourceFacetEvents.filter((event) => event.source === source).length
  const identityCount = (identity: string) => identityFacetEvents.filter((event) => event.idn === identity).length
  const reviewCount = (review: Verdict) => includedEvents.filter((event) => snapshot.data && graphReviewVerdict(snapshot.data, event) === review).length
  const selectedEvent = selection ? snapshot.data?.events.find((event) => (selection.source === null || event.source === selection.source) && (selection.identity === null || event.idn === selection.identity) && (selection.operation === null || event.op === selection.operation) && (selection.resource === null || event.resource === selection.resource) && (selection.evidenceIds.includes(event.eventId) || (event.clusterEvidenceIds ?? []).some((id) => selection.evidenceIds.includes(id)))) ?? null : null
  const updatePreferences = (update: Pick<GraphPreferences, "positions" | "viewport" | "sizes">) => setPreferences((current) => {
    // 크기 저장값은 비어 있으면 필드를 빼서 기존 저장 형식과 같게 둔다.
    const { sizes, ...rest } = update
    const next: GraphPreferences = { ...current, ...rest }
    if (sizes && Object.keys(sizes).length) next.sizes = sizes; else delete next.sizes
    return JSON.stringify(current.positions) === JSON.stringify(next.positions) && JSON.stringify(current.viewport) === JSON.stringify(next.viewport) && JSON.stringify(current.sizes ?? {}) === JSON.stringify(next.sizes ?? {}) ? current : next
  })
  const selectGraph = (nextSelection: GraphSelection, elementId: string | null) => {
    if (snapshot.isError) return
    setSelection(nextSelection)
    setSelectedElementId(elementId)
    setInspectorOpen(true)
  }
  const changeNavigation = (next: GraphNavigation) => {
    setNavigation(next)
    setSelection(null); setSelectedElementId(null); setInspectorOpen(false)
  }
  const navigateNode = (node: HierarchyNode) => {
    if (node.kind === "api-group" && node.groupId) changeNavigation(navigateHierarchy(resolvedNavigation, "group", node.groupId))
    else if (node.kind === "operation" && node.selection.operation) changeNavigation({ ...navigateHierarchy(resolvedNavigation, "operation", resolvedNavigation.groupId, node.selection.operation), operationLimit: resolvedNavigation.operationLimit })
  }
  const expand = () => setNavigation({ ...resolvedNavigation, ...(resolvedNavigation.level === "operation" ? { objectLimit: resolvedNavigation.objectLimit + GRAPH_PAGE_SIZE } : { operationLimit: resolvedNavigation.operationLimit + GRAPH_PAGE_SIZE }) })
  const hiddenCandidates = graph?.kind === "group" ? Math.max(0, (graph.groups.find((group) => group.id === resolvedNavigation.groupId)?.routeCandidateCount ?? 0) - graph.routeCandidates.length) : 0
  const hiddenCount = graph?.kind === "operation" ? graph.hiddenObjectCount : (graph?.hiddenOperationCount ?? 0) + hiddenCandidates
  const lanes = graph?.kind === "site" ? ["TARGET", "API GROUP"] : graph?.kind === "group" ? ["IDENTITY", "API"] : ["IDENTITY", "API", "OBJECT"]
  const canvasWidth = useCanvasWidth(canvasShellRef)
  // ponytail: 레인 머리글은 노드가 만든 실제 범위를 따르고, 빈 레인은 화면 균등 분할이 아니라 기준 자리(laneAnchor)를 쓴다.
  // 균등 분할은 노드가 있는 이웃 레인과 겹쳐 머리글이 포개진다. 앞 레인 오른쪽 끝 뒤로 한 번 더 밀어 겹침을 막는다.
  const laneHeaders = lanes.reduce<Array<{ left: number; right: number }>>((spans, _lane, index) => {
    const zoom = preferences.viewport?.zoom ?? 1, panX = preferences.viewport?.pan.x ?? 0
    const anchor = laneAnchor(index) * zoom + panX, half = LANE_SPACING * zoom / 2
    const span = laneBounds[index] ?? { left: anchor - half, right: anchor + half }
    const previous = spans[index - 1]
    const shift = previous ? Math.max(0, previous.right + 8 - span.left) : 0
    return [...spans, { left: span.left + shift, right: span.right + shift }]
  }, [])
  const laneHeader = (index: number) => {
    const span = laneHeaders[index] ?? { left: 0, right: 0 }
    return { left: Math.max(span.left, 0), right: Math.min(span.right, canvasWidth || span.right) }
  }
  const focusGap = (gapId: string) => {
    const gap = snapshot.data?.gaps.find((item) => item.id === gapId)
    const group = gap && graph?.groups.find((item) => item.operations.includes(gap.op))
    if (!gap || !group) return
    setNavigation({ ...navigateHierarchy(resolvedNavigation, "operation", group.id, gap.op), operationLimit: resolvedNavigation.groupId === group.id ? resolvedNavigation.operationLimit : GRAPH_PAGE_SIZE, focusCandidateKey: graphCellKey(gap) })
    setSelection({ identity: gap.idn, operation: gap.op, resource: gap.resource, source: null, evidenceIds: [], cellKeys: [graphCellKey(gap)], cells: [], gapIds: [gap.id] } as HierarchySelection)
    setSelectedElementId(null)
    setInspectorOpen(true)
    setFilterOpen(false)
  }
  const zoom = preferences.viewport?.zoom ?? 1
  const adjustZoom = (delta: number) => setPreferences((current) => ({ ...current, viewport: { zoom: clampZoom((current.viewport?.zoom ?? 1) + delta), pan: current.viewport?.pan ?? { x: 0, y: 0 } } }))
  const visibleCount = graph?.nodes.length ?? 0
  const groupLabel = graph?.groups.find((group) => group.id === resolvedNavigation.groupId)?.label ?? resolvedNavigation.groupId
  const operationLabel = resolvedNavigation.level === "operation" ? operationParts(resolvedNavigation.operation) : null

  const filterRail = <div className="h-full bg-[var(--flowscope-pane)] px-4 py-4 text-[13px] leading-5">
    <div className="mb-3 flex items-start justify-between border-b border-border/70 pb-3"><div><p className="font-semibold text-foreground">Graph filters</p><p className="mt-1 text-xs text-muted-foreground">{visibleCount}개 그래프 객체</p></div><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="그래프 저장값 초기화" onClick={() => { resetGraphPreferences(); setPreferences(defaultPreferences); setLayoutVersion((current) => current + 1) }}><RotateCcw className="size-4" /></Button></div>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Sources</legend><div className="grid gap-2.5">{allSources.map((source) => <label className="grid cursor-pointer grid-cols-[1rem_1.5rem_1fr_auto] items-center gap-2" key={source}><Checkbox checked={filters.source.includes(source)} onCheckedChange={() => setFilters((current) => ({ ...current, source: toggle(current.source, source) }))} /><SourceIcon source={source} /><span className="font-medium">{sourceNames[source]}</span><span className="tabular-nums text-muted-foreground">{sourceCount(source)}</span></label>)}</div></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Identities</legend><div className="grid max-h-40 gap-2.5 overflow-y-auto pr-1">{identities.map((identity) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={identity}><Checkbox checked={filters.identity.includes(identity)} onCheckedChange={() => setFilters((current) => ({ ...current, identity: toggle(current.identity, identity) }))} /><span className="truncate font-medium">{identity}</span><span className="tabular-nums text-muted-foreground">{identityCount(identity)}</span></label>)}{!identities.length && <span className="text-xs text-muted-foreground">INCLUDE 신원이 없습니다.</span>}</div></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Verdict</legend><div className="grid gap-2">{reviewStates.map((review) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={review}><Checkbox checked={filters.reviewStates?.includes(review)} onCheckedChange={() => setFilters((current) => ({ ...current, reviewStates: toggle(current.reviewStates ?? reviewStates, review) }))} /><span>{review.toUpperCase()}</span><span className="tabular-nums text-muted-foreground">{reviewCount(review)}</span></label>)}</div></fieldset>
    <section className="border-b border-border/70 py-3" aria-label="Gap"><p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">Gap<span className="rounded-sm border border-gap-edge/50 bg-gap-edge/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-gap-edge">{snapshot.data?.gaps.length ?? 0}개</span></p><div className="grid max-h-40 gap-1 overflow-y-auto">{snapshot.data?.gaps.filter((gap) => gap.type === "UNCROSSED" && (!filters.identity.length || filters.identity.includes(gap.idn)) && graph?.groups.some((group) => group.operations.includes(gap.op))).map((gap) => <Button key={gap.id} size="sm" variant="ghost" className="h-auto justify-start whitespace-normal text-left text-xs" onClick={() => focusGap(gap.id)}><span className="flex min-w-0 flex-wrap items-center gap-1 [overflow-wrap:anywhere]"><span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium">{gap.idn}</span><span aria-hidden="true" className="text-muted-foreground">›</span><span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{stripOrigin(gap.op) || gap.op}</span><span aria-hidden="true" className="text-muted-foreground">›</span><span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{gap.resource ? stripOrigin(gap.resource) || gap.resource : "객체 없음"}</span></span></Button>)}</div></section>

    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Traffic class</legend><label className="flex cursor-pointer items-start gap-2"><Checkbox className="mt-0.5" checked={filters.includeSupportTraffic} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeSupportTraffic: checked === true }))} /><span>인증·화면·반복 보조 흐름 표시</span></label></fieldset>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Route candidates</legend><label className="flex cursor-pointer items-center gap-2"><Checkbox checked={filters.includeRouteCandidates} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeRouteCandidates: checked === true }))} /><span>경로 후보 표시</span></label></fieldset>
    <section className="border-b border-border/70 py-3" aria-label="Role · policy"><p className="mb-1 text-xs font-semibold text-muted-foreground">Role · policy</p><p className="text-xs text-muted-foreground">역할 {Object.keys(snapshot.data?.requiredRoles ?? {}).length} · 소유자 {Object.keys(snapshot.data?.owners ?? {}).length}</p></section>
    <fieldset className="border-b border-border/70 py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">Graph focus</legend><div className="grid gap-2"><Button size="sm" variant="ghost" className="justify-start px-2" disabled={resolvedNavigation.level === "site"} onClick={() => setNavigation({ ...resolvedNavigation, operationLimit: GRAPH_PAGE_SIZE, objectLimit: GRAPH_PAGE_SIZE })}><Expand className="mr-1.5 size-3.5" />18개로 접기</Button><Button size="sm" variant="ghost" className="justify-start px-2" onClick={() => setLayoutVersion((current) => current + 1)}><AlignVerticalSpaceAround className="mr-1.5 size-3.5" />레인 기준 재정렬</Button><Button size="sm" variant={preferences.locked ? "secondary" : "ghost"} className="justify-start px-2" onClick={() => setPreferences((current) => ({ ...current, locked: !current.locked }))}><LockKeyhole className="mr-1.5 size-3.5" />{preferences.locked ? "위치 잠금 해제" : "위치 잠금"}</Button><label className="grid gap-1 text-xs text-muted-foreground">그래프 입력 방식<select aria-label="그래프 입력 방식" className="h-8 rounded-md border border-border bg-background px-2 text-foreground" value={preferences.inputMode} onChange={event => setPreferences(current => ({ ...current, inputMode: event.target.value as GraphPreferences["inputMode"] }))}><option value="auto">자동</option><option value="trackpad">트랙패드</option><option value="mouse">마우스</option></select></label></div></fieldset>
    <fieldset className="py-3"><legend className="mb-2.5 text-xs font-semibold text-muted-foreground">View options</legend><div className="grid grid-cols-2 gap-2"><Button size="sm" variant={filters.view === "source" ? "default" : "outline"} onClick={() => setFilters((current) => ({ ...current, view: "source" }))}>소스 보기</Button><Button size="sm" variant={filters.view === "authz" ? "default" : "outline"} onClick={() => setFilters((current) => ({ ...current, view: "authz" }))}>권한 판정</Button></div></fieldset>
  </div>

  const toolbar = <div role="toolbar" aria-label="그래프 상단 제어" className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[var(--flowscope-pane)] px-4 py-2.5">
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">{viewSwitcher}{graph && <p className="truncate text-xs text-muted-foreground">{graphCountLabel(graph)}</p>}</div>
    <div className="flex flex-wrap items-center gap-1.5"><Button size="sm" variant="outline" className="h-8 px-2.5 text-xs xl:hidden" aria-label="그래프 필터" onClick={() => setFilterOpen(true)}><Filter className="mr-1.5 size-3.5" />필터</Button><Button size="icon-sm" variant="ghost" aria-label="축소" disabled={zoom <= 0.4} onClick={() => adjustZoom(-0.1)}><Minus className="size-3.5" /></Button><span className="w-11 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="확대" disabled={zoom >= GRAPH_MAX_ZOOM - 0.001} onClick={() => adjustZoom(0.1)}><Plus className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="그래프 맞추기" onClick={() => setFitVersion((current) => current + 1)}><Crosshair className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="전체 화면" onClick={() => { void canvasShellRef.current?.requestFullscreen?.() }}><Maximize2 className="size-3.5" /></Button>{!compact && <Button size="sm" variant={listMode ? "secondary" : "ghost"} className="h-8 px-2.5 text-xs" onClick={() => setListMode((current) => !current)}>{listMode ? "그래프 보기" : "API 목록 보기"}</Button>}</div>
  </div>

  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--flowscope-canvas)]" aria-labelledby="graph-title">
    <h1 id="graph-title" className="sr-only">공격면 그래프</h1>
    {snapshot.isError && <Alert variant="destructive" className="m-4"><AlertTitle>그래프를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
    <ReferenceAnalysisWorkspace context={filterRail} toolbar={toolbar} contextOpen={filterOpen} onContextOpenChange={setFilterOpen} inspector={selection && snapshot.data ? <GraphInspectorPanel selection={selection} event={selectedEvent} snapshot={snapshot.data} suspended={snapshot.isError} node={graph?.nodes.find(node => node.id === selectedElementId) ?? null} projection={graph} /> : <p className="p-4 text-sm text-muted-foreground">그래프 노드 또는 Evidence를 선택하면 서버 snapshot 상세를 표시합니다.</p>} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) { setSelection(null); setSelectedElementId(null) } }} ariaLabel="접근 그래프 작업면">
      <nav aria-label="그래프 계층" className="flex min-w-0 items-center gap-2 border-b border-border/70 px-4 py-2 text-xs"><ol className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><li className="shrink-0">{resolvedNavigation.level === "site" ? <span aria-current="page" className="font-semibold">Site Overview</span> : <Button size="sm" variant="link" className="h-auto p-0 text-xs text-sky-700 dark:text-sky-300" onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "site"))}>Site Overview</Button>}</li>{resolvedNavigation.level !== "site" && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className={resolvedNavigation.level === "group" ? "min-w-0" : "shrink-0"}>{resolvedNavigation.level === "group" ? <span aria-current="page" className="block truncate font-semibold" title={groupLabel}>{groupLabel}</span> : <Button size="sm" variant="link" className="h-auto max-w-48 justify-start truncate p-0 text-xs text-sky-700 dark:text-sky-300" title={groupLabel} onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "group", resolvedNavigation.groupId))}>{groupLabel}</Button>}</li></>}{operationLabel && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className="min-w-0"><span aria-current="page" className="block truncate font-semibold" title={`${operationLabel.method} ${operationLabel.path}`}>{operationLabel.method} {operationLabel.path}</span></li></>}</ol>{hiddenCount > 0 && <Button size="sm" variant="outline" className="shrink-0" onClick={expand}>{resolvedNavigation.level === "operation" ? "Object" : "API"} 18개 더 보기 ({hiddenCount}개 남음)</Button>}</nav>
      {snapshot.isLoading && <p className="m-4 rounded-md border border-border/70 p-6 text-sm text-muted-foreground">공격면을 불러오는 중입니다.</p>}
      {graph && (compact || listMode ? <div className="p-4"><ResponsiveGraphList projection={graph} onNavigate={navigateNode} onSelect={(nextSelection, id) => selectGraph(nextSelection, id ?? null)} /></div> : <div ref={canvasShellRef} className="relative min-h-[28rem] flex-1 overflow-hidden"><div className="absolute inset-x-0 top-0 z-10 h-10 border-b border-border/50 bg-[var(--flowscope-canvas)]">{lanes.map((lane, index) => {
        const { left, right } = laneHeader(index)
        return right <= left ? null : <button key={lane} type="button" aria-label={`${lane} 레인 기준 정렬`} className="absolute top-0 flex h-10 items-center justify-center truncate px-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" style={{ left, width: right - left }} onClick={() => setLaneLayout((current) => ({ lane: index, version: current.version + 1 }))}><span className="truncate">{lane}</span></button>
      })}</div><CytoscapeGraph projection={graph} locked={preferences.locked} fitVersion={fitVersion} layoutVersion={layoutVersion} laneLayout={laneLayout} onLaneBoundsChange={setLaneBounds} preferences={preferences} confirmedNodeIds={confirmedNodeIds} selectedElementId={selectedElementId} onNavigate={navigateNode} onStepBack={() => changeNavigation(stepBack(resolvedNavigation))} onSelect={selectGraph} onPreferencesChange={updatePreferences} onRendererUnavailable={() => setListMode(true)} /><div role="list" aria-label="그래프 소스 범례" className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-4 rounded border border-border/70 bg-[var(--flowscope-pane)] px-3 py-1.5 text-[10px] text-muted-foreground"><span role="listitem" className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5 text-blue-600 dark:text-blue-400" />HUMAN</span><span role="listitem" className="flex items-center gap-1.5"><ScanLine aria-hidden="true" className="size-3.5 text-red-600 dark:text-red-400" />SCANNER</span><span role="listitem" className="flex items-center gap-1.5"><Bot aria-hidden="true" className="size-3.5 text-zinc-700 dark:text-zinc-300" />LLM</span></div></div>)}
    </ReferenceAnalysisWorkspace>
  </section>
}
