import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"
import { ChevronUp } from "lucide-react"

import { cardSurface, renderParameterNodeCardSvg, type CardSource, type CardTheme, type ParameterNodeCardView } from "@/features/parameter-map/parameterNodeCard"
import { useDocumentTheme } from "@/hooks/useTheme"
import { NODE_SIZE_LIMIT, type GraphPreferences, type NodeSize } from "./graphPreferences"
import { clampBetweenLanes, GRAPH_MAX_ZOOM, GRAPH_MIN_ZOOM, LANE_GAP, laneAnchor, laneIndexForKind, laneLimits, type LaneBounds } from "./graphLanes"
import { selectGraphItem, type GraphProjection, type GraphSelection } from "./graphProjection"
import { graphOpenAction, type HierarchyNode, type HierarchyProjection } from "./graphHierarchy"
import { deriveGraphFocus } from "./graphFocus"
import { graphSearchViewport } from "./graphSearch"
import { relationshipNodeCard, relationshipRouteCandidateCard } from "./relationshipNodeCard"

interface Props {
  projection: GraphProjection | HierarchyProjection
  locked: boolean
  fitVersion: number
  layoutVersion?: number
  /** API 노드별 관측 응답 코드. 카드 아래에 뱃지로 그린다. */
  statusesByNode?: ReadonlyMap<string, readonly number[]>
  /** 강조 필터에 맞는 엣지 id → 색. null이면 필터가 없어 모두 평소 무채색이다. */
  highlight?: ReadonlyMap<string, string> | null
  /** 필터로 고른 응답 코드 → 색. API 카드의 해당 뱃지만 칠한다. */
  statusColors?: ReadonlyMap<number, string>
  /** 출처를 두 개 이상 골랐을 때 그 순서. 강조된 엣지를 출처마다 나란히 벌려 그린다(하나 이하면 겹쳐서 한 줄). */
  splitSources?: readonly string[]
  /** 객체 묶음 노드를 더블클릭하거나 Enter로 펼치고 접는다. */
  onToggleObjectGroup?(id: string): void
  /** 한 레인만 다시 세운다. version이 바뀔 때만 실행한다. */
  laneLayout?: { lane: number; version: number }
  preferences?: GraphPreferences | null
  confirmedNodeIds?: ReadonlySet<string>
  selectedElementId?: string | null
  searchMatches?: ReadonlyMap<string, "direct" | "member">
  revealRequest?: { nodeId: string; requestId: number } | null
  onRevealed?(requestId: number): void
  onInteraction?(): void
  onSelect(selection: GraphSelection, elementId: string): void
  onNavigate?(node: HierarchyNode): void
  /** 왼쪽 신원 노드를 열면(더블클릭·Enter) 한 단계 위 View로 간다. */
  onStepBack?(): void
  /** 빈 캔버스를 누르거나 Esc를 누르면 선택과 강조를 푼다. */
  onClearSelection?(): void
  /** 레인별 화면 좌표 범위. 헤더가 노드가 만든 실제 범위를 따라간다. */
  onLaneBoundsChange?(bounds: ReadonlyArray<LaneBounds | null>): void
  onPreferencesChange(preferences: Pick<GraphPreferences, "positions" | "viewport" | "sizes">): void
  onRendererUnavailable?(): void
}

const noConfirmedNodes = new Set<string>()
const noStatuses: ReadonlyMap<string, readonly number[]> = new Map()
const noSearchMatches: ReadonlyMap<string, "direct" | "member"> = new Map()
interface SearchRing { id: string; left: number; top: number; width: number; height: number; member: boolean }
/** 레인 안 노드 사이 최소 세로 간격(모델 좌표)과 위쪽 여백. */
const LANE_NODE_GAP = 20, LANE_TOP = 64
/** 관측 엣지 색. 라이트는 흰 캔버스에서 선이 보이도록 한 단계 진하게 둔다. */
const EDGE_COLOR: Record<CardTheme, string> = { dark: "#94a3b8", light: "#64748b" }
const noLaneLayout = { lane: 0, version: 0 }

export function graphWheelIntent(mode: GraphPreferences["inputMode"], event: Pick<WheelEvent, "ctrlKey" | "deltaMode" | "deltaX" | "deltaY">): "pan" | "zoom" {
  if (event.ctrlKey) return "zoom"
  if (mode !== "auto") return mode === "trackpad" ? "pan" : "zoom"
  // ponytail: 브라우저는 입력 장치 종류를 주지 않으므로 오판하는 장치는 설정의 명시 모드로 보정한다.
  return event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (event.deltaX !== 0 || Math.abs(event.deltaY) < 50 || !Number.isInteger(event.deltaY)) ? "pan" : "zoom"
}

type FocusState = "yes" | "no" | "none"
type GraphEdgeLike = (GraphProjection | HierarchyProjection)["edges"][number]

function edgeEndpoints(edge: GraphEdgeLike) {
  const endpointId = edge.selection.operation ? `operation:${edge.selection.operation}` : edge.targetId
  const source = edge.relation === "resource-operation" ? edge.targetId : edge.sourceId
  const target = edge.relation === "identity-resource" ? endpointId : edge.relation === "resource-operation" ? edge.sourceId : edge.targetId
  return { source, target }
}

/** 선택에 따른 강조 상태. 요소를 다시 만들지 않고 이 값만 갱신해 클릭마다 그래프가 깜빡이지 않게 한다. */
function graphFocusStates(projection: GraphProjection | HierarchyProjection, selectedElementId: string | null) {
  const hierarchy = "kind" in projection ? projection : null
  const focus = deriveGraphFocus(hierarchy, selectedElementId)
  const edges = projection.edges.map(edge => ({ id: edge.id, ...edgeEndpoints(edge), focused: focus.edgeState(edge.id) as FocusState }))
  // 신원·엣지 강조가 없을 때 노드를 고르면 그 노드에 닿은 엣지와, 같은 서버 셀(신원·API·객체)을 가진 엣지를 강조한다.
  // 그래서 객체를 누르면 API↔객체 선뿐 아니라 그 객체에 접근한 신원→API 선까지 이어져 보인다.
  const selectedNode = hierarchy && selectedElementId ? hierarchy.nodes.find(node => node.id === selectedElementId) : undefined
  if (hierarchy && selectedNode && edges.every(edge => edge.focused === "none")) {
    const keys = new Set(selectedNode.selection.cellKeys)
    const edgeKeys = new Map(hierarchy.edges.map(edge => [edge.id, edge.selection.cellKeys]))
    for (const edge of edges) {
      const touches = edge.source === selectedNode.id || edge.target === selectedNode.id
      const sharesCell = keys.size > 0 && (edgeKeys.get(edge.id) ?? []).some(key => keys.has(key))
      edge.focused = touches || sharesCell ? "yes" : "no"
    }
  }
  // 강조가 있으면 강조 엣지에 닿은 노드만 남기고 나머지 노드는 흐린다.
  const edgeState = new Map(edges.map(edge => [edge.id, edge.focused]))
  const focusedNodeIds = new Set(edges.flatMap(edge => edge.focused === "yes" ? [edge.source, edge.target] : []))
  const anyFocus = edges.some(edge => edge.focused !== "none")
  return {
    edge: (id: string): FocusState => edgeState.get(id) ?? "none",
    node: (id: string): FocusState => anyFocus ? focusedNodeIds.has(id) || id === selectedElementId ? "yes" : "no" : "none",
  }
}

