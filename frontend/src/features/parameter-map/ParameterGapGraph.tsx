import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"
import { Crosshair, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { clampParameterNode, parameterLaneGeometry } from "./parameterLanes"
import { renderParameterNodeCardSvg } from "./parameterNodeCard"
import { parameterLaneOrder, type ParameterGraphProjection, type ParameterLane, type ParameterMapSelection } from "./parameterProjection"

interface Props {
  projection: ParameterGraphProjection
  focusVersion?: number
  hiddenGapCount?: number
  onSelect(selection: ParameterMapSelection): void
}
const laneLabels: Record<ParameterLane, string> = { condition: "조건/사용자", operation: "API 엔드포인트", input: "입력 파라미터", target: "권한 대상" }
const laneColors: Record<ParameterLane, string> = { condition: "#60a5fa", operation: "#34d399", input: "#fbbf24", target: "#c4b5fd" }
const sourceColors = { HUMAN: "#60a5fa", SCANNER: "#f87171", LLM: "#d4d4d8", UNKNOWN: "#a1a1aa" }
const minimumZoom = 0.95 // Keep 13px edge labels at least 12px; narrow views use the list.

function relationLabel(edge: ParameterGraphProjection["edges"][number], expanded = false) {
  const sourceLabel = (label: string, source: string) => expanded && source !== "UNKNOWN" ? `${label} · ${source}` : label
  return edge.sourceRole === "OBSERVATION" ? `관측 ${edge.sourceAttribution.map(source => `${sourceLabel(source.label, source.source)} × ${source.observationCount}`).join(" / ") || "UNKNOWN"}`
    : edge.sourceRole === "GAP_SUBJECT" ? `Gap 주체 ${sourceLabel(edge.sourceLabel, edge.trafficSource)}` : edge.relation === "definition" ? "정의 · 미관측" : edge.relation === "unknown-target" ? "연결 UNKNOWN" : edge.relation === "unknown-input" ? "입력 UNKNOWN" : "관계 근거"
}

function graphElements(projection: ParameterGraphProjection): ElementDefinition[] {
  const focus = projection.selection !== undefined
  return [
    ...projection.nodes.map(node => {
      const cardImage = renderParameterNodeCardSvg(node.card)
      return { data: {
        id: node.id, cardImage: cardImage.uri, accessibleLabel: node.card.accessibleLabel,
        width: cardImage.width, height: cardImage.height, lane: node.lane,
        focused: node.focused ? "yes" : focus ? "no" : "none",
      } }
    }),
    ...projection.edges.map(edge => ({ data: {
      id: edge.id, source: edge.source, target: edge.target, line: edge.line,
      color: edge.relation === "gap" ? "#f87171" : edge.sourceRole === "OBSERVATION" ? sourceColors[edge.trafficSource] : "#a1a1aa",
      label: relationLabel(edge),
      focused: edge.focused ? "yes" : focus ? "no" : "none",
    } })),
  ]
}

/** 렌더 사각형 계약: 테두리·여백과 viewport pan까지 포함해 lane 안에 유지한다. */
function constrain(core: Core, width: number) {
  const zoom = core.zoom() || 1
  let widest = 0
  core.nodes().forEach(node => { widest = Math.max(widest, node.renderedOuterWidth() / zoom) })
  const maxZoom = Math.min(2, ...parameterLaneOrder.map(lane => parameterLaneGeometry(width, lane, widest || 224).maxZoom))
  core.maxZoom(maxZoom)
  if (core.zoom() > maxZoom) core.zoom(maxZoom)
  core.nodes().forEach(node => {
    const currentZoom = core.zoom() || 1
    const geometry = parameterLaneGeometry(width, node.data("lane") as ParameterLane, node.renderedOuterWidth() / currentZoom, currentZoom)
    const bounded = clampParameterNode(node.renderedPosition(), geometry)
    node.position({ x: (bounded.x - core.pan().x) / currentZoom, y: node.position().y })
  })
}

function GapPathList({ projection, onSelect }: Props) {
  return <ol aria-label="Gap 경로 목록" className="space-y-4 p-4">
    {projection.visibleGapIds.map(gapId => <li key={gapId} className="min-w-0 border-l-2 border-[var(--flowscope-divider)] pl-3">
      <section aria-label={`Gap 경로 ${gapId}`}>
      <ol className="space-y-2">{projection.nodes.filter(node => node.selection.gapId === gapId).map(node => <li key={node.id}>
        <Button variant="ghost" data-gap-id={gapId} aria-label={node.card.accessibleLabel} aria-pressed={node.focused} className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-sm" onClick={() => onSelect(node.selection)}>
          <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-semibold" style={{ color: laneColors[node.lane] }}>{laneLabels[node.lane]}</span>{node.label}<span className="block text-muted-foreground">{node.observationState} · {node.confidence}</span></span>
        </Button>
      </li>)}</ol>
      <ul aria-label={`Gap ${gapId} 관계 근거`} className="mt-3 space-y-2">{projection.edges.filter(edge => edge.selection.gapId === gapId).map(edge => <li key={edge.id}>
        <Button variant="ghost" aria-pressed={edge.focused} className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-sm" onClick={() => onSelect(edge.selection)}>
          <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block">{relationLabel(edge, true)}</span><span className="block text-muted-foreground">{edge.sourceRole === "OBSERVATION" ? "관측 Evidence" : edge.sourceRole === "GAP_SUBJECT" ? "Gap 근거" : "관계 근거"} {edge.evidenceCount}건 · {edge.line === "solid" ? "실선" : edge.line === "dashed" ? "파선" : "점선"}</span></span>
        </Button>
      </li>)}</ul>
      </section>
    </li>)}
  </ol>
}

export function ParameterGapGraph({ projection, onSelect, focusVersion = 0, hiddenGapCount = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<Core | null>(null)
  const keyboardNodeRef = useRef<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const tooltipNodeRef = useRef<string | null>(null)
  const tooltipInteractionRef = useRef({ pointer: false, focus: false })
  const tooltipHideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const tooltipId = useId()
  const projectionRef = useRef(projection)
  const selectRef = useRef(onSelect)
  projectionRef.current = projection
  selectRef.current = onSelect
  const [width, setWidth] = useState(0)
  const [rendererUnavailable, setRendererUnavailable] = useState(false)
  const [listMode, setListMode] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [maxZoom, setMaxZoom] = useState(2)
  const [cardTooltip, setCardTooltip] = useState<{ nodeId: string; label: string; x: number; y: number; width: number } | null>(null)
  const correctRef = useRef<(() => void) | null>(null)
  const fallback = width < 900 || rendererUnavailable || listMode
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
    const tooltip = tooltipRef.current, canvas = canvasRef.current
    if (tooltip && canvas && cardTooltip) tooltip.style.top = `${Math.max(8, Math.min(cardTooltip.y, canvas.clientHeight - tooltip.offsetHeight - 8))}px`
  }, [cardTooltip])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => { setWidth(host.clientWidth); coreRef.current?.resize(); correctRef.current?.() }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(host)
    window.addEventListener("resize", measure)
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure) }
  }, [])

  useEffect(() => {
    if (fallback || !canvasRef.current) return
    let core: Core
    try {
      core = cytoscape({ container: canvasRef.current, elements: [], minZoom: minimumZoom, maxZoom: 2, layout: { name: "preset" },
        style: [
          { selector: "node", style: { width: "data(width)", height: "data(height)", padding: 0, shape: "round-rectangle", "background-image": "data(cardImage)", "background-fit": "contain", "background-clip": "none", "background-color": "#111418", "border-width": 2, "border-color": "#64748b" } },
          { selector: "edge", style: { label: "data(label)", width: 2, "line-style": "data(line)", "line-color": "data(color)", "target-arrow-color": "data(color)", "target-arrow-shape": "triangle", "curve-style": "bezier", "font-size": 13, color: "#d4d4d8", "text-background-color": "#090b0d", "text-background-opacity": 1, "text-background-padding": "3px", "text-margin-y": -80 } },
          { selector: 'node[focused = "yes"]', style: { "border-color": "#38bdf8", "underlay-color": "#0ea5e9", "underlay-opacity": 0.35, "underlay-padding": 6 } },
          { selector: "node.keyboard-focus", style: { "underlay-color": "#f8fafc", "underlay-opacity": 0.55, "underlay-padding": 9 } },
          { selector: 'edge[focused = "yes"]', style: { width: 3.5, opacity: 1 } },
          { selector: '[focused = "no"]', style: { opacity: 0.24 } },
        ] as unknown as cytoscape.StylesheetJson,
      })
    } catch { setRendererUnavailable(true); return }
    coreRef.current = core
    let correcting = false
    const correct = () => {
      if (correcting) return
      correcting = true
      constrain(core, hostRef.current?.clientWidth ?? 0)
      setZoom(core.zoom())
      setMaxZoom(core.maxZoom())
      dismissCardTooltip()
      correcting = false
    }
    correctRef.current = correct
    const select = (event: cytoscape.EventObject) => {
      const current = projectionRef.current
      const id = event.target.id()
      const selected = current.nodes.find(node => node.id === id) ?? current.edges.find(edge => edge.id === id)
      if (selected) { dismissCardTooltip(); selectRef.current(selected.selection) }
    }
    const showCardTooltip = (event: cytoscape.EventObject) => {
      const node = event.target, current = projectionRef.current.nodes.find(item => item.id === node.id())
      if (!current) return
      cancelTooltipHide()
      tooltipNodeRef.current = node.id()
      // focus/blur are custom Cytoscape events emitted by the keyboard canvas bridge.
      if (String(event.type) === "focus") { keyboardNodeRef.current = node.id(); node.addClass("keyboard-focus") }
      const position = node.renderedPosition(), hostWidth = hostRef.current?.clientWidth ?? 0
      const tooltipWidth = Math.min(360, Math.max(0, hostWidth - 16))
      setCardTooltip({ nodeId: node.id(), label: current.card.accessibleLabel, x: Math.max(8, Math.min(position.x - tooltipWidth / 2, hostWidth - tooltipWidth - 8)), y: position.y + node.renderedOuterHeight() / 2 + 8, width: tooltipWidth })
    }
    const hideCardTooltip = (event: cytoscape.EventObject) => {
      if (String(event.type) === "blur") { event.target.removeClass("keyboard-focus"); keyboardNodeRef.current = null }
      if (tooltipNodeRef.current !== event.target.id()) return
      if (String(event.type) === "blur" && !tooltipInteractionRef.current.pointer && !tooltipInteractionRef.current.focus) dismissCardTooltip()
      else scheduleTooltipHide()
    }
    core.on("tap", "node, edge", select)
    core.on("mouseover focus", "node", showCardTooltip)
    core.on("mouseout blur", "node", hideCardTooltip)
    core.on("drag dragfree", "node", correct)
    core.on("viewport", correct)
    return () => {
      core.off("tap", "node, edge", select)
      core.off("mouseover focus", "node", showCardTooltip)
      core.off("mouseout blur", "node", hideCardTooltip)
      core.off("drag dragfree", "node", correct)
      core.off("viewport", correct)
      correctRef.current = null
      coreRef.current = null
      keyboardNodeRef.current = null
      dismissCardTooltip()
      core.destroy()
    }
  }, [fallback, cancelTooltipHide, dismissCardTooltip, scheduleTooltipHide])

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    dismissCardTooltip()
    keyboardNodeRef.current = null
    const previous = new Map(core.nodes().map(node => [node.id(), { ...node.position() }] as const))
    core.elements().remove()
    core.add(graphElements(projection))
    let rowY = 110
    for (const gapId of projection.visibleGapIds) {
      let rowHeight = 120
      for (const lane of parameterLaneOrder) {
        const nodes = core.nodes().filter(node => node.data("lane") === lane && projection.nodes.find(item => item.id === node.id())?.selection.gapId === gapId)
        let laneY = rowY
        nodes.forEach(node => {
          const saved = previous.get(node.id())
          const anchor = parameterLaneGeometry(width, lane, node.outerWidth()).anchor
          node.position(saved ?? { x: (anchor - core.pan().x) / core.zoom(), y: laneY })
          laneY += node.outerHeight() + 40
          rowHeight = Math.max(rowHeight, laneY - rowY)
        })
      }
      rowY += rowHeight + 52
    }
    correctRef.current?.()
  }, [projection, fallback, width, dismissCardTooltip])

  // Focus explicit selections, not snapshot refreshes: retain intentional pan during polling.
  const selectedGapId = projection.selection?.gapId
  useEffect(() => {
    const core = coreRef.current
    if (!core || !selectedGapId) return
    const selected = core.nodes().filter(node => node.data("focused") === "yes")
    if (!selected.length) return
    const bounds = selected.boundingBox({ includeLabels: false, includeOverlays: false })
    const height = canvasRef.current?.clientHeight ?? 0
    if (!height) return
    const fitZoom = Math.min(core.zoom(), (height - 48) / Math.max(bounds.h, 1))
    core.zoom(Math.max(core.minZoom(), Math.min(core.maxZoom(), fitZoom)))
    core.pan({ x: core.pan().x, y: height / 2 - (bounds.y1 + bounds.y2) / 2 * core.zoom() })
    correctRef.current?.()
  }, [selectedGapId, focusVersion, fallback])

  const adjustZoom = (factor: number) => { const core = coreRef.current; if (core) { core.zoom(Math.min(core.maxZoom(), Math.max(core.minZoom(), core.zoom() * factor))); correctRef.current?.() } }
  const focusNode = (direction = 0) => {
    const nodes = coreRef.current?.nodes().toArray()
    if (!nodes?.length) return
    const current = nodes.findIndex(node => node.id() === keyboardNodeRef.current)
    const index = current < 0 ? Math.max(0, nodes.findIndex(node => node.data("focused") === "yes")) : Math.max(0, Math.min(nodes.length - 1, current + direction))
    if (current >= 0) nodes[current].emit("blur")
    nodes[index].emit("focus")
  }
  return <div ref={hostRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--flowscope-canvas)]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--flowscope-divider)] px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"><p>열린 경로 {projection.visibleGapIds.length}개{hiddenGapCount > 0 ? ` · 나머지 ${hiddenGapCount}개는 큐에서 선택` : ""} · 선택하면 원 Gap 상세</p><ul aria-label="요청 생성 주체 범례" className="flex gap-3">{(["HUMAN", "SCANNER", "LLM"] as const).map((source, index) => <li key={source} className="flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-sm" style={{ backgroundColor: sourceColors[source] }} />{["H", "S", "L"][index]}</li>)}</ul></div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Gap 그래프 축소" disabled={fallback || zoom <= minimumZoom} onClick={() => adjustZoom(0.9)}><Minus /></Button>
        <output aria-label="Gap 그래프 배율" className="min-w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</output>
        <Button variant="ghost" size="icon-sm" aria-label="Gap 그래프 확대" disabled={fallback || zoom >= maxZoom - 0.001} onClick={() => adjustZoom(1.1)}><Plus /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Gap 그래프 맞추기" disabled={fallback} onClick={() => { coreRef.current?.fit(undefined, 48); correctRef.current?.() }}><Crosshair /></Button>
        {width >= 900 && !rendererUnavailable && <Button size="sm" variant="ghost" onClick={() => setListMode(value => !value)}>{listMode ? "Gap 그래프 보기" : "Gap 목록 보기"}</Button>}
        {!fallback && <details className="relative text-sm"><summary className="cursor-pointer list-none rounded-md px-3 py-1.5 hover:bg-accent">경로 목록</summary><div className="absolute right-0 top-full z-30 mt-1 max-h-96 w-[min(36rem,80vw)] overflow-y-auto rounded-md border bg-[var(--flowscope-pane)] shadow-xl"><GapPathList projection={projection} onSelect={onSelect} /></div></details>}
        <details className="relative text-sm"><summary className="cursor-pointer list-none rounded-md px-3 py-1.5 hover:bg-accent">범례·도움말</summary><div className="absolute right-0 top-full z-30 mt-1 w-[min(38rem,85vw)] space-y-2 rounded-md border bg-[var(--flowscope-pane)] p-3 text-muted-foreground shadow-xl">
          <ul aria-label="관계 선형 범례" className="flex flex-wrap gap-x-5 gap-y-2">{([ ["solid", "실선: 관측·근거"], ["dashed", "붉은 파선: 미검증 Gap"], ["dotted", "점선: 정의·불확실 관계"] ] as const).map(([line, label]) => <li key={line} className="flex items-center gap-2"><span aria-hidden="true" className="w-7 border-t-2" style={{ borderStyle: line, borderColor: line === "dashed" ? "#f87171" : "#a1a1aa" }} />{label}</li>)}</ul>
          <p>주체 ≠ 관계 · Gap 주체 ≠ 관측 출처 · Gap ≠ 취약점 판정</p>
          <TooltipProvider><p><Tooltip><TooltipTrigger asChild><button type="button" aria-label="UNKNOWN 도움말" className="rounded underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">UNKNOWN</button></TooltipTrigger><TooltipContent className="text-sm">UNKNOWN은 근거 부족으로 아직 알 수 없는 상태입니다. Gap을 선택해 정의와 Evidence를 확인하세요.</TooltipContent></Tooltip> · 근거 부족 / {" "}<Tooltip><TooltipTrigger asChild><button type="button" aria-label="INFERRED 도움말" className="rounded underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">INFERRED</button></TooltipTrigger><TooltipContent className="text-sm">INFERRED는 정의나 연결에서 추론한 상태이며 실제 관측이 아닙니다. Gap을 선택해 정의와 Evidence를 확인하세요.</TooltipContent></Tooltip> · 추론. Gap 선택 후 근거 확인.</p></TooltipProvider>
        </div></details>
      </div>
    </div>
    <div role="table" aria-label="Gap 경로 계층" className="shrink-0 border-b-2 border-[var(--flowscope-divider)]">
      <div role="row" className={fallback ? "grid grid-cols-2" : "grid grid-cols-4"}>{parameterLaneOrder.map((lane, index) => <div role="columnheader" key={lane} className="min-w-0 border-r border-[var(--flowscope-divider)] px-3 py-2 text-sm font-semibold" style={{ borderTop: `3px solid ${laneColors[lane]}` }}><span aria-hidden="true" className="mr-2 text-muted-foreground">0{index + 1}</span>{laneLabels[lane]}</div>)}</div>
    </div>
    {fallback ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <p className="px-4 pt-4 text-sm text-muted-foreground">{rendererUnavailable ? "그래프 캔버스를 사용할 수 없어 같은 경로를 목록으로 표시합니다." : "같은 Gap과 근거를 계층 목록으로 확인하세요."}</p>
      {rendererUnavailable && <div className="px-4 pt-2"><Button variant="outline" size="sm" onClick={() => setRendererUnavailable(false)}>그래프 다시 시도</Button></div>}
      <GapPathList projection={projection} onSelect={onSelect} />
    </div> : <>
      <div className="relative min-h-0 flex-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-4">{parameterLaneOrder.map(lane => <div key={lane} className="border-r border-[var(--flowscope-divider)]" />)}</div>
        <div ref={canvasRef} tabIndex={0} aria-label="파라미터 Cytoscape 그래프" aria-describedby={cardTooltip ? tooltipId : undefined} className="absolute inset-0 h-full w-full focus-visible:outline-2 focus-visible:outline-ring" onFocus={() => focusNode()} onBlur={event => {
          if (tooltipRef.current?.contains(event.relatedTarget as Node | null)) { cancelTooltipHide(); return }
          coreRef.current?.nodes(".keyboard-focus").emit("blur"); dismissCardTooltip()
        }} onKeyDown={event => {
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
            if (event.relatedTarget === canvasRef.current) { cancelTooltipHide(); return }
            coreRef.current?.nodes(".keyboard-focus").emit("blur"); dismissCardTooltip()
          }}
          onKeyDown={event => {
            if (event.key === "Escape") { canvasRef.current?.focus(); dismissCardTooltip(); return }
            if (!["Home", "End", "PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(event.key)) return
            event.preventDefault()
            const element = event.currentTarget, end = Math.max(0, element.scrollHeight - element.clientHeight)
            const step = event.key.startsWith("Page") ? element.clientHeight : 40
            element.scrollTop = event.key === "Home" ? 0 : event.key === "End" ? end : Math.max(0, Math.min(end, element.scrollTop + (event.key.endsWith("Down") ? step : -step)))
          }}>{cardTooltip.label}</div>}
      </div>
    </>}
  </div>
}
