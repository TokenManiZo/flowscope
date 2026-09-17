import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

import { renderParameterNodeCardSvg } from "@/features/parameter-map/parameterNodeCard"
import type { GraphPreferences } from "./graphPreferences"
import { defaultLaneWidths, GRAPH_MAX_ZOOM, GRAPH_MIN_ZOOM, laneGeometry, laneIndexForKind } from "./graphLanes"
import { selectGraphItem, type GraphProjection, type GraphSelection } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { deriveGraphFocus } from "./graphFocus"
import { relationshipNodeCard, relationshipRouteCandidateCard } from "./relationshipNodeCard"

interface Props {
  projection: GraphProjection | HierarchyProjection
  locked: boolean
  fitVersion: number
  layoutVersion?: number
  laneWidths?: readonly number[]
  preferences?: GraphPreferences | null
  confirmedNodeIds?: ReadonlySet<string>
  selectedElementId?: string | null
  onSelect(selection: GraphSelection, elementId: string): void
  onNavigate?(node: HierarchyNode): void
  onPreferencesChange(preferences: Pick<GraphPreferences, "positions" | "viewport">): void
  onRendererUnavailable?(): void
}

const noConfirmedNodes = new Set<string>()

export function graphWheelIntent(mode: GraphPreferences["inputMode"], event: Pick<WheelEvent, "ctrlKey" | "deltaMode" | "deltaX" | "deltaY">): "pan" | "zoom" {
  if (event.ctrlKey) return "zoom"
  if (mode !== "auto") return mode === "trackpad" ? "pan" : "zoom"
  // ponytail: 브라우저는 입력 장치 종류를 주지 않으므로 오판하는 장치는 설정의 명시 모드로 보정한다.
  return event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (event.deltaX !== 0 || Math.abs(event.deltaY) < 50 || !Number.isInteger(event.deltaY)) ? "pan" : "zoom"
}

function elementsFor(projection: GraphProjection | HierarchyProjection, selectedElementId: string | null, confirmedNodeIds: ReadonlySet<string>): ElementDefinition[] {
  const hierarchy = "kind" in projection ? projection : null
  const focus = deriveGraphFocus(hierarchy, selectedElementId)
  const nodes = (hierarchy ? hierarchy.nodes.filter(node => node.kind !== "route-candidate") : [...projection.identities, ...projection.operations, ...projection.resources]).map((node) => {
    const card = relationshipNodeCard(node, projection)
    const image = renderParameterNodeCardSvg(card, true)
    return { data: { id: node.id, label: "", cardImage: image.uri, accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: node.verdictText, kind: node.kind, confirmed: confirmedNodeIds.has(node.id) ? "yes" : "no" } }
  })
  const candidates = projection.routeCandidates.map((candidate) => {
    const card = relationshipRouteCandidateCard(candidate)
    const image = renderParameterNodeCardSvg(card, true)
    return { data: { id: candidate.id, label: "", cardImage: image.uri, accessibleLabel: card.accessibleLabel, width: image.width, height: image.height, verdictText: candidate.applicability, kind: "route-candidate", confirmed: "no" } }
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

function positionInLanes(core: Core, height: number, savedPositions: GraphPreferences["positions"] | null, laneWidths: readonly number[]) {
  const columns: cytoscape.NodeSingular[][] = laneWidths.map(() => [])
  core.nodes().forEach((node) => { columns[laneIndexForKind(String(node.data("kind")), laneWidths.length)]?.push(node) })
  const usableHeight = Math.max(height, 620)
  columns.forEach((nodes, index) => {
    const gap = Math.min(128, (usableHeight - 130) / Math.max(nodes.length, 1))
    const start = (usableHeight - gap * Math.max(nodes.length - 1, 0)) / 2
    const anchor = laneGeometry(laneWidths, index).anchor
    nodes.forEach((node, order) => node.position({
      x: savedPositions?.[node.id()]?.x ?? anchor,
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

export function CytoscapeGraph({ projection, locked, fitVersion, layoutVersion = 0, laneWidths, preferences = null, confirmedNodeIds = noConfirmedNodes, selectedElementId = null, onSelect, onNavigate, onPreferencesChange, onRendererUnavailable }: Props) {
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
  const laneCount = "kind" in projection && projection.kind !== "operation" ? 2 : 3
  const lanes = useMemo(() => laneWidths?.length === laneCount ? laneWidths : defaultLaneWidths(laneCount), [laneCount, laneWidths])
  const preferencesRef = useRef(preferences)
  const appliedLayoutRef = useRef(layoutVersion)
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
          { selector: "node", style: { "background-color": "#111418", "background-image": "data(cardImage)", "background-fit": "contain", "background-clip": "none", label: "data(label)", color: "#e5e7eb", width: "data(width)", height: "data(height)", padding: 0, shape: "round-rectangle", "border-width": 1, "border-color": "#64748b", "border-opacity": 0.85 } },
          { selector: 'node[confirmed = "yes"]', style: { "border-width": 2, "border-color": "#ef4444" } },
          { selector: "node:selected", style: { "border-width": 2, "border-color": "#60a5fa", "background-color": "#141a20", "overlay-opacity": 0 } },
          { selector: 'node[kind = "route-candidate"]', style: { "border-width": 2, "border-style": "dotted", "border-color": "#64748b", "background-color": "#111418" } },
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
      if (typeof core.resize === "function") core.resize()
      syncSelection(core, selectedElementIdRef.current)
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
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
    // ponytail: 레인은 초기 배치와 재정렬의 기준일 뿐이라 놓은 자리를 그대로 저장한다. 되돌리려면 `레인 기준 재정렬`을 쓴다.
    const dragListener = () => {
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
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
    core.add(elementsFor(projection, selectedElementId, confirmedNodeIds))
    positionInLanes(core, containerRef.current?.clientHeight ?? 0, relayout ? null : saved?.positions ?? null, lanes)
    core.nodes().forEach((node) => {
      if (locked) node.lock(); else node.unlock()
    })
    if (saved?.viewport && !relayout) core.viewport(saved.viewport)
    else {
      core.layout({ name: "preset", fit: true, padding: 52 }).run()
    }
    syncSelection(core, selectedElementIdRef.current)
    scheduleLaneCorrectionRef.current?.()
  }, [confirmedNodeIds, dismissCardTooltip, lanes, layoutVersion, locked, projection, selectedElementId])

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
