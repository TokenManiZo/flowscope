import { useEffect, useRef, useState, type ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PaneResizeHandle } from "@/components/layout/PaneResizeHandle"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

const QUEUE_MIN_WIDTH = 64
const QUEUE_DEFAULT_WIDTH = 232
const INSPECTOR_MIN_WIDTH = 64
const INSPECTOR_DEFAULT_WIDTH = 368
const CENTER_MIN_WIDTH = 160
const HANDLE_WIDTH = 16

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches === true)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])
  return matches
}

interface Props {
  queue: ReactNode
  header?: ReactNode
  headerMeta?: ReactNode
  toolbar: ReactNode
  children: ReactNode
  inspector: ReactNode
  queueOpen: boolean
  inspectorOpen: boolean
  onQueueOpenChange(open: boolean): void
  onInspectorOpenChange(open: boolean): void
}

/** 그래프 중심 3-pane(큐·그래프·상세). 900px 미만은 큐를 sheet로, 1440px 미만은 상세를 sheet로 낸다. */
export function FocusedGraphWorkspace({ queue, header, headerMeta, toolbar, children, inspector, queueOpen, inspectorOpen, onQueueOpenChange, onInspectorOpenChange }: Props) {
  const narrow = useMedia("(max-width: 899px)")
  const compact = useMedia("(max-width: 1439px)")
  const workspaceRef = useRef<HTMLElement>(null)
  const queueTrigger = useRef<HTMLButtonElement>(null)
  const inspectorReturnFocus = useRef<HTMLElement | null>(null)
  const [queueWidth, setQueueWidth] = useState(QUEUE_DEFAULT_WIDTH)
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const showQueue = !narrow && queueOpen
  const showInspector = !compact && inspectorOpen && inspector != null && !inspectorCollapsed
  const workspaceWidth = () => workspaceRef.current?.getBoundingClientRect().width || window.innerWidth
  const queueMax = () => Math.max(QUEUE_MIN_WIDTH, workspaceWidth() - (showInspector ? inspectorWidth + HANDLE_WIDTH : 0) - CENTER_MIN_WIDTH - HANDLE_WIDTH)
  const inspectorMax = () => Math.max(INSPECTOR_MIN_WIDTH, workspaceWidth() - (showQueue ? queueWidth + HANDLE_WIDTH : 0) - CENTER_MIN_WIDTH - HANDLE_WIDTH)
  useEffect(() => {
    if (narrow && inspectorOpen && queueOpen) onQueueOpenChange(false)
  }, [narrow, inspectorOpen, queueOpen, onQueueOpenChange])
  useEffect(() => {
    if (inspectorOpen) setInspectorCollapsed(false)
  }, [inspectorOpen])
  useEffect(() => {
    if (narrow || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      setQueueWidth(current => Math.min(current, queueMax()))
      setInspectorWidth(current => Math.min(current, inspectorMax()))
    })
    if (workspaceRef.current) observer.observe(workspaceRef.current)
    return () => observer.disconnect()
  }, [inspectorCollapsed, inspectorOpen, inspectorWidth, narrow, queueOpen, queueWidth, showInspector, showQueue])

  return <section ref={workspaceRef} aria-label="그래프 중심 점검 작업면" data-layout="focused-graph" data-queue-open={showQueue} data-inspector-open={showInspector} className="focused-graph-workspace">
    {!narrow && <>{showQueue ? <aside aria-label="점검 우선순위" className="focused-graph-pane focused-graph-queue shrink-0" style={{ width: queueWidth }}>{queue}</aside> : null}<PaneResizeHandle side="left" label="점검 우선순위" width={queueWidth} min={QUEUE_MIN_WIDTH} max={queueMax()} collapsed={!queueOpen} onWidthChange={setQueueWidth} onCollapse={() => onQueueOpenChange(false)} onExpand={() => onQueueOpenChange(true)} /></>}
    <section aria-label="그래프 작업 영역" className="focused-graph-center">
      <div role="toolbar" aria-label="Gap 그래프 상단 제어" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--flowscope-divider)] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">{header}<Button ref={queueTrigger} size="sm" variant="outline" aria-expanded={queueOpen} onClick={() => onQueueOpenChange(!queueOpen)}>{queueOpen ? <PanelLeftClose /> : <PanelLeftOpen />}{queueOpen ? "점검 큐 접기" : "점검 큐 열기"}</Button></div>
        {headerMeta}
      </div>
      {queueOpen ? toolbar : null}
      {children}
    </section>
    {!compact && inspectorOpen && inspector != null ? <><PaneResizeHandle side="right" label="선택 상세" width={inspectorWidth} min={INSPECTOR_MIN_WIDTH} max={inspectorMax()} collapsed={inspectorCollapsed} onWidthChange={setInspectorWidth} onCollapse={() => setInspectorCollapsed(true)} onExpand={() => setInspectorCollapsed(false)} />{showInspector ? <aside aria-label="선택 상세" className="focused-graph-pane focused-graph-inspector shrink-0" style={{ width: inspectorWidth }}>{inspector}</aside> : null}</> : null}
    {narrow && <Sheet open={queueOpen} onOpenChange={onQueueOpenChange}>
      <SheetContent side="left" aria-label="점검 우선순위" className="focused-graph-sheet overflow-y-auto p-0 pt-10" onCloseAutoFocus={event => { event.preventDefault(); queueTrigger.current?.focus() }}>
        <SheetHeader className="sr-only"><SheetTitle>점검 우선순위</SheetTitle><SheetDescription>열린 Gap의 우선순위와 고급 표시 필터를 확인합니다.</SheetDescription></SheetHeader>
        {queue}
      </SheetContent>
    </Sheet>}
    {compact && <Sheet open={inspectorOpen && inspector != null} onOpenChange={onInspectorOpenChange}>
      <SheetContent aria-label="선택 상세" showCloseButton={false} className="focused-graph-sheet overflow-y-auto p-0"
        onOpenAutoFocus={() => { inspectorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const origin = inspectorReturnFocus.current
          inspectorReturnFocus.current = null
          // A dismissed queue can leave body focused before this sheet opens.
          if (origin?.isConnected && origin !== document.body && origin !== document.documentElement) {
            origin.focus()
            if (document.activeElement === origin) return
          }
          queueTrigger.current?.focus()
        }}>
        <SheetHeader className="sr-only"><SheetTitle>선택 상세</SheetTitle><SheetDescription>선택한 Gap의 근거, 관측 기록과 정의를 확인합니다.</SheetDescription></SheetHeader>
        {inspector}
      </SheetContent>
    </Sheet>}
  </section>
}
