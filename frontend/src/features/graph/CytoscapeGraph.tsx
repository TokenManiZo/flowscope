import { useEffect, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

import type { GraphPreferences } from "./graphPreferences"
import { clampRenderedPosition, graphLaneForKind, laneGeometry, type GraphLane } from "./graphLanes"
import { selectGraphItem, type GraphProjection, type GraphSelection } from "./graphProjection"
import { routeCandidateTone } from "./routeCandidateTone"

interface Props {
  projection: GraphProjection
  locked: boolean
  fitVersion: number
  preferences?: GraphPreferences | null
  selectedElementId?: string | null
  onSelect(selection: GraphSelection, elementId: string): void
  onMaxZoomChange?(maxZoom: number): void
  onPreferencesChange(preferences: Pick<GraphPreferences, "positions" | "viewport">): void
  onRendererUnavailable?(): void
}

const minimumZoom = 0.4
const maximumZoom = 2

function compactNodeLabel(label: string, kind: string) {
  if (kind === "operation") {
    const match = label.match(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE|CONNECT|UNKNOWN)\s+(\/\S*)$/i)
    if (match) return `${match[1].toUpperCase()} ${match[2]}`
  }
  if (kind === "resource") return label.replace(/^https?:\/\/\S+\s+/, "")
  return label
}

