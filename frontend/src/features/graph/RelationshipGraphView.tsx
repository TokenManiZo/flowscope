import { graphAccountLabel } from "./graphAccounts"
import { HelpHint } from "@/components/HelpHint"
import { useEffect, useMemo, useRef, useState } from "react"
import { AlignVerticalSpaceAround, Bot, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Filter, LockKeyhole, Maximize2, Minus, Plus, RotateCcw, ScanLine, UserRound } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { apiConfirmed } from "@/features/api-management/apiAppearance"
import { judgmentTone } from "@/features/matrix/judgmentProjection"
import type { Source, Verdict } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { SourceIcon } from "@/features/evidence/SourceIcon"

import { CytoscapeGraph } from "./CytoscapeGraph"
import { GraphSearchInput } from "./GraphSearchInput"
import { buildGraphSearchIndex, searchDestination, searchGraph, searchHighlights, type GraphSearchEntry, type GraphSearchIndex, type SearchDestination } from "./graphSearch"
import { GRAPH_MAX_ZOOM, LANE_SPACING, laneAnchor, type LaneBounds } from "./graphLanes"
import { GraphInspectorPanel, GraphViewOverview } from "./GraphInspectorPanel"
import { operationShapeKey } from "./graphPathShape"
import { type GraphPreferences } from "./graphPreferences"
import { emptyGraphView, emptyGraphWorkspace, graphView, graphViewKey, mergeGraphLayout } from "./graphWorkspace"
import { useGraphWorkspace } from "./useGraphWorkspace"
import { EMPTY_HIGHLIGHT, highlightRecords, nodeStatusCodes, projectHighlight, projectSiteHighlight, statusGroups, statusHighlightColors, type GraphHighlight } from "./graphHighlight"
import { graphCellKey, graphCellSelection, graphRouteCandidateId, projectRouteCandidate, type GraphFilters, type GraphSelection } from "./graphProjection"
import { GRAPH_PAGE_SIZE, graphContents, navigateHierarchy, stepBack, projectHierarchy, type GraphNavigation, type HierarchyNode, type HierarchySelection, isObservedTraffic } from "./graphHierarchy"
import { ResponsiveGraphList } from "./ResponsiveGraphList"
import { operationParts } from "./relationshipNodeCard"
import { projectResendGraph, resendSends, resendToolColors, resendToolNames, type ResendTool } from "./resendGraph"

const allSources: readonly Source[] = ["human", "scanner", "llm", "unknown"]
/** 레일에서 고를 수 있는 출처. UNKNOWN은 데이터에는 남기되 강조 필터 항목으로는 보이지 않는다. */
const railSources: readonly Source[] = ["human", "scanner", "llm"]
const reviewStates: readonly Verdict[] = ["allow", "deny", "suspicious", "undecided", "untested"]
const sourceNames: Record<Source, string> = { human: "HUMAN", scanner: "SCANNER", llm: "LLM", unknown: "UNKNOWN" }
const supportTrafficClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])
const emptySearchIndex: GraphSearchIndex = { entries: [], byKey: new Map() }
const resendTools: readonly ResendTool[] = ["lab", "repeater"]
const noop = () => {}

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
  const dataset = useSnapshotQuery().data?.datasetRevision ?? 0
  return <ProjectGraphView key={dataset} dataset={dataset} />
}

type Change<T> = T | ((current: T) => T)
function changed<T>(change: Change<T>, current: T): T { return typeof change === "function" ? (change as (current: T) => T)(current) : change }

