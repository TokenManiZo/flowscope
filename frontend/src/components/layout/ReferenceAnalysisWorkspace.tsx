import { useEffect, useRef, useState, type ReactNode } from "react"
import { Filter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { RouteContextPanel } from "./RouteContextPanel"
import { PaneResizeHandle } from "./PaneResizeHandle"

const COMPACT_WORKSPACE_QUERY = "(max-width: 1279px)"
const CONTEXT_TITLE = "분석 필터"
const CONTEXT_DESCRIPTION = "현재 분석 결과에 적용할 필터를 선택합니다."
const INSPECTOR_TITLE = "선택 상세"
const INSPECTOR_DESCRIPTION = "선택한 항목의 상세 정보를 확인합니다."
const CONTEXT_MIN_WIDTH = 64
const CONTEXT_DEFAULT_WIDTH = 264
const INSPECTOR_MIN_WIDTH = 64
const INSPECTOR_DEFAULT_WIDTH = 368
const CENTER_MIN_WIDTH = 160
const HANDLE_WIDTH = 16

function useCompactWorkspace() {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia?.(COMPACT_WORKSPACE_QUERY).matches === true)

  useEffect(() => {
    const media = window.matchMedia(COMPACT_WORKSPACE_QUERY)
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return compact
}

function useOpenState(controlledOpen: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return [open, setOpen] as const
}

export interface ReferenceAnalysisWorkspaceProps {
  ariaLabel: string
  context: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  inspector: ReactNode
  inspectorOpen?: boolean
  /** 데스크톱에서 선택과 무관하게 상세 패널을 계속 열어 둔다. 캔버스 폭이 바뀌면 다시 그려지며 깜빡이는 그래프 화면용. */
  inspectorPersistent?: boolean
  inspectorModal?: boolean
  inspectorDefaultWidth?: number
  contentOverflow?: "auto" | "hidden"
  inspectorOverflow?: "auto" | "hidden"
  contextOpen?: boolean
  /** false면 왼쪽 패널의 "분석 필터" 제목 줄을 숨긴다(패널 자체 제목이 있는 화면용). */
  contextTitle?: boolean
  /** 켜 둔 필터 수. 왼쪽 패널을 접었을 때 남는 띠의 필터 아이콘에 숫자로 보여 준다. */
  contextBadge?: number
  onInspectorOpenChange?(open: boolean): void
  onContextOpenChange?(open: boolean): void
}

export function ReferenceAnalysisWorkspace({ ariaLabel, context, toolbar, children, inspector, inspectorOpen, inspectorPersistent = false, inspectorModal = true, inspectorDefaultWidth = INSPECTOR_DEFAULT_WIDTH, contentOverflow = "auto", inspectorOverflow = "auto", contextOpen, contextTitle = true, contextBadge = 0, onInspectorOpenChange, onContextOpenChange }: ReferenceAnalysisWorkspaceProps) {
  const compact = useCompactWorkspace()
  const [isContextOpen, setContextOpen] = useOpenState(contextOpen, onContextOpenChange)
  const [isInspectorOpen, setInspectorOpen] = useOpenState(inspectorOpen, onInspectorOpenChange)
  const workspaceRef = useRef<HTMLElement>(null)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  // 선택을 관리하는 화면(inspectorOpen 전달)은 선택이 없을 때 빈 상세 패널을 접어 표·그래프에 폭을 준다.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(!inspectorPersistent && inspectorOpen === false)
  const [contextWidth, setContextWidth] = useState(CONTEXT_DEFAULT_WIDTH)
  const [inspectorWidth, setInspectorWidth] = useState(inspectorDefaultWidth)
  const hasContext = context != null
  const hasInspector = inspector != null
  const workspaceWidth = () => workspaceRef.current?.getBoundingClientRect().width || window.innerWidth
  const contextMax = () => Math.max(CONTEXT_MIN_WIDTH, workspaceWidth() - (hasInspector && !inspectorCollapsed ? inspectorWidth + HANDLE_WIDTH : 0) - CENTER_MIN_WIDTH - HANDLE_WIDTH)
  const inspectorMax = () => Math.max(INSPECTOR_MIN_WIDTH, workspaceWidth() - (hasContext && !contextCollapsed ? contextWidth + HANDLE_WIDTH : 0) - CENTER_MIN_WIDTH - HANDLE_WIDTH)
  useEffect(() => {
    if (inspectorOpen !== undefined && !inspectorPersistent) setInspectorCollapsed(!inspectorOpen)
  }, [inspectorOpen, inspectorPersistent])
  useEffect(() => {
    if (compact || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      setContextWidth(current => Math.min(current, contextMax()))
      setInspectorWidth(current => Math.min(current, inspectorMax()))
    })
    if (workspaceRef.current) observer.observe(workspaceRef.current)
    return () => observer.disconnect()
  }, [compact, contextCollapsed, contextWidth, hasContext, hasInspector, inspectorCollapsed, inspectorWidth])

  return <section ref={workspaceRef} className="relative flex min-h-full min-w-0 flex-col xl:h-full xl:flex-row xl:overflow-hidden">
    {/* 접으면 40px 띠를 남겨 언제든 다시 열 수 있게 한다(경계의 숨은 버튼만 남으면 다시 여는 법을 찾기 어렵다). */}
    {!compact && hasContext ? !contextCollapsed ? <><RouteContextPanel title={CONTEXT_TITLE} showTitle={contextTitle} className="min-h-0 shrink-0 overflow-y-auto" style={{ width: contextWidth }}>{context}</RouteContextPanel><PaneResizeHandle side="left" label={CONTEXT_TITLE} width={contextWidth} min={CONTEXT_MIN_WIDTH} max={contextMax()} onWidthChange={setContextWidth} onCollapse={() => setContextCollapsed(true)} /></>
      : <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-border/70 py-3">
        <Button type="button" size="icon-sm" variant="outline" aria-label={`${CONTEXT_TITLE} 패널 열기`} title="필터 펼치기" className="relative size-8" onClick={() => setContextCollapsed(false)}><Filter className="size-4" aria-hidden="true" />{contextBadge > 0 && <span aria-label={`켜 둔 필터 ${contextBadge}개`} className="absolute -right-1.5 -top-1.5 rounded-full bg-sky-500 px-1 text-[10px] leading-4 text-white">{contextBadge}</span>}</Button>
        <span aria-hidden="true" className="text-xs tracking-widest text-muted-foreground [writing-mode:vertical-rl]">필터</span>
      </div> : null}
    <section aria-label={ariaLabel} tabIndex={0} className={`relative flex min-h-0 min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${contentOverflow === "hidden" ? "overflow-hidden" : "overflow-y-auto"}`}>
      {compact && (hasContext || hasInspector) ? <div className="flex flex-wrap items-center gap-2 border-b border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] px-3 py-2 xl:hidden">
        {hasContext ? <Sheet open={isContextOpen} onOpenChange={setContextOpen}>
          <SheetTrigger asChild><Button type="button" size="sm" variant="outline">분석 필터 열기</Button></SheetTrigger>
          <SheetContent side="left" aria-label={CONTEXT_TITLE} aria-describedby="reference-analysis-context-description" className="w-[min(22rem,90vw)] overflow-y-auto border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] p-0">
            <SheetHeader className="sr-only"><SheetTitle>{CONTEXT_TITLE}</SheetTitle><SheetDescription id="reference-analysis-context-description">{CONTEXT_DESCRIPTION}</SheetDescription></SheetHeader>
            {context}
          </SheetContent>
        </Sheet> : null}
        {hasInspector ? <Sheet modal={inspectorModal} open={isInspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetTrigger asChild><Button type="button" size="sm" variant="outline">선택 상세 열기</Button></SheetTrigger>
          <SheetContent aria-label={INSPECTOR_TITLE} aria-describedby="reference-analysis-inspector-description" className="w-[min(26rem,90vw)] overflow-y-auto border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] p-0">
            <SheetHeader className="sr-only"><SheetTitle>{INSPECTOR_TITLE}</SheetTitle><SheetDescription id="reference-analysis-inspector-description">{INSPECTOR_DESCRIPTION}</SheetDescription></SheetHeader>
            {inspector}
          </SheetContent>
        </Sheet> : null}
      </div> : null}
      {toolbar}
      {children}
    </section>
    {!compact && hasInspector ? <><PaneResizeHandle side="right" label={INSPECTOR_TITLE} width={inspectorWidth} min={INSPECTOR_MIN_WIDTH} max={inspectorMax()} collapsed={inspectorCollapsed} onWidthChange={setInspectorWidth} onCollapse={() => setInspectorCollapsed(true)} onExpand={() => setInspectorCollapsed(false)} />{!inspectorCollapsed ? <aside aria-label={INSPECTOR_TITLE} className={`min-h-0 shrink-0 border-l border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] ${inspectorOverflow === "hidden" ? "overflow-hidden" : "overflow-y-auto"}`} style={{ width: inspectorWidth }}>{inspector}</aside> : null}</> : null}
  </section>
}
