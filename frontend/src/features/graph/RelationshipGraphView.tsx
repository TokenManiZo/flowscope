import { useEffect, useMemo, useRef, useState } from "react"
import { AlignVerticalSpaceAround, Bot, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Expand, Filter, LockKeyhole, Maximize2, Minus, Plus, RotateCcw, ScanLine, UserRound } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { judgmentTone } from "@/features/matrix/judgmentProjection"
import type { Source, Verdict } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { SourceIcon } from "@/features/evidence/SourceIcon"

import { CytoscapeGraph } from "./CytoscapeGraph"
import { GRAPH_MAX_ZOOM, LANE_SPACING, laneAnchor, type LaneBounds } from "./graphLanes"
import { GraphInspectorPanel, GraphViewOverview } from "./GraphInspectorPanel"
import { loadGraphPreferences, resetGraphPreferences, saveGraphPreferences, type GraphPreferences } from "./graphPreferences"
import { EMPTY_HIGHLIGHT, nodeStatusCodes, projectHighlight, statusGroups, statusHighlightColors, type GraphHighlight } from "./graphHighlight"
import { graphCellKey, graphCellSelection, graphRouteCandidateId, projectRouteCandidate, type GraphFilters, type GraphSelection } from "./graphProjection"
import { GRAPH_PAGE_SIZE, navigateHierarchy, stepBack, projectHierarchy, type GraphNavigation, type HierarchyNode, type HierarchySelection } from "./graphHierarchy"
import { ResponsiveGraphList } from "./ResponsiveGraphList"
import { operationParts } from "./relationshipNodeCard"

const allSources: readonly Source[] = ["human", "scanner", "llm", "unknown"]
/** 레일에서 고를 수 있는 출처. UNKNOWN은 데이터에는 남기되 강조 필터 항목으로는 보이지 않는다. */
const railSources: readonly Source[] = ["human", "scanner", "llm"]
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

function toggle<T>(items: readonly T[], value: T): readonly T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
}

function clampZoom(zoom: number) { return Math.min(GRAPH_MAX_ZOOM, Math.max(0.4, Math.round(zoom * 10) / 10)) }