function elementsFor(projection: GraphProjection | HierarchyProjection, selectedElementId: string | null, confirmedNodeIds: ReadonlySet<string>, sizes: Readonly<Record<string, NodeSize>> = {}, cards?: Map<string, ParameterNodeCardView>, theme: CardTheme = "dark", statusesByNode: ReadonlyMap<string, readonly number[]> = noStatuses): ElementDefinition[] {
  const hierarchy = "kind" in projection ? projection : null
  const focus = graphFocusStates(projection, selectedElementId)
  const edges = projection.edges.map((edge) => {
    const { source, target } = edgeEndpoints(edge)
    // 관측 엣지는 평소 주체 구분 없이 한 가지 회색 선으로 그리고, 접근 주체는 양 끝 노드 카드 아이콘으로만 표시한다.
    // 색은 강조 필터를 골랐을 때만 들어간다(applyHighlight). 주체가 없는 구조·경로 후보 엣지는 '미관측' 표시(회색 점선)를 그대로 둔다.
    const observed = edge.source !== null
    return { data: { id: edge.id, source, target, label: "", sourceText: edge.sourceText, line: observed ? "solid" : edge.line, color: observed ? EDGE_COLOR[theme] : edge.color, countLabel: edge.countLabel, focused: focus.edge(edge.id), src: edge.source ?? "" }, origin: edge.source }
  })
  const nodeFocus = focus.node
  const nodeSources = new Map<string, Set<CardSource>>()
  for (const { data, origin } of edges) {
    if (origin !== "human" && origin !== "scanner" && origin !== "llm") continue
    for (const id of [data.source, data.target]) nodeSources.set(id, (nodeSources.get(id) ?? new Set<CardSource>()).add(origin))
  }
  // 펼친 객체 묶음의 멤버 노드는 어느 묶음에서 나왔는지 표시한다(배경 띠·강조 테두리).
  const memberOf = new Map<string, string>()
  for (const node of hierarchy?.nodes ?? []) if (node.objectGroup?.expanded) for (const member of node.objectGroup.members) memberOf.set(`${node.kind === "operation-group" ? "operation" : "resource"}:${member}`, node.id)
  // 접힌 API 묶음의 멤버는 그리지 않는다(엣지는 이미 묶음 노드로 모였다).
  const nodes = (hierarchy ? hierarchy.nodes.filter(node => node.kind !== "route-candidate" && !node.hiddenInGraph) : [...projection.identities, ...projection.operations, ...projection.resources]).map((node) => {
    // 접근 주체 아이콘은 오른쪽 API·Object 노드에만 둔다.
    const sources = node.kind === "operation" || node.kind === "resource" ? [...(nodeSources.get(node.id) ?? [])] : []
    const base = relationshipNodeCard(node, projection, statusesByNode.get(node.id))
    const card = sources.length ? { ...base, sources, accessibleLabel: `${base.accessibleLabel}; 접근 주체 ${sources.map(source => source.toUpperCase()).join(", ")}` } : base
    cards?.set(node.id, card)
    const size = sizes[node.id]
    const image = renderParameterNodeCardSvg(card, true, size, theme)
    return { data: { id: node.id, label: "", cardImage: image.uri, cardColor: cardSurface(theme), focused: nodeFocus(node.id), accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: node.verdictText, kind: node.kind, confirmed: confirmedNodeIds.has(node.id) ? "yes" : "no", ...("objectGroup" in node && node.objectGroup ? { groupState: node.objectGroup.expanded ? "open" : "closed", groupKey: node.objectGroup.key } : {}), ...(memberOf.has(node.id) ? { memberOf: memberOf.get(node.id) } : {}), ...(size ? { customWidth: image.width, customHeight: image.height } : {}) } }
  })
  const candidates = projection.routeCandidates.map((candidate) => {
    const card = relationshipRouteCandidateCard(candidate)
    cards?.set(candidate.id, card)
    const size = sizes[candidate.id]
    const image = renderParameterNodeCardSvg(card, true, size, theme)
    return { data: { id: candidate.id, label: "", cardImage: image.uri, cardColor: cardSurface(theme), focused: nodeFocus(candidate.id), accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: candidate.applicability, kind: "route-candidate", confirmed: "no", ...(size ? { customWidth: image.width, customHeight: image.height } : {}) } }
  })
  return [...nodes, ...candidates, ...edges.map(({ data }) => ({ data }))]
}

function readPreferences(core: Core): Pick<GraphPreferences, "positions" | "viewport" | "sizes"> {
  const positions: GraphPreferences["positions"] = {}
  const sizes: Record<string, NodeSize> = {}
  core.nodes().forEach((node) => {
    const position = node.position(); positions[node.id()] = { x: position.x, y: position.y }
    const width = node.data("customWidth"), height = node.data("customHeight")
    if (typeof width === "number" && typeof height === "number") sizes[node.id()] = { width, height }
  })
  return { positions, viewport: { zoom: core.zoom(), pan: core.pan() }, sizes }
}

/** 컨테이너 크기 변화가 이만큼 멈춘 뒤에 캔버스 크기를 맞춘다. */
const RESIZE_SETTLE_MS = 120

/** 모서리 인식 범위(화면 px). 카드 모서리 안팎 12px을 잡는다. */
const CORNER_HIT = 12

/** 모서리 크기 조절 한계: 기본 카드 크기 이상, 기본의 두 배(저장 한계 이내) 이하. */
function sizeBounds(base: NodeSize) {
  return { minWidth: base.width, minHeight: base.height, maxWidth: Math.min(NODE_SIZE_LIMIT.maxWidth, base.width * 2), maxHeight: Math.min(NODE_SIZE_LIMIT.maxHeight, base.height * 2) }
}

function modelNodeWidth(core: Core, node: cytoscape.NodeSingular) {
  return node.renderedOuterWidth() / (core.zoom() || 1)
}

function laneColumns(core: Core, laneCount: number) {
  const columns: cytoscape.NodeSingular[][] = Array.from({ length: laneCount }, () => [])
  core.nodes().forEach((node) => { columns[laneIndexForKind(String(node.data("kind")), laneCount)]?.push(node) })
  return columns
}

/** 각 레인이 현재 차지한 모델 범위. 노드가 없는 레인은 범위가 없다. */
function laneBounds(core: Core, laneCount: number, exclude?: cytoscape.NodeSingular): Array<LaneBounds | null> {
  return laneColumns(core, laneCount).map((nodes) => nodes.reduce<LaneBounds | null>((bounds, node) => {
    if (exclude && node.id() === exclude.id()) return bounds
    const half = modelNodeWidth(core, node) / 2, x = node.position().x
    return bounds ? { left: Math.min(bounds.left, x - half), right: Math.max(bounds.right, x + half) } : { left: x - half, right: x + half }
  }, null))
}

function renderedLaneBounds(core: Core, laneCount: number): Array<LaneBounds | null> {
  const zoom = core.zoom() || 1, panX = core.pan().x
  return laneBounds(core, laneCount).map((bounds) => bounds && { left: bounds.left * zoom + panX, right: bounds.right * zoom + panX })
}

function nodeModelHeight(node: cytoscape.NodeSingular) {
  const height = Number(node.data("height"))
  return Number.isFinite(height) && height > 0 ? height : 60
}

export function positionInLanes(core: Core, height: number, savedPositions: GraphPreferences["positions"] | null, laneCount: number, onlyLane: number | null = null) {
  const usableHeight = Math.max(height, 620)
  const columns = laneColumns(core, laneCount)
  // Folded/limited cards still own their saved space. Missing base sizes reserve the allowed maximum.
  let reservedBottom = Number.NEGATIVE_INFINITY
  if (savedPositions && columns.some(nodes => nodes.some(node => !savedPositions[node.id()]))) {
    const heights = new Map(columns.flat().map(node => [node.id(), nodeModelHeight(node)] as const))
    for (const [id, point] of Object.entries(savedPositions)) {
      const nodeHeight = heights.get(id) ?? NODE_SIZE_LIMIT.maxHeight
      reservedBottom = Math.max(reservedBottom, point.y + nodeHeight / 2)
    }
  }
  columns.forEach((nodes, index) => {
    if (onlyLane !== null && onlyLane !== index) return
    // 캔버스 높이를 노드 수로 나누면 노드가 많을 때 간격이 노드보다 작아져 겹친다. 실제 노드 높이를 쌓고, 짧은 레인만 세로 가운데에 둔다.
    const heights = nodes.map(nodeModelHeight)
    const total = heights.reduce((sum, value) => sum + value, 0) + LANE_NODE_GAP * Math.max(nodes.length - 1, 0)
    let cursor = Math.max(LANE_TOP, (usableHeight - total) / 2)
    const restored = nodes.filter(node => savedPositions?.[node.id()])
    if (restored.length) cursor = Math.max(...restored.map(node => savedPositions![node.id()].y + nodeModelHeight(node) / 2)) + LANE_NODE_GAP
    cursor = Math.max(cursor, reservedBottom + LANE_NODE_GAP)
    const x = restored.length ? restored.reduce((sum, node) => sum + savedPositions![node.id()].x, 0) / restored.length : laneAnchor(index)
    nodes.forEach((node, order) => {
      const saved = savedPositions?.[node.id()]
      node.position(saved ?? { x, y: cursor + heights[order] / 2 })
      if (!saved) cursor += heights[order] + LANE_NODE_GAP
    })
  })
}

