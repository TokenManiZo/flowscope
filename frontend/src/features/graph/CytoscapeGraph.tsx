import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

import { renderParameterNodeCardSvg } from "@/features/parameter-map/parameterNodeCard"
import type { GraphPreferences } from "./graphPreferences"
import { clampRenderedPosition, graphLaneForKind, laneGeometry, type GraphLane } from "./graphLanes"
import { selectGraphItem, type GraphProjection, type GraphSelection } from "./graphProjection"
import { routeCandidateTone } from "./routeCandidateTone"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { deriveGraphFocus } from "./graphFocus"
import { relationshipNodeCard, relationshipRouteCandidateCard } from "./relationshipNodeCard"

interface Props {
  projection: GraphProjection | HierarchyProjection
  locked: boolean
  fitVersion: number
  preferences?: GraphPreferences | null
  selectedElementId?: string | null
  onSelect(selection: GraphSelection, elementId: string): void
  onNavigate?(node: HierarchyNode): void
  onMaxZoomChange?(maxZoom: number): void
  onPreferencesChange(preferences: Pick<GraphPreferences, "positions" | "viewport">): void
  onRendererUnavailable?(): void
}

const minimumZoom = 0.4
const maximumZoom = 2

function elementsFor(projection: GraphProjection | HierarchyProjection, selectedElementId: string | null): ElementDefinition[] {
  const hierarchy = "kind" in projection ? projection : null
  const focus = deriveGraphFocus(hierarchy, selectedElementId)
  const nodes = (hierarchy ? hierarchy.nodes.filter(node => node.kind !== "route-candidate") : [...projection.identities, ...projection.operations, ...projection.resources]).map((node) => {
    const card = relationshipNodeCard(node, projection)
    const image = renderParameterNodeCardSvg(card)
    return { data: { id: node.id, label: "", cardImage: image.uri, accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: node.verdictText, verdictColor: node.verdictColor, kind: node.kind } }
  })
  const candidates = projection.routeCandidates.map((candidate) => {
    const card = relationshipRouteCandidateCard(candidate)
    const image = renderParameterNodeCardSvg(card)
    return { data: { id: candidate.id, label: "", cardImage: image.uri, accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: candidate.applicability, verdictColor: routeCandidateTone(candidate.applicability).color, kind: "route-candidate" } }
  })
  const edges = projection.edges.map((edge) => {
    const endpointId = edge.selection.operation ? `operation:${edge.selection.operation}` : edge.targetId
    const source = edge.relation === "resource-operation" ? edge.targetId : edge.sourceId
    const target = edge.relation === "identity-resource" ? endpointId : edge.relation === "resource-operation" ? edge.sourceId : edge.targetId
    return { data: { id: edge.id, source, target, label: `${edge.sourceText}${edge.countLabel ? ` ${edge.countLabel}` : ""}`, sourceText: edge.sourceText, line: edge.line, color: edge.color, countLabel: edge.countLabel, focused: focus.edgeState(edge.id) } }
  })
  return [...nodes, ...candidates, ...edges]
}

function readPreferences(core: Core): Pick<GraphPreferences, "positions" | "viewport"> {
  const positions: GraphPreferences["positions"] = {}
  core.nodes().forEach((node) => { const position = node.position(); positions[node.id()] = { x: position.x, y: position.y } })
  return { positions, viewport: { zoom: core.zoom(), pan: core.pan() } }
}

function modelXForRenderedX(core: Core, renderedX: number) {
  const zoom = core.zoom() || 1
  return (renderedX - core.pan().x) / zoom
}

function visualLane(width: number, kind: string, projection: GraphProjection | HierarchyProjection) {
  if (!("kind" in projection) || projection.kind === "operation") return laneGeometry(width, graphLaneForKind(kind))
  const index = kind === "identity" || kind === "target" ? 0 : 1
  const laneWidth = Math.max(0, width) / 2
  const gutter = Math.min(24, laneWidth / 2)
  return { left: index * laneWidth + gutter, right: (index + 1) * laneWidth - gutter, anchor: (index + 0.5) * laneWidth }
}

function positionInLanes(core: Core, width: number, height: number, savedPositions: GraphPreferences["positions"] | null, projection: GraphProjection | HierarchyProjection) {
  const columns: Record<GraphLane, cytoscape.NodeSingular[]> = { identity: [], endpoint: [], object: [] }
  core.nodes().forEach((node) => {
    const kind = String(node.data("kind"))
    columns[kind === "target" ? "identity" : graphLaneForKind(kind)].push(node)
  })
  const usableHeight = Math.max(height, 620)
  ;(["identity", "endpoint", "object"] as const).forEach((lane) => {
    const nodes = columns[lane]
    const gap = Math.min(128, (usableHeight - 130) / Math.max(nodes.length, 1))
    const start = (usableHeight - gap * Math.max(nodes.length - 1, 0)) / 2
    const anchor = visualLane(width, lane === "identity" ? "identity" : lane === "object" ? "resource" : "operation", projection).anchor
    nodes.forEach((node, index) => node.position({
      x: modelXForRenderedX(core, anchor),
      y: savedPositions?.[node.id()]?.y ?? start + index * gap,
    }))
  })
}

