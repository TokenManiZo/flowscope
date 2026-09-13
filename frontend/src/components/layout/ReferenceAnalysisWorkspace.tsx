import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { RouteContextPanel } from "./RouteContextPanel"

const COMPACT_WORKSPACE_QUERY = "(max-width: 1279px)"
const CONTEXT_TITLE = "분석 필터"
const CONTEXT_DESCRIPTION = "현재 분석 결과에 적용할 필터를 선택합니다."
const INSPECTOR_TITLE = "선택 상세"
const INSPECTOR_DESCRIPTION = "선택한 항목의 상세 정보를 확인합니다."

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
  inspectorModal?: boolean
  contextOpen?: boolean
  onInspectorOpenChange?(open: boolean): void
  onContextOpenChange?(open: boolean): void
}

export function ReferenceAnalysisWorkspace({ ariaLabel, context, toolbar, children, inspector, inspectorOpen, inspectorModal = true, contextOpen, onInspectorOpenChange, onContextOpenChange }: ReferenceAnalysisWorkspaceProps) {
  const compact = useCompactWorkspace()
  const [isContextOpen, setContextOpen] = useOpenState(contextOpen, onContextOpenChange)
  const [isInspectorOpen, setInspectorOpen] = useOpenState(inspectorOpen, onInspectorOpenChange)
  const hasContext = context != null
  const hasInspector = inspector != null
  const desktopColumns = hasContext && hasInspector
    ? "xl:grid-cols-[minmax(15.5rem,17rem)_minmax(0,1fr)_minmax(22rem,25rem)]"
    : hasContext
      ? "xl:grid-cols-[minmax(15.5rem,17rem)_minmax(0,1fr)]"
      : hasInspector
        ? "xl:grid-cols-[minmax(0,1fr)_minmax(22rem,25rem)]"
        : "xl:grid-cols-1"

  return <section className={`grid min-h-full min-w-0 grid-cols-1 ${desktopColumns} xl:h-full xl:overflow-hidden`}>
    {!compact && hasContext ? <RouteContextPanel title={CONTEXT_TITLE} className="hidden min-h-0 overflow-y-auto xl:block">{context}</RouteContextPanel> : null}
    <section aria-label={ariaLabel} tabIndex={0} className="flex min-h-0 min-w-0 flex-col overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
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
    {!compact && hasInspector ? <aside aria-label={INSPECTOR_TITLE} className="hidden min-h-0 overflow-y-auto border-l border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] xl:block">{inspector}</aside> : null}
  </section>
}
