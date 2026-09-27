import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

import { cardSurface, renderParameterNodeCardSvg, type CardSource, type CardTheme, type ParameterNodeCardView } from "@/features/parameter-map/parameterNodeCard"
import { useDocumentTheme } from "@/hooks/useTheme"
import { NODE_SIZE_LIMIT, type GraphPreferences, type NodeSize } from "./graphPreferences"
import { clampBetweenLanes, GRAPH_MAX_ZOOM, GRAPH_MIN_ZOOM, LANE_GAP, laneAnchor, laneIndexForKind, laneLimits, type LaneBounds } from "./graphLanes"
import { selectGraphItem, type GraphProjection, type GraphSelection } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { deriveGraphFocus } from "./graphFocus"
import { relationshipNodeCard, relationshipRouteCandidateCard } from "./relationshipNodeCard"

interface Props {
  projection: GraphProjection | HierarchyProjection
  locked: boolean
  fitVersion: number
  layoutVersion?: number
  /** 한 레인만 다시 세운다. version이 바뀔 때만 실행한다. */
  laneLayout?: { lane: number; version: number }
  preferences?: GraphPreferences | null
  confirmedNodeIds?: ReadonlySet<string>
  selectedElementId?: string | null
  onSelect(selection: GraphSelection, elementId: string): void
  onNavigate?(node: HierarchyNode): void
  /** 레인별 화면 좌표 범위. 헤더가 노드가 만든 실제 범위를 따라간다. */
  onLaneBoundsChange?(bounds: ReadonlyArray<LaneBounds | null>): void
  onPreferencesChange(preferences: Pick<GraphPreferences, "positions" | "viewport" | "sizes">): void
  onRendererUnavailable?(): void
}

const noConfirmedNodes = new Set<string>()
/** 관측 엣지 색. 라이트는 흰 캔버스에서 선이 보이도록 한 단계 진하게 둔다. */
const EDGE_COLOR: Record<CardTheme, string> = { dark: "#94a3b8", light: "#64748b" }
const noLaneLayout = { lane: 0, version: 0 }

export function graphWheelIntent(mode: GraphPreferences["inputMode"], event: Pick<WheelEvent, "ctrlKey" | "deltaMode" | "deltaX" | "deltaY">): "pan" | "zoom" {
  if (event.ctrlKey) return "zoom"
  if (mode !== "auto") return mode === "trackpad" ? "pan" : "zoom"
  // ponytail: 브라우저는 입력 장치 종류를 주지 않으므로 오판하는 장치는 설정의 명시 모드로 보정한다.
  return event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (event.deltaX !== 0 || Math.abs(event.deltaY) < 50 || !Number.isInteger(event.deltaY)) ? "pan" : "zoom"
}