function ProjectGraphView({ dataset }: { dataset: number }) {
  const snapshot = useSnapshotQuery()
  const graphData = snapshot.data
  const workspaceState = useGraphWorkspace(dataset)
  const workspace = workspaceState.workspace ?? emptyGraphWorkspace
  const navigation = workspace.navigation
  const viewKey = graphViewKey(navigation)
  const view = graphView(workspace, navigation)
  const [openObjectGroup, setOpenObjectGroup] = useState<{ view: string; id: string } | null>(null)
  const openObjectGroupId = openObjectGroup?.view === viewKey ? openObjectGroup.id : null
  const expandedGroups = useMemo(() => [...view.expandedGroups.filter(id => !id.startsWith("object-group:")), ...(openObjectGroupId ? [openObjectGroupId] : [])], [view.expandedGroups, openObjectGroupId])
  const preferences: GraphPreferences = { version: 7, positions: view.positions, sizes: view.sizes, viewport: view.viewport, locked: workspace.locked, inputMode: workspace.inputMode }
  const compact = useCompactGraph()
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const listShellRef = useRef<HTMLDivElement | null>(null)
  // 출처·신원은 데이터를 숨기지 않고 강조 필터(highlight)로만 고른다. 투영 필터는 전체 출처·신원을 그대로 둔다.
  // 보기 범위: 기본은 판정 셀이 있는 핵심 API만, "관측 전체"는 정적 파일을 뺀 관측 요청을 판정 없이 함께 그린다.
  const [filters, setFilters] = useState<GraphFilters>({ source: allSources, identity: [], view: "source", reviewStates, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false })
  const [highlight, setHighlight] = useState<GraphHighlight>(EMPTY_HIGHLIGHT)
  // 보기: 수집 그래프(판정·Gap 기준)와 재전송 그래프(Request Lab·Repeater로 고쳐 보낸 요청)를 섞지 않고 따로 본다.
  const [graphMode, setGraphMode] = useState<"collected" | "resend">("collected")
  const [shownResendTools, setShownResendTools] = useState<readonly ResendTool[]>(resendTools)
  const resend = graphMode === "resend"
  const [expandedStatus, setExpandedStatus] = useState<readonly string[]>([])
  // 계층 이동 기록. 뒤로·앞으로 버튼은 단계(사이트·그룹·API) 이동만 되돌리고, 18개 더 보기 같은 펼침은 기록하지 않는다.
  const [history, setHistory] = useState<{ past: readonly GraphNavigation[]; future: readonly GraphNavigation[] }>({ past: [], future: [] })
  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [fitVersion, setFitVersion] = useState(0)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [laneLayout, setLaneLayout] = useState({ lane: 0, version: 0 })
  const [laneBounds, setLaneBounds] = useState<ReadonlyArray<LaneBounds | null>>([])
  const [listMode, setListMode] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [searchLimit, setSearchLimit] = useState(30)
  const searchIndex = useMemo(() => graphData ? buildGraphSearchIndex(graphData, filters) : emptySearchIndex, [graphData, filters])
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchTerm(""); return }
    const timer = window.setTimeout(() => setSearchTerm(searchQuery), 120)
    return () => window.clearTimeout(timer)
  }, [searchQuery])
  const [searchAnchor, setSearchAnchor] = useState<{ key?: string; destination: SearchDestination } | null>(null)
  const [pendingSearch, setPendingSearch] = useState<{ key?: string; destination: SearchDestination; requestId: number } | null>(null)
  const [revealRequest, setRevealRequest] = useState<{ nodeId: string; requestId: number } | null>(null)
  const searchRequestId = useRef(0)
  const anchor = searchAnchor && (!searchAnchor.key || searchIndex.byKey.has(searchAnchor.key)) && graphViewKey(searchAnchor.destination.navigation) === viewKey ? searchAnchor : null
  const setExpandedGroups = (change: Change<readonly string[]>) => workspaceState.update(current => {
    const saved = current.views[viewKey] ?? emptyGraphView
    return { ...current, views: { ...current.views, [viewKey]: { ...saved, expandedGroups: changed(change, saved.expandedGroups.filter(id => !id.startsWith("object-group:"))) } } }
  })
  const setPreferences = (change: Change<GraphPreferences>) => workspaceState.update(current => {
    const saved = current.views[viewKey] ?? emptyGraphView
    const next = changed(change, { version: 7, ...graphView(current, navigation), locked: current.locked, inputMode: current.inputMode })
    if (next.locked === current.locked && next.inputMode === current.inputMode && JSON.stringify(saved.viewport) === JSON.stringify(next.viewport)) return current
    return { ...current, locked: next.locked, inputMode: next.inputMode, views: { ...current.views, [viewKey]: { ...saved, viewport: next.viewport } } }
  })
  const setNavigation = (next: GraphNavigation) => {
    if (JSON.stringify(next) === JSON.stringify(navigation)) return
    if (graphViewKey(next) !== viewKey) { setOpenObjectGroup(null); setFitVersion(0); setLayoutVersion(0); setLaneLayout({ lane: 0, version: 0 }) }
    workspaceState.update(current => ({ ...current, navigation: next }))
  }
  const collectedGraph = useMemo(() => graphData && workspaceState.workspace ? projectHierarchy(graphData, { ...filters, expandedObjectGroups: expandedGroups }, navigation, anchor?.destination.reveal) : null, [expandedGroups, filters, graphData, navigation, workspaceState.workspace !== null, anchor])
  const sends = useMemo(() => graphData ? resendSends(snapshot.data!) : [], [graphData])
  const resendGraph = useMemo(() => resend && graphData && workspaceState.workspace ? projectResendGraph(snapshot.data!, navigation, filters.view, shownResendTools) : null, [resend, graphData, workspaceState.workspace !== null, navigation, filters.view, shownResendTools])
  const graph = resend ? resendGraph : collectedGraph
  const results = useMemo(() => searchGraph(searchIndex, searchQuery.trim() ? searchTerm : "", navigation, searchLimit), [searchIndex, searchTerm, searchQuery.trim() === "", navigation, searchLimit])
  const searchMatches = useMemo(() => graph ? searchHighlights(graph, results.keys) : new Map<string, "direct" | "member">(), [graph, results.keys])
  const confirmedNodeIds = useMemo(() => {
    const matrix = graphData?.authorizationMatrix
    if (!graph || !graphData) return new Set<string>()
    const confirmed = [...(matrix?.functions ?? []), ...(matrix?.objects ?? []), ...(matrix?.evidence ?? [])].filter(item => item.reviewStatus === "CONFIRMED" && judgmentTone(item.status) === "risk")
    return new Set(graph.nodes.filter(node => node.kind === "operation"
      ? (apiConfirmed(graphData!, node.selection.operation ?? "") || confirmed.some(item => item.operation === node.selection.operation))
      : node.kind === "resource" && confirmed.some(item => "resource" in item && item.operation === node.selection.operation && item.resource === node.selection.resource)).map(node => node.id))
  }, [graph, graphData])
  const resolvedNavigation = graph?.navigation ?? navigation
  // 필터·snapshot 변화로 현재 단계가 사라지면 projection이 상위 단계로 되돌리고, 선택도 함께 비운다.
  useEffect(() => { if (graph && graph.navigation !== navigation) { setNavigation(graph.navigation); setSelection(null); setSelectedElementId(null); setInspectorOpen(false) } }, [graph, navigation])

  useEffect(() => {
    if (snapshot.isError) return
    if (!selection) return
    if (selection.routeCandidate) {
      const currentCandidate = graphData?.routeCandidates.find((candidate) => graphRouteCandidateId(candidate) === selection.routeCandidate?.id)
      if (!currentCandidate) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
      else {
        const currentSelection = projectRouteCandidate(currentCandidate, new Set(filters.source)).selection
        if (JSON.stringify(currentSelection) !== JSON.stringify(selection)) setSelection(currentSelection)
      }
      return
    }
    const projectedSelection = graph?.nodes.find(node => node.id === selectedElementId)?.selection ?? graph?.edges.find(edge => edge.id === selectedElementId)?.selection
    if (projectedSelection) {
      if (JSON.stringify(projectedSelection) !== JSON.stringify(selection)) setSelection(projectedSelection)
      return
    }
    if (selectedElementId && ["observed-operation:", "support-operation:"].some(prefix => selectedElementId.startsWith(prefix))) {
      clearGraphSelection()
      return
    }
    // 계층 선택은 서버 셀 key로 현재 snapshot과 재조정한다. 셀이 모두 사라지면 선택을 비우고, 일부만 남으면 남은 셀·Gap ID로 갱신한다.
    const cellSelection = selection as Partial<HierarchySelection>
    if (cellSelection.cells?.length && graphData) {
      const selectedKeys = new Set(cellSelection.cellKeys)
      const cells = graphData.cells.filter((cell) => selectedKeys.has(graphCellKey(cell)) && (!selection.evidenceIds.length || cell.evidenceIds.some(id => selection.evidenceIds.includes(id))))
      if (!cells.length) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false); return }
      const currentKeys = new Set(cells.map(graphCellKey))
      const gapIds = graphData.gaps.filter((gap) => currentKeys.has(graphCellKey(gap))).map((gap) => gap.id)
      if (cells.length !== cellSelection.cells.length || cells.some((cell, index) => cell !== cellSelection.cells?.[index]) || JSON.stringify(gapIds) !== JSON.stringify(cellSelection.gapIds ?? [])) {
        setSelection({ ...selection, ...graphCellSelection(cells, selection.source), gapIds } as HierarchySelection)
      }
      return
    }
    // Target·API 그룹 노드는 셀 없이 요약만 여는 선택이라, 노드가 화면에 남아 있는 동안 유지한다.
    if (!cellSelection.cellKeys?.length && selectedElementId && graph?.nodes.some((node) => node.id === selectedElementId && (node.kind === "target" || node.kind === "api-group"))) return
    const currentCell = cellSelection.cellKeys?.some((key) => graphData?.cells.some((cell) => graphCellKey(cell) === key))
    const currentGap = cellSelection.gapIds?.some((id) => graphData?.gaps.some((gap) => gap.id === id))
    const currentEvent = selection.evidenceIds.some((id) => graphData?.events.some((event) => event.eventId === id || event.clusterEvidenceIds?.includes(id)))
    if (!currentCell && !currentGap && !currentEvent) { setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
  }, [filters.source, graph, selectedElementId, selection, graphData, snapshot.isError])

  const shownSendIds = new Set(sends.filter(send => shownResendTools.includes(send.tool)).map(send => send.eventId))
  const includedEvents = (graphData?.events ?? []).filter((event) => resend ? shownSendIds.has(event.eventId)
    : filters.includeSupportTraffic
      ? event.trafficDisposition === "INCLUDE" || isObservedTraffic(event)
      : event.trafficDisposition === "INCLUDE" && !supportTrafficClasses.has(event.trafficClass))
  const identities = [...new Set(includedEvents.map((event) => event.idn))].sort()
  const sourceCount = (source: Source) => includedEvents.filter((event) => event.source === source).length
  const identityCount = (identity: string) => includedEvents.filter((event) => event.idn === identity).length
  const statusGroupList = statusGroups(includedEvents)
  // Site Overview는 묶음 안의 기록으로 필터를 판정하며, 구조 엣지의 색은 그대로 둔다.
  const edgeHighlight = useMemo(() => {
    if (!graph || !graphData) return null
    if (graph.kind !== "site") return projectHighlight(graph.edges, graphData.events, highlight)
    return projectSiteHighlight(graph, graphData.events, highlight, graphContents(graphData, filters))
  }, [graph, graphData, filters, highlight])
  const statusesByNode = useMemo(() => graph && graphData ? nodeStatusCodes(graph.nodes, graphData.events) : undefined, [graph, graphData])
  const statusColors = useMemo(() => statusHighlightColors(highlight), [highlight])
  const splitSources = useMemo(() => highlight.sources.length > 1 ? allSources.filter((source) => highlight.sources.includes(source)) : [], [highlight.sources])
  // 객체 집중 펼침은 화면 메모리에서만 관리한다. API 묶음은 기존 프로젝트 저장을 유지한다.
  const toggleObjectGroup = (id: string) => {
    cancelSearchMove()
    if (!id.startsWith("object-group:")) { setExpandedGroups(current => toggle(current, id)); return }
    if (openObjectGroupId === id) { clearGraphSelection(); return }
    const node = graph?.nodes.find(node => node.id === id)
    if (!node) return
    selectGraph(node.selection, id)
    setOpenObjectGroup({ view: viewKey, id })
  }
  useEffect(() => {
    if (openObjectGroupId && (!selection || !graph?.nodes.some(node => node.id === openObjectGroupId))) setOpenObjectGroup(null)
  }, [openObjectGroupId, graph, selection])
  // 초기화: 고른 필터·펼친 묶음·저장된 배치(위치·확대 비율·잠금)를 모두 처음 상태로 되돌린다.
  const resetGraph = () => {
    setOpenObjectGroup(null)
    setSearchAnchor(null); setPendingSearch(null); setRevealRequest(null)
    setHighlight(EMPTY_HIGHLIGHT)
    setFilters((current) => ({ ...current, includeSupportTraffic: false }))
    setGraphMode("collected")
    setShownResendTools(resendTools)
    setExpandedStatus([])
    setExpandedGroups([])
    workspaceState.update(current => {
      const views = { ...current.views }
      delete views.legacy
      return { ...current, locked: false, views: { ...views, [viewKey]: emptyGraphView } }
    })
    setLayoutVersion((current) => current + 1)
    setFitVersion((current) => current + 1)
  }
  const toggleStatusGroup = (codes: readonly number[]) => setHighlight((current) => {
    const all = codes.every((status) => current.statuses.includes(status))
    return { ...current, statuses: all ? current.statuses.filter((status) => !codes.includes(status)) : [...new Set([...current.statuses, ...codes])] }
  })
  const inspectorSnapshot = useMemo(() => snapshot.data && !resend ? highlightRecords(snapshot.data, highlight) : snapshot.data, [snapshot.data, highlight, resend])
  const inspectorSelection = useMemo(() => {
    if (!selection || !inspectorSnapshot || inspectorSnapshot === snapshot.data || !("cells" in selection)) return selection
    const keys = new Set(inspectorSnapshot.cells.map(graphCellKey))
    const cells = (selection as HierarchySelection).cells.filter(cell => keys.has(graphCellKey(cell)))
    const scoped = graphCellSelection(cells, selection.source)
    const evidence = new Set(inspectorSnapshot.events.flatMap(event => [event.eventId, ...(event.clusterEvidenceIds ?? [])]))
    return { ...selection, ...scoped, operation: selection.operation, resource: selection.resource, evidenceIds: selection.evidenceIds.filter(id => evidence.has(id) || !highlight.statuses.length && !highlight.sources.length && scoped.evidenceIds.includes(id)), gapIds: ((selection as HierarchySelection).gapIds ?? []).filter(id => inspectorSnapshot.gaps.some(gap => gap.id === id && keys.has(graphCellKey(gap)))) }
  }, [selection, inspectorSnapshot, snapshot.data, highlight])
  const selectedEvent = inspectorSelection ? inspectorSnapshot?.events.find((event) => (inspectorSelection.source === null || event.source === inspectorSelection.source) && (inspectorSelection.identity === null || event.idn === inspectorSelection.identity) && (inspectorSelection.operation === null || event.op === inspectorSelection.operation) && (inspectorSelection.resource === null || event.resource === inspectorSelection.resource) && (inspectorSelection.evidenceIds.includes(event.eventId) || (event.clusterEvidenceIds ?? []).some((id) => inspectorSelection.evidenceIds.includes(id)))) ?? null : null
  const updatePreferences = (update: Pick<GraphPreferences, "positions" | "viewport" | "sizes">) => workspaceState.update(current => {
    const saved = current.views[viewKey] ?? emptyGraphView, next = mergeGraphLayout(saved, update)
    return next === saved ? current : { ...current, views: { ...current.views, [viewKey]: next } }
  })
  const selectGraph = (nextSelection: GraphSelection, elementId: string | null) => {
    if (snapshot.isError) return
    setPendingSearch(null); setRevealRequest(null)
    if (openObjectGroupId) {
      const group = graph?.nodes.find(node => node.id === openObjectGroupId)
      if (elementId !== openObjectGroupId && !group?.objectGroup?.members.some(member => elementId === `resource:${member}`)) setOpenObjectGroup(null)
    }
    setSelection(nextSelection)
    setSelectedElementId(elementId)
    setInspectorOpen(true)
  }
  const cancelSearchMove = () => { setPendingSearch(null); setRevealRequest(null) }
  const clearGraphSelection = () => { setOpenObjectGroup(null); cancelSearchMove(); setSelection(null); setSelectedElementId(null); setInspectorOpen(false) }
  const changeNavigation = (next: GraphNavigation) => {
    setSearchAnchor(null)
    setHistory((current) => ({ past: [...current.past, resolvedNavigation].slice(-50), future: [] }))
    setNavigation(next)
    clearGraphSelection()
  }
  const goBack = () => {
    const previous = history.past.at(-1)
    if (!previous) return
    setSearchAnchor(null)
    setHistory({ past: history.past.slice(0, -1), future: [resolvedNavigation, ...history.future] })
    setNavigation(previous)
    clearGraphSelection()
  }
  const goForward = () => {
    const next = history.future[0]
    if (!next) return
    setSearchAnchor(null)
    setHistory({ past: [...history.past, resolvedNavigation], future: history.future.slice(1) })
    setNavigation(next)
    clearGraphSelection()
  }
  const moveToSearch = (destination: SearchDestination, key?: string) => {
    if (snapshot.isError || !workspaceState.workspace) return
    if (graphViewKey(destination.navigation) !== viewKey) {
      setHistory(current => ({ past: [...current.past, resolvedNavigation].slice(-50), future: [] }))
      setFitVersion(0); setLayoutVersion(0); setLaneLayout({ lane: 0, version: 0 })
    }
    clearGraphSelection()
    setSearchAnchor({ key, destination })
    setPendingSearch({ key, destination, requestId: ++searchRequestId.current })
    workspaceState.update(current => {
      const key = graphViewKey(destination.navigation), saved = current.views[key] ?? emptyGraphView
      const expanded = [...new Set([...saved.expandedGroups.filter(id => !id.startsWith("object-group:")), ...destination.expand])]
      const moved = JSON.stringify(current.navigation) !== JSON.stringify(destination.navigation)
      const unfolded = expanded.length !== saved.expandedGroups.length
      if (!moved && !unfolded) return current
      return { ...current, navigation: moved ? destination.navigation : current.navigation, views: unfolded ? { ...current.views, [key]: { ...saved, expandedGroups: expanded } } : current.views }
    })
  }
  const chooseSearch = (entry: GraphSearchEntry) => {
    const latest = searchIndex.byKey.get(entry.key)
    if (!latest) return
    if (latest.kind === "target") setListMode(false)
    moveToSearch(searchDestination(latest, resolvedNavigation, graph, compact || listMode), latest.key)
  }
  useEffect(() => {
    if (!revealRequest || !(compact || listMode)) return
    const frame = requestAnimationFrame(() => {
      const target = [...(listShellRef.current?.querySelectorAll<HTMLElement>("[data-graph-node-id]") ?? [])].find(element => element.dataset.graphNodeId === revealRequest.nodeId)
      target?.scrollIntoView?.({ block: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [revealRequest, compact, listMode])
  // 투영이 완료된 뒤 실제 선택을 적용한다. 새 선택·계층 이동·데이터 교체는 이전 대기를 취소한다.
  useEffect(() => {
    if (!pendingSearch || !graph) return
    if (snapshot.isError || pendingSearch.key && !searchIndex.byKey.has(pendingSearch.key)) { setPendingSearch(null); return }
    if (graphViewKey(graph.navigation) !== graphViewKey(pendingSearch.destination.navigation)) { setPendingSearch(null); return }
    const target = graph.nodes.find(node => node.id === pendingSearch.destination.nodeId && !node.hiddenInGraph)
    if (!target) { setPendingSearch(null); return }
    selectGraph(target.selection, target.id)
    setRevealRequest({ nodeId: target.id, requestId: pendingSearch.requestId })
  }, [graph, pendingSearch, searchIndex, snapshot.isError])
  const scopeActions = {
    onOpenRequestLab: () => setOpenObjectGroup(null),
    onRevealOperation: (groupId: string, operation: string) => {
      moveToSearch({ navigation: navigateHierarchy(resolvedNavigation, "group", groupId), nodeId: `operation:${operation}`, reveal: { operations: [operation] }, expand: [`operation-group:${operationShapeKey(operation)}`] })
    },
    onSelectGroup: (groupId: string) => {
      const target = graph && "navigation" in graph ? graph.nodes.find(node => node.kind === "api-group" && node.groupId === groupId) : undefined
      if (target) selectGraph(target.selection, target.id)
    },
    onOpenGroup: (groupId: string) => changeNavigation(navigateHierarchy(resolvedNavigation, "group", groupId)),
  }
  const navigateNode = (node: HierarchyNode) => {
    if (node.kind === "api-group" && node.groupId) changeNavigation(navigateHierarchy(resolvedNavigation, "group", node.groupId))
    else if (node.kind === "operation" && node.selection.operation) changeNavigation({ ...navigateHierarchy(resolvedNavigation, "operation", resolvedNavigation.groupId, node.selection.operation), operationLimit: resolvedNavigation.operationLimit })
  }
  // 오퍼레이션 레벨은 객체만, 그룹 레벨은 API·객체를 함께 더 펼친다(둘 다 접기/펼치기 대상).
  const expand = () => setNavigation({ ...resolvedNavigation, ...(resolvedNavigation.level === "operation" ? { objectLimit: resolvedNavigation.objectLimit + GRAPH_PAGE_SIZE } : { operationLimit: resolvedNavigation.operationLimit + GRAPH_PAGE_SIZE, objectLimit: resolvedNavigation.objectLimit + GRAPH_PAGE_SIZE }) })
  const hiddenCandidates = graph?.kind === "group" ? Math.max(0, (graph.groups.find((group) => group.id === resolvedNavigation.groupId)?.routeCandidateCount ?? 0) - graph.routeCandidates.length) : 0
  const hiddenCount = graph?.kind === "operation" ? graph.hiddenObjectCount : (graph?.hiddenOperationCount ?? 0) + (graph?.hiddenObjectCount ?? 0) + hiddenCandidates
  const clearSearchAnchor = (next: GraphNavigation = navigation) => {
    setSearchAnchor(null); cancelSearchMove()
    if (next !== navigation) setNavigation(next)
    const base = graphData && projectHierarchy(graphData, { ...filters, expandedObjectGroups: expandedGroups }, next)
    if (selectedElementId && !base?.nodes.some(node => node.id === selectedElementId && !node.hiddenInGraph)) clearGraphSelection()
  }
  const lanes = resend ? ["보낸 신원", "재전송한 API", "OBJECT"] : graph?.kind === "site" ? ["TARGET", "API GROUP"] : ["IDENTITY", "API", "OBJECT"]
  const changeGraphMode = (next: "collected" | "resend") => {
    if (next === graphMode) return
    clearGraphSelection()
    setSearchAnchor(null)
    setGraphMode(next)
  }
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
  const adjustZoom = (delta: number) => { cancelSearchMove(); setPreferences((current) => ({ ...current, viewport: { zoom: clampZoom((current.viewport?.zoom ?? 1) + delta), pan: current.viewport?.pan ?? { x: 0, y: 0 } } })) }
  const groupLabel = graph?.groups.find((group) => group.id === resolvedNavigation.groupId)?.label ?? resolvedNavigation.groupId
  const operationLabel = resolvedNavigation.level === "operation" ? operationParts(resolvedNavigation.operation) : null

  const graphModeControl = <div className="flex min-w-0 items-center gap-1" role="group" aria-label="그래프 기록 보기">
    <div className="grid min-w-0 flex-1 grid-cols-2 rounded-md border border-border p-0.5">{([["collected", "수집 그래프"], ["resend", "재전송 보기"]] as const).map(([mode, label]) => <Button key={mode} size="sm" className="h-8 px-1 text-xs" variant={graphMode === mode ? "secondary" : "ghost"} aria-pressed={graphMode === mode} onClick={() => changeGraphMode(mode)}>{label}</Button>)}</div>
  </div>

  const filterRail = <div className="h-full bg-[var(--flowscope-pane)] px-4 py-4 text-sm leading-6">
    <div className="mb-1 border-b border-border/70 pb-3"><p className="text-[15px] font-semibold text-foreground">그래프 필터</p></div>
    <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground"><span className="flex items-center gap-1">보기<HelpHint label="그래프 기록 보기">수집 그래프는 탐색 중 수집한 요청을 보여 주며 판정·Gap의 기준입니다. 재전송은 Request Lab·Repeater로 값을 바꿔 보낸 요청이며 판정·Gap에 쓰지 않습니다.</HelpHint></span></legend>{graphModeControl}</fieldset>
    {resend && <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground">재전송 도구</legend><div className="grid gap-2.5">{resendTools.map((tool) => <label className="grid cursor-pointer grid-cols-[1rem_0.75rem_1fr_auto] items-center gap-2" key={tool}><Checkbox checked={shownResendTools.includes(tool)} onCheckedChange={() => { clearGraphSelection(); setShownResendTools((current) => toggle(current, tool)) }} /><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: resendToolColors[tool] }} /><span className="font-medium">{resendToolNames[tool]}</span><span className="tabular-nums text-muted-foreground">{sends.filter(send => send.tool === tool).length}</span></label>)}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Burp Intruder 요청은 그래프에 넣지 않고 요청 기록에만 남깁니다.</p></fieldset>}
    {!resend && <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground"><span className="flex items-center gap-1">보기 범위<HelpHint label="보기 범위">{filters.includeSupportTraffic ? "정적 파일(CSS·JS·이미지·폰트)을 제외한 관측 요청을 보여 줍니다. 추가로 보이는 요청은 판정에 쓰지 않습니다." : "인가 판정에 쓰는 요청만 보여 줍니다."}</HelpHint></span></legend><div className="grid min-w-0 grid-cols-2 rounded-md border border-border p-0.5">{([[false, "핵심 API만"], [true, "관측 전체"]] as const).map(([broad, label]) => <Button key={label} size="sm" className="h-8 px-1 text-xs" variant={filters.includeSupportTraffic === broad ? "secondary" : "ghost"} aria-pressed={filters.includeSupportTraffic === broad} onClick={() => setFilters((current) => ({ ...current, includeSupportTraffic: broad }))}>{label}</Button>)}</div></fieldset>}
    <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground">출처</legend><div className="grid gap-2.5">{railSources.map((source) => <label className="grid cursor-pointer grid-cols-[1rem_1.5rem_1fr_auto] items-center gap-2" key={source}><Checkbox checked={highlight.sources.includes(source)} onCheckedChange={() => setHighlight((current) => ({ ...current, sources: toggle(current.sources, source) }))} /><SourceIcon source={source} /><span className="font-medium">{sourceNames[source]}</span><span className="tabular-nums text-muted-foreground">{sourceCount(source)}</span></label>)}</div></fieldset>
    <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground">신원</legend><div className="grid gap-2.5">{identities.map((identity) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={identity}><Checkbox checked={highlight.identities.includes(identity)} onCheckedChange={() => setHighlight((current) => ({ ...current, identities: toggle(current.identities, identity) }))} /><span className="truncate font-medium">{graphData ? graphAccountLabel(graphData, identity) : identity}</span><span className="tabular-nums text-muted-foreground">{identityCount(identity)}</span></label>)}{!identities.length && <span className="text-xs text-muted-foreground">INCLUDE 신원이 없습니다.</span>}</div></fieldset>
    <fieldset className="border-b border-border/70 pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground">응답 코드</legend><div className="grid gap-1.5">{statusGroupList.map((group) => {
      const codes = group.codes.map((code) => code.status), chosen = codes.filter((status) => highlight.statuses.includes(status)).length
      const open = expandedStatus.includes(group.cls), label = group.cls
      return <div key={group.cls}>
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-1"><Button size="icon-sm" variant="ghost" className="size-5" aria-label={`${label} ${open ? "접기" : "펼치기"}`} aria-expanded={open} disabled={!codes.length} onClick={() => setExpandedStatus((current) => toggle(current, group.cls))}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button><label className={`grid grid-cols-[1rem_1fr_auto] items-center gap-2 ${codes.length ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}><Checkbox disabled={!codes.length} checked={codes.length > 0 && chosen === codes.length ? true : chosen ? "indeterminate" : false} onCheckedChange={() => toggleStatusGroup(codes)} /><span className="font-mono font-medium">{label}</span><span className="tabular-nums text-muted-foreground">{group.total}</span></label></div>
        {open && <div className="mt-1 grid gap-1.5 pl-6">{group.codes.map((code) => <label className="grid cursor-pointer grid-cols-[1rem_1fr_auto] items-center gap-2" key={code.status}><Checkbox checked={highlight.statuses.includes(code.status)} onCheckedChange={() => setHighlight((current) => ({ ...current, statuses: toggle(current.statuses, code.status) }))} /><span className="font-mono">{code.status}</span><span className="tabular-nums text-muted-foreground">{code.count}</span></label>)}</div>}
      </div>
    })}</div></fieldset>
    <fieldset className="pb-4"><legend className="mb-1 text-[13px] font-semibold text-muted-foreground">그래프 조작</legend><div className="grid gap-2"><Button size="sm" variant="ghost" className="justify-start px-2" onClick={() => setLayoutVersion((current) => current + 1)}><AlignVerticalSpaceAround className="mr-1.5 size-3.5" />레인 기준 재정렬</Button><Button size="sm" variant={preferences.locked ? "secondary" : "ghost"} className="justify-start px-2" onClick={() => setPreferences((current) => ({ ...current, locked: !current.locked }))}><LockKeyhole className="mr-1.5 size-3.5" />{preferences.locked ? "위치 잠금 해제" : "위치 잠금"}</Button><Button size="sm" variant="ghost" className="justify-start px-2" onClick={resetGraph}><RotateCcw className="mr-1.5 size-3.5" />초기화</Button></div></fieldset>
  </div>

  const toolbar = <div role="toolbar" aria-label="그래프 상단 제어" className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[var(--flowscope-pane)] px-4 py-2.5">
    <div className="flex items-center gap-1.5"><Button size="icon" variant="outline" className="size-9" aria-label="뒤로" disabled={!history.past.length} onClick={goBack}><ChevronLeft className="size-5" /></Button><Button size="icon" variant="outline" className="size-9" aria-label="앞으로" disabled={!history.future.length} onClick={goForward}><ChevronRight className="size-5" /></Button>{!compact && <div role="group" aria-label="보기 전환" className="ml-2 flex rounded-md border border-border p-0.5">{([["그래프", false], ["목록", true]] as const).map(([label, list]) => <Button key={label} size="sm" variant={listMode === list ? "secondary" : "ghost"} className="h-8 px-3 text-sm" aria-pressed={listMode === list} onClick={() => { setOpenObjectGroup(null); setListMode(list) }}>{label}</Button>)}</div>}</div>
    {/* 검색은 수집 그래프의 계층(사이트·묶음·API)으로 이동한다. 재전송 보기에서는 숨긴다. */}
    {!resend && <GraphSearchInput query={searchQuery} results={results} disabled={snapshot.isError || !workspaceState.workspace} searching={searchQuery !== searchTerm && !!searchQuery.trim()} canvas={canvasShellRef} onQuery={query => { setSearchQuery(query); setSearchLimit(30) }} onMore={() => setSearchLimit(current => current + 30)} onChoose={chooseSearch} />}
    <div className="flex flex-wrap items-center gap-1.5"><Button size="sm" variant="outline" className="h-8 px-2.5 text-xs xl:hidden" aria-label="그래프 필터" onClick={() => setFilterOpen(true)}><Filter className="mr-1.5 size-3.5" />필터</Button><Button size="icon-sm" variant="ghost" aria-label="축소" disabled={zoom <= 0.4} onClick={() => adjustZoom(-0.1)}><Minus className="size-3.5" /></Button><span className="w-11 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="확대" disabled={zoom >= GRAPH_MAX_ZOOM - 0.001} onClick={() => adjustZoom(0.1)}><Plus className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="그래프 맞추기" onClick={() => setFitVersion((current) => current + 1)}><Crosshair className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" aria-label="전체 화면" onClick={() => { void canvasShellRef.current?.requestFullscreen?.() }}><Maximize2 className="size-3.5" /></Button></div>
  </div>

  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--flowscope-canvas)]" aria-labelledby="graph-title">
    <h1 id="graph-title" className="sr-only">공격면 그래프</h1>
    {workspaceState.error && <Alert variant="destructive" className="m-4"><AlertTitle>그래프 배치를 저장하거나 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{workspaceState.error}</p><p>화면의 변경은 아직 프로젝트에 반영되지 않았을 수 있습니다. 다시 불러오면 미저장 변경을 버리고 저장된 배치로 돌아갑니다.</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void workspaceState.retry().catch(() => {})}>다시 저장</Button><Button variant="outline" size="sm" onClick={() => void workspaceState.reload()}>저장된 배치 다시 불러오기</Button></div></AlertDescription></Alert>}
    {!workspaceState.workspace && !workspaceState.error && <p className="m-4 text-sm text-muted-foreground">프로젝트 배치를 불러오는 중입니다.</p>}
    {snapshot.isError && <Alert variant="destructive" className="m-4"><AlertTitle>그래프를 불러오지 못했습니다.</AlertTitle><AlertDescription><p>{snapshot.error.message}</p>{snapshot.data && <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "기록 없음"}</p></>}<Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button></AlertDescription></Alert>}
    <ReferenceAnalysisWorkspace context={filterRail} contextTitle={false} contextBadge={highlight.sources.length + highlight.identities.length + highlight.statuses.length} toolbar={toolbar} contextOpen={filterOpen} onContextOpenChange={setFilterOpen} inspector={selection && graphData ? <GraphInspectorPanel selection={inspectorSelection ?? selection} event={selectedEvent} snapshot={inspectorSnapshot ?? snapshot.data!} suspended={snapshot.isError} node={(() => { const node = graph?.nodes.find(node => node.id === selectedElementId); return node && inspectorSelection && "cells" in inspectorSelection ? { ...node, selection: inspectorSelection as HierarchySelection } : node ?? null })()} projection={graph} actions={scopeActions} /> : resend ? <p className="p-4 text-sm text-muted-foreground">재전송 카드를 누르면 보낸 기록이 여기에 나옵니다. 값을 바꿔 보낸 요청이라 판정에 쓰지 않습니다.</p> : graph && "navigation" in graph ? <GraphViewOverview projection={graph} owners={graphData?.owners} labelIdentity={identity => graphData ? graphAccountLabel(graphData, identity) : identity} actions={scopeActions} /> : <p className="p-4 text-sm text-muted-foreground">노드를 누르면 정보가 여기에 나옵니다.</p>} inspectorOpen={inspectorOpen} inspectorPersistent onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) clearGraphSelection() }} ariaLabel="접근 그래프 작업면">
      {resend ? <div role="status" className="flex min-w-0 items-center gap-2 border-b border-border/70 px-4 py-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1">값을 바꿔 보낸 요청입니다. Request Lab은 원본 기록과 응답 코드를 비교하고, Repeater는 원본을 알 수 없어 응답 코드만 보여 줍니다.</span></div> : <nav aria-label="그래프 계층" className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2 text-xs"><ol className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><li className="shrink-0">{resolvedNavigation.level === "site" ? <span aria-current="page" className="font-semibold">Site Overview</span> : <Button size="sm" variant="link" className="h-auto p-0 text-xs text-sky-700 dark:text-sky-300" onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "site"))}>Site Overview</Button>}</li>{resolvedNavigation.level !== "site" && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className={resolvedNavigation.level === "group" ? "min-w-0" : "shrink-0"}>{resolvedNavigation.level === "group" ? <span aria-current="page" className="block truncate font-semibold" title={groupLabel}>{groupLabel}</span> : <Button size="sm" variant="link" className="h-auto max-w-48 justify-start truncate p-0 text-xs text-sky-700 dark:text-sky-300" title={groupLabel} onClick={() => changeNavigation(navigateHierarchy(resolvedNavigation, "group", resolvedNavigation.groupId))}>{groupLabel}</Button>}</li></>}{operationLabel && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className="min-w-0"><span aria-current="page" className="block truncate font-semibold" title={`${operationLabel.method} ${operationLabel.path}`}>{operationLabel.method} {operationLabel.path}</span></li></>}</ol>{(graph?.revealedNodeCount ?? 0) > 0 && <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">검색으로 {graph?.revealedNodeCount}개 추가 표시<Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => clearSearchAnchor()}>해제</Button></span>}{hiddenCount > 0 && <Button size="sm" variant="outline" className="shrink-0" onClick={expand}>{resolvedNavigation.level === "operation" ? "객체" : "노드"} 18개 더 보기 ({hiddenCount}개 남음)</Button>}</nav>}
      {resend && graph && !graph.nodes.length && <p className="m-4 rounded-md border border-border/70 p-6 text-sm text-muted-foreground">{shownResendTools.length ? "고른 도구로 보낸 재전송 기록이 없습니다." : "재전송 도구를 하나 이상 고르세요."}</p>}
      {snapshot.isLoading && <p className="m-4 rounded-md border border-border/70 p-6 text-sm text-muted-foreground">공격면을 불러오는 중입니다.</p>}
      {graph && (compact || listMode ? <div ref={listShellRef} className="p-4" onClick={(event) => { if (!(event.target as HTMLElement).closest("table, input, button, a")) clearGraphSelection() }}><ResponsiveGraphList projection={graph} snapshot={graphData} revealNodeId={revealRequest?.nodeId} searchMatches={searchMatches} highlight={edgeHighlight} filters={resend ? EMPTY_HIGHLIGHT : highlight} onRevealDismiss={cancelSearchMove} selectedId={selectedElementId} onNavigate={navigateNode} onSelect={(nextSelection, id) => selectGraph(nextSelection, id ?? null)} /></div> : <div ref={canvasShellRef} className="relative min-h-[28rem] flex-1 overflow-hidden"><div className="absolute inset-x-0 top-0 z-10 h-10 border-b border-border/50 bg-[var(--flowscope-canvas)]">{lanes.map((lane, index) => {
        const { left, right } = laneHeader(index)
        return right <= left ? null : <button key={lane} type="button" aria-label={`${lane} 레인 기준 정렬`} className="absolute top-0 flex h-10 items-center justify-center truncate px-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" style={{ left, width: right - left }} onClick={() => setLaneLayout((current) => ({ lane: index, version: current.version + 1 }))}><span className="truncate">{lane}</span></button>
      })}</div><CytoscapeGraph key={resend ? "resend" : viewKey} projection={graph} statusesByNode={statusesByNode} apiMarks={graphData?.apiMarks} highlight={edgeHighlight} statusColors={statusColors} splitSources={splitSources} onToggleObjectGroup={toggleObjectGroup} openObjectGroupId={openObjectGroupId} locked={preferences.locked} fitVersion={fitVersion} layoutVersion={layoutVersion} laneLayout={laneLayout} onLaneBoundsChange={setLaneBounds} preferences={resend ? null : preferences} searchMatches={searchMatches} revealRequest={revealRequest} onInteraction={cancelSearchMove} onRevealed={requestId => setRevealRequest(current => current?.requestId === requestId ? null : current)} confirmedNodeIds={confirmedNodeIds} selectedElementId={selectedElementId} onNavigate={resend ? noop : navigateNode} onStepBack={resend ? noop : () => changeNavigation(stepBack(resolvedNavigation))} onClearSelection={clearGraphSelection} onSelect={selectGraph} onPreferencesChange={resend ? noop : updatePreferences} onRendererUnavailable={() => setListMode(true)} /><div role="list" aria-label="그래프 소스 범례" className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-4 rounded border border-border/70 bg-[var(--flowscope-pane)] px-3 py-1.5 text-[10px] text-muted-foreground"><span role="listitem" className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5 text-blue-600 dark:text-blue-400" />HUMAN</span><span role="listitem" className="flex items-center gap-1.5"><ScanLine aria-hidden="true" className="size-3.5 text-red-600 dark:text-red-400" />SCANNER</span><span role="listitem" className="flex items-center gap-1.5"><Bot aria-hidden="true" className="size-3.5 text-yellow-600 dark:text-yellow-400" />LLM</span></div></div>)}
    </ReferenceAnalysisWorkspace>
  </section>
}