function elementsFor(projection: GraphProjection): ElementDefinition[] {
  const nodes = [...projection.identities, ...projection.operations, ...projection.resources].map((node) => {
    const label = compactNodeLabel(node.label, node.kind)
    return { data: { id: node.id, label: projection.view === "authz" ? `${label}\n${node.verdictText}` : label, verdictText: node.verdictText, verdictColor: node.verdictColor, kind: node.kind } }
  })
  const candidates = projection.routeCandidates.map((candidate) => ({ data: { id: candidate.id, label: `${candidate.method} ${candidate.pathTemplate}\n${candidate.observedText} · ${candidate.applicability}`, verdictText: candidate.applicability, verdictColor: routeCandidateTone(candidate.applicability).color, kind: "route-candidate" } }))
  const edges = projection.edges.map((edge) => {
    const endpointId = edge.selection.operation ? `operation:${edge.selection.operation}` : edge.targetId
    const source = edge.relation === "resource-operation" ? edge.targetId : edge.sourceId
    const target = edge.relation === "identity-resource" ? endpointId : edge.relation === "resource-operation" ? edge.sourceId : edge.targetId
    return { data: { id: edge.id, source, target, label: `${edge.sourceText}${edge.countLabel ? ` ${edge.countLabel}` : ""}`, sourceText: edge.sourceText, line: edge.line, color: edge.color, countLabel: edge.countLabel } }
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

function positionInLanes(core: Core, width: number, height: number, savedPositions: GraphPreferences["positions"] | null) {
  const columns: Record<GraphLane, cytoscape.NodeSingular[]> = { identity: [], endpoint: [], object: [] }
  core.nodes().forEach((node) => {
    columns[graphLaneForKind(String(node.data("kind")))].push(node)
  })
  const usableHeight = Math.max(height, 620)
  ;(["identity", "endpoint", "object"] as const).forEach((lane) => {
    const nodes = columns[lane]
    const gap = Math.min(128, (usableHeight - 130) / Math.max(nodes.length, 1))
    const start = (usableHeight - gap * Math.max(nodes.length - 1, 0)) / 2
    const anchor = laneGeometry(width, lane).anchor
    nodes.forEach((node, index) => node.position({
      x: modelXForRenderedX(core, anchor),
      y: savedPositions?.[node.id()]?.y ?? start + index * gap,
    }))
  })
}

function clampNodeToLane(core: Core, node: cytoscape.NodeSingular, width: number) {
  const lane = laneGeometry(width, graphLaneForKind(String(node.data("kind"))))
  const halfWidth = node.renderedOuterWidth() / 2
  const boundedLane = lane.right - lane.left >= halfWidth * 2
    ? { ...lane, left: lane.left + halfWidth, right: lane.right - halfWidth }
    : { ...lane, left: lane.anchor, right: lane.anchor }
  const rendered = clampRenderedPosition(node.renderedPosition(), boundedLane)
  node.position({ x: modelXForRenderedX(core, rendered.x), y: node.position().y })
}

function supportedMaxZoom(core: Core, width: number) {
  const currentZoom = core.zoom() || 1
  let widestModelWidth = 0
  core.nodes().forEach((node) => {
    widestModelWidth = Math.max(widestModelWidth, node.renderedOuterWidth() / currentZoom)
  })
  if (widestModelWidth <= 0 || width <= 0) return maximumZoom
  const narrowestLane = (['identity', 'endpoint', 'object'] as const).reduce((available, lane) => {
    const geometry = laneGeometry(width, lane)
    return Math.min(available, geometry.right - geometry.left)
  }, Number.POSITIVE_INFINITY)
  const unrounded = narrowestLane / widestModelWidth
  return Math.max(minimumZoom, Math.min(maximumZoom, Math.floor((unrounded + Number.EPSILON) * 10) / 10))
}

function constrainZoomToLanes(core: Core, width: number) {
  const maxZoom = supportedMaxZoom(core, width)
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

export function CytoscapeGraph({ projection, locked, fitVersion, preferences = null, selectedElementId = null, onSelect, onMaxZoomChange, onPreferencesChange, onRendererUnavailable }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const coreRef = useRef<Core | null>(null)
  const [rendererUnavailable, setRendererUnavailable] = useState(false)
  const projectionRef = useRef(projection)
  const selectRef = useRef(onSelect)
  const selectedElementIdRef = useRef(selectedElementId)
  const maxZoomRef = useRef(onMaxZoomChange)
  const preferenceRef = useRef(onPreferencesChange)
  const rendererUnavailableRef = useRef(onRendererUnavailable)
  const scheduleLaneCorrectionRef = useRef<(() => void) | null>(null)
  projectionRef.current = projection
  selectRef.current = onSelect
  selectedElementIdRef.current = selectedElementId
  maxZoomRef.current = onMaxZoomChange
  preferenceRef.current = onPreferencesChange
  rendererUnavailableRef.current = onRendererUnavailable

  useEffect(() => {
    if (!containerRef.current) return
    let core: Core
    try {
      core = cytoscape({
        container: containerRef.current,
        elements: [],
        style: [
          { selector: "node", style: { "background-color": "#111418", label: "data(label)", color: "#e5e7eb", "font-size": "12px", "font-family": "Geist Mono, ui-monospace, monospace", "font-weight": 600, "text-wrap": "wrap", "text-max-width": 172, "text-valign": "center", width: 186, height: 60, shape: "round-rectangle", "border-width": 1, "border-color": "data(verdictColor)", "border-opacity": 0.85 } },
          { selector: "node:selected", style: { "border-width": 2, "border-color": "#60a5fa", "background-color": "#141a20", "overlay-opacity": 0 } },
          { selector: 'node[kind = "route-candidate"]', style: { "border-width": 2, "border-style": "dotted", "border-color": "data(verdictColor)", "background-color": "#111418" } },
          { selector: "edge", style: { width: 1.7, "line-color": "data(color)", "line-style": "data(line)", "target-arrow-color": "data(color)", "target-arrow-shape": "triangle", "arrow-scale": 0.65, label: "data(label)", color: "#d4d4d8", "font-size": "9px", "font-family": "Geist Mono, ui-monospace, monospace", "text-background-color": "#090b0d", "text-background-opacity": 0.86, "text-background-padding": "2px", "text-rotation": "autorotate", "text-margin-y": -7, "curve-style": "bezier", opacity: 0.9 } },
          { selector: "edge:selected", style: { width: 2.6, "line-color": "#e5e7eb", "target-arrow-color": "#e5e7eb" } },
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
      const maxZoom = constrainZoomToLanes(core, width)
      core.nodes().forEach((node) => clampNodeToLane(core, node, width))
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
      const selection = selectGraphItem(projectionRef.current, event.target.id())
      if (selection) selectRef.current(selection, event.target.id())
    }
    const dragListener = (event: cytoscape.EventObject) => {
      clampNodeToLane(core, event.target, containerRef.current?.clientWidth ?? 0)
      if (containerRef.current) publishGeometry(containerRef.current, core)
      preferenceRef.current(readPreferences(core))
    }
    const viewportListener = () => scheduleLaneCorrection()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleLaneCorrection)
    resizeObserver?.observe(containerRef.current)
    core.on("tap", "node, edge", selectListener)
    core.on("dragfree", "node", dragListener)
    core.on("viewport", viewportListener)
    return () => {
      core.off("tap", "node, edge", selectListener)
      core.off("dragfree", "node", dragListener)
      core.off("viewport", viewportListener)
      resizeObserver?.disconnect()
      if (correctionFrame !== null) cancelAnimationFrame(correctionFrame)
      if (scheduleLaneCorrectionRef.current === scheduleLaneCorrection) scheduleLaneCorrectionRef.current = null
      core.destroy()
      if (coreRef.current === core) coreRef.current = null
    }
  }, [])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    core.elements().remove()
    core.add(elementsFor(projection))
    positionInLanes(core, containerRef.current?.clientWidth ?? 0, containerRef.current?.clientHeight ?? 0, preferences?.positions ?? null)
    core.nodes().forEach((node) => {
      if (locked) node.lock(); else node.unlock()
    })
    if (preferences?.viewport) core.viewport(preferences.viewport)
    else {
      core.layout({ name: "preset", fit: true, padding: 52 }).run()
    }
    syncSelection(core, selectedElementIdRef.current)
    scheduleLaneCorrectionRef.current?.()
  }, [locked, preferences, projection])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    syncSelection(core, selectedElementId)
    if (containerRef.current) publishGeometry(containerRef.current, core)
  }, [selectedElementId])

  useEffect(() => {
    if (fitVersion > 0) {
      coreRef.current?.fit(undefined, 36)
      scheduleLaneCorrectionRef.current?.()
    }
  }, [fitVersion])

  return rendererUnavailable
    ? <p className="rounded-md border p-4 text-sm text-muted-foreground" role="status">그래프 캔버스를 초기화하지 못했습니다. 화면 크기를 조정하거나 API 목록을 사용하세요.</p>
    : <div className="h-full min-h-[28rem] w-full bg-[var(--flowscope-canvas)]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px)", backgroundSize: "24px 24px" }} ref={containerRef} aria-label="공격면 Cytoscape 그래프" />
}
