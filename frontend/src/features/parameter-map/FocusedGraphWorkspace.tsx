import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

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
  toolbar: ReactNode
  children: ReactNode
  inspector: ReactNode
  queueOpen: boolean
  inspectorOpen: boolean
  onQueueOpenChange(open: boolean): void
  onInspectorOpenChange(open: boolean): void
}

/** 그래프 중심 3-pane(큐·그래프·상세). 900px 미만은 큐를 sheet로, 1440px 미만은 상세를 sheet로 낸다. */
export function FocusedGraphWorkspace({ queue, toolbar, children, inspector, queueOpen, inspectorOpen, onQueueOpenChange, onInspectorOpenChange }: Props) {
  const narrow = useMedia("(max-width: 899px)")
  const compact = useMedia("(max-width: 1439px)")
  const queueTrigger = useRef<HTMLButtonElement>(null)
  const inspectorReturnFocus = useRef<HTMLElement | null>(null)
  const showQueue = !narrow && queueOpen
  const showInspector = !compact && inspectorOpen && inspector != null
  useEffect(() => {
    if (narrow && inspectorOpen && queueOpen) onQueueOpenChange(false)
  }, [narrow, inspectorOpen, queueOpen, onQueueOpenChange])

  return <section aria-label="그래프 중심 점검 작업면" data-layout="focused-graph" data-queue-open={showQueue} data-inspector-open={showInspector} className="focused-graph-workspace">
    {showQueue && <aside aria-label="점검 우선순위" className="focused-graph-pane focused-graph-queue">{queue}</aside>}
    <section aria-label="그래프 작업 영역" className="focused-graph-center">
      <div className="flex shrink-0 items-center border-b border-[var(--flowscope-divider)] px-3 py-1">
        <Button ref={queueTrigger} size="sm" variant="ghost" aria-expanded={queueOpen} onClick={() => onQueueOpenChange(!queueOpen)}>{queueOpen ? "점검 큐 접기" : "점검 큐 열기"}</Button>
      </div>
      {toolbar}
      {children}
    </section>
    {showInspector && <aside aria-label="선택 상세" className="focused-graph-pane focused-graph-inspector">{inspector}</aside>}
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
        <SheetHeader className="sr-only"><SheetTitle>선택 상세</SheetTitle><SheetDescription>선택한 Gap의 근거, Evidence와 정의를 확인합니다.</SheetDescription></SheetHeader>
        {inspector}
      </SheetContent>
    </Sheet>}
  </section>
}