export function RelationshipGraphView() {
  const snapshot = useSnapshotQuery()
  const compact = useCompactGraph()
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  // 출처·신원은 데이터를 숨기지 않고 강조 필터(highlight)로만 고른다. 투영 필터는 전체 출처·신원을 그대로 둔다.
  const [filters] = useState<GraphFilters>({ source: allSources, identity: [], view: "source", reviewStates, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
  const [highlight, setHighlight] = useState<GraphHighlight>(EMPTY_HIGHLIGHT)
  const [expandedStatus, setExpandedStatus] = useState<readonly string[]>([])
  // 펼친 객체 묶음. 처음에는 모든 묶음이 접혀 있다.
  const [expandedGroups, setExpandedGroups] = useState<readonly string[]>([])
  // 계층 이동 기록. 뒤로·앞으로 버튼은 단계(사이트·그룹·API) 이동만 되돌리고, 18개 더 보기 같은 펼침은 기록하지 않는다.
  const [history, setHistory] = useState<{ past: readonly GraphNavigation[]; future: readonly GraphNavigation[] }>({ past: [], future: [] })
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
  const graph = useMemo(() => snapshot.data ? projectHierarchy(snapshot.data, { ...filters, expandedObjectGroups: expandedGroups }, navigation) : null, [expandedGroups, filters, snapshot.data, navigation])
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
  const identities = [...new Set(includedEvents.map((event) => event.idn))].sort()
  const sourceCount = (source: Source) => includedEvents.filter((event) => event.source === source).length
  const identityCount = (identity: string) => includedEvents.filter((event) => event.idn === identity).length
  const statusGroupList = statusGroups(includedEvents)
  const edgeHighlight = useMemo(() => graph && snapshot.data ? projectHighlight(graph.edges, snapshot.data.events, highlight) : null, [graph, snapshot.data, highlight])
  const statusesByNode = useMemo(() => graph && snapshot.data ? nodeStatusCodes(graph.nodes, snapshot.data.events) : undefined, [graph, snapshot.data])
  const statusColors = useMemo(() => statusHighlightColors(highlight), [highlight])
  const splitSources = useMemo(() => highlight.sources.length > 1 ? allSources.filter((source) => highlight.sources.includes(source)) : [], [highlight.sources])
  // 묶음을 펼치거나 접으면 객체 레인만 다시 세워, 펼친 객체가 묶음 노드 바로 아래에 겹치지 않고 놓이게 한다.
  const toggleObjectGroup = (id: string) => {
    setExpandedGroups((current) => toggle(current, id))
    setLaneLayout((current) => ({ lane: 2, version: current.version + 1 }))
  }
  // 초기화: 고른 필터·펼친 묶음·저장된 배치(위치·확대 비율·잠금)를 모두 처음 상태로 되돌린다.
  const resetGraph = () => {
    setHighlight(EMPTY_HIGHLIGHT)
    setExpandedStatus([])
    setExpandedGroups([])
    resetGraphPreferences()
    setPreferences(defaultPreferences)
    setLayoutVersion((current) => current + 1)
  }
  const toggleStatusGroup = (codes: readonly number[]) => setHighlight((current) => {
    const all = codes.every((status) => current.statuses.includes(status))
    return { ...current, statuses: all ? current.statuses.filter((status) => !codes.includes(status)) : [...new Set([...current.statuses, ...codes])] }
  })
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
  const clearGraphSelection = () => { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
  const changeNavigation = (next: GraphNavigation) => {
    setHistory((current) => ({ past: [...current.past, resolvedNavigation].slice(-50), future: [] }))
    setNavigation(next)
    clearGraphSelection()
  }
  const goBack = () => {
    const previous = history.past.at(-1)
    if (!previous) return
    setHistory({ past: history.past.slice(0, -1), future: [resolvedNavigation, ...history.future] })
    setNavigation(previous)
    clearGraphSelection()
  }
  const goForward = () => {
    const next = history.future[0]
    if (!next) return
    setHistory({ past: [...history.past, resolvedNavigation], future: history.future.slice(1) })
    setNavigation(next)
    clearGraphSelection()
  }
  const navigateNode = (node: HierarchyNode) => {
    if (node.kind === "api-group" && node.groupId) changeNavigation(navigateHierarchy(resolvedNavigation, "group", node.groupId))
    else if (node.kind === "operation" && node.selection.operation) changeNavigation({ ...navigateHierarchy(resolvedNavigation, "operation", resolvedNavigation.groupId, node.selection.operation), operationLimit: resolvedNavigation.operationLimit })
  }
  // 오퍼레이션 레벨은 객체만, 그룹 레벨은 API·객체를 함께 더 펼친다(둘 다 접기/펼치기 대상).
  const expand = () => setNavigation({ ...resolvedNavigation, ...(resolvedNavigation.level === "operation" ? { objectLimit: resolvedNavigation.objectLimit + GRAPH_PAGE_SIZE } : { operationLimit: resolvedNavigation.operationLimit + GRAPH_PAGE_SIZE, objectLimit: resolvedNavigation.objectLimit + GRAPH_PAGE_SIZE }) })
  const hiddenCandidates = graph?.kind === "group" ? Math.max(0, (graph.groups.find((group) => group.id === resolvedNavigation.groupId)?.routeCandidateCount ?? 0) - graph.routeCandidates.length) : 0
  const hiddenCount = graph?.kind === "operation" ? graph.hiddenObjectCount : (graph?.hiddenOperationCount ?? 0) + (graph?.hiddenObjectCount ?? 0) + hiddenCandidates
  const lanes = graph?.kind === "site" ? ["TARGET", "API GROUP"] : ["IDENTITY", "API", "OBJECT"]
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
  const zoom = preferences.viewport?.zoom ?? 1
  const adjustZoom = (delta: number) => setPreferences((current) => ({ ...current, viewport: { zoom: clampZoom((current.viewport?.zoom ?? 1) + delta), pan: current.viewport?.pan ?? { x: 0, y: 0 } } }))
  const groupLabel = graph?.groups.find((group) => group.id === resolvedNavigation.groupId)?.label ?? resolvedNavigation.groupId
  const operationLabel = resolvedNavigation.level === "operation" ? operationParts(resolvedNavigation.operation) : null

  const filterRail = <div className="h-full bg-[var(--flowscope-pane)] px-4 py-4 text-sm leading-6">
    <div className="mb-1 border-b border-border/70 pb-3"><p className="text-[15px] font-semibold text-foreground">Graph filters</p></div>
    <fieldset className="border-b border-border/70 py-5"><legend className="mb-3 text-[13px] font-semibold text-muted-foreground">출처</legend><div className="grid gap-2.5">{railSources.map((source) => <label className="grid cursor-pointer grid-cols-[1rem_1.5rem_1fr_auto] items-center gap-2" key={source}><Checkbox checked={highlight.sources.includes(source)} onCheckedChange={() => setHighlight((current) => ({ ...current, sources: toggle(current.sources, source) }))} /><SourceIcon source={source} /><span className="font-medium">{sourceNames[source]}</span><span className="tabular-nums text-muted-foreground">{sourceCount(source)}</span></label>)}</div></fieldset>
    <fieldset className="border-b border-border/70 py-5"><legend className="mb-3 text-[13px] font-semibold text-muted-foreground">신원</legend><div className="grid gap-2.5">{identities.map((identity) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={identity}><Checkbox checked={highlight.identities.includes(identity)} onCheckedChange={() => setHighlight((current) => ({ ...current, identities: toggle(current.identities, identity) }))} /><span className="truncate font-medium">{identity}</span><span className="tabular-nums text-muted-foreground">{identityCount(identity)}</span></label>)}{!identities.length && <span className="text-xs text-muted-foreground">INCLUDE 신원이 없습니다.</span>}</div></fieldset>
    <fieldset className="border-b border-border/70 py-5"><legend className="mb-3 text-[13px] font-semibold text-muted-foreground">응답 코드</legend><div className="grid gap-1.5">{statusGroupList.map((group) => {
      const codes = group.codes.map((code) => code.status), chosen = codes.filter((status) => highlight.statuses.includes(status)).length
      const open = expandedStatus.includes(group.cls), label = group.cls
      return <div key={group.cls}>
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-1"><Button size="icon-sm" variant="ghost" className="size-5" aria-label={`${label} ${open ? "접기" : "펼치기"}`} aria-expanded={open} disabled={!codes.length} onClick={() => setExpandedStatus((current) => toggle(current, group.cls))}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button><label className={`grid grid-cols-[1rem_1fr_auto] items-center gap-2 ${codes.length ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}><Checkbox disabled={!codes.length} checked={codes.length > 0 && chosen === codes.length ? true : chosen ? "indeterminate" : false} onCheckedChange={() => toggleStatusGroup(codes)} /><span className="font-mono font-medium">{label}</span><span className="tabular-nums text-muted-foreground">{group.total}</span></label></div>
        {open && <div className="mt-1 grid gap-1.5 pl-6">{group.codes.map((code) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={code.status}><Checkbox checked={highlight.statuses.includes(code.status)} onCheckedChange={() => setHighlight((current) => ({ ...current, statuses: toggle(current.statuses, code.status) }))} /><span className="font-mono">{code.status}</span><span className="tabular-nums text-muted-foreground">{code.count}</span></label>)}</div>}
      </div>
    })}</div></fieldset>
    <fieldset className="py-5"><legend className="mb-3 text-[13px] font-semibold text-muted-foreground">그래프 조작</legend><div className="grid gap-2"><Button size="sm" variant="ghost" className="justify-start px-2" disabled={resolvedNavigation.level === "site"} onClick={() => setNavigation({ ...resolvedNavigation, operationLimit: GRAPH_PAGE_SIZE, objectLimit: GRAPH_PAGE_SIZE })}><Expand className="mr-1.5 size-3.5" />18개로 접기</Button><Button size="sm" variant="ghost" className="justify-start px-2" onClick={() => setLayoutVersion((current) => current + 1)}><AlignVerticalSpaceAround className="mr-1.5 size-3.5" />레인 기준 재정렬</Button><Button size="sm" variant={preferences.locked ? "secondary" : "ghost"} className="justify-start px-2" onClick={() => setPreferences((current) => ({ ...current, locked: !current.locked }))}><LockKeyhole className="mr-1.5 size-3.5" />{preferences.locked ? "위치 잠금 해제" : "위치 잠금"}</Button><Button size="sm" variant="ghost" className="justify-start px-2" onClick={resetGraph}><RotateCcw className="mr-1.5 size-3.5" />초기화</Button></div></fieldset>
  </div>

  const toolbar = <div role="toolbar" aria-label="그래프 상단 제어" className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[var(--flowscope-pane)] px-4 py-2.5">
    <div className="flex items-center gap-1.5"><Button size="icon" variant="outline" className="size-9" aria-label="뒤로" disabled={!history.past.length} onClick={goBack}><ChevronLeft className="size-5" /></Button><Button size="icon" variant="outline" className="size-9" aria-label="앞으로" disabled={!history.future.length} onClick={goForward}><ChevronRight className="size-5" /></Button></div>
    <div className="flex flex-wrap items-center gap-1.5"><Button size="sm" variant="outline" className="h-8 px-2.5 text-xs xl:hidden" aria-label="그래프 필터" onClick={() => setFilterOpen(true)}><Filter className="mr-1.5 size-3.5" />필터</Button><Button size="icon-sm" variant="ghost" aria-label="축소" disabled={zoom <= 0.4} onClick={() => adjustZoom(-0.1)}><Minus className="size-3.5" /></Button><span className="w-11 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="확대" disabled={zoom >= GRAPH_MAX_ZOOM - 0.001} onClick={() => adjustZoom(0.1)}><Plus className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="그래프 맞추기" onClick={() => setFitVersion((current) => current + 1)}><Crosshair className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="전체 화면" onClick={() => { void canvasShellRef.current?.requestFullscreen?.() }}><Maximize2 className="size-3.5" /></Button>{!compact && <Button size="sm" variant={listMode ? "secondary" : "ghost"} className="h-8 px-2.5 text-xs" onClick={() => setListMode((current) => !current)}>{listMode ? "그래프 보기" : "API 목록 보기"}</Button>}</div>
  </div>

  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--flowscope-canvas)]" aria-labelledby="graph-title">
    <h1 id="graph-title" className="sr-only">공격면 그래프</h1>
    {snapshot.isError && <Alert variant="destructive" className="m-4"><AlertTitle>그래프를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
    <ReferenceAnalysisWorkspace context={filterRail} contextTitle={false} toolbar={toolbar} contextOpen={filterOpen} onContextOpenChange={setFilterOpen} inspector={selection && snapshot.data ? <GraphInspectorPanel selection={selection} event={selectedEvent} snapshot={snapshot.data} suspended={snapshot.isError} node={graph?.nodes.find(node => node.id === selectedElementId) ?? null} projection={graph} /> : graph && "navigation" in graph ? <GraphViewOverview projection={graph} /> : <p className="p-4 text-sm text-muted-foreground">노드를 누르면 정보가 여기에 나옵니다.</p>} inspectorOpen={inspectorOpen} inspectorPersistent onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) { setSelection(null); setSelectedElementId(null) } }} ariaLabel="접근 그래프 작업면">
      <nav aria-label="그래프 계층" className="flex min-w-0 items-center gap-2 border-b border-border/70 px-4 py-2 text-xs"><ol className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><li className="shrink-0">{resolvedNavigation.level === "site" ? <span aria-current="page" className="font-semibold">Site Overview</span> : <Button size="sm" variant="link" className="h-auto p-0 text-xs text-sky-700 dark:text-sky-300" onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "site"))}>Site Overview</Button>}</li>{resolvedNavigation.level !== "site" && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className={resolvedNavigation.level === "group" ? "min-w-0" : "shrink-0"}>{resolvedNavigation.level === "group" ? <span aria-current="page" className="block truncate font-semibold" title={groupLabel}>{groupLabel}</span> : <Button size="sm" variant="link" className="h-auto max-w-48 justify-start truncate p-0 text-xs text-sky-700 dark:text-sky-300" title={groupLabel} onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "group", resolvedNavigation.groupId))}>{groupLabel}</Button>}</li></>}{operationLabel && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className="min-w-0"><span aria-current="page" className="block truncate font-semibold" title={`${operationLabel.method} ${operationLabel.path}`}>{operationLabel.method} {operationLabel.path}</span></li></>}</ol>{hiddenCount > 0 && <Button size="sm" variant="outline" className="shrink-0" onClick={expand}>{resolvedNavigation.level === "operation" ? "객체" : "노드"} 18개 더 보기 ({hiddenCount}개 남음)</Button>}</nav>
      {snapshot.isLoading && <p className="m-4 rounded-md border border-border/70 p-6 text-sm text-muted-foreground">공격면을 불러오는 중입니다.</p>}
      {graph && (compact || listMode ? <div className="p-4" onClick={(event) => { if (!(event.target as HTMLElement).closest("table, input, button, a")) clearGraphSelection() }}><ResponsiveGraphList projection={graph} snapshot={snapshot.data} selectedId={selectedElementId} onNavigate={navigateNode} onSelect={(nextSelection, id) => selectGraph(nextSelection, id ?? null)} /></div> : <div ref={canvasShellRef} className="relative min-h-[28rem] flex-1 overflow-hidden"><div className="absolute inset-x-0 top-0 z-10 h-10 border-b border-border/50 bg-[var(--flowscope-canvas)]">{lanes.map((lane, index) => {
        const { left, right } = laneHeader(index)
        return right <= left ? null : <button key={lane} type="button" aria-label={`${lane} 레인 기준 정렬`} className="absolute top-0 flex h-10 items-center justify-center truncate px-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" style={{ left, width: right - left }} onClick={() => setLaneLayout((current) => ({ lane: index, version: current.version + 1 }))}><span className="truncate">{lane}</span></button>
      })}</div><CytoscapeGraph projection={graph} statusesByNode={statusesByNode} highlight={edgeHighlight} statusColors={statusColors} splitSources={splitSources} onToggleObjectGroup={toggleObjectGroup} locked={preferences.locked} fitVersion={fitVersion} layoutVersion={layoutVersion} laneLayout={laneLayout} onLaneBoundsChange={setLaneBounds} preferences={preferences} confirmedNodeIds={confirmedNodeIds} selectedElementId={selectedElementId} onNavigate={navigateNode} onStepBack={() => changeNavigation(stepBack(resolvedNavigation))} onClearSelection={clearGraphSelection} onSelect={selectGraph} onPreferencesChange={updatePreferences} onRendererUnavailable={() => setListMode(true)} /><div role="list" aria-label="그래프 소스 범례" className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-4 rounded border border-border/70 bg-[var(--flowscope-pane)] px-3 py-1.5 text-[10px] text-muted-foreground"><span role="listitem" className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5 text-blue-600 dark:text-blue-400" />HUMAN</span><span role="listitem" className="flex items-center gap-1.5"><ScanLine aria-hidden="true" className="size-3.5 text-red-600 dark:text-red-400" />SCANNER</span><span role="listitem" className="flex items-center gap-1.5"><Bot aria-hidden="true" className="size-3.5 text-yellow-600 dark:text-yellow-400" />LLM</span></div></div>)}
    </ReferenceAnalysisWorkspace>
  </section>
}