function syncSelection(core: Core, selectedElementId: string | null | undefined) {
  core.elements().unselect()
  if (selectedElementId) core.getElementById(selectedElementId).select()
}

function publishGeometry(container: HTMLDivElement, core: Core) {
  if (!new URLSearchParams(window.location.search).has("flowscope-e2e-geometry")) return
  const indexes: Record<string, number> = {}
  const nodes: Array<{ id: string; kind: string; index: number; selected: boolean; center: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number } }> = []
  core.nodes().forEach((node) => {
    const kind = String(node.data("kind"))
    const index = indexes[kind] ?? 0
    indexes[kind] = index + 1
    const center = node.renderedPosition()
    const halfWidth = node.renderedOuterWidth() / 2
    const halfHeight = node.renderedOuterHeight() / 2
    nodes.push({ id: node.id(), kind, index, selected: node.selected(), center: { x: center.x, y: center.y }, bounds: { left: center.x - halfWidth, right: center.x + halfWidth, top: center.y - halfHeight, bottom: center.y + halfHeight } })
  })
  container.dataset.graphGeometry = JSON.stringify({ width: container.clientWidth, height: container.clientHeight, maxZoom: core.maxZoom(), nodes })
}

/** 미니맵: 모델 좌표의 노드 상자와 현재 화면 범위. */
export interface MinimapView {
  box: { x: number; y: number; w: number; h: number }
  nodes: Array<{ id: string; x: number; y: number; w: number; h: number; dim: boolean }>
  view: { x: number; y: number; w: number; h: number }
}

/** 미니맵에 그릴 노드 상자와 화면 범위를 읽는다. 노드가 없거나 렌더러가 범위를 주지 않으면 null. */
export interface GroupBand { id: string; label: string; count: number; x1: number; y1: number; x2: number; y2: number }

/** 펼친 객체 묶음마다 묶음 노드와 멤버 노드를 감싸는 화면 좌표 상자. 캔버스 위에 배경 띠와 접기 버튼을 그리는 데 쓴다. */
export function readGroupBands(core: Core): GroupBand[] {
  if (typeof core.nodes !== "function") return []
  const bands: GroupBand[] = []
  try {
    const nodes = core.nodes().toArray()
    for (const group of nodes.filter(node => node.data("groupState") === "open")) {
      const members = nodes.filter(node => node.data("memberOf") === group.id())
      const boxes = [group, ...members].map(node => node.renderedBoundingBox())
      bands.push({
        id: group.id(), label: String(group.data("groupKey") ?? ""), count: members.length,
        x1: Math.min(...boxes.map(box => box.x1)), y1: Math.min(...boxes.map(box => box.y1)),
        x2: Math.max(...boxes.map(box => box.x2)), y2: Math.max(...boxes.map(box => box.y2)),
      })
    }
  } catch { return [] }
  return bands
}

export function readMinimap(core: Core): MinimapView | null {
  if (typeof core.extent !== "function") return null
  const nodes: MinimapView["nodes"] = []
  core.nodes().forEach((node) => {
    const position = node.position(), width = Number(node.data("width")) || 200, height = nodeModelHeight(node)
    nodes.push({ id: node.id(), x: position.x - width / 2, y: position.y - height / 2, w: width, h: height, dim: node.data("hl") === "no" })
  })
  if (!nodes.length) return null
  const pad = 40
  let x1 = Number.POSITIVE_INFINITY, y1 = Number.POSITIVE_INFINITY, x2 = Number.NEGATIVE_INFINITY, y2 = Number.NEGATIVE_INFINITY
  for (const node of nodes) { x1 = Math.min(x1, node.x); y1 = Math.min(y1, node.y); x2 = Math.max(x2, node.x + node.w); y2 = Math.max(y2, node.y + node.h) }
  const extent = core.extent()
  return { box: { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 }, nodes, view: { x: extent.x1, y: extent.y1, w: extent.w, h: extent.h } }
}

const MINIMAP_WIDTH = 180, MINIMAP_HEIGHT = 120

/**
 * 강조 필터 적용. 요소를 다시 만들지 않고 data만 바꿔 깜빡임 없이 색·투명도를 바꾼다.
 * 필터가 없으면 모두 "none"(평소 무채색), 있으면 맞는 엣지와 그 양 끝 노드만 "yes"다. API 카드는 고른 응답 코드 뱃지만 칠해 다시 그린다.
 */
function applyHighlight(core: Core, projection: GraphProjection | HierarchyProjection, highlight: ReadonlyMap<string, string> | null, cards: ReadonlyMap<string, ParameterNodeCardView>, theme: CardTheme, statusColors: ReadonlyMap<number, string>, splitSources: readonly string[] = []) {
  const litNodes = new Set<string>()
  if (highlight) for (const edge of projection.edges) {
    if (!highlight.has(edge.id)) continue
    const { source, target } = edgeEndpoints(edge)
    litNodes.add(source); litNodes.add(target)
  }
  const apply = () => core.elements().forEach((element: cytoscape.SingularElementReturnValue) => {
    const id = element.id(), edge = element.isEdge()
    const color = edge ? highlight?.get(id) : undefined
    const state = !highlight ? "none" : edge ? color ? "yes" : "no" : litNodes.has(id) ? "yes" : "no"
    if (element.data("hl") !== state) element.data("hl", state)
    if (color && element.data("hlColor") !== color) element.data("hlColor", color)
    if (edge) {
      // 출처를 두 개 이상 고르면 강조된 엣지를 출처 순서대로 나란히 그린다(간격은 routeEdges). 그 밖에는 같은 두 노드 사이 엣지가 겹쳐 한 줄로 보인다.
      const index = color && splitSources.length > 1 ? splitSources.indexOf(String(element.data("src"))) : -1
      const split = index >= 0 ? String(index - (splitSources.length - 1) / 2) : ""
      if (element.data("split") !== split) element.data("split", split)
    }
    const card = edge ? undefined : cards.get(id)
    if (!card?.statuses?.length) return
    const width = element.data("customWidth"), height = element.data("customHeight")
    const image = renderParameterNodeCardSvg(card, true, typeof width === "number" && typeof height === "number" ? { width, height } : undefined, theme, statusColors)
    if (element.data("cardImage") !== image.uri) element.data("cardImage", image.uri)
  })
  if (typeof core.batch === "function") core.batch(apply); else apply()
}

export interface RouteNode { x: number; y: number; width: number; height: number; lane: number }
export interface RouteEdge { id: string; source: string; target: string; split: number | null }
export type EdgeRoute = Record<string, string> | null

const ROUTE_SPLIT = 6
const ROUTE_MIN_RUN = 12

/**
 * 직교 엣지 경로. cytoscape의 taxi는 노드 중심을 기준으로 꺾어 연결점을 옮기면 끝이 비스듬해지므로, 꺾는 점을 직접 계산해 round-segments로 그린다.
 * - 묶음: 노드마다 옆면 가운데 한 점으로 나가고 들어온다. 한 출발 노드의 엣지는 한 세로 줄기를 함께 타고 가다 목표별로 갈라지고,
 *   한 목표로 들어오는 엣지는 마지막 가로 구간에서 합쳐진다.
 * - 꺾는 세로 줄기: 같은 레인으로 들어가는 엣지는 출발 노드마다 레인 사이 빈 공간의 30~70% 중 다른 x를 써서 다른 출발 노드의 줄기와 겹치지 않는다.
 * - 출처 나란히 그리기(split): 연결점과 줄기를 함께 6px씩 옮겨 평행을 유지한다.
 * 목표가 출발 노드 오른쪽에 충분히 떨어져 있지 않으면 null(기본 round-taxi로 그린다).
 */