function clampNodeToLane(core: Core, node: cytoscape.NodeSingular, width: number, projection: GraphProjection | HierarchyProjection) {
  const lane = visualLane(width, String(node.data("kind")), projection)
  const halfWidth = node.renderedOuterWidth() / 2
  const boundedLane = lane.right - lane.left >= halfWidth * 2
    ? { ...lane, left: lane.left + halfWidth, right: lane.right - halfWidth }
    : { ...lane, left: lane.anchor, right: lane.anchor }
  const rendered = clampRenderedPosition(node.renderedPosition(), boundedLane)
  const locked = node.locked?.() ?? false
  if (locked) node.unlock()
  node.position({ x: modelXForRenderedX(core, rendered.x), y: node.position().y })
  if (locked) node.lock()
}

function supportedMaxZoom(core: Core, width: number, projection: GraphProjection | HierarchyProjection) {
  const currentZoom = core.zoom() || 1
  let widestModelWidth = 0
  core.nodes().forEach((node) => {
    widestModelWidth = Math.max(widestModelWidth, node.renderedOuterWidth() / currentZoom)
  })
  if (widestModelWidth <= 0 || width <= 0) return maximumZoom
  const narrowestLane = (["identity", "operation", "resource"] as const).reduce((available, kind) => {
    const geometry = visualLane(width, kind, projection)
    return Math.min(available, geometry.right - geometry.left)
  }, Number.POSITIVE_INFINITY)
  const unrounded = narrowestLane / widestModelWidth
  return Math.max(minimumZoom, Math.min(maximumZoom, Math.floor((unrounded + Number.EPSILON) * 10) / 10))
}

function constrainZoomToLanes(core: Core, width: number, projection: GraphProjection | HierarchyProjection) {
  const maxZoom = supportedMaxZoom(core, width, projection)
  core.maxZoom(maxZoom)
  if (core.zoom() > maxZoom) core.zoom(maxZoom)
  return maxZoom
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

export function CytoscapeGraph({ projection, locked, fitVersion, preferences = null, selectedElementId = null, onSelect, onNavigate, onMaxZoomChange, onPreferencesChange, onRendererUnavailable }: Props) {
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
  const maxZoomRef = useRef(onMaxZoomChange)
  const preferenceRef = useRef(onPreferencesChange)
  const rendererUnavailableRef = useRef(onRendererUnavailable)
  const scheduleLaneCorrectionRef = useRef<(() => void) | null>(null)
  projectionRef.current = projection
  selectRef.current = onSelect
  navigateRef.current = onNavigate
  selectedElementIdRef.current = selectedElementId
  maxZoomRef.current = onMaxZoomChange
  preferenceRef.current = onPreferencesChange
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
        style: [
          { selector: "node", style: { "background-color": "#111418", "background-image": "data(cardImage)", "background-fit": "contain", "background-clip": "none", label: "data(label)", color: "#e5e7eb", width: "data(width)", height: "data(height)", padding: 0, shape: "round-rectangle", "border-width": 1, "border-color": "data(verdictColor)", "border-opacity": 0.85 } },
          { selector: "node:selected", style: { "border-width": 2, "border-color": "#60a5fa", "background-color": "#141a20", "overlay-opacity": 0 } },
          { selector: 'node[kind = "route-candidate"]', style: { "border-width": 2, "border-style": "dotted", "border-color": "data(verdictColor)", "background-color": "#111418" } },
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
    let correctionFrame: number | null = null
    const correctLanes = () => {
      correctionFrame = null
      const width = containerRef.current?.clientWidth ?? 0
      const maxZoom = constrainZoomToLanes(core, width, projectionRef.current)
      core.nodes().forEach((node) => clampNodeToLane(core, node, width, projectionRef.current))
      syncSelection(core, selectedElementIdRef.current)
      if (containerRef.current) publishGeometry(containerRef.current, core)
      maxZoomRef.current?.(maxZoom)
      preferenceRef.current(readPreferences(core))
    }
    const scheduleLaneCorrection = () => {
      if (correctionFrame !== null) return
      correctionFrame = requestAnimationFrame(correctLanes)
    }
    scheduleLaneCorrectionRef.current = scheduleLaneCorrection
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
    const dragListener = (event: cytoscape.EventObject) => {
      clampNodeToLane(core, event.target, containerRef.current?.clientWidth ?? 0, projectionRef.current)
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
    }
    const viewportListener = () => scheduleLaneCorrection()
    const showCardTooltip = (event: cytoscape.EventObject) => {
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
      if (correctionFrame !== null) cancelAnimationFrame(correctionFrame)
      if (scheduleLaneCorrectionRef.current === scheduleLaneCorrection) scheduleLaneCorrectionRef.current = null
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
    core.elements().remove()
    core.add(elementsFor(projection, selectedElementId))
    positionInLanes(core, containerRef.current?.clientWidth ?? 0, containerRef.current?.clientHeight ?? 0, preferences?.positions ?? null, projection)
    core.nodes().forEach((node) => {
      if (locked) node.lock(); else node.unlock()
    })
    if (preferences?.viewport) core.viewport(preferences.viewport)
    else {
      core.layout({ name: "preset", fit: true, padding: 52 }).run()
    }
    syncSelection(core, selectedElementIdRef.current)
    scheduleLaneCorrectionRef.current?.()
  }, [dismissCardTooltip, locked, preferences, projection, selectedElementId])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    syncSelection(core, selectedElementId)
    if (containerRef.current) publishGeometry(containerRef.current, core)
  }, [selectedElementId])

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
        onFocus={() => focusNode()}
        onBlur={event => {
          if (tooltipRef.current?.contains(event.relatedTarget as Node | null)) { cancelTooltipHide(); return }
          coreRef.current?.nodes(".keyboard-focus").emit("blur")
          dismissCardTooltip()
        }}
        onKeyDown={event => {
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