function elementsFor(projection: GraphProjection | HierarchyProjection, selectedElementId: string | null, confirmedNodeIds: ReadonlySet<string>, sizes: Readonly<Record<string, NodeSize>> = {}, cards?: Map<string, ParameterNodeCardView>, theme: CardTheme = "dark"): ElementDefinition[] {
  const hierarchy = "kind" in projection ? projection : null
  const focus = deriveGraphFocus(hierarchy, selectedElementId)
  const edges = projection.edges.map((edge) => {
    const endpointId = edge.selection.operation ? `operation:${edge.selection.operation}` : edge.targetId
    const source = edge.relation === "resource-operation" ? edge.targetId : edge.sourceId
    const target = edge.relation === "identity-resource" ? endpointId : edge.relation === "resource-operation" ? edge.sourceId : edge.targetId
    // 관측 엣지는 주체 구분 없이 한 가지 선으로 그리고 접근 주체는 양 끝 노드 카드의 아이콘으로만 표시한다.
    // 주체가 없는 구조·경로 후보 엣지는 '미관측' 표시(회색 점선)를 그대로 둔다.
    const observed = edge.source !== null
    return { data: { id: edge.id, source, target, label: "", sourceText: edge.sourceText, line: observed ? "solid" : edge.line, color: observed ? EDGE_COLOR[theme] : edge.color, countLabel: edge.countLabel, focused: focus.edgeState(edge.id) }, origin: edge.source }
  })
  const nodeSources = new Map<string, Set<CardSource>>()
  for (const { data, origin } of edges) {
    if (origin !== "human" && origin !== "scanner" && origin !== "llm") continue
    for (const id of [data.source, data.target]) nodeSources.set(id, (nodeSources.get(id) ?? new Set<CardSource>()).add(origin))
  }
  const nodes = (hierarchy ? hierarchy.nodes.filter(node => node.kind !== "route-candidate") : [...projection.identities, ...projection.operations, ...projection.resources]).map((node) => {
    // 접근 주체 아이콘은 오른쪽 API·Object 노드에만 둔다.
    const sources = node.kind === "operation" || node.kind === "resource" ? [...(nodeSources.get(node.id) ?? [])] : []
    const base = relationshipNodeCard(node, projection)
    const card = sources.length ? { ...base, sources, accessibleLabel: `${base.accessibleLabel}; 접근 주체 ${sources.map(source => source.toUpperCase()).join(", ")}` } : base
    cards?.set(node.id, card)
    const size = sizes[node.id]
    const image = renderParameterNodeCardSvg(card, true, size, theme)
    return { data: { id: node.id, label: "", cardImage: image.uri, cardColor: cardSurface(theme), accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: node.verdictText, kind: node.kind, confirmed: confirmedNodeIds.has(node.id) ? "yes" : "no", ...(size ? { customWidth: image.width, customHeight: image.height } : {}) } }
  })
  const candidates = projection.routeCandidates.map((candidate) => {
    const card = relationshipRouteCandidateCard(candidate)
    cards?.set(candidate.id, card)
    const size = sizes[candidate.id]
    const image = renderParameterNodeCardSvg(card, true, size, theme)
    return { data: { id: candidate.id, label: "", cardImage: image.uri, cardColor: cardSurface(theme), accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: candidate.applicability, kind: "route-candidate", confirmed: "no", ...(size ? { customWidth: image.width, customHeight: image.height } : {}) } }
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

function positionInLanes(core: Core, height: number, savedPositions: GraphPreferences["positions"] | null, laneCount: number, onlyLane: number | null = null) {
  const usableHeight = Math.max(height, 620)
  laneColumns(core, laneCount).forEach((nodes, index) => {
    if (onlyLane !== null && onlyLane !== index) return
    const gap = Math.min(128, (usableHeight - 130) / Math.max(nodes.length, 1))
    const start = (usableHeight - gap * Math.max(nodes.length - 1, 0)) / 2
    nodes.forEach((node, order) => node.position({
      x: savedPositions?.[node.id()]?.x ?? laneAnchor(index),
      y: savedPositions?.[node.id()]?.y ?? start + order * gap,
    }))
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

export function CytoscapeGraph({ projection, locked, fitVersion, layoutVersion = 0, laneLayout = noLaneLayout, preferences = null, confirmedNodeIds = noConfirmedNodes, selectedElementId = null, onSelect, onNavigate, onLaneBoundsChange, onPreferencesChange, onRendererUnavailable }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const coreRef = useRef<Core | null>(null)
  const keyboardNodeRef = useRef<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const tooltipNodeRef = useRef<string | null>(null)
  const tooltipInteractionRef = useRef({ pointer: false, focus: false })
  const tooltipHideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const tooltipId = useId()
  const [rendererUnavailable, setRendererUnavailable] = useState(false)
  const [cardTooltip, setCardTooltip] = useState<{ nodeId: string; label: string; x: number; y: number; width: number } | null>(null)
  const projectionRef = useRef(projection)
  const selectRef = useRef(onSelect)
  const navigateRef = useRef(onNavigate)
  const selectedElementIdRef = useRef(selectedElementId)
  const preferenceRef = useRef(onPreferencesChange)
  const inputModeRef = useRef(preferences?.inputMode ?? "auto")
  const rendererUnavailableRef = useRef(onRendererUnavailable)
  const scheduleLaneCorrectionRef = useRef<(() => void) | null>(null)
  const publishLayoutRef = useRef<(() => void) | null>(null)
  const laneCount = "kind" in projection && projection.kind !== "operation" ? 2 : 3
  const theme = useDocumentTheme()
  const laneCountRef = useRef(laneCount)
  const preferencesRef = useRef(preferences)
  const appliedLayoutRef = useRef(layoutVersion)
  const appliedLaneLayoutRef = useRef(laneLayout.version)
  const laneBoundsRef = useRef<ReadonlyArray<LaneBounds | null>>([])
  const laneBoundsListenerRef = useRef(onLaneBoundsChange)
  laneBoundsListenerRef.current = onLaneBoundsChange
  laneCountRef.current = laneCount
  preferencesRef.current = preferences
  projectionRef.current = projection
  selectRef.current = onSelect
  navigateRef.current = onNavigate
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
    const image = renderParameterNodeCardSvg(card, true, custom ? { width: Math.round(nextWidth), height: Math.round(nextHeight) } : undefined, theme)
    node.data({ cardImage: image.uri, width: image.width, height: image.height })
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
          { selector: "edge", style: { width: 1.7, "line-color": "data(color)", "line-style": "data(line)", "target-arrow-color": "data(color)", "target-arrow-shape": "triangle", "arrow-scale": 0.65, label: "data(label)", color: "#d4d4d8", "font-size": "9px", "font-family": "Geist Mono, ui-monospace, monospace", "text-background-color": "#090b0d", "text-background-opacity": 0.86, "text-background-padding": "2px", "text-rotation": "autorotate", "text-margin-y": -7, "curve-style": "bezier", opacity: 0.9 } },
          { selector: "edge:selected", style: { width: 2.6, "line-color": "data(color)", "target-arrow-color": "data(color)" } },
          { selector: 'edge[focused = "yes"]', style: { width: 3, opacity: 1 } },
          { selector: 'edge[focused = "no"]', style: { opacity: 0.15 } },
        ] as unknown as cytoscape.StylesheetJson,
      })
    } catch {
      setRendererUnavailable(true)
      rendererUnavailableRef.current?.()
      return
    }
    coreRef.current = core
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
      if (node && (node.kind === "api-group" || node.kind === "operation" && hierarchy?.kind === "group")) { navigateRef.current?.(node); return }
      if (node?.kind === "target" || hierarchy?.edges.some(edge => edge.id === id && edge.structural)) return
      const selection = hierarchy ? node?.selection ?? hierarchy.edges.find(edge => edge.id === id)?.selection : selectGraphItem(current as GraphProjection, id)
      if (selection) selectRef.current(selection, event.target.id())
    }
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
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleLaneCorrection)
    resizeObserver?.observe(containerRef.current)
    containerRef.current.addEventListener("wheel", wheelListener, { passive: false })
    core.on("tap", "node, edge", selectListener)
    core.on("mouseover focus", "node", showCardTooltip)
    core.on("mouseout blur", "node", hideCardTooltip)
    core.on("dragfree", "node", dragListener)
    core.on("viewport", viewportListener)
    return () => {
      core.off("tap", "node, edge", selectListener)
      core.off("mouseover focus", "node", showCardTooltip)
      core.off("mouseout blur", "node", hideCardTooltip)
      core.off("dragfree", "node", dragListener)
      core.off("viewport", viewportListener)
      resizeObserver?.disconnect()
      containerRef.current?.removeEventListener("wheel", wheelListener)
      if (correctionFrame !== null) cancelAnimationFrame(correctionFrame)
      if (viewportFrame !== null) cancelAnimationFrame(viewportFrame)
      if (scheduleLaneCorrectionRef.current === scheduleLaneCorrection) scheduleLaneCorrectionRef.current = null
      if (publishLayoutRef.current === publishLayout) publishLayoutRef.current = null
      keyboardNodeRef.current = null
      cancelTooltipHide()
      core.destroy()
      if (coreRef.current === core) coreRef.current = null
    }
  }, [cancelTooltipHide, dismissCardTooltip, scheduleTooltipHide])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    dismissCardTooltip()
    keyboardNodeRef.current = null
    const saved = preferencesRef.current
    const relayout = appliedLayoutRef.current !== layoutVersion
    appliedLayoutRef.current = layoutVersion
    core.elements().remove()
    cardsRef.current = new Map()
    // 전체 재정렬(layoutVersion 변경)만 사용자가 바꾼 크기를 비운다. 새로고침·필터·이동은 저장된 크기를 그대로 쓴다.
    core.add(elementsFor(projection, selectedElementId, confirmedNodeIds, relayout ? {} : saved?.sizes ?? {}, cardsRef.current, theme))
    setCornerCursor(null)
    positionInLanes(core, containerRef.current?.clientHeight ?? 0, relayout ? null : saved?.positions ?? null, laneCount)
    core.nodes().forEach((node) => {
      if (locked) node.lock(); else node.unlock()
    })
    if (saved?.viewport && !relayout) core.viewport(saved.viewport)
    else {
      core.layout({ name: "preset", fit: true, padding: 52 }).run()
    }
    syncSelection(core, selectedElementIdRef.current)
    scheduleLaneCorrectionRef.current?.()
  }, [confirmedNodeIds, dismissCardTooltip, laneCount, layoutVersion, locked, projection, selectedElementId, theme])

  // ponytail: 한 레인만 다시 세운다. 전체 재정렬과 달리 다른 레인에서 잡아둔 배치는 건드리지 않는다.
  useEffect(() => {
    const core = coreRef.current
    if (!core || appliedLaneLayoutRef.current === laneLayout.version) return
    appliedLaneLayoutRef.current = laneLayout.version
    if (laneLayout.version === 0) return
    core.nodes().forEach((node) => { if (node.locked?.()) node.unlock() })
    // 레인 머리글 정렬은 그 레인 노드의 크기만 기본으로 되돌린다.
    laneColumns(core, laneCount)[laneLayout.lane]?.forEach((node) => {
      if (node.data("customWidth") === undefined) return
      const card = cardsRef.current.get(node.id())
      if (!card) return
      const image = renderParameterNodeCardSvg(card, true, undefined, theme)
      node.data({ cardImage: image.uri, width: image.width, height: image.height })
      node.removeData("customWidth customHeight")
    })
    positionInLanes(core, containerRef.current?.clientHeight ?? 0, null, laneCount, laneLayout.lane)
    if (locked) core.nodes().forEach((node) => { node.lock() })
    publishLayoutRef.current?.()
  }, [laneCount, laneLayout, locked, theme])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
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
    if (fitVersion > 0) {
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
          else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (keyboardNodeRef.current) coreRef.current?.getElementById(keyboardNodeRef.current).emit("tap") }
          else if (event.key === "Escape") { coreRef.current?.nodes(".keyboard-focus").emit("blur"); dismissCardTooltip() }
        }} />
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