export function routeEdges(nodes: ReadonlyMap<string, RouteNode>, edges: readonly RouteEdge[]): Map<string, EdgeRoute> {
  const trunks = new Map<number, Set<string>>(), laneLeft = new Map<number, number>()
  for (const edge of edges) {
    const target = nodes.get(edge.target)
    if (!nodes.has(edge.source) || !target) continue
    trunks.set(target.lane, (trunks.get(target.lane) ?? new Set()).add(edge.source))
    laneLeft.set(target.lane, Math.min(laneLeft.get(target.lane) ?? Infinity, target.x - target.width / 2))
  }
  const byY = (ids: Set<string> | undefined) => [...(ids ?? [])].sort((left, right) => nodes.get(left)!.y - nodes.get(right)!.y || left.localeCompare(right))
  const routes = new Map<string, EdgeRoute>()
  for (const edge of edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target)
    if (!source || !target) continue
    const offset = (edge.split ?? 0) * ROUTE_SPLIT
    const start = { x: source.x + source.width / 2, y: source.y + offset }
    const end = { x: target.x - target.width / 2, y: target.y + offset }
    const gap = end.x - start.x
    if (gap < ROUTE_MIN_RUN * 2) { routes.set(edge.id, null); continue }
    const sources = byY(trunks.get(target.lane))
    const share = sources.length < 2 ? 0.5 : 0.3 + 0.4 * sources.indexOf(edge.source) / (sources.length - 1)
    // 줄기 x는 목표 카드 폭과 무관하게 레인의 가장 왼쪽 경계를 기준으로 잡아, 한 출발 노드의 줄기가 한 x에 모인다.
    const trunkGap = Math.max(0, Math.min(end.x, laneLeft.get(target.lane) ?? end.x) - start.x)
    const turn = start.x + Math.max(ROUTE_MIN_RUN, Math.min(gap - ROUTE_MIN_RUN, trunkGap * share + offset))
    const endpoints = { "source-endpoint": `${source.width / 2}px ${start.y - source.y}px`, "target-endpoint": `${-target.width / 2}px ${end.y - target.y}px` }
    if (Math.abs(end.y - start.y) < 0.5) { routes.set(edge.id, { "curve-style": "straight", ...endpoints }); continue }
    // segment 점은 두 연결점을 잇는 선 기준 (비율, 수직 거리)로 적는다.
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    const along = (x: number, y: number) => ((x - start.x) * dx + (y - start.y) * dy) / (length * length)
    const across = (x: number, y: number) => ((x - start.x) * -dy + (y - start.y) * dx) / length
    routes.set(edge.id, {
      "curve-style": "round-segments", "edge-distances": "endpoints", "segment-radii": "4", ...endpoints,
      "segment-weights": `${along(turn, start.y)} ${along(turn, end.y)}`,
      "segment-distances": `${across(turn, start.y)} ${across(turn, end.y)}`,
    })
  }
  return routes
}

const ROUTE_STYLE_KEYS = "curve-style edge-distances segment-radii segment-weights segment-distances source-endpoint target-endpoint"

function applyEdgeRoutes(core: Core, laneCount: number) {
  if (typeof core.edges !== "function") return
  const nodes = new Map<string, RouteNode>()
  core.nodes().forEach((node) => { nodes.set(node.id(), { ...node.position(), width: node.width(), height: node.height(), lane: laneIndexForKind(String(node.data("kind")), laneCount) }) })
  const edges: RouteEdge[] = []
  core.edges().forEach((edge) => {
    const split = String(edge.data("split") ?? "")
    edges.push({ id: edge.id(), source: edge.source().id(), target: edge.target().id(), split: split ? Number(split) : null })
  })
  const routes = routeEdges(nodes, edges)
  core.batch(() => core.edges().forEach((edge) => {
    const route = routes.get(edge.id())
    if (route) edge.style(route); else edge.removeStyle(ROUTE_STYLE_KEYS)
  }))
}

const noStatusColors: ReadonlyMap<number, string> = new Map()
const noSplitSources: readonly string[] = []

export function CytoscapeGraph({ projection, locked, fitVersion, layoutVersion = 0, statusesByNode = noStatuses, highlight = null, statusColors = noStatusColors, splitSources = noSplitSources, onToggleObjectGroup, laneLayout = noLaneLayout, preferences = null, confirmedNodeIds = noConfirmedNodes, selectedElementId = null, searchMatches = noSearchMatches, revealRequest = null, onRevealed, onInteraction, onSelect, onNavigate, onStepBack, onClearSelection, onLaneBoundsChange, onPreferencesChange, onRendererUnavailable }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const coreRef = useRef<Core | null>(null)
  const keyboardNodeRef = useRef<string | null>(null)
  const imageSwapRef = useRef(0)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const tooltipNodeRef = useRef<string | null>(null)
  const tooltipInteractionRef = useRef({ pointer: false, focus: false })
  const tooltipHideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const tooltipId = useId()
  const [rendererUnavailable, setRendererUnavailable] = useState(false)
  const [cardTooltip, setCardTooltip] = useState<{ nodeId: string; label: string; x: number; y: number; width: number } | null>(null)
  const [minimap, setMinimap] = useState<MinimapView | null>(null)
  const [bands, setBands] = useState<GroupBand[]>([])
  const [searchRings, setSearchRings] = useState<SearchRing[]>([])
  const searchMatchesRef = useRef(searchMatches)
  searchMatchesRef.current = searchMatches
  const interactionRef = useRef(onInteraction)
  interactionRef.current = onInteraction
  const onRevealedRef = useRef(onRevealed)
  onRevealedRef.current = onRevealed
  const updateSearchRings = useCallback((core: Core) => {
    const rings: SearchRing[] = []
    for (const [id, match] of searchMatchesRef.current) {
      const node = core.getElementById(id)
      if (node.empty?.()) continue
      const position = node.renderedPosition(), width = node.renderedOuterWidth(), height = node.renderedOuterHeight()
      rings.push({ id, left: position.x - width / 2 - 4, top: position.y - height / 2 - 4, width: width + 8, height: height + 8, member: match === "member" })
    }
    setSearchRings(previous => previous.length === rings.length && previous.every((ring, index) => Object.entries(ring).every(([key, value]) => value === rings[index][key as keyof SearchRing])) ? previous : rings)
  }, [])
  const projectionRef = useRef(projection)
  const selectRef = useRef(onSelect)
  const navigateRef = useRef(onNavigate)
  const stepBackRef = useRef(onStepBack)
  const clearSelectionRef = useRef(onClearSelection)
  const selectedElementIdRef = useRef(selectedElementId)
  const preferenceRef = useRef(onPreferencesChange)
  const inputModeRef = useRef(preferences?.inputMode ?? "auto")
  const rendererUnavailableRef = useRef(onRendererUnavailable)
  const scheduleLaneCorrectionRef = useRef<(() => void) | null>(null)
  const publishLayoutRef = useRef<(() => void) | null>(null)
  const laneCount = "kind" in projection && projection.kind === "site" ? 2 : 3
  const theme = useDocumentTheme()
  const laneCountRef = useRef(laneCount)
  const preferencesRef = useRef(preferences)
  const appliedLayoutRef = useRef(layoutVersion)
  const hasProjectionRef = useRef(false)
  const appliedFitRef = useRef(fitVersion)
  const appliedLaneLayoutRef = useRef(laneLayout.version)
  const laneBoundsRef = useRef<ReadonlyArray<LaneBounds | null>>([])
  const laneBoundsListenerRef = useRef(onLaneBoundsChange)
  laneBoundsListenerRef.current = onLaneBoundsChange
  laneCountRef.current = laneCount
  preferencesRef.current = preferences
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight
  const statusColorsRef = useRef(statusColors)
  statusColorsRef.current = statusColors
  const splitSourcesRef = useRef(splitSources)
  splitSourcesRef.current = splitSources
  const toggleGroupRef = useRef(onToggleObjectGroup)
  toggleGroupRef.current = onToggleObjectGroup
  projectionRef.current = projection
  selectRef.current = onSelect
  navigateRef.current = onNavigate
  stepBackRef.current = onStepBack
  clearSelectionRef.current = onClearSelection
  selectedElementIdRef.current = selectedElementId
  preferenceRef.current = onPreferencesChange
  inputModeRef.current = preferences?.inputMode ?? "auto"
  rendererUnavailableRef.current = onRendererUnavailable
  const cancelTooltipHide = useCallback(() => {
    if (tooltipHideTimerRef.current !== null) window.clearTimeout(tooltipHideTimerRef.current)
    tooltipHideTimerRef.current = null
  }, [])
  const dismissCardTooltip = useCallback(() => {
    cancelTooltipHide()
    tooltipNodeRef.current = null
    tooltipInteractionRef.current = { pointer: false, focus: false }
    setCardTooltip(null)
  }, [cancelTooltipHide])
  const scheduleTooltipHide = useCallback(() => {
    cancelTooltipHide()
    if (tooltipInteractionRef.current.pointer || tooltipInteractionRef.current.focus) return
    tooltipHideTimerRef.current = window.setTimeout(dismissCardTooltip, 150)
  }, [cancelTooltipHide, dismissCardTooltip])

  // 모서리 크기 조절: 노드 오른쪽 아래 모서리에 커서를 대면 커서가 바뀌고, 누른 채 끌면 좌상단을 고정하고 크기를 바꾼다.
  const cardsRef = useRef(new Map<string, ParameterNodeCardView>())
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const cornerNodeRef = useRef<string | null>(null)
  const resizeDragRef = useRef<{ nodeId: string; clientX: number; clientY: number; width: number; height: number; left: number; top: number; zoom: number } | null>(null)
  /** 화면 좌표(clientX/Y)가 어떤 노드의 오른쪽 아래 모서리 ±CORNER_HIT 안이면 그 노드. */
  const cornerNodeAt = (clientX: number, clientY: number) => {
    const core = coreRef.current, container = containerRef.current
    if (!core || !container || lockedRef.current) return null
    const bounds = container.getBoundingClientRect(), x = clientX - bounds.left, y = clientY - bounds.top
    let hit: string | null = null
    core.nodes().forEach((node) => {
      const center = node.renderedPosition()
      const right = center.x + node.renderedOuterWidth() / 2, bottom = center.y + node.renderedOuterHeight() / 2
      if (Math.abs(x - right) <= CORNER_HIT && Math.abs(y - bottom) <= CORNER_HIT) hit = node.id()
    })
    return hit
  }
  const setCornerCursor = (nodeId: string | null) => {
    cornerNodeRef.current = nodeId
    if (containerRef.current) containerRef.current.style.cursor = nodeId ? "nwse-resize" : ""
  }
  const baseSize = (nodeId: string): NodeSize | null => {
    const card = cardsRef.current.get(nodeId)
    if (!card) return null
    const image = renderParameterNodeCardSvg(card, true, undefined, theme)
    return { width: image.width, height: image.height }
  }
  /**
   * 새 카드 그림은 디코드가 끝난 뒤에 바꿔 끼운다. Cytoscape는 처음 보는 이미지 URL을 로드하는 동안 빈 카드를 그리므로,
   * 끄는 동안 매번 바로 바꾸면 카드가 깜빡인다. 그 사이에는 이전 그림이 새 크기 안에 그려진다. 마지막 요청만 적용한다.
   */
  const swapCardImage = (node: cytoscape.NodeSingular, uri: string) => {
    const token = ++imageSwapRef.current
    const apply = () => { if (token === imageSwapRef.current && !node.removed()) node.data("cardImage", uri) }
    const image = new Image()
    image.src = uri
    if (typeof image.decode === "function") image.decode().then(apply, apply); else apply()
  }
  /** 좌상단(anchor)을 고정한 채 크기를 바꾼다. 기본 크기와 같아지면 저장값에서 빠진다. 오른쪽 이웃 레인 직전에서 멈춘다. */
  const resizeNode = (nodeId: string, width: number, height: number, anchor: { left: number; top: number }) => {
    const core = coreRef.current, card = cardsRef.current.get(nodeId), base = baseSize(nodeId)
    const node = core?.getElementById(nodeId)
    if (!core || !node || node.empty() || !card || !base) return
    const bounds = sizeBounds(base)
    const count = laneCountRef.current, index = laneIndexForKind(String(node.data("kind")), count)
    const rightNeighbour = laneBounds(core, count, node).slice(index + 1).reduce((limit, lane) => lane ? Math.min(limit, lane.left - LANE_GAP) : limit, Number.POSITIVE_INFINITY)
    const nextWidth = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, width, rightNeighbour - anchor.left))
    const nextHeight = Math.max(bounds.minHeight, Math.min(bounds.maxHeight, height))
    const custom = Math.round(nextWidth) !== base.width || Math.round(nextHeight) !== base.height
    const image = renderParameterNodeCardSvg(card, true, custom ? { width: Math.round(nextWidth), height: Math.round(nextHeight) } : undefined, theme, statusColorsRef.current)
    node.data({ width: image.width, height: image.height })
    swapCardImage(node, image.uri)
    if (custom) node.data({ customWidth: image.width, customHeight: image.height }); else node.removeData("customWidth customHeight")
    node.position({ x: anchor.left + image.width / 2, y: anchor.top + image.height / 2 })
  }
  const nodeAnchor = (node: cytoscape.NodeSingular) => {
    const position = node.position(), width = Number(node.data("width")), height = Number(node.data("height"))
    return { left: position.x - width / 2, top: position.y - height / 2, width, height }
  }

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current, canvas = containerRef.current
    if (tooltip && canvas && cardTooltip) tooltip.style.top = `${Math.max(8, Math.min(cardTooltip.y, canvas.clientHeight - tooltip.offsetHeight - 8))}px`
  }, [cardTooltip])

  useEffect(() => {
    if (!containerRef.current) return
    let core: Core
    try {
      core = cytoscape({
        container: containerRef.current,
        elements: [],
        userZoomingEnabled: false,
        style: [
          { selector: "node", style: { "background-color": "data(cardColor)", "background-image": "data(cardImage)", "background-fit": "contain", "background-clip": "none", label: "data(label)", color: "#e5e7eb", width: "data(width)", height: "data(height)", padding: 0, shape: "round-rectangle", "border-width": 1, "border-color": "#64748b", "border-opacity": 0.85 } },
          { selector: 'node[confirmed = "yes"]', style: { "border-width": 2, "border-color": "#ef4444" } },
          { selector: "node:selected", style: { "border-width": 2, "border-color": "#60a5fa", "overlay-opacity": 0 } },
          { selector: 'node[kind = "route-candidate"]', style: { "border-width": 2, "border-style": "dotted", "border-color": "#64748b" } },
          { selector: 'node[groupState = "closed"]', style: { "border-width": 1.5, "border-style": "dashed", "border-color": "#94a3b8" } },
          { selector: 'node[groupState = "open"]', style: { "border-width": 2, "border-style": "solid", "border-color": "#0ea5e9" } },
          { selector: "edge", style: { width: 1.7, "line-color": "data(color)", "line-style": "data(line)", "target-arrow-color": "data(color)", "target-arrow-shape": "triangle", "arrow-scale": 0.65, label: "data(label)", color: "#d4d4d8", "font-size": "9px", "font-family": "Geist Mono, ui-monospace, monospace", "text-background-color": "#090b0d", "text-background-opacity": 0.86, "text-background-padding": "2px", "text-rotation": "autorotate", "text-margin-y": -7, "curve-style": "round-taxi", "taxi-direction": "rightward", "taxi-radius": 4, opacity: 0.9 } },
          { selector: "edge:selected", style: { width: 2.6, "line-color": "data(color)", "target-arrow-color": "data(color)" } },
          // 강조 필터에 맞는 엣지만 색을 입힌다. 선택 강조(focused)는 그 위에 한 번 더 적용되고, 필터에서 빠진 요소는 마지막 규칙으로 늘 흐리게 둔다.
          { selector: 'edge[hl = "yes"]', style: { "line-color": "data(hlColor)", "target-arrow-color": "data(hlColor)", width: 2.6, opacity: 1 } },
          { selector: 'edge[focused = "yes"]', style: { width: 3, opacity: 1 } },
          { selector: 'edge[focused = "no"]', style: { opacity: 0.15 } },
          { selector: 'node[focused = "no"]', style: { opacity: 0.35 } },
          { selector: 'edge[hl = "no"]', style: { opacity: 0.12 } },
          { selector: 'node[hl = "no"]', style: { opacity: 0.3 } },
          { selector: 'node[searchMatch = "yes"]', style: { opacity: 1 } },
        ] as unknown as cytoscape.StylesheetJson,
      })
    } catch {
      setRendererUnavailable(true)
      rendererUnavailableRef.current?.()
      return
    }
    coreRef.current = core
    hasProjectionRef.current = false
    // ponytail: 레인 범위는 모델 좌표지만 헤더는 화면 좌표라 팬·줌마다 환산해 알린다.
    const publishLaneBounds = () => {
      const bounds = renderedLaneBounds(core, laneCountRef.current)
      const previous = laneBoundsRef.current
      if (bounds.length === previous.length && bounds.every((lane, index) => lane?.left === previous[index]?.left && lane?.right === previous[index]?.right)) return
      laneBoundsRef.current = bounds
      laneBoundsListenerRef.current?.(bounds)
    }
    const publishLayout = () => {
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
      publishLaneBounds()
      setMinimap(readMinimap(core)); setBands(readGroupBands(core))
      updateSearchRings(core)
    }
    publishLayoutRef.current = publishLayout
    let correctionFrame: number | null = null
    const correctLanes = () => {
      correctionFrame = null
      if (typeof core.resize === "function") core.resize()
      syncSelection(core, selectedElementIdRef.current)
      publishLayout()
    }
    const scheduleLaneCorrection = () => {
      if (correctionFrame !== null) return
      correctionFrame = requestAnimationFrame(correctLanes)
    }
    scheduleLaneCorrectionRef.current = scheduleLaneCorrection
    // ponytail: pan/zoom은 화면 변환만 담당한다. 노드 모델 좌표를 건드리면 확대·축소마다 노드가 화면 기준으로 다시 모여 엣지만 늘어난다.
    let viewportFrame: number | null = null
    const publishViewport = () => {
      viewportFrame = null
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
      publishLaneBounds()
      setMinimap(readMinimap(core)); setBands(readGroupBands(core))
      updateSearchRings(core)
    }
    const scheduleViewportPublish = () => {
      if (viewportFrame !== null) return
      viewportFrame = requestAnimationFrame(publishViewport)
    }
    const selectListener = (event: cytoscape.EventObject) => {
      const current = projectionRef.current
      const id = event.target.id()
      const hierarchy = "kind" in current ? current : null
      const node = hierarchy?.nodes.find(node => node.id === id)
      // 한 번 누르면 정보만 연다. 이동은 더블클릭·Enter(openListener)로만 한다.
      if (hierarchy?.edges.some(edge => edge.id === id && edge.structural)) return
      const selection = hierarchy ? node?.selection ?? hierarchy.edges.find(edge => edge.id === id)?.selection : selectGraphItem(current as GraphProjection, id)
      if (selection) selectRef.current(selection, event.target.id())
    }
    const openListener = (event: cytoscape.EventObject) => {
      const current = projectionRef.current
      const hierarchy = "kind" in current ? current : null
      const node = hierarchy?.nodes.find(item => item.id === event.target.id())
      const action = node && hierarchy ? graphOpenAction(node.kind, hierarchy.kind) : null
      if (action === "in" && node) navigateRef.current?.(node)
      else if (action === "back") stepBackRef.current?.()
      else if (action === "toggle" && node) toggleGroupRef.current?.(node.id)
    }
    const backgroundListener = (event: cytoscape.EventObject) => { if (event.target === core) clearSelectionRef.current?.() }
    // 마우스로 고른 뒤에는 포커스가 body에 남아 캔버스의 keydown이 오지 않는다. 이때의 Esc도 선택을 푼다.
    const escapeListener = (event: KeyboardEvent) => { if (event.key === "Escape" && event.target === document.body) clearSelectionRef.current?.() }
    // ponytail: 드래그 중이 아니라 놓을 때만 가둔다. 커서를 따라가던 노드를 실시간으로 밀면 조작감이 나빠진다.
    const clampToNeighbourLanes = (node: cytoscape.NodeSingular) => {
      const count = laneCountRef.current
      const index = laneIndexForKind(String(node.data("kind")), count)
      const x = clampBetweenLanes(node.position().x, laneLimits(laneBounds(core, count, node), index, modelNodeWidth(core, node)))
      if (x === node.position().x) return
      const locked = node.locked?.() ?? false
      if (locked) node.unlock()
      node.position({ x, y: node.position().y })
      if (locked) node.lock()
    }
    const dragListener = (event: cytoscape.EventObject) => {
      clampToNeighbourLanes(event.target)
      publishLayout()
    }
    const viewportListener = () => scheduleViewportPublish()
    const wheelListener = (event: WheelEvent) => {
      interactionRef.current?.()
      event.preventDefault()
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? containerRef.current?.clientHeight ?? 600 : 1
      if (graphWheelIntent(inputModeRef.current, event) === "pan") core.panBy({ x: -event.deltaX * scale, y: -event.deltaY * scale })
      else {
        const bounds = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
        core.zoom({ level: Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, core.zoom() * Math.exp(-event.deltaY * scale * 0.002))), renderedPosition: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } })
      }
    }
    const showCardTooltip = (event: cytoscape.EventObject) => {
      // 모서리에서 크기를 조절하려는 중이면 경로 설명을 띄우지 않는다(카드와 이웃 노드를 가린다).
      if (String(event.type) !== "focus" && (cornerNodeRef.current || resizeDragRef.current)) return
      const target = event.target
      const label = String(target.data("accessibleLabel") ?? "")
      if (!label) return
      cancelTooltipHide()
      tooltipNodeRef.current = target.id()
      if (String(event.type) === "focus") { keyboardNodeRef.current = target.id(); target.addClass("keyboard-focus") }
      const position = target.renderedPosition(), hostWidth = containerRef.current?.clientWidth ?? 0
      const tooltipWidth = Math.min(360, Math.max(0, hostWidth - 16))
      setCardTooltip({ nodeId: target.id(), label, x: Math.max(8, Math.min(position.x - tooltipWidth / 2, hostWidth - tooltipWidth - 8)), y: position.y + target.renderedOuterHeight() / 2 + 8, width: tooltipWidth })
    }
    const hideCardTooltip = (event: cytoscape.EventObject) => {
      if (String(event.type) === "blur") { event.target.removeClass("keyboard-focus"); keyboardNodeRef.current = null }
      if (tooltipNodeRef.current !== event.target.id()) return
      if (String(event.type) === "blur" && !tooltipInteractionRef.current.pointer && !tooltipInteractionRef.current.focus) dismissCardTooltip()
      else scheduleTooltipHide()
    }
    // core.resize()는 캔버스를 지우므로 크기를 바꾸는 동안 매 프레임 부르면 깜빡인다. 조절이 멈춘 뒤 한 번만 맞춘다.
    let resizeTimer: number | null = null
    const scheduleResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => { resizeTimer = null; scheduleLaneCorrection() }, RESIZE_SETTLE_MS)
    }
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleResize)
    resizeObserver?.observe(containerRef.current)
    containerRef.current.addEventListener("wheel", wheelListener, { passive: false })
    core.on("tap", "node, edge", selectListener)
    core.on("dbltap", "node", openListener)
    core.on("tap", backgroundListener)
    window.addEventListener("keydown", escapeListener)
    core.on("mouseover focus", "node", showCardTooltip)
    core.on("mouseout blur", "node", hideCardTooltip)
    core.on("dragfree", "node", dragListener)
    core.on("viewport", viewportListener)
    // 노드 위치·크기(재배치, 끌기, 크기 조절)나 강조(split)가 바뀌면 다음 프레임에 엣지 경로를 한 번 다시 계산한다.
    let routeFrame: number | null = null
    const routeListener = () => {
      if (routeFrame !== null) return
      routeFrame = requestAnimationFrame(() => { routeFrame = null; applyEdgeRoutes(core, laneCountRef.current); setBands(readGroupBands(core)); updateSearchRings(core) })
    }
    core.on("position data add remove", routeListener)
    return () => {
      core.off("position data add remove", routeListener)
      if (routeFrame !== null) cancelAnimationFrame(routeFrame)
      core.off("tap", "node, edge", selectListener)
      core.off("dbltap", "node", openListener)
      core.off("tap", backgroundListener)
      window.removeEventListener("keydown", escapeListener)
      core.off("mouseover focus", "node", showCardTooltip)
      core.off("mouseout blur", "node", hideCardTooltip)
      core.off("dragfree", "node", dragListener)
      core.off("viewport", viewportListener)
      resizeObserver?.disconnect()
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      containerRef.current?.removeEventListener("wheel", wheelListener)
      if (correctionFrame !== null) cancelAnimationFrame(correctionFrame)
      if (viewportFrame !== null) cancelAnimationFrame(viewportFrame)
      if (scheduleLaneCorrectionRef.current === scheduleLaneCorrection) scheduleLaneCorrectionRef.current = null
      if (publishLayoutRef.current === publishLayout) publishLayoutRef.current = null
      keyboardNodeRef.current = null
      cancelTooltipHide()
      preferenceRef.current(readPreferences(core))
      core.destroy()
      if (coreRef.current === core) coreRef.current = null
    }
  }, [cancelTooltipHide, dismissCardTooltip, scheduleTooltipHide, updateSearchRings])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    dismissCardTooltip()
    keyboardNodeRef.current = null
    const saved = preferencesRef.current
    const live = hasProjectionRef.current ? readPreferences(core) : { positions: {}, sizes: {}, viewport: null }
    hasProjectionRef.current = true
    const relayout = appliedLayoutRef.current !== layoutVersion
    appliedLayoutRef.current = layoutVersion
    core.elements().remove()
    cardsRef.current = new Map()
    // 정렬은 위치만 바꾼다. 크기·viewport는 명시적 초기화 때만 비운다.
    // 선택은 여기서 다시 만들지 않는다(아래 effect가 강조 값만 바꾼다). 클릭마다 전체를 지우고 다시 그리면 깜빡인다.
    core.add(elementsFor(projection, selectedElementIdRef.current, confirmedNodeIds, relayout ? saved?.sizes ?? {} : { ...saved?.sizes, ...live.sizes }, cardsRef.current, theme, statusesByNode))
    applyHighlight(core, projection, highlightRef.current, cardsRef.current, theme, statusColorsRef.current, splitSourcesRef.current)
    setCornerCursor(null)
    positionInLanes(core, containerRef.current?.clientHeight ?? 0, relayout ? null : { ...saved?.positions, ...live.positions }, laneCount)
    core.nodes().forEach((node) => {
      if (locked) node.lock(); else node.unlock()
    })
    if (Object.keys(live.positions).length) core.viewport(live.viewport!)
    else if (saved?.viewport) core.viewport(saved.viewport)
    else if (!relayout) {
      core.layout({ name: "preset", fit: true, padding: 52 }).run()
    }
    syncSelection(core, selectedElementIdRef.current)
    scheduleLaneCorrectionRef.current?.()
  }, [confirmedNodeIds, dismissCardTooltip, laneCount, layoutVersion, locked, projection, statusesByNode, theme])

  // 강조 필터가 바뀌면 요소를 다시 만들지 않고 강조 상태와 API 카드 뱃지 색만 바꾼다.
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    applyHighlight(core, projectionRef.current, highlight, cardsRef.current, theme, statusColors, splitSources)
    setMinimap(readMinimap(core)); setBands(readGroupBands(core))
  }, [highlight, splitSources, statusColors, theme])

  // 검색 외곽선은 카드·위험 테두리와 분리한다. 입력마다 projection을 다시 만들지 않는다.
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    const apply = () => core.nodes().forEach(node => {
      const value = searchMatches.has(node.id()) ? "yes" : "no"
      if (node.data("searchMatch") !== value) node.data("searchMatch", value)
    })
    if (typeof core.batch === "function") core.batch(apply); else apply()
    updateSearchRings(core)
  }, [projection, searchMatches, theme, updateSearchRings])

  useEffect(() => {
    if (!revealRequest) return
    const frame = requestAnimationFrame(() => {
      const core = coreRef.current, canvas = containerRef.current
      if (!core || !canvas) return
      const node = core.getElementById(revealRequest.nodeId)
      if (!node.empty?.()) {
        core.resize()
        const position = node.position()
        const next = graphSearchViewport({ ...position, width: Number(node.data("width")), height: Number(node.data("height")) }, { zoom: core.zoom(), pan: core.pan() }, { width: canvas.clientWidth, height: canvas.clientHeight })
        const pan = core.pan()
        if (Math.abs(next.zoom - core.zoom()) > 0.001 || Math.abs(next.pan.x - pan.x) > 0.5 || Math.abs(next.pan.y - pan.y) > 0.5) {
          core.viewport(next)
          publishLayoutRef.current?.()
        }
      }
      onRevealedRef.current?.(revealRequest.requestId)
    })
    return () => cancelAnimationFrame(frame)
  }, [revealRequest])


  // ponytail: 한 레인만 다시 세운다. 전체 재정렬과 달리 다른 레인에서 잡아둔 배치는 건드리지 않는다.
  useEffect(() => {
    const core = coreRef.current
    if (!core || appliedLaneLayoutRef.current === laneLayout.version) return
    appliedLaneLayoutRef.current = laneLayout.version
    if (laneLayout.version === 0) return
    core.nodes().forEach((node) => { if (node.locked?.()) node.unlock() })
    positionInLanes(core, containerRef.current?.clientHeight ?? 0, null, laneCount, laneLayout.lane)
    if (locked) core.nodes().forEach((node) => { node.lock() })
    publishLayoutRef.current?.()
  }, [laneCount, laneLayout, locked, theme])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    const focus = graphFocusStates(projectionRef.current, selectedElementId)
    const apply = () => core.elements().forEach((element: cytoscape.SingularElementReturnValue) => {
      const id = element.id()
      const next = element.isEdge() ? focus.edge(id) : focus.node(id)
      if (element.data("focused") !== next) element.data("focused", next)
    })
    if (typeof core.batch === "function") core.batch(apply); else apply()
    syncSelection(core, selectedElementId)
    if (containerRef.current) publishGeometry(containerRef.current, core)
  }, [selectedElementId])

  // ponytail: 툴바 확대/축소 등 바깥에서 온 viewport만 적용한다. 캔버스가 방금 보고한 값이면 무시해야 팬 중에 되감기지 않는다.
  useEffect(() => {
    const core = coreRef.current, next = preferences?.viewport
    if (!core || !next) return
    const zoom = core.zoom(), pan = core.pan()
    if (Math.abs(zoom - next.zoom) < 0.001 && Math.abs(pan.x - next.pan.x) < 0.5 && Math.abs(pan.y - next.pan.y) < 0.5) return
    core.viewport(next)
  }, [preferences?.viewport])

  useEffect(() => {
    if (appliedFitRef.current !== fitVersion) {
      appliedFitRef.current = fitVersion
      dismissCardTooltip()
      coreRef.current?.fit(undefined, 36)
      scheduleLaneCorrectionRef.current?.()
      if (containerRef.current && new URLSearchParams(window.location.search).has("flowscope-e2e-geometry")) {
        containerRef.current.dataset.appliedFitVersion = String(fitVersion)
      }
    }
  }, [dismissCardTooltip, fitVersion])

  const focusNode = (direction = 0) => {
    const nodes = coreRef.current?.nodes().toArray()
    if (!nodes?.length) return
    const current = nodes.findIndex(node => node.id() === keyboardNodeRef.current)
    const index = current < 0 ? 0 : Math.max(0, Math.min(nodes.length - 1, current + direction))
    if (current >= 0) nodes[current].emit("blur")
    nodes[index].emit("focus")
  }

  return rendererUnavailable
    ? <p className="rounded-md border p-4 text-sm text-muted-foreground" role="status">그래프 캔버스를 초기화하지 못했습니다. 화면 크기를 조정하거나 API 목록을 사용하세요.</p>
    : <div className="relative h-full min-h-[28rem] w-full bg-[var(--flowscope-canvas)]">
      <div className="absolute inset-0 h-full min-h-[28rem] w-full focus-visible:outline-2 focus-visible:outline-ring" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px)", backgroundSize: "24px 24px" }} ref={containerRef} tabIndex={0} aria-label="공격면 Cytoscape 그래프" aria-describedby={cardTooltip ? tooltipId : undefined}
        onPointerMove={event => {
          if (resizeDragRef.current) return
          const nodeId = cornerNodeAt(event.clientX, event.clientY)
          if (nodeId !== cornerNodeRef.current) { setCornerCursor(nodeId); if (nodeId) dismissCardTooltip() }
        }}
        onPointerLeave={() => { if (!resizeDragRef.current) setCornerCursor(null) }}
        onPointerDownCapture={event => {
          interactionRef.current?.()
          const nodeId = cornerNodeRef.current ?? cornerNodeAt(event.clientX, event.clientY)
          const node = nodeId ? coreRef.current?.getElementById(nodeId) : null
          if (!nodeId || !node || node.empty() || event.button !== 0) return
          // pointerdown 기본 동작을 막으면 뒤이은 mousedown·mouseup 호환 이벤트가 생기지 않아 Cytoscape가 노드 이동·화면 이동으로 받지 않는다.
          event.preventDefault()
          event.stopPropagation()
          dismissCardTooltip()
          const start = nodeAnchor(node)
          resizeDragRef.current = { nodeId, clientX: event.clientX, clientY: event.clientY, width: start.width, height: start.height, left: start.left, top: start.top, zoom: coreRef.current?.zoom() || 1 }
          const move = (moveEvent: PointerEvent) => {
            const drag = resizeDragRef.current
            if (!drag) return
            resizeNode(drag.nodeId, drag.width + (moveEvent.clientX - drag.clientX) / drag.zoom, drag.height + (moveEvent.clientY - drag.clientY) / drag.zoom, drag)
          }
          const end = () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", end)
            window.removeEventListener("pointercancel", end)
            resizeDragRef.current = null
            setCornerCursor(null)
            publishLayoutRef.current?.()
          }
          window.addEventListener("pointermove", move)
          window.addEventListener("pointerup", end)
          window.addEventListener("pointercancel", end)
        }}
        onFocus={() => focusNode()}
        onBlur={event => {
          if (tooltipRef.current?.contains(event.relatedTarget as Node | null)) { cancelTooltipHide(); return }
          coreRef.current?.nodes(".keyboard-focus").emit("blur")
          dismissCardTooltip()
        }}
        onKeyDown={event => {
          interactionRef.current?.()
          // Shift+방향키: 포커스한 노드 크기 조절(오른쪽·아래로 늘리고 왼쪽·위로 줄인다). 마우스 없이 쓰는 모서리 조절 대안이다.
          if (event.shiftKey && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) && keyboardNodeRef.current && !locked) {
            event.preventDefault()
            const node = coreRef.current?.getElementById(keyboardNodeRef.current)
            if (!node || node.empty()) return
            const current = nodeAnchor(node), step = 16
            resizeNode(node.id(), current.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), current.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0), current)
            publishLayoutRef.current?.()
            return
          }
          if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); focusNode(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) }
          else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            const id = keyboardNodeRef.current
            if (!id) return
            // Enter는 열 수 있는 노드면 더블클릭과 같이 열고, 아니면 선택한다. Space는 항상 선택만 한다.
            const current = projectionRef.current
            const hierarchy = "kind" in current ? current : null
            const node = hierarchy?.nodes.find(item => item.id === id)
            const openable = event.key === "Enter" && node && hierarchy && graphOpenAction(node.kind, hierarchy.kind)
            coreRef.current?.getElementById(id).emit(openable ? "dbltap" : "tap")
          }
          else if (event.key === "Escape") { coreRef.current?.nodes(".keyboard-focus").emit("blur"); dismissCardTooltip(); clearSelectionRef.current?.() }
        }} />
      {searchRings.map(ring => <div key={ring.id} aria-hidden="true" className="pointer-events-none absolute rounded-lg border-2 border-dashed border-emerald-600 dark:border-emerald-300" style={{ left: ring.left, top: ring.top, width: ring.width, height: ring.height }}>{ring.member && <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-[var(--flowscope-pane)] px-1 text-[10px] text-emerald-700 dark:text-emerald-300">멤버 일치</span>}</div>)}
      {/* 펼친 묶음: 대표 카드와 멤버 왼쪽의 파란 선과, 오른쪽 위·아래의 접기 버튼. 선 영역은 클릭을 가로채지 않는다. */}
      {bands.map(band => {
        const fold = (edge: "top" | "bottom") => <button key={edge} type="button" aria-label={`${band.label} 묶음 접기${edge === "bottom" ? " (아래)" : ""}`} onClick={() => toggleGroupRef.current?.(band.id)}
          className="pointer-events-auto absolute left-[calc(100%+8px)] inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-sky-500/60 bg-[var(--flowscope-pane)] px-2.5 py-0.5 text-xs text-sky-600 shadow-sm hover:bg-sky-500/10 dark:text-sky-300"
          style={edge === "top" ? { top: 0 } : { bottom: 0 }}><ChevronUp className="size-3.5" aria-hidden="true" />{band.label} {band.count}개 접기</button>
        return <div key={band.id} className="pointer-events-none absolute z-10 border-l-[3px] border-sky-500" style={{ left: band.x1 - 10, top: band.y1 - 8, width: band.x2 - band.x1 + 18, height: band.y2 - band.y1 + 16 }}>
          {fold("top")}{band.count > 3 && fold("bottom")}
        </div>
      })}
      {minimap && <Minimap view={minimap} onCenter={(point) => {
        const core = coreRef.current
        if (!core) return
        const zoom = core.zoom() || 1
        core.pan({ x: core.width() / 2 - point.x * zoom, y: core.height() / 2 - point.y * zoom })
      }} />}
      {cardTooltip && <div ref={tooltipRef} id={tooltipId} role="tooltip" tabIndex={0} className="pointer-events-auto absolute z-20 max-h-[calc(100%-1rem)] overflow-y-auto overscroll-contain rounded-md border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-lg focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]" style={{ left: cardTooltip.x, top: cardTooltip.y, width: cardTooltip.width }}
        onPointerEnter={() => { tooltipInteractionRef.current.pointer = true; cancelTooltipHide() }}
        onPointerLeave={() => { tooltipInteractionRef.current.pointer = false; scheduleTooltipHide() }}
        onFocus={() => { tooltipInteractionRef.current.focus = true; cancelTooltipHide() }}
        onBlur={event => {
          tooltipInteractionRef.current.focus = false
          if (event.relatedTarget === containerRef.current) { cancelTooltipHide(); return }
          coreRef.current?.nodes(".keyboard-focus").emit("blur")
          dismissCardTooltip()
        }}
        onKeyDown={event => {
          if (event.key === "Escape") { containerRef.current?.focus(); dismissCardTooltip(); return }
          if (!["Home", "End", "PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(event.key)) return
          event.preventDefault()
          const element = event.currentTarget, end = Math.max(0, element.scrollHeight - element.clientHeight)
          const step = event.key.startsWith("Page") ? element.clientHeight : 40
          element.scrollTop = event.key === "Home" ? 0 : event.key === "End" ? end : Math.max(0, Math.min(end, element.scrollTop + (event.key.endsWith("Down") ? step : -step)))
        }}>{cardTooltip.label}</div>}
    </div>
}

/** 오른쪽 위 미니맵. 누르거나 끌면 그 지점을 화면 가운데로 옮긴다. 강조 필터에서 빠진 노드는 흐리게 그린다. */
function Minimap({ view, onCenter }: { view: MinimapView; onCenter(point: { x: number; y: number }): void }) {
  const center = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const matrix = svg.getScreenCTM?.()
    if (!matrix) return
    const point = svg.createSVGPoint()
    point.x = clientX; point.y = clientY
    const model = point.matrixTransform(matrix.inverse())
    onCenter({ x: model.x, y: model.y })
  }
  const { box } = view
  return <div className="absolute right-3 top-12 z-20 overflow-hidden rounded-md border border-border/70 bg-[var(--flowscope-pane)] shadow-sm" style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}>
    <svg role="img" aria-label="그래프 미니맵" width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className="cursor-pointer touch-none"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); center(event.currentTarget, event.clientX, event.clientY) }}
      onPointerMove={(event) => { if (event.buttons === 1) center(event.currentTarget, event.clientX, event.clientY) }}>
      {view.nodes.map((node) => <rect key={node.id} x={node.x} y={node.y} width={node.w} height={node.h} rx={10} className={node.dim ? "fill-muted-foreground/15" : "fill-muted-foreground/55"} />)}
      <rect x={view.view.x} y={view.view.y} width={view.view.w} height={view.view.h} className="fill-sky-400/10 stroke-sky-500" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  </div>
}
